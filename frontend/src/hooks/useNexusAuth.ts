
import { useState, useEffect } from 'react';
import { useNexusStore } from '@/stores/useNexusStore';
import { AuthService } from '@/services/api/auth.service';
import { Language } from '../../../shared/types/models';

export const useNexusAuth = () => {
  const { user, setUser } = useNexusStore();
  const [loading, setLoading] = useState(!user);

  const initializeIdentity = async () => {
    if (user) return;
    
    try {
      const anonId = `NX-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const response = await AuthService.loginAnonymous(anonId);
      
      setUser({
        id: response.session_id,
        anonymousId: anonId,
        nativeLanguage: 'pt',
        reputation: 100,
        isBanned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Identity Synthesis Failed", error);
    } finally {
      setLoading(false);
    }
  };

  return { user, loading, initializeIdentity };
};
