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

  const connect = useCallback((token: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Use WSS in production, WS in development
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsHost = process.env.NEXT_PUBLIC_WS_URL || `${wsProtocol}//${window.location.host}`
    const wsUrl = `${wsHost}/v1/ws?token=${token}`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => console.log('🔌 WebSocket connected')

    ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data)
        console.log('📨 WS:', type, payload)

        switch (type) {
          case 'connected':
            break
          case 'queue_joined':
            setStatus('searching')
            break
          case 'queue_left':
            setStatus('idle')
            break
          case 'match_found':
            setRoom(payload.room_id, {
              anonymousId: payload.partner_id,
              nativeLanguage: payload.partner_lang,
              country: payload.partner_country,
              commonInterests: payload.common_interests || []
            })
            playConnect()
            break
          case 'chat':
            addMessage({
              id: Date.now().toString(),
              senderId: payload.sender_id,
              originalText: payload.message,
              translatedText: payload.message,
              timestamp: new Date(payload.timestamp),
              isAiOptimized: false
            })
            setPartnerTyping(false)
            playMessage()
            break
          case 'partner_typing':
            setPartnerTyping(true)
            break
          case 'partner_stop_typing':
            setPartnerTyping(false)
            break
          case 'partner_left':
            resetSession()
            playDisconnect()
            break
          case 'interests_updated':
            if (payload.interests) updateInterests(payload.interests)
            break
          case 'report_submitted':
          case 'user_blocked':
            resetSession()
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
  }, [setStatus, setRoom, addMessage, resetSession, setPartnerTyping, updateInterests, playConnect, playDisconnect, playMessage])

  const send = useCallback((type: string, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  const joinQueue = useCallback(() => send('join_queue'), [send])
  const leaveQueue = useCallback(() => send('leave_queue'), [send])
  const leaveRoom = useCallback(() => send('leave_room'), [send])
  
  const sendChat = useCallback((message: string) => {
    send('chat', { message })
    send('stop_typing')
  }, [send])

  const sendTyping = useCallback(() => {
    send('typing')
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => send('stop_typing'), 2000)
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
    connect,
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
