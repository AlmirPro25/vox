import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'
import { useSound } from '@/hooks/useSound'
import { MediaUpload, MediaType } from './MediaUpload'
import { MediaPreview } from './MediaPreview'
import { MediaViewer } from './MediaViewer'
import { compressImage, formatBytes } from '@/lib/imageCompress'

interface MediaFile {
  type: MediaType
  file: File
  preview: string
  duration?: number
}

interface Props {
  onSendMessage?: (message: string) => void
  onSendMedia?: (type: MediaType, data: string, fileName: string, clientId: string) => boolean
  onTyping?: () => void
}

// Lê um File/Blob como data URL (base64)
function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('read_failed'))
    reader.readAsDataURL(file)
  })
}

function createClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function TranslationPanel({ onSendMessage, onSendMedia, onTyping }: Props) {
  const { status, messages, partnerInfo, user, partnerTyping, sessionStats } = useNexusStore()
  const { theme } = useTheme()
  const { playMessage } = useSound()
  const [input, setInput] = useState('')
  const [showMediaUpload, setShowMediaUpload] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null)
  const [mediaSending, setMediaSending] = useState(false)
  const [viewingMedia, setViewingMedia] = useState<{ type: MediaType; url: string; fileName?: string } | null>(null)
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

  // Handle paste event for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const preview = URL.createObjectURL(file)
          setSelectedMedia({ type: 'image', file, preview })
        }
        return
      }
    }
  }, [])

  // Revoga a object URL do preview atual (evita memory leak de blobs)
  const revokePreview = useCallback((media: MediaFile | null) => {
    if (media?.preview?.startsWith('blob:')) {
      try { URL.revokeObjectURL(media.preview) } catch {}
    }
  }, [])

  // Handle media selection
  const handleMediaSelect = useCallback((media: MediaFile) => {
    setSelectedMedia(media)
    setShowMediaUpload(false)
  }, [])

  // Cancela seleção de mídia (revoga blob)
  const handleCancelMedia = useCallback(() => {
    revokePreview(selectedMedia)
    setSelectedMedia(null)
  }, [selectedMedia, revokePreview])

  // Send media (com compressão de imagem + estado "enviando")
  const handleSendMedia = useCallback(async () => {
    if (!selectedMedia || !onSendMedia || mediaSending) return

    setMediaSending(true)
    try {
      let dataUrl: string
      let fileName = selectedMedia.file.name
      let previewUrl = selectedMedia.preview

      // Imagens são comprimidas antes do envio (reduz ~10x o payload)
      if (selectedMedia.type === 'image') {
        try {
          const compressed = await compressImage(selectedMedia.file, {
            maxDim: 1280,
            quality: 0.8,
          })
          dataUrl = compressed.dataUrl
          fileName = compressed.file.name
          // Log de economia (apenas dev)
          if (compressed.originalSize > 256 * 1024) {
            console.log(
              `🖼️ Compressed: ${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.compressedSize)}` +
              ` (${compressed.width}×${compressed.height})`
            )
          }
        } catch (err) {
          console.warn('Image compression failed, sending original:', err)
          dataUrl = await fileToDataUrl(selectedMedia.file)
        }
      } else {
        // Áudio/vídeo: envia como está (sem recompressão client-side)
        dataUrl = await fileToDataUrl(selectedMedia.file)
      }

      const clientId = createClientId()

      // Adiciona à UI local imediatamente, mas como "sending" até o servidor confirmar.
      const label =
        selectedMedia.type === 'image' ? '📷 Imagem' :
        selectedMedia.type === 'video' ? '🎬 Vídeo' : '🎤 Áudio'

      const newMessage: any = {
        id: clientId,
        senderId: user?.anonymousId || 'me',
        originalText: `[${label}]`,
        translatedText: '',
        timestamp: new Date(),
        isAiOptimized: false,
        mediaType: selectedMedia.type,
        mediaUrl: previewUrl,
        fileName,
        status: 'sending',
        retryPayload: { kind: 'media', data: { type: selectedMedia.type, data: dataUrl, fileName, clientId } },
      }
      useNexusStore.getState().addMessage(newMessage)

      const acceptedForSend = onSendMedia(selectedMedia.type, dataUrl, fileName, clientId)
      if (!acceptedForSend) {
        useNexusStore.getState().updateMessage(clientId, {
          status: 'failed',
          originalText: 'Conexão indisponível. Tente enviar novamente.',
        })
      }

      // Limpa seleção (NÃO revoga o previewUrl: ele foi reusado pela msg local)
      setSelectedMedia(null)
    } catch (err) {
      console.error('Media send failed:', err)
    } finally {
      setMediaSending(false)
    }
  }, [selectedMedia, onSendMedia, mediaSending, user?.anonymousId])

  // Limpa blob pendente ao desmontar
  useEffect(() => {
    return () => revokePreview(selectedMedia)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatDuration = () => {
    if (!sessionStats.startTime) return '0:00'
    const diff = Math.floor((Date.now() - sessionStats.startTime.getTime()) / 1000)
    return `${Math.floor(diff / 60)}:${(diff % 60).toString().padStart(2, '0')}`
  }

  const isDark = theme === 'dark'
  const canChat = status === 'connected'

  return (
    <div className="h-full w-full min-w-0 flex flex-col overflow-hidden" style={{ background: isDark ? '#0a0a0a' : '#fff' }}>
      {/* Header */}
      <div className="shrink-0 p-3 md:p-4 border-b" style={{ borderColor: isDark ? '#222' : '#eee' }}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold" style={{ color: isDark ? '#fff' : '#111' }}>Chat</h2>
              <p className="text-xs" style={{ color: canChat ? '#22c55e' : isDark ? '#777' : '#777' }}>
                {canChat ? 'Conversa em tempo real' : status === 'searching' ? 'Buscando uma conexão' : 'Mensagens e arquivos'}
              </p>
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4 space-y-3 min-h-0">
        {status === 'idle' && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3" style={{ background: isDark ? '#1a1a1a' : '#f5f5f5' }}>
              <svg className="w-8 h-8" style={{ color: isDark ? '#444' : '#999' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="font-medium" style={{ color: isDark ? '#fff' : '#111' }}>Seu chat começa aqui</p>
            <p className="max-w-[240px] text-sm mt-1" style={{ color: isDark ? '#777' : '#777' }}>
              Encontre alguém para trocar mensagens, imagens, vídeos e áudios.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px]" style={{ color: isDark ? '#888' : '#666' }}>
              <span className="rounded-full border px-2.5 py-1" style={{ borderColor: isDark ? '#2a2a2a' : '#ddd' }}>Imagem</span>
              <span className="rounded-full border px-2.5 py-1" style={{ borderColor: isDark ? '#2a2a2a' : '#ddd' }}>Vídeo</span>
              <span className="rounded-full border px-2.5 py-1" style={{ borderColor: isDark ? '#2a2a2a' : '#ddd' }}>Áudio</span>
            </div>
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
          const hasMedia = (msg as any).mediaType && (msg as any).mediaUrl
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[min(85%,22rem)] min-w-0 ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                {!isMe && (
                  <span className="text-[10px] font-black text-cyan-500 mb-1 ml-1 uppercase tracking-tighter">
                    {msg.senderId}
                  </span>
                )}
                <div className={`
                  rounded-2xl shadow-sm overflow-hidden max-w-full
                  ${isMe
                    ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-br-none shadow-cyan-500/20'
                    : `${isDark ? 'bg-[#1a1a1a] text-white border border-white/5' : 'bg-gray-100 text-gray-800'} rounded-bl-none`
                  }
                `}>
                  {/* Media content */}
                  {hasMedia && (
                    <div className="max-w-[min(280px,78vw)]">
                      {(msg as any).mediaType === 'image' && (
                        <img
                          src={(msg as any).mediaUrl}
                          alt="Imagem"
                          className="w-full h-auto max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setViewingMedia({
                            type: 'image',
                            url: (msg as any).mediaUrl,
                            fileName: (msg as any).fileName,
                          })}
                        />
                      )}
                      {(msg as any).mediaType === 'video' && (
                        <div className="relative">
                          <video
                            src={(msg as any).mediaUrl}
                            controls
                            className="w-full h-auto max-h-64"
                          />
                          <button
                            onClick={() => setViewingMedia({
                              type: 'video',
                              url: (msg as any).mediaUrl,
                              fileName: (msg as any).fileName,
                            })}
                            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
                            title="Abrir em tela cheia"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {(msg as any).mediaType === 'audio' && (
                        <div className="w-full max-w-[78vw] p-3">
                          <audio src={(msg as any).mediaUrl} controls className="h-10 w-full max-w-full" />
                          <button
                            onClick={() => setViewingMedia({
                              type: 'audio',
                              url: (msg as any).mediaUrl,
                              fileName: (msg as any).fileName,
                            })}
                            className="mt-2 flex items-center gap-1.5 text-[10px] text-current opacity-60 hover:opacity-100 transition-opacity"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Salvar áudio
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Text content */}
                  {!hasMedia && (
                    <div className="px-4 py-3 text-sm leading-relaxed break-words">
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
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 px-1">
                  <span className={`text-[9px] font-medium uppercase ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && (
                    msg.status === 'sending' ? (
                      <span className={`text-[9px] font-medium uppercase ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Enviando
                      </span>
                    ) : msg.status === 'failed' ? (
                      <span className="text-[9px] font-medium uppercase text-red-400">
                        Falhou
                      </span>
                    ) : (
                      <svg className="w-3 h-3 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )
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

      {/* Composer */}
      <div
        className="shrink-0 relative border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 md:p-4"
        style={{ borderColor: isDark ? '#222' : '#eee', background: isDark ? '#0a0a0a' : '#fff' }}
      >
          {!canChat && (
            <p className="mb-2 truncate text-center text-[11px]" style={{ color: isDark ? '#777' : '#777' }}>
              {status === 'searching' ? 'O chat será liberado quando alguém conectar.' : 'Inicie uma conexão para enviar mensagens e arquivos.'}
            </p>
          )}

          {/* Media Upload Panel */}
          {canChat && showMediaUpload && (
            <MediaUpload
              onMediaSelect={handleMediaSelect}
              onClose={() => setShowMediaUpload(false)}
              isDark={isDark}
            />
          )}

          {/* Media Preview */}
          {canChat && selectedMedia && (
            <MediaPreview
              type={selectedMedia.type}
              preview={selectedMedia.preview}
              onSend={handleSendMedia}
              onCancel={handleCancelMedia}
              isDark={isDark}
              isSending={mediaSending}
            />
          )}

          <div className="flex min-w-0 items-center gap-2 bg-transparent">
            {/* Attach button */}
            <button
              onClick={() => setShowMediaUpload(!showMediaUpload)}
              disabled={!canChat}
              title={canChat ? 'Enviar imagem, vídeo ou áudio' : 'Conecte para enviar arquivos'}
              className={`h-11 w-11 shrink-0 flex items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40 md:h-12 md:w-12 ${
                showMediaUpload
                  ? 'bg-cyan-500 text-white'
                  : isDark 
                    ? 'bg-[#161616] text-gray-400 hover:text-white hover:bg-[#222]' 
                    : 'bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            <div className="flex-1 min-w-0 relative group">
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                onPaste={handlePaste}
                disabled={!canChat}
                placeholder={canChat ? 'Escreva uma mensagem...' : 'Aguardando conexão...'}
                className={`
                  h-11 w-full min-w-0 px-4 rounded-xl text-sm outline-none transition-all disabled:cursor-not-allowed disabled:opacity-60 md:h-12
                  ${isDark
                    ? 'bg-[#161616] text-white border border-white/5 focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10'
                    : 'bg-gray-50 text-gray-900 border border-gray-200 focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/5'
                  }
                `}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!canChat || !input.trim()}
              title="Enviar mensagem"
              className="group h-11 w-11 shrink-0 flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-xl shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-30 transition-all active:scale-90 md:h-12 md:w-12"
            >
              <svg className="w-5 h-5 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
      </div>

      {/* Media Viewer (lightbox fullscreen) */}
      {viewingMedia && (
        <MediaViewer
          type={viewingMedia.type}
          url={viewingMedia.url}
          fileName={viewingMedia.fileName}
          onClose={() => setViewingMedia(null)}
        />
      )}
    </div>
  )
}
