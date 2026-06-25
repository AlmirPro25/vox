import React, { useMemo, useState } from 'react'
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Search,
  UserMinus,
  Users,
  Video,
  X,
} from 'lucide-react'
import { useNexusStore } from '@/store/useNexusStore'
import { useTheme } from '@/hooks/useTheme'

interface SocialDeckProps {
  onStartMatch?: () => void
  onOpenChat?: () => void
  onRefresh?: () => void
  onAddFriend?: (id: string) => void
  onRemoveFriend?: (id: string) => void
}

interface DiscoveryProfile {
  id: string
  anonymousId?: string
  handle?: string
  displayName: string
  nativeLanguage?: string
  country?: string
  interests?: string[]
  online?: boolean
  inCall?: boolean
}

export function SocialDeck({ onStartMatch, onOpenChat, onRefresh, onAddFriend, onRemoveFriend }: SocialDeckProps) {
  const { theme } = useTheme()
  const { status, partnerInfo, friends, discovery, onlineCount } = useNexusStore()
  const [view, setView] = useState<'discover' | 'friends'>('discover')
  const [activeIndex, setActiveIndex] = useState(0)
  const isDark = theme === 'dark'

  const suggestions = useMemo(() => {
    const friendIds = new Set(friends.map((friend) => friend.id))
    return discovery.filter((profile) => !friendIds.has(profile.id)) as DiscoveryProfile[]
  }, [discovery, friends])

  const activeProfile = suggestions[activeIndex % Math.max(suggestions.length, 1)]
  const surface = isDark ? 'bg-[#111214] border-white/[0.08]' : 'bg-white border-black/[0.08]'
  const text = isDark ? 'text-white' : 'text-[#111214]'
  const muted = isDark ? 'text-white/55' : 'text-black/50'

  const showNext = () => {
    if (suggestions.length > 1) setActiveIndex((index) => (index + 1) % suggestions.length)
  }

  const addActiveProfile = () => {
    if (!activeProfile) return
    onAddFriend?.(activeProfile.id)
  }

  return (
    <aside
      className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden"
      style={{ background: isDark ? '#090a0b' : '#f4f5f6' }}
    >
      <div className="mx-auto w-full max-w-xl md:max-w-7xl">
        <header className={`sticky top-0 z-20 border-b px-4 pb-3 pt-4 backdrop-blur-xl md:px-8 md:pb-5 md:pt-7 ${isDark ? 'border-white/[0.07] bg-[#090a0b]/90' : 'border-black/[0.07] bg-[#f4f5f6]/90'}`}>
          <div className="flex items-center justify-between gap-3 md:pr-12">
            <div>
              <h2 className={`text-lg font-bold md:text-3xl ${text}`}>Comunidade ao vivo</h2>
              <p className={`text-xs md:mt-1 md:text-sm ${muted}`}>
                {onlineCount > 0 ? `${onlineCount} pessoa${onlineCount === 1 ? '' : 's'} online agora` : 'Nenhuma pessoa online agora'}
              </p>
            </div>
            <button onClick={onRefresh} className={`flex h-9 w-9 items-center justify-center rounded-full border ${surface}`} title="Atualizar pessoas">
              <Search className="h-4 w-4" />
            </button>
          </div>

          <div className={`mt-4 grid grid-cols-2 rounded-lg p-1 md:max-w-sm ${isDark ? 'bg-white/[0.06]' : 'bg-black/[0.05]'}`}>
            <TabButton active={view === 'discover'} onClick={() => setView('discover')}>Descobrir</TabButton>
            <TabButton active={view === 'friends'} onClick={() => setView('friends')}>
              Amigos {friends.length > 0 && `(${friends.length})`}
            </TabButton>
          </div>
        </header>

        {view === 'discover' ? (
          <div className="space-y-5 px-4 py-4 md:grid md:grid-cols-[360px_1fr] md:items-start md:gap-6 md:space-y-0 md:px-8 md:py-6">
            <div className="space-y-5">
            <section className={`md:rounded-2xl md:border md:p-4 ${surface}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className={`text-sm font-semibold ${text}`}>Ao vivo</h3>
                <span className={`text-xs ${muted}`}>toque para conhecer</span>
              </div>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:px-0 md:pb-0">
                {suggestions.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => {
                      const nextIndex = suggestions.findIndex((item) => item.id === profile.id)
                      if (nextIndex >= 0) setActiveIndex(nextIndex)
                    }}
                    className="w-[66px] shrink-0 text-center md:flex md:w-full md:items-center md:gap-3 md:rounded-xl md:p-2 md:text-left md:hover:bg-white/[0.06]"
                  >
                    <span className="relative mx-auto flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full border-2 border-cyan-500 bg-cyan-500/15 text-base font-black text-cyan-400 md:mx-0">
                      {profile.displayName.slice(0, 2).toUpperCase()}
                      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#090a0b] bg-emerald-500" />
                    </span>
                    <span className="min-w-0">
                      <span className={`mt-1.5 block truncate text-[11px] font-medium md:mt-0 md:text-sm md:font-bold ${text}`}>{profile.displayName}</span>
                      <span className={`hidden truncate text-xs md:block ${muted}`}>{profile.country || 'Global'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {status === 'connected' && partnerInfo && (
              <section className={`flex items-center gap-3 border-y py-3 md:rounded-2xl md:border md:p-4 ${isDark ? 'border-white/[0.07]' : 'border-black/[0.07]'}`}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-sm font-bold text-white">
                  {partnerInfo.anonymousId.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${text}`}>{partnerInfo.anonymousId}</p>
                  <p className={`text-xs ${muted}`}>Em chamada com voce</p>
                </div>
                <button
                  onClick={() => {
                    if (partnerInfo.id) onAddFriend?.(partnerInfo.id)
                  }}
                  disabled={!partnerInfo.id}
                  className="h-9 rounded-lg bg-cyan-500 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Adicionar
                </button>
              </section>
            )}
            <section className={`hidden rounded-2xl border p-4 md:block ${surface}`}>
              <h3 className={`text-sm font-bold ${text}`}>Como funciona</h3>
              <div className="mt-4 space-y-3">
                <DesktopStep number="1" title="Descubra" body="Veja quem esta online e escolha alguem pelo estilo de conversa." muted={muted} text={text} />
                <DesktopStep number="2" title="Conecte" body="Adicione como amigo ou va direto para uma chamada ao vivo." muted={muted} text={text} />
                <DesktopStep number="3" title="Continue" body="Volte para o chat, envie audio e mantenha contato depois." muted={muted} text={text} />
              </div>
            </section>
            </div>

            {activeProfile ? (
              <section className="min-w-0">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className={`text-sm font-semibold md:text-xl ${text}`}>Para voce</h3>
                    <p className={`text-xs md:text-sm ${muted}`}>Pessoas com interesses em comum</p>
                  </div>
                  <button className={`flex h-8 w-8 items-center justify-center rounded-full ${isDark ? 'text-white/60 hover:bg-white/10' : 'text-black/50 hover:bg-black/5'}`} title="Mais opcoes">
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                </div>

                <article className={`overflow-hidden rounded-lg border md:grid md:grid-cols-[minmax(360px,0.72fr)_minmax(300px,0.55fr)] md:rounded-2xl ${surface}`}>
                  <div className="relative flex aspect-[4/5] max-h-[500px] items-center justify-center overflow-hidden bg-[#111820] md:aspect-auto md:max-h-none md:min-h-[520px]">
                    <div className="flex h-36 w-36 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 text-5xl font-black text-cyan-300 md:h-48 md:w-48 md:text-7xl">
                      {activeProfile.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent px-4 pb-4 pt-20 text-white md:px-6 md:pb-6">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase">Online</span>
                        {activeProfile.inCall && <span className="text-xs text-white/80">Em chamada agora</span>}
                      </div>
                      <h4 className="text-2xl font-bold md:text-4xl">{activeProfile.displayName}</h4>
                      <p className="text-sm text-white/80 md:mt-1 md:text-base">
                        {activeProfile.country || 'Global'} {activeProfile.nativeLanguage ? `- fala ${activeProfile.nativeLanguage.toUpperCase()}` : ''}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(activeProfile.interests || []).map((interest) => (
                          <span key={interest} className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">
                            {interest}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[48px_1fr_48px] items-center gap-3 p-3 md:flex md:flex-col md:items-stretch md:justify-between md:p-6">
                    <div className="hidden md:block">
                      <p className={`text-xs font-bold uppercase tracking-[0.2em] ${muted}`}>Chamada em tempo real</p>
                      <h5 className={`mt-3 text-2xl font-black ${text}`}>Entre em uma conversa sem transformar isso em burocracia.</h5>
                      <p className={`mt-3 text-sm leading-6 ${muted}`}>Use o social para encontrar alguem interessante, abrir chat, salvar amizade ou iniciar uma chamada na hora.</p>
                    </div>
                    <div className="contents md:grid md:grid-cols-[56px_1fr_56px] md:gap-3">
                    <button
                      onClick={showNext}
                      className={`flex h-12 w-12 items-center justify-center rounded-full border md:h-14 md:w-14 ${surface}`}
                      title="Pular perfil"
                    >
                      <X className="h-5 w-5" />
                    </button>
                    <button
                      onClick={addActiveProfile}
                      className="flex h-12 items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 text-sm font-bold text-white transition active:scale-[0.98] md:h-14"
                    >
                      <Heart className="h-5 w-5" />
                      Conectar
                    </button>
                    <button
                      onClick={onStartMatch}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500 text-white md:h-14 md:w-14"
                      title="Iniciar chamada"
                    >
                      <Video className="h-5 w-5" />
                    </button>
                    </div>
                  </div>
                </article>
              </section>
            ) : (
              <EmptyDiscover onShowFriends={() => setView('friends')} text={text} muted={muted} />
            )}
          </div>
        ) : (
          <FriendsList
            friends={friends}
            isDark={isDark}
            text={text}
            muted={muted}
            surface={surface}
            onOpenChat={onOpenChat}
            onStartMatch={onStartMatch}
            onRemove={(id) => onRemoveFriend?.(id)}
            onDiscover={() => setView('discover')}
          />
        )}
      </div>
    </aside>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 rounded-md text-xs font-semibold transition ${active ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}
    >
      {children}
    </button>
  )
}

function FriendsList({
  friends,
  isDark,
  text,
  muted,
  surface,
  onOpenChat,
  onStartMatch,
  onRemove,
  onDiscover,
}: {
  friends: ReturnType<typeof useNexusStore.getState>['friends']
  isDark: boolean
  text: string
  muted: string
  surface: string
  onOpenChat?: () => void
  onStartMatch?: () => void
  onRemove: (id: string) => void
  onDiscover: () => void
}) {
  if (friends.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-8 text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full border ${surface}`}>
          <Users className={`h-7 w-7 ${muted}`} />
        </div>
        <h3 className={`mt-4 text-base font-bold ${text}`}>Sua lista ainda esta vazia</h3>
        <p className={`mt-2 text-sm leading-6 ${muted}`}>Conecte-se com pessoas para continuar conversando depois da chamada.</p>
        <button onClick={onDiscover} className="mt-5 h-10 rounded-lg bg-cyan-500 px-5 text-sm font-bold text-white">
          Descobrir pessoas
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4">
        <h3 className={`text-sm font-semibold ${text}`}>Seus amigos</h3>
        <p className={`text-xs ${muted}`}>Continue de onde voces pararam</p>
      </div>
      <div className="space-y-2">
        {friends.map((friend) => {
          const name = friend.displayName || friend.anonymousId || friend.handle || 'Pessoa'
          return (
            <div key={friend.id} className={`flex items-center gap-3 rounded-lg border p-3 ${surface}`}>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-sm font-bold text-cyan-400">
                {name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm font-semibold ${text}`}>{name}</p>
                  {friend.online && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                </div>
                <p className={`truncate text-xs ${muted}`}>
                  {friend.online ? 'Online' : 'Offline'} - {friend.country || 'Global'} - {friend.nativeLanguage?.toUpperCase() || 'Idioma não informado'}
                </p>
              </div>
              <button onClick={onOpenChat} className={`flex h-9 w-9 items-center justify-center rounded-full ${isDark ? 'bg-white/[0.07]' : 'bg-black/[0.05]'}`} title="Mensagem">
                <MessageCircle className="h-4 w-4" />
              </button>
              <button onClick={onStartMatch} className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500 text-white" title="Chamada">
                <Phone className="h-4 w-4" />
              </button>
              <button onClick={() => onRemove(friend.id)} className={`flex h-9 w-9 items-center justify-center rounded-full ${muted}`} title="Remover amigo">
                <UserMinus className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyDiscover({ onShowFriends, text, muted }: { onShowFriends: () => void; text: string; muted: string }) {
  return (
    <div className="py-14 text-center">
      <Heart className="mx-auto h-8 w-8 text-rose-500" />
      <h3 className={`mt-3 text-base font-bold ${text}`}>Voce viu todo mundo por agora</h3>
      <p className={`mt-2 text-sm ${muted}`}>As pessoas adicionadas ja estao na sua lista.</p>
      <button onClick={onShowFriends} className="mt-4 text-sm font-bold text-cyan-500">Ver amigos</button>
    </div>
  )
}

function DesktopStep({ number, title, body, text, muted }: { number: string; title: string; body: string; text: string; muted: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-xs font-black text-cyan-300">
        {number}
      </span>
      <div>
        <p className={`text-sm font-bold ${text}`}>{title}</p>
        <p className={`text-xs leading-5 ${muted}`}>{body}</p>
      </div>
    </div>
  )
}
