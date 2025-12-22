import React, { useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'

interface NexusGridProps {
  children: React.ReactNode
  activeTab?: 'video' | 'chat'
  onTabChange?: (tab: 'video' | 'chat') => void
}

export function NexusGrid({ children, activeTab = 'video', onTabChange }: NexusGridProps) {
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
  }, [theme])

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden transition-colors duration-300" style={{ background: theme === 'dark' ? '#0a0a0a' : '#f5f5f5' }}>
      {/* Ambient Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute -top-40 -left-40 w-80 h-80 rounded-full blur-[100px] ${theme === 'dark' ? 'bg-cyan-500/10' : 'bg-cyan-500/20'}`} />
        <div className={`absolute -bottom-40 -right-40 w-80 h-80 rounded-full blur-[100px] ${theme === 'dark' ? 'bg-blue-500/10' : 'bg-blue-500/20'}`} />
      </div>
      
      {/* Content */}
      <div className="relative flex flex-col md:flex-row w-full h-full">
        {children}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  )
}

function MobileNav({ activeTab, onTabChange }: { activeTab: 'video' | 'chat', onTabChange?: (tab: 'video' | 'chat') => void }) {
  const { theme } = useTheme()
  
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t" style={{ 
      background: theme === 'dark' ? 'rgba(10,10,10,0.95)' : 'rgba(255,255,255,0.95)',
      borderColor: theme === 'dark' ? '#1f1f1f' : '#e5e5e5',
      backdropFilter: 'blur(12px)'
    }}>
      <div className="flex">
        <button
          onClick={() => onTabChange?.('video')}
          className={`flex-1 py-4 flex flex-col items-center gap-1 transition-all ${activeTab === 'video' ? 'text-cyan-500' : 'theme-text-muted'}`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-medium">Vídeo</span>
        </button>
        <button
          onClick={() => onTabChange?.('chat')}
          className={`flex-1 py-4 flex flex-col items-center gap-1 transition-all ${activeTab === 'chat' ? 'text-cyan-500' : 'theme-text-muted'}`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-xs font-medium">Chat</span>
        </button>
      </div>
    </div>
  )
}

interface ColumnProps {
  children: React.ReactNode
  width?: string
  className?: string
  mobileHidden?: boolean
  mobileOnly?: boolean
}

export function Column({ children, width = 'flex-1', className = '', mobileHidden, mobileOnly }: ColumnProps) {
  let responsiveClasses = ''
  if (mobileHidden) responsiveClasses = 'hidden md:block'
  if (mobileOnly) responsiveClasses = 'md:hidden'
  
  return (
    <div className={`${width} h-full ${className} ${responsiveClasses}`}>
      {children}
    </div>
  )
}
