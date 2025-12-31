import React, { useEffect, useMemo, useState } from 'react'

import { computeEdgeRoutes } from '../edgeRouting'

const strokeColor = '#475569'

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

  const { routes, debug } = useMemo(
    () => computeEdgeRoutes(diagram, columns, nodeRects, boundaries),
    [diagram, columns, nodeRects, boundaries]
  )

  useEffect(() => {
    if (debug?.length) {
      console.debug('edge-routing', debug)
    }
  }, [debug])

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
          strokeLinejoin="round"
          markerEnd={route.markerEnd ? 'url(#arrowhead)' : undefined}
        />
      ))}
      {jumpers.map((jump, idx) => (
        <path key={`jump-${idx}`} d={`M ${jump.x} ${jump.y - 6} A 6 6 0 0 1 ${jump.x} ${jump.y + 6}`} fill="none" stroke={strokeColor} strokeWidth="2.5" />
      ))}
    </svg>
  )
}
