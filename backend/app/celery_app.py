import redis
from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "plantation",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "update-nodes-info": {
            "task": "update_nodes_info",
            "schedule": 15.0,
        },
        "process-pending-tasks": {
            "task": "process_pending_tasks",
            "schedule": 5.0,
        },
        "recover-stalled-jobs": {
            "task": "recover_stalled_jobs",
            "schedule": 60.0,
        },
    },
)

# Auto-discover tasks
celery_app.autodiscover_tasks(["app"])
