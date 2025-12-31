import React, { useEffect, useMemo, useState } from 'react'

const strokeColor = '#475569'
const ANCHOR_PAD = 8

const routeSingleEdge = (from, to) => {
  if (!from || !to) return []
  if (from.x === to.x || from.y === to.y) return [from, to]
  return [from, { x: from.x, y: to.y }, to]
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

const getAnchorPoint = (rect, side, preferredY) => {
  if (!rect) return null
  const y = clamp(preferredY, rect.top + ANCHOR_PAD, rect.bottom - ANCHOR_PAD)
  if (side === 'left') return { x: rect.left, y }
  if (side === 'right') return { x: rect.right, y }
  if (side === 'top') return { x: clamp(rect.left + (rect.width || 0) / 2, rect.left + ANCHOR_PAD, rect.right - ANCHOR_PAD), y: rect.top }
  return { x: clamp(rect.left + (rect.width || 0) / 2, rect.left + ANCHOR_PAD, rect.right - ANCHOR_PAD), y: rect.bottom }
}

const buildRoutes = (diagram, columns, nodeRects) => {
  const columnOrder = {}
  columns.forEach((c, idx) => (columnOrder[c.id] = idx))
  const nodeById = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const portByNode = {}
  diagram.nodes.forEach((node) => {
    const rect = nodeRects[node.id]
    if (!rect) return
    const centerY = (rect.top + rect.bottom) / 2
    portByNode[node.id] = {
      inPort: getAnchorPoint(rect, 'left', centerY),
      outPort: getAnchorPoint(rect, 'right', centerY),
    }
  })

  const grouped = {}
  diagram.edges.forEach((edge) => {
    const source = nodeById[edge.fromNodeId]
    const target = nodeById[edge.toNodeId]
    if (!source || !target) return
    const direction =
      edge.direction && edge.direction !== 'auto'
        ? edge.direction
        : columnOrder[source.columnId] <= columnOrder[target.columnId]
        ? 'ltr'
        : 'rtl'
    const sourcePort = direction === 'ltr' ? portByNode[source.id]?.outPort : portByNode[source.id]?.inPort
    const targetPort = direction === 'ltr' ? portByNode[target.id]?.inPort : portByNode[target.id]?.outPort
    if (!sourcePort || !targetPort) return
    const key = `${target.id}-${direction}`
    if (!grouped[key]) grouped[key] = { target, direction, edges: [] }
    grouped[key].edges.push({ edge, sourcePort, targetPort })
  })

  const routes = []
  const mergeDots = []

  Object.values(grouped).forEach((group) => {
    const { target, direction, edges } = group
    const targetRect = nodeRects[target.id]
    const targetPort = direction === 'ltr' ? portByNode[target.id]?.inPort : portByNode[target.id]?.outPort
    const preferredY = targetPort?.y ?? (targetRect ? (targetRect.top + targetRect.bottom) / 2 : 0)
    if (edges.length === 1) {
      const [single] = edges
      const points = routeSingleEdge(single.sourcePort, single.targetPort)
      routes.push({
        id: single.edge.id,
        points,
        markerEnd: 'arrowhead',
        targetId: target.id,
      })
      return
    }

    const candidateX = direction === 'ltr' ? portByNode[target.id]?.inPort?.x : portByNode[target.id]?.outPort?.x
    if (candidateX == null) return
    const candidateYs = [preferredY, ...edges.map((item) => item.sourcePort.y)]
    let bestY = preferredY
    let bestCost = Number.POSITIVE_INFINITY
    candidateYs.forEach((y) => {
      const cost = edges.reduce((acc, item) => acc + Math.abs(item.sourcePort.y - y), Math.abs(preferredY - y))
      if (cost < bestCost) {
        bestCost = cost
        bestY = y
      }
    })
    const mergePoint = { x: candidateX, y: bestY }
    mergeDots.push(mergePoint)

    const trunkTarget = targetPort
    const trunkPoints = routeSingleEdge(mergePoint, trunkTarget)
    routes.push({
      id: `${target.id}-${direction}-trunk`,
      points: trunkPoints,
      markerEnd: 'arrowhead',
      targetId: target.id,
    })

    edges.forEach((item) => {
      const branchPoints = routeSingleEdge(item.sourcePort, mergePoint)
      routes.push({ id: item.edge.id, points: branchPoints, markerEnd: null, targetId: target.id })
    })
  })

  return { routes, mergeDots }
}

const buildSegments = (routes) => {
  const segments = []
  routes.forEach((route) => {
    for (let i = 0; i < route.points.length - 1; i += 1) {
      const p1 = route.points[i]
      const p2 = route.points[i + 1]
      const horizontal = p1.y === p2.y
      segments.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        horizontal,
      })
    }
  })
  return segments
}

const findJumpers = (segments) => {
  const jumps = []
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const a = segments[i]
      const b = segments[j]
      if (a.horizontal === b.horizontal) continue
      const horizontal = a.horizontal ? a : b
      const vertical = a.horizontal ? b : a
      const x = vertical.x1
      const y = horizontal.y1
      const withinX = x >= Math.min(horizontal.x1, horizontal.x2) && x <= Math.max(horizontal.x1, horizontal.x2)
      const withinY = y >= Math.min(vertical.y1, vertical.y2) && y <= Math.max(vertical.y1, vertical.y2)
      if (withinX && withinY) {
        jumps.push({ x, y })
      }
    }
  }
  return jumps
}

export function EdgeLayer({ diagram, columns, columnRefs, nodeRefs, canvasRef, version }) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  const nodeRects = useMemo(() => {
    if (!canvasRef.current) return {}
    const canvasEl = canvasRef.current
    const canvasRect = canvasEl.getBoundingClientRect()
    const rects = {}
    Object.entries(nodeRefs.current).forEach(([id, el]) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      rects[id] = {
        left: rect.left - canvasRect.left + canvasEl.scrollLeft,
        right: rect.right - canvasRect.left + canvasEl.scrollLeft,
        top: rect.top - canvasRect.top + canvasEl.scrollTop,
        bottom: rect.bottom - canvasRect.top + canvasEl.scrollTop,
        width: rect.width,
        height: rect.height,
      }
    })
    return rects
  }, [nodeRefs, canvasRef, version, diagram.nodes.length])

  const boundaries = useMemo(() => {
    if (!canvasRef.current) return {}
    const canvasEl = canvasRef.current
    const canvasRect = canvasEl.getBoundingClientRect()
    const boundariesMap = {}
    columns.forEach((col) => {
      const el = columnRefs.current[col.id]
      if (!el) return
      const rect = el.getBoundingClientRect()
      boundariesMap[col.id] = {
        left: rect.left - canvasRect.left + canvasEl.scrollLeft,
        right: rect.right - canvasRect.left + canvasEl.scrollLeft,
      }
    })
    return boundariesMap
  }, [columns, columnRefs, canvasRef, version])

  const { routes, mergeDots } = useMemo(() => buildRoutes(diagram, columns, nodeRects, boundaries), [diagram, columns, nodeRects, boundaries])

  const jumpers = useMemo(() => findJumpers(buildSegments(routes)), [routes])

  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new ResizeObserver(() => {
      setSize({ width: canvasRef.current.scrollWidth, height: canvasRef.current.scrollHeight })
    })
    observer.observe(canvasRef.current)
    setSize({ width: canvasRef.current.scrollWidth, height: canvasRef.current.scrollHeight })
    return () => observer.disconnect()
  }, [canvasRef])

  if (!size.width || !size.height) return null

  return (
    <svg className="edge-layer" width={size.width} height={size.height}>
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6" fill={strokeColor} />
        </marker>
      </defs>
      {routes.map((route) => (
        <polyline
          key={route.id}
          points={route.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          markerEnd={route.markerEnd ? 'url(#arrowhead)' : undefined}
        />
      ))}
      {mergeDots.map((dot, idx) => (
        <circle key={`merge-${idx}`} cx={dot.x} cy={dot.y} r={4} fill={strokeColor} />
      ))}
      {jumpers.map((jump, idx) => (
        <path key={`jump-${idx}`} d={`M ${jump.x} ${jump.y - 6} A 6 6 0 0 1 ${jump.x} ${jump.y + 6}`} fill="none" stroke={strokeColor} strokeWidth="2.5" />
      ))}
    </svg>
  )
}
