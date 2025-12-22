
# 🌌 VOX-BRIDGE Nexus Core

VOX-BRIDGE é uma plataforma de comunicação em tempo real ultrarrápida com tradução neural nativa alimentada por **Google Gemini AI**. O sistema conecta pessoas ao redor do mundo, quebrando barreiras linguísticas instantaneamente através de uma "Ponte Neural" de alta fidelidade.

## 💎 Características Premium

- **Neural Bridge (v2)**: Tradução bidirecional de chat em tempo real alimentada pelo Gemini 1.5 Flash.
- **Matchmaking Inteligente**: Algoritmo de busca baseado em interesses comuns e afinidade linguística usando Redis.
- **Arquitetura Nexus**: Core em Go com transações atômicas e persistência distribuída.
- **Visualização Imersiva**: Experiência de busca com animações neurais e feedback tátil visual.
- **Responsividade Extrema**: Layout 50/50 otimizado para mobile e PiP (Picture-in-Picture) dinâmico.

## 🛠️ Stack Tecnológica

| Camada | Tecnologia |
| :--- | :--- |
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS, Framer Motion |
| **Backend** | Go (Gin), WebSockets (Gorilla), gORM |
| **Inteligência** | Google Gemini AI (Neural Translation Bridge) |
| **Streaming** | WebRTC (Peer-to-Peer), LiveKit (Bridge Mode) |
| **Dados** | PostgreSQL (Relacional), Redis (Cache & Queue) |
| **Infra** | Docker & Docker Compose |

## 🚀 Como Iniciar

### Pré-requisitos
- Docker & Docker Compose
- API Key do Google Gemini (obtenha em [ai.google.dev](https://ai.google.dev))

### Setup Rápido
1. Clone o repositório.
2. Configure as variáveis de ambiente no arquivo `.env`:
   ```env
   GEMINI_API_KEY=sua_chave_aqui
   JWT_SECRET=sua_chave_secreta_32_chars
   ```
3. Inicie o sistema completo:
   ```bash
   docker-compose up --build
   ```
4. Acesse `http://localhost:3000`.

## 🏛️ Identidade Visual
A estética do VOX-BRIDGE segue os princípios de **Global Nexus**: minimalismo escuro, acentos neon em Cyan e Emerald, e tipografia técnica monospaçada para dados em tempo real.

---
*Powered by Google Gemini AI • Forged for Global Connection*
