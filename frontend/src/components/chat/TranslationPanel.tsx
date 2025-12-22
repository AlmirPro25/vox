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

  return (
    <div className="h-full flex flex-col" style={{ background: theme === 'dark' ? '#0d0d0d' : '#fafafa' }}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: theme === 'dark' ? '#1f1f1f' : '#e5e5e5' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold theme-text">Bater papo</h2>
              <p className="text-xs theme-text-muted">Mensagens em tempo real</p>
            </div>
          </div>
          {status === 'connected' && (
            <div className="text-right">
              <p className="text-sm font-mono text-cyan-500">{formatDuration()}</p>
              <p className="text-xs theme-text-muted">{sessionStats.messageCount} msgs</p>
            </div>
          )}
        </div>
      </div>

      {/* Partner Banner */}
      {status === 'connected' && partnerInfo && (
        <div className="mx-4 mt-4 p-3 rounded-2xl" style={{ background: theme === 'dark' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-sm">{partnerInfo.anonymousId?.slice(0, 2)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-500 truncate">{partnerInfo.anonymousId}</p>
              <p className="text-xs theme-text-muted">Fala {partnerInfo.nativeLanguage?.toUpperCase()}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-500 font-medium">Online</span>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {status === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style={{ background: theme === 'dark' ? '#1a1a1a' : '#f0f0f0' }}>
              <svg className="w-10 h-10 theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="theme-text font-medium">Nenhuma conversa ativa</p>
            <p className="theme-text-muted text-sm mt-1">Inicie uma conexão para conversar</p>
          </div>
        )}

        {status === 'searching' && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-full border-3 border-cyan-500/30 border-t-cyan-500 animate-spin mb-4" />
            <p className="theme-text-secondary">Procurando alguém...</p>
          </div>
        )}

        {status === 'connected' && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-5xl mb-4">👋</div>
            <p className="theme-text font-medium text-lg">Diga olá!</p>
            <p className="theme-text-muted text-sm mt-1">Quebre o gelo e comece a conversar</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.senderId === user?.anonymousId
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${isMe ? 'order-2' : ''}`}>
                {!isMe && (
                  <p className="text-xs theme-text-muted mb-1 ml-3 font-medium">{msg.senderId}</p>
                )}
                <div className={`rounded-2xl px-4 py-2.5 ${
                  isMe 
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-br-sm' 
                    : `rounded-bl-sm ${theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-white border border-gray-200'}`
                }`} style={!isMe ? { color: theme === 'dark' ? '#fff' : '#1a1a1a' } : {}}>
                  <p className="text-[15px] leading-relaxed">{msg.originalText}</p>
                </div>
                <p className={`text-[10px] mt-1 ${isMe ? 'text-right mr-2' : 'ml-3'} theme-text-muted`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}

        {partnerTyping && (
          <div className="flex justify-start">
            <div className={`rounded-2xl rounded-bl-sm px-4 py-3 ${theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-white border border-gray-200'}`}>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {status === 'connected' && (
        <div className="p-4 border-t" style={{ borderColor: theme === 'dark' ? '#1f1f1f' : '#e5e5e5' }}>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Digite sua mensagem..."
              className="flex-1 px-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              style={{ 
                background: theme === 'dark' ? '#1a1a1a' : '#fff',
                border: `1px solid ${theme === 'dark' ? '#2a2a2a' : '#e5e5e5'}`,
                color: theme === 'dark' ? '#fff' : '#1a1a1a'
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl font-medium hover:from-cyan-400 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg shadow-cyan-500/20"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t flex items-center justify-between text-xs theme-text-muted" style={{ borderColor: theme === 'dark' ? '#1f1f1f' : '#e5e5e5' }}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-cyan-500 animate-pulse'}`} />
          <span>{status === 'connected' ? 'Chat ao vivo' : 'Aguardando'}</span>
        </div>
        <span>Criptografia de ponta a ponta</span>
      </div>
    </div>
  )
}
