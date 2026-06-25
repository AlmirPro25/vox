import React from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

interface Props {
  onLeaveRoom?: () => void
  onReport?: () => void
}

export function MobileHeader({ onLeaveRoom, onReport }: Props) {
  const { user, status, partnerInfo } = useNexusStore()

  return (
    <div className="md:hidden w-full glass border-b z-40" style={{ borderColor: 'var(--border-primary)' }}>
      <div className="flex items-center justify-between px-4 py-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold theme-text">VOX-BRIDGE</h1>
            <p className="text-[8px] theme-text-muted uppercase tracking-wider">
              {status === 'connected' && partnerInfo 
                ? `Connected to ${partnerInfo.anonymousId}` 
                : user?.anonymousId}
            </p>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-green-500 shadow-lg shadow-green-500/50' : 
              status === 'searching' ? 'bg-yellow-500 animate-pulse shadow-lg shadow-yellow-500/50' : 
              'bg-gray-500'
            }`} />
            <span className="text-xs theme-text-secondary capitalize hidden sm:inline">{status}</span>
          </div>

          {/* Report button */}
          {status === 'connected' && (
            <button
              onClick={onReport}
              className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </button>
          )}

          {/* Leave room button */}
          {status === 'connected' && (
            <button
              onClick={onLeaveRoom}
              className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          )}

          {/* Theme toggle */}
          <ThemeToggle />
        </div>
      </div>

      {/* Language bar */}
      <div className="flex items-center justify-center gap-3 px-4 py-2 border-t" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-hover)' }}>
        <span className="text-xs font-medium theme-text">{user?.nativeLanguage?.toUpperCase() || 'PT'}</span>
        <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
        <span className="text-xs font-medium text-cyan-400">{user?.targetLanguage?.toUpperCase() || 'EN'}</span>
      </div>
    </div>
  )
}
