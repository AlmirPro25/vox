import { useCallback, useRef } from 'react'

// Simple sound effects using Web Audio API
export function useSound() {
  const audioContextRef = useRef<AudioContext | null>(null)

  const getContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return audioContextRef.current
  }, [])

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType = 'sine') => {
    try {
      const ctx = getContext()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      
      oscillator.frequency.value = frequency
      oscillator.type = type
      
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)
      
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration)
    } catch (e) {
      // Audio not supported
    }
  }, [getContext])

  const playConnect = useCallback(() => {
    playTone(523.25, 0.1) // C5
    setTimeout(() => playTone(659.25, 0.1), 100) // E5
    setTimeout(() => playTone(783.99, 0.15), 200) // G5
  }, [playTone])

  const playDisconnect = useCallback(() => {
    playTone(392, 0.15) // G4
    setTimeout(() => playTone(329.63, 0.2), 150) // E4
  }, [playTone])

  const playMessage = useCallback(() => {
    playTone(880, 0.08, 'triangle') // A5
  }, [playTone])

  const playNotification = useCallback(() => {
    playTone(1046.5, 0.1) // C6
    setTimeout(() => playTone(1318.5, 0.1), 80) // E6
  }, [playTone])

  return { playConnect, playDisconnect, playMessage, playNotification }
}
