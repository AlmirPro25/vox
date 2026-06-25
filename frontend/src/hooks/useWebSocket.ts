import { useEffect, useRef, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useSound } from '@/hooks/useSound'
import { getWebSocketUrl } from '@/lib/runtimeUrls'

// ============================================================================
// WEBSOCKET HOOK - PRODUCTION READY + SESSION RECOVERY
// ============================================================================
// CORREÇÕES APLICADAS:
// 1. NÃO fechar socket no heartbeat (deixa TCP/servidor decidir)
// 2. Heartbeat gentil (30s interval, 90s timeout)
// 3. Reconectar só em erro real (não em close normal)
// 4. Session recovery via sessionId persistido em localStorage
// ============================================================================

// Chaves do localStorage
const SESSION_ID_KEY = 'vox_session_id'
const SESSION_TIMESTAMP_KEY = 'vox_session_timestamp'
const ACCOUNT_TOKEN_KEY = 'vox_account_token'
const SESSION_TTL = 5 * 60 * 1000 // 5 minutos - tempo máximo para recover

type MessageHandler = (type: string, payload: unknown) => void
type WebRTCSignal = { type: 'offer' | 'answer' | 'ice'; payload: unknown }

function dispatchWebRTCSignal(signal: WebRTCSignal): void {
  const win = window as unknown as {
    __webrtc?: {
      handleOffer: (sdp: unknown) => void
      handleAnswer: (sdp: unknown) => void
      handleIce: (candidate: unknown) => void
    }
    __pendingWebRTCSignals?: WebRTCSignal[]
  }

  if (win.__webrtc) {
    if (signal.type === 'offer') win.__webrtc.handleOffer(signal.payload)
    if (signal.type === 'answer') win.__webrtc.handleAnswer(signal.payload)
    if (signal.type === 'ice') win.__webrtc.handleIce(signal.payload)
    return
  }

  const queue = win.__pendingWebRTCSignals || []
  queue.push(signal)
  win.__pendingWebRTCSignals = queue.slice(-256)
}

// Helpers para sessionId
function getStoredSessionId(): string | null {
  if (typeof window === 'undefined') return null
  
  const sessionId = localStorage.getItem(SESSION_ID_KEY)
  const timestamp = localStorage.getItem(SESSION_TIMESTAMP_KEY)
  
  if (!sessionId || !timestamp) return null
  
  // Verificar se não expirou (5 min)
  const age = Date.now() - parseInt(timestamp, 10)
  if (age > SESSION_TTL) {
    clearStoredSession()
    return null
  }
  
  return sessionId
}

function storeSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_ID_KEY, sessionId)
  localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString())
}

function updateSessionTimestamp(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString())
}

function clearStoredSession(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(SESSION_TIMESTAMP_KEY)
}

function getStoredAccountToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACCOUNT_TOKEN_KEY)
}

function storeAccountToken(token: string): void {
  if (typeof window === 'undefined' || !token) return
  localStorage.setItem(ACCOUNT_TOKEN_KEY, token)
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<MessageHandler[]>([])
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPongTime = useRef<number>(Date.now())
  const isIntentionalClose = useRef(false)
  const pendingQueueJoin = useRef(false)
  const nextMatchFallback = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // CORREÇÃO 2: Timings de produção (Slack/Discord-like)
  const maxReconnectAttempts = 15
  const HEARTBEAT_INTERVAL = 30000  // 30s - ping gentil
  const HEARTBEAT_TIMEOUT = 90000   // 90s - timeout generoso
  
  const { setStatus, setRoom, addMessage, updateMessage, resetSession, setPartnerTyping, setWsStatus, setOnlineCount, setFriends, setDiscovery, setFriendPresence } = useNexusStore()
  const { playConnect, playDisconnect, playMessage } = useSound()

  // Heartbeat - CORREÇÃO 1: Não fechar socket, só avisar
  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current)
    lastPongTime.current = Date.now()
    
    heartbeatInterval.current = setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      
      // CORREÇÃO 1: Detecta problema mas NÃO mata conexão
      // Deixa TCP/servidor fechar quando realmente morrer
      if (Date.now() - lastPongTime.current > HEARTBEAT_TIMEOUT) {
        console.warn('⚠️ Missed pong, waiting for server/TCP to close...')
        // NÃO chamar ws.close() aqui!
        return
      }
      
      // Enviar ping como keep-alive
      try {
        ws.send(JSON.stringify({ type: 'ping' }))
      } catch {
        // Erro de send = conexão morta, onclose vai disparar
      }
    }, HEARTBEAT_INTERVAL)
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }

    const wsUrl = getWebSocketUrl()
    const isReconnect = reconnectAttempts.current > 0
    
    // Tentar recuperar sessão anterior
    const previousSessionId = getStoredSessionId()
    const accountToken = getStoredAccountToken()
    const params = new URLSearchParams()
    if (previousSessionId) params.set('session_id', previousSessionId)
    if (accountToken) params.set('token', accountToken)
    const finalUrl = params.size > 0 ? `${wsUrl}?${params.toString()}` : wsUrl
    
    console.log('🔌 Connecting to:', wsUrl, isReconnect ? `(attempt ${reconnectAttempts.current})` : '', previousSessionId ? '(recovering session)' : '')
    setWsStatus(isReconnect ? 'reconnecting' : 'connecting')
    
    try {
      const ws = new WebSocket(finalUrl)
      wsRef.current = ws
      isIntentionalClose.current = false

      ws.onopen = () => {
        console.log('✅ WebSocket connected!')
        reconnectAttempts.current = 0
        setWsStatus('connected')
        setStatus('idle')
        startHeartbeat()
        if (pendingQueueJoin.current) {
          pendingQueueJoin.current = false
          const currentUser = useNexusStore.getState().user
          ws.send(JSON.stringify({
            type: 'join_queue',
            payload: {
              nativeLanguage: currentUser?.nativeLanguage || 'pt',
              targetLanguage: currentUser?.targetLanguage || 'en',
              interests: currentUser?.interests || [],
              country: currentUser?.country || 'BR'
            }
          }))
        }
      }

      ws.onerror = () => {
        // Erro será seguido por onclose, não precisa fazer nada aqui
      }

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data)
          
          // Pong recebido - atualizar timestamp da sessão
          if (type === 'pong') {
            lastPongTime.current = Date.now()
            updateSessionTimestamp() // Manter sessão viva no localStorage
            if (payload?.online) setOnlineCount(payload.online)
            return
          }
          
          console.log('📨 WS:', type, payload)

          switch (type) {
            case 'connected':
              // Guardar sessionId para futuras reconexões
              if (payload?.sessionId) {
                storeSessionId(payload.sessionId)
                console.log('💾 Session stored:', payload.sessionId.substring(0, 8) + '...')
              }
              if (payload?.token) {
                storeAccountToken(payload.token)
              }
              if (payload?.isReconnect) {
                console.log('🔄 Session recovered successfully!')
              }
              if (payload?.anonymousId) {
                useNexusStore.getState().setUser({
                  ...useNexusStore.getState().user!,
                  id: payload.userId,
                  anonymousId: payload.anonymousId
                })
              }
              if (payload?.online) setOnlineCount(payload.online)
              ws.send(JSON.stringify({ type: 'get_friends' }))
              ws.send(JSON.stringify({ type: 'get_discovery' }))
              break

            case 'friends_list':
              setFriends(
                Array.isArray(payload?.friends) ? payload.friends : [],
                Array.isArray(payload?.requests) ? payload.requests : []
              )
              break

            case 'discovery_list':
              setDiscovery(Array.isArray(payload?.users) ? payload.users : [])
              break

            case 'friend_presence':
              if (payload?.friendId) setFriendPresence(payload.friendId, !!payload.online)
              break

            case 'friend_request_received':
            case 'friend_request_accepted':
              ws.send(JSON.stringify({ type: 'get_friends' }))
              ws.send(JSON.stringify({ type: 'get_discovery' }))
              break
              
            case 'queue_joined':
              setStatus('searching')
              break

            case 'next_searching':
              if (nextMatchFallback.current) {
                clearTimeout(nextMatchFallback.current)
                nextMatchFallback.current = null
              }
              resetSession()
              setStatus('searching')
              break
              
            case 'queue_left':
            case 'queue_timeout':
              setStatus('idle')
              break
              
            case 'matched': {
              const isInitiator = payload.partner?.isInitiator === true
              
              setRoom(payload.roomId, {
                id: payload.partner?.userId,
                anonymousId: payload.partner?.odId || payload.partner?.anonymousId,
                nativeLanguage: payload.partner?.nativeLanguage,
                country: payload.partner?.country,
                commonInterests: payload.partner?.commonInterests || []
              })
              setStatus('connected')
              playConnect()
              
              const win = window as unknown as { __isWebRTCInitiator?: boolean }
              win.__isWebRTCInitiator = isInitiator
              console.log('🎯 WebRTC role:', isInitiator ? 'INITIATOR' : 'RESPONDER')
              break
            }
            
            case 'chat_message':
              addMessage({
                id: Date.now().toString(),
                senderId: payload.from,
                originalText: payload.text,
                translatedText: payload.text,
                timestamp: new Date(payload.timestamp),
                isAiOptimized: false
              })
              setPartnerTyping(false)
              playMessage()
              break

            case 'media_message':
              addMessage({
                id: payload.id || Date.now().toString(),
                senderId: payload.from,
                originalText: `[${payload.fileName || payload.type || 'media'}]`,
                translatedText: '',
                timestamp: new Date(payload.timestamp || Date.now()),
                isAiOptimized: false,
                mediaType: payload.type,
                mediaUrl: payload.data,
                fileName: payload.fileName
              })
              setPartnerTyping(false)
              playMessage()
              break

            case 'media_delivered':
              if (payload?.clientId) {
                updateMessage(payload.clientId, {
                  status: 'sent',
                  retryPayload: undefined,
                })
              }
              console.log('Media delivered:', payload?.id)
              break

            case 'media_error': {
              const messages: Record<string, string> = {
                file_too_large: 'O arquivo é maior que 12 MB.',
                invalid_media: 'Esse arquivo não é compatível.',
                partner_offline: 'A outra pessoa desconectou.',
                not_in_room: 'A chamada não está mais ativa.',
                room_not_found: 'A conversa não está mais disponível.',
                delivery_failed: 'Não foi possível entregar o arquivo.',
                rate_limited: 'Muitos arquivos em sequência. Aguarde alguns segundos.',
              }
              const errorMessage = messages[payload?.error] || 'Não foi possível enviar o arquivo.'
              if (payload?.clientId) {
                updateMessage(payload.clientId, {
                  status: 'failed',
                  originalText: errorMessage,
                })
              } else {
                addMessage({
                  id: `media-error-${Date.now()}`,
                  senderId: 'system',
                  originalText: errorMessage,
                  translatedText: '',
                  timestamp: new Date(),
                  isAiOptimized: false
                })
              }
              break
            }
              
            case 'typing':
              setPartnerTyping(payload.isTyping)
              break
              
            case 'partner_left': {
              resetSession()
              playDisconnect()
              setTimeout(() => {
                const currentUser = useNexusStore.getState().user
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'join_queue',
                    payload: {
                      nativeLanguage: currentUser?.nativeLanguage || 'pt',
                      targetLanguage: currentUser?.targetLanguage || 'en',
                      interests: currentUser?.interests || [],
                      country: currentUser?.country || 'BR'
                    }
                  }))
                }
              }, 350)
              break
            }

            case 'room_expired':
              resetSession()
              playDisconnect()
              break
              
            case 'webrtc_offer':
              console.log('📥 Received offer')
              dispatchWebRTCSignal({ type: 'offer', payload: payload.sdp })
              break
              
            case 'webrtc_answer':
              console.log('📥 Received answer')
              dispatchWebRTCSignal({ type: 'answer', payload: payload.sdp })
              break
              
            case 'webrtc_ice':
              dispatchWebRTCSignal({ type: 'ice', payload: payload.candidate })
              break
              
            case 'negotiation_timeout':
              console.warn('⏰ Negotiation timeout from server')
              break
          }

          handlersRef.current.forEach((handler: MessageHandler) => handler(type, payload))
        } catch (e) {
          console.error('WS parse error:', e)
        }
      }

      // CORREÇÃO 3: Reconectar só em erro real
      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected', event.code, event.reason || '')
        wsRef.current = null
        stopHeartbeat()
        setWsStatus('disconnected')
        
        // CORREÇÃO 3: Não reconectar em close normal
        // 1000 = normal close
        // 1001 = page unload
        if (event.code === 1000 || event.code === 1001) {
          console.log('✅ Clean close, not reconnecting')
          return
        }
        
        // Reconectar em erro de rede (1006) ou outros
        if (!isIntentionalClose.current && reconnectAttempts.current < maxReconnectAttempts) {
          // Backoff exponencial com jitter
          const baseDelay = Math.min(1000 * Math.pow(1.5, reconnectAttempts.current), 30000)
          const jitter = Math.random() * 1000
          const delay = baseDelay + jitter
          
          reconnectAttempts.current++
          console.log(`🔄 Reconnecting in ${(delay/1000).toFixed(1)}s... (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`)
          setWsStatus('reconnecting')
          
          reconnectTimeout.current = setTimeout(() => connect(), delay)
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          console.log('❌ Max reconnect attempts reached')
          setStatus('idle')
        }
      }
    } catch (err) {
      console.error('❌ WebSocket creation error:', err)
      setWsStatus('disconnected')
    }
  }, [setStatus, setRoom, addMessage, updateMessage, resetSession, setPartnerTyping, setWsStatus, setOnlineCount, setFriends, setDiscovery, setFriendPresence, playConnect, playDisconnect, playMessage, startHeartbeat, stopHeartbeat])

  const disconnect = useCallback(() => {
    isIntentionalClose.current = true
    stopHeartbeat()
    clearStoredSession() // Limpar sessão no disconnect intencional
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }
    wsRef.current?.close(1000, 'User disconnect') // Close code 1000 = normal
    wsRef.current = null
    setWsStatus('disconnected')
  }, [stopHeartbeat, setWsStatus])

  const send = useCallback((type: string, payload?: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
      return true
    }
    return false
  }, [])

  // Queue actions
  const joinQueue = useCallback(() => {
    const user = useNexusStore.getState().user
    const payload = {
      nativeLanguage: user?.nativeLanguage || 'pt',
      targetLanguage: user?.targetLanguage || 'en',
      interests: user?.interests || [],
      country: user?.country || 'BR'
    }

    if (!send('join_queue', payload)) {
      pendingQueueJoin.current = true
      setWsStatus('connecting')
      connect()
    }
  }, [send, connect, setWsStatus])
  
  const leaveQueue = useCallback(() => send('leave_queue'), [send])
  const leaveRoom = useCallback(() => send('leave_room'), [send])
  const nextMatch = useCallback(() => {
    if (!send('next_match')) return false

    if (nextMatchFallback.current) clearTimeout(nextMatchFallback.current)
    nextMatchFallback.current = setTimeout(() => {
      send('leave_room')
      setTimeout(() => joinQueue(), 350)
      nextMatchFallback.current = null
    }, 1200)
    return true
  }, [send, joinQueue])
  
  // Chat actions
  const sendChat = useCallback((message: string) => {
    send('chat_message', { text: message })
  }, [send])

  const sendTyping = useCallback(() => {
    send('typing', { isTyping: true })
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => send('typing', { isTyping: false }), 2000)
  }, [send])

  // Settings actions
  const updateLanguages = useCallback((native: string, target: string) => {
    send('update_languages', { native_language: native, target_language: target })
  }, [send])

  const updateInterestsWS = useCallback((interests: string[]) => {
    send('update_interests', { interests })
  }, [send])

  // Moderation actions
  const reportUser = useCallback((reason: string, details: string) => {
    send('report_user', { reason, details })
  }, [send])

  const blockUser = useCallback(() => send('block_user'), [send])
  const getDiscovery = useCallback(() => send('get_discovery'), [send])
  const sendFriendRequest = useCallback((toUserId: string) => send('friend_request', { toUserId }), [send])
  const removeFriend = useCallback((friendId: string) => send('friend_remove', { friendId }), [send])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isIntentionalClose.current = true
      stopHeartbeat()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (nextMatchFallback.current) clearTimeout(nextMatchFallback.current)
      wsRef.current?.close(1000, 'Component unmount')
    }
  }, [stopHeartbeat])

  return {
    socket: wsRef.current,
    connect,
    disconnect,
    send,
    joinQueue,
    leaveQueue,
    leaveRoom,
    nextMatch,
    sendChat,
    sendTyping,
    updateLanguages,
    updateInterests: updateInterestsWS,
    reportUser,
    blockUser,
    getDiscovery,
    sendFriendRequest,
    removeFriend,
    isConnected: () => wsRef.current?.readyState === WebSocket.OPEN
  }
}
