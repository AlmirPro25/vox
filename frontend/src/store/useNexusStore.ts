import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'zh' | 'ru' | 'ar'
export type ConnectionStatus = 'idle' | 'searching' | 'connecting' | 'connected' | 'error'
export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface User {
  id: string
  anonymousId: string
  nativeLanguage: Language
  targetLanguage: Language
  interests: string[]
  country: string
  reputation: number
}

export interface ChatMessage {
  id: string
  senderId: string
  originalText: string
  translatedText: string
  timestamp: Date
  isAiOptimized: boolean
}

interface PartnerInfo {
  anonymousId: string
  nativeLanguage?: string
  country?: string
  commonInterests?: string[]
}

interface SessionStats {
  startTime: Date | null
  messageCount: number
}

interface NexusState {
  user: User | null
  token: string | null
  status: ConnectionStatus
  wsStatus: WebSocketStatus
  messages: ChatMessage[]
  roomID: string | null
  partnerInfo: PartnerInfo | null
  partnerTyping: boolean
  sessionStats: SessionStats
  onlineCount: number
  
  setUser: (user: User) => void
  setToken: (token: string) => void
  setStatus: (status: ConnectionStatus) => void
  setWsStatus: (status: WebSocketStatus) => void
  setOnlineCount: (count: number) => void
  setRoom: (roomID: string, partner: PartnerInfo) => void
  addMessage: (msg: ChatMessage) => void
  updateLanguages: (native: Language, target: Language) => void
  updateInterests: (interests: string[]) => void
  setPartnerTyping: (typing: boolean) => void
  resetSession: () => void
}

export const useNexusStore = create<NexusState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      status: 'idle',
      wsStatus: 'disconnected',
      messages: [],
      roomID: null,
      partnerInfo: null,
      partnerTyping: false,
      sessionStats: { startTime: null, messageCount: 0 },
      onlineCount: 0,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setStatus: (status) => set({ status }),
      setWsStatus: (wsStatus) => set({ wsStatus }),
      setOnlineCount: (onlineCount) => set({ onlineCount }),
      setRoom: (roomID, partnerInfo) => set({ 
        roomID, 
        partnerInfo, 
        status: 'connected',
        sessionStats: { startTime: new Date(), messageCount: 0 }
      }),
      addMessage: (msg) => set((state) => ({ 
        messages: [...state.messages, msg],
        sessionStats: { ...state.sessionStats, messageCount: state.sessionStats.messageCount + 1 }
      })),
      updateLanguages: (native, target) => set((state) => ({
        user: state.user ? { ...state.user, nativeLanguage: native, targetLanguage: target } : null
      })),
      updateInterests: (interests) => set((state) => ({
        user: state.user ? { ...state.user, interests } : null
      })),
      setPartnerTyping: (partnerTyping) => set({ partnerTyping }),
      resetSession: () => set({ 
        status: 'idle', 
        roomID: null, 
        partnerInfo: null, 
        messages: [], 
        partnerTyping: false,
        sessionStats: { startTime: null, messageCount: 0 }
      }),
    }),
    {
      name: 'nexus-user',
      partialize: (state) => ({ 
        user: state.user ? {
          ...state.user,
          // Keep preferences across sessions
          nativeLanguage: state.user.nativeLanguage,
          targetLanguage: state.user.targetLanguage,
          interests: state.user.interests,
        } : null
      }),
    }
  )
)
