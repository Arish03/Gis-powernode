"""Database seeding script – creates default admin and client users."""
from app.database import SessionLocal, engine
from app.models import Base, User, UserRole, ProcessingNode
from app.auth import hash_password


def run_migrations():
    """Run raw SQL migrations for changes that create_all cannot handle."""
    from sqlalchemy import text
    with engine.connect() as conn:
        # Add SUB_ADMIN to the userrole enum (Postgres enums are not auto-updated by create_all)
        try:
            conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'SUB_ADMIN'"))
            conn.commit()
        except Exception as e:
            print(f"  Enum migration note: {e}")

        # Add created_by column to projects table if it doesn't exist
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  Column migration note: {e}")

        # Add reviewer tracking columns
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id)"
            ))
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP"
            ))
            conn.commit()
        except Exception as e:
            print(f"  Review column migration note: {e}")

        # Create client-sub-admin assignment table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_sub_admin_assignments (
                    id UUID PRIMARY KEY,
                    client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sub_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_client_sub_admin_assignment UNIQUE (client_id, sub_admin_id)
                )
            """))
            conn.commit()
        except Exception as e:
            print(f"  Assignment table migration note: {e}")

        # Add plain_password column to users table
        try:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  plain_password column migration note: {e}")

        # Add last_edited_by column to projects table
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  last_edited_by column migration note: {e}")

        # Backfill plain passwords for seeded users
        try:
            conn.execute(text("UPDATE users SET plain_password = 'admin123' WHERE username = 'admin' AND plain_password IS NULL"))
            conn.execute(text("UPDATE users SET plain_password = 'client123' WHERE username = 'client' AND plain_password IS NULL"))
            conn.execute(text("UPDATE users SET plain_password = 'subadmin123' WHERE username = 'subadmin' AND plain_password IS NULL"))
            conn.commit()
        except Exception as e:
            print(f"  Backfill plain_password note: {e}")

        # Create processing_nodes table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS processing_nodes (
                    id UUID PRIMARY KEY,
                    hostname VARCHAR(255) NOT NULL,
                    port INTEGER NOT NULL DEFAULT 3000,
                    api_version VARCHAR(32) NOT NULL DEFAULT '',
                    queue_count INTEGER NOT NULL DEFAULT 0,
                    available_options TEXT NOT NULL DEFAULT '[]',
                    token VARCHAR(1024) NOT NULL DEFAULT '',
                    max_images INTEGER,
                    engine_version VARCHAR(32) NOT NULL DEFAULT '',
                    label VARCHAR(255) NOT NULL DEFAULT '',
                    last_refreshed TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_processing_node_host_port UNIQUE (hostname, port)
                )
            """))
            conn.commit()
        except Exception as e:
            print(f"  processing_nodes table migration note: {e}")

        # Add processing node columns to drone_processing_jobs
        try:
            conn.execute(text(
                "ALTER TABLE drone_processing_jobs ADD COLUMN IF NOT EXISTS processing_node_id UUID REFERENCES processing_nodes(id) ON DELETE SET NULL"
            ))
            conn.execute(text(
                "ALTER TABLE drone_processing_jobs ADD COLUMN IF NOT EXISTS auto_processing_node BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            conn.execute(text(
                "ALTER TABLE drone_processing_jobs ADD COLUMN IF NOT EXISTS pending_action INTEGER"
            ))
            conn.execute(text(
                "ALTER TABLE drone_processing_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()"
            ))
            conn.commit()
        except Exception as e:
            print(f"  drone_processing_jobs node columns migration note: {e}")

        # ── Project Groups tables (temporal analysis feature) ───────────
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS project_groups (
                    id UUID PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    location VARCHAR(300),
                    description TEXT,
                    client_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    reviewed_at TIMESTAMP,
                    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
                    processing_error TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS project_group_members (
                    id UUID PRIMARY KEY,
                    group_id UUID NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    timeline_index INTEGER NOT NULL,
                    flight_date TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_group_member_project UNIQUE (group_id, project_id),
                    CONSTRAINT uq_group_member_timeline UNIQUE (group_id, timeline_index)
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS unified_trees (
                    id UUID PRIMARY KEY,
                    group_id UUID NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
                    unified_index INTEGER NOT NULL,
                    baseline_latitude DOUBLE PRECISION,
                    baseline_longitude DOUBLE PRECISION,
                    baseline_geom geometry(Point, 4326),
                    first_seen_timeline_index INTEGER NOT NULL DEFAULT 0,
                    last_seen_timeline_index INTEGER NOT NULL DEFAULT 0,
                    current_status VARCHAR(32) NOT NULL DEFAULT 'PERSISTED',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS tree_observations (
                    id UUID PRIMARY KEY,
                    unified_tree_id UUID NOT NULL REFERENCES unified_trees(id) ON DELETE CASCADE,
                    tree_id UUID REFERENCES trees(id) ON DELETE CASCADE,
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    timeline_index INTEGER NOT NULL,
                    observation_type VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
                    height_m DOUBLE PRECISION,
                    health_status VARCHAR(32),
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_tree_obs_timeline UNIQUE (unified_tree_id, timeline_index)
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_unified_trees_group ON unified_trees(group_id)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_unified_trees_geom ON unified_trees USING GIST(baseline_geom)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_tree_observations_unified ON tree_observations(unified_tree_id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  project_groups tables migration note: {e}")

        # ── Powerline Inspection migrations ──────────────────────────────
        try:
            conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE projecttype AS ENUM ('TREE', 'POWERLINE');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """))
            conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE powerlineimagetype AS ENUM ('RGB', 'THERMAL');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """))
            conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE powerlineseverity AS ENUM ('S1', 'S2', 'S3', 'S4', 'S5', 'POI');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """))
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type projecttype NOT NULL DEFAULT 'TREE'"
            ))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS powerline_images (
                    id UUID PRIMARY KEY,
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    file_path VARCHAR(512) NOT NULL,
                    filename VARCHAR(255) NOT NULL,
                    width_px INTEGER,
                    height_px INTEGER,
                    altitude DOUBLE PRECISION,
                    heading DOUBLE PRECISION,
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    date_taken TIMESTAMP,
                    image_type powerlineimagetype NOT NULL DEFAULT 'RGB',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_powerline_images_project ON powerline_images(project_id)"
            ))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS powerline_annotations (
                    id UUID PRIMARY KEY,
                    image_id UUID NOT NULL REFERENCES powerline_images(id) ON DELETE CASCADE,
                    bbox_x DOUBLE PRECISION NOT NULL,
                    bbox_y DOUBLE PRECISION NOT NULL,
                    bbox_width DOUBLE PRECISION NOT NULL,
                    bbox_height DOUBLE PRECISION NOT NULL,
                    severity powerlineseverity NOT NULL DEFAULT 'S3',
                    issue_type VARCHAR(200),
                    remedy_action TEXT,
                    comment TEXT,
                    inspector_name VARCHAR(200),
                    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_powerline_annotations_image ON powerline_annotations(image_id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  powerline tables migration note: {e}")

        # ── Powerline tag columns & project-level summary fields ─────────
        try:
            conn.execute(text(
                "ALTER TABLE powerline_images ADD COLUMN IF NOT EXISTS image_tag VARCHAR(100)"
            ))
            conn.execute(text(
                "ALTER TABLE powerline_annotations ADD COLUMN IF NOT EXISTS component_tag VARCHAR(100)"
            ))
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS report_summary TEXT"
            ))
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS primary_inspector_name VARCHAR(200)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  powerline tag columns migration note: {e}")


def seed():
    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Run migrations for enum/column changes
    run_migrations()

    db = SessionLocal()
    try:
        # Check if admin already exists
        existing_admin = db.query(User).filter(User.username == "admin").first()
        if not existing_admin:
            admin = User(
                username="admin",
                password_hash=hash_password("admin123"),
                plain_password="admin123",
                full_name="System Administrator",
                role=UserRole.ADMIN,
            )
            client = User(
                username="client",
                password_hash=hash_password("client123"),
                plain_password="client123",
                full_name="Demo Client",
                role=UserRole.CLIENT,
            )
            db.add_all([admin, client])
            db.commit()
            print("Database seeded successfully!")
            print("  Admin: admin / admin123")
            print("  Client: client / client123")
        else:
            print("Database already seeded.")

        # Seed sub-admin if not exists
        existing_subadmin = db.query(User).filter(User.username == "subadmin").first()
        if not existing_subadmin:
            subadmin = User(
                username="subadmin",
                password_hash=hash_password("subadmin123"),
                plain_password="subadmin123",
                full_name="Sub Administrator",
                role=UserRole.SUB_ADMIN,
            )
            db.add(subadmin)
            db.commit()
            print("  Sub-Admin seeded: subadmin / subadmin123")

        # Seed default processing node (nodeodm from docker-compose)
        existing_node = db.query(ProcessingNode).filter(
            ProcessingNode.hostname == "nodeodm",
            ProcessingNode.port == 3000,
        ).first()
        if not existing_node:
            node = ProcessingNode(
                hostname="nodeodm",
                port=3000,
                label="Default NodeODM",
            )
            db.add(node)
            db.commit()
            print("  Default processing node seeded: nodeodm:3000")
        else:
            print("  Default processing node already exists.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
