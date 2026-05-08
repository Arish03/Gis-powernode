"""Processing Nodes CRUD – admin only."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin
from app.models import ProcessingNode, User
from app.schemas import ProcessingNodeCreate, ProcessingNodeUpdate, ProcessingNodeResponse

router = APIRouter(prefix="/api/processing-nodes", tags=["processing-nodes"])


def _node_to_response(node: ProcessingNode) -> ProcessingNodeResponse:
    return ProcessingNodeResponse(
        id=node.id,
        hostname=node.hostname,
        port=node.port,
        api_version=node.api_version,
        queue_count=node.queue_count,
        max_images=node.max_images,
        available_options=node.available_options,
        label=node.label,
        engine_version=node.engine_version,
        online=node.is_online(),
        token=node.token,
        last_refreshed=node.last_refreshed,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.get("/", response_model=list[ProcessingNodeResponse])
def list_nodes(
    has_available_options: bool = Query(False),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = db.query(ProcessingNode)
    if has_available_options:
        query = query.filter(ProcessingNode.available_options != "[]")
    nodes = query.order_by(ProcessingNode.created_at).all()
    return [_node_to_response(n) for n in nodes]


@router.post("/", response_model=ProcessingNodeResponse, status_code=201)
def create_node(
    body: ProcessingNodeCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = db.query(ProcessingNode).filter(
        ProcessingNode.hostname == body.hostname,
        ProcessingNode.port == body.port,
    ).first()
    if existing:
        raise HTTPException(400, f"Node {body.hostname}:{body.port} already exists")

    node = ProcessingNode(
        hostname=body.hostname,
        port=body.port,
        label=body.label or "",
        token=body.token or "",
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    # Try to fetch node info in-line (best-effort)
    node.update_node_info()
    db.commit()
    db.refresh(node)

    return _node_to_response(node)


@router.get("/options/")
def get_common_options(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return intersection of available_options across all online nodes."""
    from datetime import datetime, timedelta
    from app.models import NODE_OFFLINE_MINUTES

    cutoff = datetime.utcnow() - timedelta(minutes=NODE_OFFLINE_MINUTES)
    online_nodes = db.query(ProcessingNode).filter(
        ProcessingNode.last_refreshed >= cutoff
    ).all()

    if not online_nodes:
        return []

    # Intersect by option name
    option_sets = []
    for node in online_nodes:
        try:
            opts = json.loads(node.available_options) if node.available_options else []
        except (json.JSONDecodeError, TypeError):
            opts = []
        option_sets.append({o.get("name") for o in opts if isinstance(o, dict)})

    common_names = option_sets[0]
    for s in option_sets[1:]:
        common_names &= s

    # Return full option objects from first node for common names
    first_opts = json.loads(online_nodes[0].available_options) if online_nodes[0].available_options else []
    return [o for o in first_opts if isinstance(o, dict) and o.get("name") in common_names]


@router.get("/{node_id}", response_model=ProcessingNodeResponse)
def get_node(
    node_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    node = db.query(ProcessingNode).filter(ProcessingNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "Processing node not found")
    return _node_to_response(node)


@router.put("/{node_id}", response_model=ProcessingNodeResponse)
def update_node(
    node_id: UUID,
    body: ProcessingNodeUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    node = db.query(ProcessingNode).filter(ProcessingNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "Processing node not found")

    if body.hostname is not None:
        node.hostname = body.hostname
    if body.port is not None:
        node.port = body.port
    if body.label is not None:
        node.label = body.label
    if body.token is not None:
        node.token = body.token

    db.commit()

    # Re-fetch node info after update
    node.update_node_info()
    db.commit()
    db.refresh(node)

    return _node_to_response(node)


@router.post("/{node_id}/test", response_model=ProcessingNodeResponse)
def test_node(
    node_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Manually trigger a health check on a single node."""
    node = db.query(ProcessingNode).filter(ProcessingNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "Processing node not found")
    node.update_node_info()
    db.commit()
    db.refresh(node)
    return _node_to_response(node)


@router.delete("/{node_id}", status_code=204)
def delete_node(
    node_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    node = db.query(ProcessingNode).filter(ProcessingNode.id == node_id).first()
    if not node:
        raise HTTPException(404, "Processing node not found")
    db.delete(node)
    db.commit()
