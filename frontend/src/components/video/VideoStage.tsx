import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'
import { useElevatorMusic } from '@/hooks/useElevatorMusic'
import { WebRTCDebugPanel } from '@/components/ui/WebRTCDebugPanel'
import { getApiUrl } from '@/lib/runtimeUrls'

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

// ============================================================================
// VOXGRID - Global TURN Infrastructure
// ============================================================================
// TECH LEAD RECOMMENDATIONS:
// 1. TCP primeiro = atravessa firewalls africanos com mais sucesso
// 2. iceTransportPolicy: "relay" para teste inicial (força TURN)
// 3. Telemetria de tipo de conexão (host/srflx/relay)
// ============================================================================

// Modo de teste: forçar relay para validar TURN global
const FORCE_RELAY_MODE = process.env.NEXT_PUBLIC_FORCE_RELAY === 'true'

const getIceServers = async (): Promise<RTCIceServer[]> => {
  // STUN servers (para descoberta de IP público)
  const baseServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
  
  try {
    // Buscar TURN do backend (Metered.ca global ou próprio)
    const res = await fetch(`${getApiUrl()}/turn-credentials`)
    if (res.ok) {
      const turnServers = await res.json()
      console.log('🌐 VOXGRID: TURN servers loaded from backend')
      return [...baseServers, ...turnServers]
    }
  } catch (err) {
    console.warn('⚠️ VOXGRID: Failed to fetch TURN, using fallback')
  }
  
  // Fallback - Metered.ca global (TCP primeiro para firewalls)
  return [
    ...baseServers,
    {
      urls: [
        'turns:global.relay.metered.ca:443?transport=tcp',  // TLS TCP primeiro
        'turn:global.relay.metered.ca:443',                  // UDP 443
        'turn:global.relay.metered.ca:80'                    // UDP 80 fallback
      ],
      username: 'e8dd65c92f6f1f2d5c67c7a3',
      credential: 'kW3QfUZKpLqYhDzS'
    }
  ]
}

// Telemetria ICE - para métricas de conexão
type ConnectionType = 'host' | 'srflx' | 'relay' | 'unknown'

interface ConnectionInfo {
  type: ConnectionType
  local: string
  remote: string
  protocol: string
}

const logIceTelemetry = (pc: RTCPeerConnection, setConnectionInfo?: (info: ConnectionInfo) => void) => {
  pc.getStats().then(stats => {
    let connectionType: ConnectionType = 'unknown'
    let localCandidateType = 'unknown'
    let remoteCandidateType = 'unknown'
    let protocol = 'unknown'
    let selectedPairId = ''
    
    stats.forEach((report) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        selectedPairId = report.id
        // @ts-ignore
        const localId = report.localCandidateId
        // @ts-ignore
        const remoteId = report.remoteCandidateId
        
        stats.forEach((r) => {
          if (r.id === localId) {
            localCandidateType = r.candidateType || 'unknown'
            // @ts-ignore
            protocol = r.protocol || 'unknown'
          }
          if (r.id === remoteId) remoteCandidateType = r.candidateType || 'unknown'
        })
      }
    })
    
    // Determinar tipo de conexão
    if (localCandidateType === 'relay' || remoteCandidateType === 'relay') {
      connectionType = 'relay'
    } else if (localCandidateType === 'srflx' || remoteCandidateType === 'srflx') {
      connectionType = 'srflx'
    } else if (localCandidateType === 'host' && remoteCandidateType === 'host') {
      connectionType = 'host'
    }
    
    const typeLabel = connectionType === 'relay' ? 'relay (TURN)' : connectionType === 'srflx' ? 'srflx (STUN)' : connectionType === 'host' ? 'host (P2P direto)' : 'unknown'
    const typeEmoji = connectionType === 'relay' ? '🔄' : connectionType === 'srflx' ? '🌐' : '🏠'
    
    console.log(`${typeEmoji} VOXGRID ICE: ${typeLabel} | local=${localCandidateType} remote=${remoteCandidateType} protocol=${protocol}`)
    
    // Atualizar estado do painel de debug
    if (setConnectionInfo && connectionType !== 'unknown') {
      setConnectionInfo({
        type: connectionType,
        local: `${localCandidateType} (${protocol})`,
        remote: `${remoteCandidateType}`,
        protocol
      })
    }
  }).catch(() => {})
}

type ViewMode = 'split' | 'pip-remote' | 'pip-local'
type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'connecting'

interface VideoStageProps {
  onNext?: () => void
  onLeave?: () => void
  sendSignal?: (type: string, payload: unknown) => void
}

type QueuedWebRTCSignal = {
  type: 'offer' | 'answer' | 'ice'
  payload: unknown
}

function queueWebRTCSignal(signal: QueuedWebRTCSignal): void {
  const win = window as unknown as { __pendingWebRTCSignals?: QueuedWebRTCSignal[] }
  const queue = win.__pendingWebRTCSignals || []
  queue.push(signal)
  win.__pendingWebRTCSignals = queue.slice(-256)
}

export function VideoStage({ onNext, onLeave, sendSignal }: VideoStageProps) {
  const { status, partnerInfo } = useNexusStore()
  const { theme } = useTheme()
  const elevatorMusic = useElevatorMusic()
  const { play: playElevatorMusic, stop: stopElevatorMusic, toggleMute: toggleElevatorMute, isMuted: elevatorMuted } = elevatorMusic

  // Refs - 1 PeerConnection por match, NUNCA recriar
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const facingModeRef = useRef<'user' | 'environment'>('user')
  
  // Perfect Negotiation state
  const makingOffer = useRef(false)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const isInitiatorRef = useRef(false) // Definido pelo backend
  const iceRestarting = useRef(false) // Debounce ICE restart
  
  // Controle
  const callActive = useRef(false)
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refs-espelho do estado de mute (lidos na recuperação pós-background)
  const cameraOnRef = useRef(true)
  const micOnRef = useRef(true)

  // State
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [remoteMuted, setRemoteMuted] = useState(false) // Detectar remote mute
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [showControls, setShowControls] = useState(true)
  const [quality, setQuality] = useState<ConnectionQuality>('connecting')
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null) // Debug info
  const [searchSeconds, setSearchSeconds] = useState(0)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false)

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

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message = 'Camera e microfone exigem HTTPS. Abra a versao segura do VOX-BRIDGE.'
      console.error('Media unavailable:', message)
      setMediaError(message)
      setCameraOn(false)
      setMicOn(false)
      return null
    }

    try {
      setMediaError(null)
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
      cameraOnRef.current = stream.getVideoTracks().length > 0
      micOnRef.current = stream.getAudioTracks().length > 0
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
        cameraOnRef.current = false
        micOnRef.current = true
        return audioStream
      } catch {
        const name = err instanceof DOMException ? err.name : ''
        setMediaError(
          name === 'NotAllowedError'
            ? 'Permita o acesso a camera e ao microfone nas configuracoes do navegador.'
            : 'Nao foi possivel iniciar sua camera ou microfone.'
        )
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
  // RECUPERAÇÃO DE MÍDIA PÓS-BACKGROUND
  // ============================================================================
  // No mobile, o SO mata as tracks de câmera/mic quando o app vai pra background.
  // Ao retornar (resume / visibility visible), as tracks ficam "ended" e a tela
  // fica preta. Esta função re-adquire a mídia preservando o estado de mute do
  // usuário e reanexa via RTCRtpSender.replaceTrack() sem derrubar a chamada.
  // ============================================================================
  const recoverMediaAfterBackground = useCallback(async (): Promise<void> => {
    // Captura o estado desejado ANTES de recriar (preserva mute do usuário)
    const wantVideo = cameraOnRef.current
    const wantAudio = micOnRef.current
    const facing = facingModeRef.current || 'user'

    const oldStream = localStreamRef.current
    const videoDead = !oldStream?.getVideoTracks().some((t) => t.readyState === 'live')
    const audioDead = !oldStream?.getAudioTracks().some((t) => t.readyState === 'live')

    // Se nada morreu, apenas reanexa o stream ao <video> (pode ter perdido o srcObject)
    if (!videoDead && !audioDead) {
      if (oldStream && localVideoRef.current && localVideoRef.current.srcObject !== oldStream) {
        localVideoRef.current.srcObject = oldStream
        localVideoRef.current.play().catch(() => {})
      }
      return
    }

    console.log('♻️ Recovering media after background (videoDead=' + videoDead + ', audioDead=' + audioDead + ')')
    setMediaError(null)

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facing } : false,
        audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false,
      })

      // Parar tracks velhos antes de descartar
      oldStream?.getTracks().forEach((t) => { try { t.stop() } catch {} })

      localStreamRef.current = newStream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream
        localVideoRef.current.play().catch(() => {})
      }

      // Reanexar ao PeerConnection ativo SEM renegociar (replaceTrack)
      const pc = pcRef.current
      if (pc && pc.connectionState !== 'closed') {
        const senders = pc.getSenders()
        for (const track of newStream.getTracks()) {
          const sender = senders.find((s) => s.track && s.track.kind === track.kind)
          if (sender) {
            try { await sender.replaceTrack(track) } catch (err) { console.warn('replaceTrack failed:', err) }
          } else {
            try { pc.addTrack(track, newStream) } catch {}
          }
        }
        console.log('✅ Media reattached to active call (replaceTrack)')
      }

      setCameraOn(wantVideo)
      setMicOn(wantAudio)
    } catch (err) {
      console.error('❌ Media recovery failed:', err)
      const name = err instanceof DOMException ? err.name : ''
      setMediaError(
        name === 'NotAllowedError'
          ? 'Permita o acesso a camera e ao microfone nas configuracoes do navegador.'
          : 'Nao foi possivel reiniciar sua camera apos voltar do segundo plano.'
      )
    }
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
    
    // VOXGRID: Configuração otimizada para conexões globais
    const pc = new RTCPeerConnection({
      iceServers,
      // Pool = 0 para TURN público
      iceCandidatePoolSize: 0,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      // TECH LEAD: iceTransportPolicy: "relay" para teste Brasil ↔ África
      // Força uso de TURN, ignorando P2P direto
      ...(FORCE_RELAY_MODE && { iceTransportPolicy: 'relay' as RTCIceTransportPolicy })
    })
    
    if (FORCE_RELAY_MODE) {
      console.log('🔒 VOXGRID: FORCE_RELAY_MODE ativo - forçando TURN')
    }

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
      
      // VOXGRID: Log telemetria ICE quando conectar
      setTimeout(() => logIceTelemetry(pc, setConnectionInfo), 2000)
      
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
    if (!stream) {
      callActive.current = false
      return
    }

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
    if (!callActive.current) {
      queueWebRTCSignal({ type: 'offer', payload: sdp })
      return
    }
    
    const pc = pcRef.current
    if (!pc) {
      queueWebRTCSignal({ type: 'offer', payload: sdp })
      return
    }

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
    if (!callActive.current) {
      queueWebRTCSignal({ type: 'answer', payload: sdp })
      return
    }
    
    const pc = pcRef.current
    if (!pc) {
      queueWebRTCSignal({ type: 'answer', payload: sdp })
      return
    }

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
    if (!callActive.current) {
      queueWebRTCSignal({ type: 'ice', payload: candidate })
      return
    }
    
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
    const hasActiveResources = callActive.current || pcRef.current || localStreamRef.current || remoteVideoRef.current?.srcObject
    if (!hasActiveResources) return

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
    if (track) {
      track.enabled = !track.enabled
      cameraOnRef.current = track.enabled
      setCameraOn(track.enabled)
    }
  }, [])

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      micOnRef.current = track.enabled
      setMicOn(track.enabled)
    }
  }, [])

  // Expor handlers
  useEffect(() => {
    const win = window as unknown as {
      __webrtc?: { handleOffer: typeof handleOffer; handleAnswer: typeof handleAnswer; handleIce: typeof handleIce }
      __pendingWebRTCSignals?: QueuedWebRTCSignal[]
    }
    win.__webrtc = { handleOffer, handleAnswer, handleIce }
    return () => { delete win.__webrtc }
  }, [handleOffer, handleAnswer, handleIce])

  // Status change
  useEffect(() => {
    if (status === 'connected') {
      pendingCandidates.current = []
      void initializeConnection().then(() => {
        const win = window as unknown as {
          __webrtc?: { handleOffer: typeof handleOffer; handleAnswer: typeof handleAnswer; handleIce: typeof handleIce }
          __pendingWebRTCSignals?: QueuedWebRTCSignal[]
        }
        if (!pcRef.current || !win.__webrtc) return

        const queued = win.__pendingWebRTCSignals || []
        win.__pendingWebRTCSignals = []
        queued.forEach((signal) => {
          if (signal.type === 'offer') void win.__webrtc?.handleOffer(signal.payload as RTCSessionDescriptionInit)
          if (signal.type === 'answer') void win.__webrtc?.handleAnswer(signal.payload as RTCSessionDescriptionInit)
          if (signal.type === 'ice') void win.__webrtc?.handleIce(signal.payload as RTCIceCandidateInit)
        })
      })
      stopElevatorMusic()
    } else if (status === 'idle' || status === 'searching') {
      endCall()
    }
  }, [status, initializeConnection, endCall, stopElevatorMusic, handleOffer, handleAnswer, handleIce])

  useEffect(() => {
    if (status === 'searching') {
      playElevatorMusic()
    } else {
      stopElevatorMusic()
    }
  }, [status, playElevatorMusic, stopElevatorMusic])

  useEffect(() => {
    if (status !== 'searching') {
      setSearchSeconds(0)
      return
    }

    setSearchSeconds(0)
    const timer = setInterval(() => setSearchSeconds((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [status])

  // ============================================================================
  // RECUPERAÇÃO PÓS-BACKGROUND (BUG: "câmera some ao voltar do segundo plano")
  // ============================================================================
  // No Android/iOS, o SO revoga câmera/mic quando o app vai para background.
  // Ao retornar, este listener re-adquire a mídia e reanexa à chamada ativa.
  // ============================================================================
  useEffect(() => {
    // Só tenta recuperar se há uma chamada em andamento
    const shouldRecover = () => status === 'connected' && callActive.current

    let removeCapListener: (() => void) | null = null

    // (1) Nativo (Capacitor / APK Android) - via plugin oficial @capacitor/app
    import('@capacitor/app').then(({ App }) => {
      const handler = ({ isActive }: { isActive: boolean }) => {
        if (isActive && shouldRecover()) {
          // Pequeno delay: o SO precisa restaurar o contexto de mídia primeiro
          setTimeout(() => void recoverMediaAfterBackground(), 300)
        }
      }
      App.addListener('appStateChange', handler).then((h) => {
        removeCapListener = () => { void h.remove() }
      })
    }).catch(() => {
      // Não-nativo (web pura): ignora silenciosamente
    })

    // (2) Web (fallback) - visibilitychange cobre navegador e WebView sem plugin
    const handleVisibility = () => {
      if (!document.hidden && shouldRecover()) {
        setTimeout(() => void recoverMediaAfterBackground(), 300)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (removeCapListener) removeCapListener()
    }
  }, [status, recoverMediaAfterBackground])

  // Auto-hide controls
  useEffect(() => {
    if (status !== 'connected') return
    const timer = setTimeout(() => setShowControls(false), 4000)
    return () => clearTimeout(timer)
  }, [status, showControls])

  // Cleanup - libera mídia e fecha PC ao desmontar o componente
  useEffect(() => () => endCall(), [endCall])

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
            <p className="text-gray-400 text-sm mb-4">
              {searchSeconds < 8
                ? 'Procurando alguem disponivel agora'
                : searchSeconds < 35
                  ? 'Voce esta na fila. Se houver so voce online, o sistema vai cancelar automaticamente.'
                  : 'Ainda sem par disponivel. Vamos encerrar a busca em instantes.'}
            </p>
            <div className="mx-auto mb-4 w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-400">
              {searchSeconds}s na fila
            </div>
            <div className="flex justify-center gap-1 mb-4">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.2s]" />
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce [animation-delay:0.4s]" />
            </div>
            <button 
              onClick={toggleElevatorMute}
              className="flex items-center justify-center gap-2 text-gray-400 text-xs hover:text-cyan-400 transition-colors mx-auto"
            >
              {!elevatorMuted ? (
                <>
                  <div className="flex items-end gap-0.5 h-4">
                    <span className="w-1 bg-cyan-500/60 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0ms' }} />
                    <span className="w-1 bg-cyan-500/60 rounded-full animate-pulse" style={{ height: '70%', animationDelay: '150ms' }} />
                    <span className="w-1 bg-cyan-500/60 rounded-full animate-pulse" style={{ height: '50%', animationDelay: '300ms' }} />
                    <span className="w-1 bg-cyan-500/60 rounded-full animate-pulse" style={{ height: '80%', animationDelay: '450ms' }} />
                  </div>
                  <span>🎵 Música de espera</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  <span>Música mutada (clique pra ativar)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* CONNECTED */}
      {status === 'connected' && (
        <div className="h-full w-full relative">
          {mediaError && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-6">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                  <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v4m0 4h.01M10.3 4.6L2.7 18a1.5 1.5 0 001.3 2.25h16a1.5 1.5 0 001.3-2.25L13.7 4.6a2 2 0 00-3.4 0z" />
                  </svg>
                </div>
                <h2 className="mt-4 text-xl font-bold text-white">Camera indisponivel</h2>
                <p className="mt-2 text-sm leading-6 text-white/65">{mediaError}</p>
                <a
                  href="https://vox-bridge-ivory.vercel.app"
                  className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-cyan-500 px-5 text-sm font-bold text-white"
                >
                  Abrir versao segura
                </a>
              </div>
            </div>
          )}

          {/* Quality */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
            <span className={`w-2 h-2 rounded-full ${qualityConfig[quality].color}`} />
            <span className="text-white text-xs">{qualityConfig[quality].text}</span>
          </div>

          {/* SPLIT 50/50 - Mobile: stacked vertical com padding pras barras */}
          {viewMode === 'split' && (
            <div className="absolute inset-0 flex flex-col md:flex-row bg-black pt-12 pb-20 md:pt-0 md:pb-0">
              {/* Remote Video - 50% */}
              <div className="relative flex-1 min-h-0 border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
                <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover bg-black -scale-x-100" 
                />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90">
                    <div className="text-center">
                      <div className="w-14 h-14 md:w-20 md:h-20 mx-auto mb-2 md:mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center animate-pulse">
                        <span className="text-lg md:text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                      </div>
                      <p className="text-white font-medium text-xs md:text-base">{partnerInfo?.anonymousId || 'Conectando...'}</p>
                    </div>
                  </div>
                )}
                {remoteMuted && remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                      <div className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-2 rounded-full bg-gray-800 flex items-center justify-center">
                        <svg className="w-6 h-6 md:w-8 md:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </div>
                      <p className="text-gray-400 text-[10px] md:text-sm">Câmera desligada</p>
                    </div>
                  </div>
                )}
                <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-black/50 flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <span className="text-white text-[10px]">{partnerInfo?.anonymousId || 'Parceiro'}</span>
                </div>
              </div>
              {/* Local Video - 50% */}
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover bg-black -scale-x-100" 
                />
                <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-black/50 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                  <span className="text-white text-[10px]">Você</span>
                </div>
              </div>
            </div>
          )}

          {/* PIP Remote */}
          {viewMode === 'pip-remote' && (
            <div className="absolute inset-0 pt-12 pb-20 md:pt-0 md:pb-0">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover -scale-x-100" />
              {!remoteConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
                    <span className="text-xl md:text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2) || '?'}</span>
                  </div>
                </div>
              )}
              <div className="absolute bottom-4 right-4 w-24 h-32 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
              </div>
            </div>
          )}

          {/* PIP Local */}
          {viewMode === 'pip-local' && (
            <div className="absolute inset-0 pt-12 pb-20 md:pt-0 md:pb-0">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
              <div className="absolute bottom-4 right-4 w-24 h-32 md:w-36 md:h-48 rounded-xl overflow-hidden border-2 border-white/30 shadow-2xl">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover -scale-x-100" />
              </div>
            </div>
          )}

          {/* CONTROLS - Fixed bottom bar */}
          <div className={`absolute inset-x-0 bottom-0 z-30 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-8 md:px-4 md:pb-6">
              <div className="mx-auto flex max-w-full items-center justify-center gap-2 md:gap-4">
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

                <button onClick={() => { endCall(); onNext?.() }} className="h-12 min-w-0 px-4 text-sm md:h-auto md:px-8 md:py-4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-500/30">
                  Proximo
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
 {/* WebRTC Debug Panel */}
 <WebRTCDebugPanel connectionInfo={connectionInfo} isVisible={remoteConnected} />

    </div>
  )
}
