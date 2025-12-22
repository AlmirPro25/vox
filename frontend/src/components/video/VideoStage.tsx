import React, { useRef, useEffect, useState } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

export function VideoStage() {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Ativar câmera quando conectado
  useEffect(() => {
    if (status === 'connected' && !cameraActive) {
      startCamera()
    } else if (status !== 'connected' && cameraActive) {
      stopCamera()
    }
  }, [status])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setCameraActive(true)
        setCameraError(null)
      }
    } catch (err: any) {
      console.error('Camera error:', err)
      setCameraError(err.name === 'NotAllowedError' ? 'Permissão negada' : 'Câmera não disponível')
    }
  }

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
      setCameraActive(false)
    }
  }

  const bgStyle = { background: theme === 'dark' ? 'linear-gradient(135deg, rgba(17,17,17,0.5) 0%, rgba(0,0,0,1) 50%, rgba(17,17,17,0.5) 100%)' : 'linear-gradient(135deg, rgba(241,245,249,1) 0%, rgba(226,232,240,1) 50%, rgba(241,245,249,1) 100%)' }

  return (
    <div className="h-full w-full flex items-center justify-center relative overflow-hidden transition-colors duration-300" style={bgStyle}>
      
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
          </div>
          <h2 className="text-lg md:text-xl font-semibold theme-text mb-2">Searching...</h2>
          <p className="theme-text-secondary text-sm">Matching by language</p>
        </div>
      )}

      {/* Connected State - Com Câmera */}
      {status === 'connected' && partnerInfo && (
        <div className="relative w-full h-full flex flex-col">
          {/* Vídeo Local (sua câmera) */}
          <div className="flex-1 relative">
            {cameraActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={bgStyle}>
                {cameraError ? (
                  <div className="text-center p-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                      <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                    <p className="text-red-400 text-sm">{cameraError}</p>
                    <button onClick={startCamera} className="mt-3 px-4 py-2 bg-cyan-500 text-white rounded-lg text-sm">Tentar novamente</button>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cyan-500/20 flex items-center justify-center animate-pulse">
                      <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="theme-text-muted text-sm">Ativando câmera...</p>
                  </div>
                )}
              </div>
            )}
            
            {/* Overlay com info do parceiro */}
            <div className="absolute top-4 left-4 flex items-center gap-3 px-3 py-2 rounded-xl bg-black/50 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                <span className="text-sm font-bold text-white">{partnerInfo.anonymousId?.slice(0, 2).toUpperCase()}</span>
              </div>
              <div>
                <p className="text-white text-sm font-medium">{partnerInfo.anonymousId}</p>
                <p className="text-green-400 text-xs">🟢 Online • {partnerInfo.nativeLanguage?.toUpperCase()}</p>
              </div>
            </div>

            {/* Botão de câmera */}
            <button onClick={cameraActive ? stopCamera : startCamera} className={`absolute bottom-4 right-4 p-3 rounded-full ${cameraActive ? 'bg-red-500' : 'bg-cyan-500'} text-white shadow-lg`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {cameraActive ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 0112.728 0" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Hidden video element for camera */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
    </div>
  )
}
