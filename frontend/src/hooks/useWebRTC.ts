import { useEffect, useRef, useState, useCallback } from 'react'

// Configuração de ICE Servers com suporte a STUN/TURN via variáveis de ambiente
function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = []
  
  // STUN servers (padrão ou via env)
  const stunUrl = process.env.NEXT_PUBLIC_STUN_URL
  if (stunUrl) {
    servers.push({ urls: stunUrl })
  } else {
    // STUN padrão (Google)
    servers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    )
  }
  
  // TURN server (opcional, via env)
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL
  
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential
    })
  }
  
  return servers
}

const ICE_SERVERS = getIceServers()

// Tipos de conexão WebRTC
export type ConnectionType = 'host' | 'srflx' | 'relay' | 'unknown'

interface ConnectionInfo {
  type: ConnectionType
  local: string
  remote: string
  protocol: string
}

interface UseWebRTCProps {
  ws: WebSocket | null
  isConnected: boolean
  isInitiator: boolean
}

export function useWebRTC({ ws, isConnected, isInitiator }: UseWebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null)
  
  const peerConnection = useRef<RTCPeerConnection | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Iniciar mídia local
  const startMedia = useCallback(async (video = true, audio = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
        audio 
      })
      setLocalStream(stream)
      setCameraEnabled(video)
      setMicEnabled(audio)
      setError(null)
      return stream
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Permissão negada' : 'Mídia não disponível')
      return null
    }
  }, [])

  // Parar mídia
  const stopMedia = useCallback(() => {
    localStream?.getTracks().forEach(track => track.stop())
    setLocalStream(null)
    setCameraEnabled(false)
    setMicEnabled(false)
  }, [localStream])

  // Toggle câmera
  const toggleCamera = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setCameraEnabled(videoTrack.enabled)
      }
    }
  }, [localStream])

  // Toggle microfone
  const toggleMic = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setMicEnabled(audioTrack.enabled)
      }
    }
  }, [localStream])

  // Analisar estatísticas de conexão WebRTC
  const analyzeConnectionStats = useCallback(async () => {
    if (!peerConnection.current) return

    try {
      const stats = await peerConnection.current.getStats()
      
      stats.forEach((report) => {
        // Procurar pelo par de candidatos ativos
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const localCandidate = stats.get(report.localCandidateId)
          const remoteCandidate = stats.get(report.remoteCandidateId)
          
          if (localCandidate && remoteCandidate) {
            const localType = localCandidate.candidateType as ConnectionType
            const remoteType = remoteCandidate.candidateType as ConnectionType
            
            // Determinar tipo de conexão baseado nos candidatos
            let connectionType: ConnectionType = 'unknown'
            
            if (localType === 'relay' || remoteType === 'relay') {
              connectionType = 'relay'
            } else if (localType === 'srflx' || remoteType === 'srflx') {
              connectionType = 'srflx'
            } else if (localType === 'host' && remoteType === 'host') {
              connectionType = 'host'
            }
            
            const info: ConnectionInfo = {
              type: connectionType,
              local: `${localType} (${localCandidate.protocol})`,
              remote: `${remoteType} (${remoteCandidate.protocol})`,
              protocol: localCandidate.protocol || 'unknown'
            }
            
            setConnectionInfo(info)
            
            // Log detalhado no console
            const typeEmoji = connectionType === 'relay' ? '🔄' : connectionType === 'srflx' ? '🌐' : '🏠'
            const typeLabel = connectionType === 'relay' ? 'TURN Relay' : connectionType === 'srflx' ? 'STUN P2P' : 'Direct P2P'
            
            console.log(`${typeEmoji} WebRTC Connection Type: ${typeLabel}`)
            console.log(`   Local:  ${info.local}`)
            console.log(`   Remote: ${info.remote}`)
            console.log(`   ${connectionType === 'relay' ? '⚠️ Using TURN server (may incur costs)' : '✅ Direct P2P connection (optimal)'}`)
          }
        }
      })
    } catch (err) {
      console.error('Failed to get connection stats:', err)
    }
  }, [])

  // Iniciar monitoramento de estatísticas
  const startStatsMonitoring = useCallback(() => {
    if (statsInterval.current) {
      clearInterval(statsInterval.current)
    }
    
    // Checar stats a cada 2 segundos até conexão estabelecida
    let checksRemaining = 10
    statsInterval.current = setInterval(() => {
      analyzeConnectionStats()
      checksRemaining--
      
      // Parar após 10 tentativas ou quando conexão identificada
      if (checksRemaining <= 0 || connectionInfo?.type !== 'unknown') {
        if (statsInterval.current) {
          clearInterval(statsInterval.current)
          statsInterval.current = null
        }
      }
    }, 2000)
  }, [analyzeConnectionStats, connectionInfo])

  // Parar monitoramento de estatísticas
  const stopStatsMonitoring = useCallback(() => {
    if (statsInterval.current) {
      clearInterval(statsInterval.current)
      statsInterval.current = null
    }
    setConnectionInfo(null)
  }, [])

  // Criar peer connection
  const createPeerConnection = useCallback(() => {
    console.log('🔧 Creating RTCPeerConnection with ICE servers:', ICE_SERVERS)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const typeEmoji = event.candidate.type === 'relay' ? '🔄' : event.candidate.type === 'srflx' ? '🌐' : '🏠'
        console.log(`${typeEmoji} ICE candidate: ${event.candidate.type} (${event.candidate.protocol})`)
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'webrtc_ice', payload: { candidate: event.candidate } }))
        }
      } else {
        console.log('✅ ICE gathering complete')
      }
    }

    pc.ontrack = (event) => {
      console.log('📹 Remote track received:', event.track.kind)
      setRemoteStream(event.streams[0])
    }

    pc.onconnectionstatechange = () => {
      console.log('🔌 WebRTC state:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        console.log('✅ WebRTC connected successfully!')
        // Iniciar análise de conexão após conectar
        setTimeout(() => analyzeConnectionStats(), 1000)
        startStatsMonitoring()
      } else if (pc.connectionState === 'failed') {
        console.error('❌ WebRTC connection failed - consider adding TURN server')
        stopStatsMonitoring()
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        stopStatsMonitoring()
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE connection state:', pc.iceConnectionState)
    }

    return pc
  }, [ws, analyzeConnectionStats, startStatsMonitoring, stopStatsMonitoring])

  // Iniciar chamada (quem inicia)
  const startCall = useCallback(async () => {
    const stream = await startMedia(true, true)
    if (!stream) return

    const pc = createPeerConnection()
    peerConnection.current = pc

    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'webrtc_offer', payload: { sdp: offer } }))
    }
  }, [ws, startMedia, createPeerConnection])

  // Receber chamada
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const stream = await startMedia(true, true)
    if (!stream) return

    const pc = createPeerConnection()
    peerConnection.current = pc

    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'webrtc_answer', payload: { sdp: answer } }))
    }
  }, [ws, startMedia, createPeerConnection])

  // Receber resposta
  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(sdp))
    }
  }, [])

  // Receber ICE candidate
  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (peerConnection.current) {
      await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }, [])

  // Encerrar chamada
  const endCall = useCallback(() => {
    stopStatsMonitoring()
    peerConnection.current?.close()
    peerConnection.current = null
    stopMedia()
    setRemoteStream(null)
  }, [stopMedia, stopStatsMonitoring])

  // Efeito para iniciar chamada quando conectado
  useEffect(() => {
    if (isConnected && isInitiator) {
      startCall()
    }
    return () => {
      if (!isConnected) endCall()
    }
  }, [isConnected, isInitiator])

  // Listener para mensagens WebRTC
  useEffect(() => {
    if (!ws) return

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'webrtc_offer': handleOffer(msg.payload.sdp); break
          case 'webrtc_answer': handleAnswer(msg.payload.sdp); break
          case 'webrtc_ice': handleIceCandidate(msg.payload.candidate); break
        }
      } catch (e) {}
    }

    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws, handleOffer, handleAnswer, handleIceCandidate])

  return {
    localStream, remoteStream, localVideoRef, remoteVideoRef,
    cameraEnabled, micEnabled, error,
    connectionInfo, // Nova informação de debug
    startMedia, stopMedia, toggleCamera, toggleMic, startCall, endCall
  }
}
