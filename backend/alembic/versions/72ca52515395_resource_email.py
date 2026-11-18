"""resource email

Revision ID: 72ca52515395
Revises: a6e4dc3ea902
Create Date: 2026-11-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "72ca52515395"
down_revision: Union[str, None] = "a6e4dc3ea902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite and Postgres both support a plain nullable ADD COLUMN (no table rebuild).
    op.add_column("resource", sa.Column("email", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("resource", "email")
