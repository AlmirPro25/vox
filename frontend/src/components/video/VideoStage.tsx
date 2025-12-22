import React, { useRef, useEffect, useState } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

interface VideoStageProps {
  ws: WebSocket | null
}

export function VideoStage({ ws }: VideoStageProps) {
  const { status, partnerInfo, roomID } = useNexusStore()
  const { theme } = useTheme()
  
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  
  const [cameraOn, setCameraOn] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitiator, setIsInitiator] = useState(false)

  const bgStyle = { background: theme === 'dark' ? 'linear-gradient(135deg, #0a0a0a 0%, #111 100%)' : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)' }

  // Iniciar mídia local
  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      setCameraOn(true)
      setMicOn(true)
      setError(null)
      return stream
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Permita acesso à câmera' : 'Câmera não disponível')
      return null
    }
  }

  // Parar mídia
  const stopMedia = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setCameraOn(false)
    setMicOn(false)
  }

  // Criar peer connection
  const createPC = () => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    
    pc.onicecandidate = (e) => {
      if (e.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'webrtc_ice', payload: { candidate: e.candidate } }))
      }
    }
    
    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]
      setRemoteConnected(true)
    }
    
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setRemoteConnected(false)
      }
    }
    
    return pc
  }

  // Iniciar chamada (quem inicia)
  const startCall = async () => {
    const stream = await startMedia()
    if (!stream) return
    
    const pc = createPC()
    pcRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    ws?.send(JSON.stringify({ type: 'webrtc_offer', payload: { sdp: offer } }))
  }

  // Receber offer
  const handleOffer = async (sdp: RTCSessionDescriptionInit) => {
    const stream = await startMedia()
    if (!stream) return
    
    const pc = createPC()
    pcRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    ws?.send(JSON.stringify({ type: 'webrtc_answer', payload: { sdp: answer } }))
  }

  // Receber answer
  const handleAnswer = async (sdp: RTCSessionDescriptionInit) => {
    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(sdp))
  }

  // Receber ICE
  const handleIce = async (candidate: RTCIceCandidateInit) => {
    await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate))
  }

  // Encerrar chamada
  const endCall = () => {
    pcRef.current?.close()
    pcRef.current = null
    stopMedia()
    setRemoteConnected(false)
  }

  // Toggle câmera
  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setCameraOn(track.enabled) }
  }

  // Toggle mic
  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled) }
  }

  // Listener WebSocket
  useEffect(() => {
    if (!ws) return
    const onMsg = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'matched') setIsInitiator(true)
        if (msg.type === 'webrtc_offer') handleOffer(msg.payload.sdp)
        if (msg.type === 'webrtc_answer') handleAnswer(msg.payload.sdp)
        if (msg.type === 'webrtc_ice') handleIce(msg.payload.candidate)
      } catch {}
    }
    ws.addEventListener('message', onMsg)
    return () => ws.removeEventListener('message', onMsg)
  }, [ws])

  // Iniciar chamada quando conectado
  useEffect(() => {
    if (status === 'connected' && isInitiator) {
      setTimeout(() => startCall(), 500)
    }
    if (status !== 'connected') {
      endCall()
      setIsInitiator(false)
    }
  }, [status, isInitiator])

  // Cleanup
  useEffect(() => () => endCall(), [])

  return (
    <div className="h-full w-full relative overflow-hidden" style={bgStyle}>
      {/* Estado Idle */}
      {status === 'idle' && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center px-4">
            <div className="w-24 h-24 md:w-32 md:h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center animate-pulse">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold theme-text mb-2">Ready to Connect</h2>
            <p className="theme-text-secondary text-sm">Video chat with people worldwide</p>
          </div>
        </div>
      )}

      {/* Estado Searching */}
      {status === 'searching' && (
        <div className="h-full flex items-center justify-center">
          <div className="text-center px-4">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full border-4 border-t-cyan-500 animate-spin" style={{ borderColor: theme === 'dark' ? '#1f2937' : '#e5e7eb', borderTopColor: '#06b6d4' }} />
            <h2 className="text-lg font-semibold theme-text mb-2">Searching...</h2>
            <p className="theme-text-secondary text-sm">Finding someone to chat</p>
          </div>
        </div>
      )}

      {/* Estado Connected - Video Call */}
      {status === 'connected' && (
        <div className="h-full flex flex-col">
          {/* Video remoto (grande) */}
          <div className="flex-1 relative bg-black">
            {remoteConnected ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2)}</span>
                  </div>
                  <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                  <p className="text-gray-400 text-sm mt-1">Connecting video...</p>
                </div>
              </div>
            )}
            
            {/* Info do parceiro */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-white text-sm">{partnerInfo?.anonymousId}</span>
            </div>
          </div>

          {/* Video local (pequeno) + Controles */}
          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3">
            {/* Mini video local */}
            <div className="w-32 h-24 md:w-40 md:h-30 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl">
              {cameraOn ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              ) : (
                <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
              )}
            </div>
            
            {/* Controles */}
            <div className="flex gap-2">
              <button onClick={toggleMic} className={`p-3 rounded-full ${micOn ? 'bg-gray-700' : 'bg-red-500'} text-white shadow-lg`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {micOn ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  )}
                </svg>
              </button>
              <button onClick={toggleCamera} className={`p-3 rounded-full ${cameraOn ? 'bg-gray-700' : 'bg-red-500'} text-white shadow-lg`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {cameraOn ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Erro */}
          {error && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
