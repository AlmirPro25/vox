/**
 * ========================================
 * PROST-QS CLIENT - VOX-BRIDGE
 * "Cliente burro: só registra, só pergunta"
 * ========================================
 * 
 * Este cliente NÃO decide nada.
 * Ele apenas:
 * - Registra sessões
 * - Emite eventos de audit
 * - Emite eventos de telemetria (Fase 30)
 * - Pergunta se pode (policy) - FUTURO
 * - Login implícito de usuários
 */

// ========================================
// CONFIGURAÇÃO - OBRIGATÓRIO VIA ENV VARS
// ========================================
// NUNCA hardcode secrets aqui!
// Configure via variáveis de ambiente:
//   PROSTQS_URL=http://localhost:8080
//   PROSTQS_APP_KEY=pq_pk_xxx
//   PROSTQS_APP_SECRET=pq_sk_xxx
// ========================================

const PROSTQS_URL = process.env.PROSTQS_URL;
const PROSTQS_APP_KEY = process.env.PROSTQS_APP_KEY;
const PROSTQS_APP_SECRET = process.env.PROSTQS_APP_SECRET;
const APP_ID = process.env.PROSTQS_APP_ID || 'c573e4f0-a738-400c-a6bc-d890360a0057';

// Validar configuração obrigatória
if (!PROSTQS_URL || !PROSTQS_APP_KEY || !PROSTQS_APP_SECRET) {
  console.warn('⚠️ PROST-QS: Configuração incompleta. Defina PROSTQS_URL, PROSTQS_APP_KEY e PROSTQS_APP_SECRET');
} else {
  console.log(`✅ PROST-QS Config: URL=${PROSTQS_URL}, APP_ID=${APP_ID}, KEY=${PROSTQS_APP_KEY?.substring(0, 15)}...`);
}

// Buffer de eventos para batch (evita muitas requests)
let eventBuffer = [];
let flushTimeout = null;
const FLUSH_INTERVAL = 5000; // 5 segundos
const MAX_BUFFER_SIZE = 50;

// ========================================
// TELEMETRY - Fase 30
// "Apps não calculam. Apps emitem. O kernel observa."
// ========================================

/**
 * Emite um evento de telemetria semântico
 * @param {string} type - Tipo do evento (session.start, interaction.match.created, etc)
 * @param {string} userId - ID do usuário
 * @param {string} sessionId - ID da sessão
 * @param {object} options - Opções adicionais
 */
async function emitTelemetry(type, userId, sessionId, options = {}) {
  if (!PROSTQS_URL || !PROSTQS_APP_KEY || !PROSTQS_APP_SECRET) {
    return null;
  }

  try {
    const event = {
      user_id: userId,
      session_id: sessionId,
      type,
      feature: options.feature || '',
      target_id: options.targetId || '',
      target_type: options.targetType || '',
      context: options.context || {},
      metadata: options.metadata || {},
      timestamp: new Date().toISOString()
    };

    const response = await fetch(`${PROSTQS_URL}/api/v1/telemetry/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Prost-App-Key': PROSTQS_APP_KEY,
        'X-Prost-App-Secret': PROSTQS_APP_SECRET
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ PROST-QS Telemetry: ${type} failed: HTTP ${response.status} - ${text}`);
      return null;
    }

    console.log(`📊 PROST-QS Telemetry: ${type} sent for user ${userId}`);
    return await response.json();
  } catch (error) {
    console.error(`❌ PROST-QS Telemetry error:`, error.message);
    return null;
  }
}

// ========================================
// TELEMETRY EVENTS PRÉ-DEFINIDOS
// ========================================

// Sessão
function telemetrySessionStart(userId, sessionId, context = {}) {
  return emitTelemetry('session.start', userId, sessionId, { context });
}

function telemetrySessionPing(userId, sessionId, feature = '') {
  return emitTelemetry('session.ping', userId, sessionId, { feature });
}

function telemetrySessionEnd(userId, sessionId, duration = 0) {
  return emitTelemetry('session.end', userId, sessionId, { metadata: { duration_ms: duration } });
}

// Session Recover - reconexão sem inflar métricas
function telemetrySessionRecover(userId, sessionId, context = {}) {
  return emitTelemetry('session.recover', userId, sessionId, { context });
}

// Navegação
function telemetryFeatureEnter(userId, sessionId, feature, context = {}) {
  return emitTelemetry('nav.feature.enter', userId, sessionId, { feature, context });
}

function telemetryFeatureLeave(userId, sessionId, feature) {
  return emitTelemetry('nav.feature.leave', userId, sessionId, { feature });
}

// Interações
function telemetryMatchCreated(userId, sessionId, roomId, partnerId) {
  return emitTelemetry('interaction.match.created', userId, sessionId, {
    feature: 'video_chat',
    targetId: partnerId,
    targetType: 'user',
    context: { room_id: roomId }
  });
}

function telemetryMatchEnded(userId, sessionId, roomId, duration, reason) {
  return emitTelemetry('interaction.match.ended', userId, sessionId, {
    feature: 'video_chat',
    context: { room_id: roomId },
    metadata: { duration_ms: duration, reason }
  });
}

function telemetryQueueJoined(userId, sessionId, context = {}) {
  return emitTelemetry('interaction.queue.joined', userId, sessionId, {
    feature: 'queue',
    context
  });
}

function telemetryQueueLeft(userId, sessionId) {
  return emitTelemetry('interaction.queue.left', userId, sessionId, { feature: 'queue' });
}

function telemetrySkip(userId, sessionId, roomId, duration) {
  return emitTelemetry('interaction.skip', userId, sessionId, {
    feature: 'video_chat',
    context: { room_id: roomId },
    metadata: { duration_ms: duration }
  });
}

function telemetryMessageSent(userId, sessionId, roomId) {
  return emitTelemetry('interaction.message.sent', userId, sessionId, {
    feature: 'chat',
    context: { room_id: roomId }
  });
}

// Erros
function telemetryICEFailure(userId, sessionId, roomId, errorType) {
  return emitTelemetry('error.ice_failure', userId, sessionId, {
    feature: 'video_chat',
    context: { room_id: roomId },
    metadata: { error_type: errorType }
  });
}

// ========================================
// IMPLICIT LOGIN - Fase 29
// "Login invisível: usuário nem percebe"
// ========================================

/**
 * Faz login implícito no PROST-QS
 * Cria ou recupera usuário e retorna JWT
 * @param {object} userData - Dados do usuário
 * @returns {Promise<{user_id: string, token: string, is_new_user: boolean}>}
 */
async function implicitLogin(userData) {
  if (!PROSTQS_URL || !PROSTQS_APP_KEY || !PROSTQS_APP_SECRET) {
    console.warn('⚠️ PROST-QS: Configuração incompleta para implicit login');
    return null;
  }

  try {
    const response = await fetch(`${PROSTQS_URL}/api/v1/identity/implicit-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Prost-App-Key': PROSTQS_APP_KEY,
        'X-Prost-App-Secret': PROSTQS_APP_SECRET
      },
      body: JSON.stringify({
        name: userData.name,
        email: userData.email || '',
        age: userData.age || 0,
        gender: userData.gender || '',
        metadata: userData.metadata || {}
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('❌ PROST-QS implicit login failed:', response.status, text);
      return null;
    }

    const data = await response.json();
    console.log(`✅ PROST-QS: User ${data.is_new_user ? 'created' : 'found'}: ${data.user_id}`);
    return data;
  } catch (error) {
    console.error('❌ PROST-QS implicit login error:', error.message);
    return null;
  }
}

/**
 * Emite um evento de audit para o PROST-QS
 * @param {string} type - Tipo do evento (SESSION_STARTED, MATCH_CREATED, etc)
 * @param {object} data - Dados do evento
 */
async function emitEvent(type, data) {
  const event = {
    type,
    app_id: APP_ID,
    actor_id: data.session_id || data.actor_id || 'system',
    actor_type: data.actor_type || 'anonymous_user',
    target_id: data.target_id || data.session_id || 'unknown',
    target_type: data.target_type || 'session',
    action: type.toLowerCase(),
    metadata: JSON.stringify(data.metadata || {}),
    ip: data.ip || '',
    user_agent: data.user_agent || '',
    timestamp: new Date().toISOString()
  };

  // Adicionar ao buffer
  eventBuffer.push(event);

  // Flush se buffer cheio
  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    await flushEvents();
  } else if (!flushTimeout) {
    // Agendar flush
    flushTimeout = setTimeout(flushEvents, FLUSH_INTERVAL);
  }
}

/**
 * Envia eventos em batch para o PROST-QS
 */
async function flushEvents() {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (eventBuffer.length === 0) return;

  const events = [...eventBuffer];
  eventBuffer = [];

  try {
    // Enviar cada evento individualmente (API atual não suporta batch)
    for (const event of events) {
      await sendAuditEvent(event);
    }
    console.log(`📊 PROST-QS: ${events.length} eventos enviados`);
  } catch (error) {
    console.error('❌ PROST-QS: Erro ao enviar eventos:', error.message);
    // Re-adicionar eventos ao buffer em caso de erro
    eventBuffer = [...events, ...eventBuffer].slice(0, MAX_BUFFER_SIZE * 2);
  }
}

/**
 * Envia um evento de audit individual
 */
async function sendAuditEvent(event) {
  try {
    console.log(`📤 PROST-QS: Enviando evento ${event.type} para ${PROSTQS_URL}/api/v1/apps/events`);
    
    const response = await fetch(`${PROSTQS_URL}/api/v1/apps/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Prost-App-Key': PROSTQS_APP_KEY,
        'X-Prost-App-Secret': PROSTQS_APP_SECRET
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ PROST-QS: Evento ${event.type} falhou: HTTP ${response.status} - ${text}`);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const result = await response.json();
    console.log(`✅ PROST-QS: Evento ${event.type} registrado com sucesso`);
    return result;
  } catch (error) {
    console.error(`❌ PROST-QS: Erro ao enviar evento ${event.type}:`, error.message);
    return null;
  }
}

// ========================================
// EVENTOS PRÉ-DEFINIDOS
// ========================================

/**
 * Registra início de sessão
 */
function sessionStarted(sessionId, ip, userAgent, country) {
  return emitEvent('SESSION_STARTED', {
    session_id: sessionId,
    ip,
    user_agent: userAgent,
    metadata: {
      country,
      connected_at: Date.now()
    }
  });
}

/**
 * Registra entrada na fila
 */
function queueJoined(sessionId, nativeLanguage, targetLanguage, interests) {
  return emitEvent('QUEUE_JOINED', {
    session_id: sessionId,
    target_type: 'queue',
    metadata: {
      native_language: nativeLanguage,
      target_language: targetLanguage,
      interests,
      joined_at: Date.now()
    }
  });
}

/**
 * Registra match criado
 */
function matchCreated(roomId, session1Id, session2Id) {
  return emitEvent('MATCH_CREATED', {
    session_id: session1Id,
    target_id: roomId,
    target_type: 'room',
    metadata: {
      room_id: roomId,
      partner_session_id: session2Id,
      created_at: Date.now()
    }
  });
}

/**
 * Registra match encerrado
 */
function matchEnded(roomId, sessionId, duration, reason) {
  return emitEvent('MATCH_ENDED', {
    session_id: sessionId,
    target_id: roomId,
    target_type: 'room',
    metadata: {
      room_id: roomId,
      duration_ms: duration,
      reason, // 'user_left', 'partner_left', 'timeout', 'error'
      ended_at: Date.now()
    }
  });
}

/**
 * Registra skip rápido (< 10s) - possível comportamento suspeito
 */
function skipFast(sessionId, roomId, duration) {
  return emitEvent('SKIP_FAST', {
    session_id: sessionId,
    target_id: roomId,
    target_type: 'room',
    metadata: {
      duration_ms: duration,
      skipped_at: Date.now()
    }
  });
}

/**
 * Registra uso de tradução
 */
function translationUsed(sessionId, fromLang, toLang, charCount) {
  return emitEvent('TRANSLATION_USED', {
    session_id: sessionId,
    target_type: 'translation',
    metadata: {
      from_language: fromLang,
      to_language: toLang,
      char_count: charCount,
      used_at: Date.now()
    }
  });
}

/**
 * Registra desconexão abrupta
 */
function disconnectAbrupt(sessionId, wasInRoom, roomId) {
  return emitEvent('DISCONNECT_ABRUPT', {
    session_id: sessionId,
    target_id: roomId || sessionId,
    target_type: wasInRoom ? 'room' : 'session',
    metadata: {
      was_in_room: wasInRoom,
      room_id: roomId,
      disconnected_at: Date.now()
    }
  });
}

/**
 * Registra falha de ICE (WebRTC)
 */
function iceFailure(sessionId, roomId, errorType) {
  return emitEvent('ICE_FAILURE', {
    session_id: sessionId,
    target_id: roomId,
    target_type: 'room',
    metadata: {
      error_type: errorType,
      failed_at: Date.now()
    }
  });
}

/**
 * Registra fim de sessão
 */
function sessionEnded(sessionId, duration, matchCount, skipCount) {
  return emitEvent('SESSION_ENDED', {
    session_id: sessionId,
    metadata: {
      duration_ms: duration,
      match_count: matchCount,
      skip_count: skipCount,
      ended_at: Date.now()
    }
  });
}

// ========================================
// HEALTH CHECK
// ========================================

/**
 * Verifica se o PROST-QS está acessível
 */
async function healthCheck() {
  try {
    const response = await fetch(`${PROSTQS_URL}/health`);
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Core
  emitEvent,
  flushEvents,
  healthCheck,
  
  // Implicit Login - Fase 29
  implicitLogin,
  
  // Telemetry - Fase 30
  emitTelemetry,
  telemetrySessionStart,
  telemetrySessionPing,
  telemetrySessionEnd,
  telemetrySessionRecover,
  telemetryFeatureEnter,
  telemetryFeatureLeave,
  telemetryMatchCreated,
  telemetryMatchEnded,
  telemetryQueueJoined,
  telemetryQueueLeft,
  telemetrySkip,
  telemetryMessageSent,
  telemetryICEFailure,
  
  // Eventos pré-definidos (legacy audit)
  sessionStarted,
  queueJoined,
  matchCreated,
  matchEnded,
  skipFast,
  translationUsed,
  disconnectAbrupt,
  iceFailure,
  sessionEnded,
  
  // Config
  APP_ID,
  PROSTQS_URL
};
