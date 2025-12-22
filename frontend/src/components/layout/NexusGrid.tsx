import React, { useEffect, useState } from 'react'
import { useTheme } from '@/hooks/useTheme'

interface NexusGridProps {
  children: React.ReactNode
  activeTab?: 'main' | 'chat'
  onTabChange?: (tab: 'main' | 'chat') => void
}

export function NexusGrid({ children, activeTab = 'main', onTabChange }: NexusGridProps) {
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.classList.add(theme)
  }, [theme])

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden transition-colors duration-300" style={{ background: 'var(--bg-primary)' }}>
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute top-0 left-1/4 w-96 h-96 rounded-full blur-[120px] transition-opacity duration-500 ${theme === 'dark' ? 'bg-cyan-500/5' : 'bg-cyan-500/10'}`} />
        <div className={`absolute bottom-0 right-1/4 w-96 h-96 rounded-full blur-[120px] transition-opacity duration-500 ${theme === 'dark' ? 'bg-blue-500/5' : 'bg-blue-500/10'}`} />
      </div>
      
      {/* Grid pattern */}
      <div className={`fixed inset-0 pointer-events-none transition-opacity duration-300 ${theme === 'dark' ? 'opacity-[0.02]' : 'opacity-[0.03]'}`}
        style={{
          backgroundImage: theme === 'dark' 
            ? `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`
            : `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}
      />
      
      {/* Content */}
      <div className="relative flex flex-col md:flex-row w-full h-full">
        {children}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  )
}

function MobileNav({ activeTab, onTabChange }: { activeTab: 'main' | 'chat', onTabChange?: (tab: 'main' | 'chat') => void }) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t" style={{ borderColor: 'var(--border-primary)' }}>
      <div className="flex">
        <button
          onClick={() => onTabChange?.('main')}
          className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'main' ? 'text-cyan-400' : 'theme-text-muted'}`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-medium">Connect</span>
        </button>
        <button
          onClick={() => onTabChange?.('chat')}
          className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === 'chat' ? 'text-cyan-400' : 'theme-text-muted'}`}
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
