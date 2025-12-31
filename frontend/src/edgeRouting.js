const LANE_SPACING = 10

// Rect helper: returns the geometric center of a node box
const center = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 })

// Places an anchor on the requested side of a rectangle, clamped to the frame
const computeAnchor = (rect, side, y) => ({
  x: side === 'left' ? rect.left : rect.right,
  y: y ?? center(rect).y,
})

const nextLaneOffset = (index) => index * LANE_SPACING

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

const dedupePoints = (points) =>
  points.filter((p, idx) => {
    if (idx === 0) return true
    const prev = points[idx - 1]
    return prev.x !== p.x || prev.y !== p.y
  })

// Pick a junction based on the shortest edge in the group so the shared trunk stays compact
const junctionForGroup = (edges, sourceBoundary, targetBoundary) => {
  if (!edges.length) return null
  const shortest = edges.reduce((acc, cur) => {
    const distance = manhattan(cur.sourceAnchor, cur.targetAnchor)
    if (!acc || distance < acc.distance) return { ...cur, distance }
    return acc
  }, null)
  const gapStart = sourceBoundary ?? shortest.sourceAnchor.x
  const gapEnd = targetBoundary ?? shortest.targetAnchor.x
  const junctionX = (gapStart + gapEnd) / 2
  const junctionY = (shortest.sourceAnchor.y + shortest.targetAnchor.y) / 2
  return { junctionX, junctionY }
}

const buildRoute = (edge, junction, boundaries, laneIndex = 0) => {
  const { direction, source, target, sourceAnchor, targetAnchor } = edge
  const sourceBoundaryX = direction === 'ltr' ? boundaries[source.columnId]?.right : boundaries[source.columnId]?.left
  const targetBoundaryX = direction === 'ltr' ? boundaries[target.columnId]?.left : boundaries[target.columnId]?.right
  if (sourceBoundaryX == null || targetBoundaryX == null) return null

  const trunkOffset = nextLaneOffset(laneIndex)
  const junctionX = junction?.junctionX != null ? junction.junctionX : (sourceBoundaryX + targetBoundaryX) / 2
  const shiftedJunctionX =
    direction === 'ltr' ? Math.min(junctionX, targetBoundaryX - trunkOffset) : Math.max(junctionX, targetBoundaryX + trunkOffset)
  const junctionY = junction?.junctionY ?? (sourceAnchor.y + targetAnchor.y) / 2

  const points = dedupePoints([
    sourceAnchor,
    { x: sourceBoundaryX, y: sourceAnchor.y },
    { x: shiftedJunctionX, y: sourceAnchor.y },
    { x: shiftedJunctionX, y: junctionY },
    { x: shiftedJunctionX, y: targetAnchor.y },
    { x: targetBoundaryX, y: targetAnchor.y },
    targetAnchor,
  ])

  return {
    id: edge.edge.id,
    points,
    markerEnd: 'arrowhead',
    targetId: target.id,
  }
}

export function computeEdgeRoutes(diagram, columns, nodeRects, boundaries) {
  if (!diagram || !columns?.length) return { routes: [], debug: [] }
  const nodeById = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const edges = []

  diagram.edges.forEach((edge) => {
    const source = nodeById[edge.fromNodeId]
    const target = nodeById[edge.toNodeId]
    if (!source || !target) return
    const sourceRect = nodeRects[source.id]
    const targetRect = nodeRects[target.id]
    if (!sourceRect || !targetRect) return
    const sourceCenter = center(sourceRect)
    const targetCenter = center(targetRect)
    const direction = sourceCenter.x <= targetCenter.x ? 'ltr' : 'rtl'
    const sourceAnchor = computeAnchor(sourceRect, direction === 'ltr' ? 'right' : 'left', sourceCenter.y)
    const targetAnchor = computeAnchor(targetRect, direction === 'ltr' ? 'left' : 'right', targetCenter.y)
    edges.push({ edge, source, target, direction, sourceAnchor, targetAnchor })
  })

  const targetGroups = {}
  const sourceGroups = {}

  edges.forEach((edge) => {
    const targetKey = `T:${edge.target.id}:${edge.direction}`
    const sourceKey = `S:${edge.source.id}:${edge.direction}`
    if (!targetGroups[targetKey]) targetGroups[targetKey] = { key: targetKey, edges: [], target: edge.target }
    if (!sourceGroups[sourceKey]) sourceGroups[sourceKey] = { key: sourceKey, edges: [], source: edge.source }
    targetGroups[targetKey].edges.push(edge)
    sourceGroups[sourceKey].edges.push(edge)
  })

  const laneOrderByTargetColumn = {}
  Object.values(targetGroups).forEach((group) => {
    const colId = group.edges[0]?.target.columnId
    if (!colId) return
    if (!laneOrderByTargetColumn[colId]) laneOrderByTargetColumn[colId] = []
    laneOrderByTargetColumn[colId].push(group)
  })

  Object.values(laneOrderByTargetColumn).forEach((list) => {
    list.sort((a, b) => {
      const ay = a.edges[0]?.targetAnchor?.y ?? 0
      const by = b.edges[0]?.targetAnchor?.y ?? 0
      return ay - by
    })
  })

  const routes = []
  const debug = []

  edges.forEach((edge) => {
    const targetKey = `T:${edge.target.id}:${edge.direction}`
    const sourceKey = `S:${edge.source.id}:${edge.direction}`
    const targetGroup = targetGroups[targetKey]
    const sourceGroup = sourceGroups[sourceKey]
    const useTargetGrouping = targetGroup?.edges.length >= 2
    const useSourceGrouping = !useTargetGrouping && sourceGroup?.edges.length >= 2

    let junction = null
    let laneIndex = 0
    if (useTargetGrouping) {
      const group = targetGroup
      const sourceBoundary = boundaries?.[edge.source.columnId]?.right
      const targetBoundary = boundaries?.[edge.target.columnId]?.left
      const reverseTargetBoundary = boundaries?.[edge.target.columnId]?.right
      const sourceSide = edge.direction === 'ltr' ? sourceBoundary : boundaries?.[edge.source.columnId]?.left
      const targetSide = edge.direction === 'ltr' ? targetBoundary : reverseTargetBoundary
      junction = junctionForGroup(group.edges, sourceSide, targetSide)
      laneIndex = laneOrderByTargetColumn[edge.target.columnId]?.indexOf(group) ?? 0
      debug.push({ targetId: edge.target.id, junction })
    } else if (useSourceGrouping) {
      const group = sourceGroup
      const sourceBoundary = boundaries?.[edge.source.columnId]?.right
      const sourceBoundaryLeft = boundaries?.[edge.source.columnId]?.left
      const targetBoundary = boundaries?.[edge.target.columnId]?.left
      const targetBoundaryRight = boundaries?.[edge.target.columnId]?.right
      const sourceSide = edge.direction === 'ltr' ? sourceBoundary : sourceBoundaryLeft
      const targetSide = edge.direction === 'ltr' ? targetBoundary : targetBoundaryRight
      junction = junctionForGroup(group.edges, sourceSide, targetSide)
    }

    const route = buildRoute(edge, junction, boundaries, laneIndex)
    if (route) routes.push(route)
  })

  return { routes, debug }
}
