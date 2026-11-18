"""kind on enh_comment (comment | status) for inline status-change entries

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-11-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("enh_comment", sa.Column("kind", sa.String(), nullable=False, server_default="comment"))


def downgrade() -> None:
    op.drop_column("enh_comment", "kind")
