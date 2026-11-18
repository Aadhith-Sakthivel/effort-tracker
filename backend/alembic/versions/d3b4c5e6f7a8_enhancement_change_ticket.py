"""enhancement change_ticket

Adds a nullable implementation-ticket (ServiceNow CHG) column to enhancement.

Revision ID: d3b4c5e6f7a8
Revises: c2a3b4d5e6f7
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d3b4c5e6f7a8"
down_revision: Union[str, None] = "c2a3b4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("enhancement", sa.Column("change_ticket", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("enhancement", "change_ticket")
