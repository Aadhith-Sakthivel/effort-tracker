# Effort Tracker: Functional Spec (clean-room)

Generic functional spec this project is built from. It contains no source code, client data or org-specific names.

## 1. Problem & users
A delivery team tracked enhancement work, daily time and ad-hoc support tasks across many disconnected spreadsheets. Hours, statuses and notes drifted out of sync, and nobody had a single live view. The app replaces those spreadsheets with one shared, audited system.

Roles:
- **Lead:** full edit of work items, people and settings.
- **Member:** logs time, moves board cards, edits statuses/comments.
- **Viewer:** read-only.

## 2. Features (by screen)
- **Overview:** KPI tiles (open items, actual vs. approved hours) and summary charts.
- **Work Items list:** searchable, filterable (by category, status, active/inactive) table. Leads add/edit items; everyone opens a detail view. CSV export with a column picker and its own filter set (seeded from the page, independently adjustable).
- **Work Item detail:** header facts (status, owner, target date, hours). A tab per category, each with its own sub-status and its own comment thread. A card-level comment posts to every tab; a per-tab comment posts to that category only. Time-log notes appear automatically under the category they were logged against.
- **Board (kanban):** columns = statuses; drag a card to change status; click to open detail.
- **Timesheet:** month calendar grid. Each work item expands to one row per category, with the item name as a merged (row-spanning) cell. Users type hours per day per category; a confirmation dialog shows before/after. Editing one category never disturbs the others. Weeks freeze after a weekly deadline (read-only thereafter). Per-person daily hour caps are enforced.
- **Support Tasks:** standalone tracker with its own statuses, an activity feed (comments + status/close events together), target dates and assignees. A task can only be closed once it reaches a terminal status.
- **Team:** member cards with filters (search, location, role, active) and CSV export (column picker + filters). Contact details and a reveal-to-call action are visible to team roles only, not viewers. Activate/deactivate asks for confirmation.
- **Audit log:** chronological history of changes, filterable by entity.

## 3. Data model
User · WorkItem · Category (global or item-scoped custom) · WorkItemCategory · GroupState (per item per category sub-status) · TimeEntry · Comment (category null = all tabs) · Status / SubStatus lookups (isTerminal, isInactive) · SupportTask · SupportActivity (comment | status | state) · AuditEntry (entity, action, field, old → new, actor, time).

## 4. Status workflow
- Work items move through configurable states (New → In Progress → In Review → Done, plus terminal Cancelled/Withdrawn marked inactive). Members and leads change status; viewers cannot. Inactive statuses drop the item from default active views.
- Support tasks: Queued → In Progress → Hold → Done, plus Cancelled. Closing is blocked unless the status is Done or Cancelled.
- Per-category sub-status is independent of the item's overall status.

## 5. Non-functional
- Auth: workspace SSO; identity maps to a member record to resolve role.
- Permissions: three tiers, enforced server-side.
- Validations: required fields; per-person daily hour cap; weekly timesheet freeze; terminal-status rule for closing; duplicate-reference guard.
- Audit: every create/update/delete writes an audit entry; comments and status changes are kept as history.
- Time: a single business timezone governs "today", freeze deadlines and display.

## 6. Tech stack
Databricks App · JavaScript single-page front end · REST API · Lakebase (Postgres) with versioned schema migrations.
