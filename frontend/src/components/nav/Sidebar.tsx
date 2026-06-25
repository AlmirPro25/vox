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
          <div className="card border-green-500/20 bg-green-500/5 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-2 opacity-10">
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 10-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 10-2 0h-1a1 1 0 100 2h1a1 1 0 102 0zm-7 5a1 1 0 10-2 0v1a1 1 0 102 0v-1zM5.05 6.464a1 1 0 10-1.414-1.414l-.707.707a1 1 0 101.414 1.414l.707-.707zM5 10a1 1 0 10-2 0H2a1 1 0 100 2h1a1 1 0 102 0zm.757 4.893a1 1 0 101.414-1.414l-.707-.707a1 1 0 10-1.414 1.414l.707.707z" />
              </svg>
            </div>
            <p className="label mb-3 text-green-500/70">Connected</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center border border-green-500/30">
                  <span className="text-green-400 font-black uppercase text-xs">{partnerInfo.anonymousId?.slice(0, 2)}</span>
                </div>
                <div>
                  <p className="text-sm theme-text font-black uppercase tracking-tight">{partnerInfo.anonymousId}</p>
                  <p className="text-[10px] theme-text-muted font-bold uppercase tracking-widest">
                    {partnerInfo.country && `${partnerInfo.country} • `}
                    {partnerInfo.nativeLanguage?.toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Neural Stats */}
              <div className="pt-3 border-t border-white/5 space-y-2">
                <p className="text-[9px] font-black text-cyan-500/60 uppercase tracking-[0.2em] mb-2">Neural Stats</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 p-2 rounded-lg border border-white/5">
                    <p className="text-[8px] text-gray-500 font-bold uppercase">Latência IA</p>
                    <p className="text-[10px] font-mono text-cyan-400">0.8s</p>
                  </div>
                  <div className="bg-black/40 p-2 rounded-lg border border-white/5">
                    <p className="text-[8px] text-gray-500 font-bold uppercase">Segurança</p>
                    <p className="text-[10px] font-mono text-emerald-400">Ativa</p>
                  </div>
                </div>
              </div>

              {partnerInfo.commonInterests && partnerInfo.commonInterests.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-purple-500/60 uppercase tracking-[0.1em] mb-1.5">Conexão por Interesses</p>
                  <div className="flex flex-wrap gap-1.5">
                    {partnerInfo.commonInterests.map(i => (
                      <span key={i} className="px-2 py-0.5 bg-white/5 text-gray-400 border border-white/10 rounded text-[9px] font-bold uppercase tracking-tighter hover:border-cyan-500/50 transition-colors">
                        {i}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={onReport} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest text-yellow-500/70 hover:bg-yellow-500/10 rounded-xl transition-all border border-yellow-500/10">
                  Report
                </button>
                <button onClick={onLeaveRoom} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest text-red-500/70 hover:bg-red-500/10 rounded-xl transition-all border border-red-500/10">
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
