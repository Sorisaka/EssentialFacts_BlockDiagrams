import time
from enum import Enum
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class Mark(str, Enum):
    circle = "circle"
    triangle = "triangle"
    cross = "cross"
    square = "square"
    check = "check"
    ken = "ken"
    none = "none"


class NodeItem(BaseModel):
    id: str
    text: str
    mark: Mark = Mark.none
    label: Optional[str] = None
    note: Optional[str] = None


class Node(BaseModel):
    id: str
    columnId: str
    row: int = 0
    y: float = 0
    title: str
    items: List[NodeItem] = Field(default_factory=list)
    ui: Optional[dict] = None


class Column(BaseModel):
    id: str
    title: str
    order: int


class EdgeStyle(BaseModel):
    label: Optional[str] = None


class Edge(BaseModel):
    id: str
    fromNodeId: str
    toNodeId: str
    fromItemId: Optional[str] = None
    toItemId: Optional[str] = None
    direction: str = "auto"
    style: Optional[EdgeStyle] = None


class Diagram(BaseModel):
    id: str
    name: str
    columns: List[Column] = Field(default_factory=list)
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
    rowCount: int = 0
    createdAt: int
    updatedAt: int


class DiagramSummary(BaseModel):
    id: str
    name: str
    updatedAt: int
    createdAt: int


class TemplateItem(BaseModel):
    text: str
    markDefault: Optional[Mark] = None


class TemplateSet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    nodeTitle: str
    items: List[TemplateItem] = Field(default_factory=list)
    createdAt: int = Field(default_factory=lambda: int(time.time() * 1000))
    updatedAt: int = Field(default_factory=lambda: int(time.time() * 1000))


class CreateDiagramRequest(BaseModel):
    name: str = "Untitled Diagram"
    columns: List[Column] = Field(default_factory=list)
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
    rowCount: int = 0


class CreateTemplateRequest(BaseModel):
    name: str
    nodeTitle: str
    items: List[TemplateItem] = Field(default_factory=list)
