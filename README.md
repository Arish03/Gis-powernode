# 🌲 Plantation & Tree Analytics Dashboard

A full-stack GIS platform for **precision forestry management**. Upload drone imagery, trigger automated photogrammetry via OpenDroneMap, detect individual trees with a YOLOv9 model, compute per-tree canopy heights from a CHM (DSM − DTM), classify vegetation health using VARI and GCC indices, and explore everything through an interactive MapLibre GL JS dashboard — all in a single Docker Compose stack.

---

## Key Features

- **Automated drone processing pipeline** — upload raw drone images, queue a NodeODM photogrammetry job, and receive ortho/DSM/DTM GeoTIFFs automatically
- **AI tree detection** — YOLOv9 ONNX model slides over the ortho in tiled windows; custom largest-box NMS deduplicates tile-edge detections
- **Per-tree canopy height** — CHM = DSM − DTM; height extracted per bounding-box centroid
- **Vegetation health classification** — VARI and GCC indices computed per-tree from the ortho; trees labelled Healthy / Moderate / Poor
- **Dynamic vegetation index tile server** — server-side 256 × 256 PNG tiles rendered on demand for any supported VI (GCC, VARI, NDVI, GNDVI, ExG, NGRDI, VARI, MGRVI, RCC) with configurable colour palettes
- **Interactive map view** — MapLibre GL JS with switchable base layers (ortho, DTM, DSM), vector tree overlays, boundary polygon, height gradient, and VI heat-maps
- **Role-based access control** — three roles (ADMIN, SUB_ADMIN, CLIENT); SUB_ADMINs manage assigned clients; CLIENTs can only view their own projects
- **Processing node management** — ADMIN can register multiple NodeODM endpoints; Celery Beat polls node health and routes jobs automatically
- **Manual data import** — staff can upload pre-processed shapefiles (boundary, tree inventory, health data) as an alternative to drone processing
- **KPI analytics** — per-project tree count, mean height, health breakdown, area in hectares visualised with Recharts

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite 5, MapLibre GL JS 4, Tailwind CSS 3, Recharts, Axios, react-router-dom v6 |
| **Backend** | FastAPI 0.115, Python 3.11, SQLAlchemy 2.0, GeoAlchemy2, Pydantic v2 |
| **Database** | PostgreSQL 16 + PostGIS 3.4 |
| **Task Queue** | Celery 5.4 + Redis 7 |
| **Geospatial** | GDAL 3.6, Rasterio, GeoPandas, Shapely, PyProj |
| **AI / CV** | ONNX Runtime, YOLOv9 (`.onnx`), OpenCV, NumPy |
| **Photogrammetry** | NodeODM (OpenDroneMap) |
| **Auth** | JWT (python-jose) + bcrypt (passlib) |
| **Deployment** | Docker Compose, nginx (reverse proxy + static file serving) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (5000)                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ MapLibre  │  │ LayerControl │  │  Analytics   │  │  Admin    │  │
│  │ GL JS     │  │ + VI Legend  │  │  Charts      │  │  Wizard   │  │
│  └─────┬─────┘  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│        └───────────────┴────────────────┴────────────────┘         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ nginx reverse proxy
┌──────────────────────────────┴──────────────────────────────────────┐
│                       FastAPI Backend (8080)                        │
│  ┌────────────┐  ┌───────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Auth (JWT) │  │ Projects  │  │ Trees & GIS  │  │ VI Tiles   │  │
│  │ /api/auth  │  │ /api/proj │  │ /api/../trees│  │ /tiles/vi  │  │
│  └────────────┘  └───────────┘  └──────────────┘  └────────────┘  │
│            │                │               │                      │
│  ┌─────────┴────────────────┴───────────────┴──────────────────┐   │
│  │              Static XYZ Tiles (/tiles/{id}/{type})          │   │
│  │              ortho / dtm / dsm — pre-generated PNG tiles    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────┬───────────────────────┬────────────────────────────────────┘
        │                       │
┌───────┴───────┐  ┌────────────┴──────────────┐  ┌──────────────────┐
│  PostgreSQL   │  │     Celery Worker         │  │    NodeODM       │
│  + PostGIS    │  │  ┌──────────────────────┐ │  │  (OpenDroneMap)  │
│               │  │  │ Drone Processing     │ │  │                  │
│  users        │  │  │ GDAL Tile Generation │ │  │  Photogrammetry  │
│  projects     │  │  │ YOLOv9 Tree Detect   │ │  │  → ortho, dsm,  │
│  trees (geom) │  │  │ CHM Height Extract   │ │  │    dtm outputs   │
│  drone_jobs   │  │  │ VARI+GCC Health      │ │  │                  │
│               │  │  └──────────────────────┘ │  │                  │
└───────────────┘  └───────────┬───────────────┘  └──────────────────┘
                               │
                        ┌──────┴──────┐
                        │    Redis    │
                        │  (broker)   │
                        └─────────────┘
```

### Services (Docker Compose)

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| **Frontend** | `plantation-frontend` | 5000 | React/Vite app served by nginx, proxies `/api` and `/tiles` to backend |
| **Backend** | `plantation-backend` | 8080 | FastAPI REST API, serves static tiles + dynamic VI tiles |
| **Celery Worker** | `plantation-celery` | — | Background processing: photogrammetry, tiling, detection, health |
| **Celery Beat** | `plantation-celery-beat` | — | Periodic tasks: node health polling, stalled job recovery |
| **PostgreSQL** | `plantation-db` | 5433 | PostGIS database for users, projects, trees (point geometries) |
| **Redis** | `plantation-redis` | 6380 | Celery task broker and result backend |
| **NodeODM** | `plantation-nodeodm` | 3000 (internal) | OpenDroneMap photogrammetry engine |

### Processing Pipeline

```
Drone Images → NodeODM Photogrammetry → ortho.tif + dsm.tif + dtm.tif
                                              │
                    ┌─────────────────────────┤
                    ▼                         ▼
            GDAL gdal2tiles.py          CHM = DSM − DTM
            → XYZ tile pyramids               │
              (zoom 10-22)              ┌─────┤
                                        ▼     ▼
                                  YOLOv9   Height Extraction
                                  Tree     per bbox from CHM
                                  Detection
                                        │
                                        ▼
                                  VARI + GCC
                                  Health Classification
                                  per tree from ortho
                                        │
                                        ▼
                                  PostGIS (trees table)
```

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Docker Compose v2)
- `curl` or `wget` (for model download)
- `unzip` (for model extraction)
- ~8 GB RAM recommended (NodeODM is memory-intensive)
- ~2 GB free disk space for the YOLOv9 model and Docker images

### Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd GIS

# 2. Download the YOLOv9 tree detection model (~194 MB)
./setup.sh

# 3. Start all services (first run builds images ~5-10 min)
./start.sh
```

> **Note:** `start.sh` will automatically run `setup.sh` if the model file is missing, so you can skip step 2 if you prefer.

### URLs

| URL | Description |
|-----|-------------|
| http://localhost:5000 | Frontend dashboard |
| http://localhost:8080/api/docs | Swagger API documentation (interactive) |

### Default Credentials

Auto-seeded on first startup:

| Role | Username | Password | Access |
|------|----------|----------|--------|
| Admin | `admin` | `admin123` | Full system access |
| Sub-Admin | `subadmin` | `subadmin123` | Manage assigned client portfolios |
| Client | `client` | `client123` | View own ready projects only |

> **Important:** Change these credentials in production. Update `JWT_SECRET` in your environment as well.

### Shell Scripts

```bash
./setup.sh                           # Download YOLOv9 model to tools/assets/
./start.sh                           # Start services (no rebuild, auto-downloads model)
./deploy.sh                          # Rebuild all + restart
./deploy.sh --service backend        # Rebuild only backend
./deploy.sh --service backend --service frontend
./deploy.sh --push                   # Git push + rebuild all
./stop.sh                            # Stop all services
```

---

## Project Structure

```
GIS/
├── docker-compose.yml          # 6 services: db, redis, nodeodm, backend, celery, frontend
├── start.sh                    # Start without rebuild
├── deploy.sh                   # Build + deploy (supports --service, --push)
├── stop.sh                     # Stop all services
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # FastAPI app, mounts routers + static tiles
│       ├── models.py           # SQLAlchemy: User, Project, Tree, DroneProcessingJob
│       ├── schemas.py          # Pydantic request/response models
│       ├── auth.py             # JWT token creation + verification
│       ├── config.py           # Settings (DB, Redis, upload paths)
│       ├── database.py         # SQLAlchemy engine + session
│       ├── celery_app.py       # Celery configuration
│       ├── seed.py             # Auto-seed admin + client users
│       ├── tasks.py            # Pipeline: photogrammetry → tiling → detection → heights → health
│       ├── vegetation.py       # VI engine: 12 indices, 5 palettes, dynamic tile renderer
│       └── routers/
│           ├── auth.py         # Login, token refresh
│           ├── users.py        # User CRUD (admin)
│           ├── projects.py     # Project CRUD + boundary save + tree clipping
│           ├── trees.py        # Trees GeoJSON, analytics, manual annotation, height calc
│           ├── upload.py       # Drone image upload → Celery pipeline
│           └── vegetation.py   # VI metadata endpoint + dynamic tile endpoint
│
└── frontend/
    ├── Dockerfile              # Multi-stage: Vite build → nginx serve
    ├── nginx.conf              # Reverse proxy /api → backend, /tiles → backend
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx             # Router: /login, /admin/*, /client/*
        ├── index.css           # Global styles, map legends, VI controls
        ├── main.jsx            # Entry point
        ├── api/client.js       # Axios instance with JWT interceptor
        ├── contexts/
        │   └── AuthContext.jsx  # Auth state, login/logout, role-based routing
        ├── components/
        │   ├── Navbar.jsx
        │   ├── ProtectedRoute.jsx
        │   ├── ConfirmModal.jsx
        │   ├── LayerController.jsx     # Base map selector (ortho/dtm/dsm/plant health) + overlays
        │   ├── TreeAnnotationPanel.jsx # Review: bbox draw/move/resize, boundary draw, tree CRUD
        │   └── DroneUploadPanel.jsx    # Drag-drop drone image upload with progress
        └── pages/
            ├── LoginPage.jsx
            ├── admin/
            │   ├── AdminDashboard.jsx  # KPI cards, client grid, project stats
            │   ├── AdminClients.jsx    # Client user management (create/edit/delete)
            │   ├── AdminSubAdmins.jsx  # Sub-admin management + client assignment
            │   ├── ClientProjects.jsx  # Per-client project listing
            │   ├── ProjectWizard.jsx   # 4-step: create → upload → process → review
            │   └── ProjectEdit.jsx     # Post-creation tree review/annotation
            └── client/
                ├── MapView.jsx         # Interactive map: base layers, overlays, VI tiles, legends
                └── AnalyticsView.jsx   # Charts: health breakdown, height distribution, stats
│
├── tools/                              # Standalone ML/GIS utility scripts
│   ├── detectv2.py                     # YOLOv9 tree detection on GeoTIFF tiles
│   ├── chm.py                          # Canopy Height Model: CHM = DSM − DTM
│   ├── mean_hight.py                   # Extract tree heights from CHM per bbox
│   ├── split.py                        # Slice large GeoTIFFs into overlapping tiles
│   └── assets/
│       └── yolov9_trees.onnx           # YOLOv9 ONNX model (downloaded via setup.sh)
│
└── logo/                               # Project branding assets
```

---

## Features

### Drone Processing Pipeline
- Upload raw drone images → NodeODM generates orthomosaic, DSM, DTM
- Automatic XYZ tile generation at zoom levels 10–22 via GDAL
- CHM (Canopy Height Model) computed as DSM − DTM

### AI Tree Detection
- YOLOv9 object detection model (ONNX) identifies individual trees from ortho
- Bounding boxes mapped from pixel to geographic coordinates
- Height extracted per tree from CHM raster

### Health Classification
- Dual-index classification per tree: **VARI** (primary) + **GCC** (secondary)
- Thresholds: Healthy (VARI>0.1 & GCC>0.35), Moderate (VARI>0 & GCC≥0.30), Poor

### Plant Health Visualization
- Server-side vegetation index tile rendering (6 RGB indices: GCC, VARI, EXG, GLI, MPRI, vNDVI)
- 5 color palettes (rdylgn, spectral, viridis, jet, magma)
- Selectable as base map with formula + palette controls and color legend

### Manual Tree Annotation (Review Panel)
- Draw bounding boxes for missed trees
- Move and resize existing bboxes with corner handles
- Delete trees with automatic renumbering
- Batch height/health calculation for pending trees

### Boundary Drawing
- Draw field boundary polygon in review panel
- Save boundary → auto-remove trees outside → renumber remaining
- Boundary displayed in MapView as cyan overlay

### Interactive Map (Client View)
- Base maps: Orthomosaic, DTM, DSM, Plant Health (VI)
- Overlays: Plantation boundary, tree locations, health markers, height heatmap
- Click-to-inspect tree popups with height, health, coordinates

### Analytics Dashboard
- Tree count, average height, health score
- Health breakdown (pie/donut chart)
- Height distribution (histogram)

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login → JWT token |
| GET | `/api/auth/me` | Get current user info |

### Users (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/clients` | List clients (sub-admins see assigned only) |
| GET | `/api/users/sub-admins` | List sub-admins |
| PUT | `/api/users/clients/{id}/sub-admins` | Assign sub-admins to a client |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects |
| GET | `/api/projects/{id}` | Get project detail |
| POST | `/api/projects` | Create project (admin) |
| PUT | `/api/projects/{id}` | Update project (admin) |
| DELETE | `/api/projects/{id}` | Delete project + files (admin) |
| POST | `/api/projects/{id}/boundary` | Save boundary, clip trees outside |

### Trees & Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{id}/trees` | GeoJSON FeatureCollection of all trees |
| GET | `/api/projects/{id}/trees/list` | Filterable tree list |
| GET | `/api/projects/{id}/analytics` | Aggregated stats + charts data |
| POST | `/api/projects/{id}/trees/manual` | Create tree with height/health computation |
| POST | `/api/projects/{id}/trees/manual/bbox` | Create tree bbox only (no computation) |
| PUT | `/api/projects/{id}/trees/{tid}/bbox` | Move/resize tree bbox |
| DELETE | `/api/projects/{id}/trees/{tid}` | Delete tree + renumber |
| POST | `/api/projects/{id}/trees/calculate-heights` | Batch compute pending trees |

### Upload & Processing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/{id}/drone-images` | Upload drone images → start pipeline |
| GET | `/api/upload/{id}/processing-status` | Poll processing status |

### Vegetation Index
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{id}/vegetation-indices` | Available indices + palettes |
| GET | `/tiles/{id}/vi/{z}/{x}/{y}.png` | Dynamic VI tile (query: `index`, `palette`) |

### Tile Serving
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tiles/{id}/ortho/{z}/{x}/{y}.png` | Orthomosaic tiles |
| GET | `/tiles/{id}/dtm/{z}/{x}/{y}.png` | DTM tiles |
| GET | `/tiles/{id}/dsm/{z}/{x}/{y}.png` | DSM tiles |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://plantation_user:plantation_pass@postgres:5432/plantation` | PostGIS connection |
| `REDIS_URL` | `redis://redis:6379/0` | Celery broker |
| `JWT_SECRET` | `plantation-jwt-secret-change-in-prod` | JWT signing key |
| `UPLOAD_DIR` | `/app/uploads` | Uploaded files + processed rasters |
| `TILES_DIR` | `/app/tiles` | Generated XYZ tile pyramids |
| `NODEODM_URL` | `http://nodeodm:3000` | NodeODM photogrammetry endpoint |
| `YOLO_MODEL_PATH` | `/app/models/yolov9_trees.onnx` | Tree detection model |

---

## Data Volumes

| Volume | Mount | Content |
|--------|-------|---------|
| `pgdata` | PostgreSQL data dir | Database files |
| `uploads` | `/app/uploads` | ortho.tif, dsm.tif, dtm.tif, chm.tif per project |
| `tiles` | `/app/tiles` | Pre-generated XYZ PNG tile pyramids |
| `odm_data` | NodeODM data dir | Photogrammetry working files |

---

## User Roles & Access Control

The platform uses a three-tier role hierarchy with JWT-based authentication:

| Role | Portal | Capabilities |
|------|--------|-------------|
| **Admin** | `/admin/*` | Full system access — manage all users, all projects, create clients & sub-admins |
| **Sub-Admin** | `/admin/*` | Staff account — manage projects of assigned clients only, upload & process data |
| **Client** | `/client/*` | View-only access to their own projects in `READY` status |

### Role-Based Visibility

- **Admin** sees all projects across all clients
- **Sub-Admin** sees only projects belonging to their assigned clients
- **Client** sees only their own projects that have status `READY`

### User Management

- Admins can create/edit/delete **Client** and **Sub-Admin** accounts from the Admin Dashboard
- Sub-Admins are assigned to clients via the **AdminSubAdmins** page
- One sub-admin can manage multiple clients; one client can have multiple sub-admins

---

## Workflow Guide

### For Admins / Sub-Admins

1. **Create a client account** via Admin Dashboard → Clients
2. **Create a new project** → Project Wizard (Step 1: name, location, assign to client)
3. **Upload drone images** → Project Wizard (Step 2: drag-drop images)
4. **Start processing** → Project Wizard (Step 3: monitor 5-stage pipeline)
   - Processing → Downloading → Tiling → Detecting Trees → Computing Heights
5. **Review results** → Project Edit page
   - Inspect detected trees on the map
   - Draw/move/resize bounding boxes for missed or incorrect trees
   - Draw field boundary polygon → auto-clips trees outside
6. **Mark as ready** → Project becomes visible to the assigned client

### For Clients

1. **Login** with provided credentials
2. **Select a project** from the project list
3. **Map View** → Toggle layers (ortho, DTM, DSM, plant health), click trees for details
4. **Analytics View** → View KPIs, health breakdown chart, height distribution, tree inventory table

---

## ML & GIS Tools

Standalone scripts in `tools/` for batch processing outside the web pipeline:

| Script | Purpose |
|--------|---------|
| `detectv2.py` | Run YOLOv9 inference on a GeoTIFF orthomosaic. Outputs tree bounding boxes in geographic coordinates. Uses custom NMS that prioritizes larger boxes (handles tile-edge cutoffs). |
| `chm.py` | Compute Canopy Height Model: `CHM = DSM − DTM`. Reprojects DTM to DSM grid, clips negatives to 0. Outputs GeoTIFF with LZW compression. |
| `mean_hight.py` | Extract tree heights from CHM raster using bounding boxes. Uses 98th percentile (robust to spikes) with crown isolation (top 80% of apex). Outputs Excel. |
| `split.py` | Slice large GeoTIFFs into overlapping tiles (20% overlap). Preserves geo-referencing per tile. |

### YOLOv9 Model

The tree detection model (`yolov9_trees.onnx`) is downloaded automatically via `setup.sh` from:
```
https://chmura.put.poznan.pl/public.php/dav/files/A9zdp4mKAATEAGu/?accept=zip
```

---

## Vegetation Index Engine

The platform supports 12 vegetation indices with server-side tile rendering:

### RGB-Only Indices (available for all projects)

| Index | Full Name | Formula |
|-------|-----------|---------|
| GCC | Green Chromatic Coordinate | `G / (R + G + B)` |
| VARI | Visible Atmospherically Resistant Index | `(G − R) / (G + R − B)` |
| EXG | Excess Green | `2G − R − B` |
| GLI | Green Leaf Index | `(2G − R − B) / (2G + R + B)` |
| MPRI | Modified Photochemical Reflectance Index | `(G − R) / (G + R)` |
| vNDVI | Visible NDVI (RGB approximation) | `0.402×nG² − 0.006×nR×nG` |

### NIR-Enabled Indices (when multispectral data available)

| Index | Full Name |
|-------|-----------|
| NDVI | Normalized Difference Vegetation Index |
| GNDVI | Green Normalized Difference Vegetation Index |
| SAVI | Soil Adjusted Vegetation Index |
| EVI | Enhanced Vegetation Index |
| ENDVI | Enhanced Normalized Difference Vegetation Index |
| LAI | Leaf Area Index (derived from NDVI) |

### Color Palettes

5 built-in palettes: `rdylgn` (default), `spectral`, `viridis`, `jet`, `magma`

---

## Development

### Running Without Docker

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL=postgresql://user:pass@localhost:5432/plantation
export REDIS_URL=redis://localhost:6379/0
export JWT_SECRET=dev-secret
export UPLOAD_DIR=./uploads
export TILES_DIR=./tiles
export YOLO_MODEL_PATH=../tools/assets/yolov9_trees.onnx
export NODEODM_URL=http://localhost:3000

uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

**Celery Worker:**
```bash
cd backend
celery -A app.celery_app worker --loglevel=info --concurrency=2
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # Vite dev server on http://localhost:5173
```

### Rebuilding Individual Services

```bash
docker compose up -d --build backend          # Rebuild only backend
docker compose up -d --build frontend         # Rebuild only frontend
docker compose up -d --build celery-worker    # Rebuild celery worker
```

### Viewing Logs

```bash
docker compose logs -f                  # All services
docker compose logs -f backend          # Backend only
docker compose logs -f celery-worker    # Celery tasks
docker compose logs -f nodeodm          # Photogrammetry engine
```

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| **Port already in use** | Stop conflicting services or change ports in `docker-compose.yml` |
| **NodeODM takes too long to start** | Normal — it has a 120s start period. Check with `docker compose logs nodeodm` |
| **Processing stuck** | Check Celery logs: `docker compose logs celery-worker`. Ensure NodeODM is healthy. |
| **Model file missing** | Run `./setup.sh` to download the YOLOv9 model |
| **Database connection refused** | Ensure PostgreSQL is healthy: `docker compose ps`. Check port 5433. |
| **Tiles not rendering** | Verify tiles exist: `docker compose exec backend ls /app/tiles/<project_id>/` |
| **Git push fails (LFS 413)** | Large model files are gitignored. Use `setup.sh` to download instead. |
| **Out of memory during processing** | NodeODM + Celery need ~8 GB RAM. Reduce `--concurrency` in celery if needed. |
| **Login not working** | Database may not be seeded. Restart backend: `docker compose restart backend` |

---

## Common Operations

```bash
# View logs
docker compose logs -f backend
docker compose logs -f celery-worker

# Rebuild single service
./deploy.sh --service backend

# Access database
docker compose exec postgres psql -U plantation_user -d plantation

# Check tree count for a project
docker compose exec postgres psql -U plantation_user -d plantation \
  -c "SELECT COUNT(*) FROM trees WHERE project_id = '<uuid>';"

# Restart processing worker
docker compose restart celery-worker
```
