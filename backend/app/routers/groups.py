"""Project Groups — temporal analysis REST API.

All endpoints rooted at /api/groups. Access control mirrors the per-project
rules implemented in routers/projects.py and routers/trees.py.
"""
import json
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin, require_staff
from app.celery_app import redis_client
from app.database import get_db
from app.models import (
    ClientSubAdminAssignment,
    GroupStatus,
    HealthStatus,
    ObservationType,
    Project,
    ProjectGroup,
    ProjectGroupMember,
    ProjectStatus,
    Tree,
    TreeObservation,
    UnifiedTree,
    UnifiedTreeStatus,
    User,
    UserRole,
)
from app.schemas import (
    DeltaKpis,
    GroupAnalyticsResponse,
    GroupMemberResponse,
    GroupStatusResponse,
    ProjectGroupCreate,
    ProjectGroupListResponse,
    ProjectGroupResponse,
    ProjectGroupUpdate,
    SnapshotAnalytics,
    TimeSeriesPoint,
    TreeObservationResponse,
    UnifiedTreeListResponse,
    UnifiedTreeResponse,
    WaterfallBucket,
)

router = APIRouter(prefix="/api/groups", tags=["Project Groups"])
logger = logging.getLogger(__name__)


# ── Access helpers ─────────────────────────────────────────────────────────

def _is_sub_admin_assigned_to_client(db: Session, sub_admin_id: UUID, client_id: Optional[UUID]) -> bool:
    if client_id is None:
        return False
    return db.query(ClientSubAdminAssignment).filter(
        ClientSubAdminAssignment.sub_admin_id == sub_admin_id,
        ClientSubAdminAssignment.client_id == client_id,
    ).first() is not None


def _check_group_access(group_id: UUID, user: User, db: Session) -> ProjectGroup:
    group = db.query(ProjectGroup).filter(ProjectGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if user.role == UserRole.CLIENT:
        if group.client_id != user.id or group.status != GroupStatus.READY:
            raise HTTPException(status_code=403, detail="Access denied")
    elif user.role == UserRole.SUB_ADMIN:
        if not _is_sub_admin_assigned_to_client(db, user.id, group.client_id):
            raise HTTPException(status_code=403, detail="Access denied")
    return group


def _group_to_response(group: ProjectGroup, db: Session, include_members: bool = True) -> ProjectGroupResponse:
    members: List[GroupMemberResponse] = []
    if include_members:
        for m in sorted(group.members, key=lambda x: x.timeline_index):
            proj = m.project
            tree_count = db.query(func.count(Tree.id)).filter(Tree.project_id == m.project_id).scalar() or 0
            members.append(GroupMemberResponse(
                id=m.id,
                project_id=m.project_id,
                project_name=proj.name if proj else None,
                timeline_index=m.timeline_index,
                flight_date=m.flight_date,
                boundary_geojson=proj.boundary_geojson if proj else None,
                area_hectares=proj.area_hectares if proj else None,
                tree_count=tree_count,
            ))
    unified_count = db.query(func.count(UnifiedTree.id)).filter(
        UnifiedTree.group_id == group.id
    ).scalar() or 0
    return ProjectGroupResponse(
        id=group.id,
        name=group.name,
        location=group.location,
        description=group.description,
        client_id=group.client_id,
        client_name=group.client.full_name if group.client else None,
        created_by=group.created_by,
        created_by_name=group.creator.full_name if group.creator else None,
        status=group.status.value,
        processing_error=group.processing_error,
        created_at=group.created_at,
        updated_at=group.updated_at,
        members=members,
        unified_tree_count=unified_count,
    )


# ── CRUD ───────────────────────────────────────────────────────────────────

@router.get("", response_model=ProjectGroupListResponse)
def list_groups(
    client_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(ProjectGroup)
    if user.role == UserRole.CLIENT:
        q = q.filter(ProjectGroup.client_id == user.id,
                     ProjectGroup.status == GroupStatus.READY)
    elif user.role == UserRole.SUB_ADMIN:
        assigned_ids = [
            a.client_id for a in
            db.query(ClientSubAdminAssignment.client_id)
            .filter(ClientSubAdminAssignment.sub_admin_id == user.id).all()
        ]
        q = q.filter(ProjectGroup.client_id.in_(assigned_ids))
    if client_id is not None:
        q = q.filter(ProjectGroup.client_id == client_id)
    groups = q.order_by(ProjectGroup.created_at.desc()).all()
    return ProjectGroupListResponse(
        groups=[_group_to_response(g, db) for g in groups],
        total=len(groups),
    )


@router.post("", response_model=ProjectGroupResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: ProjectGroupCreate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    # Basic shape validation
    if len(payload.project_ids) < 2:
        raise HTTPException(status_code=400, detail="A group requires at least 2 projects")
    if len(set(payload.project_ids)) != len(payload.project_ids):
        raise HTTPException(status_code=400, detail="Duplicate project IDs in the group")

    # Sub-admin authorization: client must be assigned
    if staff.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, staff.id, payload.client_id):
        raise HTTPException(status_code=403, detail="You can only create groups for your assigned clients")

    # Verify client is a CLIENT user
    client = db.query(User).filter(User.id == payload.client_id).first()
    if not client or client.role != UserRole.CLIENT:
        raise HTTPException(status_code=400, detail="client_id must reference a CLIENT user")

    # Fetch projects in the order supplied
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_(payload.project_ids)).all()}
    ordered: List[Project] = []
    for pid in payload.project_ids:
        p = projects.get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail=f"Project {pid} not found")
        ordered.append(p)

    # Constraint: all same client
    if any(p.client_id != payload.client_id for p in ordered):
        raise HTTPException(status_code=400, detail="All projects must belong to the same client")
    # Constraint: all READY
    if any(p.status != ProjectStatus.READY for p in ordered):
        raise HTTPException(status_code=400, detail="All projects must be READY")
    # Constraint: all have non-empty boundary
    if any(not p.boundary_geojson for p in ordered):
        raise HTTPException(status_code=400, detail="All projects must have a boundary defined")

    # Constraint: boundaries must spatially overlap (chain via ST_Intersects)
    # Use PostGIS on the fly — build GeometryCollection per project from geojson.
    def _intersects(a_geojson: str, b_geojson: str) -> bool:
        row = db.execute(text(
            "SELECT ST_Intersects("
            "  ST_SetSRID(ST_GeomFromGeoJSON(:a), 4326),"
            "  ST_SetSRID(ST_GeomFromGeoJSON(:b), 4326)"
            ") AS ok"
        ), {"a": a_geojson, "b": b_geojson}).first()
        return bool(row and row.ok)

    # Normalize boundary_geojson: strip top-level Feature/FeatureCollection wrappers.
    def _geom_only(raw: str) -> str:
        try:
            obj = json.loads(raw)
        except Exception:
            return raw
        t = obj.get("type")
        if t == "Feature":
            return json.dumps(obj.get("geometry", obj))
        if t == "FeatureCollection":
            feats = obj.get("features") or []
            if feats:
                return json.dumps(feats[0].get("geometry", {}))
        return raw

    geoms = [_geom_only(p.boundary_geojson) for p in ordered]
    for i in range(len(geoms) - 1):
        try:
            if not _intersects(geoms[i], geoms[i + 1]):
                raise HTTPException(
                    status_code=400,
                    detail=f"Boundaries must overlap (project {ordered[i].name} and {ordered[i+1].name} do not intersect)",
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning(f"ST_Intersects check failed: {exc}")
            raise HTTPException(status_code=400, detail=f"Could not validate boundary overlap: {exc}")

    # Create group + members in one transaction
    group = ProjectGroup(
        name=payload.name,
        location=payload.location,
        description=payload.description,
        client_id=payload.client_id,
        created_by=staff.id,
        status=GroupStatus.PROCESSING,
    )
    db.add(group)
    db.flush()

    dates = payload.flight_dates or []
    for idx, proj in enumerate(ordered):
        flight_date = None
        if idx < len(dates):
            flight_date = dates[idx]
        if flight_date is None:
            # Default to project created_at for monotonic ordering
            flight_date = proj.created_at
        db.add(ProjectGroupMember(
            group_id=group.id,
            project_id=proj.id,
            timeline_index=idx,
            flight_date=flight_date,
        ))
    db.commit()
    db.refresh(group)

    # Dispatch the matching task
    try:
        from app.tasks import build_unified_trees
        build_unified_trees.delay(str(group.id))
    except Exception as exc:
        logger.error(f"Could not enqueue build_unified_trees: {exc}")
        group.status = GroupStatus.ERROR
        group.processing_error = f"Failed to enqueue matching task: {exc}"
        db.commit()

    return _group_to_response(group, db)


@router.get("/{group_id}", response_model=ProjectGroupResponse)
def get_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _check_group_access(group_id, user, db)
    return _group_to_response(group, db)


@router.put("/{group_id}", response_model=ProjectGroupResponse)
def update_group(
    group_id: UUID,
    payload: ProjectGroupUpdate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    group = db.query(ProjectGroup).filter(ProjectGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if staff.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, staff.id, group.client_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if payload.name is not None:
        group.name = payload.name
    if payload.location is not None:
        group.location = payload.location
    if payload.description is not None:
        group.description = payload.description
    group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    return _group_to_response(group, db)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    group = db.query(ProjectGroup).filter(ProjectGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()
    return


@router.post("/{group_id}/recompute", response_model=ProjectGroupResponse)
def recompute_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    group = db.query(ProjectGroup).filter(ProjectGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if staff.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, staff.id, group.client_id):
        raise HTTPException(status_code=403, detail="Access denied")
    group.status = GroupStatus.PROCESSING
    group.processing_error = None
    db.commit()
    try:
        from app.tasks import build_unified_trees
        build_unified_trees.delay(str(group.id))
    except Exception as exc:
        group.status = GroupStatus.ERROR
        group.processing_error = str(exc)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Could not enqueue: {exc}")
    return _group_to_response(group, db)


@router.get("/{group_id}/status", response_model=GroupStatusResponse)
def get_group_status(
    group_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Staff see any group; clients only READY own groups — but status polling
    # should work while PROCESSING for owners too. Relax: allow clients to poll
    # status of their own groups regardless of status.
    group = db.query(ProjectGroup).filter(ProjectGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if user.role == UserRole.CLIENT and group.client_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, user.id, group.client_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Poll Redis first for live progress
    redis_key = f"group_progress:{group_id}"
    try:
        raw = redis_client.get(redis_key)
    except Exception:
        raw = None
    if raw:
        try:
            payload = json.loads(raw)
            return GroupStatusResponse(
                group_id=group_id,
                status=payload.get("status", group.status.value),
                progress=payload.get("progress"),
                message=payload.get("message"),
                error=payload.get("error"),
            )
        except Exception:
            pass
    return GroupStatusResponse(
        group_id=group_id,
        status=group.status.value,
        progress=100 if group.status == GroupStatus.READY else (0 if group.status == GroupStatus.ERROR else None),
        error=group.processing_error,
    )


# ── Unified tree listings ──────────────────────────────────────────────────

def _observation_to_response(obs: TreeObservation) -> TreeObservationResponse:
    return TreeObservationResponse(
        id=obs.id,
        timeline_index=obs.timeline_index,
        project_id=obs.project_id,
        tree_id=obs.tree_id,
        observation_type=obs.observation_type.value,
        height_m=obs.height_m,
        health_status=obs.health_status.value if obs.health_status else None,
        latitude=obs.latitude,
        longitude=obs.longitude,
    )


def _unified_to_response(ut: UnifiedTree) -> UnifiedTreeResponse:
    return UnifiedTreeResponse(
        id=ut.id,
        unified_index=ut.unified_index,
        baseline_latitude=ut.baseline_latitude,
        baseline_longitude=ut.baseline_longitude,
        first_seen_timeline_index=ut.first_seen_timeline_index,
        last_seen_timeline_index=ut.last_seen_timeline_index,
        current_status=ut.current_status.value,
        observations=[_observation_to_response(o) for o in ut.observations],
    )


@router.get("/{group_id}/unified-trees")
def get_unified_trees_geojson(
    group_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_group_access(group_id, user, db)
    uts = (
        db.query(UnifiedTree)
        .filter(UnifiedTree.group_id == group_id)
        .order_by(UnifiedTree.unified_index)
        .all()
    )
    features = []
    for ut in uts:
        if ut.baseline_latitude is None or ut.baseline_longitude is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [ut.baseline_longitude, ut.baseline_latitude],
            },
            "properties": {
                "id": str(ut.id),
                "unified_index": ut.unified_index,
                "current_status": ut.current_status.value,
                "first_seen_timeline_index": ut.first_seen_timeline_index,
                "last_seen_timeline_index": ut.last_seen_timeline_index,
                "observations": [
                    {
                        "timeline_index": o.timeline_index,
                        "observation_type": o.observation_type.value,
                        "project_id": str(o.project_id),
                        "tree_id": str(o.tree_id) if o.tree_id else None,
                        "height_m": o.height_m,
                        "health_status": o.health_status.value if o.health_status else None,
                        "latitude": o.latitude,
                        "longitude": o.longitude,
                    }
                    for o in ut.observations
                ],
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/{group_id}/unified-trees/list", response_model=UnifiedTreeListResponse)
def list_unified_trees(
    group_id: UUID,
    current_status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_group_access(group_id, user, db)
    q = db.query(UnifiedTree).filter(UnifiedTree.group_id == group_id)
    if current_status:
        try:
            q = q.filter(UnifiedTree.current_status == UnifiedTreeStatus(current_status))
        except ValueError:
            pass
    uts = q.order_by(UnifiedTree.unified_index).all()
    return UnifiedTreeListResponse(
        trees=[_unified_to_response(u) for u in uts],
        total=len(uts),
    )


# ── Analytics ──────────────────────────────────────────────────────────────

def _snapshot_for_project(db: Session, project: Project) -> SnapshotAnalytics:
    total = db.query(func.count(Tree.id)).filter(Tree.project_id == project.id).scalar() or 0
    avg_h = db.query(func.avg(Tree.height_m)).filter(Tree.project_id == project.id).scalar()
    healthy = db.query(func.count(Tree.id)).filter(
        Tree.project_id == project.id,
        Tree.health_status == HealthStatus.HEALTHY,
    ).scalar() or 0
    health_score = round((healthy / total) * 100, 1) if total > 0 else None
    return SnapshotAnalytics(
        timeline_index=-1,  # caller sets
        project_id=project.id,
        total_trees=total,
        average_height=round(avg_h, 2) if avg_h else None,
        health_score=health_score,
        area_hectares=project.area_hectares,
    )


@router.get("/{group_id}/analytics", response_model=GroupAnalyticsResponse)
def get_group_analytics(
    group_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = _check_group_access(group_id, user, db)
    members = sorted(group.members, key=lambda m: m.timeline_index)
    if not members:
        raise HTTPException(status_code=400, detail="Group has no members")

    snapshots: List[SnapshotAnalytics] = []
    time_series: List[TimeSeriesPoint] = []
    for m in members:
        snap = _snapshot_for_project(db, m.project)
        snap.timeline_index = m.timeline_index
        snapshots.append(snap)
        time_series.append(TimeSeriesPoint(
            timeline_index=m.timeline_index,
            flight_date=m.flight_date,
            project_id=m.project_id,
            tree_count=snap.total_trees,
            average_height=snap.average_height,
            health_score=snap.health_score,
        ))

    # Waterfall: per consecutive pair, counts of dead/new based on observations
    waterfall: List[WaterfallBucket] = []
    for i in range(len(members) - 1):
        a_idx = members[i].timeline_index
        b_idx = members[i + 1].timeline_index
        # "start" = number of unified trees present at a_idx (DETECTED obs)
        start = db.query(func.count(TreeObservation.id)).filter(
            TreeObservation.timeline_index == a_idx,
            TreeObservation.observation_type == ObservationType.DETECTED,
            TreeObservation.unified_tree_id.in_(
                db.query(UnifiedTree.id).filter(UnifiedTree.group_id == group_id)
            ),
        ).scalar() or 0
        # "dead" = trees alive at a_idx but MISSING at b_idx
        dead = db.query(func.count(TreeObservation.id)).filter(
            TreeObservation.timeline_index == b_idx,
            TreeObservation.observation_type == ObservationType.MISSING,
            TreeObservation.unified_tree_id.in_(
                db.query(UnifiedTree.id).filter(UnifiedTree.group_id == group_id)
            ),
        ).scalar() or 0
        # "new" = NEW observations at b_idx
        new = db.query(func.count(TreeObservation.id)).filter(
            TreeObservation.timeline_index == b_idx,
            TreeObservation.observation_type == ObservationType.NEW,
            TreeObservation.unified_tree_id.in_(
                db.query(UnifiedTree.id).filter(UnifiedTree.group_id == group_id)
            ),
        ).scalar() or 0
        end = start - dead + new
        waterfall.append(WaterfallBucket(
            from_timeline_index=a_idx,
            to_timeline_index=b_idx,
            start=start,
            dead=dead,
            new=new,
            end=end,
        ))

    # Delta KPIs (baseline vs latest)
    first_snap = snapshots[0]
    last_snap = snapshots[-1]
    last_idx = members[-1].timeline_index
    first_idx = members[0].timeline_index
    baseline_count = first_snap.total_trees
    mortality_count = db.query(func.count(TreeObservation.id)).filter(
        TreeObservation.timeline_index == last_idx,
        TreeObservation.observation_type == ObservationType.MISSING,
        TreeObservation.unified_tree_id.in_(
            db.query(UnifiedTree.id).filter(
                UnifiedTree.group_id == group_id,
                UnifiedTree.first_seen_timeline_index == first_idx,
            )
        ),
    ).scalar() or 0
    new_count = db.query(func.count(UnifiedTree.id)).filter(
        UnifiedTree.group_id == group_id,
        UnifiedTree.first_seen_timeline_index > first_idx,
    ).scalar() or 0
    net = (last_snap.total_trees - first_snap.total_trees)
    mortality_rate = round((mortality_count / baseline_count) * 100, 2) if baseline_count else 0.0
    avg_h_delta = None
    if last_snap.average_height is not None and first_snap.average_height is not None:
        avg_h_delta = round(last_snap.average_height - first_snap.average_height, 2)
    hs_delta = None
    if last_snap.health_score is not None and first_snap.health_score is not None:
        hs_delta = round(last_snap.health_score - first_snap.health_score, 2)

    delta = DeltaKpis(
        net_tree_count=net,
        mortality_count=mortality_count,
        new_count=new_count,
        mortality_rate=mortality_rate,
        avg_height_delta=avg_h_delta,
        health_score_delta=hs_delta,
    )

    return GroupAnalyticsResponse(
        group_id=group_id,
        timeline_count=len(members),
        snapshots=snapshots,
        delta_kpis=delta,
        waterfall=waterfall,
        time_series=time_series,
    )
