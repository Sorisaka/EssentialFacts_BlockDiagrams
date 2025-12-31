import React from 'react'

const MARKS = [
  { key: 'none', label: '－' },
  { key: 'circle', label: '〇' },
  { key: 'triangle', label: '△' },
  { key: 'cross', label: '×' },
  { key: 'ken', label: '顕' },
]

export function MarkSelector({ value, onChange }) {
  return (
    <div className="mark-selector" role="group" aria-label="mark selector">
      {MARKS.map((mark) => (
        <button
          key={mark.key}
          className={value === mark.key ? 'active' : ''}
          onClick={() => onChange(mark.key)}
          type="button"
        >
          {mark.label}
        </button>
      ))}
    </div>
  )
}
