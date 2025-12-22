import { useEffect, useRef, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useSound } from '@/hooks/useSound'

type MessageHandler = (type: string, payload: any) => void

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<MessageHandler[]>([])
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null)
  const lastPongTime = useRef<number>(Date.now())
  const isIntentionalClose = useRef(false)
  const maxReconnectAttempts = 10
  const HEARTBEAT_INTERVAL = 25000 // 25 segundos
  const HEARTBEAT_TIMEOUT = 35000 // 35 segundos sem pong = desconectado
  
  const { setStatus, setRoom, addMessage, resetSession, setPartnerTyping, setWsStatus, setOnlineCount } = useNexusStore()
  const { playConnect, playDisconnect, playMessage } = useSound()

  // Iniciar heartbeat
  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current)
    lastPongTime.current = Date.now()
    
    heartbeatInterval.current = setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      
      // Verificar se recebeu pong recentemente
      if (Date.now() - lastPongTime.current > HEARTBEAT_TIMEOUT) {
        console.log('💔 Heartbeat timeout - connection dead')
        ws.close()
        return
      }
      
      // Enviar ping
      ws.send(JSON.stringify({ type: 'ping' }))
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

      ws.onerror = (err) => {
        console.error('❌ WebSocket error:', err)
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
              setStatus('idle')
              break
            case 'matched': {
              const myId = useNexusStore.getState().user?.id || ''
              const partnerId = payload.partner?.odId || payload.partner?.anonymousId || ''
              const isInitiator = myId < partnerId
              
              setRoom(payload.roomId, {
                anonymousId: payload.partner?.odId || payload.partner?.anonymousId,
                nativeLanguage: payload.partner?.nativeLanguage,
                country: payload.partner?.country,
                commonInterests: payload.partner?.commonInterests || []
              })
              setStatus('connected')
              playConnect()
              
              ;(window as any).__isWebRTCInitiator = isInitiator
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
              resetSession()
              playDisconnect()
              break
            case 'webrtc_offer':
              // Perfect Negotiation: ambos podem receber offers
              console.log('📥 Received offer')
              ;(window as any).__webrtc?.handleOffer?.(payload.sdp)
              break
            case 'webrtc_answer':
              // Perfect Negotiation: ambos podem receber answers
              console.log('📥 Received answer')
              ;(window as any).__webrtc?.handleAnswer?.(payload.sdp)
              break
            case 'webrtc_ice':
              ;(window as any).__webrtc?.handleIce?.(payload.candidate)
              break
          }

          handlersRef.current.forEach(handler => handler(type, payload))
        } catch (e) {
          console.error('WS parse error:', e)
        }
      }

      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected', event.code)
        wsRef.current = null
        stopHeartbeat()
        setWsStatus('disconnected')
        
        if (!isIntentionalClose.current && reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
          reconnectAttempts.current++
          
          console.log(`🔄 Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`)
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
    wsRef.current?.close()
    wsRef.current = null
    setWsStatus('disconnected')
  }, [stopHeartbeat, setWsStatus])

  const send = useCallback((type: string, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

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
  
  const sendChat = useCallback((message: string) => {
    send('chat_message', { text: message })
  }, [send])

  const sendTyping = useCallback(() => {
    send('typing', { isTyping: true })
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => send('typing', { isTyping: false }), 2000)
  }, [send])

  const updateLanguages = useCallback((native: string, target: string) => {
    send('update_languages', { native_language: native, target_language: target })
  }, [send])

  const updateInterestsWS = useCallback((interests: string[]) => {
    send('update_interests', { interests })
  }, [send])

  const reportUser = useCallback((reason: string, details: string) => {
    send('report_user', { reason, details })
  }, [send])

  const blockUser = useCallback(() => send('block_user'), [send])

  useEffect(() => {
    return () => {
      isIntentionalClose.current = true
      stopHeartbeat()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      wsRef.current?.close()
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
