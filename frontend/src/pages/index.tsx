import React, { useEffect, useRef, useState } from 'react'
import { NexusGrid, Column } from '@/components/layout/NexusGrid'
import { Sidebar } from '@/components/nav/Sidebar'
import { VideoStage } from '@/components/video/VideoStage'
import { TranslationPanel } from '@/components/chat/TranslationPanel'
import { MobileHeader } from '@/components/nav/MobileHeader'
import { ReportModal } from '@/components/ui/ReportModal'
import { ConnectionStatus } from '@/components/ui/ConnectionStatus'
import { useNexusStore } from '@/store/useNexusStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useTheme } from '@/hooks/useTheme'

export default function NexusApp() {
  const { setUser, setToken, setStatus, status, user, token, partnerInfo } = useNexusStore()
  const { theme } = useTheme()
  const [mobileTab, setMobileTab] = useState<'video' | 'chat'>('video')
  const [showReport, setShowReport] = useState(false)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const ws = useWebSocket()
  const wsRef = useRef(ws)
  wsRef.current = ws

  useEffect(() => {
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

  // Mobile: ficar na câmera (não ir pro chat automaticamente)
  useEffect(() => {
    // Não mudar automaticamente - usuário decide
    if (status === 'idle') setMobileTab('video')
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
    setMobileTab('video')
  }

  const handleNext = () => {
    wsRef.current.leaveRoom()
    setTimeout(() => {
      setStatus('searching')
      wsRef.current.joinQueue()
    }, 500)
  }

  const sendSignal = (type: string, payload: any) => wsRef.current.send(type, payload)
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
      {/* Left Sidebar - Desktop */}
      <div className={`hidden md:flex flex-col transition-all duration-300 ${leftSidebarOpen ? 'w-72' : 'w-0'} overflow-hidden`}>
        <Sidebar 
          onLeaveRoom={handleLeaveRoom} 
          onUpdateLanguages={handleUpdateLanguages}
          onUpdateInterests={handleUpdateInterests}
          onReport={() => setShowReport(true)}
        />
      </div>

      {/* Toggle Left Sidebar Button */}
      <button 
        onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
        className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-50 w-6 h-16 items-center justify-center rounded-r-lg transition-all hover:bg-white/10"
        style={{ 
          left: leftSidebarOpen ? '288px' : '0',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <svg className={`w-4 h-4 text-white transition-transform ${leftSidebarOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Mobile Header */}
      <MobileHeader onLeaveRoom={handleLeaveRoom} onReport={() => setShowReport(true)} />

      {/* Connection Status - Top Right */}
      <div className="absolute top-3 right-3 z-30 hidden md:block">
        <ConnectionStatus />
      </div>

      {/* Main Video Area */}
      <Column width="flex-1" className={`relative ${mobileTab !== 'video' ? 'hidden md:block' : ''}`}>
        <VideoStage onNext={handleNext} onLeave={handleLeaveRoom} sendSignal={sendSignal} />
        
        {/* Start Button Overlay */}
        {status === 'idle' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative text-center">
              <button 
                onClick={handleStartMatch}
                className="group relative px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-2xl shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 active:scale-95 transition-all duration-300"
              >
                <span className="relative z-10 flex items-center gap-3 text-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Iniciar
                </span>
              </button>
              <p className="text-white/70 text-sm mt-4">Encontre alguém para conversar</p>
            </div>
          </div>
        )}

        {/* Cancel Button */}
        {status === 'searching' && (
          <div className="absolute bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-20">
            <button onClick={handleStopMatch} className="px-6 py-3 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-full text-sm font-medium flex items-center gap-2 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancelar
            </button>
          </div>
        )}
      </Column>

      {/* Toggle Right Sidebar Button */}
      <button 
        onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
        className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-50 w-6 h-16 items-center justify-center rounded-l-lg transition-all hover:bg-white/10"
        style={{ 
          right: rightSidebarOpen ? '320px' : '0',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <svg className={`w-4 h-4 text-white transition-transform ${rightSidebarOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Right Sidebar - Chat */}
      <div className={`${mobileTab !== 'chat' ? 'hidden md:block' : 'fixed inset-0 z-40 pt-14 pb-16 md:relative md:inset-auto md:pt-0 md:pb-0 md:z-auto'} transition-all duration-300 ${rightSidebarOpen ? 'md:w-80' : 'md:w-0'} md:overflow-hidden`}
        style={{ background: theme === 'dark' ? '#0a0a0a' : '#fff' }}>
        <TranslationPanel onSendMessage={handleSendMessage} onTyping={handleTyping} />
      </div>

      {/* Report Modal */}
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
