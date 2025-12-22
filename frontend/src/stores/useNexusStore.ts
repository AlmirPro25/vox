
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, ConnectionStatus, ChatMessage, Language } from '../../../shared/types/models';

interface NexusState {
  user: User | null;
  status: ConnectionStatus;
  messages: ChatMessage[];
  roomID: string | null;
  livekitToken: string | null;
  partnerInfo: { id: string, language: Language } | null;
  
  // Actions
  setUser: (user: User) => void;
  setStatus: (status: ConnectionStatus) => void;
  setMatch: (roomID: string, partnerId: string, partnerLang: Language, token: string) => void;
  addMessage: (msg: ChatMessage) => void;
  resetSession: () => void;
}

export const useNexusStore = create<NexusState>()(
  persist(
    (set) => ({
      user: null,
      status: 'idle',
      messages: [],
      roomID: null,
      livekitToken: null,
      partnerInfo: null,

      setUser: (user) => set({ user }),
      setStatus: (status) => set({ status }),
      
      setMatch: (roomID, partnerId, partnerLang, token) => set({ 
        roomID, 
        livekitToken: token,
        partnerInfo: { id: partnerId, language: partnerLang }, 
        status: 'connected' 
      }),

      addMessage: (msg) => set((state) => ({ 
        messages: [...state.messages.slice(-50), msg] // Keep only last 50 for performance
      })),

      resetSession: () => set({ 
        status: 'idle', 
        roomID: null, 
        partnerInfo: null, 
        messages: [],
        livekitToken: null
      }),
    }),
    {
      name: 'nexus-storage',
      partialize: (state) => ({ user: state.user }), // Persist only identity
    }
  )
);
