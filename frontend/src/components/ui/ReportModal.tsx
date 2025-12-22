import React, { useState } from 'react'

const REPORT_REASONS = [
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'hate', label: 'Hate speech' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'other', label: 'Other' },
]

interface Props {
  partnerName: string
  onReport: (reason: string, details: string) => void
  onClose: () => void
}

export function ReportModal({ partnerName, onReport, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    if (!reason) return
    onReport(reason, details)
    setSubmitted(true)
    setTimeout(onClose, 2000)
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative glass rounded-2xl p-6 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold theme-text mb-2">Report Submitted</h3>
          <p className="text-sm theme-text-muted">Thank you for helping keep VOX-BRIDGE safe.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold theme-text">Report User</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5 theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm theme-text-muted mb-4">
          Report <span className="text-red-400 font-medium">{partnerName}</span> for violating community guidelines.
        </p>

        <div className="space-y-2 mb-4">
          {REPORT_REASONS.map(r => (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${
                reason === r.id 
                  ? 'bg-red-500/20 border-red-500/50 text-red-400' 
                  : 'theme-text hover:bg-white/5'
              }`}
              style={{ border: '1px solid var(--border-secondary)' }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Additional details (optional)"
          className="input-dark w-full h-20 resize-none text-sm mb-4"
        />

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">
            Cancel
          </button>
          <button 
            onClick={handleSubmit}
            disabled={!reason}
            className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Submit Report
          </button>
        </div>
      </div>
    </div>
  )
}
