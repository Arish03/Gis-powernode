"""ReportLab-based PDF generator for POWERLINE inspection projects.

Structure:
  Page 1  – Cover
  Page 2  – Project overview (OSM map + severity cards + summary text)
  Page 3  – Table of Contents grouped by image_tag
  Page 4  – Annotation overview table (ID, Sev, Issue, Comments, Page)
  Page 5+ – Per-annotation detail pages, grouped by image_tag

Single-pass build: annotation page numbers are computed arithmetically
(page = 5 + index) so TOC and overview table are accurate without a
second PDF render pass.
"""
from __future__ import annotations

import io
import math
import os
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image as RLImage,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.models import (
    PowerlineAnnotation,
    PowerlineImage,
    PowerlineSeverity,
    Project,
    User,
)

# ── Constants ──────────────────────────────────────────────────────────────

SEVERITY_COLOR = {
    "S5": colors.HexColor("#b91c1c"),
    "S4": colors.HexColor("#ea580c"),
    "S3": colors.HexColor("#d97706"),
    "S2": colors.HexColor("#65a30d"),
    "S1": colors.HexColor("#16a34a"),
    "POI": colors.HexColor("#2563eb"),
}
SEVERITY_LABEL = {
    "S5": "Category A — Critical",
    "S4": "Category B — Major",
    "S3": "Category C — Minor",
    "S2": "Kuo — Keep under Observation",
    "S1": "N/A — Not Applicable",
    "POI": "Point of Interest",
}
SEVERITY_SHORT = {
    "S5": "Category A",
    "S4": "Category B",
    "S3": "Category C",
    "S2": "Kuo",
    "S1": "N/A",
    "POI": "POI",
}
SEVERITY_ORDER = ["S5", "S4", "S3", "S2", "S1", "POI"]

SEVERITY_LEGEND = [
    ("S5", "Category A", "Critical — To be repaired immediately."),
    ("S4", "Category B", "Major — Major defects, attend within 3 to 6 months."),
    ("S3", "Category C", "Minor — General defect, fix during scheduled maintenance."),
    ("S2", "Kuo",        "Keep under Observation."),
    ("S1", "N/A",        "Not Applicable."),
]

TAG_ORDER = [
    "structure",
    "circuit top", "circuit middle", "circuit bottom", "circuit ground",
]

# Max pixels along longest edge for images embedded in PDF
_IMG_MAX_DIM = 3000
# JPEG quality for embedded images
_IMG_QUALITY = 92
# In-process cache: file_path → PIL Image (resized, RGB)
_IMG_CACHE: Dict[str, Any] = {}


def _tag_sort_key(tag: Optional[str]) -> Tuple[int, str]:
    if tag is None:
        return (999, "")
    low = tag.strip().lower()
    try:
        return (TAG_ORDER.index(low), low)
    except ValueError:
        return (500, low)


# ── Formatting helpers ─────────────────────────────────────────────────────

def _fmt(value: Any, suffix: str = "", precision: Optional[int] = None) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if precision is not None and isinstance(value, (int, float)):
        return f"{value:.{precision}f}{suffix}"
    return f"{value}{suffix}"


def _fmt_coord(lat: Optional[float], lon: Optional[float]) -> str:
    if lat is None or lon is None:
        return "—"
    lat_h = "N" if lat >= 0 else "S"
    lon_h = "E" if lon >= 0 else "W"
    return f"{abs(lat):.6f}°{lat_h}, {abs(lon):.6f}°{lon_h}"


def _sev_hex(sev: str) -> str:
    col = SEVERITY_COLOR.get(sev, colors.HexColor("#dc2626"))
    return "#%02x%02x%02x" % (
        int(round(col.red * 255)),
        int(round(col.green * 255)),
        int(round(col.blue * 255)),
    )


# ── Fast image loading ─────────────────────────────────────────────────────

def _load_image(image_path: str) -> Optional[Any]:
    """Load image at full resolution. Result is cached for the lifetime of the current report build."""
    if image_path in _IMG_CACHE:
        return _IMG_CACHE[image_path]
    try:
        from PIL import Image as _PIL
        img = _PIL.open(image_path)
        img = img.convert("RGB")
        # Cap at max dim only if the image truly exceeds it
        w, h = img.size
        if max(w, h) > _IMG_MAX_DIM:
            scale = _IMG_MAX_DIM / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), _PIL.LANCZOS)
        _IMG_CACHE[image_path] = img
        return img
    except Exception:
        _IMG_CACHE[image_path] = None
        return None


def _crop_with_box(image_path: str, ann: PowerlineAnnotation) -> Optional[bytes]:
    img = _load_image(image_path)
    if img is None:
        return None
    try:
        from PIL import Image as _PIL
        w, h = img.size
        x0 = max(0, int(ann.bbox_x * w))
        y0 = max(0, int(ann.bbox_y * h))
        x1 = min(w, int((ann.bbox_x + ann.bbox_width) * w))
        y1 = min(h, int((ann.bbox_y + ann.bbox_height) * h))
        if x1 <= x0 or y1 <= y0:
            return None
        crop = img.crop((x0, y0, x1, y1))
        if crop.width < 16 or crop.height < 16:
            crop = crop.resize((max(crop.width, 80), max(crop.height, 80)), _PIL.LANCZOS)
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=_IMG_QUALITY)
        return buf.getvalue()
    except Exception:
        return None


def _full_image_with_box(image_path: str, ann: PowerlineAnnotation) -> Optional[bytes]:
    img = _load_image(image_path)
    if img is None:
        return None
    try:
        from PIL import ImageDraw as _PILDraw
        img = img.copy()
        w, h = img.size
        x0 = int(ann.bbox_x * w)
        y0 = int(ann.bbox_y * h)
        x1 = int((ann.bbox_x + ann.bbox_width) * w)
        y1 = int((ann.bbox_y + ann.bbox_height) * h)
        draw = _PILDraw.Draw(img)
        sev = ann.severity.value if hasattr(ann.severity, "value") else str(ann.severity)
        sev_col = SEVERITY_COLOR.get(sev, colors.HexColor("#dc2626"))
        outline = (
            int(round(sev_col.red * 255)),
            int(round(sev_col.green * 255)),
            int(round(sev_col.blue * 255)),
        )
        stroke = max(2, int(min(w, h) * 0.006))
        for offset in range(stroke):
            draw.rectangle([x0 - offset, y0 - offset, x1 + offset, y1 + offset], outline=outline)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_IMG_QUALITY)
        return buf.getvalue()
    except Exception:
        return None


def _rl_image(data: Optional[bytes], max_w: float, max_h: float):
    if not data:
        return Paragraph("<i>image unavailable</i>", getSampleStyleSheet()["BodyText"])
    try:
        rl = RLImage(io.BytesIO(data))
        iw, ih = rl.imageWidth, rl.imageHeight
        if iw <= 0 or ih <= 0:
            return Paragraph("<i>image unavailable</i>", getSampleStyleSheet()["BodyText"])
        scale = min(max_w / iw, max_h / ih)
        rl.drawWidth = iw * scale
        rl.drawHeight = ih * scale
        return rl
    except Exception:
        return Paragraph("<i>image unavailable</i>", getSampleStyleSheet()["BodyText"])


# ── OSM map renderer ───────────────────────────────────────────────────────

def _lat_lon_to_tile(lat_deg: float, lon_deg: float, zoom: int) -> Tuple[int, int]:
    lat_r = math.radians(lat_deg)
    n = 2 ** zoom
    x = max(0, int((lon_deg + 180.0) / 360.0 * n))
    y = max(0, int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n))
    return x, y


def _tile_nw_lat_lon(tile_x: int, tile_y: int, zoom: int) -> Tuple[float, float]:
    n = 2 ** zoom
    lon = tile_x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * tile_y / n))))
    return lat, lon


def render_overview_map(
    points: List[Tuple[float, float]],
    out_w_px: int = 480,
    out_h_px: int = 300,
) -> Optional[bytes]:
    if not points:
        return None
    try:
        import requests as _req
        from PIL import Image as _PIL, ImageDraw as _PILDraw
    except Exception:
        return None

    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    pad_lat = max(0.002, (max_lat - min_lat) * 0.25)
    pad_lon = max(0.002, (max_lon - min_lon) * 0.25)
    min_lat -= pad_lat; max_lat += pad_lat
    min_lon -= pad_lon; max_lon += pad_lon

    TILE_SIZE = 256
    zoom = 15
    for z in range(18, 1, -1):
        tx0, ty0 = _lat_lon_to_tile(max_lat, min_lon, z)
        tx1, ty1 = _lat_lon_to_tile(min_lat, max_lon, z)
        if (tx1 - tx0 + 1) * TILE_SIZE <= out_w_px * 3 and (ty1 - ty0 + 1) * TILE_SIZE <= out_h_px * 3:
            zoom = z
            break

    tx0, ty0 = _lat_lon_to_tile(max_lat, min_lon, zoom)
    tx1, ty1 = _lat_lon_to_tile(min_lat, max_lon, zoom)
    canvas_w = (tx1 - tx0 + 1) * TILE_SIZE
    canvas_h = (ty1 - ty0 + 1) * TILE_SIZE
    canvas = _PIL.new("RGB", (canvas_w, canvas_h), (220, 220, 220))

    sess = _req.Session()
    sess.headers["User-Agent"] = "GIS-Inspection-Report/1.0"
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            try:
                r = sess.get(f"https://tile.openstreetmap.org/{zoom}/{tx}/{ty}.png", timeout=3)
                if r.status_code == 200:
                    canvas.paste(_PIL.open(io.BytesIO(r.content)).convert("RGB"),
                                 ((tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE))
            except Exception:
                pass

    nw_lat, nw_lon = _tile_nw_lat_lon(tx0, ty0, zoom)
    se_lat, se_lon = _tile_nw_lat_lon(tx1 + 1, ty1 + 1, zoom)

    def _proj(lat: float, lon: float) -> Tuple[int, int]:
        if se_lon == nw_lon or nw_lat == se_lat:
            return 0, 0
        return (int((lon - nw_lon) / (se_lon - nw_lon) * canvas_w),
                int((nw_lat - lat) / (nw_lat - se_lat) * canvas_h))

    draw = _PILDraw.Draw(canvas)
    for lat, lon in points:
        cx, cy = _proj(lat, lon)
        draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(220, 38, 38), outline=(255, 255, 255), width=2)

    cx0, cy0 = _proj(max_lat, min_lon)
    cx1, cy1 = _proj(min_lat, max_lon)
    cx0, cy0 = max(0, cx0), max(0, cy0)
    cx1, cy1 = min(canvas_w, cx1), min(canvas_h, cy1)
    if cx1 > cx0 and cy1 > cy0:
        canvas = canvas.crop((cx0, cy0, cx1, cy1))

    canvas.thumbnail((out_w_px, out_h_px), _PIL.LANCZOS)
    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


# ── Style factory ──────────────────────────────────────────────────────────

def _make_styles():
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=24, leading=28,
                        textColor=colors.HexColor("#0f172a"), spaceAfter=8)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=16, leading=20,
                        textColor=colors.HexColor("#0f172a"), spaceBefore=4, spaceAfter=8)
    h3 = ParagraphStyle("h3", parent=styles["Heading3"], fontSize=12, leading=16,
                        textColor=colors.HexColor("#0f172a"), spaceBefore=4, spaceAfter=4)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=10, leading=14,
                          textColor=colors.HexColor("#0f172a"))
    muted = ParagraphStyle("muted", parent=body, textColor=colors.HexColor("#64748b"))
    small = ParagraphStyle("small", parent=muted, fontSize=8, leading=11)
    toc_tag_s = ParagraphStyle("toc_tag", parent=body, fontSize=10, leading=14,
                               textColor=colors.HexColor("#0f172a"), spaceBefore=6, fontName="Helvetica-Bold")
    toc_item_s = ParagraphStyle("toc_item", parent=small, leftIndent=12)
    return dict(h1=h1, h2=h2, h3=h3, body=body, muted=muted, small=small,
                toc_tag=toc_tag_s, toc_item=toc_item_s)


# ── Named destination flowable ────────────────────────────────────────────

class _Dest(Flowable):
    """Zero-height flowable that registers a named PDF destination at its position."""
    def __init__(self, name: str) -> None:
        Flowable.__init__(self)
        self.name = name
        self.width = 0
        self.height = 0

    def draw(self) -> None:  # type: ignore[override]
        self.canv.bookmarkHorizontal(self.name, 0, 0)


# ── Main builder ───────────────────────────────────────────────────────────

def build_report(db: Session, project: Project) -> bytes:
    """Build and return a PDF inspection report for the given POWERLINE project."""
    _IMG_CACHE.clear()

    # ── Fetch data ─────────────────────────────────────────────
    images: List[PowerlineImage] = (
        db.query(PowerlineImage)
        .filter(PowerlineImage.project_id == project.id)
        .order_by(PowerlineImage.created_at.asc())
        .all()
    )
    all_annotations: List[PowerlineAnnotation] = (
        db.query(PowerlineAnnotation)
        .filter(PowerlineAnnotation.image_id.in_([i.id for i in images]) if images else False)
        .order_by(PowerlineAnnotation.created_at.asc())
        .all()
    )
    ann_by_image: Dict[Any, List[PowerlineAnnotation]] = defaultdict(list)
    for a in all_annotations:
        ann_by_image[a.image_id].append(a)

    client_name = project.client.full_name if project.client else "—"
    primary_inspector = (getattr(project, "primary_inspector_name", None) or "—").strip() or "—"
    report_summary_text = (getattr(project, "report_summary", None) or "").strip()

    sev_counts: Dict[str, int] = {k: 0 for k in SEVERITY_ORDER}
    for a in all_annotations:
        sev = a.severity.value if hasattr(a.severity, "value") else str(a.severity)
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    tag_to_images: Dict[Optional[str], List[PowerlineImage]] = defaultdict(list)
    for img in images:
        tag_to_images[img.image_tag].append(img)
    sorted_tags = sorted(tag_to_images.keys(), key=_tag_sort_key)

    # Ordered list of (image, annotation) pairs grouped by tag then image
    ordered_anns: List[Tuple[PowerlineImage, PowerlineAnnotation]] = []
    for tag in sorted_tags:
        for img in tag_to_images[tag]:
            for ann in ann_by_image.get(img.id, []):
                ordered_anns.append((img, ann))

    # ── Page number map (arithmetic, no second pass needed) ────
    # Pages 1-4: cover, overview, TOC, annotation overview table
    # Pages 5+ : one page per annotation (forced by PageBreak)
    ANN_START_PAGE = 5
    ann_page_map: Dict[str, int] = {
        str(ann.id): ANN_START_PAGE + idx
        for idx, (_, ann) in enumerate(ordered_anns)
    }

    # ── Styles ─────────────────────────────────────────────────
    S = _make_styles()
    h1, h2, h3 = S["h1"], S["h2"], S["h3"]
    body, muted, small = S["body"], S["muted"], S["small"]
    toc_tag_style, toc_item_style = S["toc_tag"], S["toc_item"]

    # ── Build PDF ──────────────────────────────────────────────
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=1.8 * cm,
        rightMargin=1.8 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title=f"{project.name} Inspection Report",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")

    def _on_page(canv, _doc):
        canv.saveState()
        canv.setFont("Helvetica", 8)
        canv.setFillColor(colors.HexColor("#64748b"))
        canv.drawString(doc.leftMargin, 1.0 * cm, f"Powerline Inspection Report — {project.name}")
        canv.drawRightString(A4[0] - doc.rightMargin, 1.0 * cm, f"Page {canv.getPageNumber()}")
        # Legend pinned to bottom-left corner on page 2 (above footer)
        if canv.getPageNumber() == 2:
            x = doc.leftMargin
            line_h = 0.44 * cm
            n = len(SEVERITY_LEGEND)
            # Start high enough so all rows sit above the footer (1.5cm)
            y = 1.5 * cm + (n - 1) * line_h
            for key, short, desc in SEVERITY_LEGEND:
                col = SEVERITY_COLOR[key]
                canv.setFillColor(col)
                canv.rect(x, y - 0.01 * cm, 0.22 * cm, 0.22 * cm, fill=1, stroke=0)
                canv.setFillColor(colors.HexColor("#0f172a"))
                canv.setFont("Helvetica-Bold", 7)
                canv.drawString(x + 0.32 * cm, y, short)
                canv.setFont("Helvetica", 7)
                canv.setFillColor(colors.HexColor("#374151"))
                canv.drawString(x + 1.7 * cm, y, desc)
                y -= line_h
        canv.restoreState()

    doc.addPageTemplates([PageTemplate(id="default", frames=[frame], onPage=_on_page)])
    page_w = A4[0] - 2 * 1.8 * cm
    story = []

    # ── PAGE 1: Cover ──────────────────────────────────────────
    story.append(Spacer(1, 3 * cm))
    story.append(Paragraph("POWER TRANSMISSION LINE", ParagraphStyle(
        "kicker", parent=body, alignment=TA_CENTER,
        textColor=colors.HexColor("#2563eb"), fontSize=11, leading=13, spaceAfter=6,
    )))
    story.append(Paragraph("Inspection Report", ParagraphStyle(
        "title", parent=h1, alignment=TA_CENTER, fontSize=32, leading=38,
    )))
    story.append(Spacer(1, 1.2 * cm))
    cover_table = Table(
        [
            ["Project", project.name or "—"],
            ["Client", client_name],
            ["Location", project.location or "—"],
            ["Project Type", "Power Transmission Line"],
            ["Primary Inspector", primary_inspector],
            ["Total Images", str(len(images))],
            ["Total Annotations", str(len(all_annotations))],
            ["Generated", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")],
        ],
        colWidths=[5 * cm, 10 * cm],
    )
    cover_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#0f172a")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    story.append(cover_table)
    story.append(PageBreak())

    # ── PAGE 2: Project Overview ───────────────────────────────
    # Category cards — full page width, 6 equal columns
    card_w = page_w / 6
    sev_cells = []
    for k in SEVERITY_ORDER:
        col = SEVERITY_COLOR[k]
        hex_c = _sev_hex(k)
        short = SEVERITY_SHORT.get(k, k)
        cell_t = Table(
            [[Paragraph(f'<font color="{hex_c}"><b>{short}</b></font>',
                        ParagraphStyle("sc_l", parent=body, alignment=TA_CENTER, fontSize=9))],
             [Paragraph(f'<font color="{hex_c}"><b>{sev_counts.get(k, 0)}</b></font>',
                        ParagraphStyle("sc_c", parent=body, alignment=TA_CENTER, fontSize=15))]],
            colWidths=[card_w - 0.2 * cm],
        )
        cell_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 1, col),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 1), (-1, 1), 3, col),
        ]))
        sev_cells.append(cell_t)
    sev_strip = Table([sev_cells], colWidths=[card_w] * 6)
    sev_strip.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    # Sidebar info
    sidebar_data = [
        ["Inspection:", project.name or "—"],
        ["Report Date:", datetime.utcnow().strftime("%b %d, %Y")],
        ["Annotations:", str(len(all_annotations))],
        ["Images:", str(len(images))],
        ["Status:", project.status.value if hasattr(project.status, "value") else str(project.status)],
        ["Type:", "Power Line"],
        ["Company:", client_name],
        ["Inspector:", primary_inspector],
    ]
    sb_label_w = 2.6 * cm
    sb_val_w = page_w * 0.42 - sb_label_w
    sidebar_t = Table(sidebar_data, colWidths=[sb_label_w, sb_val_w])
    sidebar_t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#0f172a")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
    ]))

    # OSM Map
    geotagged = [(img.latitude, img.longitude) for img in images
                 if img.latitude is not None and img.longitude is not None]
    map_bytes = render_overview_map(geotagged) if geotagged else None
    map_w = page_w * 0.55
    map_h = 7.5 * cm
    if map_bytes:
        map_fl = _rl_image(map_bytes, map_w, map_h)
    elif geotagged:
        lines = [f"{lat:.5f}°, {lon:.5f}°" for lat, lon in geotagged[:10]]
        if len(geotagged) > 10:
            lines.append(f"… and {len(geotagged) - 10} more")
        map_fl = Paragraph("<br/>".join(lines), small)
    else:
        map_fl = Paragraph("<i>No GPS data available.</i>", muted)

    # Row 1: map (left) + sidebar (right)
    top_row = Table(
        [[map_fl, sidebar_t]],
        colWidths=[page_w * 0.55, page_w * 0.45],
    )
    top_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 10),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    # Summary
    sum_paras = []
    if report_summary_text:
        for para in report_summary_text.split("\n"):
            if para.strip():
                sum_paras.append(Paragraph(para.strip(), body))
                sum_paras.append(Spacer(1, 6))
    else:
        sum_paras.append(Paragraph("<i>No project summary provided.</i>", muted))

    story.append(top_row)
    story.append(Spacer(1, 10))
    story.append(Paragraph("Category Overview", h3))
    story.append(Spacer(1, 4))
    story.append(sev_strip)
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        f"{project.name} — Summary",
        ParagraphStyle("sum_h", parent=h3, fontName="Helvetica-Bold"),
    ))
    for p in sum_paras:
        story.append(p)
    story.append(PageBreak())

    # ── PAGE 3: Table of Contents ──────────────────────────────
    story.append(Paragraph("Contents", h2))
    story.append(Spacer(1, 8))
    if not all_annotations:
        story.append(Paragraph("No annotations recorded.", muted))
    else:
        for tag in sorted_tags:
            # First annotation index for this tag group
            first_idx = next(
                (i for i, (img2, _) in enumerate(ordered_anns) if img2.image_tag == tag),
                None,
            )
            if first_idx is None:
                continue
            pg = ANN_START_PAGE + first_idx
            dest = f"ann_{first_idx}"
            tag_label = (tag if tag else "Other (untagged)").title()
            toc_row = Table(
                [[
                    Paragraph(
                        f'<a href="#{dest}" color="#2563eb">{tag_label}</a>',
                        toc_tag_style,
                    ),
                    Paragraph(
                        f'<a href="#{dest}" color="#2563eb">{pg}</a>',
                        ParagraphStyle("pgn", parent=small, alignment=TA_RIGHT),
                    ),
                ]],
                colWidths=[page_w - 1.5 * cm, 1.5 * cm],
            )
            toc_row.setStyle(TableStyle([
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ]))
            story.append(toc_row)
    story.append(PageBreak())

    # ── PAGE 4: Annotation Overview Table ─────────────────────
    story.append(Paragraph("Annotation Overview", h2))
    story.append(Spacer(1, 8))
    if not ordered_anns:
        story.append(Paragraph("No annotations recorded for this inspection.", muted))
    else:
        ov_data = [["Id", "Severity", "Issues", "Page"]]
        for idx, (_, ann) in enumerate(ordered_anns):
            sev = ann.severity.value if hasattr(ann.severity, "value") else str(ann.severity)
            hex_c = _sev_hex(sev)
            pg = str(ann_page_map.get(str(ann.id), "—"))
            dest = f"ann_{idx}"
            ov_data.append([
                str(ann.id)[:8],
                Paragraph(f'<font color="{hex_c}"><b>{SEVERITY_SHORT.get(sev, sev)}</b></font>', body),
                Paragraph(
                    f'<a href="#{dest}" color="#2563eb">{ann.issue_type or "—"}</a>', body
                ),
                Paragraph(
                    f'<a href="#{dest}" color="#2563eb">{pg}</a>',
                    ParagraphStyle("pgn_ov", parent=body, alignment=TA_CENTER),
                ),
            ])
        ov_table = Table(ov_data, colWidths=[1.8 * cm, 3 * cm, 10.2 * cm, 1.5 * cm], repeatRows=1)
        ov_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ALIGN", (3, 0), (3, -1), "CENTER"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(ov_table)
    story.append(PageBreak())

    # ── PAGES 5+: Per-annotation detail pages ─────────────────
    crop_box_w = 6.5 * cm
    crop_box_h = 6.5 * cm
    full_box_w = page_w
    full_box_h = 9.5 * cm

    current_tag = object()
    for idx, (img, ann) in enumerate(ordered_anns):
        tag = img.image_tag
        sev = ann.severity.value if hasattr(ann.severity, "value") else str(ann.severity)
        hex_c = _sev_hex(sev)

        # Register named destination so TOC/overview links jump here
        story.append(_Dest(f"ann_{idx}"))

        if tag != current_tag:
            current_tag = tag
            tag_label = (tag if tag else "Other (untagged)").upper()
            story.append(Paragraph(
                f'<font color="#2563eb">— {tag_label} —</font>',
                ParagraphStyle("tag_sep", parent=body, alignment=TA_CENTER, fontSize=9,
                               textColor=colors.HexColor("#2563eb"), spaceBefore=0, spaceAfter=6),
            ))


        # Crop thumbnail + metadata
        crop_fl = _rl_image(_crop_with_box(img.file_path, ann) if img.file_path else None,
                            crop_box_w, crop_box_h)
        comp_tag = getattr(ann, "component_tag", None)
        meta_t = Table(
            [
                ["Annotation ID", str(ann.id)[:8]],
                ["Severity", SEVERITY_SHORT.get(sev, sev)],
                ["Component", comp_tag or "—"],
                ["Issue Type", ann.issue_type or "—"],
                ["Inspector", ann.inspector_name or "—"],
                ["Remedy Action", Paragraph(ann.remedy_action or "—", body)],
                ["Comment", Paragraph(ann.comment or "—", body)],
            ],
            colWidths=[3 * cm, page_w - crop_box_w - 3 * cm - 0.5 * cm],
        )
        meta_t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
        ]))
        top_row = Table([[crop_fl, meta_t]], colWidths=[crop_box_w, page_w - crop_box_w - 0.5 * cm])
        top_row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(top_row)
        story.append(Spacer(1, 10))

        # Full image with bounding box
        story.append(_rl_image(
            _full_image_with_box(img.file_path, ann) if img.file_path else None,
            full_box_w, full_box_h,
        ))
        story.append(Spacer(1, 6))

        # Image metadata strip
        img_meta = Table(
            [[
                Paragraph(f"<b>File</b><br/>{img.filename}", muted),
                Paragraph(f"<b>Date</b><br/>{_fmt(img.date_taken)}", muted),
                Paragraph(f"<b>Altitude</b><br/>{_fmt(img.altitude, ' m', 1)}", muted),
                Paragraph(f"<b>Heading</b><br/>{_fmt(img.heading, '°', 1)}", muted),
            ], [
                Paragraph(f"<b>GPS</b><br/>{_fmt_coord(img.latitude, img.longitude)}", muted),
                Paragraph(f"<b>Latitude</b><br/>{_fmt(img.latitude, '°', 6)}", muted),
                Paragraph(f"<b>Longitude</b><br/>{_fmt(img.longitude, '°', 6)}", muted),
                Paragraph(
                    f"<b>Image Type</b><br/>{img.image_type.value if hasattr(img.image_type, 'value') else (img.image_type or '—')}",
                    muted,
                ),
            ]],
            colWidths=[page_w * 0.34, page_w * 0.22, page_w * 0.22, page_w * 0.22],
        )
        img_meta.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(img_meta)

        if idx < len(ordered_anns) - 1:
            story.append(PageBreak())

    doc.build(story)
    _IMG_CACHE.clear()
    return buf.getvalue()
