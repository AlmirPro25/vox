import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

// Múltiplos servidores STUN/TURN para máxima conectividade
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  // TURN servers (relay para NAT restritivo)
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

type ViewMode = 'split' | 'default' | 'fullscreen-local' | 'fullscreen-remote'
type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'disconnected'

interface VideoStageProps {
  onNext?: () => void
  onLeave?: () => void
  sendSignal?: (type: string, payload: any) => void
}

export function VideoStage({ onNext, onLeave, sendSignal }: VideoStageProps) {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()
  
  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const isSettingRemoteAnswer = useRef(false)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const reconnectAttempts = useRef(0)
  const statsInterval = useRef<NodeJS.Timeout | null>(null)
  const connectionTimeout = useRef<NodeJS.Timeout | null>(null)
  
  // State
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<string>('new')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [showControls, setShowControls] = useState(true)
  const [quality, setQuality] = useState<ConnectionQuality>('disconnected')
  const [isReconnecting, setIsReconnecting] = useState(false)


  const bgStyle = { background: theme === 'dark' ? '#0a0a0a' : '#f1f5f9' }
  
  // Determinar se somos "polite" (responder) ou "impolite" (iniciador)
  // Perfect Negotiation: polite peer cede em caso de conflito
  const isPolite = useCallback(() => !(window as any).__isWebRTCInitiator, [])

  // Monitor de qualidade
  const startQualityMonitor = useCallback(() => {
    if (statsInterval.current) clearInterval(statsInterval.current)
    statsInterval.current = setInterval(async () => {
      const pc = pcRef.current
      if (!pc || pc.connectionState !== 'connected') return
      try {
        const stats = await pc.getStats()
        let packetsLost = 0, packetsReceived = 0, rtt = 0
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost = report.packetsLost || 0
            packetsReceived = report.packetsReceived || 0
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime || 0
          }
        })
        const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0
        if (lossRate < 0.01 && rtt < 0.15) setQuality('excellent')
        else if (lossRate < 0.05 && rtt < 0.3) setQuality('good')
        else setQuality('poor')
      } catch { /* ignore */ }
    }, 3000)
  }, [])

  const stopQualityMonitor = useCallback(() => {
    if (statsInterval.current) { clearInterval(statsInterval.current); statsInterval.current = null }
    setQuality('disconnected')
  }, [])

  // Obter mídia local
  const startMedia = useCallback(async (videoEnabled = true): Promise<MediaStream | null> => {
    try {
      // Se já tem stream, retorna
      if (localStreamRef.current) return localStreamRef.current
      
      console.log('📹 Requesting media...', videoEnabled ? 'video+audio' : 'audio only')
      const constraints = videoEnabled 
        ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } }
        : { video: false, audio: { echoCancellation: true, noiseSuppression: true } }
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current = stream
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }
      
      setCameraOn(videoEnabled && stream.getVideoTracks().length > 0)
      setMicOn(stream.getAudioTracks().length > 0)
      setError(null)
      console.log('✅ Media started:', stream.getTracks().map(t => t.kind).join(', '))
      return stream
    } catch (err: any) {
      console.error('❌ Media error:', err.name, err.message)
      if (videoEnabled) {
        console.log('⚠️ Video failed, trying audio only...')
        return startMedia(false)
      }
      setError('Permita acesso à câmera/microfone')
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

  // Criar PeerConnection com Perfect Negotiation
  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    
    console.log('🔗 Creating PeerConnection (polite:', isPolite(), ')')
    const pc = new RTCPeerConnection({ 
      iceServers: ICE_SERVERS, 
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })
    
    // ICE Candidate
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && sendSignal) {
        console.log('🧊 Sending ICE candidate')
        sendSignal('webrtc_ice', { candidate: candidate.toJSON() })
      }
    }
    
    pc.onicecandidateerror = (e) => {
      console.warn('🧊 ICE candidate error:', e)
    }
    
    // Track recebido
    pc.ontrack = ({ track, streams }) => {
      console.log('📺 Received track:', track.kind)
      if (remoteVideoRef.current && streams[0]) {
        remoteVideoRef.current.srcObject = streams[0]
        remoteVideoRef.current.play().catch(() => {})
        setRemoteConnected(true)
        reconnectAttempts.current = 0
        startQualityMonitor()
      }
    }
    
    // Perfect Negotiation: onnegotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        console.log('🔄 Negotiation needed')
        makingOffer.current = true
        await pc.setLocalDescription()
        console.log('📤 Sending offer')
        sendSignal?.('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
      } catch (err) {
        console.error('❌ Negotiation error:', err)
      } finally {
        makingOffer.current = false
      }
    }
    
    // Connection state
    pc.onconnectionstatechange = () => {
      console.log('🔄 Connection state:', pc.connectionState)
      setConnectionState(pc.connectionState)
      
      if (pc.connectionState === 'connected') {
        setRemoteConnected(true)
        setQuality('good')
        if (connectionTimeout.current) {
          clearTimeout(connectionTimeout.current)
          connectionTimeout.current = null
        }
      }
      
      if (pc.connectionState === 'disconnected') {
        setQuality('poor')
        // Aguardar 5s antes de tentar reconectar
        setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected') {
            attemptReconnect()
          }
        }, 5000)
      }
      
      if (pc.connectionState === 'failed') {
        setRemoteConnected(false)
        setQuality('disconnected')
        attemptReconnect()
      }
    }
    
    // ICE connection state
    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE state:', pc.iceConnectionState)
      if (pc.iceConnectionState === 'failed') {
        console.log('🔄 ICE failed, restarting...')
        pc.restartIce()
      }
    }
    
    pc.onicegatheringstatechange = () => {
      console.log('🧊 ICE gathering:', pc.iceGatheringState)
    }
    
    pcRef.current = pc
    return pc
  }, [sendSignal, isPolite, startQualityMonitor])


  // Reconexão automática
  const attemptReconnect = useCallback(async () => {
    if (reconnectAttempts.current >= 3) {
      console.log('❌ Max reconnect attempts reached')
      setError('Conexão perdida. Clique em Próximo.')
      setIsReconnecting(false)
      return
    }
    
    reconnectAttempts.current++
    setIsReconnecting(true)
    console.log(`🔄 Reconnecting... attempt ${reconnectAttempts.current}/3`)
    
    // Fechar conexão atual
    pcRef.current?.close()
    pcRef.current = null
    pendingCandidates.current = []
    makingOffer.current = false
    ignoreOffer.current = false
    
    await new Promise(r => setTimeout(r, 1000))
    
    // Reiniciar
    await initializeConnection()
    setIsReconnecting(false)
  }, [])

  // Inicializar conexão
  const initializeConnection = useCallback(async () => {
    console.log('🚀 Initializing connection...')
    
    const stream = await startMedia()
    if (!stream) return
    
    const pc = createPeerConnection()
    
    // Adicionar tracks
    stream.getTracks().forEach(track => {
      console.log('➕ Adding track:', track.kind)
      pc.addTrack(track, stream)
    })
    
    // Processar ICE candidates pendentes
    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift()
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch { /* ignore */ }
      }
    }
    
    // Timeout de conexão
    connectionTimeout.current = setTimeout(() => {
      if (pcRef.current?.connectionState !== 'connected') {
        console.log('⏰ Connection timeout')
        attemptReconnect()
      }
    }, 20000)
  }, [startMedia, createPeerConnection, attemptReconnect])

  // Perfect Negotiation: Handle Offer
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current
    if (!pc) {
      console.log('⚠️ No PC for offer, initializing...')
      await initializeConnection()
      // Tentar novamente após inicialização
      setTimeout(() => handleOffer(sdp), 500)
      return
    }
    
    try {
      const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
      ignoreOffer.current = !isPolite() && offerCollision
      
      if (ignoreOffer.current) {
        console.log('⚠️ Ignoring offer (collision, impolite)')
        return
      }
      
      console.log('📥 Processing offer...')
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      
      // Processar ICE candidates pendentes
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift()
        if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
      }
      
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('📤 Sending answer')
      sendSignal?.('webrtc_answer', { sdp: pc.localDescription?.toJSON() })
    } catch (err) {
      console.error('❌ Handle offer error:', err)
    }
  }, [isPolite, sendSignal, initializeConnection])

  // Perfect Negotiation: Handle Answer
  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current
    if (!pc) return
    
    try {
      if (pc.signalingState === 'stable') {
        console.log('⚠️ Ignoring answer (already stable)')
        return
      }
      
      console.log('📥 Processing answer...')
      isSettingRemoteAnswer.current = true
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      isSettingRemoteAnswer.current = false
      
      // Processar ICE candidates pendentes
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift()
        if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
      }
    } catch (err) {
      console.error('❌ Handle answer error:', err)
      isSettingRemoteAnswer.current = false
    }
  }, [])

  // Handle ICE Candidate
  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) {
      console.log('🧊 Queuing ICE candidate')
      pendingCandidates.current.push(candidate)
      return
    }
    
    try {
      console.log('🧊 Adding ICE candidate')
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      if (!ignoreOffer.current) {
        console.error('❌ ICE candidate error:', err)
      }
    }
  }, [])


  // Encerrar chamada
  const endCall = useCallback(() => {
    console.log('📴 Ending call')
    stopQualityMonitor()
    if (connectionTimeout.current) {
      clearTimeout(connectionTimeout.current)
      connectionTimeout.current = null
    }
    pcRef.current?.close()
    pcRef.current = null
    pendingCandidates.current = []
    makingOffer.current = false
    ignoreOffer.current = false
    isSettingRemoteAnswer.current = false
    reconnectAttempts.current = 0
    stopMedia()
    setRemoteConnected(false)
    setConnectionState('new')
    setQuality('disconnected')
    setError(null)
    setIsReconnecting(false)
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
  }, [stopMedia, stopQualityMonitor])

  // Toggle camera/mic
  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setCameraOn(track.enabled)
    }
  }, [])

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setMicOn(track.enabled)
    }
  }, [])

  // Expor handlers globalmente
  useEffect(() => {
    (window as any).__webrtc = { handleOffer, handleAnswer, handleIce }
    return () => { delete (window as any).__webrtc }
  }, [handleOffer, handleAnswer, handleIce])

  // Iniciar quando conectado
  useEffect(() => {
    if (status === 'connected') {
      console.log('🎯 Status connected, role:', (window as any).__isWebRTCInitiator ? 'INITIATOR' : 'RESPONDER')
      pendingCandidates.current = []
      reconnectAttempts.current = 0
      initializeConnection()
    } else if (status === 'idle' || status === 'searching') {
      endCall()
    }
  }, [status, initializeConnection, endCall])

  // Cleanup
  useEffect(() => () => endCall(), [endCall])

  // Auto-hide controls
  useEffect(() => {
    if (status !== 'connected') return
    const timer = setTimeout(() => setShowControls(false), 4000)
    return () => clearTimeout(timer)
  }, [status, showControls])

  const cycleViewMode = () => {
    const modes: ViewMode[] = ['split', 'default', 'fullscreen-local', 'fullscreen-remote']
    setViewMode(modes[(modes.indexOf(viewMode) + 1) % modes.length])
  }

  const qualityColor = { excellent: 'bg-green-500', good: 'bg-yellow-500', poor: 'bg-orange-500', disconnected: 'bg-red-500' }
  const qualityText = { excellent: 'Excelente', good: 'Boa', poor: 'Fraca', disconnected: 'Conectando...' }

  return (
    <div className="h-full w-full relative overflow-hidden" style={bgStyle}
      onMouseMove={() => setShowControls(true)} onTouchStart={() => setShowControls(true)}>

      {/* Idle */}
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

      {/* Searching */}
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


      {/* Connected */}
      {status === 'connected' && (
        <div className="h-full w-full relative">
          {/* Quality indicator */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
            <span className={`w-2 h-2 rounded-full ${qualityColor[quality]} ${quality !== 'disconnected' ? '' : 'animate-pulse'}`} />
            <span className="text-white text-xs">{qualityText[quality]}</span>
          </div>

          {/* Reconnecting overlay */}
          {isReconnecting && (
            <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-white">Reconectando...</p>
                <p className="text-white/60 text-sm mt-1">Tentativa {reconnectAttempts.current}/3</p>
              </div>
            </div>
          )}

          {/* Split 50/50 */}
          {viewMode === 'split' && (
            <div className="h-full w-full flex flex-col md:flex-row">
              <div className="flex-1 relative bg-black min-h-[40%] md:min-h-0">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2)}</span>
                      </div>
                      <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                      <p className="text-gray-400 text-xs mt-1">{connectionState === 'connecting' ? 'Conectando vídeo...' : 'Aguardando...'}</p>
                    </div>
                  </div>
                )}
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`} />
                  <span className="text-white text-sm font-medium">{partnerInfo?.anonymousId}</span>
                </div>
              </div>
              <div className="hidden md:block w-1 bg-black" />
              <div className="md:hidden h-1 bg-black" />
              <div className="flex-1 relative bg-black min-h-[40%] md:min-h-0">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-white text-sm font-medium">Você</span>
                </div>
              </div>
            </div>
          )}

          {/* Default - PiP */}
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


          {/* Controls */}
          <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-4 md:pb-6 px-4">
              <div className="flex items-center justify-center gap-3 md:gap-4">
                <button onClick={toggleMic} className={`p-3 md:p-4 rounded-full ${micOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500'} text-white transition-all shadow-lg backdrop-blur-sm`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {micOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />}
                  </svg>
                </button>
                <button onClick={toggleCamera} className={`p-3 md:p-4 rounded-full ${cameraOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500'} text-white transition-all shadow-lg backdrop-blur-sm`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {cameraOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />}
                  </svg>
                </button>
                <button onClick={cycleViewMode} className="p-3 md:p-4 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all shadow-lg backdrop-blur-sm" title="Mudar layout">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                </button>
                <button onClick={onNext} className="px-5 md:px-6 py-3 md:py-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full font-semibold text-sm md:text-base transition-all shadow-lg flex items-center gap-2">
                  <span>Próximo</span>
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
                <button onClick={onLeave} className="p-3 md:p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all shadow-lg" title="Sair">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-xl z-40 text-center">
              <p>{error}</p>
              <button onClick={() => setError(null)} className="mt-2 text-sm underline">Fechar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
