'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { MediaType } from './MediaUpload'

/**
 * MediaViewer — Lightbox fullscreen para mídia recebida no chat.
 *
 * Substitui o `window.open(mediaUrl)` que quebra no APK (Capacitor).
 * Recursos:
 *  - Imagem: zoom (duplo clique / pinch via wheel), pan (arrastar), reset
 *  - Vídeo/Áudio: player nativo fullscreen
 *  - Download: browser (web) ou Capacitor Share/Filesystem (nativo, se disponível)
 *  - Fechar: ESC, clique fora, swipe-down (mobile), botão X
 */

interface Props {
  type: MediaType
  url: string
  fileName?: string
  onClose: () => void
}

export function MediaViewer({ type, url, fileName, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingNatively, setDownloadingNatively] = useState(false)
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const touchStartY = useRef<number | null>(null)

  // ESC para fechar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ' && type === 'image') {
        e.preventDefault()
        toggleZoom()
      }
    }
    window.addEventListener('keydown', onKey)
    // Travar scroll do body enquanto aberto
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPos({ x: 0, y: 0 })
  }, [])

  const toggleZoom = useCallback(() => {
    setZoom((z) => {
      if (z === 1) return 2.5
      resetView()
      return 1
    })
  }, [resetView])

  // Pan com mouse
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom === 1) return
    setIsPanning(true)
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !dragStart.current) return
    setPos({
      x: dragStart.current.px + (e.clientX - dragStart.current.x),
      y: dragStart.current.py + (e.clientY - dragStart.current.y),
    })
  }
  const endPan = () => {
    setIsPanning(false)
    dragStart.current = null
  }

  // Zoom com wheel
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.2 : 0.2
    setZoom((z) => {
      const next = Math.min(Math.max(1, z + delta), 5)
      if (next === 1) setPos({ x: 0, y: 0 })
      return next
    })
  }

  // Swipe down para fechar (mobile)
  const onTouchStart = (e: React.TouchEvent) => {
    if (zoom === 1) touchStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || zoom !== 1) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 120) {
      onClose()
      touchStartY.current = null
    }
  }
  const onTouchEnd = () => { touchStartY.current = null }

  // Download — tenta Capacitor (nativo) primeiro, fallback browser
  const handleDownload = useCallback(async () => {
    if (downloading) return
    setDownloading(true)
    try {
      // Tenta caminho nativo (Capacitor Share/Filesystem) dinamicamente
      const savedNative = await tryCapacitorDownload(url, fileName)
      if (!savedNative) {
        // Fallback web: <a download>
        triggerBrowserDownload(url, fileName)
      }
    } catch (err) {
      console.error('Download failed:', err)
      triggerBrowserDownload(url, fileName)
    } finally {
      setDownloading(false)
    }
  }, [downloading, url, fileName])

  const label =
    type === 'image' ? 'Imagem' : type === 'video' ? 'Vídeo' : 'Áudio'

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
            {label}
          </span>
          {fileName && (
            <span className="truncate text-xs text-gray-400">{fileName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Reset zoom (só imagem) */}
          {type === 'image' && zoom !== 1 && (
            <button
              onClick={resetView}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20"
              title="Resetar zoom"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {Math.round(zoom * 100)}%
            </button>
          )}
          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            title="Baixar"
          >
            {downloading ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-red-500"
            title="Fechar (ESC)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {type === 'image' && (
          <img
            src={url}
            alt={fileName || 'Imagem'}
            draggable={false}
            onClick={toggleZoom}
            onWheel={onWheel}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-150"
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
            }}
          />
        )}

        {type === 'video' && (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {type === 'audio' && (
          <div className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-2xl bg-white/5 p-8 text-center">
              <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600">
                <svg className="h-12 w-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <audio src={url} controls autoPlay className="w-full" />
              {fileName && (
                <p className="mt-4 truncate text-sm text-gray-400">{fileName}</p>
              )}
            </div>
          </div>
        )}

        {/* Hint de zoom (só imagem, só quando não deu zoom) */}
        {type === 'image' && zoom === 1 && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs text-white/80">
            Clique para zoom · role para aproximar · ESC fecha
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Download helpers
// ----------------------------------------------------------------------------

/** Tenta salvar via Capacitor (Share ou Filesystem). Retorna true se conseguiu. */
async function tryCapacitorDownload(url: string, fileName?: string): Promise<boolean> {
  try {
    // Detecção dinâmica: só tenta se o plugin estiver instalado e em runtime nativo
    const cap = (window as any).Capacitor
    const isNative = cap?.isNativePlatform?.() === true
    if (!isNative) return false

    const name = fileName || `vox-${Date.now()}`

    // Para data URLs, usa Filesystem para gravar; caso contrário, Share com o link
    if (url.startsWith('data:')) {
      try {
        const fs = await import('@capacitor/filesystem')
        const base64 = url.split(',')[1] || ''
        const ext = guessExt(fileName, url)
        const finalName = `${name.replace(/\.[^.]+$/, '')}.${ext}`
        await fs.Filesystem.writeFile({
          path: finalName,
          data: base64,
          directory: fs.Directory.Documents,
          recursive: true,
        })
        return true
      } catch {
        // Filesystem não disponível → tenta Share abaixo
      }
    }

    // Share sheet como alternativa nativa
    try {
      const share = await import('@capacitor/share')
      await share.Share.share({ url, title: name })
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

/** Fallback web: dispara um <a download>. */
function triggerBrowserDownload(url: string, fileName?: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || `vox-${Date.now()}`
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function guessExt(fileName?: string, dataUrl?: string): string {
  if (fileName && /\.([a-z0-9]+)$/i.test(fileName)) {
    return RegExp.$1.toLowerCase()
  }
  const mime = dataUrl?.match(/^data:([^;]+)/)?.[1] || ''
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'bin'
}
