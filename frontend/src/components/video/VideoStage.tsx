import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

// ============================================================================
// ARQUITETURA WEBRTC PROFISSIONAL - PADRÃO OMEGLE/CHATROULETTE
// ============================================================================
// REGRAS DE OURO:
// 1. STUN conecta rápido, TURN mantém conectado
// 2. 1 PeerConnection por match - NUNCA recriar desnecessariamente
// 3. ICE errors são RUÍDO - só connectionState === 'failed' importa
// 4. ICE restart só em 'failed', NUNCA em 'disconnected' ou 'checking'
// 5. Polite peer cede em colisão, impolite ignora
// ============================================================================

const ICE_SERVERS: RTCIceServer[] = [
  // STUN - descoberta de IP (gratuito, rápido)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN - relay para NAT restritivo (essencial para estabilidade)
  // Metered.ca - serviço gratuito com limite generoso
  {
    urls: ['turn:a.relay.metered.ca:80', 'turn:a.relay.metered.ca:80?transport=tcp'],
    username: 'e8dd65c92f6f1f2d5c67c7a3',
    credential: 'kW3QfUZKpLqYhDzS'
  },
  {
    urls: ['turn:a.relay.metered.ca:443', 'turn:a.relay.metered.ca:443?transport=tcp'],
    username: 'e8dd65c92f6f1f2d5c67c7a3',
    credential: 'kW3QfUZKpLqYhDzS'
  },
  // OpenRelay backup
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
]

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

  // Refs - CRÍTICO: 1 PeerConnection por match
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  
  // Perfect Negotiation state
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const isPoliteRef = useRef(true) // Definido pelo backend via match order
  
  // Controle de estado
  const callActive = useRef(false)
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // State
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [connectionState, setConnectionState] = useState<string>('new')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [showControls, setShowControls] = useState(true)
  const [quality, setQuality] = useState<ConnectionQuality>('connecting')

  const bgStyle = { background: theme === 'dark' ? '#0a0a0a' : '#f1f5f9' }

  // ============================================================================
  // MONITOR DE QUALIDADE - Só roda quando conectado
  // ============================================================================
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
      } catch { /* ignore stats errors */ }
    }, 5000)
  }, [])

  const stopQualityMonitor = useCallback(() => {
    if (statsInterval.current) {
      clearInterval(statsInterval.current)
      statsInterval.current = null
    }
  }, [])

  // ============================================================================
  // MÍDIA LOCAL - Obter câmera/microfone
  // ============================================================================
  const startMedia = useCallback(async (): Promise<MediaStream | null> => {
    // Reutilizar stream existente
    if (localStreamRef.current) {
      console.log('📹 Reusing existing media stream')
      return localStreamRef.current
    }

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
      // Tentar só áudio
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
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [])

  // ============================================================================
  // PEER CONNECTION - Criar UMA VEZ por match
  // ============================================================================
  const createPeerConnection = useCallback(() => {
    // REGRA: Nunca recriar se já existe e está funcional
    if (pcRef.current && pcRef.current.connectionState !== 'closed') {
      console.log('⚠️ PeerConnection already exists, reusing')
      return pcRef.current
    }

    const isPolite = isPoliteRef.current
    console.log('🔗 Creating PeerConnection (polite:', isPolite, ')')
    
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })

    // ICE Candidate - enviar para parceiro
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && sendSignal) {
        // Log tipo de candidato (informativo apenas)
        const type = candidate.candidate.includes('relay') ? 'TURN' :
                     candidate.candidate.includes('srflx') ? 'STUN' : 'HOST'
        console.log(`🧊 ICE candidate (${type})`)
        sendSignal('webrtc_ice', { candidate: candidate.toJSON() })
      }
    }

    // ICE errors - IGNORAR! São normais e não significam falha
    pc.onicecandidateerror = () => {
      // REGRA: ICE candidate error ≠ conexão falhou
      // TURN errors são esperados com servidores gratuitos
      // NÃO fazer nada aqui
    }

    // Track recebido - parceiro conectou
    pc.ontrack = ({ streams }) => {
      console.log('📺 Received remote track')
      if (remoteVideoRef.current && streams[0]) {
        remoteVideoRef.current.srcObject = streams[0]
        remoteVideoRef.current.play().catch(() => {})
        setRemoteConnected(true)
        startQualityMonitor()
      }
    }

    // Negotiation needed - Perfect Negotiation
    pc.onnegotiationneeded = async () => {
      if (!callActive.current) return
      
      try {
        makingOffer.current = true
        await pc.setLocalDescription()
        console.log('📤 Sending offer (negotiation needed)')
        sendSignal?.('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
      } catch (err) {
        console.error('❌ Negotiation error:', err)
      } finally {
        makingOffer.current = false
      }
    }

    // ============================================================================
    // CONNECTION STATE - A ÚNICA VERDADE
    // ============================================================================
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      console.log('🔄 Connection state:', state)
      setConnectionState(state)

      switch (state) {
        case 'connected':
          // ✅ SUCESSO - call está funcionando
          setRemoteConnected(true)
          setQuality('good')
          break
          
        case 'disconnected':
          // ⚠️ TEMPORÁRIO - NÃO fazer nada drástico
          // Pode ser mudança de rede, vai reconectar sozinho
          setQuality('poor')
          // NÃO chamar restartIce() aqui!
          break
          
        case 'failed':
          // ❌ FALHOU - Agora sim, tentar ICE restart
          console.log('🔄 Connection failed, trying ICE restart...')
          setQuality('connecting')
          pc.restartIce()
          break
          
        case 'closed':
          setRemoteConnected(false)
          setQuality('connecting')
          break
      }
    }

    // ICE Connection State - informativo
    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE state:', pc.iceConnectionState)
      
      // REGRA: Só fazer ICE restart em 'failed', NUNCA em outros estados
      if (pc.iceConnectionState === 'failed') {
        console.log('🔄 ICE failed, restarting...')
        pc.restartIce()
      }
      // NÃO fazer nada em 'disconnected' ou 'checking'
    }

    pcRef.current = pc
    return pc
  }, [sendSignal, startQualityMonitor])

  // ============================================================================
  // INICIALIZAR CONEXÃO - Chamado UMA VEZ quando match acontece
  // ============================================================================
  const initializeConnection = useCallback(async () => {
    if (callActive.current) {
      console.log('⚠️ Call already active')
      return
    }
    
    callActive.current = true
    const isInitiator = (window as unknown as { __isWebRTCInitiator?: boolean }).__isWebRTCInitiator
    isPoliteRef.current = !isInitiator // Polite = quem NÃO é iniciador
    
    console.log('🚀 Initializing call (initiator:', isInitiator, ', polite:', isPoliteRef.current, ')')

    const stream = await startMedia()
    if (!stream) {
      console.error('❌ No media stream')
      return
    }

    const pc = createPeerConnection()

    // Adicionar tracks
    stream.getTracks().forEach(track => {
      console.log('➕ Adding track:', track.kind)
      pc.addTrack(track, stream)
    })

    // Processar ICE candidates que chegaram antes
    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift()
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch { /* ignore */ }
      }
    }

    // INITIATOR: criar offer após pequeno delay
    if (isInitiator) {
      setTimeout(async () => {
        if (pc.signalingState === 'stable' && !makingOffer.current && callActive.current) {
          try {
            makingOffer.current = true
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            console.log('📤 Sending initial offer')
            sendSignal?.('webrtc_offer', { sdp: pc.localDescription?.toJSON() })
          } catch (err) {
            console.error('❌ Create offer error:', err)
          } finally {
            makingOffer.current = false
          }
        }
      }, 500)
    }
  }, [startMedia, createPeerConnection, sendSignal])

  // ============================================================================
  // PERFECT NEGOTIATION - Handle Offer
  // ============================================================================
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current
    if (!pc) {
      console.log('⚠️ No PC for offer, queuing...')
      return
    }

    try {
      // Detectar colisão
      const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
      
      // REGRA: Impolite ignora offer em colisão, polite cede
      if (offerCollision) {
        if (!isPoliteRef.current) {
          console.log('⚠️ Ignoring offer (impolite, collision)')
          ignoreOffer.current = true
          return
        }
        // Polite: rollback e aceitar novo offer
        await pc.setLocalDescription({ type: 'rollback' })
      }
      
      ignoreOffer.current = false
      console.log('📥 Processing offer...')
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))

      // Processar ICE candidates pendentes
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift()
        if (candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
        }
      }

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log('📤 Sending answer')
      sendSignal?.('webrtc_answer', { sdp: pc.localDescription?.toJSON() })
    } catch (err) {
      console.error('❌ Handle offer error:', err)
    }
  }, [sendSignal])

  // ============================================================================
  // PERFECT NEGOTIATION - Handle Answer
  // ============================================================================
  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current
    if (!pc) return

    try {
      if (pc.signalingState === 'stable') {
        console.log('⚠️ Ignoring answer (already stable)')
        return
      }

      console.log('📥 Processing answer...')
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))

      // Processar ICE candidates pendentes
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift()
        if (candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
        }
      }
    } catch (err) {
      console.error('❌ Handle answer error:', err)
    }
  }, [])

  // ============================================================================
  // Handle ICE Candidate
  // ============================================================================
  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current
    
    // Se não tem PC ou remote description, guardar para depois
    if (!pc || !pc.remoteDescription) {
      pendingCandidates.current.push(candidate)
      return
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch {
      // Ignorar erros de ICE candidate - são normais
    }
  }, [])

  // ============================================================================
  // ENCERRAR CHAMADA - Limpar tudo
  // ============================================================================
  const endCall = useCallback(() => {
    console.log('📴 Ending call')
    callActive.current = false
    stopQualityMonitor()
    
    pcRef.current?.close()
    pcRef.current = null
    
    pendingCandidates.current = []
    makingOffer.current = false
    ignoreOffer.current = false
    
    stopMedia()
    setRemoteConnected(false)
    setConnectionState('new')
    setQuality('connecting')
    
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

  // Expor handlers globalmente para WebSocket
  useEffect(() => {
    const win = window as unknown as { __webrtc?: { handleOffer: typeof handleOffer; handleAnswer: typeof handleAnswer; handleIce: typeof handleIce } }
    win.__webrtc = { handleOffer, handleAnswer, handleIce }
    return () => { delete win.__webrtc }
  }, [handleOffer, handleAnswer, handleIce])

  // Iniciar quando status muda para connected
  useEffect(() => {
    if (status === 'connected') {
      pendingCandidates.current = []
      initializeConnection()
    } else if (status === 'idle' || status === 'searching') {
      endCall()
    }
  }, [status, initializeConnection, endCall])

  // Cleanup on unmount
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

  return (
    <div 
      className="h-full w-full relative overflow-hidden" 
      style={bgStyle}
      onMouseMove={() => setShowControls(true)} 
      onTouchStart={() => setShowControls(true)}
    >

      {/* ============ IDLE STATE ============ */}
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

      {/* ============ SEARCHING STATE ============ */}
      {status === 'searching' && (
        <div className="h-full flex items-center justify-center bg-black">
          <div className="text-center px-4 relative">
            <div className="relative w-48 h-48 mx-auto mb-10">
              <div className="absolute inset-0 rounded-full border border-cyan-500/10 animate-ping" />
              <div className="absolute inset-2 rounded-full border border-cyan-500/20 animate-pulse" />
              <div className="absolute inset-0 rounded-full border-2 border-t-cyan-500 border-r-cyan-500/30 animate-spin" />
              
              <div className="absolute inset-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 backdrop-blur-3xl flex items-center justify-center border border-white/10">
                <svg className="w-10 h-10 text-cyan-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
            </div>

            <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-2 uppercase">
              Buscando...
            </h2>
            <div className="flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        </div>
      )}

      {/* ============ CONNECTED STATE ============ */}
      {status === 'connected' && (
        <div className="h-full w-full relative">
          {/* Quality indicator */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
            <span className={`w-2 h-2 rounded-full ${qualityConfig[quality].color}`} />
            <span className="text-white text-xs">{qualityConfig[quality].text}</span>
          </div>

          {/* ============ SPLIT VIEW 50/50 ============ */}
          {viewMode === 'split' && (
            <div className="h-full w-full flex flex-col md:flex-row bg-black">
              {/* Remote Video */}
              <div className="flex-1 relative min-h-[50%] md:min-h-0 border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90">
                    <div className="text-center">
                      <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center animate-pulse">
                        <span className="text-3xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                      </div>
                      <p className="text-white font-bold">{partnerInfo?.anonymousId || 'Conectando...'}</p>
                      <p className="text-cyan-400 text-xs mt-2 uppercase">Aguardando vídeo</p>
                    </div>
                  </div>
                )}
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <span className="text-white text-xs font-medium">{partnerInfo?.anonymousId || 'Parceiro'}</span>
                </div>
              </div>

              {/* Local Video */}
              <div className="flex-1 relative min-h-[50%] md:min-h-0 overflow-hidden">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className="text-white text-xs font-medium">Você</span>
                </div>
              </div>
            </div>
          )}

          {/* ============ PIP REMOTE (você pequeno) ============ */}
          {viewMode === 'pip-remote' && (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {!remoteConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                    </div>
                    <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                  </div>
                </div>
              )}
              <div className="absolute bottom-24 md:bottom-6 right-4 w-28 h-36 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              </div>
            </>
          )}

          {/* ============ PIP LOCAL (parceiro pequeno) ============ */}
          {viewMode === 'pip-local' && (
            <>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              <div className="absolute bottom-24 md:bottom-6 right-4 w-28 h-36 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl bg-black">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              </div>
            </>
          )}

          {/* ============ CONTROLS ============ */}
          <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-4 md:pb-6 px-4">
              <div className="flex items-center justify-center gap-3 md:gap-4">
                {/* Mic */}
                <button 
                  onClick={toggleMic} 
                  className={`p-3 md:p-4 rounded-full ${micOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500'} text-white transition-all shadow-lg`}
                >
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {micOn ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    )}
                  </svg>
                </button>

                {/* Camera */}
                <button 
                  onClick={toggleCamera} 
                  className={`p-3 md:p-4 rounded-full ${cameraOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500'} text-white transition-all shadow-lg`}
                >
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {cameraOn ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    )}
                  </svg>
                </button>

                {/* View Mode */}
                <button 
                  onClick={cycleViewMode} 
                  className="p-3 md:p-4 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all shadow-lg"
                >
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                </button>

                {/* Next */}
                <button 
                  onClick={() => { endCall(); onNext?.() }} 
                  className="px-6 py-3 md:px-8 md:py-4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold transition-all shadow-lg shadow-cyan-500/30"
                >
                  PRÓXIMO
                </button>

                {/* Leave */}
                <button 
                  onClick={() => { endCall(); onLeave?.() }} 
                  className="p-3 md:p-4 rounded-full bg-red-500/80 hover:bg-red-500 text-white transition-all shadow-lg"
                >
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
