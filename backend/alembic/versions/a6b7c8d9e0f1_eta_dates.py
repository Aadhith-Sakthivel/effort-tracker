"""ETA date on enhancement and support_ticket

Revision ID: a6b7c8d9e0f1
Revises: f5d6e7a8b9c0
Create Date: 2026-11-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, None] = "f5d6e7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("enhancement", sa.Column("eta", sa.Date(), nullable=True))
    op.add_column("support_ticket", sa.Column("eta", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("support_ticket", "eta")
    op.drop_column("enhancement", "eta")
