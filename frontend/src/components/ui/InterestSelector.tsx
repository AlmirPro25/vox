import React from 'react'

const INTERESTS = [
  { id: 'travel', emoji: '✈️', label: 'Travel' },
  { id: 'music', emoji: '🎵', label: 'Music' },
  { id: 'movies', emoji: '🎬', label: 'Movies' },
  { id: 'gaming', emoji: '🎮', label: 'Gaming' },
  { id: 'sports', emoji: '⚽', label: 'Sports' },
  { id: 'food', emoji: '🍕', label: 'Food' },
  { id: 'tech', emoji: '💻', label: 'Tech' },
  { id: 'art', emoji: '🎨', label: 'Art' },
  { id: 'books', emoji: '📚', label: 'Books' },
  { id: 'fitness', emoji: '💪', label: 'Fitness' },
  { id: 'nature', emoji: '🌿', label: 'Nature' },
  { id: 'business', emoji: '💼', label: 'Business' },
]

interface Props {
  selected: string[]
  onChange: (interests: string[]) => void
  maxSelect?: number
}

export function InterestSelector({ selected, onChange, maxSelect = 5 }: Props) {
  const toggleInterest = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(i => i !== id))
    } else if (selected.length < maxSelect) {
      onChange([...selected, id])
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="label">Your Interests</p>
        <span className="text-[10px] theme-text-muted">{selected.length}/{maxSelect}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {INTERESTS.map(interest => {
          const isSelected = selected.includes(interest.id)
          return (
            <button
              key={interest.id}
              onClick={() => toggleInterest(interest.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isSelected 
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' 
                  : 'border-transparent theme-text-secondary hover:bg-white/5'
              }`}
              style={{ border: '1px solid var(--border-secondary)' }}
            >
              <span className="mr-1">{interest.emoji}</span>
              {interest.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { INTERESTS }
