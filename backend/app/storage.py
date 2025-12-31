import json
import time
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4

from .models import Column, Diagram, DiagramSummary, Edge, Node, TemplateItem, TemplateSet

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DIAGRAM_DIR = DATA_DIR / "diagrams"
TEMPLATE_DIR = DATA_DIR / "templates"
INDEX_FILE = DATA_DIR / "index.json"


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DIAGRAM_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        _atomic_write(INDEX_FILE, {"diagrams": [], "templates": []})


def _atomic_write(path: Path, data: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def _read_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _timestamp() -> int:
    return int(time.time() * 1000)


# Diagram helpers

def _diagram_path(diagram_id: str) -> Path:
    return DIAGRAM_DIR / f"{diagram_id}.json"


def _load_diagram(diagram_id: str) -> Diagram:
    ensure_storage()
    path = _diagram_path(diagram_id)
    if not path.exists():
        raise KeyError(diagram_id)
    return Diagram(**_read_json(path))


def _save_diagram_file(diagram: Diagram) -> Diagram:
    path = _diagram_path(diagram.id)
    _atomic_write(path, diagram.model_dump())
    _update_diagram_index(diagram)
    return diagram


def _update_diagram_index(diagram: Diagram) -> None:
    index = _read_json(INDEX_FILE)
    diagrams = index.get("diagrams", [])
    existing = next((idx for idx, item in enumerate(diagrams) if item["id"] == diagram.id), None)
    summary = {
        "id": diagram.id,
        "name": diagram.name,
        "updatedAt": diagram.updatedAt,
        "createdAt": diagram.createdAt,
    }
    if existing is None:
        diagrams.append(summary)
    else:
        diagrams[existing] = summary
    index["diagrams"] = diagrams
    _atomic_write(INDEX_FILE, index)


def list_diagrams() -> List[DiagramSummary]:
    ensure_storage()
    try:
        index = _read_json(INDEX_FILE)
        diagrams = index.get("diagrams", [])
    except FileNotFoundError:
        diagrams = []
    return [DiagramSummary(**d) for d in diagrams]


def get_diagram(diagram_id: str) -> Diagram:
    return _load_diagram(diagram_id)


def save_diagram(diagram: Diagram) -> Diagram:
    diagram.updatedAt = _timestamp()
    return _save_diagram_file(diagram)


def create_diagram(name: str, columns: Optional[list] = None, nodes: Optional[list] = None, edges: Optional[list] = None, row_count: int = 0) -> Diagram:
    now = _timestamp()
    parsed_columns = [Column(**col) if isinstance(col, dict) else col for col in (columns or [])]
    parsed_nodes = [Node(**node) if isinstance(node, dict) else node for node in (nodes or [])]
    parsed_edges = [Edge(**edge) if isinstance(edge, dict) else edge for edge in (edges or [])]
    diagram = Diagram(
        id=str(uuid4()),
        name=name,
        columns=parsed_columns,
        nodes=parsed_nodes,
        edges=parsed_edges,
        rowCount=row_count,
        createdAt=now,
        updatedAt=now,
    )
    return _save_diagram_file(diagram)


def delete_diagram(diagram_id: str) -> None:
    ensure_storage()
    path = _diagram_path(diagram_id)
    if path.exists():
        path.unlink()
    index = _read_json(INDEX_FILE)
    index["diagrams"] = [d for d in index.get("diagrams", []) if d.get("id") != diagram_id]
    _atomic_write(INDEX_FILE, index)


def duplicate_diagram(diagram_id: str, name: Optional[str] = None) -> Diagram:
    original = _load_diagram(diagram_id)
    now = _timestamp()
    copy = original.model_copy(deep=True)
    copy.id = str(uuid4())
    copy.name = name or f"Copy of {original.name}"
    copy.createdAt = now
    copy.updatedAt = now
    return _save_diagram_file(copy)


# Template helpers

def _template_path(template_id: str) -> Path:
    return TEMPLATE_DIR / f"{template_id}.json"


def _load_template(template_id: str) -> TemplateSet:
    ensure_storage()
    path = _template_path(template_id)
    if not path.exists():
        raise KeyError(template_id)
    return TemplateSet(**_read_json(path))


def _update_template_index(template: TemplateSet) -> None:
    index = _read_json(INDEX_FILE)
    templates = index.get("templates", [])
    summary = {
        "id": template.id,
        "name": template.name,
        "updatedAt": template.updatedAt,
        "createdAt": template.createdAt,
    }
    existing = next((idx for idx, item in enumerate(templates) if item["id"] == template.id), None)
    if existing is None:
        templates.append(summary)
    else:
        templates[existing] = summary
    index["templates"] = templates
    _atomic_write(INDEX_FILE, index)


def list_templates(query: Optional[str] = None) -> List[TemplateSet]:
    ensure_storage()
    templates: List[TemplateSet] = []
    for path in TEMPLATE_DIR.glob("*.json"):
        templates.append(TemplateSet(**_read_json(path)))
    if query:
        q = query.lower()
        templates = [t for t in templates if q in t.name.lower() or q in t.nodeTitle.lower()]
    templates.sort(key=lambda t: t.updatedAt, reverse=True)
    return templates


def get_template(template_id: str) -> TemplateSet:
    return _load_template(template_id)


def save_template(template: TemplateSet) -> TemplateSet:
    template.updatedAt = _timestamp()
    path = _template_path(template.id)
    _atomic_write(path, template.model_dump())
    _update_template_index(template)
    return template


def create_template(name: str, node_title: str, items: List[TemplateItem]) -> TemplateSet:
    now = _timestamp()
    template = TemplateSet(
        id=str(uuid4()),
        name=name,
        nodeTitle=node_title,
        items=items,
        createdAt=now,
        updatedAt=now,
    )
    path = _template_path(template.id)
    _atomic_write(path, template.model_dump())
    _update_template_index(template)
    return template


def delete_template(template_id: str) -> None:
    ensure_storage()
    path = _template_path(template_id)
    if path.exists():
        path.unlink()
    index = _read_json(INDEX_FILE)
    index["templates"] = [t for t in index.get("templates", []) if t.get("id") != template_id]
    _atomic_write(INDEX_FILE, index)


def search_templates(keyword: str) -> List[TemplateSet]:
    return list_templates(query=keyword)
