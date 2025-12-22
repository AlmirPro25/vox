import React, { useState, useRef, useEffect } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'
import { useSound } from '@/hooks/useSound'

interface Props {
  onSendMessage?: (message: string) => void
  onTyping?: () => void
}

export function TranslationPanel({ onSendMessage, onTyping }: Props) {
  const { status, messages, partnerInfo, user, partnerTyping, sessionStats } = useNexusStore()
  const { theme } = useTheme()
  const { playMessage } = useSound()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(messages.length)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (messages.length > prevMessageCount.current) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.senderId !== user?.anonymousId) playMessage()
    }
    prevMessageCount.current = messages.length
  }, [messages, user?.anonymousId, playMessage])

  const handleSend = () => {
    if (!input.trim() || !onSendMessage) return
    useNexusStore.getState().addMessage({
      id: Date.now().toString(),
      senderId: user?.anonymousId || 'me',
      originalText: input,
      translatedText: input,
      timestamp: new Date(),
      isAiOptimized: false
    })
    onSendMessage(input)
    setInput('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    if (e.target.value && onTyping) onTyping()
  }

  const formatDuration = () => {
    if (!sessionStats.startTime) return '0:00'
    const diff = Math.floor((Date.now() - sessionStats.startTime.getTime()) / 1000)
    return `${Math.floor(diff / 60)}:${(diff % 60).toString().padStart(2, '0')}`
  }

  const isDark = theme === 'dark'

  return (
    <div className="h-full w-full flex flex-col" style={{ background: isDark ? '#0a0a0a' : '#fff' }}>
      {/* Header */}
      <div className="shrink-0 p-4 border-b" style={{ borderColor: isDark ? '#222' : '#eee' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold" style={{ color: isDark ? '#fff' : '#111' }}>Chat</h2>
              <p className="text-xs" style={{ color: isDark ? '#666' : '#888' }}>Mensagens</p>
            </div>
          </div>
          {status === 'connected' && (
            <div className="text-right">
              <p className="text-sm font-mono text-cyan-500">{formatDuration()}</p>
              <p className="text-xs" style={{ color: isDark ? '#666' : '#888' }}>{sessionStats.messageCount} msgs</p>
            </div>
          )}
        </div>
      </div>

      {/* Partner Banner */}
      {status === 'connected' && partnerInfo && (
        <div className="shrink-0 mx-4 mt-3 p-3 rounded-xl" style={{ background: isDark ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">{partnerInfo.anonymousId?.slice(0, 2)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-green-500 text-sm truncate">{partnerInfo.anonymousId}</p>
              <div className="flex items-center gap-2">
                {partnerInfo.nativeLanguage && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                    Fala {partnerInfo.nativeLanguage?.toUpperCase()}
                  </span>
                )}
                {partnerInfo.commonInterests && partnerInfo.commonInterests.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                    {partnerInfo.commonInterests.length} interesse{partnerInfo.commonInterests.length > 1 ? 's' : ''} em comum
                  </span>
                )}
              </div>
            </div>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {status === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3" style={{ background: isDark ? '#1a1a1a' : '#f5f5f5' }}>
              <svg className="w-8 h-8" style={{ color: isDark ? '#444' : '#999' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="font-medium" style={{ color: isDark ? '#fff' : '#111' }}>Sem conversa</p>
            <p className="text-sm mt-1" style={{ color: isDark ? '#666' : '#888' }}>Conecte para conversar</p>
          </div>
        )}

        {status === 'searching' && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin mb-3" />
            <p style={{ color: isDark ? '#888' : '#666' }}>Procurando...</p>
          </div>
        )}

        {status === 'connected' && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-4xl mb-3">👋</div>
            <p className="font-medium" style={{ color: isDark ? '#fff' : '#111' }}>Diga olá!</p>
            <p className="text-sm mt-1" style={{ color: isDark ? '#666' : '#888' }}>Comece a conversar</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.senderId === user?.anonymousId
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                {!isMe && (
                  <span className="text-[10px] font-black text-cyan-500 mb-1 ml-1 uppercase tracking-tighter">
                    {msg.senderId}
                  </span>
                )}
                <div className={`
                  px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed
                  ${isMe
                    ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-br-none shadow-cyan-500/20'
                    : `${isDark ? 'bg-[#1a1a1a] text-white border border-white/5' : 'bg-gray-100 text-gray-800'} rounded-bl-none`
                  }
                `}>
                  <p>{msg.originalText}</p>
                  {msg.translatedText && msg.translatedText !== msg.originalText && (
                    <div className={`mt-2 pt-2 border-t ${isMe ? 'border-white/20' : 'border-white/5'} text-[13px] italic opacity-90`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <svg className="w-3 h-3 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                        <span className="text-[10px] font-black uppercase tracking-widest text-cyan-500">Neural Bridge</span>
                      </div>
                      <p>{msg.translatedText}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 px-1">
                  <span className={`text-[9px] font-medium uppercase ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && (
                    <svg className="w-3 h-3 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {partnerTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm px-4 py-3" style={{ background: isDark ? '#1a1a1a' : '#f0f0f0' }}>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input - fixed at bottom */}
      {status === 'connected' && (
        <div className="shrink-0 p-4 border-t" style={{ borderColor: isDark ? '#222' : '#eee' }}>
          <div className="flex items-center gap-2 bg-transparent">
            <div className="flex-1 relative group">
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Escreva sua mensagem..."
                className={`
                  w-full px-5 py-3.5 rounded-2xl text-sm outline-none transition-all
                  ${isDark
                    ? 'bg-[#161616] text-white border border-white/5 focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10'
                    : 'bg-gray-50 text-gray-900 border border-gray-200 focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/5'
                  }
                `}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="group h-[48px] w-[48px] flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-2xl shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 disabled:opacity-30 transition-all active:scale-90"
            >
              <svg className="w-5 h-5 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
