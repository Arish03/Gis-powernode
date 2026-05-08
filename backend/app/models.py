import uuid
from datetime import datetime, timedelta
from sqlalchemy import (
    Column, String, Float, DateTime, ForeignKey, Enum as SQLEnum, Integer, Text,
    UniqueConstraint, Boolean
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
import enum

from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    SUB_ADMIN = "SUB_ADMIN"
    CLIENT = "CLIENT"


class ProjectStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    CREATED = "CREATED"
    UNASSIGNED = "UNASSIGNED"
    UPLOADING = "UPLOADING"
    PROCESSING = "PROCESSING"
    REVIEW_PENDING = "REVIEW_PENDING"
    REVIEW = "REVIEW"
    READY = "READY"
    ERROR = "ERROR"


class HealthStatus(str, enum.Enum):
    HEALTHY = "Healthy"
    MODERATE = "Moderate"
    POOR = "Poor"


class DroneJobStatus(str, enum.Enum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    PROCESSING = "processing"
    DOWNLOADING = "downloading"
    TILING = "tiling"
    DETECTING = "detecting"
    COMPUTING_HEIGHTS = "computing_heights"
    COMPLETED = "completed"
    FAILED = "failed"


class PendingAction(int, enum.Enum):
    CANCEL = 1
    REMOVE = 2
    RESTART = 3


class GroupStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    READY = "READY"
    ERROR = "ERROR"


class UnifiedTreeStatus(str, enum.Enum):
    PERSISTED = "PERSISTED"
    MISSING = "MISSING"
    NEW = "NEW"
    STABLE = "STABLE"


class ObservationType(str, enum.Enum):
    DETECTED = "DETECTED"
    MISSING = "MISSING"
    NEW = "NEW"


class ProjectType(str, enum.Enum):
    TREE = "TREE"
    POWERLINE = "POWERLINE"


class PowerlineImageType(str, enum.Enum):
    RGB = "RGB"
    THERMAL = "THERMAL"


class PowerlineSeverity(str, enum.Enum):
    S1 = "S1"
    S2 = "S2"
    S3 = "S3"
    S4 = "S4"
    S5 = "S5"
    POI = "POI"


NODE_OFFLINE_MINUTES = 5


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    plain_password = Column(String(255), nullable=True)
    full_name = Column(String(200), nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False, default=UserRole.CLIENT)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Projects assigned to this client
    projects = relationship("Project", back_populates="client", foreign_keys="Project.client_id")
    client_sub_admin_links = relationship(
        "ClientSubAdminAssignment",
        foreign_keys="ClientSubAdminAssignment.client_id",
        back_populates="client",
        cascade="all, delete-orphan",
    )
    sub_admin_client_links = relationship(
        "ClientSubAdminAssignment",
        foreign_keys="ClientSubAdminAssignment.sub_admin_id",
        back_populates="sub_admin",
        cascade="all, delete-orphan",
    )


class ClientSubAdminAssignment(Base):
    __tablename__ = "client_sub_admin_assignments"
    __table_args__ = (
        UniqueConstraint("client_id", "sub_admin_id", name="uq_client_sub_admin_assignment"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sub_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("User", foreign_keys=[client_id], back_populates="client_sub_admin_links")
    sub_admin = relationship("User", foreign_keys=[sub_admin_id], back_populates="sub_admin_client_links")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    location = Column(String(300), nullable=True)
    description = Column(Text, nullable=True)
    client_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    last_edited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(SQLEnum(ProjectStatus), default=ProjectStatus.DRAFT, nullable=False)
    project_type = Column(SQLEnum(ProjectType, name="projecttype"), default=ProjectType.TREE, nullable=False)
    boundary_geojson = Column(Text, nullable=True)  # Store boundary as GeoJSON text
    area_hectares = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    processing_error = Column(Text, nullable=True)
    report_summary = Column(Text, nullable=True)
    primary_inspector_name = Column(String(200), nullable=True)

    # Relationships
    client = relationship("User", back_populates="projects", foreign_keys=[client_id])
    creator = relationship("User", foreign_keys=[created_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    last_editor = relationship("User", foreign_keys=[last_edited_by])
    trees = relationship("Tree", back_populates="project", cascade="all, delete-orphan")
    drone_job = relationship("DroneProcessingJob", back_populates="project", uselist=False, cascade="all, delete-orphan")
    powerline_images = relationship("PowerlineImage", back_populates="project", cascade="all, delete-orphan")


class Tree(Base):
    __tablename__ = "trees"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tree_index = Column(Integer, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    height_m = Column(Float, nullable=True)
    health_status = Column(SQLEnum(HealthStatus), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)
    detection_source = Column(String(20), nullable=True, default="auto")
    xmin_px = Column(Integer, nullable=True)
    ymin_px = Column(Integer, nullable=True)
    xmax_px = Column(Integer, nullable=True)
    ymax_px = Column(Integer, nullable=True)
    bbox_tl_lat = Column(Float, nullable=True)
    bbox_tl_lon = Column(Float, nullable=True)
    bbox_tr_lat = Column(Float, nullable=True)
    bbox_tr_lon = Column(Float, nullable=True)
    bbox_br_lat = Column(Float, nullable=True)
    bbox_br_lon = Column(Float, nullable=True)
    bbox_bl_lat = Column(Float, nullable=True)
    bbox_bl_lon = Column(Float, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="trees")


class DroneProcessingJob(Base):
    __tablename__ = "drone_processing_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    status = Column(SQLEnum(DroneJobStatus), default=DroneJobStatus.UPLOADING, nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    image_count = Column(Integer, default=0, nullable=False)
    nodeodm_task_uuid = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    processing_node_id = Column(UUID(as_uuid=True), ForeignKey("processing_nodes.id", ondelete="SET NULL"), nullable=True)
    auto_processing_node = Column(Boolean, default=True, nullable=False)
    pending_action = Column(Integer, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="drone_job")
    processing_node = relationship("ProcessingNode", back_populates="drone_jobs")


class ProcessingNode(Base):
    __tablename__ = "processing_nodes"
    __table_args__ = (
        UniqueConstraint("hostname", "port", name="uq_processing_node_host_port"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hostname = Column(String(255), nullable=False)
    port = Column(Integer, default=3000, nullable=False)
    api_version = Column(String(32), default="", nullable=False)
    queue_count = Column(Integer, default=0, nullable=False)
    available_options = Column(Text, default="[]", nullable=False)  # JSON string
    token = Column(String(1024), default="", nullable=False)
    max_images = Column(Integer, nullable=True)
    engine_version = Column(String(32), default="", nullable=False)
    label = Column(String(255), default="", nullable=False)
    last_refreshed = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    drone_jobs = relationship("DroneProcessingJob", back_populates="processing_node")

    def is_online(self):
        if self.last_refreshed is None:
            return False
        return self.last_refreshed >= datetime.utcnow() - timedelta(minutes=NODE_OFFLINE_MINUTES)

    def get_url(self):
        return f"http://{self.hostname}:{self.port}"

    def update_node_info(self, retries=3, backoff=2):
        import requests
        import json
        import time as _time
        url = f"{self.get_url()}/info"
        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        for attempt in range(retries):
            try:
                resp = requests.get(url, headers=headers, timeout=10)
                resp.raise_for_status()
                info = resp.json()
                self.api_version = info.get("version", self.api_version)
                self.queue_count = info.get("taskQueueCount", self.queue_count)
                self.max_images = info.get("maxImages", self.max_images)
                self.engine_version = info.get("engineVersion", self.engine_version) or info.get("engine", self.engine_version)
                opts = info.get("availableOptions", None)
                if opts is not None:
                    self.available_options = json.dumps(opts)
                self.last_refreshed = datetime.utcnow()
                return  # success
            except Exception:
                if attempt < retries - 1:
                    _time.sleep(backoff * (attempt + 1))
        # all retries exhausted — last_refreshed stays stale

    @classmethod
    def find_best_available_node(cls, db):
        cutoff = datetime.utcnow() - timedelta(minutes=NODE_OFFLINE_MINUTES)
        node = db.query(cls).filter(
            cls.last_refreshed >= cutoff
        ).order_by(cls.queue_count.asc()).first()
        if node is None:
            raise ValueError("No processing nodes available")
        return node

    def __str__(self):
        return self.label if self.label else f"{self.hostname}:{self.port}"


# ── Project Groups (temporal analysis) ─────────────────────────────────────

class ProjectGroup(Base):
    __tablename__ = "project_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    location = Column(String(300), nullable=True)
    description = Column(Text, nullable=True)
    client_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    status = Column(SQLEnum(GroupStatus, name="groupstatus"), default=GroupStatus.DRAFT, nullable=False)
    processing_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    client = relationship("User", foreign_keys=[client_id])
    creator = relationship("User", foreign_keys=[created_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    members = relationship(
        "ProjectGroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="ProjectGroupMember.timeline_index",
    )
    unified_trees = relationship(
        "UnifiedTree", back_populates="group", cascade="all, delete-orphan"
    )


class ProjectGroupMember(Base):
    __tablename__ = "project_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "project_id", name="uq_group_member_project"),
        UniqueConstraint("group_id", "timeline_index", name="uq_group_member_timeline"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("project_groups.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    timeline_index = Column(Integer, nullable=False)
    flight_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("ProjectGroup", back_populates="members")
    project = relationship("Project")


class UnifiedTree(Base):
    __tablename__ = "unified_trees"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("project_groups.id", ondelete="CASCADE"), nullable=False)
    unified_index = Column(Integer, nullable=False)
    baseline_latitude = Column(Float, nullable=True)
    baseline_longitude = Column(Float, nullable=True)
    baseline_geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    first_seen_timeline_index = Column(Integer, nullable=False, default=0)
    last_seen_timeline_index = Column(Integer, nullable=False, default=0)
    current_status = Column(SQLEnum(UnifiedTreeStatus, name="unifiedtreestatus"),
                            default=UnifiedTreeStatus.PERSISTED, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("ProjectGroup", back_populates="unified_trees")
    observations = relationship(
        "TreeObservation",
        back_populates="unified_tree",
        cascade="all, delete-orphan",
        order_by="TreeObservation.timeline_index",
    )


class TreeObservation(Base):
    __tablename__ = "tree_observations"
    __table_args__ = (
        UniqueConstraint("unified_tree_id", "timeline_index", name="uq_tree_obs_timeline"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unified_tree_id = Column(UUID(as_uuid=True), ForeignKey("unified_trees.id", ondelete="CASCADE"), nullable=False)
    # tree_id is NULL when observation_type == MISSING (dead/absent at that timeline)
    tree_id = Column(UUID(as_uuid=True), ForeignKey("trees.id", ondelete="CASCADE"), nullable=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    timeline_index = Column(Integer, nullable=False)
    observation_type = Column(SQLEnum(ObservationType, name="observationtype"),
                              default=ObservationType.DETECTED, nullable=False)
    height_m = Column(Float, nullable=True)
    health_status = Column(SQLEnum(HealthStatus), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    unified_tree = relationship("UnifiedTree", back_populates="observations")
    tree = relationship("Tree")
    project = relationship("Project")


# ── Powerline Inspection (project_type == POWERLINE) ──────────────────────

class PowerlineImage(Base):
    __tablename__ = "powerline_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(512), nullable=False)
    filename = Column(String(255), nullable=False)
    width_px = Column(Integer, nullable=True)
    height_px = Column(Integer, nullable=True)
    altitude = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    date_taken = Column(DateTime, nullable=True)
    image_type = Column(SQLEnum(PowerlineImageType, name="powerlineimagetype"),
                        default=PowerlineImageType.RGB, nullable=False)
    image_tag = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="powerline_images")
    annotations = relationship(
        "PowerlineAnnotation",
        back_populates="image",
        cascade="all, delete-orphan",
    )


class PowerlineAnnotation(Base):
    __tablename__ = "powerline_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("powerline_images.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    # Normalized bbox (0..1 relative to image dimensions)
    bbox_x = Column(Float, nullable=False)
    bbox_y = Column(Float, nullable=False)
    bbox_width = Column(Float, nullable=False)
    bbox_height = Column(Float, nullable=False)
    severity = Column(SQLEnum(PowerlineSeverity, name="powerlineseverity"),
                      default=PowerlineSeverity.S3, nullable=False)
    issue_type = Column(String(200), nullable=True)
    remedy_action = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    inspector_name = Column(String(200), nullable=True)
    component_tag = Column(String(100), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    image = relationship("PowerlineImage", back_populates="annotations")
