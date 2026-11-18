"""Custom groups (per-enhancement) and support-comment activity kind

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("grp", sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("grp", sa.Column("owner_enhancement_id", sa.Integer(), nullable=True))
    op.add_column("support_comment", sa.Column("kind", sa.String(), nullable=False, server_default="comment"))


def downgrade() -> None:
    op.drop_column("support_comment", "kind")
    op.drop_column("grp", "owner_enhancement_id")
    op.drop_column("grp", "is_custom")
