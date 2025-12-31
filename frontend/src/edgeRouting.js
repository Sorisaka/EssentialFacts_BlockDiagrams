const LANE_SPACING = 10
const SPLIT_OFFSET_X = 32
const MERGE_OFFSET_X = 32

const dedupePoints = (points) =>
  points.filter((p, idx) => {
    if (idx === 0) return true
    const prev = points[idx - 1]
    return prev.x !== p.x || prev.y !== p.y
  })

const nextLaneOffset = (index) => index * LANE_SPACING

const anchorInfoForRect = (rect) => {
  const centerY = (rect.top + rect.bottom) / 2
  return {
    inAnchor: { x: rect.left, y: centerY },
    outAnchor: { x: rect.right, y: centerY },
    splitJunction: { x: rect.right + SPLIT_OFFSET_X, y: centerY },
    mergeJunction: { x: rect.left - MERGE_OFFSET_X, y: centerY },
  }
}

const buildRoute = (edge, anchorMap, boundaries, laneIndex, useSplit, useMerge) => {
  const sourceAnchors = anchorMap[edge.source.id]
  const targetAnchors = anchorMap[edge.target.id]
  if (!sourceAnchors || !targetAnchors) return null

  const sourceAnchor = sourceAnchors.outAnchor
  const targetAnchor = targetAnchors.inAnchor
  const sourceBoundaryX = boundaries?.[edge.source.columnId]?.right ?? sourceAnchor.x
  const targetBoundaryX = boundaries?.[edge.target.columnId]?.left ?? targetAnchor.x

  const split = useSplit ? sourceAnchors.splitJunction : null
  const merge = useMerge ? targetAnchors.mergeJunction : null

  const points = [sourceAnchor]

  if (split) points.push({ x: split.x, y: sourceAnchor.y })

  const exitX = Math.max(sourceBoundaryX, split?.x ?? sourceAnchor.x)
  points.push({ x: exitX, y: sourceAnchor.y })

  const baseMidX = ((merge?.x ?? targetBoundaryX) + exitX) / 2
  const midX = baseMidX + nextLaneOffset(laneIndex)
  points.push({ x: midX, y: sourceAnchor.y })

  const junctionY = merge?.y ?? targetAnchor.y
  points.push({ x: midX, y: junctionY })

  const approachX = merge?.x ?? targetBoundaryX
  points.push({ x: approachX, y: junctionY })

  points.push(targetAnchor)

  return {
    id: edge.edge.id,
    points: dedupePoints(points),
    targetId: edge.target.id,
  }
}

export function computeEdgeRoutes(diagram, columns, nodeRects, boundaries) {
  if (!diagram || !columns?.length) return { routes: [], debug: [] }
  const nodeById = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]))
  const anchorMap = Object.fromEntries(
    Object.entries(nodeRects).map(([nodeId, rect]) => [nodeId, anchorInfoForRect(rect)])
  )
  const edges = []

  diagram.edges.forEach((edge) => {
    const source = nodeById[edge.fromNodeId]
    const target = nodeById[edge.toNodeId]
    if (!source || !target) return
    if (!anchorMap[source.id] || !anchorMap[target.id]) return
    edges.push({ edge, source, target })
  })

  const incomingCounts = {}
  const outgoingCounts = {}
  edges.forEach((edge) => {
    incomingCounts[edge.target.id] = (incomingCounts[edge.target.id] ?? 0) + 1
    outgoingCounts[edge.source.id] = (outgoingCounts[edge.source.id] ?? 0) + 1
  })

  const laneIndexByEdgeId = {}
  const edgesByTargetColumn = {}

  edges.forEach((edge) => {
    const colId = edge.target.columnId
    if (!edgesByTargetColumn[colId]) edgesByTargetColumn[colId] = []
    edgesByTargetColumn[colId].push(edge)
  })

  Object.values(edgesByTargetColumn).forEach((list) => {
    list.sort((a, b) => {
      const targetA = anchorMap[a.target.id]?.inAnchor?.y ?? 0
      const targetB = anchorMap[b.target.id]?.inAnchor?.y ?? 0
      return targetA - targetB
    })
    list.forEach((edge, idx) => {
      laneIndexByEdgeId[edge.edge.id] = idx
    })
  })

  const routes = []
  const debug = []

  edges.forEach((edge) => {
    const laneIndex = laneIndexByEdgeId[edge.edge.id] ?? 0
    const useSplit = outgoingCounts[edge.source.id] > 1
    const useMerge = incomingCounts[edge.target.id] > 1
    const route = buildRoute(edge, anchorMap, boundaries, laneIndex, useSplit, useMerge)
    if (route) routes.push(route)
  })

  return { routes, debug }
}
