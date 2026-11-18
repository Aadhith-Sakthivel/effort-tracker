"""support tickets

Standalone task tracker: support_ticket, support_ticket_resource, support_comment.
Only references the existing resource table.

Revision ID: f5d6e7a8b9c0
Revises: e4c5d6f7a8b9
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f5d6e7a8b9c0"
down_revision: Union[str, None] = "e4c5d6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_ticket",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("number", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="In Queue"),
        sa.Column("lead_resource_id", sa.Integer(), sa.ForeignKey("resource.id"), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("number", name="uq_support_number"),
    )
    op.create_index("ix_support_active", "support_ticket", ["active"])
    op.create_table(
        "support_ticket_resource",
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_ticket.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("resource_id", sa.Integer(), sa.ForeignKey("resource.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "support_comment",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("support_ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("support_comment")
    op.drop_table("support_ticket_resource")
    op.drop_index("ix_support_active", table_name="support_ticket")
    op.drop_table("support_ticket")
