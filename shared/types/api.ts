
import { Language } from './models';

export interface AuthResponse {
  session_id: string;
  token: string;
}

export interface AuthRequest {
  anonymous_id: string;
}

export interface MatchJoinRequest {
  native_language: Language;
  target_language: Language;
}

export interface MatchStatusResponse {
  status: 'searching' | 'matched';
  room_id?: string;
  partner_id?: string;
  partner_language?: Language;
  livekit_token?: string;
}

export interface ApiError {
  error: string;
  code: string;
}
