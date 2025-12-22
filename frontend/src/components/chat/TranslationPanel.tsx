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
    // Play sound for new messages from partner
    if (messages.length > prevMessageCount.current) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.senderId !== user?.anonymousId) {
        playMessage()
      }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    if (e.target.value && onTyping) onTyping()
  }

  const formatDuration = () => {
    if (!sessionStats.startTime) return '0:00'
    const diff = Math.floor((Date.now() - sessionStats.startTime.getTime()) / 1000)
    const mins = Math.floor(diff / 60)
    const secs = diff % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full p-4 flex flex-col">
      {/* Header */}
      <div className="mb-4 px-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold theme-text">Chat</h2>
            <p className="text-[10px] theme-text-muted uppercase tracking-widest">Real-time messaging</p>
          </div>
          {status === 'connected' && (
            <div className="text-right">
              <p className="text-xs text-cyan-400 font-mono">{formatDuration()}</p>
              <p className="text-[10px] theme-text-muted">{sessionStats.messageCount} msgs</p>
            </div>
          )}
        </div>
      </div>

      {/* Partner info banner */}
      {status === 'connected' && partnerInfo && (
        <div className="mx-2 mb-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <span className="text-green-400 font-bold text-xs">{partnerInfo.anonymousId?.slice(3, 5)}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-green-400 font-medium">{partnerInfo.anonymousId}</p>
              <p className="text-[10px] theme-text-muted">Speaks {partnerInfo.nativeLanguage?.toUpperCase()}</p>
            </div>
            <span className="status-dot status-online" />
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-2 space-y-3">
        {status === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--bg-hover)' }}>
              <svg className="w-8 h-8 theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="theme-text-secondary text-sm font-medium">No active conversation</p>
            <p className="theme-text-muted text-xs mt-1">Start a match to begin chatting</p>
          </div>
        )}

        {status === 'searching' && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div className="w-12 h-12 rounded-full border-2 border-t-cyan-500 animate-spin mb-4" style={{ borderColor: theme === 'dark' ? '#1f2937' : '#e5e7eb', borderTopColor: '#06b6d4' }} />
            <p className="theme-text-secondary text-sm">Finding someone to chat with...</p>
          </div>
        )}

        {status === 'connected' && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div className="text-4xl mb-4">👋</div>
            <p className="theme-text-secondary text-sm font-medium">Say hello!</p>
            <p className="theme-text-muted text-xs mt-1">Break the ice and start chatting</p>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.senderId === user?.anonymousId
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                isMe 
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-br-md' 
                  : `rounded-bl-md ${theme === 'dark' ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-900'}`
              }`}>
                {!isMe && <p className="text-[10px] mb-1 font-medium" style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}>{msg.senderId}</p>}
                <p className="text-sm leading-relaxed">{msg.originalText}</p>
                <p className={`text-[10px] mt-1 ${isMe ? 'text-white/60' : 'theme-text-muted'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}

        {/* Typing indicator */}
        {partnerTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3" style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }}>
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

      {/* Input area */}
      {status === 'connected' && (
        <div className="mt-4 px-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              className="input-dark flex-1 text-sm"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl font-medium text-sm hover:from-cyan-400 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 px-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
        <div className="flex items-center justify-between text-[10px] theme-text-muted">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-cyan-500 animate-pulse'}`} />
            <span>{status === 'connected' ? 'Live Chat' : 'AI Ready'}</span>
          </div>
          <span>End-to-end encrypted</span>
        </div>
      </div>
    </div>
  )
}
