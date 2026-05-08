# Detailed Implementation Prompt: Processing Node Management & Parallel Task Distribution System

## Overview

Build a **distributed processing node management system** that allows users to register multiple worker nodes, submit tasks, and have those tasks automatically load-balanced across available nodes with health monitoring, queue management, and a real-time UI.

---

## 1. Database Models

### `ProcessingNode` Model

```
Fields:
├── id              (AutoField, PK)
├── hostname        (CharField, max=255, unique together with port)
├── port            (IntegerField, default=3000)
├── api_version     (CharField, max=32, default="", blank)
├── queue_count     (IntegerField, default=0)  — number of active tasks on this node
├── available_options (JSONField, default=[], blank)  — capabilities the node supports
├── token           (CharField, max=1024, default="", blank)  — auth token
├── max_images      (IntegerField, help_text="max items this node can handle")
├── engine_version  (CharField, max=32, default="", blank)
├── label           (CharField, max=255, default="", blank)  — friendly display name
├── last_refreshed  (DateTimeField, null=True, blank)  — last successful health check
├── created_at      (DateTimeField, auto_now_add)
├── updated_at      (DateTimeField, auto_now)

Unique Constraint: (hostname, port)

Key Methods:
├── is_online()
│   → return last_refreshed >= now() - NODE_OFFLINE_MINUTES
│
├── find_best_available_node(user=None)   [class method]
│   → Filter nodes where is_online() == True
│   → Order by queue_count ASC
│   → Return first node (lowest queue)
│   → Raise NoNodesAvailable if none found
│
├── update_node_info()
│   → GET <hostname>:<port>/info
│   → Update api_version, queue_count, max_images, engine_version, available_options
│   → Set last_refreshed = now()
│   → Save
│
├── process_new_task(task)
│   → POST <hostname>:<port>/task/new  (multipart: files + options)
│   → Return external UUID from node
│
├── get_task_info(uuid)
│   → GET <hostname>:<port>/task/<uuid>/info
│   → Return status, progress, output
│
├── cancel_task(uuid)
│   → POST <hostname>:<port>/task/<uuid>/cancel
│
├── remove_task(uuid)
│   → POST <hostname>:<port>/task/<uuid>/remove
│
├── restart_task(uuid)
│   → POST <hostname>:<port>/task/<uuid>/restart
│
├── get_task_output(uuid, line=0)
│   → GET <hostname>:<port>/task/<uuid>/output?line=<line>
│
├── download_task_assets(uuid)
│   → GET <hostname>:<port>/task/<uuid>/download/all.zip
│
└── __str__()
    → return label or "hostname:port"
```

**Post-save signal**: On creation, automatically call `update_node_info()` in a background task.

### `Task` Model (relevant fields for node assignment)

```
Fields:
├── id                   (AutoField, PK)
├── name                 (CharField)
├── processing_node      (ForeignKey → ProcessingNode, null=True, blank)
├── auto_processing_node (BooleanField, default=True)  — auto-assign best node
├── uuid                 (CharField)  — external task UUID on the node
├── status               (IntegerField, choices: QUEUED=10, RUNNING=20, FAILED=30, COMPLETED=40, CANCELED=50)
├── pending_action       (IntegerField, null=True, choices: CANCEL=1, REMOVE=2, RESTART=3)
├── upload_progress      (FloatField, default=0.0)  — 0.0 to 1.0
├── options              (JSONField, default=[])
├── owner                (ForeignKey → User)
├── created_at           (DateTimeField, auto_now_add)
├── updated_at           (DateTimeField, auto_now)
```

---

## 2. REST API Endpoints

### Processing Nodes CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/processingnodes/` | List all nodes. Supports `?has_available_options=True` filter to exclude unconfigured nodes |
| `POST` | `/api/processingnodes/` | Create node `{hostname, port, label?, token?}` |
| `GET` | `/api/processingnodes/{id}/` | Get node detail |
| `PUT/PATCH` | `/api/processingnodes/{id}/` | Update node |
| `DELETE` | `/api/processingnodes/{id}/` | Remove node |
| `GET` | `/api/processingnodes/options/` | Get common options across ALL online nodes (intersection) |

### Serializer Fields

```json
{
  "id": 1,
  "hostname": "node-odm-1",
  "port": 3000,
  "api_version": "2.0.0",
  "queue_count": 2,
  "max_images": null,
  "available_options": [ { "name": "resolution", "type": "float", "value": "5", "help": "..." } ],
  "label": "GPU Node 1",
  "engine_version": "3.3.0",
  "online": true,
  "token": "abc123",
  "last_refreshed": "2026-04-16T10:30:00Z"
}
```

The `online` field is a computed `SerializerMethodField` that calls `is_online()`.

---

## 3. Task Assignment & Parallel Processing Logic

### a) Task Submission Flow

```
User submits task
  → if auto_processing_node == True:
       node = ProcessingNode.find_best_available_node(user)
       task.processing_node = node
       node.queue_count += 1
       node.save()
  → task.status = QUEUED
  → task.save()
```

### b) Background Scheduler (Celery Beat)

```python
CELERY_BEAT_SCHEDULE = {
    "update-nodes-info": {
        "task": "worker.tasks.update_nodes_info",
        "schedule": 30.0,          # every 30 seconds
    },
    "process-pending-tasks": {
        "task": "worker.tasks.process_pending_tasks",
        "schedule": 5.0,           # every 5 seconds
    },
}
```

### c) `update_nodes_info` Task

```
For each ProcessingNode:
    try:
        node.update_node_info()     # GET /info from the node
    except ConnectionError:
        pass  # node will go stale, is_online() returns False after NODE_OFFLINE_MINUTES
```

### d) `process_pending_tasks` Task

```
pending = Task.objects.filter(
    Q(processing_node__isnull=True, auto_processing_node=True, status=QUEUED) |  # needs assignment
    Q(status__in=[QUEUED, RUNNING]) |  # needs status update
    Q(pending_action__isnull=False)     # user requested cancel/restart/remove
)
for task in pending:
    process_task.delay(task.id)
```

### e) `process_task` Worker Task

```
Acquire Redis lock: "task_lock_{task_id}" (30-second TTL)
If lock not acquired, skip (another worker is handling it)

task = Task.objects.get(id=task_id)

# Handle pending actions first
if task.pending_action == CANCEL:
    task.processing_node.cancel_task(task.uuid)
    task.status = CANCELED
    task.save(); return

if task.pending_action == RESTART:
    task.processing_node.restart_task(task.uuid)
    task.uuid = None
    task.status = QUEUED
    task.save(); return

# If no node assigned yet
if task.processing_node is None and task.auto_processing_node:
    try:
        node = ProcessingNode.find_best_available_node(task.owner)
        task.processing_node = node
        task.save()
    except NoNodesAvailable:
        return  # retry next cycle

# If no UUID, upload files to node
if task.uuid is None:
    uuid = task.processing_node.process_new_task(task)
    task.uuid = uuid
    task.status = QUEUED
    task.save()

# Poll for status
info = task.processing_node.get_task_info(task.uuid)
if info.status == "RUNNING":
    task.status = RUNNING
    task.upload_progress = info.progress
elif info.status == "COMPLETED":
    task.status = COMPLETED
    task.processing_node.queue_count = max(0, task.processing_node.queue_count - 1)
    task.processing_node.save()
    # Download results
elif info.status == "FAILED":
    task.status = FAILED
    task.processing_node.queue_count = max(0, task.processing_node.queue_count - 1)
    task.processing_node.save()
task.save()

# If node went offline while task QUEUED — reassign
if task.status == QUEUED and not task.processing_node.is_online():
    task.processing_node.queue_count = max(0, task.processing_node.queue_count - 1)
    task.processing_node.save()
    task.processing_node = None
    task.uuid = None
    task.save()  # will be reassigned next cycle
```

---

## 4. Configuration Settings

```python
NODE_OFFLINE_MINUTES = 5           # Mark node offline after 5 min without health check
NODE_OPTIMISTIC_MODE = False       # True = skip health checks, assume always online
UI_MAX_PROCESSING_NODES = None     # Limit node count in UI dropdown (None = no limit)
PROCESS_PENDING_INTERVAL = 5       # Seconds between pending task scans
NODE_HEALTH_CHECK_INTERVAL = 30    # Seconds between node info refresh
TASK_LOCK_EXPIRE = 30              # Redis lock TTL in seconds
```

---

## 5. CLI Management Command: `addnode`

```bash
python manage.py addnode <hostname> <port> [--label <label>] [--token <token>]
```

Logic:

```
node, created = ProcessingNode.objects.get_or_create(
    hostname=hostname, port=port,
    defaults={"label": label, "token": token}
)
if not created:
    node.label = label or node.label
    node.token = token or node.token
    node.save()
node.update_node_info()
print(f"{'Created' if created else 'Updated'} node: {node}")
```

---

## 6. UI Elements

### a) Processing Node Admin Panel (Admin / Settings Page)

```
┌─────────────────────────────────────────────────────────────┐
│  Processing Nodes                              [+ Add Node] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🟢 GPU Node 1          Queue: 2    Engine: v3.3.0  │   │
│  │  node-odm-1:3000        Max Images: 5000            │   │
│  │  Last seen: 30 seconds ago          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🟢 CPU Node 2          Queue: 0    Engine: v3.3.0  │   │
│  │  node-odm-2:3000        Max Images: 2000            │   │
│  │  Last seen: 28 seconds ago          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🔴 Remote Node 3       Queue: -    Engine: -       │   │
│  │  192.168.1.50:3000      Max Images: -               │   │
│  │  Last seen: 12 minutes ago          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Each node card shows:
- **Status indicator**: Green circle (online) / Red circle (offline)
- **Label** or hostname:port as fallback
- **Queue count**: current active tasks
- **Engine version**: reported by the node
- **Max images**: capacity limit
- **Last seen**: humanized time since `last_refreshed`
- **Edit / Delete** action buttons

### b) Add/Edit Node Modal

```
┌──────────────────────────────────────┐
│  Add Processing Node            [×]  │
├──────────────────────────────────────┤
│                                      │
│  Label (optional)                    │
│  ┌────────────────────────────────┐  │
│  │ My GPU Node                    │  │
│  └────────────────────────────────┘  │
│                                      │
│  Hostname *                          │
│  ┌────────────────────────────────┐  │
│  │ node-odm-1                     │  │
│  └────────────────────────────────┘  │
│                                      │
│  Port *                              │
│  ┌────────────────────────────────┐  │
│  │ 3000                           │  │
│  └────────────────────────────────┘  │
│                                      │
│  Token (optional)                    │
│  ┌────────────────────────────────┐  │
│  │ ••••••••••••                   │  │
│  └────────────────────────────────┘  │
│                                      │
│         [Cancel]  [Save & Test]      │
│                                      │
└──────────────────────────────────────┘
```

- **Save & Test** button: saves node, then calls `update_node_info()` — shows success toast with engine version or error toast if unreachable.

### c) Task Creation Form — Node Selector Dropdown

```
┌──────────────────────────────────────────────────┐
│  Processing Node                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ ▼ Auto (GPU Node 1 - queue: 0)            │  │
│  ├────────────────────────────────────────────┤  │
│  │   Auto (select least busy)                │  │
│  │   ─────────────────────────────────        │  │
│  │   🟢 GPU Node 1       (queue: 0)          │  │
│  │   🟢 CPU Node 2       (queue: 3)          │  │
│  │   🔴 Remote Node 3    (offline)            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Processing Options                              │
│  ┌────────────────────────────────────────────┐  │
│  │  resolution: [5      ]  (Ground res cm/px) │  │
│  │  quality:    [▼ high ]  (Processing qual)  │  │
│  │  ☑ use-3dmesh                              │  │
│  │  ...dynamically loaded from node options   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│              [Cancel]   [Start Processing]       │
└──────────────────────────────────────────────────┘
```

Key behaviors:
- **"Auto"** option (default): sets `auto_processing_node=True`, system picks least-busy node
- Dropdown fetches from `GET /api/processingnodes/?has_available_options=True`
- Each option shows: status dot, label, queue count
- Offline nodes are shown greyed out / disabled
- When a specific node is selected, the **Processing Options** section reloads to show only that node's `available_options`
- If node's `max_images` is set, validate file count before submission

### d) Task List Item — Processing Status

```
┌──────────────────────────────────────────────────────────┐
│  📋 Task: Aerial Survey Block A                          │
│  Node: GPU Node 1 (node-odm-1:3000)                     │
│  Status: ██████████░░░░░░░░░░ 52% RUNNING               │
│  Queued: 2 min ago        [Cancel] [Restart] [Remove]   │
└──────────────────────────────────────────────────────────┘
```

Shows:
- Task name
- Assigned node label & hostname
- Progress bar with percentage (from `upload_progress` or node-reported progress)
- Status badge: QUEUED (yellow), RUNNING (blue), COMPLETED (green), FAILED (red), CANCELED (grey)
- Action buttons based on state

---

## 7. Tech Stack Requirements

| Layer | Technology |
|-------|------------|
| Backend framework | Django (or any Python web framework) |
| REST API | Django REST Framework |
| Task queue | Celery + Redis (broker & result backend) |
| Scheduler | Celery Beat |
| Database | PostgreSQL |
| Distributed lock | Redis (for task-level locking) |
| Frontend | React (or any SPA framework) |
| HTTP client | `requests` library (backend → node communication) |
| Worker nodes | Any HTTP API service running on configurable host:port |

---

## 8. Docker Compose for Scaling Nodes

```yaml
version: '3'
services:
  web:
    build: .
    ports: ["8000:8000"]
    depends_on: [db, redis]
    environment:
      - NODE_OFFLINE_MINUTES=5

  celery-worker:
    build: .
    command: celery -A myproject worker -l info --concurrency=4
    depends_on: [db, redis]

  celery-beat:
    build: .
    command: celery -A myproject beat -l info
    depends_on: [db, redis]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: myproject
      POSTGRES_PASSWORD: secret

  # Processing nodes — scale with: docker-compose up -d --scale worker-node=5
  worker-node:
    image: your-worker-node-image
    expose: ["3000"]
```

Then register nodes:

```bash
# Auto-discover scaled containers
for i in $(seq 1 $NUM_NODES); do
  python manage.py addnode "myproject-worker-node-$i" 3000
done
```

---

## 9. Worker Node API Contract

Each processing node must expose this HTTP API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/info` | GET | Returns `{version, maxImages, queueCount, availableOptions, engineVersion}` |
| `/task/new` | POST | Multipart upload: files + options JSON. Returns `{uuid}` |
| `/task/{uuid}/info` | GET | Returns `{status, progress, output}` |
| `/task/{uuid}/output?line=N` | GET | Returns console output from line N |
| `/task/{uuid}/cancel` | POST | Cancel task |
| `/task/{uuid}/restart` | POST | Restart task |
| `/task/{uuid}/remove` | POST | Remove task and artifacts |
| `/task/{uuid}/download/all.zip` | GET | Download result archive |

---

This spec covers the full backend architecture (models, API, Celery scheduling, load balancing, health monitoring), the worker node contract, the CLI tooling, the Docker scaling strategy, and every UI element (node admin panel, add/edit modal, task form with node selector dropdown, and task status display). Adapt the worker node API contract to match whatever your processing service exposes.
