const LANE_SPACING = 10

const centerY = (rect) => (rect.top + rect.bottom) / 2

const getPort = (rect, side) => ({
  x: side === 'left' ? rect.left : rect.right,
  y: centerY(rect),
})

const nextLaneOffset = (index) => index * LANE_SPACING

export function computeEdgeRoutes(diagram, columns, nodeRects, boundaries) {
  if (!diagram || !columns?.length) return { routes: [], debug: [] }
  const columnOrder = {}
  columns.forEach((c, idx) => {
    columnOrder[c.id] = idx
  })
  const nodeById = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const groups = {}

  diagram.edges.forEach((edge) => {
    const source = nodeById[edge.fromNodeId]
    const target = nodeById[edge.toNodeId]
    if (!source || !target) return
    const sourceRect = nodeRects[source.id]
    const targetRect = nodeRects[target.id]
    if (!sourceRect || !targetRect) return
    const direction =
      edge.direction && edge.direction !== 'auto'
        ? edge.direction
        : columnOrder[source.columnId] <= columnOrder[target.columnId]
        ? 'ltr'
        : 'rtl'
    const sourcePort = direction === 'ltr' ? getPort(sourceRect, 'right') : getPort(sourceRect, 'left')
    const targetPort = direction === 'ltr' ? getPort(targetRect, 'left') : getPort(targetRect, 'right')
    const columnBoundary = boundaries?.[target.columnId]
    if (!columnBoundary) return
    const groupKey = `${target.id}-${direction}`
    if (!groups[groupKey]) {
      groups[groupKey] = { target, direction, edges: [], targetPort, columnBoundary }
    }
    groups[groupKey].edges.push({ edge, sourcePort, targetPort })
  })

  const laneOrderByColumn = {}
  Object.values(groups).forEach((group) => {
    const colId = group.target.columnId
    if (!laneOrderByColumn[colId]) laneOrderByColumn[colId] = []
    laneOrderByColumn[colId].push(group)
  })

  Object.values(laneOrderByColumn).forEach((list) => {
    list.sort((a, b) => a.targetPort.y - b.targetPort.y)
  })

  const routes = []
  const debug = []

  Object.values(groups).forEach((group) => {
    const { target, edges, targetPort, columnBoundary } = group
    const laneIndex = laneOrderByColumn[target.columnId].indexOf(group)
    const trunkX = columnBoundary.left - nextLaneOffset(laneIndex)
    const ys = [targetPort.y, ...edges.map((e) => e.sourcePort.y)]
    const trunkTop = Math.min(...ys)
    const trunkBottom = Math.max(...ys)

    debug.push({
      targetId: target.id,
      trunkX,
      laneIndex,
      laneCount: laneOrderByColumn[target.columnId].length,
    })

    routes.push({
      id: `${target.id}-trunk-${group.direction}-${laneIndex}`,
      points: [
        { x: trunkX, y: trunkTop },
        { x: trunkX, y: trunkBottom },
      ],
      markerEnd: null,
      targetId: target.id,
    })

    edges.forEach((item) => {
      routes.push({
        id: item.edge.id,
        points: [
          { x: item.sourcePort.x, y: item.sourcePort.y },
          { x: trunkX, y: item.sourcePort.y },
        ],
        markerEnd: null,
        targetId: target.id,
      })
    })

    routes.push({
      id: `${target.id}-into-${group.direction}-${laneIndex}`,
      points: [
        { x: trunkX, y: targetPort.y },
        { x: targetPort.x, y: targetPort.y },
      ],
      markerEnd: 'arrowhead',
      targetId: target.id,
    })
  })

  return { routes, debug }
}
