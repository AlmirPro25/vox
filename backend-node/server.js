// Load environment variables
require('dotenv').config({ path: '../.env' });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// PROST-QS INTEGRATION - Governance Layer
// ============================================================================
const prostqs = require('./prostqs-client');

// ============================================================================
// PERSISTENCE + SOCIAL LAYER
// ============================================================================
const db = require('./db');
const social = require('./social');

// ============================================================================
// VOX-BRIDGE SIGNALING SERVER v2.1 - PRODUCTION READY + PROST-QS
// ============================================================================
// MELHORIAS:
// 1. Garbage collection de peers mortos
// 2. Timeout de negociação WebRTC (15s)
// 3. Validação de mensagens WebRTC
// 4. Room expiration (30 min)
// 5. Heartbeat obrigatório
// 6. Métricas de ICE failure
// 7. Identidade persistente + grafo social real (SQLite)
// 8. Moderação real (report/block) aplicada no matchmaking
// ============================================================================

const app = express();

// ----------------------------------------------------------------------------
// CORS — allowlist via env (ALLOWED_ORIGINS="https://a.com,https://b.com").
// Em dev, sem a env, libera localhost. NUNCA usar "*" em produção.
// ----------------------------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const DEV_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin / curl / mobile apps (no Origin header)
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin);
  // No allowlist configured -> dev mode: allow local network origins only
  return DEV_ORIGIN_REGEX.test(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '64kb' }));

const server = http.createServer(app);
// Limite de payload: 12 MB binário ≈ 16 MB em base64, + sobrecarga JSON/metadata.
// Sem isso, o padrão da lib 'ws' (1 MiB) derruba a conexão ao enviar mídia.
const WS_MAX_PAYLOAD = 20 * 1024 * 1024; // 20 MB (margem segura sobre os 16 MB base64)
const wss = new WebSocket.Server({
  server,
  maxPayload: WS_MAX_PAYLOAD,
  // Reject WS upgrades from disallowed origins (browser-enforced; defense in depth)
  verifyClient(info, done) {
    const origin = info.origin || info.req.headers.origin;
    if (isOriginAllowed(origin)) return done(true);
    console.warn(`⛔ WS upgrade rejected from origin: ${origin}`);
    return done(false, 403, 'Forbidden origin');
  },
});

// Estado em memória
const users = new Map();
const queue = [];
const rooms = new Map();
const rateLimits = new Map();
const recentPairs = new Map();
const REMATCH_COOLDOWN = 5 * 60 * 1000;

// Configurações
const CONFIG = {
  HEARTBEAT_INTERVAL: 30000,      // 30s - intervalo de ping
  HEARTBEAT_TIMEOUT: 45000,       // 45s - timeout sem pong
  ROOM_TIMEOUT: 30 * 60 * 1000,   // 30 min - room expira
  NEGOTIATION_TIMEOUT: 15000,     // 15s - timeout de negociação
  QUEUE_TIMEOUT: 45000,           // 45s - evita busca "infinita" quando só há uma pessoa
};

// Rate limiting
const RATE_LIMITS = {
  chat_message: { max: 10, window: 5000 },
  media_message: { max: 6, window: 10000 },
  join_queue: { max: 5, window: 10000 },
  next_match: { max: 5, window: 10000 },
  typing: { max: 20, window: 5000 },
  webrtc_ice: { max: 100, window: 10000 },
  webrtc_offer: { max: 5, window: 10000 },
  webrtc_answer: { max: 5, window: 10000 },
  // Social / moderation
  friend_request: { max: 20, window: 60000 },
  friend_request_respond: { max: 40, window: 60000 },
  friend_remove: { max: 30, window: 60000 },
  get_friends: { max: 30, window: 10000 },
  get_discovery: { max: 30, window: 10000 },
  report_user: { max: 10, window: 60000 },
  block_user: { max: 20, window: 60000 },
  update_languages: { max: 20, window: 60000 },
  update_interests: { max: 20, window: 60000 },
};

// Métricas
const metrics = {
  totalConnections: 0,
  totalMatches: 0,
  iceFailures: 0,
  negotiationTimeouts: 0,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
  return record.count <= limit.max;
}

function generateAnonId() {
  const adjectives = ['Swift', 'Bright', 'Cool', 'Wild', 'Calm', 'Bold', 'Wise', 'Free', 'Quick', 'Sharp'];
  const nouns = ['Fox', 'Wolf', 'Bear', 'Eagle', 'Lion', 'Tiger', 'Hawk', 'Owl', 'Panda', 'Falcon'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.slice(0, 1000).replace(/[<>]/g, '');
}

// Validar payload WebRTC
function isValidWebRTCPayload(type, payload) {
  if (!payload) return false;
  
  if (type === 'webrtc_offer' || type === 'webrtc_answer') {
    return payload.sdp && typeof payload.sdp === 'object' && payload.sdp.type && payload.sdp.sdp;
  }
  
  if (type === 'webrtc_ice') {
    return payload.candidate && typeof payload.candidate === 'object';
  }
  
  return true;
}

// Enviar mensagem segura
function safeSend(ws, type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (e) {
      console.error('Send error:', e.message);
    }
  }
  return false;
}

// ============================================================================
// GARBAGE COLLECTION - Limpar recursos órfãos
// ============================================================================

// Limpar rate limits antigos
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now - record.start > 60000) rateLimits.delete(key);
  }
}, 30000);

// Limpar rooms expiradas
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > CONFIG.ROOM_TIMEOUT) {
      console.log(`🗑️ Room expired: ${roomId}`);
      room.users.forEach(u => {
        if (u) {
          safeSend(u.ws, 'room_expired', {});
          u.roomId = null;
        }
      });
      rooms.delete(roomId);
    }
  }
}, 60000);

// Limpar usuários na fila há muito tempo
setInterval(() => {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const user = queue[i];
    if (now - (user.queueJoinTime || now) > CONFIG.QUEUE_TIMEOUT) {
      console.log(`🗑️ Queue timeout: ${user.anonymousId}`);
      queue.splice(i, 1);
      safeSend(user.ws, 'queue_timeout', {});
    }
  }
}, 5000);

// Verificar heartbeat de todos os usuários
setInterval(() => {
  const now = Date.now();
  for (const [id, user] of users.entries()) {
    if (now - user.lastPong > CONFIG.HEARTBEAT_TIMEOUT) {
      console.log(`💀 Heartbeat timeout: ${user.anonymousId}`);
      user.ws.terminate();
    }
  }
}, CONFIG.HEARTBEAT_INTERVAL);

// ============================================================================
// HTTP ENDPOINTS
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(), 
    users: users.size, 
    queue: queue.length,
    rooms: rooms.size,
    uptime: process.uptime(),
    metrics
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'VOX-BRIDGE API v2.0', online: social.onlineAccountCount() });
});

app.get('/stats', (req, res) => {
  res.json({
    online: social.onlineAccountCount(),
    connections: users.size,
    inQueue: queue.length,
    activeRooms: rooms.size,
    uptime: Math.floor(process.uptime()),
    metrics
  });
});

// ========================================
// IMPLICIT LOGIN - Fase 29
// "Login invisível: usuário nem percebe"
// ========================================
app.post('/auth/implicit-login', async (req, res) => {
  const { name, email, age, gender, preference, callMode } = req.body;
  
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Nome é obrigatório (mínimo 2 caracteres)' });
  }

  try {
    // Chamar PROST-QS para criar/recuperar usuário
    const result = await prostqs.implicitLogin({
      name,
      email: email || '',
      age: age || 0,
      gender: gender || '',
      metadata: {
        preference: preference || '',
        call_mode: callMode || 'random',
        source: 'vox-bridge'
      }
    });

    if (!result) {
      // Fallback: gerar ID local se PROST-QS não disponível
      const localId = uuidv4();
      console.log(`⚠️ PROST-QS indisponível, usando ID local: ${localId}`);
      return res.json({
        user_id: localId,
        token: null,
        is_new_user: true,
        local_only: true
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Implicit login error:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// ============================================================================
// TURN CREDENTIALS - VOXGRID SOVEREIGN INFRASTRUCTURE
// ============================================================================
// ARQUITETURA:
// 1. OPÇÃO SOBERANA: Coturn próprio em 3 continentes (Brasil, Europa, África)
// 2. OPÇÃO MANAGED: Metered.ca como fallback
// 3. TCP primeiro = atravessa firewalls africanos com mais sucesso
// 4. Credenciais temporárias HMAC para segurança
// ============================================================================
app.get('/turn-credentials', (req, res) => {
  const crypto = require('crypto');
  
  // ========================================
  // OPÇÃO 1: INFRAESTRUTURA SOBERANA (PRIORIDADE)
  // Coturn próprio em múltiplos continentes
  // ========================================
  const TURN_SECRET = process.env.TURN_SECRET;
  const TURN_SERVERS = process.env.TURN_SERVERS; // Formato: "turn-br.domain.com,turn-eu.domain.com,turn-af.domain.com"
  
  if (TURN_SECRET && TURN_SERVERS) {
    // Gerar credenciais temporárias HMAC (24h de validade)
    const ttl = 86400; // 24 horas
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}`;
    
    const hmac = crypto
      .createHmac('sha1', TURN_SECRET)
      .update(username)
      .digest('base64');
    
    // Parsear servidores
    const servers = TURN_SERVERS.split(',').map(s => s.trim());
    
    // Gerar configuração para cada servidor
    // TCP primeiro (melhor para firewalls africanos/corporativos)
    const turnServers = servers.map(server => ({
      urls: [
        `turn:${server}:3478?transport=tcp`,   // TCP primeiro
        `turn:${server}:3478`,                  // UDP
        `turns:${server}:5349?transport=tcp`   // TLS TCP (se configurado)
      ],
      username,
      credential: hmac
    }));
    
    console.log(`🌐 VOXGRID SOVEREIGN: ${servers.length} servidores próprios (TTL: ${ttl}s)`);
    return res.json(turnServers);
  }
  
  // ========================================
  // OPÇÃO 2: METERED.CA (Fallback gerenciado)
  // ========================================
  const METERED_API_KEY = process.env.METERED_API_KEY;
  const METERED_API_SECRET = process.env.METERED_API_SECRET;
  
  if (METERED_API_KEY && METERED_API_SECRET) {
    const turnServers = [
      {
        urls: [
          'turns:global.relay.metered.ca:443?transport=tcp',
          'turn:global.relay.metered.ca:443',
          'turn:global.relay.metered.ca:80'
        ],
        username: METERED_API_KEY,
        credential: METERED_API_SECRET
      }
    ];
    
    console.log(`🌐 VOXGRID: Metered.ca fallback (API key: ${METERED_API_KEY.substring(0, 8)}...)`);
    return res.json(turnServers);
  }
  
  // ========================================
  // OPÇÃO 3: TURN ÚNICO (Legacy)
  // ========================================
  const TURN_URL = process.env.TURN_URL;
  
  if (TURN_SECRET && TURN_URL) {
    const ttl = 300;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}`;
    
    const hmac = crypto
      .createHmac('sha1', TURN_SECRET)
      .update(username)
      .digest('base64');
    
    console.log(`🔐 TURN único: ${TURN_URL} (TTL: ${ttl}s)`);
    return res.json([{ 
      urls: [
        `turn:${TURN_URL}:3478?transport=tcp`,
        `turn:${TURN_URL}:3478`
      ], 
      username, 
      credential: hmac 
    }]);
  }
  
  // ========================================
  // OPÇÃO 4: Fallback APENAS-STUN (DEV)
  // Sem TURN configurado: retorna só STUN público.
  // P2P direto funciona na maioria das redes domésticas, mas NÃO atravessa
  // NAT restritivo/firewalls corporativos. Configure TURN para produção.
  // (Nenhuma credencial fica embutida no código.)
  // ========================================
  console.warn('⚠️ VOXGRID: Nenhum TURN configurado - retornando apenas STUN (configure TURN_SECRET/TURN_SERVERS ou METERED_* para produção)');
  res.json([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);
});

// ============================================================================
// WEBSOCKET HANDLING
// ============================================================================

wss.on('connection', (ws, req) => {
  const id = uuidv4();
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // Verificar se é reconexão (session_id na query string)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const previousSessionId = url.searchParams.get('session_id');
  const sessionId = previousSessionId || uuidv4();
  const isReconnect = !!previousSessionId;

  // ----------------------------------------------------------------------------
  // PERSISTENT IDENTITY
  // The client sends ?token=<persistent>. Unknown/absent token => new account.
  // The account (id, handle, prefs, social graph) survives reconnects & restarts.
  // ----------------------------------------------------------------------------
  const providedToken = url.searchParams.get('token');
  let account;
  try {
    account = db.findOrCreateUser({ token: providedToken });
  } catch (err) {
    console.error('Identity error:', err.message);
    ws.close(1011, 'identity_error');
    return;
  }
  const isNewAccount = account.token !== providedToken;
  const visibleName = account.display_name || account.handle;

  const user = { 
    id, 
    accountId: account.id,       // persistent account id (used for social graph)
    handle: account.handle,      // stable handle
    sessionId, // Session ID para telemetria (pode ser recuperado)
    ws, 
    ip,
    userAgent,
    anonymousId: visibleName,    // visible name (displayName or stable handle)
    nativeLanguage: account.native_language || 'pt', 
    targetLanguage: account.target_language || 'en', 
    interests: (() => { try { return JSON.parse(account.interests || '[]'); } catch { return []; } })(), 
    country: account.country || 'BR', 
    roomId: null,
    connectedAt: Date.now(),
    lastPong: Date.now(),
    negotiationStarted: null,
    matchCount: 0,
    skipCount: 0,
    isReconnect,
  };
  
  users.set(id, user);
  metrics.totalConnections++;

  // Registrar presença (para amigos online / discovery)
  social.registerPresence(user);
  db.touchLastSeen(account.id);

  // 📊 PROST-QS: Registrar início de sessão (audit legacy)
  prostqs.sessionStarted(id, ip, userAgent, user.country);
  
  // 📊 PROST-QS TELEMETRY: Sessão iniciada ou recuperada (Fase 30)
  if (isReconnect) {
    // Tentar recuperar sessão existente
    prostqs.telemetrySessionRecover(id, sessionId, {
      ip,
      user_agent: userAgent,
      country: user.country,
      anonymous_id: user.anonymousId
    });
    console.log(`🔄 Reconnected: ${user.anonymousId} (session recovered: ${sessionId.substring(0, 8)}...)`);
  } else {
    // Nova sessão
    prostqs.telemetrySessionStart(id, sessionId, {
      ip,
      user_agent: userAgent,
      country: user.country,
      anonymous_id: user.anonymousId
    });
    console.log(`👤 Connected: ${user.anonymousId} (${users.size} online)`);
  }

  safeSend(ws, 'connected', { 
    userId: account.id,          // persistent account id
    accountId: account.id,
    token: account.token,        // client stores this for future reconnects
    handle: account.handle,
    isNewAccount,
    sessionId, // Enviar sessionId para o cliente guardar
    anonymousId: user.anonymousId, 
    online: social.onlineAccountCount(),
    isReconnect 
  });

  // Enviar lista de amigos + pedidos pendentes logo após conectar
  safeSend(ws, 'friends_list', social.buildFriendsPayload(account.id));

  // Notificar amigos online que este usuário ficou online
  notifyFriendsPresence(account.id, true);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Rate limiting
      if (RATE_LIMITS[msg.type] && !checkRateLimit(id, msg.type)) {
        if (msg.type === 'media_message') {
          safeSend(ws, 'media_error', {
            error: 'rate_limited',
            clientId: sanitizeText(msg.payload?.clientId || ''),
          });
        }
        return;
      }
      
      handleMessage(user, msg);
    } catch (e) { 
      console.error('Parse error:', e.message); 
    }
  });

  ws.on('close', () => {
    console.log(`👤 Disconnected: ${user.anonymousId} (${users.size - 1} online)`);
    
    // 📊 PROST-QS: Registrar fim de sessão (audit legacy)
    const duration = Date.now() - user.connectedAt;
    prostqs.sessionEnded(user.id, duration, user.matchCount || 0, user.skipCount || 0);
    
    // 📊 PROST-QS TELEMETRY: Sessão encerrada (Fase 30)
    prostqs.telemetrySessionEnd(user.id, user.sessionId, duration);
    
    // Se estava em sala, registrar desconexão abrupta
    if (user.roomId) {
      prostqs.disconnectAbrupt(user.id, true, user.roomId);
    }
    
    handleDisconnect(user);
    users.delete(id);

    // Presença: remover esta conexão; se foi a última, avisar amigos que ficou offline
    social.unregisterPresence(user);
    if (user.accountId && !social.isOnline(user.accountId)) {
      notifyFriendsPresence(user.accountId, false);
    }
  });

  ws.on('error', (err) => {
    // Payload excedido: o cliente tentou enviar mídia maior que o limite.
    // Em vez de derrubar silenciosamente, envia feedback estruturado.
    if (err && /payload too big|invalid WebSocket frame|exceeds/i.test(err.message)) {
      console.warn(`⚠️ WS payload exceeded from ${user.anonymousId || user.id}: ${err.message}`);
      safeSend(ws, 'media_error', { error: 'file_too_large', maxBytes: 12 * 1024 * 1024 });
      return;
    }
    console.error('WS error:', err.message);
  });
  
  // Ping periódico do servidor
  ws.on('pong', () => {
    user.lastPong = Date.now();
  });
});

// Ping todos os clientes periodicamente
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, CONFIG.HEARTBEAT_INTERVAL);

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

function handleMessage(user, msg) {
  // Atualizar lastPong em qualquer mensagem
  user.lastPong = Date.now();
  
  switch (msg.type) {
    case 'ping': 
      safeSend(user.ws, 'pong', { online: social.onlineAccountCount(), queue: queue.length });
      
      // 📊 PROST-QS TELEMETRY: Heartbeat/ping (Fase 30)
      // Envia ping de presença a cada ping do cliente
      prostqs.telemetrySessionPing(user.id, user.sessionId, user.roomId ? 'video_chat' : (queue.find(q => q.id === user.id) ? 'queue' : 'lobby'));
      break;
    case 'join_queue': 
      joinQueue(user, msg.payload); 
      break;
    case 'leave_queue': 
      leaveQueue(user);
      
      // 📊 PROST-QS TELEMETRY: Saiu da fila (Fase 30)
      prostqs.telemetryQueueLeft(user.id, user.sessionId);
      break;
    case 'chat_message': 
      sendChatMessage(user, msg.payload);
      
      // 📊 PROST-QS TELEMETRY: Mensagem enviada (Fase 30)
      if (user.roomId) {
        prostqs.telemetryMessageSent(user.id, user.sessionId, user.roomId);
      }
      break;
    case 'media_message':
      sendMediaMessage(user, msg.payload);
      break;
    case 'typing': 
      sendTyping(user, msg.payload); 
      break;
    case 'leave_room': 
      leaveRoom(user); 
      break;
    case 'next_match':
      moveRoomToNext(user);
      break;
    case 'webrtc_offer': 
    case 'webrtc_answer': 
    case 'webrtc_ice': 
      forwardWebRTC(user, msg.type, msg.payload); 
      break;
    case 'ice_failure':
      // Métrica de falha ICE
      metrics.iceFailures++;
      console.log(`❄️ ICE failure reported by ${user.anonymousId}`);
      
      // 📊 PROST-QS: Registrar falha ICE (audit legacy)
      prostqs.iceFailure(user.id, user.roomId, 'ice_connection_failed');
      
      // 📊 PROST-QS TELEMETRY: Falha ICE (Fase 30)
      prostqs.telemetryICEFailure(user.id, user.sessionId, user.roomId, 'ice_connection_failed');
      break;

    // ========================================================================
    // SOCIAL
    // ========================================================================
    case 'get_friends':
      safeSend(user.ws, 'friends_list', social.buildFriendsPayload(user.accountId));
      break;
    case 'get_discovery':
      safeSend(user.ws, 'discovery_list', { users: social.buildDiscovery(user.accountId) });
      break;
    case 'friend_request':
      handleFriendRequest(user, msg.payload);
      break;
    case 'friend_request_respond':
      handleFriendRequestRespond(user, msg.payload);
      break;
    case 'friend_remove':
      handleFriendRemove(user, msg.payload);
      break;
    case 'update_languages':
      handleUpdateLanguages(user, msg.payload);
      break;
    case 'update_interests':
      handleUpdateInterests(user, msg.payload);
      break;

    // ========================================================================
    // MODERATION
    // ========================================================================
    case 'report_user':
      handleReportUser(user, msg.payload);
      break;
    case 'block_user':
      handleBlockUser(user, msg.payload);
      break;
  }
}

// ============================================================================
// SOCIAL & MODERATION HANDLERS
// ============================================================================

// Notify all online friends of an account about its presence change
function notifyFriendsPresence(accountId, online) {
  const friends = db.getFriends(accountId);
  for (const friend of friends) {
    social.sendToAccount(friend.id, 'friend_presence', { friendId: accountId, online }, safeSend);
  }
}

function handleFriendRequest(user, payload) {
  const toAccountId = payload && typeof payload.toUserId === 'string' ? payload.toUserId : null;
  if (!toAccountId) return;

  const result = social.sendFriendRequest(user, toAccountId);
  if (!result.ok) {
    safeSend(user.ws, 'friend_error', { action: 'friend_request', error: result.error });
    return;
  }

  // Mutual request -> instantly became friends
  if (result.becameFriends || result.alreadyFriends) {
    safeSend(user.ws, 'friends_list', social.buildFriendsPayload(user.accountId));
    if (result.friendId) {
      social.sendToAccount(result.friendId, 'friends_list', social.buildFriendsPayload(result.friendId), safeSend);
      social.sendToAccount(result.friendId, 'friend_request_accepted', {
        friend: db.publicUser(db.getUserById(user.accountId), { online: true }),
      }, safeSend);
    }
    return;
  }

  // Pending request created -> notify recipient if online
  const fromPublic = db.publicUser(db.getUserById(user.accountId), {
    online: true,
    requestId: result.request.id,
    requestedAt: result.request.created_at,
  });
  social.sendToAccount(toAccountId, 'friend_request_received', { request: fromPublic }, safeSend);
  safeSend(user.ws, 'friend_request_sent', { toUserId: toAccountId });
}

function handleFriendRequestRespond(user, payload) {
  const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : null;
  const accept = !!(payload && payload.accept);
  if (!requestId) return;

  const result = social.respondFriendRequest(user, requestId, accept);
  if (!result.ok) {
    safeSend(user.ws, 'friend_error', { action: 'friend_request_respond', error: result.error });
    return;
  }

  // Refresh both sides' lists
  safeSend(user.ws, 'friends_list', social.buildFriendsPayload(user.accountId));

  if (result.accepted) {
    social.sendToAccount(result.fromId, 'friends_list', social.buildFriendsPayload(result.fromId), safeSend);
    social.sendToAccount(result.fromId, 'friend_request_accepted', {
      friend: db.publicUser(db.getUserById(user.accountId), { online: social.isOnline(user.accountId) }),
    }, safeSend);
  }
}

function handleFriendRemove(user, payload) {
  const friendId = payload && typeof payload.friendId === 'string' ? payload.friendId : null;
  if (!friendId) return;

  const result = social.removeFriend(user, friendId);
  if (!result.ok) return;

  safeSend(user.ws, 'friends_list', social.buildFriendsPayload(user.accountId));
  social.sendToAccount(friendId, 'friends_list', social.buildFriendsPayload(friendId), safeSend);
}

function handleUpdateLanguages(user, payload) {
  if (!payload) return;
  const native = sanitizeText(payload.native_language || payload.nativeLanguage) || user.nativeLanguage;
  const target = sanitizeText(payload.target_language || payload.targetLanguage) || user.targetLanguage;
  user.nativeLanguage = native;
  user.targetLanguage = target;
  db.updatePrefs(user.accountId, { nativeLanguage: native, targetLanguage: target });
}

function handleUpdateInterests(user, payload) {
  if (!payload) return;
  const interests = Array.isArray(payload.interests)
    ? payload.interests.slice(0, 10).map(sanitizeText).filter(Boolean)
    : [];
  user.interests = interests;
  db.updatePrefs(user.accountId, { interests });
}

function handleReportUser(user, payload) {
  if (!payload) return;
  // Resolve the reported account: explicit reportedUserId, or current room partner
  let reportedId = typeof payload.reportedUserId === 'string' ? payload.reportedUserId : null;
  if (!reportedId && user.roomId) {
    const room = rooms.get(user.roomId);
    const partner = room && room.users.find((u) => u.id !== user.id);
    if (partner) reportedId = partner.accountId;
  }

  const result = social.reportUser(user, {
    reportedId,
    roomId: user.roomId,
    reason: sanitizeText(payload.reason),
    details: sanitizeText(payload.details),
  });

  if (result.ok) {
    console.log(`🚩 Report ${result.id} by ${user.handle} against ${reportedId || 'unknown'}`);
    safeSend(user.ws, 'report_ack', { ok: true });
  }
}

function handleBlockUser(user, payload) {
  // Resolve the target account: explicit targetUserId, or current room partner
  let targetId = payload && typeof payload.targetUserId === 'string' ? payload.targetUserId : null;
  if (!targetId && user.roomId) {
    const room = rooms.get(user.roomId);
    const partner = room && room.users.find((u) => u.id !== user.id);
    if (partner) targetId = partner.accountId;
  }
  if (!targetId) return;

  const result = social.blockUser(user, targetId);
  if (!result.ok) return;

  console.log(`🚫 ${user.handle} blocked ${targetId}`);
  safeSend(user.ws, 'block_ack', { ok: true, targetUserId: targetId });
  safeSend(user.ws, 'friends_list', social.buildFriendsPayload(user.accountId));

  // If currently in a room with the blocked user, end it for both
  if (user.roomId) {
    const room = rooms.get(user.roomId);
    const partner = room && room.users.find((u) => u.id !== user.id);
    if (partner && partner.accountId === targetId) {
      leaveRoom(user);
    }
  }
}

function forwardWebRTC(user, type, payload) {
  if (!user.roomId) return;
  
  // Validar payload
  if (!isValidWebRTCPayload(type, payload)) {
    console.log(`⚠️ Invalid ${type} payload from ${user.anonymousId}`);
    return;
  }
  
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const partner = room.users.find(u => u.id !== user.id);
  if (!partner) return;
  
  // Verificar se parceiro ainda está conectado
  if (partner.ws.readyState !== WebSocket.OPEN) {
    console.log(`⚠️ Partner disconnected, cleaning room`);
    leaveRoom(user);
    return;
  }
  
  // Timeout de negociação (só para offer)
  if (type === 'webrtc_offer') {
    user.negotiationStarted = Date.now();
    
    // Timeout de 15s para receber answer
    setTimeout(() => {
      if (user.negotiationStarted && Date.now() - user.negotiationStarted > CONFIG.NEGOTIATION_TIMEOUT) {
        console.log(`⏰ Negotiation timeout for ${user.anonymousId}`);
        metrics.negotiationTimeouts++;
        safeSend(user.ws, 'negotiation_timeout', {});
        user.negotiationStarted = null;
      }
    }, CONFIG.NEGOTIATION_TIMEOUT);
  }
  
  // Limpar timeout ao receber answer
  if (type === 'webrtc_answer') {
    const initiator = room.users.find(u => u.id !== user.id);
    if (initiator) initiator.negotiationStarted = null;
  }
  
  safeSend(partner.ws, type, payload);
}

// ============================================================================
// QUEUE & ROOM MANAGEMENT
// ============================================================================

function pairKey(user1, user2) {
  const id1 = user1.accountId || user1.id;
  const id2 = user2.accountId || user2.id;
  return [id1, id2].sort().join(':');
}

function hasRecentPairCooldown(user1, user2) {
  const key = pairKey(user1, user2);
  const expiresAt = recentPairs.get(key) || 0;
  if (expiresAt <= Date.now()) {
    recentPairs.delete(key);
    return false;
  }
  return true;
}

function joinQueue(user, payload) {
  if (user.roomId) return;
  
  if (payload) {
    user.nativeLanguage = sanitizeText(payload.nativeLanguage) || 'pt';
    user.targetLanguage = sanitizeText(payload.targetLanguage) || 'en';
    user.interests = Array.isArray(payload.interests) ? payload.interests.slice(0, 10).map(sanitizeText) : [];
    user.country = sanitizeText(payload.country) || 'BR';
  }
  
  // Procurar match
  const matchIdx = queue.findIndex(q => {
    if (q.id === user.id) return false;
    if (q.ws.readyState !== WebSocket.OPEN) return false; // Skip dead connections
    if (hasRecentPairCooldown(user, q)) return false;

    // Moderação: nunca casar usuários que se bloquearam (qualquer direção)
    if (user.accountId && q.accountId && db.isBlockedEither(user.accountId, q.accountId)) {
      return false;
    }
    
    // Match perfeito: idiomas complementares
    if (user.targetLanguage === q.nativeLanguage && q.targetLanguage === user.nativeLanguage) {
      return true;
    }
    
    // Match bom: mesmo idioma alvo
    if (user.targetLanguage === q.targetLanguage) return true;
    
    // Fallback após 30s
    const waitTime = Date.now() - (q.queueJoinTime || Date.now());
    return waitTime > 30000;
  });
  
  if (matchIdx >= 0) {
    const partner = queue.splice(matchIdx, 1)[0];
    createRoom(user, partner);
  } else {
    if (!queue.find(q => q.id === user.id)) {
      user.queueJoinTime = Date.now();
      queue.push(user);
      
      // 📊 PROST-QS: Registrar entrada na fila (audit legacy)
      prostqs.queueJoined(user.id, user.nativeLanguage, user.targetLanguage, user.interests);
      
      // 📊 PROST-QS TELEMETRY: Entrou na fila (Fase 30)
      prostqs.telemetryQueueJoined(user.id, user.sessionId, {
        native_language: user.nativeLanguage,
        target_language: user.targetLanguage,
        interests: user.interests
      });
      
      safeSend(user.ws, 'queue_joined', { position: queue.length });
    }
  }
}

function leaveQueue(user) {
  const idx = queue.findIndex(q => q.id === user.id);
  if (idx >= 0) {
    queue.splice(idx, 1);
    safeSend(user.ws, 'queue_left', {});
  }
}

function createRoom(user1, user2) {
  const roomId = uuidv4();
  user1.roomId = roomId;
  user2.roomId = roomId;
  user1.roomJoinedAt = Date.now();
  user2.roomJoinedAt = Date.now();
  user1.matchCount = (user1.matchCount || 0) + 1;
  user2.matchCount = (user2.matchCount || 0) + 1;
  
  const room = {
    id: roomId,
    users: [user1, user2],
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  metrics.totalMatches++;

  // 📊 PROST-QS: Registrar match criado (audit legacy - para ambos)
  prostqs.matchCreated(roomId, user1.id, user2.id);
  prostqs.matchCreated(roomId, user2.id, user1.id);
  
  // 📊 PROST-QS TELEMETRY: Match criado (Fase 30 - para ambos)
  prostqs.telemetryMatchCreated(user1.id, user1.sessionId, roomId, user2.id);
  prostqs.telemetryMatchCreated(user2.id, user2.sessionId, roomId, user1.id);
  
  // 📊 PROST-QS TELEMETRY: Entrou na feature video_chat
  prostqs.telemetryFeatureEnter(user1.id, user1.sessionId, 'video_chat', { room_id: roomId });
  prostqs.telemetryFeatureEnter(user2.id, user2.sessionId, 'video_chat', { room_id: roomId });

  const common = user1.interests.filter(i => user2.interests.includes(i));
  
  // user1 = initiator (impolite), user2 = responder (polite)
  const info1 = { 
    userId: user2.accountId,     // persistent account id (for friend requests)
    odId: user2.anonymousId, 
    handle: user2.handle,
    nativeLanguage: user2.nativeLanguage, 
    country: user2.country, 
    commonInterests: common,
    isInitiator: true,
    alreadyFriend: !!(user1.accountId && user2.accountId && db.areFriends(user1.accountId, user2.accountId)),
  };
  const info2 = { 
    userId: user1.accountId,     // persistent account id (for friend requests)
    odId: user1.anonymousId, 
    handle: user1.handle,
    nativeLanguage: user1.nativeLanguage, 
    country: user1.country, 
    commonInterests: common,
    isInitiator: false,
    alreadyFriend: !!(user1.accountId && user2.accountId && db.areFriends(user1.accountId, user2.accountId)),
  };
  
  console.log(`🎯 Match #${metrics.totalMatches}: ${user1.anonymousId} <-> ${user2.anonymousId}`);
  
  safeSend(user1.ws, 'matched', { roomId, partner: info1 });
  safeSend(user2.ws, 'matched', { roomId, partner: info2 });
}

// ============================================================================
// CHAT & ROOM FUNCTIONS
// ============================================================================

function sendChatMessage(user, payload) {
  if (!user.roomId || !payload?.text) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const text = sanitizeText(payload.text);
  if (!text) return;
  
  const partner = room.users.find(u => u.id !== user.id);
  if (partner) {
    // Persist for moderation/history (best-effort)
    try {
      db.saveMessage({ roomId: user.roomId, fromId: user.accountId, toId: partner.accountId, text });
    } catch { /* non-fatal */ }
    safeSend(partner.ws, 'chat_message', { 
      from: user.anonymousId, 
      text, 
      timestamp: Date.now() 
    });
  }
}

const ALLOWED_MEDIA_TYPES = new Set(['image', 'audio', 'video']);
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

function getDataUrlBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return Infinity;

  const meta = dataUrl.slice(0, commaIndex).toLowerCase();
  const body = dataUrl.slice(commaIndex + 1);
  if (!meta.includes(';base64')) {
    try {
      return Buffer.byteLength(decodeURIComponent(body), 'utf8');
    } catch {
      return Infinity;
    }
  }

  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
}

function sendMediaMessage(user, payload) {
  const clientId = sanitizeText(payload?.clientId || '').slice(0, 120);

  if (!user.roomId) {
    safeSend(user.ws, 'media_error', { error: 'not_in_room', clientId });
    return;
  }

  const room = rooms.get(user.roomId);
  if (!room) {
    safeSend(user.ws, 'media_error', { error: 'room_not_found', clientId });
    return;
  }

  const type = typeof payload?.type === 'string' ? payload.type : '';
  const data = typeof payload?.data === 'string' ? payload.data : '';
  const fileName = sanitizeText(payload?.fileName || 'arquivo');

  if (!ALLOWED_MEDIA_TYPES.has(type) || !data.startsWith('data:')) {
    safeSend(user.ws, 'media_error', { error: 'invalid_media', clientId });
    return;
  }

  if (getDataUrlBytes(data) > MAX_MEDIA_BYTES) {
    safeSend(user.ws, 'media_error', { error: 'file_too_large', maxBytes: MAX_MEDIA_BYTES, clientId });
    return;
  }

  const partner = room.users.find((roomUser) => roomUser.id !== user.id);
  if (!partner || partner.ws.readyState !== WebSocket.OPEN) {
    safeSend(user.ws, 'media_error', { error: 'partner_offline', clientId });
    return;
  }

  const mediaId = uuidv4();
  const timestamp = Date.now();
  const delivered = safeSend(partner.ws, 'media_message', {
    id: mediaId,
    from: user.anonymousId,
    type,
    data,
    fileName: fileName.slice(0, 160),
    clientId,
    timestamp,
  });

  if (delivered) {
    safeSend(user.ws, 'media_delivered', { id: mediaId, clientId, timestamp });
    prostqs.telemetryMessageSent(user.id, user.sessionId, user.roomId);
  } else {
    safeSend(user.ws, 'media_error', { error: 'delivery_failed', clientId });
  }
}

function sendTyping(user, payload) {
  if (!user.roomId) return;
  const room = rooms.get(user.roomId);
  if (!room) return;
  
  const partner = room.users.find(u => u.id !== user.id);
  if (partner) {
    safeSend(partner.ws, 'typing', { isTyping: !!payload?.isTyping });
  }
}

function leaveRoom(user) {
  if (!user.roomId) return;
  
  const roomId = user.roomId;
  const room = rooms.get(roomId);
  
  // 📊 PROST-QS: Calcular duração e registrar
  const duration = Date.now() - (user.roomJoinedAt || Date.now());
  
  // Se duração < 10s, é skip rápido (possível comportamento suspeito)
  if (duration < 10000) {
    user.skipCount = (user.skipCount || 0) + 1;
    prostqs.skipFast(user.id, roomId, duration);
    
    // 📊 PROST-QS TELEMETRY: Skip rápido (Fase 30)
    prostqs.telemetrySkip(user.id, user.sessionId, roomId, duration);
  }
  
  // 📊 PROST-QS: Match encerrado (audit legacy)
  prostqs.matchEnded(roomId, user.id, duration, 'user_left');
  
  // 📊 PROST-QS TELEMETRY: Match encerrado (Fase 30)
  prostqs.telemetryMatchEnded(user.id, user.sessionId, roomId, duration, 'user_left');
  
  // 📊 PROST-QS TELEMETRY: Saiu da feature video_chat
  prostqs.telemetryFeatureLeave(user.id, user.sessionId, 'video_chat');
  
  if (room) {
    const partner = room.users.find(u => u.id !== user.id);
    if (partner) {
      safeSend(partner.ws, 'partner_left', {});
      
      // Registrar para o parceiro também
      const partnerDuration = Date.now() - (partner.roomJoinedAt || Date.now());
      prostqs.matchEnded(roomId, partner.id, partnerDuration, 'partner_left');
      
      // 📊 PROST-QS TELEMETRY: Match encerrado para parceiro (Fase 30)
      prostqs.telemetryMatchEnded(partner.id, partner.sessionId, roomId, partnerDuration, 'partner_left');
      prostqs.telemetryFeatureLeave(partner.id, partner.sessionId, 'video_chat');
      
      partner.roomId = null;
      partner.roomJoinedAt = null;
    }
    rooms.delete(roomId);
  }
  user.roomId = null;
  user.roomJoinedAt = null;
  user.negotiationStarted = null;
}

function moveRoomToNext(user) {
  if (!user.roomId) {
    joinQueue(user);
    return;
  }

  const roomId = user.roomId;
  const room = rooms.get(roomId);
  if (!room) {
    user.roomId = null;
    joinQueue(user);
    return;
  }

  const participants = room.users.filter(Boolean);
  if (participants.length === 2) {
    recentPairs.set(pairKey(participants[0], participants[1]), Date.now() + REMATCH_COOLDOWN);
  }

  rooms.delete(roomId);

  for (const participant of participants) {
    const duration = Date.now() - (participant.roomJoinedAt || Date.now());
    prostqs.matchEnded(roomId, participant.id, duration, 'next_match');
    prostqs.telemetryMatchEnded(participant.id, participant.sessionId, roomId, duration, 'next_match');
    prostqs.telemetryFeatureLeave(participant.id, participant.sessionId, 'video_chat');

    participant.roomId = null;
    participant.roomJoinedAt = null;
    participant.negotiationStarted = null;
    safeSend(participant.ws, 'next_searching', { cooldownMs: REMATCH_COOLDOWN });
  }

  for (const participant of participants) {
    if (participant.ws.readyState === WebSocket.OPEN) joinQueue(participant);
  }
}

function handleDisconnect(user) {
  leaveQueue(user);
  leaveRoom(user);
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  
  // 📊 PROST-QS: Flush eventos pendentes antes de fechar
  await prostqs.flushEvents();
  
  wss.clients.forEach(ws => ws.close());
  db.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  
  // 📊 PROST-QS: Flush eventos pendentes antes de fechar
  await prostqs.flushEvents();
  
  wss.clients.forEach(ws => ws.close());
  db.close();
  server.close(() => process.exit(0));
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 8080;
server.listen(PORT, async () => {
  console.log(`🚀 VOX-BRIDGE API v2.1 running on port ${PORT}`);
  console.log(`📊 Config: heartbeat=${CONFIG.HEARTBEAT_INTERVAL}ms, roomTimeout=${CONFIG.ROOM_TIMEOUT}ms`);
  
  // 📊 PROST-QS: Verificar conexão
  const health = await prostqs.healthCheck();
  if (health.ok) {
    console.log(`✅ PROST-QS connected: ${prostqs.PROSTQS_URL}`);
  } else {
    console.log(`⚠️ PROST-QS not available: ${health.error || 'unknown'}`);
  }
});
