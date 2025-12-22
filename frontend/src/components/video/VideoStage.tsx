import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
]

type ViewMode = 'default' | 'split' | 'fullscreen-local' | 'fullscreen-remote'

interface VideoStageProps {
  onNext?: () => void
  onLeave?: () => void
  sendSignal?: (type: string, payload: any) => void
}

export function VideoStage({ onNext, onLeave, sendSignal }: VideoStageProps) {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()
  
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const pendingIceCandidates = useRef<RTCIceCandidateInit[]>([])
  const isNegotiating = useRef(false)
  
  const [cameraOn, setCameraOn] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<string>('new')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [showControls, setShowControls] = useState(true)

  const bgStyle = { background: theme === 'dark' ? '#0a0a0a' : '#f1f5f9' }

  // Media functions
  const startMedia = useCallback(async () => {
    try {
      console.log('📹 Requesting camera/mic...')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, 
        audio: true 
      })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play().catch(() => {})
      }
      setCameraOn(true)
      setMicOn(true)
      setError(null)
      console.log('✅ Camera/mic started')
      return stream
    } catch (err: any) {
      console.error('❌ Media error:', err)
      setError(err.name === 'NotAllowedError' ? 'Permita acesso à câmera' : 'Câmera não disponível')
      return null
    }
  }, [])

  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setCameraOn(false)
    setMicOn(false)
  }, [])

  // WebRTC functions
  const createPC = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    console.log('🔗 Creating PeerConnection...')
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 })
    
    pc.onicecandidate = (e) => {
      if (e.candidate && sendSignal) {
        console.log('🧊 Sending ICE')
        sendSignal('webrtc_ice', { candidate: e.candidate.toJSON() })
      }
    }
    
    pc.ontrack = (e) => {
      console.log('📺 Received remote track!', e.track.kind)
      if (remoteVideoRef.current && e.streams[0] && !remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject = e.streams[0]
        console.log('✅ Remote stream set')
        setRemoteConnected(true)
      }
    }
    
    pc.onconnectionstatechange = () => {
      console.log('🔄 Connection state:', pc.connectionState)
      setConnectionState(pc.connectionState)
      if (pc.connectionState === 'connected') { setRemoteConnected(true); isNegotiating.current = false }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setRemoteConnected(false)
    }

    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE state:', pc.iceConnectionState)
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }

    pc.onsignalingstatechange = () => { isNegotiating.current = pc.signalingState !== 'stable' }
    pcRef.current = pc
    return pc
  }, [sendSignal])

  const startCall = useCallback(async () => {
    if (isNegotiating.current) return
    isNegotiating.current = true
    console.log('📞 Starting call...')
    const stream = await startMedia()
    if (!stream || !sendSignal) { isNegotiating.current = false; return }
    const pc = createPC()
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      console.log('📤 Sending offer...')
      sendSignal('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
    } catch (err) { console.error('❌ Error:', err); isNegotiating.current = false }
  }, [createPC, startMedia, sendSignal])

  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    console.log('📥 Received offer...')
    let stream = localStreamRef.current || await startMedia()
    if (!stream || !sendSignal) return
    const pc = createPC()
    stream.getTracks().forEach(t => pc.addTrack(t, stream!))
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      while (pendingIceCandidates.current.length > 0) {
        const c = pendingIceCandidates.current.shift()
        if (c) await pc.addIceCandidate(new RTCIceCandidate(c))
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('📤 Sending answer...')
      sendSignal('webrtc_answer', { sdp: pc.localDescription?.toJSON() })
    } catch (err) { console.error('❌ Error:', err) }
  }, [createPC, startMedia, sendSignal])

  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    console.log('📥 Received answer')
    const pc = pcRef.current
    if (!pc || pc.signalingState !== 'have-local-offer') return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      while (pendingIceCandidates.current.length > 0) {
        const c = pendingIceCandidates.current.shift()
        if (c) await pc.addIceCandidate(new RTCIceCandidate(c))
      }
    } catch (err) { console.error('❌ Error:', err) }
  }, [])

  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) { pendingIceCandidates.current.push(candidate); return }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (e) { console.error('ICE error:', e) }
  }, [])

  const endCall = useCallback(() => {
    console.log('📴 Ending call')
    pcRef.current?.close(); pcRef.current = null
    pendingIceCandidates.current = []; isNegotiating.current = false
    stopMedia(); setRemoteConnected(false); setConnectionState('new')
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
  }, [stopMedia])

  const toggleCamera = () => { const t = localStreamRef.current?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setCameraOn(t.enabled) } }
  const toggleMic = () => { const t = localStreamRef.current?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setMicOn(t.enabled) } }

  useEffect(() => { (window as any).__webrtc = { handleOffer, handleAnswer, handleIce, startCall } }, [handleOffer, handleAnswer, handleIce, startCall])

  useEffect(() => {
    if (status === 'connected') {
      const isInitiator = (window as any).__isWebRTCInitiator
      pendingIceCandidates.current = []; isNegotiating.current = false
      if (isInitiator) { setTimeout(() => { if (!pcRef.current || pcRef.current.connectionState === 'closed') startCall() }, 2000) }
      else { startMedia() }
    } else if (status === 'idle' || status === 'searching') { endCall() }
  }, [status, startCall, startMedia, endCall])

  useEffect(() => () => endCall(), [endCall])

  // Auto-hide controls
  useEffect(() => {
    if (status !== 'connected') return
    const timer = setTimeout(() => setShowControls(false), 3000)
    return () => clearTimeout(timer)
  }, [status, showControls])

  const cycleViewMode = () => {
    const modes: ViewMode[] = ['split', 'default', 'fullscreen-local', 'fullscreen-remote']
    const idx = modes.indexOf(viewMode)
    setViewMode(modes[(idx + 1) % modes.length])
  }

  return (
    <div 
      className="h-full w-full relative overflow-hidden" 
      style={bgStyle}
      onMouseMove={() => setShowControls(true)}
      onTouchStart={() => setShowControls(true)}
    >

      {/* Estado Idle */}
      {status === 'idle' && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center px-4">
            <div className="w-28 h-28 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
              <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold theme-text mb-2">Pronto para conectar</h2>
            <p className="theme-text-secondary text-sm">Converse com pessoas do mundo todo</p>
          </div>
        </div>
      )}

      {/* Estado Searching */}
      {status === 'searching' && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center px-4">
            <div className="relative w-28 h-28 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20" />
              <div className="absolute inset-0 rounded-full border-4 border-t-cyan-500 animate-spin" />
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold theme-text mb-2">Procurando...</h2>
            <p className="theme-text-secondary text-sm">Encontrando alguém para conversar</p>
          </div>
        </div>
      )}

      {/* Estado Connected - Video Call */}
      {status === 'connected' && (
        <div className="h-full w-full relative">
          {/* Layout Split 50/50 */}
          {viewMode === 'split' && (
            <div className="h-full w-full flex flex-col md:flex-row">
              {/* Vídeo Remoto */}
              <div className="flex-1 relative bg-black min-h-[40%] md:min-h-0">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg">
                        <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2)}</span>
                      </div>
                      <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                      <p className="text-gray-400 text-xs mt-1">{connectionState === 'connecting' ? 'Conectando...' : 'Aguardando vídeo'}</p>
                    </div>
                  </div>
                )}
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`} />
                  <span className="text-white text-sm font-medium">{partnerInfo?.anonymousId}</span>
                </div>
              </div>

              {/* Divisor */}
              <div className="hidden md:block w-1 bg-black" />
              <div className="md:hidden h-1 bg-black" />

              {/* Vídeo Local */}
              <div className="flex-1 relative bg-black min-h-[40%] md:min-h-0">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-white text-sm font-medium">Você</span>
                </div>
              </div>
            </div>
          )}

          {/* Layout Default (remoto grande, local pequeno) */}
          {viewMode === 'default' && (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {!remoteConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2)}</span>
                    </div>
                    <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                  </div>
                </div>
              )}
              <div className="absolute bottom-20 md:bottom-4 right-4 w-28 h-36 md:w-40 md:h-52 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              </div>
            </>
          )}

          {/* Fullscreen Local */}
          {viewMode === 'fullscreen-local' && (
            <>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              <div className="absolute bottom-20 md:bottom-4 right-4 w-28 h-36 md:w-40 md:h-52 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              </div>
            </>
          )}

          {/* Fullscreen Remote */}
          {viewMode === 'fullscreen-remote' && (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute bottom-20 md:bottom-4 left-4 w-28 h-36 md:w-40 md:h-52 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              </div>
            </>
          )}

          {/* Controles - aparecem com hover/touch */}
          <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-4 md:pb-6 px-4">
              <div className="flex items-center justify-center gap-3 md:gap-4">
                {/* Mic */}
                <button onClick={toggleMic} className={`p-3 md:p-4 rounded-full ${micOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white transition-all shadow-lg backdrop-blur-sm`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {micOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />}
                  </svg>
                </button>

                {/* Camera */}
                <button onClick={toggleCamera} className={`p-3 md:p-4 rounded-full ${cameraOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white transition-all shadow-lg backdrop-blur-sm`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {cameraOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />}
                  </svg>
                </button>

                {/* View Mode */}
                <button onClick={cycleViewMode} className="p-3 md:p-4 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all shadow-lg backdrop-blur-sm">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                </button>

                {/* Next */}
                <button onClick={onNext} className="px-5 md:px-6 py-3 md:py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-semibold text-sm md:text-base transition-all shadow-lg flex items-center gap-2">
                  <span>Próximo</span>
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Stop */}
                <button onClick={onLeave} className="p-3 md:p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-xl">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
