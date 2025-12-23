const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Estado em memória
const users = new Map();
const queue = [];
const rooms = new Map();
const rateLimits = new Map(); // Rate limiting por IP/user

// Rate limiting config
const RATE_LIMITS = {
  chat_message: { max: 10, window: 5000 },    // 10 msgs por 5 segundos
  join_queue: { max: 5, window: 10000 },       // 5 joins por 10 segundos
  typing: { max: 20, window: 5000 },           // 20 typing events por 5 segundos
  webrtc_ice: { max: 50, window: 5000 },       // 50 ICE candidates por 5 segundos
};

// Verificar rate limit
function checkRateLimit(userId, action) {
  const key = `${userId}:${action}`;
  const limit = RATE_LIMITS[action];
  if (!limit) return true;
  
  const now = Date.now();
  let record = rateLimits.get(key);
  
  if (!record || now - record.start > limit.window) {
    record = { start: now, count: 1 };
    rateLimits.set(key, record);
    return true;
  }
  
  record.count++;
  if (record.count > limit.max) {
    console.log(`⚠️ Rate limit exceeded: ${key}`);
    return false;
  }
  return true;
}

// Limpar rate limits antigos periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now - record.start > 60000) rateLimits.delete(key);
  }
}, 30000);

// Gerar ID anônimo
function generateAnonId() {
  const adjectives = ['Swift', 'Bright', 'Cool', 'Wild', 'Calm', 'Bold', 'Wise', 'Free', 'Quick', 'Sharp'];
  const nouns = ['Fox', 'Wolf', 'Bear', 'Eagle', 'Lion', 'Tiger', 'Hawk', 'Owl', 'Panda', 'Falcon'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

// Sanitizar texto (prevenir XSS básico)
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.slice(0, 1000).replace(/[<>]/g, ''); // Max 1000 chars, remove < >
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(), 
    users: users.size, 
    queue: queue.length,
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'VOX-BRIDGE API v1.1', online: users.size });
});

// Stats endpoint
app.get('/stats', (req, res) => {
  res.json({
    online: users.size,
    inQueue: queue.length,
    activeRooms: rooms.size,
    uptime: Math.floor(process.uptime())
  });
});

// TURN credentials endpoint
app.get('/turn-credentials', async (req, res) => {
  try {
    const turnServers = [
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ];
    res.json(turnServers);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get TURN credentials' });
  }
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  const id = uuidv4();
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  
  const user = { 
    id, 
    ws, 
    ip,
    anonymousId: generateAnonId(), 
    nativeLanguage: 'pt', 
    targetLanguage: 'en', 
    interests: [], 
    country: 'BR', 
    roomId: null,
    connectedAt: Date.now()
  };
  users.set(id, user);

  console.log(`👤 User connected: ${user.anonymousId} (${users.size} online)`);
  ws.send(JSON.stringify({ type: 'connected', payload: { userId: id, anonymousId: user.anonymousId, online: users.size } }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Rate limiting para ações específicas
      if (RATE_LIMITS[msg.type] && !checkRateLimit(id, msg.type)) {
        return; // Ignorar se excedeu rate limit
      }
      
      handleMessage(user, msg);
    } catch (e) { 
      console.error('Parse error:', e); 
    }
  });

  ws.on('close', () => {
    console.log(`👤 User disconnected: ${user.anonymousId} (${users.size - 1} online)`);
    handleDisconnect(user);
    users.delete(id);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

function handleMessage(user, msg) {
  switch (msg.type) {
    case 'ping': 
      user.ws.send(JSON.stringify({ type: 'pong', payload: { online: users.size, queue: queue.length } }));
      break;
    case 'join_queue': joinQueue(user, msg.payload); break;
    case 'leave_queue': leaveQueue(user); break;
    case 'chat_message': sendChatMessage(user, msg.payload); break;
    case 'typing': sendTyping(user, msg.payload); break;
    case 'leave_room': leaveRoom(user); break;
    case 'webrtc_offer': forwardToPartner(user, 'webrtc_offer', msg.payload); break;
    case 'webrtc_answer': forwardToPartner(user, 'webrtc_answer', msg.payload); break;
    case 'webrtc_ice': forwardToPartner(user, 'webrtc_ice', msg.payload); break;
  }
}

function forwardToPartner(user, type, payload) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  const partner = room.find(u => u.id !== user.id);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ type, payload }));
  }
}

function joinQueue(user, payload) {
  // Não pode entrar na fila se já está em uma sala
  if (user.roomId) return;
  
  if (payload) {
    user.nativeLanguage = sanitizeText(payload.nativeLanguage) || 'pt';
    user.targetLanguage = sanitizeText(payload.targetLanguage) || 'en';
    user.interests = Array.isArray(payload.interests) ? payload.interests.slice(0, 10).map(i => sanitizeText(i)) : [];
    user.country = sanitizeText(payload.country) || 'BR';
  }
  
  // Procurar match com compatibilidade de idioma
  const matchIdx = queue.findIndex(q => {
    if (q.id === user.id) return false;
    
    // Match perfeito: idiomas complementares
    const perfectMatch = (
      user.targetLanguage === q.nativeLanguage && 
      q.targetLanguage === user.nativeLanguage
    );
    if (perfectMatch) return true;
    
    // Match bom: mesmo idioma alvo
    const sameTarget = user.targetLanguage === q.targetLanguage;
    if (sameTarget) return true;
    
    // Fallback após 30 segundos
    const waitTime = Date.now() - (q.queueJoinTime || Date.now());
    if (waitTime > 30000) return true;
    
    return false;
  });
  
  if (matchIdx >= 0) {
    const partner = queue.splice(matchIdx, 1)[0];
    createRoom(user, partner);
  } else {
    if (!queue.find(q => q.id === user.id)) {
      user.queueJoinTime = Date.now();
      queue.push(user);
      user.ws.send(JSON.stringify({ type: 'queue_joined', payload: { position: queue.length } }));
    }
  }
}

function leaveQueue(user) {
  const idx = queue.findIndex(q => q.id === user.id);
  if (idx >= 0) {
    queue.splice(idx, 1);
    user.ws.send(JSON.stringify({ type: 'queue_left', payload: {} }));
  }
}

function createRoom(user1, user2) {
  const roomId = uuidv4();
  user1.roomId = roomId;
  user2.roomId = roomId;
  rooms.set(roomId, [user1, user2]);

  const common = user1.interests.filter(i => user2.interests.includes(i));
  
  // IMPORTANTE: Definir quem é initiator (impolite) e quem é responder (polite)
  // user1 = quem estava na fila (initiator/impolite)
  // user2 = quem acabou de entrar (responder/polite)
  const info1 = { 
    odId: user2.anonymousId, 
    odUserId: user2.id, // ID para comparação no frontend
    nativeLanguage: user2.nativeLanguage, 
    country: user2.country, 
    commonInterests: common,
    isInitiator: true // user1 é o initiator
  };
  const info2 = { 
    odId: user1.anonymousId, 
    odUserId: user1.id,
    nativeLanguage: user1.nativeLanguage, 
    country: user1.country, 
    commonInterests: common,
    isInitiator: false // user2 é o responder
  };
  
  console.log(`🎯 Match: ${user1.anonymousId} (initiator) <-> ${user2.anonymousId} (responder)`);
  
  user1.ws.send(JSON.stringify({ type: 'matched', payload: { roomId, partner: info1 } }));
  user2.ws.send(JSON.stringify({ type: 'matched', payload: { roomId, partner: info2 } }));
}

function sendChatMessage(user, payload) {
  if (!user.roomId || !payload?.text) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const text = sanitizeText(payload.text);
  if (!text) return;
  
  const partner = room.find(u => u.id !== user.id);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ 
      type: 'chat_message', 
      payload: { from: user.anonymousId, text, timestamp: Date.now() } 
    }));
  }
}

function sendTyping(user, payload) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const partner = room.find(u => u.id !== user.id);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ type: 'typing', payload: { isTyping: !!payload?.isTyping } }));
  }
}

function leaveRoom(user) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (room) {
    const partner = room.find(u => u.id !== user.id);
    if (partner && partner.ws.readyState === WebSocket.OPEN) {
      partner.ws.send(JSON.stringify({ type: 'partner_left', payload: {} }));
      partner.roomId = null;
    }
    rooms.delete(user.roomId);
  }
  user.roomId = null;
}

function handleDisconnect(user) {
  leaveQueue(user);
  leaveRoom(user);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wss.clients.forEach(ws => ws.close());
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 VOX-BRIDGE API v1.1 running on port ${PORT}`));
