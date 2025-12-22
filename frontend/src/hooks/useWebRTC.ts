import { useEffect, useRef, useState, useCallback } from 'react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

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
  
  const peerConnection = useRef<RTCPeerConnection | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

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

  // Criar peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    
    pc.onicecandidate = (event) => {
      if (event.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'webrtc_ice', payload: { candidate: event.candidate } }))
      }
    }

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0])
    }

    pc.onconnectionstatechange = () => {
      console.log('WebRTC state:', pc.connectionState)
    }

    return pc
  }, [ws])

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
    peerConnection.current?.close()
    peerConnection.current = null
    stopMedia()
    setRemoteStream(null)
  }, [stopMedia])

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
    startMedia, stopMedia, toggleCamera, toggleMic, startCall, endCall
  }
}
