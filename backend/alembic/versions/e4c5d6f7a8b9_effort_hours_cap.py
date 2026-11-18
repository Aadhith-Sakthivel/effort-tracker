"""raise effort hours check constraint 100 -> 9999

Whole-team daily totals can legitimately exceed 100h (headcount × 8), so the old
per-row cap of 100 was too low. The app still enforces the real business cap.

Revision ID: e4c5d6f7a8b9
Revises: d3b4c5e6f7a8
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e4c5d6f7a8b9"
down_revision: Union[str, None] = "d3b4c5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only Postgres enforces the check + Numeric precision. SQLite (local dev) has no
    # such check and no numeric enforcement, so there's nothing to change there.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE effort DROP CONSTRAINT IF EXISTS ck_effort_hours")
        op.execute("ALTER TABLE effort ADD CONSTRAINT ck_effort_hours CHECK (hours >= 0 AND hours <= 9999)")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE effort DROP CONSTRAINT IF EXISTS ck_effort_hours")
        op.execute("ALTER TABLE effort ADD CONSTRAINT ck_effort_hours CHECK (hours >= 0 AND hours <= 100)")
