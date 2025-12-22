import React, { useState } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LanguageSelector } from '@/components/ui/LanguageSelector'
import { InterestSelector } from '@/components/ui/InterestSelector'

interface Props {
  onLeaveRoom?: () => void
  onUpdateLanguages?: (native: string, target: string) => void
  onUpdateInterests?: (interests: string[]) => void
  onReport?: () => void
}

export function Sidebar({ onLeaveRoom, onUpdateLanguages, onUpdateInterests, onReport }: Props) {
  const { user, status, partnerInfo, roomID } = useNexusStore()
  const [showSettings, setShowSettings] = useState(false)
  const [nativeLang, setNativeLang] = useState<string>(user?.nativeLanguage || 'pt')
  const [targetLang, setTargetLang] = useState<string>(user?.targetLanguage || 'en')
  const [interests, setInterests] = useState<string[]>(user?.interests || [])

  const handleSave = () => {
    onUpdateLanguages?.(nativeLang, targetLang)
    onUpdateInterests?.(interests)
    setShowSettings(false)
  }

  return (
    <div className="h-full p-4 flex flex-col">
      {/* Logo */}
      <div className="mb-6 px-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold theme-text">VOX-BRIDGE</h1>
            <p className="text-[10px] theme-text-muted uppercase tracking-widest">Global Nexus</p>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="px-2 mb-4">
        <div className="card flex items-center justify-between">
          <span className="text-sm theme-text-secondary">Theme</span>
          <ThemeToggle />
        </div>
      </div>

      <div className="space-y-3 flex-1 overflow-y-auto">
        {/* Status */}
        <div className="card">
          <p className="label mb-3">Status</p>
          <div className="flex items-center gap-3">
            <span className={`status-dot ${status === 'connected' ? 'status-online' : status === 'searching' ? 'status-searching' : 'status-offline'}`} />
            <span className="text-sm font-medium theme-text capitalize">{status}</span>
          </div>
        </div>

        {/* Identity */}
        {user && (
          <div className="card">
            <p className="label mb-3">Identity</p>
            <p className="text-sm font-mono text-cyan-400">{user.anonymousId}</p>
            <p className="text-xs theme-text-muted mt-1">🇧🇷 {user.country}</p>
          </div>
        )}

        {/* Settings Panel */}
        {status === 'idle' && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="label">Preferences</p>
              <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-cyan-400">
                {showSettings ? 'Close' : 'Edit'}
              </button>
            </div>
            
            {showSettings ? (
              <div className="space-y-4">
                <LanguageSelector value={nativeLang} onChange={setNativeLang} label="I speak" />
                <LanguageSelector value={targetLang} onChange={setTargetLang} label="I want to practice" />
                <InterestSelector selected={interests} onChange={setInterests} />
                <button onClick={handleSave} className="w-full py-2.5 bg-cyan-500 text-white rounded-xl text-sm font-medium">
                  Save
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm theme-text">{user?.nativeLanguage?.toUpperCase()}</span>
                  <span className="text-cyan-500">→</span>
                  <span className="text-sm text-cyan-400">{user?.targetLanguage?.toUpperCase()}</span>
                </div>
                {user?.interests && user.interests.length > 0 && (
                  <p className="text-xs theme-text-muted">{user.interests.length} interests selected</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Room Info */}
        {status === 'connected' && roomID && partnerInfo && (
          <div className="card border-green-500/20 bg-green-500/5">
            <p className="label mb-3 text-green-500/70">Connected</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <span className="text-green-400 font-bold">{partnerInfo.anonymousId?.slice(3, 5)}</span>
                </div>
                <div>
                  <p className="text-sm theme-text font-medium">{partnerInfo.anonymousId}</p>
                  <p className="text-xs theme-text-muted">
                    {partnerInfo.country && `🌍 ${partnerInfo.country} • `}
                    Speaks {partnerInfo.nativeLanguage?.toUpperCase()}
                  </p>
                </div>
              </div>
              
              {partnerInfo.commonInterests && partnerInfo.commonInterests.length > 0 && (
                <div>
                  <p className="text-[10px] theme-text-muted mb-1">Common interests</p>
                  <div className="flex flex-wrap gap-1">
                    {partnerInfo.commonInterests.map(i => (
                      <span key={i} className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">{i}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={onReport} className="flex-1 py-2 text-xs text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">
                  Report
                </button>
                <button onClick={onLeaveRoom} className="flex-1 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                  Leave
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-4 border-t theme-border">
        <div className="flex items-center justify-center gap-2 text-[10px] theme-text-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/50" />
          <span>Powered by Gemini AI</span>
        </div>
      </div>
    </div>
  )
}
