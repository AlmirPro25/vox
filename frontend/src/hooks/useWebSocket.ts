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
  const isIntentionalClose = useRef(false)
  const maxReconnectAttempts = 10
  
  const { setStatus, setRoom, addMessage, resetSession, setPartnerTyping } = useNexusStore()
  const { playConnect, playDisconnect, playMessage } = useSound()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    // Limpar timeout anterior
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://vox-api-hq2l.onrender.com'
    
    console.log('🔌 Connecting to:', wsUrl, reconnectAttempts.current > 0 ? `(attempt ${reconnectAttempts.current})` : '')
    
    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      isIntentionalClose.current = false

      ws.onopen = () => {
        console.log('✅ WebSocket connected!')
        reconnectAttempts.current = 0
        setStatus('idle')
      }

      ws.onerror = (err) => {
        console.error('❌ WebSocket error:', err)
      }

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data)
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
              break
            case 'queue_joined':
              setStatus('searching')
              break
            case 'queue_left':
              setStatus('idle')
              break
            case 'matched':
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
              if (!(window as any).__isWebRTCInitiator) {
                console.log('📥 Processing offer as RESPONDER')
                if ((window as any).__webrtc?.handleOffer) {
                  (window as any).__webrtc.handleOffer(payload.sdp)
                }
              } else {
                console.log('⚠️ Ignoring offer (I am INITIATOR)')
              }
              break
            case 'webrtc_answer':
              if ((window as any).__isWebRTCInitiator) {
                console.log('📥 Processing answer as INITIATOR')
                if ((window as any).__webrtc?.handleAnswer) {
                  (window as any).__webrtc.handleAnswer(payload.sdp)
                }
              } else {
                console.log('⚠️ Ignoring answer (I am RESPONDER)')
              }
              break
            case 'webrtc_ice':
              if ((window as any).__webrtc?.handleIce && payload.candidate) {
                (window as any).__webrtc.handleIce(payload.candidate)
              }
              break
          }

          handlersRef.current.forEach(handler => handler(type, payload))
        } catch (e) {
          console.error('WS parse error:', e)
        }
      }

      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected', event.code, event.reason)
        wsRef.current = null
        
        // Reconectar automaticamente se não foi fechamento intencional
        if (!isIntentionalClose.current && reconnectAttempts.current < maxReconnectAttempts) {
          // Backoff exponencial: 1s, 2s, 4s, 8s... max 30s
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
          reconnectAttempts.current++
          
          console.log(`🔄 Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`)
          
          reconnectTimeout.current = setTimeout(() => {
            connect()
          }, delay)
        } else if (reconnectAttempts.current >= maxReconnectAttempts) {
          console.log('❌ Max reconnect attempts reached')
          setStatus('idle')
        }
      }
    } catch (err) {
      console.error('❌ WebSocket creation error:', err)
    }
  }, [setStatus, setRoom, addMessage, resetSession, setPartnerTyping, playConnect, playDisconnect, playMessage])

  const disconnect = useCallback(() => {
    isIntentionalClose.current = true
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const send = useCallback((type: string, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  const joinQueue = useCallback(() => send('join_queue'), [send])
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

  const blockUser = useCallback(() => {
    send('block_user')
  }, [send])

  useEffect(() => {
    return () => {
      isIntentionalClose.current = true
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      wsRef.current?.close()
    }
  }, [])

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
