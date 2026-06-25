const PRODUCTION_API_URL = 'https://vox-bridge-api.onrender.com'
const PRODUCTION_WS_URL = 'wss://vox-bridge-api.onrender.com'

export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || PRODUCTION_API_URL
}

export function getWebSocketUrl(): string {
  return process.env.NEXT_PUBLIC_WS_URL || PRODUCTION_WS_URL
}
