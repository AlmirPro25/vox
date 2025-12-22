import React from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

export function VideoStage() {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()

  return (
    <div className="h-full w-full flex items-center justify-center relative overflow-hidden transition-colors duration-300" style={{ background: theme === 'dark' ? 'linear-gradient(135deg, rgba(17,17,17,0.5) 0%, rgba(0,0,0,1) 50%, rgba(17,17,17,0.5) 100%)' : 'linear-gradient(135deg, rgba(241,245,249,1) 0%, rgba(226,232,240,1) 50%, rgba(241,245,249,1) 100%)' }}>
      
      {/* Idle State */}
      {status === 'idle' && (
        <div className="relative text-center z-10 px-4">
          <div className="relative mb-6 md:mb-8">
            <div className="absolute inset-0 w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full border border-cyan-500/20 animate-pulse" />
            <div className="w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center glow-cyan animate-float">
              <svg className="w-10 h-10 md:w-14 md:h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl md:text-2xl font-bold theme-text mb-2">Ready to Connect</h2>
          <p className="theme-text-secondary text-sm mb-2">Break language barriers instantly</p>
        </div>
      )}

      {/* Searching State */}
      {status === 'searching' && (
        <div className="relative text-center z-10 px-4">
          <div className="relative mb-6 md:mb-8">
            <div className="absolute inset-0 w-24 h-24 md:w-32 md:h-32 mx-auto">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping" style={{ animationDuration: '2s' }} />
            </div>
            <div className="w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full border-4 border-t-cyan-500 animate-spin" style={{ animationDuration: '1.5s', borderColor: theme === 'dark' ? '#1f2937' : '#e5e7eb', borderTopColor: '#06b6d4' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center" style={{ background: theme === 'dark' ? '#111' : '#f1f5f9' }}>
                <svg className="w-6 h-6 md:w-8 md:h-8 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>
          <h2 className="text-lg md:text-xl font-semibold theme-text mb-2">Searching...</h2>
          <p className="theme-text-secondary text-sm">Matching by language</p>
        </div>
      )}

      {/* Connected State */}
      {status === 'connected' && partnerInfo && (
        <div className="relative text-center z-10 w-full max-w-md px-4 md:px-8">
          <div className="relative mb-6 md:mb-8">
            <div className="absolute inset-0 w-28 h-28 md:w-40 md:h-40 mx-auto rounded-full bg-green-500/20 blur-2xl" />
            <div className="relative w-28 h-28 md:w-40 md:h-40 mx-auto rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center glow-green">
              <span className="text-3xl md:text-5xl font-bold text-white">
                {partnerInfo.anonymousId?.slice(3, 5).toUpperCase()}
              </span>
            </div>
            <div className="absolute bottom-1 md:bottom-2 right-1/2 translate-x-8 md:translate-x-10 w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center" style={{ background: theme === 'dark' ? '#111' : '#f1f5f9' }}>
              <span className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-green-500 animate-pulse" />
            </div>
          </div>
          
          <h2 className="text-xl md:text-2xl font-bold theme-text mb-1">{partnerInfo.anonymousId}</h2>
          <p className="theme-text-secondary text-sm mb-4 md:mb-6">
            Speaks: <span className="text-green-400 font-medium">{partnerInfo.nativeLanguage?.toUpperCase()}</span>
          </p>
          
          <div className="inline-flex items-center gap-2 px-3 md:px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-400 text-xs md:text-sm font-medium">Connected</span>
          </div>
          
          <div className="mt-6 md:mt-8 p-3 md:p-4 rounded-xl hidden md:block" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center justify-center gap-2 theme-text-muted text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Use the chat panel to communicate</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
