
import { useEffect, useRef } from 'react';
import { useNexusStore } from '@/stores/useNexusStore';
import { MatchService } from '@/services/api/match.service';

export const useMatchmaking = () => {
  const { user, status, setStatus, setMatch, resetSession } = useNexusStore();
  const pollInterval = useRef<NodeJS.Timeout | null>(null);

  const startSearching = async () => {
    if (!user) return;
    
    try {
      setStatus('searching');
      await MatchService.joinQueue({
        native_language: user.nativeLanguage,
        target_language: user.targetLanguage || 'en'
      });
      
      // Começa o polling (No Nexus v3 usaremos WebSockets para isso)
      pollInterval.current = setInterval(async () => {
        const result = await MatchService.pollStatus();
        
        if (result.status === 'matched' && result.room_id && result.livekit_token) {
          if (pollInterval.current) clearInterval(pollInterval.current);
          setMatch(
            result.room_id, 
            result.partner_id!, 
            result.partner_language!, 
            result.livekit_token
          );
        }
      }, 2000);

    } catch (error) {
      setStatus('error');
      console.error("Matchmaking Interrupted", error);
    }
  };

  const cancelSearch = () => {
    if (pollInterval.current) clearInterval(pollInterval.current);
    resetSession();
  };

  useEffect(() => {
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  return { startSearching, cancelSearch, status };
};
