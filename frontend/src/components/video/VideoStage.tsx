import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

// ============================================================================
// VERSÃO GOLD - WEBRTC NÍVEL OMEGLE/CHATROULETTE
// ============================================================================
// CORREÇÕES APLICADAS:
// 1. iceCandidatePoolSize: 0 (TURN público não suporta pool)
// 2. ICE restart APENAS em connectionState failed (um único lugar)
// 3. onnegotiationneeded bloqueado para polite (só initiator negocia)
// 4. Rollback só quando necessário (have-local-offer)
// 5. Tracks não duplicam em reconexões
// 6. TURN com endpoint dinâmico (preparado para tokens)
// ============================================================================

// TURN será buscado do backend (preparado para tokens dinâmicos)
const getIceServers = async (): Promise<RTCIceServer[]> => {
  const baseServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
  
  try {
    // Tentar buscar TURN do backend (futuro: tokens dinâmicos)
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://vox-api-hq2l.onrender.com'}/turn-credentials`)
    if (res.ok) {
      const turnServers = await res.json()
      return [...baseServers, ...turnServers]
    }
  } catch {
    console.log('⚠️ Using fallback TURN servers')
  }
  
  // Fallback - TURN público (temporário)
  return [
    ...baseServers,
    {
      urls: ['turn:a.relay.metered.ca:80', 'turn:a.relay.metered.ca:443'],
      username: 'e8dd65c92f6f1f2d5c67c7a3',
      credential: 'kW3QfUZKpLqYhDzS'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
  ]
}

type ViewMode = 'split' | 'pip-remote' | 'pip-local'
type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'connecting'

interface VideoStageProps {
  onNext?: () => void
  onLeave?: () => void
  sendSignal?: (type: string, payload: unknown) => void
}

export function VideoStage({ onNext, onLeave, sendSignal }: VideoStageProps) {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()

  // Refs - 1 PeerConnection por match, NUNCA recriar
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  
  // Perfect Negotiation state
  const makingOffer = useRef(false)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const isInitiatorRef = useRef(false) // Definido pelo backend
  const iceRestarting = useRef(false) // Debounce ICE restart
  
  // Controle
  const callActive = useRef(false)
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // State
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false) // Detectar remote mute
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [showControls, setShowControls] = useState(true)
  const [quality, setQuality] = useState<ConnectionQuality>('connecting')

  const bgStyle = { background: theme === 'dark' ? '#0a0a0a' : '#f1f5f9' }

  // ============================================================================
  // QUALITY MONITOR + RELAY DETECTION
  // ============================================================================
  const startQualityMonitor = useCallback(() => {
    if (statsInterval.current) clearInterval(statsInterval.current)
    
    statsInterval.current = setInterval(async () => {
      const pc = pcRef.current
      if (!pc || pc.connectionState !== 'connected') return
      
      try {
        const stats = await pc.getStats()
        let packetsLost = 0, packetsReceived = 0, rtt = 0
        let connectionType = 'unknown'
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats.forEach((report: any) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost = report.packetsLost || 0
            packetsReceived = report.packetsReceived || 0
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime || 0
          }
          // Detectar tipo de conexão (host/srflx/relay)
          if (report.type === 'local-candidate' && report.isRemote === false) {
            connectionType = report.candidateType || connectionType
          }
        })
        
        // Log tipo de conexão (importante para métricas)
        // relay = TURN, srflx = STUN, host = direto
        if (connectionType !== 'unknown') {
          console.log(`📡 Connection type: ${connectionType}`)
        }
        
        const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0
        if (lossRate < 0.01 && rtt < 0.15) setQuality('excellent')
        else if (lossRate < 0.05 && rtt < 0.3) setQuality('good')
        else setQuality('poor')
      } catch { /* ignore */ }
    }, 5000)
  }, [])

  const stopQualityMonitor = useCallback(() => {
    if (statsInterval.current) {
      clearInterval(statsInterval.current)
      statsInterval.current = null
    }
  }, [])

  // ============================================================================
  // MEDIA - Obter câmera/microfone
  // ============================================================================
  const startMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current

    try {
      console.log('📹 Requesting camera/mic...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true }
      })
      
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }
      
      setCameraOn(stream.getVideoTracks().length > 0)
      setMicOn(stream.getAudioTracks().length > 0)
      console.log('✅ Media started')
      return stream
    } catch (err) {
      console.error('❌ Media error:', err)
      // Fallback: só áudio
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        localStreamRef.current = audioStream
        setCameraOn(false)
        setMicOn(true)
        return audioStream
      } catch {
        return null
      }
    }
  }, [])

  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [])

  // ============================================================================
  // PEER CONNECTION - VERSÃO GOLD
  // ============================================================================
  const createPeerConnection = useCallback(async () => {
    if (pcRef.current && pcRef.current.connectionState !== 'closed') {
      console.log('⚠️ PC exists, reusing')
      return pcRef.current
    }

    const iceServers = await getIceServers()
    const isInitiator = isInitiatorRef.current
    console.log('🔗 Creating PC (initiator:', isInitiator, ')')
    
    const pc = new RTCPeerConnection({
      iceServers,
      // CORREÇÃO 1: Pool = 0 para TURN público
      iceCandidatePoolSize: 0,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })

    // ICE Candidate
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && sendSignal) {
        sendSignal('webrtc_ice', { candidate: candidate.toJSON() })
      }
    }

    // ICE errors - IGNORAR (são ruído)
    pc.onicecandidateerror = () => {}

    // Track recebido - com detecção de mute/unmute
    pc.ontrack = ({ track, streams }) => {
      console.log('📺 Remote track received:', track.kind)
      
      // Detectar remote mute/unmute (UX premium)
      track.onmute = () => {
        console.log('🔇 Remote muted:', track.kind)
        if (track.kind === 'video') setRemoteMuted(true)
      }
      track.onunmute = () => {
        console.log('🔊 Remote unmuted:', track.kind)
        if (track.kind === 'video') setRemoteMuted(false)
      }
      
      if (remoteVideoRef.current && streams[0]) {
        remoteVideoRef.current.srcObject = streams[0]
        remoteVideoRef.current.play().catch(() => {})
        setRemoteConnected(true)
        startQualityMonitor()
      }
    }

    // ============================================================================
    // CORREÇÃO 3: onnegotiationneeded SÓ para initiator
    // ============================================================================
    pc.onnegotiationneeded = async () => {
      if (!callActive.current) return
      // POLITE NÃO NEGOCIA - só responde
      if (!isInitiatorRef.current) return
      // Só negocia em estado stable
      if (pc.signalingState !== 'stable') return
      // EDGE 2: Evita offer duplicada se já está fazendo
      if (makingOffer.current) return
      
      try {
        makingOffer.current = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        console.log('📤 Sending offer (negotiation needed)')
        sendSignal?.('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
      } catch (err) {
        console.error('❌ Negotiation error:', err)
      } finally {
        makingOffer.current = false
      }
    }

    // ============================================================================
    // CORREÇÃO 2: ICE restart APENAS aqui (único lugar)
    // ============================================================================
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      console.log('🔄 Connection:', state)

      switch (state) {
        case 'connected':
          setRemoteConnected(true)
          setQuality('good')
          break
        case 'disconnected':
          // TEMPORÁRIO - não fazer nada drástico
          setQuality('poor')
          break
        case 'failed':
          // ÚNICO LUGAR de ICE restart - com debounce
          if (!iceRestarting.current) {
            iceRestarting.current = true
            console.log('🔄 Connection failed → ICE restart')
            setQuality('connecting')
            pc.restartIce()
            // Debounce: só permite outro restart após 3s
            setTimeout(() => { iceRestarting.current = false }, 3000)
          }
          break
        case 'closed':
          setRemoteConnected(false)
          setQuality('connecting')
          break
      }
    }

    // ICE state - APENAS LOG (sem restart aqui)
    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE:', pc.iceConnectionState)
    }

    pcRef.current = pc
    return pc
  }, [sendSignal, startQualityMonitor])

  // ============================================================================
  // INITIALIZE CONNECTION
  // ============================================================================
  const initializeConnection = useCallback(async () => {
    if (callActive.current) return
    callActive.current = true
    
    const win = window as unknown as { __isWebRTCInitiator?: boolean }
    isInitiatorRef.current = win.__isWebRTCInitiator === true
    
    console.log('🚀 Init call (initiator:', isInitiatorRef.current, ')')

    const stream = await startMedia()
    if (!stream) return

    const pc = await createPeerConnection()

    // CORREÇÃO 5: Não duplicar tracks
    const senders = pc.getSenders()
    stream.getTracks().forEach((track: MediaStreamTrack) => {
      if (!senders.find((s: RTCRtpSender) => s.track === track)) {
        console.log('➕ Adding track:', track.kind)
        pc.addTrack(track, stream)
      }
    })

    // Preferir H264 para Safari/iOS (opcional mas recomendado)
    try {
      const transceivers = pc.getTransceivers()
      transceivers.forEach(t => {
        if (t.sender?.track?.kind === 'video') {
          const caps = RTCRtpSender.getCapabilities?.('video')
          if (caps?.codecs) {
            const h264Codecs = caps.codecs.filter(c => c.mimeType === 'video/H264')
            if (h264Codecs.length > 0) {
              t.setCodecPreferences([...h264Codecs, ...caps.codecs.filter(c => c.mimeType !== 'video/H264')])
            }
          }
        }
      })
    } catch { /* codec preferences not supported */ }

    // Processar ICE pendentes
    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift()
      if (candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      }
    }

    // INITIATOR: criar offer
    if (isInitiatorRef.current) {
      setTimeout(async () => {
        if (pc.signalingState === 'stable' && !makingOffer.current && callActive.current) {
          try {
            makingOffer.current = true
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            console.log('📤 Initial offer')
            sendSignal?.('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
          } catch (err) {
            console.error('❌ Offer error:', err)
          } finally {
            makingOffer.current = false
          }
        }
      }, 500)
    }
  }, [startMedia, createPeerConnection, sendSignal])

  // ============================================================================
  // HANDLE OFFER - Perfect Negotiation (polite cede)
  // ============================================================================
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    // EDGE 1: Ignorar se call não está ativa (mensagem atrasada)
    if (!callActive.current) return
    
    const pc = pcRef.current
    if (!pc) return

    try {
      const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
      
      if (offerCollision) {
        // IMPOLITE ignora collision
        if (isInitiatorRef.current) {
          console.log('⚠️ Ignoring offer (impolite collision)')
          return
        }
        // CORREÇÃO 4: Rollback só se necessário
        if (pc.signalingState === 'have-local-offer') {
          console.log('🔄 Rollback (polite)')
          await pc.setLocalDescription({ type: 'rollback' })
        }
      }
      
      console.log('📥 Processing offer')
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))

      // ICE pendentes
      while (pendingCandidates.current.length > 0) {
        const c = pendingCandidates.current.shift()
        if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      }

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('📤 Sending answer')
      sendSignal?.('webrtc_answer', { sdp: pc.localDescription?.toJSON() })
    } catch (err) {
      console.error('❌ Offer error:', err)
    }
  }, [sendSignal])

  // ============================================================================
  // HANDLE ANSWER
  // ============================================================================
  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    // EDGE 1: Ignorar se call não está ativa
    if (!callActive.current) return
    
    const pc = pcRef.current
    if (!pc) return

    try {
      if (pc.signalingState === 'stable') {
        console.log('⚠️ Ignoring answer (stable)')
        return
      }

      console.log('📥 Processing answer')
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))

      while (pendingCandidates.current.length > 0) {
        const c = pendingCandidates.current.shift()
        if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      }
    } catch (err) {
      console.error('❌ Answer error:', err)
    }
  }, [])

  // ============================================================================
  // HANDLE ICE
  // ============================================================================
  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    // EDGE 1: Ignorar se call não está ativa
    if (!callActive.current) return
    
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) {
      pendingCandidates.current.push(candidate)
      return
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch {}
  }, [])

  // ============================================================================
  // END CALL
  // ============================================================================
  const endCall = useCallback(() => {
    console.log('📴 End call')
    callActive.current = false
    stopQualityMonitor()
    pcRef.current?.close()
    pcRef.current = null
    pendingCandidates.current = []
    makingOffer.current = false
    stopMedia()
    setRemoteConnected(false)
    setQuality('connecting')
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
  }, [stopMedia, stopQualityMonitor])

  // Toggle controls
  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setCameraOn(track.enabled) }
  }, [])

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled) }
  }, [])

  // Expor handlers
  useEffect(() => {
    const win = window as unknown as { __webrtc?: { handleOffer: typeof handleOffer; handleAnswer: typeof handleAnswer; handleIce: typeof handleIce } }
    win.__webrtc = { handleOffer, handleAnswer, handleIce }
    return () => { delete win.__webrtc }
  }, [handleOffer, handleAnswer, handleIce])

  // Status change
  useEffect(() => {
    if (status === 'connected') {
      pendingCandidates.current = []
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
    const modes: ViewMode[] = ['split', 'pip-remote', 'pip-local']
    setViewMode(modes[(modes.indexOf(viewMode) + 1) % modes.length])
  }

  const qualityConfig = {
    excellent: { color: 'bg-green-500', text: 'Excelente' },
    good: { color: 'bg-yellow-500', text: 'Boa' },
    poor: { color: 'bg-orange-500', text: 'Fraca' },
    connecting: { color: 'bg-blue-500 animate-pulse', text: 'Conectando...' }
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="h-full w-full relative overflow-hidden" style={bgStyle}
      onMouseMove={() => setShowControls(true)} onTouchStart={() => setShowControls(true)}>

      {/* IDLE */}
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

      {/* SEARCHING */}
      {status === 'searching' && (
        <div className="h-full flex items-center justify-center bg-black">
          <div className="text-center px-4">
            <div className="relative w-32 h-32 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-t-cyan-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              <div className="absolute inset-4 rounded-full border border-cyan-500/30 animate-pulse" />
              <div className="absolute inset-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-cyan-400 mb-2">Buscando...</h2>
            <div className="flex justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.2s]" />
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        </div>
      )}

      {/* CONNECTED */}
      {status === 'connected' && (
        <div className="h-full w-full relative">
          {/* Quality */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
            <span className={`w-2 h-2 rounded-full ${qualityConfig[quality].color}`} />
            <span className="text-white text-xs">{qualityConfig[quality].text}</span>
          </div>

          {/* SPLIT 50/50 */}
          {viewMode === 'split' && (
            <div className="h-full w-full flex flex-col md:flex-row bg-black">
              <div className="flex-1 relative min-h-[50%] md:min-h-0 border-b md:border-b-0 md:border-r border-white/10">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center animate-pulse">
                        <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                      </div>
                      <p className="text-white font-medium">{partnerInfo?.anonymousId || 'Conectando...'}</p>
                    </div>
                  </div>
                )}
                {remoteMuted && remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-gray-800 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </div>
                      <p className="text-gray-400 text-sm">Câmera desligada</p>
                    </div>
                  </div>
                )}
                <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/50 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <span className="text-white text-xs">{partnerInfo?.anonymousId || 'Parceiro'}</span>
                </div>
              </div>
              <div className="flex-1 relative min-h-[50%] md:min-h-0">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/50 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className="text-white text-xs">Você</span>
                </div>
              </div>
            </div>
          )}

          {/* PIP Remote */}
          {viewMode === 'pip-remote' && (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {!remoteConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                  </div>
                </div>
              )}
              <div className="absolute bottom-24 md:bottom-6 right-4 w-28 h-36 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              </div>
            </>
          )}

          {/* PIP Local */}
          {viewMode === 'pip-local' && (
            <>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              <div className="absolute bottom-24 md:bottom-6 right-4 w-28 h-36 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              </div>
            </>
          )}

          {/* CONTROLS */}
          <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="bg-gradient-to-t from-black/80 to-transparent pt-16 pb-4 md:pb-6 px-4">
              <div className="flex items-center justify-center gap-3 md:gap-4">
                <button onClick={toggleMic} className={`p-3 md:p-4 rounded-full ${micOn ? 'bg-white/20' : 'bg-red-500'} text-white transition-all`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {micOn ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    )}
                  </svg>
                </button>

                <button onClick={toggleCamera} className={`p-3 md:p-4 rounded-full ${cameraOn ? 'bg-white/20' : 'bg-red-500'} text-white transition-all`}>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {cameraOn ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    )}
                  </svg>
                </button>

                <button onClick={cycleViewMode} className="p-3 md:p-4 rounded-full bg-white/20 text-white transition-all">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                </button>

                <button onClick={() => { endCall(); onNext?.() }} className="px-6 py-3 md:px-8 md:py-4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/30">
                  PRÓXIMO
                </button>

                <button onClick={() => { endCall(); onLeave?.() }} className="p-3 md:p-4 rounded-full bg-red-500/80 text-white transition-all">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
