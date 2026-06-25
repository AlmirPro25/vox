
import axios from 'axios';
import { getApiUrl } from './runtimeUrls';

const api = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 5000, // Latency is death. Time out fast.
});

// Nexus Interceptor: Gerenciamento de Identidade Efêmera
api.interceptors.request.use((config) => {
  config.baseURL = getApiUrl();
  const token = localStorage.getItem('nexus_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Tratamento global de erros - The Guardian System
    const message = error.response?.data?.error || 'Nexus Connection Interrupted';
    console.error(`[NEXUS-ERROR] ${message}`);
    return Promise.reject(error);
  }
);

export default api;
