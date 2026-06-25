'use client'

import React, { useRef, useState, useCallback } from 'react'

export type MediaType = 'image' | 'audio' | 'video'

interface MediaFile {
  type: MediaType
  file: File
  preview: string
  duration?: number // para áudio/vídeo
}

interface Props {
  onMediaSelect: (media: MediaFile) => void
  onClose: () => void
  isDark: boolean
}

const MAX_FILE_SIZE = 12 * 1024 * 1024

// MIME types aceitos (alinhado com o backend ALLOWED_MEDIA_TYPES)
const ACCEPTED_MIME: Record<MediaType, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/3gpp'],
  audio: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/aac', 'audio/x-m4a'],
}

function detectMediaType(mime: string): MediaType | null {
  for (const [type, mimes] of Object.entries(ACCEPTED_MIME)) {
    if (mimes.includes(mime.toLowerCase())) return type as MediaType
  }
  return null
}

export function MediaUpload({ onMediaSelect, onClose, isDark }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Handle file selection (image/video)
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      setError(`O arquivo deve ter no máximo 12 MB (recebido: ${(file.size / 1048576).toFixed(1)} MB).`)
      e.target.value = ''
      return
    }

    // Detecção robusta de tipo (não usa fallback perigoso p/ "audio")
    const detected = detectMediaType(file.type)
    if (!detected) {
      setError(`Formato não suportado: ${file.type || 'desconhecido'}. Use imagem, vídeo ou áudio comum.`)
      e.target.value = ''
      return
    }

    setError('')
    const preview = URL.createObjectURL(file)
    onMediaSelect({ type: detected, file, preview })
  }, [onMediaSelect])

  // Handle paste from clipboard
  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const file = new File([blob], `paste-${Date.now()}.png`, { type })
            const preview = URL.createObjectURL(file)
            onMediaSelect({ type: 'image', file, preview })
            return
          }
        }
      }
    } catch (err) {
      console.log('Clipboard access denied or empty')
    }
  }, [onMediaSelect])

  // Start audio recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: 'audio/webm' })
        const preview = URL.createObjectURL(blob)
        onMediaSelect({ type: 'audio', file, preview, duration: recordingTime })
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      
      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1)
      }, 1000)
    } catch (err) {
      console.error('Mic access denied:', err)
    }
  }, [onMediaSelect, recordingTime])

  // Stop audio recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isRecording])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-[55dvh] overflow-y-auto p-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-2 duration-200"
      style={{ 
        background: isDark ? '#1a1a1a' : '#fff',
        borderColor: isDark ? '#333' : '#e5e5e5'
      }}>
      
      {/* Recording UI */}
      {isRecording ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-500 font-mono">{formatTime(recordingTime)}</span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Gravando áudio...</span>
          </div>
          <button
            onClick={stopRecording}
            className="px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
          >
            Parar
          </button>
        </div>
      ) : (
        <>
          {/* Media options */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Enviar mídia:
            </span>
            <button onClick={onClose} className="ml-auto p-1 rounded-lg hover:bg-gray-500/20">
              <svg className="w-4 h-4" style={{ color: isDark ? '#888' : '#666' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {/* Image */}
            <button
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = 'image/*'
                  fileInputRef.current.click()
                }
              }}
              className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl transition-colors ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Imagem</span>
            </button>

            {/* Video */}
            <button
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = 'video/*'
                  fileInputRef.current.click()
                }
              }}
              className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl transition-colors ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <span className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Vídeo</span>
            </button>

            {/* Audio */}
            <button
              onClick={startRecording}
              className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl transition-colors ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <span className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Áudio</span>
            </button>

            {/* Paste */}
            <button
              onClick={handlePaste}
              className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-xl transition-colors ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <span className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Colar</span>
            </button>
          </div>

          {error && <p className="mt-3 text-xs font-medium text-red-500">{error}</p>}
          <p className={`mt-3 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            Imagem, vídeo ou áudio de até 12 MB.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
        </>
      )}
    </div>
  )
}
