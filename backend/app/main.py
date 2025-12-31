from math import atan2, cos, sin
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .models import (
    CreateDiagramRequest,
    CreateTemplateRequest,
    Column,
    Diagram,
    DiagramSummary,
    TemplateItem,
    TemplateSet,
)
from .storage import (
    create_diagram,
    create_template,
    delete_diagram,
    delete_template,
    duplicate_diagram,
    ensure_storage,
    get_diagram,
    get_template,
    list_diagrams,
    list_templates,
    save_diagram,
    save_template,
    search_templates,
    DATA_DIR,
)

try:
    import reportlab  # type: ignore # noqa: F401
    from reportlab.lib import colors  # type: ignore
    from reportlab.lib.pagesizes import A4, landscape  # type: ignore
    from reportlab.pdfgen import canvas  # type: ignore
except Exception:  # pragma: no cover
    reportlab = None  # type: ignore
    colors = None  # type: ignore
    A4 = None  # type: ignore
    canvas = None  # type: ignore

app = FastAPI(title="Essential Facts Block Diagram API")


CANVAS_PADDING = 20
COLUMN_WIDTH = 320
COLUMN_GAP = 14
COLUMN_PADDING = 10
ROW_HEIGHT = 140
NODE_PADDING = 10
TITLE_HEIGHT = 18
ITEM_LINE_HEIGHT = 20

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _diagram_dimensions(diagram: Diagram) -> Tuple[float, float, List[Column]]:
    sorted_columns = sorted(diagram.columns, key=lambda c: c.order)
    max_row = max([node.row for node in diagram.nodes], default=-1)
    total_rows = max(diagram.rowCount, max_row + 1, 1)
    width = CANVAS_PADDING * 2 + len(sorted_columns) * COLUMN_WIDTH
    if len(sorted_columns) > 1:
        width += (len(sorted_columns) - 1) * COLUMN_GAP
    height = CANVAS_PADDING * 2 + total_rows * ROW_HEIGHT
    return width, height, sorted_columns


def _column_positions(column_ids: List[str]) -> Dict[str, float]:
    positions: Dict[str, float] = {}
    for idx, column_id in enumerate(column_ids):
        positions[column_id] = CANVAS_PADDING + idx * (COLUMN_WIDTH + COLUMN_GAP)
    return positions


def _row_midlines(total_rows: int) -> List[float]:
    return [CANVAS_PADDING + row * ROW_HEIGHT + ROW_HEIGHT / 2 for row in range(total_rows)]


def _route_single_edge(from_pt: Dict[str, float], to_pt: Dict[str, float]) -> List[Dict[str, float]]:
    if not from_pt or not to_pt:
        return []
    if from_pt["x"] == to_pt["x"] or from_pt["y"] == to_pt["y"]:
        return [from_pt, to_pt]
    return [from_pt, {"x": from_pt["x"], "y": to_pt["y"]}, to_pt]


def _build_routes(
    diagram: Diagram,
    column_ids: List[str],
    boundaries: Dict[str, Tuple[float, float]],
    row_midlines: List[float],
) -> Tuple[List[Dict], List[Dict]]:
    if not row_midlines:
        return [], []

    column_order = {cid: idx for idx, cid in enumerate(column_ids)}
    node_by_id = {node.id: node for node in diagram.nodes}
    port_by_node: Dict[str, Dict[str, Dict[str, float]]] = {}
    for node in diagram.nodes:
        boundary = boundaries.get(node.columnId)
        if not boundary:
            continue
        row_y = row_midlines[node.row] if node.row < len(row_midlines) else row_midlines[-1]
        port_by_node[node.id] = {
            "inPort": {"x": boundary[0], "y": row_y},
            "outPort": {"x": boundary[1], "y": row_y},
        }

    grouped: Dict[str, Dict[str, object]] = {}
    for edge in diagram.edges:
        source = node_by_id.get(edge.fromNodeId)
        target = node_by_id.get(edge.toNodeId)
        if not source or not target:
            continue
        direction = (
            edge.direction
            if edge.direction and edge.direction != "auto"
            else ("ltr" if column_order.get(source.columnId, 0) <= column_order.get(target.columnId, 0) else "rtl")
        )
        source_port = port_by_node.get(source.id, {}).get("outPort" if direction == "ltr" else "inPort")
        target_port = port_by_node.get(target.id, {}).get("inPort" if direction == "ltr" else "outPort")
        if not source_port or not target_port:
            continue
        key = f"{target.id}-{direction}"
        if key not in grouped:
            grouped[key] = {"target": target, "direction": direction, "edges": []}
        grouped[key]["edges"].append({"edge": edge, "sourcePort": source_port, "targetPort": target_port})

    routes: List[Dict] = []
    merge_dots: List[Dict] = []

    for group in grouped.values():
        target = group["target"]  # type: ignore[assignment]
        direction = group["direction"]  # type: ignore[assignment]
        edges: List[Dict[str, object]] = group["edges"]  # type: ignore[assignment]

        if len(edges) == 1:
            single = edges[0]
            points = _route_single_edge(single["sourcePort"], single["targetPort"])
            routes.append({"id": single["edge"].id, "points": points, "markerEnd": True})
            continue

        candidate_x = (
            port_by_node.get(target.id, {}).get("inPort", {}).get("x")
            if direction == "ltr"
            else port_by_node.get(target.id, {}).get("outPort", {}).get("x")
        )
        if candidate_x is None:
            continue

        best = None
        target_y = (
            port_by_node.get(target.id, {}).get("inPort", {}).get("y")
            if direction == "ltr"
            else port_by_node.get(target.id, {}).get("outPort", {}).get("y")
        )
        for y in row_midlines:
            cost = abs((target_y or y) - y)
            for item in edges:
                cost += abs(item["sourcePort"]["x"] - candidate_x) + abs(item["sourcePort"]["y"] - y)
            if not best or cost < best["cost"] or (cost == best["cost"] and y < best["y"]):
                best = {"y": y, "cost": cost}

        merge_point = {"x": candidate_x, "y": best["y"] if best else row_midlines[0]}
        merge_dots.append(merge_point)

        trunk_target = (
            port_by_node.get(target.id, {}).get("inPort")
            if direction == "ltr"
            else port_by_node.get(target.id, {}).get("outPort")
        )
        trunk_points = _route_single_edge(merge_point, trunk_target)
        routes.append({"id": f"{target.id}-{direction}-trunk", "points": trunk_points, "markerEnd": True})

        for item in edges:
            branch_points = _route_single_edge(item["sourcePort"], merge_point)
            routes.append({"id": item["edge"].id, "points": branch_points, "markerEnd": False})

    return routes, merge_dots


def _build_segments(routes: List[Dict]) -> List[Dict[str, object]]:
    segments: List[Dict[str, object]] = []
    for route in routes:
        pts = route["points"]
        for idx in range(len(pts) - 1):
            p1, p2 = pts[idx], pts[idx + 1]
            segments.append({
                "routeId": route["id"],
                "horizontal": p1["y"] == p2["y"],
                "x1": p1["x"],
                "x2": p2["x"],
                "y1": p1["y"],
                "y2": p2["y"],
            })
    return segments


def _find_jumpers(routes: List[Dict]) -> List[Dict[str, float]]:
    segments = _build_segments(routes)
    jumpers: List[Dict[str, float]] = []
    for i, a in enumerate(segments):
        for b in segments[i + 1 :]:
            if a["routeId"] == b["routeId"]:
                continue
            if a["horizontal"] == b["horizontal"]:
                continue
            h, v = (a, b) if a["horizontal"] else (b, a)
            min_x, max_x = sorted([h["x1"], h["x2"]])
            min_y, max_y = sorted([v["y1"], v["y2"]])
            if min_x < v["x1"] < max_x and min_y < h["y1"] < max_y:
                jumpers.append({"x": v["x1"], "y": h["y1"]})
    return jumpers


def _draw_arrowhead(pdf: canvas.Canvas, start: Dict[str, float], end: Dict[str, float], size: float = 8.0) -> None:
    angle = atan2(end["y"] - start["y"], end["x"] - start["x"])
    left = (end["x"] - size * cos(angle - 0.4), end["y"] - size * sin(angle - 0.4))
    right = (end["x"] - size * cos(angle + 0.4), end["y"] - size * sin(angle + 0.4))
    pdf.line(end["x"], end["y"], left[0], left[1])
    pdf.line(end["x"], end["y"], right[0], right[1])


def _render_pdf(diagram: Diagram, pdf_path: Path) -> Path:
    width, height, sorted_columns = _diagram_dimensions(diagram)
    if reportlab is None or canvas is None or colors is None or A4 is None:
        raise HTTPException(status_code=503, detail="PDF engine unavailable")

    total_rows = max(diagram.rowCount, max([n.row for n in diagram.nodes], default=-1) + 1, 1)
    row_midlines = _row_midlines(total_rows)
    column_ids = [c.id for c in sorted_columns]
    boundaries = {cid: (x, x + COLUMN_WIDTH) for cid, x in _column_positions(column_ids).items()}
    routes, merge_dots = _build_routes(diagram, column_ids, boundaries, row_midlines)
    jumpers = _find_jumpers(routes)

    pdf = canvas.Canvas(str(pdf_path), pagesize=landscape(A4))
    page_width, page_height = landscape(A4)
    margin = 36
    scale = min((page_width - margin * 2) / width, (page_height - margin * 2) / height, 1)

    pdf.translate(margin, margin)
    pdf.scale(scale, scale)

    pdf.setStrokeColor(colors.lightgrey)
    pdf.setLineWidth(0.8)
    for row in range(total_rows + 1):
        y = CANVAS_PADDING + row * ROW_HEIGHT
        pdf.line(CANVAS_PADDING, y, width - CANVAS_PADDING, y)

    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(CANVAS_PADDING, height - CANVAS_PADDING + 12, diagram.name)

    pdf.setStrokeColor(colors.HexColor("#cbd5e1"))
    pdf.setFillColor(colors.HexColor("#f8fafc"))
    for column in sorted_columns:
        x = boundaries[column.id][0]
        pdf.roundRect(x, CANVAS_PADDING, COLUMN_WIDTH, height - CANVAS_PADDING * 2, 10, stroke=1, fill=0)
        pdf.setFillColor(colors.HexColor("#e2e8f0"))
        pdf.roundRect(x + COLUMN_PADDING, height - CANVAS_PADDING - 40, COLUMN_WIDTH - COLUMN_PADDING * 2, 30, 8, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.drawString(x + COLUMN_PADDING + 6, height - CANVAS_PADDING - 22, column.title)

    pdf.setFillColor(colors.white)
    pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
    for node in diagram.nodes:
        col_x = boundaries.get(node.columnId, (CANVAS_PADDING, CANVAS_PADDING))[0]
        row_top = CANVAS_PADDING + node.row * ROW_HEIGHT
        node_height = NODE_PADDING * 2 + TITLE_HEIGHT + len(node.items) * ITEM_LINE_HEIGHT
        y = row_top + (ROW_HEIGHT - node_height) / 2
        node_width = COLUMN_WIDTH - COLUMN_PADDING * 2
        x = col_x + COLUMN_PADDING
        pdf.roundRect(x, y, node_width, node_height, 8, stroke=1, fill=1)
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(x + NODE_PADDING, y + node_height - NODE_PADDING - 6, node.title)
        pdf.setFont("Helvetica", 11)
        for idx, item in enumerate(node.items):
            iy = y + node_height - NODE_PADDING - TITLE_HEIGHT - (idx + 1) * ITEM_LINE_HEIGHT
            pdf.drawString(x + NODE_PADDING + 26, iy + 4, item.text)
            pdf.drawString(x + NODE_PADDING, iy + 4, {"circle": "〇", "triangle": "△", "cross": "×", "ken": "顕"}.get(item.mark, ""))

    pdf.setStrokeColor(colors.HexColor("#475569"))
    pdf.setLineWidth(2.2)
    for route in routes:
        pts = route["points"]
        path = pdf.beginPath()
        path.moveTo(pts[0]["x"], pts[0]["y"])
        for pt in pts[1:]:
            path.lineTo(pt["x"], pt["y"])
        pdf.drawPath(path)
        if route["markerEnd"] and len(pts) >= 2:
            _draw_arrowhead(pdf, pts[-2], pts[-1])

    pdf.setFillColor(colors.HexColor("#475569"))
    for dot in merge_dots:
        pdf.circle(dot["x"], dot["y"], 3, stroke=0, fill=1)

    pdf.setStrokeColor(colors.HexColor("#475569"))
    for jumper in jumpers:
        pdf.arc(jumper["x"] - 6, jumper["y"] - 6, jumper["x"] + 6, jumper["y"] + 6, startAng=270, extent=180)

    pdf.showPage()
    pdf.save()
    return pdf_path


@app.on_event("startup")
def initialize_storage() -> None:
    ensure_storage()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/diagrams", response_model=List[DiagramSummary])
def diagrams() -> List[DiagramSummary]:
    return list_diagrams()


@app.post("/api/diagrams", response_model=Diagram)
def create_diagram_endpoint(payload: CreateDiagramRequest) -> Diagram:
    return create_diagram(
        payload.name,
        columns=payload.columns,
        nodes=payload.nodes,
        edges=payload.edges,
        row_count=payload.rowCount,
    )


@app.get("/api/diagrams/{diagram_id}", response_model=Diagram)
def get_diagram_endpoint(diagram_id: str) -> Diagram:
    try:
        return get_diagram(diagram_id)
    except KeyError as exc:  # pragma: no cover - runtime protection
        raise HTTPException(status_code=404, detail="Diagram not found") from exc


@app.put("/api/diagrams/{diagram_id}", response_model=Diagram)
def save_diagram_endpoint(diagram_id: str, diagram: Diagram) -> Diagram:
    if diagram.id != diagram_id:
        raise HTTPException(status_code=400, detail="Mismatched diagram id")
    return save_diagram(diagram)


@app.delete("/api/diagrams/{diagram_id}")
def delete_diagram_endpoint(diagram_id: str) -> dict:
    delete_diagram(diagram_id)
    return {"status": "deleted", "id": diagram_id}


@app.post("/api/diagrams/{diagram_id}/duplicate", response_model=Diagram)
def duplicate_diagram_endpoint(diagram_id: str, payload: Optional[dict] = None) -> Diagram:
    name = (payload or {}).get("name") if payload else None
    return duplicate_diagram(diagram_id, name=name)


@app.post("/api/diagrams/{diagram_id}/export/pdf")
def export_pdf(diagram_id: str):
    try:
        diagram = get_diagram(diagram_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Diagram not found") from exc

    pdf_dir = DATA_DIR / "pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    safe_name = diagram.name.replace(" ", "_") or "diagram"
    pdf_path = pdf_dir / f"{safe_name}_{diagram.id}.pdf"

    generated = _render_pdf(diagram, pdf_path)
    return FileResponse(generated, filename=f"{safe_name}.pdf")


@app.get("/api/templates", response_model=List[TemplateSet])
def list_templates_endpoint(query: Optional[str] = Query(default=None, alias="query")) -> List[TemplateSet]:
    return list_templates(query=query)


@app.post("/api/templates", response_model=TemplateSet)
def create_template_endpoint(template: CreateTemplateRequest) -> TemplateSet:
    return create_template(template.name, template.nodeTitle, template.items)


@app.get("/api/templates/{template_id}", response_model=TemplateSet)
def get_template_endpoint(template_id: str) -> TemplateSet:
    try:
        return get_template(template_id)
    except KeyError as exc:  # pragma: no cover - runtime protection
        raise HTTPException(status_code=404, detail="Template not found") from exc


@app.delete("/api/templates/{template_id}")
def delete_template_endpoint(template_id: str) -> dict:
    delete_template(template_id)
    return {"status": "deleted", "id": template_id}


@app.get("/api/templates/search", response_model=List[TemplateSet])
def search_templates_endpoint(q: str) -> List[TemplateSet]:
    return search_templates(q)


@app.post("/api/templates/from-node", response_model=TemplateSet)
def create_template_from_node(payload: dict) -> TemplateSet:
    name = payload.get("name")
    node_title = payload.get("nodeTitle") or payload.get("title")
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items must be a list")
    template_items = [TemplateItem(**item) if isinstance(item, dict) else item for item in items]
    return create_template(
        name=name or node_title or "Template",
        node_title=node_title or name or "Template",
        items=template_items,
    )


@app.get("/")
def root() -> dict:
    return {"message": "Essential Facts Block Diagram API"}
