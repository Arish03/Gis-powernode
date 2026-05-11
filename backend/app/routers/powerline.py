"""Powerline inspection endpoints: image upload (no Celery), annotation CRUD, summary."""
import os
import shutil
 datetime import datetime
from typing import List, Optional
from uuid import UUID

fromfrom fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin, require_staff
from app.config import get_settings
from app.database import get_db
from app.models import (
    ClientSubAdminAssignment,
    PowerlineAnnotation,
    PowerlineImage,
    PowerlineImageType,
    PowerlineSeverity,
    Project,
    ProjectStatus,
    ProjectType,
    User,
    UserRole,
)
from app.schemas import (
    PowerlineAnnotationCreate,
    PowerlineAnnotationResponse,
    PowerlineAnnotationUpdate,
    PowerlineImageListResponse,
    PowerlineImageResponse,
    PowerlineImageUpdate,
    PowerlineImageUploadResponse,
    PowerlineSeverityCount,
    PowerlineSummaryResponse,
)

settings = get_settings()
router = APIRouter(prefix="/api/projects", tags=["Powerline"])

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def _can_access_project(user: User, project: Project, db: Session) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.CLIENT:
        return project.client_id == user.id and project.status == ProjectStatus.READY
    if user.role == UserRole.SUB_ADMIN:
        if project.client_id is None:
            return False
        return db.query(ClientSubAdminAssignment).filter(
            ClientSubAdminAssignment.sub_admin_id == user.id,
            ClientSubAdminAssignment.client_id == project.client_id,
        ).first() is not None
    return False


def _can_staff_edit(user: User, project: Project, db: Session) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.SUB_ADMIN and project.client_id is not None:
        return db.query(ClientSubAdminAssignment).filter(
            ClientSubAdminAssignment.sub_admin_id == user.id,
            ClientSubAdminAssignment.client_id == project.client_id,
        ).first() is not None
    return False


def _require_powerline_project(project_id: UUID, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.project_type != ProjectType.POWERLINE:
        raise HTTPException(status_code=400, detail="Project is not a powerline inspection project")
    return project


def _extract_exif(image_path: str):
    """Best-effort EXIF extraction. Returns dict with width, height, altitude, heading, lat, lon, date_taken, image_type."""
    try:
        from PIL import Image, ExifTags
    except Exception:
        return {"width": None, "height": None, "altitude": None, "heading": None,
                "latitude": None, "longitude": None, "date_taken": None, "image_type": PowerlineImageType.RGB}
    try:
        with Image.open(image_path) as img:
            width, height = img.size
            exif_raw = img._getexif() or {}
    except Exception:
        return {"width": None, "height": None, "altitude": None, "heading": None,
                "latitude": None, "longitude": None, "date_taken": None, "image_type": PowerlineImageType.RGB}

    tag_map = {ExifTags.TAGS.get(k, k): v for k, v in exif_raw.items()}
    gps_raw = tag_map.get("GPSInfo", {}) or {}
    gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_raw.items()} if gps_raw else {}

    def _to_float(v):
        try:
            return float(v)
        except Exception:
            try:
                return float(v[0]) / float(v[1])
            except Exception:
                return None

    def _dms_to_deg(dms, ref):
        try:
            d = _to_float(dms[0]) or 0.0
            m = _to_float(dms[1]) or 0.0
            s = _to_float(dms[2]) or 0.0
            deg = d + m / 60.0 + s / 3600.0
            # PIL may return ref as bytes or str depending on the file/version
            if isinstance(ref, bytes):
                try:
                    ref = ref.decode("ascii", "ignore")
                except Exception:
                    ref = ""
            if isinstance(ref, str) and ref.strip().upper() in ("S", "W"):
                deg = -deg
            return deg
        except Exception:
            return None

    altitude = _to_float(gps.get("GPSAltitude"))
    if altitude is not None and gps.get("GPSAltitudeRef") in (b"\x01", 1):
        altitude = -altitude

    heading = _to_float(gps.get("GPSImgDirection"))
    lat = _dms_to_deg(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef")) if gps.get("GPSLatitude") else None
    lon = _dms_to_deg(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef")) if gps.get("GPSLongitude") else None

    date_taken = None
    dt_raw = tag_map.get("DateTimeOriginal") or tag_map.get("DateTime")
    if dt_raw:
        try:
            date_taken = datetime.strptime(str(dt_raw), "%Y:%m:%d %H:%M:%S")
        except Exception:
            date_taken = None

    fname_lower = os.path.basename(image_path).lower()
    image_type = PowerlineImageType.THERMAL if ("thermal" in fname_lower or "_t." in fname_lower or fname_lower.endswith("_t.jpg")) else PowerlineImageType.RGB

    return {
        "width": width, "height": height, "altitude": altitude, "heading": heading,
        "latitude": lat, "longitude": lon, "date_taken": date_taken, "image_type": image_type,
    }


def _image_to_response(img: PowerlineImage, ann_count: int) -> PowerlineImageResponse:
    return PowerlineImageResponse(
        id=img.id,
        project_id=img.project_id,
        filename=img.filename,
        width_px=img.width_px,
        height_px=img.height_px,
        altitude=img.altitude,
        heading=img.heading,
        latitude=img.latitude,
        longitude=img.longitude,
        date_taken=img.date_taken,
        image_type=img.image_type.value if img.image_type else "RGB",
        image_tag=img.image_tag,
        annotation_count=ann_count,
        created_at=img.created_at,
    )


@router.post(
    "/{project_id}/powerline/upload",
    response_model=PowerlineImageUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_powerline_images(
    project_id: UUID,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = _require_powerline_project(project_id, db)
    if not _can_staff_edit(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    for f in files:
        ext = os.path.splitext(f.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is not a supported image (allowed: {sorted(ALLOWED_IMAGE_EXTENSIONS)})",
            )

    upload_dir = os.path.join(settings.UPLOAD_DIR, str(project_id), "powerline-images")
    os.makedirs(upload_dir, exist_ok=True)

    created = 0
    for f in files:
        safe_name = "".join(c for c in (f.filename or "") if c.isalnum() or c in "-_.")
        if not safe_name:
            safe_name = f"image_{os.urandom(4).hex()}.jpg"
        # Avoid collisions
        dest = os.path.join(upload_dir, safe_name)
        if os.path.exists(dest):
            base, ext = os.path.splitext(safe_name)
            safe_name = f"{base}_{os.urandom(3).hex()}{ext}"
            dest = os.path.join(upload_dir, safe_name)

        with open(dest, "wb") as buf:
            shutil.copyfileobj(f.file, buf)

        meta = _extract_exif(dest)
        img = PowerlineImage(
            project_id=project_id,
            file_path=dest,
            filename=safe_name,
            width_px=meta["width"],
            height_px=meta["height"],
            altitude=meta["altitude"],
            heading=meta["heading"],
            latitude=meta["latitude"],
            longitude=meta["longitude"],
            date_taken=meta["date_taken"],
            image_type=meta["image_type"],
        )
        db.add(img)
        created += 1

    if project.status == ProjectStatus.DRAFT:
        project.status = ProjectStatus.UPLOADING
    project.last_edited_by = staff.id
    db.commit()

    total = db.query(func.count(PowerlineImage.id)).filter(
        PowerlineImage.project_id == project_id
    ).scalar() or 0

    return PowerlineImageUploadResponse(
        files_received=len(files),
        images_created=created,
        total_images=total,
    )


@router.get("/{project_id}/powerline/images", response_model=PowerlineImageListResponse)
def list_powerline_images(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = _require_powerline_project(project_id, db)
    if not _can_access_project(user, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    images = (
        db.query(PowerlineImage)
        .filter(PowerlineImage.project_id == project_id)
        .order_by(PowerlineImage.created_at.asc())
        .all()
    )
    counts = dict(
        db.query(PowerlineAnnotation.image_id, func.count(PowerlineAnnotation.id))
        .filter(PowerlineAnnotation.image_id.in_([i.id for i in images]) if images else False)
        .group_by(PowerlineAnnotation.image_id)
        .all()
    )
    out = [_image_to_response(i, counts.get(i.id, 0)) for i in images]
    return PowerlineImageListResponse(images=out, total=len(out))


@router.get("/{project_id}/powerline/images/{image_id}/file")
def get_powerline_image_file(
    project_id: UUID,
    image_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = _require_powerline_project(project_id, db)
    if not _can_access_project(user, project, db):
        raise HTTPException(status_code=403, detail="Access denied")
    img = db.query(PowerlineImage).filter(
        PowerlineImage.id == image_id, PowerlineImage.project_id == project_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if not os.path.exists(img.file_path):
        raise HTTPException(status_code=410, detail="Image file missing on disk")
    return FileResponse(img.file_path, filename=img.filename)


@router.delete("/{project_id}/powerline/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_powerline_image(
    project_id: UUID,
    image_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = _require_powerline_project(project_id, db)
    if not _can_staff_edit(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")
    img = db.query(PowerlineImage).filter(
        PowerlineImage.id == image_id, PowerlineImage.project_id == project_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        if img.file_path and os.path.exists(img.file_path):
            os.remove(img.file_path)
    except OSError:
        pass
    db.delete(img)
    project.last_edited_by = staff.id
    db.commit()
    return


@router.patch(
    "/{project_id}/powerline/images/{image_id}",
    response_model=PowerlineImageResponse,
)
def patch_powerline_image(
    project_id: UUID,
    image_id: UUID,
    payload: PowerlineImageUpdate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Set image_tag (and any future per-image metadata) without re-uploading."""
    project = _require_powerline_project(project_id, db)
    if not _can_staff_edit(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")
    img = db.query(PowerlineImage).filter(
        PowerlineImage.id == image_id, PowerlineImage.project_id == project_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if payload.image_tag is not None:
        img.image_tag = payload.image_tag or None  # empty string → NULL
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(img)
    ann_count = db.query(func.count(PowerlineAnnotation.id)).filter(
        PowerlineAnnotation.image_id == img.id
    ).scalar() or 0
    return _image_to_response(img, ann_count)


# ── Annotations ───────────────────────────────────────────────

def _get_image_for_user(
    project_id: UUID, image_id: UUID, user: User, db: Session, *, edit: bool = False
) -> tuple[Project, PowerlineImage]:
    project = _require_powerline_project(project_id, db)
    if edit:
        if not _can_staff_edit(user, project, db):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        if not _can_access_project(user, project, db):
            raise HTTPException(status_code=403, detail="Access denied")
    img = db.query(PowerlineImage).filter(
        PowerlineImage.id == image_id, PowerlineImage.project_id == project_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return project, img


@router.get(
    "/{project_id}/powerline/images/{image_id}/annotations",
    response_model=List[PowerlineAnnotationResponse],
)
def list_annotations(
    project_id: UUID,
    image_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _project, img = _get_image_for_user(project_id, image_id, user, db, edit=False)
    return (
        db.query(PowerlineAnnotation)
        .filter(PowerlineAnnotation.image_id == img.id)
        .order_by(PowerlineAnnotation.created_at.asc())
        .all()
    )


@router.post(
    "/{project_id}/powerline/images/{image_id}/annotations",
    response_model=PowerlineAnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(
    project_id: UUID,
    image_id: UUID,
    payload: PowerlineAnnotationCreate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project, img = _get_image_for_user(project_id, image_id, staff, db, edit=True)
    ann = PowerlineAnnotation(
        image_id=img.id,
        bbox_x=payload.bbox_x,
        bbox_y=payload.bbox_y,
        bbox_width=payload.bbox_width,
        bbox_height=payload.bbox_height,
        severity=PowerlineSeverity(payload.severity.value),
        issue_type=payload.issue_type,
        remedy_action=payload.remedy_action,
        comment=payload.comment,
        inspector_name=payload.inspector_name,
        component_tag=payload.component_tag,
        created_by=staff.id,
    )
    db.add(ann)
    # Re-publishing rule: edits drop status back to REVIEW_PENDING
    if project.status == ProjectStatus.READY:
        project.status = ProjectStatus.REVIEW_PENDING
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(ann)
    return ann


@router.put(
    "/{project_id}/powerline/annotations/{annotation_id}",
    response_model=PowerlineAnnotationResponse,
)
def update_annotation(
    project_id: UUID,
    annotation_id: UUID,
    payload: PowerlineAnnotationUpdate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = _require_powerline_project(project_id, db)
    if not _can_staff_edit(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")
    ann = (
        db.query(PowerlineAnnotation)
        .join(PowerlineImage, PowerlineImage.id == PowerlineAnnotation.image_id)
        .filter(
            PowerlineAnnotation.id == annotation_id,
            PowerlineImage.project_id == project_id,
        )
        .first()
    )
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "severity" and value is not None:
            ann.severity = PowerlineSeverity(value.value if hasattr(value, "value") else value)
        else:
            setattr(ann, key, value)

    if project.status == ProjectStatus.READY:
        project.status = ProjectStatus.REVIEW_PENDING
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(ann)
    return ann


@router.delete(
    "/{project_id}/powerline/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_annotation(
    project_id: UUID,
    annotation_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = _require_powerline_project(project_id, db)
    if not _can_staff_edit(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")
    ann = (
        db.query(PowerlineAnnotation)
        .join(PowerlineImage, PowerlineImage.id == PowerlineAnnotation.image_id)
        .filter(
            PowerlineAnnotation.id == annotation_id,
            PowerlineImage.project_id == project_id,
        )
        .first()
    )
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    if project.status == ProjectStatus.READY:
        project.status = ProjectStatus.REVIEW_PENDING
    project.last_edited_by = staff.id
    db.commit()
    return


@router.get("/{project_id}/powerline/summary", response_model=PowerlineSummaryResponse)
def get_summary(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = _require_powerline_project(project_id, db)
    if not _can_access_project(user, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    total_images = db.query(func.count(PowerlineImage.id)).filter(
        PowerlineImage.project_id == project_id
    ).scalar() or 0

    sev_rows = (
        db.query(PowerlineAnnotation.severity, func.count(PowerlineAnnotation.id))
        .join(PowerlineImage, PowerlineImage.id == PowerlineAnnotation.image_id)
        .filter(PowerlineImage.project_id == project_id)
        .group_by(PowerlineAnnotation.severity)
        .all()
    )
    severity_counts = [
        PowerlineSeverityCount(severity=s.value if hasattr(s, "value") else str(s), count=c)
        for s, c in sev_rows
    ]
    total_ann = sum(c for _, c in sev_rows)

    issue_rows = (
        db.query(PowerlineAnnotation.issue_type, func.count(PowerlineAnnotation.id))
        .join(PowerlineImage, PowerlineImage.id == PowerlineAnnotation.image_id)
        .filter(PowerlineImage.project_id == project_id)
        .group_by(PowerlineAnnotation.issue_type)
        .all()
    )
    issue_type_counts = {(it or "Unspecified"): c for it, c in issue_rows}

    return PowerlineSummaryResponse(
        project_id=project_id,
        total_images=total_images,
        total_annotations=total_ann,
        severity_counts=severity_counts,
        issue_type_counts=issue_type_counts,
    )
