"""Database engine, session, and ORM models."""
from __future__ import annotations

import os
import re
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    func,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import get_settings

settings = get_settings()
_url = settings.resolve_url()
# SQLite needs this flag for multi-threaded FastAPI; Postgres ignores it.
_connect_args = {"check_same_thread": False} if _url.startswith("sqlite") else {}
# pool_recycle keeps connections younger than the ~1h Lakebase token lifetime.
engine = create_engine(
    _url, connect_args=_connect_args, pool_pre_ping=True,
    pool_recycle=1800 if settings.is_postgres() else -1, future=True,
)
if _url.startswith("sqlite"):
    # SQLite ignores FK ON DELETE CASCADE unless this pragma is on per-connection.
    # Without it, deleting a parent leaves orphan child rows (we hit this with groups).
    @event.listens_for(engine, "connect")
    def _sqlite_fk_on(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

if settings.token_mode():
    from .lakebase import attach_token_provider
    attach_token_provider(engine, settings.lakebase_instance)
elif settings.is_postgres() and not settings.pgpassword:
    # Lakebase project in a Databricks App: no PGPASSWORD is injected — use the
    # app service principal's OAuth token as the Postgres password.
    from .lakebase import attach_oauth_password
    attach_oauth_password(engine)

# On Postgres the app keeps its tables in its own schema: an app role usually can't
# create in "public" (PG15+), but a role allowed to create in the database can own one.
PG_SCHEMA = os.environ.get("PGSCHEMA", "effort_tracker_demo") if settings.is_postgres() else None
if PG_SCHEMA:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", PG_SCHEMA):
        raise ValueError(f'Invalid PGSCHEMA "{PG_SCHEMA}"')
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {PG_SCHEMA}")
        cur.execute(f"SET search_path TO {PG_SCHEMA}")
        cur.close()
        dbapi_conn.commit()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


# --- Lookup tables --------------------------------------------------------
class Grp(Base):
    __tablename__ = "grp"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Custom groups belong to ONE enhancement and are hidden from the shared group
    # list (so they never appear when creating/editing a different enhancement).
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    owner_enhancement_id: Mapped[int | None] = mapped_column(Integer)


class Status(Base):
    __tablename__ = "status"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False)
    is_inactive: Mapped[bool] = mapped_column(Boolean, default=False)  # Cancelled/Withdrawn => not an active enhancement
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SubStatus(Base):
    __tablename__ = "sub_status"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SkillCategory(Base):
    __tablename__ = "skill_category"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


# --- Association: an enhancement can belong to several groups ------------
enhancement_group = Table(
    "enhancement_group", Base.metadata,
    Column("enhancement_id", ForeignKey("enhancement.id", ondelete="CASCADE"), primary_key=True),
    Column("grp_code", ForeignKey("grp.code"), primary_key=True),
)

# --- Association: several resources can be assigned to an enhancement -----
enhancement_resource = Table(
    "enhancement_resource", Base.metadata,
    Column("enhancement_id", ForeignKey("enhancement.id", ondelete="CASCADE"), primary_key=True),
    Column("resource_id", ForeignKey("resource.id", ondelete="CASCADE"), primary_key=True),
)

# --- Association: skills involved in an enhancement ----------------------
enhancement_skill = Table(
    "enhancement_skill", Base.metadata,
    Column("enhancement_id", ForeignKey("enhancement.id", ondelete="CASCADE"), primary_key=True),
    Column("skill_code", ForeignKey("skill_category.code"), primary_key=True),
)


# --- Core tables ----------------------------------------------------------
class Resource(Base):
    __tablename__ = "resource"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    racf: Mapped[str | None] = mapped_column(String, unique=True)
    email: Mapped[str | None] = mapped_column(String)   # SSO login email → drives the lead role
    skills: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String)
    cell: Mapped[str | None] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_lead: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Enhancement(Base):
    __tablename__ = "enhancement"
    __table_args__ = (
        Index("ix_enh_status", "status_code"),
        Index("ix_enh_active", "active"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    grp_code: Mapped[str | None] = mapped_column(ForeignKey("grp.code"))  # primary group (= first of groups)
    demand_number: Mapped[str | None] = mapped_column(String)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status_code: Mapped[str | None] = mapped_column(ForeignKey("status.code"))
    sub_status_code: Mapped[str | None] = mapped_column(ForeignKey("sub_status.code"))
    lead_resource_id: Mapped[int | None] = mapped_column(ForeignKey("resource.id"))
    smoc_lead: Mapped[str | None] = mapped_column(String)
    initial_estimated_hrs: Mapped[float | None] = mapped_column(Numeric(10, 2))
    approved_hrs: Mapped[float | None] = mapped_column(Numeric(10, 2))
    comments: Mapped[str | None] = mapped_column(Text)
    doc_url: Mapped[str | None] = mapped_column(String)
    change_ticket: Mapped[str | None] = mapped_column(String)   # ServiceNow CHG number or full URL
    eta: Mapped[date | None] = mapped_column(Date)              # target / ETA date
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped[Resource | None] = relationship("Resource", lazy="joined", foreign_keys=[lead_resource_id])
    groups: Mapped[list[Grp]] = relationship(secondary=enhancement_group, lazy="selectin",
                                               order_by="Grp.sort_order")
    resources: Mapped[list[Resource]] = relationship(secondary=enhancement_resource, lazy="selectin",
                                                        order_by="Resource.name")
    skills: Mapped[list[SkillCategory]] = relationship(secondary=enhancement_skill, lazy="selectin",
                                                         order_by="SkillCategory.sort_order")
    efforts: Mapped[list[Effort]] = relationship(back_populates="enhancement", cascade="all, delete-orphan")
    # ORM-level cascade so per-group comments / sub-status are removed on delete even on
    # SQLite (which doesn't enforce FK ON DELETE CASCADE), preventing rowid-reuse bleed.
    group_comments: Mapped[list[EnhComment]] = relationship("EnhComment", cascade="all, delete-orphan")
    group_states: Mapped[list[EnhGroupState]] = relationship("EnhGroupState", cascade="all, delete-orphan")
    links: Mapped[list[EnhLink]] = relationship("EnhLink", cascade="all, delete-orphan", order_by="EnhLink.id")


class Effort(Base):
    __tablename__ = "effort"
    __table_args__ = (
        UniqueConstraint("enhancement_id", "resource_id", "grp_code", "skill_code", "work_date",
                         name="uq_effort_natural"),
        CheckConstraint("hours >= 0 AND hours <= 9999", name="ck_effort_hours"),
        Index("ix_effort_enh", "enhancement_id"),
        Index("ix_effort_date", "work_date"),
        Index("ix_effort_res", "resource_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enhancement_id: Mapped[int] = mapped_column(ForeignKey("enhancement.id", ondelete="CASCADE"), nullable=False)
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("resource.id"))
    grp_code: Mapped[str | None] = mapped_column(ForeignKey("grp.code"))
    skill_code: Mapped[str | None] = mapped_column(ForeignKey("skill_category.code"))
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[str | None] = mapped_column(String)   # who last logged/edited this cell
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    enhancement: Mapped[Enhancement] = relationship(back_populates="efforts")
    resource: Mapped[Resource | None] = relationship(lazy="joined")


class AppSetting(Base):
    """Simple key/value store for admin-configurable settings (freeze rule, etc.)."""
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EnhComment(Base):
    """A comment on an enhancement. grp_code NULL = card-level (shown in every
    group tab); grp_code set = that group's tab only."""
    __tablename__ = "enh_comment"
    __table_args__ = (Index("ix_enhcomment_enh", "enhancement_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enhancement_id: Mapped[int] = mapped_column(ForeignKey("enhancement.id", ondelete="CASCADE"), nullable=False)
    grp_code: Mapped[str | None] = mapped_column(ForeignKey("grp.code"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="comment", server_default="comment")  # comment | status
    created_by: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EnhLink(Base):
    """Extra named documentation links on an enhancement (beyond doc_url / change_ticket)."""
    __tablename__ = "enh_link"
    __table_args__ = (Index("ix_enhlink_enh", "enhancement_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enhancement_id: Mapped[int] = mapped_column(ForeignKey("enhancement.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EnhGroupState(Base):
    """Per-(enhancement, group) sub-status. The enhancement's overall status/
    sub-status (board columns) is unchanged."""
    __tablename__ = "enh_group_state"
    enhancement_id: Mapped[int] = mapped_column(ForeignKey("enhancement.id", ondelete="CASCADE"), primary_key=True)
    grp_code: Mapped[str] = mapped_column(ForeignKey("grp.code"), primary_key=True)
    sub_status_code: Mapped[str | None] = mapped_column(ForeignKey("sub_status.code"))


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_changed", "changed_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    entity_label: Mapped[str | None] = mapped_column(String)  # human-readable (ticket+date, name…)
    action: Mapped[str] = mapped_column(String, nullable=False)
    field: Mapped[str | None] = mapped_column(String)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    changed_by: Mapped[str] = mapped_column(String, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --- Support tickets (self-contained; only references the resource table) -------
support_ticket_resource = Table(
    "support_ticket_resource", Base.metadata,
    Column("ticket_id", ForeignKey("support_ticket.id", ondelete="CASCADE"), primary_key=True),
    Column("resource_id", ForeignKey("resource.id", ondelete="CASCADE"), primary_key=True),
)


class SupportTicket(Base):
    __tablename__ = "support_ticket"
    __table_args__ = (Index("ix_support_active", "active"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String, unique=True, nullable=False)   # TASK000001 or provided
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="In Queue", nullable=False)
    lead_resource_id: Mapped[int | None] = mapped_column(ForeignKey("resource.id"))
    eta: Mapped[date | None] = mapped_column(Date)               # target / ETA date
    active: Mapped[bool] = mapped_column(Boolean, default=True)   # false = closed/archived
    created_by: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped[Resource | None] = relationship("Resource", lazy="joined", foreign_keys=[lead_resource_id])
    resources: Mapped[list[Resource]] = relationship(secondary=support_ticket_resource, lazy="selectin")
    comments: Mapped[list[SupportComment]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="SupportComment.created_at")


class SupportComment(Base):
    __tablename__ = "support_comment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_ticket.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="comment", server_default="comment")  # comment | status | state
    created_by: Mapped[str | None] = mapped_column(String)   # who added it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[SupportTicket] = relationship(back_populates="comments")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables if they don't exist (dev convenience / SQLite)."""
    Base.metadata.create_all(engine)
