"""Extra named documentation links on enhancements

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-11-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e0f1a2b3c4d5"
down_revision: Union[str, None] = "d9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "enh_link",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("enhancement_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["enhancement_id"], ["enhancement.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_enhlink_enh", "enh_link", ["enhancement_id"])


def downgrade() -> None:
    op.drop_index("ix_enhlink_enh", table_name="enh_link")
    op.drop_table("enh_link")
