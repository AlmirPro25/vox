
import { useEffect, useState } from 'react';
import { useNexusStore } from '@/stores/useNexusStore';
import { Room, RoomEvent, VideoPresets } from 'livekit-client';

/**
 * useNeuralStream: A ponte entre o hardware do usuário e o Gemini Live API via LiveKit SFU.
 */
export const useNeuralStream = () => {
  const { livekitToken, roomID, setStatus, addMessage } = useNexusStore();
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    if (!livekitToken || !roomID) return;

    const nexusRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
    });

    const connectToNexus = async () => {
      try {
        const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
        await nexusRoom.connect(wsUrl, livekitToken);
        setRoom(nexusRoom);
        
        // Listeners para tradução e eventos de mídia
        nexusRoom.on(RoomEvent.DataReceived, (payload, participant) => {
          const decoder = new TextDecoder();
          const data = JSON.parse(decoder.decode(payload));
          
          if (data.type === 'TRANSLATION_PACKET') {
            addMessage({
              id: Math.random().toString(),
              senderId: participant?.identity || 'unknown',
              originalText: data.original,
              translatedText: data.translated,
              timestamp: new Date(),
              isAiOptimized: true
            });
          }
        });

        nexusRoom.on(RoomEvent.Disconnected, () => {
          setStatus('idle');
        });

      } catch (error) {
        console.error("Neural Stream Connection Failed", error);
        setStatus('error');
      }
    };

    connectToNexus();

    return () => {
      nexusRoom.disconnect();
    };
  }, [livekitToken, roomID]);

  return { room };
};
