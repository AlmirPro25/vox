import { useEffect, useRef, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useSound } from '@/hooks/useSound'

// ============================================================================
// WEBSOCKET HOOK - PRODUCTION READY
// ============================================================================
// CORREÇÕES APLICADAS:
// 1. NÃO fechar socket no heartbeat (deixa TCP/servidor decidir)
// 2. Heartbeat gentil (30s interval, 90s timeout)
// 3. Reconectar só em erro real (não em close normal)
// ============================================================================

type MessageHandler = (type: string, payload: unknown) => void

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<MessageHandler[]>([])
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPongTime = useRef<number>(Date.now())
  const isIntentionalClose = useRef(false)
  
  // CORREÇÃO 2: Timings de produção (Slack/Discord-like)
  const maxReconnectAttempts = 15
  const HEARTBEAT_INTERVAL = 30000  // 30s - ping gentil
  const HEARTBEAT_TIMEOUT = 90000   // 90s - timeout generoso
  
  const { setStatus, setRoom, addMessage, resetSession, setPartnerTyping, setWsStatus, setOnlineCount } = useNexusStore()
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

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://vox-api-hq2l.onrender.com'
    const isReconnect = reconnectAttempts.current > 0
    
    console.log('🔌 Connecting to:', wsUrl, isReconnect ? `(attempt ${reconnectAttempts.current})` : '')
    setWsStatus(isReconnect ? 'reconnecting' : 'connecting')
    
    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      isIntentionalClose.current = false

      ws.onopen = () => {
        console.log('✅ WebSocket connected!')
        reconnectAttempts.current = 0
        setWsStatus('connected')
        setStatus('idle')
        startHeartbeat()
      }

      ws.onerror = () => {
        // Erro será seguido por onclose, não precisa fazer nada aqui
      }

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data)
          
          // Pong recebido - atualizar timestamp
          if (type === 'pong') {
            lastPongTime.current = Date.now()
            if (payload?.online) setOnlineCount(payload.online)
            return
          }
          
          console.log('📨 WS:', type, payload)

          switch (type) {
            case 'connected':
              if (payload?.anonymousId) {
                useNexusStore.getState().setUser({
                  ...useNexusStore.getState().user!,
                  id: payload.userId,
                  anonymousId: payload.anonymousId
                })
              }
              if (payload?.online) setOnlineCount(payload.online)
              break
              
            case 'queue_joined':
              setStatus('searching')
              break
              
            case 'queue_left':
            case 'queue_timeout':
              setStatus('idle')
              break
              
            case 'matched': {
              const isInitiator = payload.partner?.isInitiator === true
              
              setRoom(payload.roomId, {
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
              
            case 'typing':
              setPartnerTyping(payload.isTyping)
              break
              
            case 'partner_left':
            case 'room_expired':
              resetSession()
              playDisconnect()
              break
              
            case 'webrtc_offer':
              console.log('📥 Received offer')
              ;(window as unknown as { __webrtc?: { handleOffer: (sdp: unknown) => void } }).__webrtc?.handleOffer?.(payload.sdp)
              break
              
            case 'webrtc_answer':
              console.log('📥 Received answer')
              ;(window as unknown as { __webrtc?: { handleAnswer: (sdp: unknown) => void } }).__webrtc?.handleAnswer?.(payload.sdp)
              break
              
            case 'webrtc_ice':
              ;(window as unknown as { __webrtc?: { handleIce: (candidate: unknown) => void } }).__webrtc?.handleIce?.(payload.candidate)
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
  }, [setStatus, setRoom, addMessage, resetSession, setPartnerTyping, setWsStatus, setOnlineCount, playConnect, playDisconnect, playMessage, startHeartbeat, stopHeartbeat])

  const disconnect = useCallback(() => {
    isIntentionalClose.current = true
    stopHeartbeat()
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
    }
  }, [])

  // Queue actions
  const joinQueue = useCallback(() => {
    const user = useNexusStore.getState().user
    send('join_queue', {
      nativeLanguage: user?.nativeLanguage || 'pt',
      targetLanguage: user?.targetLanguage || 'en',
      interests: user?.interests || [],
      country: user?.country || 'BR'
    })
  }, [send])
  
  const leaveQueue = useCallback(() => send('leave_queue'), [send])
  const leaveRoom = useCallback(() => send('leave_room'), [send])
  
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isIntentionalClose.current = true
      stopHeartbeat()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
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
    sendChat,
    sendTyping,
    updateLanguages,
    updateInterests: updateInterestsWS,
    reportUser,
    blockUser,
    isConnected: () => wsRef.current?.readyState === WebSocket.OPEN
  }
}
