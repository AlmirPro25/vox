import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Gender = 'male' | 'female' | 'other'
export type Preference = 'male' | 'female' | 'any'
export type CallMode = 'random' | 'duo' | 'group'

interface UserProfile {
  name: string
  age: number
  gender: Gender
  preference: Preference
  callMode: CallMode
  // PROST-QS Identity
  prostqsUserId?: string
  prostqsToken?: string
}

interface UserState {
  profile: UserProfile | null
  isOnboarded: boolean
  setProfile: (profile: UserProfile) => void
  updateCallMode: (mode: CallMode) => void
  setProstQSIdentity: (userId: string, token: string | null) => void
  clearProfile: () => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      profile: null,
      isOnboarded: false,
      
      setProfile: (profile) => set({ 
        profile, 
        isOnboarded: true 
      }),
      
      updateCallMode: (mode) => set((state) => ({
        profile: state.profile ? { ...state.profile, callMode: mode } : null
      })),

      setProstQSIdentity: (userId, token) => set((state) => ({
        profile: state.profile ? { 
          ...state.profile, 
          prostqsUserId: userId,
          prostqsToken: token || undefined
        } : null
      })),
      
      clearProfile: () => set({ 
        profile: null, 
        isOnboarded: false 
      }),
    }),
    {
      name: 'vox-user-profile',
    }
  )
)
