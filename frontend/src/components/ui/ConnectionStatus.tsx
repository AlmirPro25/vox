import { useNexusStore } from '@/store/useNexusStore'

export function ConnectionStatus() {
  const { wsStatus, onlineCount } = useNexusStore()
  
  const statusConfig = {
    disconnected: { color: 'bg-red-500', text: 'Desconectado', pulse: false },
    connecting: { color: 'bg-yellow-500', text: 'Conectando...', pulse: true },
    connected: { color: 'bg-green-500', text: 'Online', pulse: false },
    reconnecting: { color: 'bg-orange-500', text: 'Reconectando...', pulse: true }
  }
  
  const config = statusConfig[wsStatus]
  
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-sm">
      <span className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className="text-xs font-medium theme-text-secondary">{config.text}</span>
      {wsStatus === 'connected' && onlineCount > 0 && (
        <span className="text-xs theme-text-secondary">• {onlineCount} online</span>
      )}
    </div>
  )
}
