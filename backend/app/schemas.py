from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from enum import Enum


# ── Auth ──────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── User ──────────────────────────────────────────────────────

class UserRole(str, Enum):
    ADMIN = "ADMIN"
    SUB_ADMIN = "SUB_ADMIN"
    CLIENT = "CLIENT"


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1, max_length=200)
    role: UserRole = UserRole.CLIENT


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=100)
    password: Optional[str] = Field(None, min_length=6)
    full_name: Optional[str] = Field(None, min_length=1, max_length=200)


class UserResponse(BaseModel):
    id: UUID
    username: str
    full_name: str
    role: str
    created_at: datetime
    project_count: Optional[int] = 0
    plain_password: Optional[str] = None

    class Config:
        from_attributes = True


class ClientSubAdminAssignmentsUpdate(BaseModel):
    sub_admin_ids: List[UUID] = []


class SubAdminClientAssignmentsUpdate(BaseModel):
    client_ids: List[UUID] = []


# ── Project ───────────────────────────────────────────────────

class ProjectStatus(str, Enum):
    DRAFT = "DRAFT"
    CREATED = "CREATED"
    UNASSIGNED = "UNASSIGNED"
    UPLOADING = "UPLOADING"
    PROCESSING = "PROCESSING"
    REVIEW_PENDING = "REVIEW_PENDING"
    READY = "READY"
    ERROR = "ERROR"


class ProjectType(str, Enum):
    TREE = "TREE"
    POWERLINE = "POWERLINE"


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = None
    description: Optional[str] = None
    client_id: Optional[UUID] = None
    project_type: ProjectType = ProjectType.TREE


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    client_id: Optional[UUID] = None
    status: Optional[str] = None
    report_summary: Optional[str] = None
    primary_inspector_name: Optional[str] = None


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    location: Optional[str]
    description: Optional[str]
    client_id: Optional[UUID]
    client_name: Optional[str] = None
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    reviewed_by: Optional[UUID] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    last_edited_by: Optional[UUID] = None
    last_edited_by_name: Optional[str] = None
    status: str
    project_type: str = "TREE"
    boundary_geojson: Optional[str] = None
    area_hectares: Optional[float] = None
    created_at: datetime
    updated_at: datetime
    processing_error: Optional[str] = None
    tree_count: Optional[int] = None
    report_summary: Optional[str] = None
    primary_inspector_name: Optional[str] = None

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    projects: List[ProjectResponse]
    total: int


# ── Tree ──────────────────────────────────────────────────────

class TreeResponse(BaseModel):
    id: UUID
    tree_index: int
    height_m: Optional[float]
    health_status: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    confidence: Optional[float] = None
    detection_source: Optional[str] = None
    bbox_tl_lat: Optional[float] = None
    bbox_tl_lon: Optional[float] = None
    bbox_tr_lat: Optional[float] = None
    bbox_tr_lon: Optional[float] = None
    bbox_br_lat: Optional[float] = None
    bbox_br_lon: Optional[float] = None
    bbox_bl_lat: Optional[float] = None
    bbox_bl_lon: Optional[float] = None

    class Config:
        from_attributes = True


class ManualTreeCreate(BaseModel):
    tl_lat: float
    tl_lon: float
    tr_lat: float
    tr_lon: float
    br_lat: float
    br_lon: float
    bl_lat: float
    bl_lon: float


class ManualTreeBboxCreate(BaseModel):
    """Create a manual tree bbox without computing height (just saves the box)."""
    tl_lat: float
    tl_lon: float
    tr_lat: float
    tr_lon: float
    br_lat: float
    br_lon: float
    bl_lat: float
    bl_lon: float


class ManualTreeBboxUpdate(BaseModel):
    """Update bbox position/size for an existing manual tree."""
    tl_lat: float
    tl_lon: float
    tr_lat: float
    tr_lon: float
    br_lat: float
    br_lon: float
    bl_lat: float
    bl_lon: float


# ── Analytics ─────────────────────────────────────────────────

class HealthBreakdown(BaseModel):
    healthy: int = 0
    moderate: int = 0
    poor: int = 0


class HeightBucket(BaseModel):
    range: str
    count: int


class AnalyticsResponse(BaseModel):
    total_trees: int
    average_height: Optional[float]
    health_score: Optional[float]  # % healthy
    area_hectares: Optional[float]
    health_breakdown: HealthBreakdown
    height_distribution: List[HeightBucket]


# ── Processing Node ───────────────────────────────────────────

class ProcessingNodeCreate(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=3000, ge=1, le=65535)
    label: Optional[str] = Field(default="", max_length=255)
    token: Optional[str] = Field(default="", max_length=1024)


class ProcessingNodeUpdate(BaseModel):
    hostname: Optional[str] = Field(None, min_length=1, max_length=255)
    port: Optional[int] = Field(None, ge=1, le=65535)
    label: Optional[str] = Field(None, max_length=255)
    token: Optional[str] = Field(None, max_length=1024)


class ProcessingNodeResponse(BaseModel):
    id: UUID
    hostname: str
    port: int
    api_version: str
    queue_count: int
    max_images: Optional[int] = None
    available_options: Optional[str] = "[]"
    label: str
    engine_version: str
    online: bool = False
    token: str = ""
    last_refreshed: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DroneProcessRequest(BaseModel):
    processing_node_id: Optional[UUID] = None


# ── GeoJSON ───────────────────────────────────────────────────

class GeoJSONProperties(BaseModel):
    tree_index: int
    height_m: Optional[float]
    health_status: Optional[str]


class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: dict
    properties: dict


class GeoJSONFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[GeoJSONFeature]


# ── Processing Status ────────────────────────────────────────

class ProcessingStatus(BaseModel):
    project_id: UUID
    status: str
    error: Optional[str] = None


# ── Drone Processing ─────────────────────────────────────────

class DroneUploadResponse(BaseModel):
    files_received: int
    total_staged: int
    job_id: str


class DroneProcessResponse(BaseModel):
    job_id: str
    status: str
    message: str


class DroneProgressResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    image_count: int
    message: Optional[str] = None
    error: Optional[str] = None


# ── Project Groups (temporal analysis) ───────────────────────

class GroupStatus(str, Enum):
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    READY = "READY"
    ERROR = "ERROR"


class ProjectGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = None
    description: Optional[str] = None
    client_id: UUID
    project_ids: List[UUID] = Field(..., min_length=2)
    flight_dates: Optional[List[Optional[datetime]]] = None


class ProjectGroupUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None


class GroupMemberResponse(BaseModel):
    id: UUID
    project_id: UUID
    project_name: Optional[str] = None
    timeline_index: int
    flight_date: Optional[datetime] = None
    boundary_geojson: Optional[str] = None
    area_hectares: Optional[float] = None
    tree_count: Optional[int] = None

    class Config:
        from_attributes = True


class ProjectGroupResponse(BaseModel):
    id: UUID
    name: str
    location: Optional[str] = None
    description: Optional[str] = None
    client_id: Optional[UUID] = None
    client_name: Optional[str] = None
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    status: str
    processing_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    members: List[GroupMemberResponse] = []
    unified_tree_count: Optional[int] = 0

    class Config:
        from_attributes = True


class ProjectGroupListResponse(BaseModel):
    groups: List[ProjectGroupResponse]
    total: int


class GroupStatusResponse(BaseModel):
    group_id: UUID
    status: str
    progress: Optional[int] = None
    message: Optional[str] = None
    error: Optional[str] = None


class TreeObservationResponse(BaseModel):
    id: UUID
    timeline_index: int
    project_id: UUID
    tree_id: Optional[UUID] = None
    observation_type: str
    height_m: Optional[float] = None
    health_status: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    class Config:
        from_attributes = True


class UnifiedTreeResponse(BaseModel):
    id: UUID
    unified_index: int
    baseline_latitude: Optional[float] = None
    baseline_longitude: Optional[float] = None
    first_seen_timeline_index: int
    last_seen_timeline_index: int
    current_status: str
    observations: List[TreeObservationResponse] = []

    class Config:
        from_attributes = True


class UnifiedTreeListResponse(BaseModel):
    trees: List[UnifiedTreeResponse]
    total: int


class DeltaKpis(BaseModel):
    net_tree_count: int = 0
    mortality_count: int = 0
    new_count: int = 0
    mortality_rate: float = 0.0
    avg_height_delta: Optional[float] = None
    health_score_delta: Optional[float] = None


class WaterfallBucket(BaseModel):
    from_timeline_index: int
    to_timeline_index: int
    start: int
    dead: int
    new: int
    end: int


class TimeSeriesPoint(BaseModel):
    timeline_index: int
    flight_date: Optional[datetime] = None
    project_id: UUID
    tree_count: int
    average_height: Optional[float] = None
    health_score: Optional[float] = None


class SnapshotAnalytics(BaseModel):
    timeline_index: int
    project_id: UUID
    total_trees: int
    average_height: Optional[float] = None
    health_score: Optional[float] = None
    area_hectares: Optional[float] = None


class GroupAnalyticsResponse(BaseModel):
    group_id: UUID
    timeline_count: int
    snapshots: List[SnapshotAnalytics]
    delta_kpis: DeltaKpis
    waterfall: List[WaterfallBucket]
    time_series: List[TimeSeriesPoint]


# ── Powerline Inspection ──────────────────────────────────────

class PowerlineImageType(str, Enum):
    RGB = "RGB"
    THERMAL = "THERMAL"


class PowerlineSeverity(str, Enum):
    S1 = "S1"
    S2 = "S2"
    S3 = "S3"
    S4 = "S4"
    S5 = "S5"
    POI = "POI"


class PowerlineImageResponse(BaseModel):
    id: UUID
    project_id: UUID
    filename: str
    width_px: Optional[int] = None
    height_px: Optional[int] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    date_taken: Optional[datetime] = None
    image_type: str = "RGB"
    image_tag: Optional[str] = None
    annotation_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class PowerlineImageListResponse(BaseModel):
    images: List[PowerlineImageResponse]
    total: int


class PowerlineImageUploadResponse(BaseModel):
    files_received: int
    images_created: int
    total_images: int


class PowerlineImageUpdate(BaseModel):
    image_tag: Optional[str] = None


class PowerlineAnnotationCreate(BaseModel):
    bbox_x: float = Field(..., ge=0.0, le=1.0)
    bbox_y: float = Field(..., ge=0.0, le=1.0)
    bbox_width: float = Field(..., gt=0.0, le=1.0)
    bbox_height: float = Field(..., gt=0.0, le=1.0)
    severity: PowerlineSeverity = PowerlineSeverity.S3
    issue_type: Optional[str] = None
    remedy_action: Optional[str] = None
    comment: Optional[str] = None
    inspector_name: Optional[str] = None
    component_tag: Optional[str] = None


class PowerlineAnnotationUpdate(BaseModel):
    bbox_x: Optional[float] = Field(None, ge=0.0, le=1.0)
    bbox_y: Optional[float] = Field(None, ge=0.0, le=1.0)
    bbox_width: Optional[float] = Field(None, gt=0.0, le=1.0)
    bbox_height: Optional[float] = Field(None, gt=0.0, le=1.0)
    severity: Optional[PowerlineSeverity] = None
    issue_type: Optional[str] = None
    remedy_action: Optional[str] = None
    comment: Optional[str] = None
    inspector_name: Optional[str] = None
    component_tag: Optional[str] = None


class PowerlineAnnotationResponse(BaseModel):
    id: UUID
    image_id: UUID
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    severity: str
    issue_type: Optional[str] = None
    remedy_action: Optional[str] = None
    comment: Optional[str] = None
    inspector_name: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    component_tag: Optional[str] = None

    class Config:
        from_attributes = True


class PowerlineSeverityCount(BaseModel):
    severity: str
    count: int


class PowerlineSummaryResponse(BaseModel):
    project_id: UUID
    total_images: int
    total_annotations: int
    severity_counts: List[PowerlineSeverityCount]
    issue_type_counts: dict
