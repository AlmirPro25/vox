
import api from '@/lib/axios';
import { MatchJoinRequest, MatchStatusResponse } from '../../../../shared/types/api';

export const MatchService = {
  async joinQueue(req: MatchJoinRequest): Promise<void> {
    await api.post('/v1/match/join', req);
  },

  async pollStatus(): Promise<MatchStatusResponse> {
    const { data } = await api.get<MatchStatusResponse>('/v1/match/status');
    return data;
  }
};
