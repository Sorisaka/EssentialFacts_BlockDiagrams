import React from 'react'

export const MARKS = [
  { key: 'none', label: '－' },
  { key: 'circle', label: '〇' },
  { key: 'triangle', label: '△' },
  { key: 'square', label: '□' },
  { key: 'cross', label: '×' },
  { key: 'check', label: '✓' },
  { key: 'ken', label: '顕' },
]

export function MarkSelector({ value, onChange, compact = false }) {
  return (
    <label className={`mark-dropdown ${compact ? 'compact' : ''}`}>
      <span className="sr-only">マーカー</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {MARKS.map((mark) => (
          <option key={mark.key} value={mark.key}>
            {mark.label}
          </option>
        ))}
      </select>
    </label>
  )
}
