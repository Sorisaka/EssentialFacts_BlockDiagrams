import React, { useEffect, useMemo, useState } from 'react'

import { computeEdgeRoutes } from '../edgeRouting'

const strokeColor = '#475569'

export function EdgeLayer({ diagram, columns, columnRefs, nodeRefs, canvasRef, version, onDeleteEdge }) {
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
      {routes.map((route) => (
        <polyline
          key={route.id}
          points={route.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinejoin="round"
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onDeleteEdge?.(route.id)
          }}
        />
      ))}
    </svg>
  )
}
