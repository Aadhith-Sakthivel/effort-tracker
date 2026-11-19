"""Pydantic request/response models."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class LookupItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    label: str


# --- Resource -------------------------------------------------------------
class ResourceBase(BaseModel):
    name: str = Field(max_length=200)
    racf: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=320)
    skills: str | None = Field(default=None, max_length=2000)
    location: str | None = Field(default=None, max_length=100)
    cell: str | None = Field(default=None, max_length=50)
    active: bool = True
    is_lead: bool = False


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(BaseModel):
    name: str | None = None
    racf: str | None = None
    email: str | None = None
    skills: str | None = None
    location: str | None = None
    cell: str | None = None
    active: bool | None = None
    is_lead: bool | None = None


class ResourceOut(ResourceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# --- Effort ---------------------------------------------------------------
class EffortBase(BaseModel):
    resource_id: int | None = None
    skill_code: str | None = None
    work_date: date
    hours: float = Field(ge=0, le=24)
    note: str | None = None


class EffortCreate(EffortBase):
    enhancement_id: int


class EffortUpdate(BaseModel):
    resource_id: int | None = None
    skill_code: str | None = None
    work_date: date | None = None
    hours: float | None = Field(default=None, ge=0, le=24)
    note: str | None = None


class EffortOut(EffortBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    enhancement_id: int
    resource_name: str | None = None
    # Reads must never fail on legacy/migrated rows that exceed the 24h input cap.
    hours: float = Field(ge=0)


# --- Enhancement ----------------------------------------------------------
class ResourceMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class EnhancementBase(BaseModel):
    ticket: str = Field(max_length=100)
    grp_code: str | None = Field(default=None, max_length=64)
    groups: list[str] = Field(default=[], max_length=50)
    demand_number: str | None = Field(default=None, max_length=100)
    title: str = Field(max_length=500)
    status_code: str | None = Field(default=None, max_length=64)
    sub_status_code: str | None = Field(default=None, max_length=64)
    lead_resource_id: int | None = None          # exactly one lead
    resource_ids: list[int] = Field(default=[], max_length=200)   # many assigned resources
    skill_codes: list[str] = Field(default=[], max_length=50)     # skills involved
    smoc_lead: str | None = Field(default=None, max_length=200)
    initial_estimated_hrs: float | None = None
    approved_hrs: float | None = None
    comments: str | None = Field(default=None, max_length=10000)
    doc_url: str | None = Field(default=None, max_length=2000)
    change_ticket: str | None = Field(default=None, max_length=500)
    eta: date | None = None
    active: bool = True


class EnhancementCreate(EnhancementBase):
    custom_groups: list[str] = []   # NEW per-enhancement group labels to create


class EnhancementUpdate(BaseModel):
    grp_code: str | None = None
    groups: list[str] | None = None
    custom_groups: list[str] | None = None   # NEW per-enhancement group labels to create
    demand_number: str | None = None
    title: str | None = None
    status_code: str | None = None
    sub_status_code: str | None = None
    lead_resource_id: int | None = None
    resource_ids: list[int] | None = None
    skill_codes: list[str] | None = None
    smoc_lead: str | None = None
    initial_estimated_hrs: float | None = None
    approved_hrs: float | None = None
    comments: str | None = None
    doc_url: str | None = None
    change_ticket: str | None = None
    eta: date | None = None
    active: bool | None = None


class EnhLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    url: str


class EnhancementOut(EnhancementBase):
    model_config = ConfigDict(from_attributes=True)
    # Reads must never fail on legacy/migrated rows that exceed the input length caps
    # (e.g. a demand_number holding many newline-joined DMND numbers). Mirror the
    # EffortOut.hours precedent: drop max_length on the OUTPUT model.
    ticket: str
    grp_code: str | None = None
    demand_number: str | None = None
    title: str
    status_code: str | None = None
    sub_status_code: str | None = None
    smoc_lead: str | None = None
    comments: str | None = None
    doc_url: str | None = None
    change_ticket: str | None = None
    id: int
    custom_group_items: list[LookupItem] = []   # this enhancement's own custom groups (code+label)
    links: list[EnhLinkOut] = []                 # extra named documentation links
    actual_hrs: float = 0
    remaining_hrs: float = 0
    lead_name: str | None = None
    resources: list[ResourceMini] = []
    latest_comment: str | None = None
    latest_comment_at: datetime | None = None
    latest_comment_src: str | None = None       # 'comment' | 'timesheet'
    updated_at: datetime | None = None


# --- Audit ----------------------------------------------------------------
class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    entity_type: str
    entity_id: int | None
    entity_label: str | None = None
    action: str
    field: str | None
    old_value: str | None
    new_value: str | None
    changed_by: str
    changed_at: datetime


# --- Dashboard ------------------------------------------------------------
class KPI(BaseModel):
    total_enhancements: int
    open_enhancements: int
    total_actual_hrs: float
    total_approved_hrs: float


# --- Support tickets ------------------------------------------------------
class SupportCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    body: str
    kind: str = "comment"          # comment | status | state
    created_by: str | None = None
    created_at: datetime


class SupportTicketBase(BaseModel):
    number: str | None = Field(default=None, max_length=100)   # optional; auto-assigned (TASK######) if blank
    description: str = Field(max_length=10000)
    status: str = Field(default="In Queue", max_length=64)
    lead_resource_id: int | None = None
    resource_ids: list[int] = Field(default=[], max_length=200)
    eta: date | None = None
    active: bool = True


class SupportTicketCreate(SupportTicketBase):
    pass


class SupportTicketUpdate(BaseModel):
    description: str | None = None
    status: str | None = None
    lead_resource_id: int | None = None
    resource_ids: list[int] | None = None
    eta: date | None = None
    active: bool | None = None


class SupportTicketOut(SupportTicketBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: str
    lead_name: str | None = None
    resources: list[ResourceMini] = []
    comments: list[SupportCommentOut] = []
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime


class SupportCommentIn(BaseModel):
    body: str = Field(max_length=10000)
