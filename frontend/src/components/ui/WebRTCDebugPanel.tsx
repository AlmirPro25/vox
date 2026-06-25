import React, { useState } from 'react'

export type ConnectionType = 'host' | 'srflx' | 'relay' | 'unknown'

interface ConnectionInfo {
  type: ConnectionType
  local: string
  remote: string
  protocol: string
}

interface WebRTCDebugPanelProps {
  connectionInfo: ConnectionInfo | null
  isVisible?: boolean
}

export function WebRTCDebugPanel({ connectionInfo, isVisible = true }: WebRTCDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  if (!isVisible || !connectionInfo) return null

  const getConnectionLabel = (type: ConnectionType) => {
    switch (type) {
      case 'host':
        return {
          emoji: '🏠',
          label: 'Direct P2P',
          description: 'Conexão direta (ideal)',
          color: 'from-green-500 to-emerald-600',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30'
        }
      case 'srflx':
        return {
          emoji: '🌐',
          label: 'STUN P2P',
          description: 'P2P via STUN (bom)',
          color: 'from-blue-500 to-cyan-600',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/30'
        }
      case 'relay':
        return {
          emoji: '🔄',
          label: 'TURN Relay',
          description: 'Via servidor TURN',
          color: 'from-orange-500 to-amber-600',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30'
        }
      default:
        return {
          emoji: '❓',
          label: 'Unknown',
          description: 'Analisando...',
          color: 'from-gray-500 to-gray-600',
          bgColor: 'bg-gray-500/10',
          borderColor: 'border-gray-500/30'
        }
    }
  }

  const config = getConnectionLabel(connectionInfo.type)

  return (
    <>
      {/* Botão de Info Flutuante */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full ${config.bgColor} ${config.borderColor} border-2 backdrop-blur-md shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
        title="Informações de Conexão WebRTC"
      >
        <span className="text-xl">{config.emoji}</span>
      </button>

      {/* Painel de Debug (apenas quando aberto) */}
      {isOpen && (
        <>
          {/* Overlay para fechar ao clicar fora */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Painel */}
          <div className="fixed bottom-36 right-4 z-50 w-80 animate-in slide-in-from-bottom-4 duration-200">
            <div className={`${config.bgColor} ${config.borderColor} border-2 backdrop-blur-md rounded-xl p-4 shadow-2xl`}>
              {/* Header com botão fechar */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{config.emoji}</span>
                  <div>
                    <h3 className={`text-sm font-bold bg-gradient-to-r ${config.color} bg-clip-text text-transparent`}>
                      {config.label}
                    </h3>
                    <p className="text-[10px] text-gray-400">{config.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Details */}
              <div className="space-y-1.5 text-[11px] text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">Local:</span>
                  <span className="font-mono">{connectionInfo.local}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Remote:</span>
                  <span className="font-mono">{connectionInfo.remote}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Protocol:</span>
                  <span className="font-mono uppercase">{connectionInfo.protocol}</span>
                </div>
              </div>

              {/* Info adicional */}
              {connectionInfo.type === 'relay' && (
                <div className="mt-3 pt-3 border-t border-orange-500/20">
                  <p className="text-[10px] text-orange-300/80 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Usando TURN (pode ter custos)
                  </p>
                </div>
              )}

              {connectionInfo.type === 'host' && (
                <div className="mt-3 pt-3 border-t border-green-500/20">
                  <p className="text-[10px] text-green-300/80 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Conexão otimizada (sem custos)
                  </p>
                </div>
              )}

              {connectionInfo.type === 'srflx' && (
                <div className="mt-3 pt-3 border-t border-blue-500/20">
                  <p className="text-[10px] text-blue-300/80 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    P2P via STUN (ótima performance)
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
