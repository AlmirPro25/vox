import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // TURN servers gratuitos (OpenRelay)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
]

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
  
  const [cameraOn, setCameraOn] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<string>('new')

  const bgStyle = { background: theme === 'dark' ? 'linear-gradient(135deg, #0a0a0a 0%, #111 100%)' : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)' }

  // Iniciar mídia local
  const startMedia = useCallback(async () => {
    try {
      console.log('📹 Requesting camera/mic...')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, 
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
      setError(err.name === 'NotAllowedError' ? 'Permita acesso à câmera e microfone' : 'Câmera não disponível')
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

  // Criar peer connection
  const createPC = useCallback(() => {
    console.log('🔗 Creating PeerConnection...')
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    
    pc.onicecandidate = (e) => {
      if (e.candidate && sendSignal) {
        console.log('🧊 Sending ICE candidate')
        sendSignal('webrtc_ice', { candidate: e.candidate })
      }
    }
    
    pc.ontrack = (e) => {
      console.log('📺 Received remote track!', e.streams)
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0]
        remoteVideoRef.current.play().catch(console.error)
        setRemoteConnected(true)
      }
    }
    
    pc.onconnectionstatechange = () => {
      console.log('🔄 Connection state:', pc.connectionState)
      setConnectionState(pc.connectionState)
      if (pc.connectionState === 'connected') setRemoteConnected(true)
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setRemoteConnected(false)
    }

    pc.oniceconnectionstatechange = () => console.log('🧊 ICE state:', pc.iceConnectionState)
    
    return pc
  }, [sendSignal])

  // Iniciar chamada (initiator)
  const startCall = useCallback(async () => {
    console.log('📞 Starting call as initiator...')
    const stream = await startMedia()
    if (!stream || !sendSignal) return
    
    const pc = createPC()
    pcRef.current = pc
    stream.getTracks().forEach(t => {
      console.log('➕ Adding track:', t.kind)
      pc.addTrack(t, stream)
    })
    
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    console.log('📤 Sending offer...')
    sendSignal('webrtc_offer', { sdp: offer })
  }, [createPC, startMedia, sendSignal])

  // Receber offer (responder)
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    console.log('📥 Received offer, creating answer...')
    let stream = localStreamRef.current
    if (!stream) stream = await startMedia()
    if (!stream || !sendSignal) return
    
    // Fechar PC anterior se existir
    pcRef.current?.close()
    
    const pc = createPC()
    pcRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream!))
    
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    console.log('📤 Sending answer...')
    sendSignal('webrtc_answer', { sdp: answer })
  }, [createPC, startMedia, sendSignal])

  // Receber answer
  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    console.log('📥 Received answer')
    if (pcRef.current && pcRef.current.signalingState === 'have-local-offer') {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp))
    }
  }, [])

  // Receber ICE
  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    console.log('🧊 Received ICE candidate')
    try {
      if (pcRef.current && pcRef.current.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate))
      }
    } catch (e) { console.error('ICE error:', e) }
  }, [])

  // Encerrar chamada
  const endCall = useCallback(() => {
    console.log('📴 Ending call')
    pcRef.current?.close()
    pcRef.current = null
    stopMedia()
    setRemoteConnected(false)
    setConnectionState('new')
  }, [stopMedia])

  // Toggle câmera/mic
  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setCameraOn(track.enabled) }
  }
  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled) }
  }

  // Expor handlers globalmente pra o index.tsx chamar
  useEffect(() => {
    (window as any).__webrtc = { handleOffer, handleAnswer, handleIce, startCall }
  }, [handleOffer, handleAnswer, handleIce, startCall])

  // Iniciar chamada quando status muda pra connected
  useEffect(() => {
    if (status === 'connected') {
      // Só inicia se for o initiator (determinado no match)
      const isInitiator = (window as any).__isWebRTCInitiator
      console.log('🎯 Status connected, isInitiator:', isInitiator)
      
      // Evitar múltiplas chamadas
      if (pcRef.current) {
        console.log('⚠️ PeerConnection already exists, skipping...')
        return
      }
      
      if (isInitiator) {
        console.log('📞 Will start call as INITIATOR in 1.5s...')
        const timer = setTimeout(() => {
          if (!pcRef.current) startCall()
        }, 1500)
        return () => clearTimeout(timer)
      } else {
        console.log('⏳ Waiting for offer as RESPONDER...')
        // Só inicia a mídia local pra estar pronto quando receber offer
        if (!localStreamRef.current) startMedia()
      }
    } else {
      endCall()
    }
  }, [status])

  // Cleanup
  useEffect(() => () => endCall(), [endCall])

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
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            
            {!remoteConnected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{partnerInfo?.anonymousId?.slice(0, 2)}</span>
                  </div>
                  <p className="text-white font-medium">{partnerInfo?.anonymousId}</p>
                  <p className="text-gray-400 text-sm mt-1">Aguardando video...</p>
                  <p className="text-gray-500 text-xs mt-2">{connectionState}</p>
                </div>
              </div>
            )}
            
            {/* Info do parceiro */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
              <span className={`w-2 h-2 rounded-full ${remoteConnected ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`} />
              <span className="text-white text-sm">{partnerInfo?.anonymousId}</span>
            </div>

            {/* Botões Next e Stop */}
            <div className="absolute top-3 right-3 flex gap-2">
              <button onClick={onNext} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-sm font-medium shadow-lg transition-colors flex items-center gap-2">
                Próximo
              </button>
              <button onClick={onLeave} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium shadow-lg transition-colors">
                Parar
              </button>
            </div>
          </div>

          {/* Video local (pequeno) + Controles */}
          <div className="absolute bottom-4 left-4 flex items-end gap-3">
            <div className="w-32 h-24 md:w-40 md:h-30 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl bg-gray-900">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            </div>
            <div className="flex gap-2">
              <button onClick={toggleMic} className={`p-3 rounded-full ${micOn ? 'bg-gray-700' : 'bg-red-500'} text-white shadow-lg`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={micOn ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"} />
                </svg>
              </button>
              <button onClick={toggleCamera} className={`p-3 rounded-full ${cameraOn ? 'bg-gray-700' : 'bg-red-500'} text-white shadow-lg`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={cameraOn ? "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" : "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"} />
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500/90 text-white px-6 py-3 rounded-xl">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
