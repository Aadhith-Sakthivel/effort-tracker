"""performance indexes

Adds indexes on the hot filter/sort columns so queries stay fast as effort,
enhancement, and audit rows grow. Idempotent (CREATE INDEX IF NOT EXISTS), so it
is safe on DBs that already have some of these (e.g. the legacy effort indexes).

Revision ID: b1f2c3d4e5a6
Revises: 72ca52515395
Create Date: 2026-11-04
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b1f2c3d4e5a6"
down_revision: Union[str, None] = "72ca52515395"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name -> (table, columns). CREATE INDEX IF NOT EXISTS works on both SQLite and Postgres.
INDEXES = {
    "ix_effort_enh": ("effort", "enhancement_id"),
    "ix_effort_date": ("effort", "work_date"),
    "ix_effort_res": ("effort", "resource_id"),
    "ix_enh_status": ("enhancement", "status_code"),
    "ix_enh_active": ("enhancement", "active"),
    "ix_audit_entity": ("audit_log", "entity_type, entity_id"),
    "ix_audit_changed": ("audit_log", "changed_at"),
}


def upgrade() -> None:
    for name, (table, cols) in INDEXES.items():
        op.execute(f'CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})')


def downgrade() -> None:
    for name in INDEXES:
        op.execute(f'DROP INDEX IF EXISTS {name}')
