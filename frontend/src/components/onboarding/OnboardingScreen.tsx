'use client'

import { useState } from 'react'
import { ArrowRight, Check, Globe2, ShieldCheck, Sparkles, Users, Video } from 'lucide-react'
import { useUserStore, Gender, Preference, CallMode } from '@/store/useUserStore'
import { getApiUrl } from '@/lib/runtimeUrls'

export function OnboardingScreen() {
  const { setProfile, setProstQSIdentity } = useUserStore()
  const [step, setStep] = useState<'signup' | 'profile'>('signup')
  const [name, setName] = useState('')
  const [isAdult, setIsAdult] = useState(false)
  const [gender, setGender] = useState<Gender>('other')
  const [preference, setPreference] = useState<Preference>('any')
  const [callMode, setCallMode] = useState<CallMode>('random')
  const [isLoading, setIsLoading] = useState(false)

  const cleanName = name.trim()
  const canStart = cleanName.length >= 2 && isAdult && !isLoading

  const finishSignup = async () => {
    if (!canStart) return

    setIsLoading(true)

    try {
      const response = await fetch(`${getApiUrl()}/auth/implicit-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          age: 18,
          gender,
          preference,
          callMode,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setProstQSIdentity(data.user_id, data.token)
      }
    } catch (error) {
      console.warn('Implicit login failed, continuing locally:', error)
    }

    setProfile({
      name: cleanName,
      age: 18,
      gender,
      preference,
      callMode,
    })

    setIsLoading(false)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#07090c] text-white">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-y-0 left-0 w-[55%] bg-[radial-gradient(circle_at_30%_30%,rgba(6,182,212,0.22),transparent_38%),radial-gradient(circle_at_70%_70%,rgba(244,63,94,0.15),transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,9,12,0.2),#07090c_62%)]" />
      </div>

      <section className="relative grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <div className="hidden min-h-screen flex-col justify-between border-r border-white/10 p-10 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500">
              <Globe2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black tracking-wide">VOX-BRIDGE</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">Global live calls</p>
            </div>
          </div>

          <div className="max-w-2xl">
            <div className="mb-6 flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-cyan-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Pessoas reais, chamadas ao vivo, conexoes instantaneas
            </div>
            <h1 className="text-6xl font-black leading-[0.95] tracking-tight">
              Converse com o mundo em tempo real.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/62">
              Entre, descubra pessoas online, mande mensagem, envie audio e pule para a proxima chamada quando quiser.
            </p>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
              <Feature icon={<Video className="h-5 w-5" />} label="Video live" />
              <Feature icon={<Users className="h-5 w-5" />} label="Amigos" />
              <Feature icon={<Sparkles className="h-5 w-5" />} label="Match rapido" />
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-white/45">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Plataforma para maiores de 18 anos.
          </div>
        </div>

        <div className="flex min-h-screen items-center justify-center px-5 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500">
                  <Globe2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black tracking-wide">VOX-BRIDGE</p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/40">Global live calls</p>
                </div>
              </div>
              <h1 className="text-4xl font-black leading-tight">Converse com o mundo em tempo real.</h1>
            </div>

            {step === 'signup' ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Criar acesso</p>
                <h2 className="mt-2 text-2xl font-black">Entre com seu nome</h2>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  O resto voce ajusta depois. Primeiro entre, veja quem esta online e comece uma conversa.
                </p>

                <label className="mt-6 block">
                  <span className="mb-2 block text-sm font-semibold text-white/75">Nome ou apelido</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Como voce quer aparecer?"
                    maxLength={24}
                    className="h-13 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-4 text-base font-semibold text-white outline-none transition placeholder:text-white/28 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10"
                  />
                </label>

                <button
                  onClick={() => setIsAdult((value) => !value)}
                  className={`mt-4 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                    isAdult ? 'border-emerald-400/45 bg-emerald-400/10' : 'border-white/10 bg-black/25'
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${isAdult ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-white/25'}`}>
                    {isAdult && <Check className="h-4 w-4" />}
                  </span>
                  <span className="text-sm font-medium text-white/75">Tenho 18 anos ou mais e aceito entrar na comunidade.</span>
                </button>

                <button
                  onClick={() => setStep('profile')}
                  disabled={!canStart}
                  className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-4 text-sm font-black text-white transition hover:bg-cyan-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
                >
                  Continuar
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  onClick={finishSignup}
                  disabled={!canStart}
                  className="mt-3 h-11 w-full rounded-xl text-sm font-bold text-white/58 transition hover:text-white disabled:cursor-not-allowed disabled:text-white/25"
                >
                  Entrar agora e configurar depois
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Preferencias</p>
                <h2 className="mt-2 text-2xl font-black">Personalize seu match</h2>
                <p className="mt-2 text-sm leading-6 text-white/55">Isso melhora as sugestoes, mas voce pode mudar depois.</p>

                <ChoiceGroup
                  title="Voce e"
                  value={gender}
                  options={[
                    { value: 'male', label: 'Homem' },
                    { value: 'female', label: 'Mulher' },
                    { value: 'other', label: 'Outro' },
                  ]}
                  onChange={(value) => setGender(value as Gender)}
                />

                <ChoiceGroup
                  title="Quer conversar com"
                  value={preference}
                  options={[
                    { value: 'male', label: 'Homens' },
                    { value: 'female', label: 'Mulheres' },
                    { value: 'any', label: 'Todos' },
                  ]}
                  onChange={(value) => setPreference(value as Preference)}
                />

                <ChoiceGroup
                  title="Modo"
                  value={callMode}
                  options={[
                    { value: 'random', label: 'Aleatorio' },
                    { value: 'duo', label: 'Duo' },
                    { value: 'group', label: 'Grupo' },
                  ]}
                  onChange={(value) => setCallMode(value as CallMode)}
                />

                <button
                  onClick={finishSignup}
                  disabled={isLoading}
                  className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-4 text-sm font-black text-white transition hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50"
                >
                  {isLoading ? 'Entrando...' : 'Entrar no VOX'}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 text-cyan-300">{icon}</div>
      <p className="text-sm font-bold text-white/75">{label}</p>
    </div>
  )
}

function ChoiceGroup({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-sm font-semibold text-white/72">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`h-11 rounded-lg border px-2 text-sm font-bold transition ${
              value === option.value
                ? 'border-cyan-400 bg-cyan-400 text-black'
                : 'border-white/10 bg-black/25 text-white/58 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
