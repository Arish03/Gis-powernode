"""Hybrid tree spatial matching.

Matches trees across timelines using a centroid proximity check (haversine /
degree-equivalent radius) and disambiguates ties via bbox IoU computed from
the 4 corner lat/lon columns stored on `Tree`.

Pure module: no FastAPI / Celery imports. Accepts plain Python data so it is
trivially unit-testable.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple


@dataclass
class TreePoint:
    """Lightweight tree tuple used by the matcher. All fields optional except id+lat+lon."""
    id: str
    latitude: float
    longitude: float
    bbox: Optional[Tuple[float, float, float, float]] = None  # (lat_min, lon_min, lat_max, lon_max)
    height_m: Optional[float] = None
    health_status: Optional[str] = None


@dataclass
class Match:
    baseline_id: Optional[str]
    candidate_id: Optional[str]
    distance_m: Optional[float]
    iou: Optional[float]
    reason: str  # "radius" | "iou" | "missing" | "new"


_EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in metres."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _normalise_bbox(tree) -> Optional[Tuple[float, float, float, float]]:
    """Build (lat_min, lon_min, lat_max, lon_max) from a Tree-like object.
    Accepts either a `TreePoint` with bbox tuple or an ORM Tree with bbox_* columns.
    """
    if isinstance(tree, TreePoint):
        return tree.bbox
    lats = [getattr(tree, n, None) for n in ("bbox_tl_lat", "bbox_tr_lat", "bbox_br_lat", "bbox_bl_lat")]
    lons = [getattr(tree, n, None) for n in ("bbox_tl_lon", "bbox_tr_lon", "bbox_br_lon", "bbox_bl_lon")]
    if any(v is None for v in lats + lons):
        return None
    return (min(lats), min(lons), max(lats), max(lons))


def _bbox_iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    """IoU of two axis-aligned bboxes given as (lat_min, lon_min, lat_max, lon_max).
    Uses raw degree space — adequate for small project areas where 1°lat ≈ 1°lon."""
    a_lat_min, a_lon_min, a_lat_max, a_lon_max = a
    b_lat_min, b_lon_min, b_lat_max, b_lon_max = b
    inter_lat = max(0.0, min(a_lat_max, b_lat_max) - max(a_lat_min, b_lat_min))
    inter_lon = max(0.0, min(a_lon_max, b_lon_max) - max(a_lon_min, b_lon_min))
    inter = inter_lat * inter_lon
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a_lat_max - a_lat_min) * max(0.0, a_lon_max - a_lon_min)
    area_b = max(0.0, b_lat_max - b_lat_min) * max(0.0, b_lon_max - b_lon_min)
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return inter / union


def _to_point(tree) -> TreePoint:
    if isinstance(tree, TreePoint):
        return tree
    return TreePoint(
        id=str(getattr(tree, "id")),
        latitude=float(getattr(tree, "latitude")),
        longitude=float(getattr(tree, "longitude")),
        bbox=_normalise_bbox(tree),
        height_m=getattr(tree, "height_m", None),
        health_status=(
            getattr(tree, "health_status").value
            if getattr(tree, "health_status", None) is not None
            and hasattr(getattr(tree, "health_status"), "value")
            else getattr(tree, "health_status", None)
        ),
    )


def match_trees_hybrid(
    baseline_trees: Sequence,
    candidate_trees: Sequence,
    radius_m: float = 1.5,
    iou_threshold: float = 0.3,
) -> List[Match]:
    """Match each baseline tree to at most one candidate tree.

    1. Compute all (baseline, candidate) pairs where haversine distance ≤ radius_m.
    2. For each pair, compute bbox IoU (0 if either bbox missing).
    3. Greedy one-to-one assignment: sort pairs by (iou desc, distance asc); assign
       unless either endpoint is already claimed. Reject pairs where iou==0 AND
       multiple candidates were within radius (ambiguous) — but single within-radius
       pairs are still accepted via the distance fallback.
    4. Unmatched baseline → Match(missing). Unmatched candidate → Match(new).
    """
    baseline_points = [_to_point(t) for t in baseline_trees]
    candidate_points = [_to_point(t) for t in candidate_trees]

    # Build candidate list per baseline (within radius)
    neighbours: dict[str, list[Tuple[str, float, float]]] = {bp.id: [] for bp in baseline_points}
    for bp in baseline_points:
        for cp in candidate_points:
            d = haversine_m(bp.latitude, bp.longitude, cp.latitude, cp.longitude)
            if d <= radius_m:
                iou = 0.0
                if bp.bbox is not None and cp.bbox is not None:
                    iou = _bbox_iou(bp.bbox, cp.bbox)
                neighbours[bp.id].append((cp.id, d, iou))

    # Build ranked edge list
    edges: list[Tuple[str, str, float, float, bool]] = []  # (b_id, c_id, dist, iou, ambiguous)
    for bp in baseline_points:
        cands = neighbours[bp.id]
        ambiguous = len(cands) > 1
        for c_id, d, iou in cands:
            edges.append((bp.id, c_id, d, iou, ambiguous))

    # Sort: highest IoU first; ties broken by smaller distance
    edges.sort(key=lambda e: (-e[3], e[2]))

    matches: List[Match] = []
    claimed_b: set[str] = set()
    claimed_c: set[str] = set()

    for b_id, c_id, dist, iou, ambiguous in edges:
        if b_id in claimed_b or c_id in claimed_c:
            continue
        # Disambiguation rule: if multiple candidates and none pass IoU threshold, skip
        if ambiguous and iou < iou_threshold:
            continue
        reason = "iou" if iou >= iou_threshold else "radius"
        matches.append(Match(baseline_id=b_id, candidate_id=c_id, distance_m=dist, iou=iou, reason=reason))
        claimed_b.add(b_id)
        claimed_c.add(c_id)

    for bp in baseline_points:
        if bp.id not in claimed_b:
            matches.append(Match(baseline_id=bp.id, candidate_id=None, distance_m=None, iou=None, reason="missing"))
    for cp in candidate_points:
        if cp.id not in claimed_c:
            matches.append(Match(baseline_id=None, candidate_id=cp.id, distance_m=None, iou=None, reason="new"))

    return matches
