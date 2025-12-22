import { useEffect, useRef, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useSound } from '@/hooks/useSound'

type MessageHandler = (type: string, payload: any) => void

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<MessageHandler[]>([])
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { setStatus, setRoom, addMessage, resetSession, setPartnerTyping, updateInterests } = useNexusStore()
  const { playConnect, playDisconnect, playMessage } = useSound()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Conectar direto no WebSocket do backend
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://vox-api-hq2l.onrender.com'
    
    console.log('🔌 Connecting to:', wsUrl)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('✅ WebSocket connected!')
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
            // Recebeu ID do servidor
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
            // Match encontrado!
            setRoom(payload.roomId, {
              anonymousId: payload.partner?.odId || payload.partner?.anonymousId,
              nativeLanguage: payload.partner?.nativeLanguage,
              country: payload.partner?.country,
              commonInterests: payload.partner?.commonInterests || []
            })
            setStatus('connected')
            playConnect()
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
          // WebRTC signals - forward to VideoStage
          case 'webrtc_offer':
            if ((window as any).__webrtc?.handleOffer) {
              (window as any).__webrtc.handleOffer(payload.sdp)
            }
            break
          case 'webrtc_answer':
            if ((window as any).__webrtc?.handleAnswer) {
              (window as any).__webrtc.handleAnswer(payload.sdp)
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

    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected')
      wsRef.current = null
    }
  }, [setStatus, setRoom, addMessage, resetSession, setPartnerTyping, playConnect, playDisconnect, playMessage])

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
      wsRef.current?.close()
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [])

  return {
    socket: wsRef.current,
    connect,
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
