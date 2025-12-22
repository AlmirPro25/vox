import React, { useEffect, useRef, useState } from 'react'
import { NexusGrid, Column } from '@/components/layout/NexusGrid'
import { Sidebar } from '@/components/nav/Sidebar'
import { VideoStage } from '@/components/video/VideoStage'
import { TranslationPanel } from '@/components/chat/TranslationPanel'
import { MobileHeader } from '@/components/nav/MobileHeader'
import { ReportModal } from '@/components/ui/ReportModal'
import { useNexusStore } from '@/store/useNexusStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import axios from 'axios'

export default function NexusApp() {
  const { setUser, setToken, setStatus, status, user, token, partnerInfo } = useNexusStore()
  const [mobileTab, setMobileTab] = useState<'main' | 'chat'>('main')
  const [showReport, setShowReport] = useState(false)
  const ws = useWebSocket()
  const wsRef = useRef(ws)
  wsRef.current = ws

  useEffect(() => {
    // Conectar direto no WebSocket (sem auth)
    const savedUser = useNexusStore.getState().user
    const anonId = savedUser?.anonymousId || `NX-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    
    setUser({
      id: anonId,
      anonymousId: anonId,
      nativeLanguage: savedUser?.nativeLanguage || 'pt',
      targetLanguage: savedUser?.targetLanguage || 'en',
      interests: savedUser?.interests || [],
      country: 'BR',
      reputation: 100
    })
    setToken('direct')
    wsRef.current.connect()
  }, [setUser, setToken])

  useEffect(() => {
    if (status === 'connected') setMobileTab('chat')
  }, [status])

  const handleStartMatch = () => {
    if (!user || !token) return
    setStatus('searching')
    wsRef.current.joinQueue()
  }

  const handleStopMatch = () => {
    wsRef.current.leaveQueue()
    setStatus('idle')
  }

  const handleLeaveRoom = () => {
    wsRef.current.leaveRoom()
    setMobileTab('main')
  }

  const handleSendMessage = (message: string) => wsRef.current.sendChat(message)
  const handleTyping = () => wsRef.current.sendTyping()

  const handleUpdateLanguages = (native: string, target: string) => {
    wsRef.current.updateLanguages(native, target)
    useNexusStore.getState().updateLanguages(native as any, target as any)
  }

  const handleUpdateInterests = (interests: string[]) => {
    wsRef.current.updateInterests(interests)
    useNexusStore.getState().updateInterests(interests)
  }

  const handleReport = (reason: string, details: string) => {
    wsRef.current.reportUser(reason, details)
    setShowReport(false)
  }

  return (
    <NexusGrid activeTab={mobileTab} onTabChange={setMobileTab}>
      <Column width="w-72" mobileHidden>
        <Sidebar 
          onLeaveRoom={handleLeaveRoom} 
          onUpdateLanguages={handleUpdateLanguages}
          onUpdateInterests={handleUpdateInterests}
          onReport={() => setShowReport(true)}
        />
      </Column>

      <MobileHeader onLeaveRoom={handleLeaveRoom} onReport={() => setShowReport(true)} />

      <Column width="flex-1" className={`relative border-x theme-border ${mobileTab !== 'main' ? 'hidden md:block' : ''}`}>
        <VideoStage ws={wsRef.current.socket} />
        
        {status === 'idle' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative text-center">
              <button 
                onClick={handleStartMatch}
                className="group relative px-8 md:px-12 py-4 md:py-5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-2xl shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 active:scale-95 transition-all duration-300 uppercase tracking-widest text-xs md:text-sm"
              >
                <span className="relative z-10 flex items-center gap-2 md:gap-3">
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Start Bridge
                </span>
              </button>
              <p className="text-center theme-text-muted text-xs mt-4 px-4">
                Find a partner who speaks your target language
              </p>
            </div>
          </div>
        )}

        {status === 'searching' && (
          <div className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-20">
            <button onClick={handleStopMatch} className="btn-secondary text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </button>
          </div>
        )}
      </Column>

      <Column width="w-80" className={`${mobileTab !== 'chat' ? 'hidden md:block' : 'pb-16 md:pb-0'}`}>
        <TranslationPanel onSendMessage={handleSendMessage} onTyping={handleTyping} />
      </Column>

      {showReport && partnerInfo && (
        <ReportModal 
          partnerName={partnerInfo.anonymousId} 
          onReport={handleReport} 
          onClose={() => setShowReport(false)} 
        />
      )}
    </NexusGrid>
  )
}
