"""enhancement doc_url

Adds a nullable documentation-link column to enhancement.

Revision ID: c2a3b4d5e6f7
Revises: b1f2c3d4e5a6
Create Date: 2026-11-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c2a3b4d5e6f7"
down_revision: Union[str, None] = "b1f2c3d4e5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("enhancement", sa.Column("doc_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("enhancement", "doc_url")
