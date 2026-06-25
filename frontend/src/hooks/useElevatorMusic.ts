import { useRef, useCallback, useEffect, useState } from 'react'

const ELEVATOR_TRACKS = [
  'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73467.mp3',
  'https://cdn.pixabay.com/audio/2022/08/02/audio_884fe92c21.mp3',
]

export function useElevatorMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const isPlayingRef = useRef(false)
  const isMutedRef = useRef(false)
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    const audio = new Audio()
    audio.loop = true
    audio.volume = 0.25
    audio.preload = 'auto'
    audio.src = ELEVATOR_TRACKS[Math.floor(Math.random() * ELEVATOR_TRACKS.length)]
    audioRef.current = audio
    audio.load()

    return () => {
      if (fadeRef.current) clearInterval(fadeRef.current)
      audio.pause()
      audio.src = ''
    }
  }, [])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio || isPlayingRef.current) return

    isPlayingRef.current = true
    audio.volume = 0

    audio.play().then(() => {
      setIsPlaying(true)
      let vol = 0
      if (fadeRef.current) clearInterval(fadeRef.current)
      fadeRef.current = setInterval(() => {
        vol += 0.03
        audio.volume = Math.min(vol, isMutedRef.current ? 0 : 0.25)
        if (vol >= 0.25 && fadeRef.current) {
          clearInterval(fadeRef.current)
          fadeRef.current = null
        }
      }, 80)
    }).catch(() => {
      isPlayingRef.current = false
      setIsPlaying(false)
    })
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !isPlayingRef.current) return

    let vol = audio.volume
    if (fadeRef.current) clearInterval(fadeRef.current)
    fadeRef.current = setInterval(() => {
      vol -= 0.03
      audio.volume = Math.max(vol, 0)
      if (vol <= 0) {
        if (fadeRef.current) clearInterval(fadeRef.current)
        fadeRef.current = null
        audio.pause()
        audio.currentTime = 0
        isPlayingRef.current = false
        setIsPlaying(false)
      }
    }, 40)
  }, [])

  const toggleMute = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    isMutedRef.current = !isMutedRef.current
    audio.volume = isMutedRef.current ? 0 : 0.25
    setIsMuted(isMutedRef.current)
  }, [])

  return { play, stop, toggleMute, isPlaying, isMuted }
}
