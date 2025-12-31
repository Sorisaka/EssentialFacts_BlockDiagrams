import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkSelector, MARKS } from './components/MarkSelector'
import { TemplateList } from './components/TemplateList'
import { PropertiesPanel } from './components/PropertiesPanel'
import { EdgeLayer } from './components/EdgeLayer'
import { useApi } from './hooks/useApi'
import { uid } from './utils'

const GRID_STEP = 12
const NODE_GAP = 12
const DEFAULT_ROW_HEIGHT = 140
const DEFAULT_NODE_HEIGHT = 160

const createDefaultDiagram = () => {
  const columnId = uid()
  const nodeId = uid()
  return {
    id: '',
    name: '新規ダイアグラム',
    columns: [
      {
        id: columnId,
        title: '列1',
        order: 0,
      },
    ],
    nodes: [
      {
        id: nodeId,
        columnId,
        row: 0,
        y: 0,
        title: '最初のノード',
        items: [
          { id: uid(), text: '要素1', mark: 'circle' },
          { id: uid(), text: '要素2', mark: 'triangle' },
        ],
      },
    ],
    edges: [],
    rowCount: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const markToSymbol = MARKS.reduce((acc, cur) => ({ ...acc, [cur.key]: cur.label }), {})

const snap = (value) => Math.round(value / GRID_STEP) * GRID_STEP

const migrateDiagram = (diagram) => {
  const migratedNodes = diagram.nodes.map((node) => {
    const y = node.y != null ? node.y : node.row * DEFAULT_ROW_HEIGHT
    const fixedMarkItems = node.items.map((item) => {
      if (typeof item.mark === 'number') {
        const markKeys = Object.keys(markToSymbol)
        return { ...item, mark: markKeys[item.mark] || 'none' }
      }
      return item
    })
    return { ...node, y: snap(y), items: fixedMarkItems }
  })
  return { ...diagram, nodes: migratedNodes }
}

export default function App() {
  const api = useApi()
  const [diagramList, setDiagramList] = useState([])
  const [currentDiagram, setCurrentDiagram] = useState(createDefaultDiagram())
  const [templates, setTemplates] = useState([])
  const [templateKeyword, setTemplateKeyword] = useState('')
  const [selected, setSelected] = useState({ type: 'diagram' })
  const [status, setStatus] = useState('ready')
  const [dirty, setDirty] = useState(false)
  const [autoSaveError, setAutoSaveError] = useState('')
  const [connectMode, setConnectMode] = useState(false)
  const [pendingSource, setPendingSource] = useState(null)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const isInitializing = useRef(true)
  const columnRefs = useRef({})
  const nodeRefs = useRef({})
  const nodeHeightsRef = useRef({})
  const layoutJob = useRef(null)
  const canvasRef = useRef(null)

  useLayoutEffect(() => {
    columnRefs.current = {}
    nodeRefs.current = {}
  }, [currentDiagram.columns.length, currentDiagram.nodes.length])

  const sortedColumns = useMemo(
    () => [...currentDiagram.columns].sort((a, b) => a.order - b.order),
    [currentDiagram.columns]
  )

  const nodesByColumn = useMemo(() => {
    const map = {}
    currentDiagram.nodes.forEach((node) => {
      if (!map[node.columnId]) map[node.columnId] = []
      map[node.columnId].push(node)
    })
    Object.keys(map).forEach((key) => {
      map[key].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    })
    return map
  }, [currentDiagram.nodes])

  const estimateColumnHeight = useMemo(() => {
    const heights = {}
    sortedColumns.forEach((col) => {
      const nodes = nodesByColumn[col.id] || []
      const bottoms = nodes.map((node) => {
        const height = nodeHeightsRef.current[node.id] ?? DEFAULT_NODE_HEIGHT
        const top = node.y ?? 0
        return top + height
      })
      const maxBottom = bottoms.length ? Math.max(...bottoms) : 0
      heights[col.id] = maxBottom + DEFAULT_ROW_HEIGHT
    })
    return heights
  }, [nodesByColumn, sortedColumns])

  const maxRowUsed = useMemo(() => {
    const bottoms = currentDiagram.nodes.map((n) => {
      const height = nodeHeightsRef.current[n.id] ?? DEFAULT_ROW_HEIGHT
      return (n.y ?? 0) + height
    })
    return bottoms.length ? Math.ceil(Math.max(...bottoms) / DEFAULT_ROW_HEIGHT) : 0
  }, [currentDiagram.nodes])
  const totalRows = Math.max(currentDiagram.rowCount, maxRowUsed + 1, 3)
  const rows = useMemo(() => Array.from({ length: totalRows }, (_, i) => i), [totalRows])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const list = await api.fetchDiagrams()
        setDiagramList(list)
        if (list.length) {
          const first = migrateDiagram(await api.getDiagram(list[0].id))
          setCurrentDiagram(first)
        }
      } catch (err) {
        console.error(err)
      } finally {
        isInitializing.current = false
      }
    }
    bootstrap()
    api.fetchTemplates().then(setTemplates).catch(console.error)
  }, [])

  useEffect(() => {
    if (isInitializing.current || !dirty) return undefined
    const timer = setTimeout(() => {
      handleSaveDiagram(true).catch((err) => setAutoSaveError(err.message))
    }, 800)
    return () => clearTimeout(timer)
  }, [currentDiagram, dirty])

  useEffect(() => {
    const measureHeights = () => {
      const heights = {}
      Object.entries(nodeRefs.current).forEach(([id, el]) => {
        if (el) heights[id] = el.getBoundingClientRect().height
      })
      if (Object.keys(heights).length) {
        nodeHeightsRef.current = { ...nodeHeightsRef.current, ...heights }
      }
    }
    measureHeights()
    requestLayout()
  }, [currentDiagram.nodes, currentDiagram.columns])

  useEffect(() => {
    const handleResize = () => requestLayout()
    window.addEventListener('resize', handleResize)
    const canvas = canvasRef.current
    const onScroll = () => requestLayout()
    if (canvas) canvas.addEventListener('scroll', onScroll)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (canvas) canvas.removeEventListener('scroll', onScroll)
    }
  }, [])

  const requestLayout = () => {
    if (layoutJob.current) cancelAnimationFrame(layoutJob.current)
    layoutJob.current = requestAnimationFrame(() => {
      layoutJob.current = null
      resolveCollisions()
      setLayoutVersion((v) => v + 1)
    })
  }

  const updateDiagram = (updater) => {
    setCurrentDiagram((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      setDirty(true)
      setAutoSaveError('')
      return next
    })
  }

  const syncDiagramListName = (diagram) => {
    setDiagramList((prev) => {
      const exists = prev.find((d) => d.id === diagram.id)
      if (!exists)
        return [...prev, { id: diagram.id, name: diagram.name, updatedAt: diagram.updatedAt, createdAt: diagram.createdAt }]
      return prev.map((d) => (d.id === diagram.id ? { ...d, name: diagram.name, updatedAt: diagram.updatedAt } : d))
    })
  }

  const handleCreateDiagram = async () => {
    const base = createDefaultDiagram()
    const created = await api.createDiagram({
      name: base.name,
      columns: base.columns,
      nodes: base.nodes,
      edges: base.edges,
      rowCount: base.rowCount,
    })
    setCurrentDiagram(migrateDiagram(created))
    setSelected({ type: 'diagram' })
    setConnectMode(false)
    setPendingSource(null)
    syncDiagramListName(created)
    setDirty(false)
  }

  const handleSelectDiagram = async (diagramId) => {
    const diagram = migrateDiagram(await api.getDiagram(diagramId))
    setCurrentDiagram(diagram)
    setSelected({ type: 'diagram' })
    setConnectMode(false)
    setPendingSource(null)
    setDirty(false)
  }

  const handleDeleteDiagram = async (diagramId) => {
    if (!window.confirm('選択したダイアグラムを削除しますか？')) return
    await api.deleteDiagram(diagramId)
    setDiagramList((prev) => {
      const nextList = prev.filter((d) => d.id !== diagramId)
      if (currentDiagram.id === diagramId) {
        const fallback = nextList[0]
        if (fallback) {
          handleSelectDiagram(fallback.id)
        } else {
          setCurrentDiagram(createDefaultDiagram())
          setSelected({ type: 'diagram' })
        }
      }
      return nextList
    })
  }

  const handleDuplicateDiagram = async (diagramId) => {
    const duplicated = migrateDiagram(await api.duplicateDiagram(diagramId))
    syncDiagramListName(duplicated)
    setCurrentDiagram(duplicated)
    setSelected({ type: 'diagram' })
    setConnectMode(false)
    setPendingSource(null)
  }

  const handleSaveDiagram = async (silent = false) => {
    if (!currentDiagram) return
    try {
      setStatus('saving')
      let saved
      if (!currentDiagram.id) {
        saved = await api.createDiagram({
          name: currentDiagram.name,
          columns: currentDiagram.columns,
          nodes: currentDiagram.nodes,
          edges: currentDiagram.edges,
          rowCount: currentDiagram.rowCount,
        })
      } else {
        saved = await api.saveDiagram(currentDiagram)
      }
      setCurrentDiagram(migrateDiagram(saved))
      syncDiagramListName(saved)
      setDirty(false)
      setStatus('saved')
      if (!silent) setTimeout(() => setStatus('ready'), 600)
    } catch (err) {
      setAutoSaveError(err.message)
      setStatus('error')
      if (!silent) alert('保存に失敗しました: ' + err.message)
      throw err
    }
  }

  const handleExportPdf = async () => {
    if (!currentDiagram.id) {
      alert('PDF出力には先に図を保存してください。')
      return
    }
    try {
      if (dirty) {
        await handleSaveDiagram(true)
      }
      const { blob, filename } = await api.exportPdf(currentDiagram.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('PDF出力に失敗しました: ' + err.message)
    }
  }

  const handleAddColumn = () => {
    updateDiagram((prev) => {
      const nextOrder = prev.columns.length ? Math.max(...prev.columns.map((c) => c.order)) + 1 : 0
      return {
        ...prev,
        columns: [...prev.columns, { id: uid(), title: `列${prev.columns.length + 1}`, order: nextOrder }],
      }
    })
    setSelected({ type: 'diagram' })
    setPendingSource(null)
  }

  const handleUpdateColumn = (columnId, attrs) => {
    updateDiagram((prev) => ({
      ...prev,
      columns: prev.columns.map((col) => (col.id === columnId ? { ...col, ...attrs } : col)),
    }))
  }

  const handleDeleteColumn = (columnId) => {
    if (!window.confirm('列と内部のノードを削除しますか？')) return
    updateDiagram((prev) => ({
      ...prev,
      columns: prev.columns.filter((c) => c.id !== columnId),
      nodes: prev.nodes.filter((n) => n.columnId !== columnId),
    }))
    setSelected({ type: 'diagram' })
  }

  const nextYForColumn = (diagram, columnId) => {
    const nodes = diagram.nodes.filter((n) => n.columnId === columnId)
    if (!nodes.length) return 0
    const bottoms = nodes.map((n) => (n.y ?? 0) + (nodeHeightsRef.current[n.id] ?? DEFAULT_NODE_HEIGHT))
    return snap(Math.max(...bottoms) + NODE_GAP)
  }

  const handleAddNode = (columnId, targetY) => {
    updateDiagram((prev) => {
      const y = targetY != null ? snap(targetY) : nextYForColumn(prev, columnId)
      const row = Math.round(y / DEFAULT_ROW_HEIGHT)
      return {
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id: uid(),
            columnId,
            row,
            y,
            title: '新規ノード',
            items: [{ id: uid(), text: '新規項目', mark: 'circle' }],
          },
        ],
        rowCount: Math.max(prev.rowCount, row + 1),
      }
    })
  }

  const handleUpdateNode = (nodeId, attrs) => {
    updateDiagram((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, ...attrs } : node)),
    }))
  }

  const handleDeleteNode = (nodeId) => {
    if (!window.confirm('ノードを削除しますか？')) return
    updateDiagram((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((node) => node.id !== nodeId),
      edges: prev.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    }))
    setSelected({ type: 'diagram' })
    setPendingSource(null)
  }

  const handleAddItem = (nodeId) => {
    updateDiagram((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, items: [...node.items, { id: uid(), text: '追加項目', mark: 'none' }] }
          : node
      ),
    }))
  }

  const handleDeleteItem = (nodeId, itemId) => {
    updateDiagram((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        node.id === nodeId ? { ...node, items: node.items.filter((item) => item.id !== itemId) } : node
      ),
    }))
  }

  const handleTidyLayout = () => {
    const heights = nodeHeightsRef.current
    updateDiagram((prev) => {
      const updatedNodes = [...prev.nodes]
      const orderedColumns = [...prev.columns].sort((a, b) => a.order - b.order)
      orderedColumns.forEach((col) => {
        const colNodes = updatedNodes.filter((n) => n.columnId === col.id).sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
        let cursor = 0
        colNodes.forEach((node) => {
          const height = heights[node.id] ?? DEFAULT_NODE_HEIGHT
          const top = snap(cursor)
          node.y = top
          node.row = Math.round(top / DEFAULT_ROW_HEIGHT)
          cursor = top + height + NODE_GAP
        })
      })
      return { ...prev, nodes: updatedNodes }
    })
    requestLayout()
  }

  const handleSearchTemplate = async (keyword) => {
    setTemplateKeyword(keyword)
    const results = await api.fetchTemplates(keyword)
    setTemplates(results)
  }

  const handleApplyTemplate = (template) => {
    const targetColumnId =
      (selected.type === 'column' && selected.id) ||
      (selected.type === 'node' && selected.columnId) ||
      currentDiagram.columns[0]?.id
    if (!targetColumnId) return
    const selectedNode = selected.type === 'node' ? currentDiagram.nodes.find((n) => n.id === selected.id) : null
    const y = selectedNode ? selectedNode.y ?? 0 : nextYForColumn(currentDiagram, targetColumnId)
    const row = Math.round(y / DEFAULT_ROW_HEIGHT)
    const node = {
      id: uid(),
      columnId: targetColumnId,
      row,
      y,
      title: template.nodeTitle,
      items: template.items.map((item) => ({ id: uid(), text: item.text, mark: item.markDefault || 'none' })),
    }
    updateDiagram((prev) => ({
      ...prev,
      nodes: [...prev.nodes, node],
      rowCount: Math.max(prev.rowCount, row + 1),
    }))
  }

  const handleDeleteTemplate = async (template) => {
    if (!window.confirm('テンプレートを削除しますか？')) return
    await api.deleteTemplate(template.id)
    setTemplates((prev) => prev.filter((t) => t.id !== template.id))
  }

  const handleCreateTemplateFromNode = async () => {
    if (selected.type !== 'node') return
    const node = currentDiagram.nodes.find((n) => n.id === selected.id)
    if (!node) return
    const payload = {
      name: `${node.title}のテンプレ`,
      nodeTitle: node.title,
      items: node.items.map((item) => ({ text: item.text, markDefault: item.mark })),
    }
    const created = await api.createTemplateFromNode(payload)
    setTemplates((prev) => [created, ...prev])
  }

  const handleAddEdge = (fromNodeId, toNodeId) => {
    if (fromNodeId === toNodeId) return
    updateDiagram((prev) => {
      const exists = prev.edges.find((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId)
      if (exists) return prev
      return { ...prev, edges: [...prev.edges, { id: uid(), fromNodeId, toNodeId, direction: 'auto' }] }
    })
  }

  const handleDeleteEdge = (edgeId) => {
    updateDiagram((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }))
  }

  const handleToggleConnectMode = () => {
    setConnectMode((v) => !v)
    setPendingSource(null)
  }

  const handleSelectNode = (node, columnId) => {
    if (connectMode) {
      if (!pendingSource) {
        setPendingSource(node)
      } else {
        handleAddEdge(pendingSource.id, node.id)
        setPendingSource(null)
      }
      return
    }
    setSelected({ type: 'node', id: node.id, columnId })
  }

  const resolveCollisions = () => {
    const heights = nodeHeightsRef.current
    const updatedNodes = [...currentDiagram.nodes]
    let changed = false
    sortedColumns.forEach((col) => {
      const colNodes = updatedNodes.filter((n) => n.columnId === col.id).sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
      let cursor = 0
      colNodes.forEach((node) => {
        const height = heights[node.id] ?? DEFAULT_NODE_HEIGHT
        let top = snap(node.y ?? 0)
        if (top < cursor) top = snap(cursor)
        if (node.y !== top) {
          node.y = top
          changed = true
        }
        const row = Math.round(top / DEFAULT_ROW_HEIGHT)
        if (node.row !== row) {
          node.row = row
          changed = true
        }
        cursor = top + height + NODE_GAP
      })
    })
    if (changed) {
      setCurrentDiagram((prev) => ({ ...prev, nodes: updatedNodes }))
    }
  }

  const selectedNode = useMemo(
    () => (selected.type === 'node' ? currentDiagram.nodes.find((n) => n.id === selected.id) : null),
    [selected, currentDiagram.nodes]
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title-group">
          <input
            className="diagram-title"
            value={currentDiagram.name}
            onChange={(e) => updateDiagram((prev) => ({ ...prev, name: e.target.value }))}
          />
          <div className="status">
            {status === 'saving' && '保存中...'}
            {status === 'saved' && '保存済み'}
            {dirty && status === 'ready' && '未保存の変更あり'}
            {autoSaveError && <span className="error">自動保存エラー: {autoSaveError}</span>}
          </div>
        </div>
        <div className="topbar-actions">
          <button onClick={() => handleSaveDiagram(false)}>保存</button>
          <button onClick={handleExportPdf}>PDF出力</button>
          <button onClick={handleCreateDiagram}>新規作成</button>
          <button onClick={handleAddColumn}>列追加</button>
          <button onClick={handleTidyLayout}>整列</button>
          <button className={connectMode ? 'active' : ''} onClick={handleToggleConnectMode}>
            接続モード{pendingSource ? '（ターゲット選択）' : ''}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section>
            <div className="section-header">
              <h3>ダイアグラム</h3>
              <button onClick={handleCreateDiagram}>＋</button>
            </div>
            <ul className="diagram-list">
              {diagramList.map((d) => (
                <li key={d.id} className={currentDiagram.id === d.id ? 'active' : ''}>
                  <div className="diagram-row">
                    <button className="diagram-row__title" onClick={() => handleSelectDiagram(d.id)}>
                      {d.name}
                    </button>
                    <div className="diagram-row__actions">
                      <button className="ghost" onClick={() => handleDuplicateDiagram(d.id)}>
                        複製
                      </button>
                      <button className="ghost" onClick={() => handleDeleteDiagram(d.id)}>
                        削除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {!diagramList.length && <li className="muted">まだ図がありません</li>}
            </ul>
          </section>

          <section className="templates">
            <div className="section-header">
              <h3>テンプレ</h3>
              <input
                type="search"
                placeholder="検索"
                value={templateKeyword}
                onChange={(e) => handleSearchTemplate(e.target.value)}
              />
            </div>
            <TemplateList templates={templates} onApply={handleApplyTemplate} onDelete={handleDeleteTemplate} />
            <button className="fullwidth" disabled={selected.type !== 'node'} onClick={handleCreateTemplateFromNode}>
              選択ノードをテンプレ登録
            </button>
          </section>
        </aside>

        <main className="canvas" aria-label="diagram canvas" ref={canvasRef}>
          <div className="row-guides">
            {rows.map((row) => (
              <div key={row} className="row-guides__line">
                <span className="row-guides__label">Row {row + 1}</span>
              </div>
            ))}
          </div>
          <EdgeLayer
            diagram={currentDiagram}
            columns={sortedColumns}
            columnRefs={columnRefs}
            nodeRefs={nodeRefs}
            canvasRef={canvasRef}
            version={layoutVersion}
          />
          <div className="columns">
            {sortedColumns.map((column) => {
              const nodesInColumn = nodesByColumn[column.id] || []
              return (
                <div key={column.id} className="column" ref={(el) => (columnRefs.current[column.id] = el)}>
                  <div className="column-header">
                    <input
                      value={column.title}
                      onChange={(e) => handleUpdateColumn(column.id, { title: e.target.value })}
                      onFocus={() => setSelected({ type: 'column', id: column.id })}
                    />
                    <div className="column-header__actions">
                      <button onClick={() => handleAddNode(column.id)}>＋ノード</button>
                      <button className="ghost" onClick={() => handleDeleteColumn(column.id)}>
                        ×
                      </button>
                    </div>
                  </div>
                  <div
                    className="column-rows"
                    style={{ minHeight: estimateColumnHeight[column.id] || DEFAULT_ROW_HEIGHT * 2 }}
                  >
                    {nodesInColumn.map((node) => (
                      <div
                        key={node.id}
                        className={`node ${selected.id === node.id ? 'selected' : ''}`}
                        ref={(el) => (nodeRefs.current[node.id] = el)}
                        onClick={() => handleSelectNode(node, column.id)}
                        style={{ top: `${node.y ?? 0}px` }}
                      >
                        <input
                          className="node-title"
                          value={node.title}
                          onChange={(e) => handleUpdateNode(node.id, { title: e.target.value })}
                        />
                        <ul className="items">
                          {node.items.map((item) => (
                            <li
                              key={item.id}
                              className={`item-row ${selected.itemId === item.id ? 'selected' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelected({ type: 'item', id: item.id, nodeId: node.id, columnId: column.id })
                              }}
                            >
                              <MarkSelector
                                compact
                                value={item.mark}
                                onChange={(mark) =>
                                  handleUpdateNode(node.id, {
                                    items: node.items.map((it) => (it.id === item.id ? { ...it, mark } : it)),
                                  })
                                }
                              />
                              <input
                                value={item.text}
                                onChange={(e) =>
                                  handleUpdateNode(node.id, {
                                    items: node.items.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)),
                                  })
                                }
                              />
                              <span className={`mark mark-${item.mark}`} title={item.mark}>
                                {markToSymbol[item.mark]}
                              </span>
                              <button className="ghost" onClick={() => handleDeleteItem(node.id, item.id)}>
                                削除
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="node-actions">
                          <button className="ghost" onClick={() => handleAddItem(node.id)}>
                            項目追加
                          </button>
                          <button className="ghost" onClick={() => handleDeleteNode(node.id)}>
                            ノード削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="ghost add-in-row" onClick={() => handleAddNode(column.id, nextYForColumn(currentDiagram, column.id))}>
                    ＋ノードを下に追加
                  </button>
                </div>
              )
            })}
          </div>
        </main>

        <PropertiesPanel
          selected={selected}
          diagram={currentDiagram}
          onUpdateColumn={handleUpdateColumn}
          onUpdateNode={handleUpdateNode}
          onAddItem={handleAddItem}
          onDeleteNode={handleDeleteNode}
          onDeleteColumn={handleDeleteColumn}
          onDeleteEdge={handleDeleteEdge}
        />
      </div>
    </div>
  )
}
