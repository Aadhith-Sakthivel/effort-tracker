"""Audit-log helpers. Every write goes through here so nothing is unlogged.

`label` is a human-readable identifier stored with the row (ticket + date for
effort, resource name for resources, ticket for enhancements) so the audit UI
never has to show a meaningless numeric id.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .db import AuditLog


def _s(v: Any) -> str | None:
    return None if v is None else str(v)


def log_create(db: Session, user: str, entity_type: str, entity_id: int, snapshot: dict,
               label: str | None = None) -> None:
    db.add(AuditLog(
        entity_type=entity_type, entity_id=entity_id, entity_label=label, action="create",
        field=None, old_value=None, new_value=str(snapshot), changed_by=user,
    ))


def log_delete(db: Session, user: str, entity_type: str, entity_id: int, snapshot: dict,
               label: str | None = None) -> None:
    db.add(AuditLog(
        entity_type=entity_type, entity_id=entity_id, entity_label=label, action="delete",
        field=None, old_value=str(snapshot), new_value=None, changed_by=user,
    ))


def log_diff(db: Session, user: str, entity_type: str, entity_id: int,
             before: dict, changes: dict, label: str | None = None) -> None:
    """Log one audit row per field that actually changed."""
    for field, new_val in changes.items():
        old_val = before.get(field)
        if old_val == new_val:
            continue
        db.add(AuditLog(
            entity_type=entity_type, entity_id=entity_id, entity_label=label, action="update",
            field=field, old_value=_s(old_val), new_value=_s(new_val), changed_by=user,
        ))
