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
  mediaType?: 'image' | 'audio' | 'video'
  mediaUrl?: string
  fileName?: string
  /**
   * Status de entrega para mensagens do próprio usuário.
   * - undefined / 'delivered': compatibilidade (mensagens antigas/recebidas)
   * - 'sending': enviando ao servidor
   * - 'sent': servidor aceitou e repassou ao par
   * - 'failed': falhou (rede, payload, par offline) — permite retry
   */
  status?: MessageStatus
  /** Guarda o payload original para retry (texto ou mídia) */
  retryPayload?: { kind: 'text' | 'media'; data: unknown }
}

export type MessageStatus = 'sending' | 'sent' | 'failed' | 'delivered'

interface PartnerInfo {
  id?: string
  anonymousId: string
  nativeLanguage?: string
  country?: string
  commonInterests?: string[]
}

interface SessionStats {
  startTime: Date | null
  messageCount: number
}

export interface FriendProfile {
  id: string
  anonymousId: string
  displayName?: string
  handle?: string
  nativeLanguage?: string
  country?: string
  commonInterests?: string[]
  interests?: string[]
  addedAt?: string
  status?: 'friend' | 'pending'
  online?: boolean
  inCall?: boolean
  requestId?: string
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
  friends: FriendProfile[]
  friendRequests: FriendProfile[]
  discovery: FriendProfile[]
  
  setUser: (user: User) => void
  setToken: (token: string) => void
  setStatus: (status: ConnectionStatus) => void
  setWsStatus: (status: WebSocketStatus) => void
  setOnlineCount: (count: number) => void
  setRoom: (roomID: string, partner: PartnerInfo) => void
  addMessage: (msg: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  updateLanguages: (native: Language, target: Language) => void
  updateInterests: (interests: string[]) => void
  addFriend: (profile: Omit<FriendProfile, 'addedAt' | 'status'>) => void
  removeFriend: (id: string) => void
  setFriends: (friends: FriendProfile[], requests?: FriendProfile[]) => void
  setDiscovery: (profiles: FriendProfile[]) => void
  setFriendPresence: (id: string, online: boolean) => void
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
      friends: [],
      friendRequests: [],
      discovery: [],

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
      updateMessage: (id, patch) => set((state) => ({
        messages: state.messages.map((message) => (
          message.id === id ? { ...message, ...patch } : message
        )),
      })),
      updateLanguages: (native, target) => set((state) => ({
        user: state.user ? { ...state.user, nativeLanguage: native, targetLanguage: target } : null
      })),
      updateInterests: (interests) => set((state) => ({
        user: state.user ? { ...state.user, interests } : null
      })),
      addFriend: (profile) => set((state) => {
        if (state.friends.some((friend) => friend.id === profile.id)) return state
        return {
          friends: [
            {
              ...profile,
              addedAt: new Date().toISOString(),
              status: 'friend',
            },
            ...state.friends,
          ],
        }
      }),
      removeFriend: (id) => set((state) => ({
        friends: state.friends.filter((friend) => friend.id !== id),
      })),
      setFriends: (friends, friendRequests = []) => set({ friends, friendRequests }),
      setDiscovery: (discovery) => set({ discovery }),
      setFriendPresence: (id, online) => set((state) => ({
        friends: state.friends.map((friend) => friend.id === id ? { ...friend, online } : friend),
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
        } : null,
        friends: state.friends,
        friendRequests: state.friendRequests,
      }),
    }
  )
)
