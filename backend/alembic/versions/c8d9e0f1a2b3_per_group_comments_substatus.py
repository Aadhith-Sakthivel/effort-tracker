"""Per-group comments and per-group sub-status for enhancements

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "enh_comment",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("enhancement_id", sa.Integer(), nullable=False),
        sa.Column("grp_code", sa.String(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["enhancement_id"], ["enhancement.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grp_code"], ["grp.code"]),
    )
    op.create_index("ix_enhcomment_enh", "enh_comment", ["enhancement_id"])
    op.create_table(
        "enh_group_state",
        sa.Column("enhancement_id", sa.Integer(), nullable=False),
        sa.Column("grp_code", sa.String(), nullable=False),
        sa.Column("sub_status_code", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["enhancement_id"], ["enhancement.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grp_code"], ["grp.code"]),
        sa.ForeignKeyConstraint(["sub_status_code"], ["sub_status.code"]),
        sa.PrimaryKeyConstraint("enhancement_id", "grp_code"),
    )


def downgrade() -> None:
    op.drop_table("enh_group_state")
    op.drop_index("ix_enhcomment_enh", table_name="enh_comment")
    op.drop_table("enh_comment")
