import React from 'react'
import { MarkSelector } from './MarkSelector'

export function PropertiesPanel({ selected, diagram, onUpdateColumn, onUpdateNode, onAddItem, onDeleteNode, onDeleteColumn, onDeleteEdge }) {
  const node =
    selected.type === 'node'
      ? diagram.nodes.find((n) => n.id === selected.id)
      : selected.type === 'item'
      ? diagram.nodes.find((n) => n.id === selected.nodeId)
      : null
  const column =
    selected.type === 'column'
      ? diagram.columns.find((c) => c.id === selected.id)
      : node
      ? diagram.columns.find((c) => c.id === node.columnId)
      : null

  return (
    <aside className="properties">
      <h3>プロパティ</h3>
      {selected.type === 'diagram' && <p className="muted">図全体を編集中です。</p>}

      {column && (
        <div className="property-card">
          <header className="property-card__header">
            <h4>列設定</h4>
            <button className="ghost" onClick={() => onDeleteColumn(column.id)}>
              列を削除
            </button>
          </header>
          <label>
            列タイトル
            <input
              value={column.title}
              onChange={(e) => onUpdateColumn(column.id, { title: e.target.value })}
            />
          </label>
        </div>
      )}

      {node && (
        <div className="property-card">
          <header className="property-card__header">
            <h4>ノード設定</h4>
            <button className="ghost" onClick={() => onDeleteNode(node.id)}>
              ノード削除
            </button>
          </header>
          <label>
            タイトル
            <input value={node.title} onChange={(e) => onUpdateNode(node.id, { title: e.target.value })} />
          </label>
          <p className="muted">位置はノードのハンドルをドラッグして上下に移動します。</p>

          <div className="property-block">
            <div className="property-card__subheader">
              <span>項目</span>
              <button className="ghost" onClick={() => onAddItem(node.id)}>
                項目追加
              </button>
            </div>
            {node.items.map((item) => (
              <div key={item.id} className="property-item">
                <input
                  value={item.text}
                  onChange={(e) =>
                    onUpdateNode(node.id, {
                      items: node.items.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)),
                    })
                  }
                />
                <MarkSelector
                  value={item.mark}
                  onChange={(mark) =>
                    onUpdateNode(node.id, {
                      items: node.items.map((it) => (it.id === item.id ? { ...it, mark } : it)),
                    })
                  }
                />
                <button
                  className="ghost"
                  onClick={() =>
                    onUpdateNode(node.id, {
                      items: node.items.filter((it) => it.id !== item.id),
                    })
                  }
                >
                  削除
                </button>
              </div>
            ))}
          </div>

          <div className="property-block">
            <div className="property-card__subheader">
              <span>接続</span>
            </div>
            <div className="edge-list">
              <div className="edge-list__group">
                <strong>出力</strong>
                {diagram.edges.filter((e) => e.fromNodeId === node.id).map((edge) => {
                  const toNode = diagram.nodes.find((n) => n.id === edge.toNodeId)
                  return (
                    <div key={edge.id} className="edge-list__row">
                      <span>{toNode ? toNode.title : edge.toNodeId}</span>
                      <button className="ghost" onClick={() => onDeleteEdge(edge.id)}>
                        削除
                      </button>
                    </div>
                  )
                })}
                {!diagram.edges.filter((e) => e.fromNodeId === node.id).length && <span className="muted">接続なし</span>}
              </div>
              <div className="edge-list__group">
                <strong>入力</strong>
                {diagram.edges.filter((e) => e.toNodeId === node.id).map((edge) => {
                  const fromNode = diagram.nodes.find((n) => n.id === edge.fromNodeId)
                  return (
                    <div key={edge.id} className="edge-list__row">
                      <span>{fromNode ? fromNode.title : edge.fromNodeId}</span>
                      <button className="ghost" onClick={() => onDeleteEdge(edge.id)}>
                        削除
                      </button>
                    </div>
                  )
                })}
                {!diagram.edges.filter((e) => e.toNodeId === node.id).length && <span className="muted">接続なし</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {!column && !node && selected.type !== 'diagram' && <p className="muted">編集対象を選択してください。</p>}
    </aside>
  )
}
