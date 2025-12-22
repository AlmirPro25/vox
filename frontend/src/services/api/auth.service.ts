
import api from '@/lib/axios';
import { AuthRequest, AuthResponse } from '../../../../shared/types/api';

export const AuthService = {
  async loginAnonymous(anonymousId: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/v1/auth/anonymous', {
      anonymous_id: anonymousId
    } as AuthRequest);
    
    localStorage.setItem('nexus_auth_token', data.token);
    return data;
  }
};
