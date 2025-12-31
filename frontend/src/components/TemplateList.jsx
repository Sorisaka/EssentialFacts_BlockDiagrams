import React from 'react'

export function TemplateList({ templates, onApply, onDelete }) {
  return (
    <ul className="template-list">
      {templates.map((t) => (
        <li key={t.id} className="template-card">
          <div className="template-card__body">
            <div>
              <div className="template-card__title">{t.name}</div>
              <div className="template-card__subtitle">{t.nodeTitle}</div>
            </div>
            <div className="template-card__actions">
              <button onClick={() => onApply(t)}>適用</button>
              <button className="ghost" onClick={() => onDelete(t)}>
                削除
              </button>
            </div>
          </div>
        </li>
      ))}
      {templates.length === 0 && <li className="muted">テンプレがありません</li>}
    </ul>
  )
}
