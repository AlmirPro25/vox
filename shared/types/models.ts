
/**
 * VOX-BRIDGE: Shared Domain Models
 * Aligned with Prisma Schema
 */

export type Language = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'ja' | 'zh';

export interface User {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  anonymousId: string;
  lastIp?: string;
  nativeLanguage: Language;
  targetLanguage?: Language;
  reputation: number;
  isBanned: boolean;
}

export interface Session {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  roomId: string;
  translationCount: number;
  avgLatency: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  originalText: string;
  translatedText: string;
  timestamp: Date;
  isAiOptimized: boolean;
}

export type ConnectionStatus = 'idle' | 'searching' | 'connecting' | 'connected' | 'error';
