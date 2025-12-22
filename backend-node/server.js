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

// Gerar ID anônimo
function generateAnonId() {
  const adjectives = ['Swift', 'Bright', 'Cool', 'Wild', 'Calm', 'Bold', 'Wise', 'Free'];
  const nouns = ['Fox', 'Wolf', 'Bear', 'Eagle', 'Lion', 'Tiger', 'Hawk', 'Owl'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now(), users: users.size, queue: queue.length });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'VOX-BRIDGE API v1.0' });
});

// TURN credentials endpoint (servidores TURN gratuitos)
app.get('/turn-credentials', async (req, res) => {
  try {
    // Servidores TURN públicos/gratuitos
    const turnServers = [
      // OpenRelay TURN (público)
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      // Backup TURN
      {
        urls: 'turn:relay.metered.ca:80',
        username: 'e8dd65c92f6f1f2d5c67c7a3',
        credential: 'kW3QfUZKpLqYhDzS'
      }
    ];
    res.json(turnServers);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get TURN credentials' });
  }
});

// WebSocket handling
wss.on('connection', (ws) => {
  const id = uuidv4();
  const user = { id, ws, anonymousId: generateAnonId(), nativeLanguage: 'pt', targetLanguage: 'en', interests: [], country: 'BR', roomId: null };
  users.set(id, user);

  ws.send(JSON.stringify({ type: 'connected', payload: { userId: id, anonymousId: user.anonymousId, online: users.size } }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(user, msg);
    } catch (e) { console.error('Parse error:', e); }
  });

  ws.on('close', () => {
    handleDisconnect(user);
    users.delete(id);
  });
});

function handleMessage(user, msg) {
  switch (msg.type) {
    case 'ping': 
      // Responder com pong e contagem de usuários online
      user.ws.send(JSON.stringify({ type: 'pong', payload: { online: users.size, queue: queue.length } }));
      break;
    case 'join_queue': joinQueue(user, msg.payload); break;
    case 'leave_queue': leaveQueue(user); break;
    case 'chat_message': sendChatMessage(user, msg.payload); break;
    case 'typing': sendTyping(user, msg.payload); break;
    case 'leave_room': leaveRoom(user); break;
    // WebRTC Signaling
    case 'webrtc_offer': forwardToPartner(user, 'webrtc_offer', msg.payload); break;
    case 'webrtc_answer': forwardToPartner(user, 'webrtc_answer', msg.payload); break;
    case 'webrtc_ice': forwardToPartner(user, 'webrtc_ice', msg.payload); break;
  }
}

// Forward WebRTC signals to partner
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
  if (payload) {
    user.nativeLanguage = payload.nativeLanguage || 'pt';
    user.targetLanguage = payload.targetLanguage || 'en';
    user.interests = payload.interests || [];
    user.country = payload.country || 'BR';
  }
  
  // Procurar match com compatibilidade de idioma
  // Prioridade: 1) Idioma alvo = idioma nativo do parceiro (e vice-versa)
  //             2) Mesmo idioma alvo
  //             3) Qualquer pessoa
  const matchIdx = queue.findIndex(q => {
    if (q.id === user.id) return false;
    
    // Match perfeito: eu quero aprender o idioma nativo dele, ele quer aprender o meu
    const perfectMatch = (
      user.targetLanguage === q.nativeLanguage && 
      q.targetLanguage === user.nativeLanguage
    );
    if (perfectMatch) return true;
    
    // Match bom: mesmo idioma alvo (podem praticar juntos)
    const sameTarget = user.targetLanguage === q.targetLanguage;
    if (sameTarget) return true;
    
    // Se não tem ninguém compatível há mais de 30 segundos, aceita qualquer um
    const waitTime = Date.now() - (user.queueJoinTime || Date.now());
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
  if (idx >= 0) queue.splice(idx, 1);
}

function createRoom(user1, user2) {
  const roomId = uuidv4();
  user1.roomId = roomId;
  user2.roomId = roomId;
  rooms.set(roomId, [user1, user2]);

  const common = user1.interests.filter(i => user2.interests.includes(i));
  
  const info1 = { odId: user2.anonymousId, nativeLanguage: user2.nativeLanguage, country: user2.country, commonInterests: common };
  const info2 = { odId: user1.anonymousId, nativeLanguage: user1.nativeLanguage, country: user1.country, commonInterests: common };
  
  user1.ws.send(JSON.stringify({ type: 'matched', payload: { roomId, partner: info1 } }));
  user2.ws.send(JSON.stringify({ type: 'matched', payload: { roomId, partner: info2 } }));
}

function sendChatMessage(user, payload) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const partner = room.find(u => u.id !== user.id);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ type: 'chat_message', payload: { from: user.anonymousId, text: payload.text, timestamp: Date.now() } }));
  }
}

function sendTyping(user, payload) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const partner = room.find(u => u.id !== user.id);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ type: 'typing', payload: { isTyping: payload.isTyping } }));
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`VOX-BRIDGE API running on port ${PORT}`));
