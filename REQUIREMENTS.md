# Requirements checklist

Every requirement in [SPEC.md](SPEC.md), where it's implemented, and how it's verified.
**Automated** = covered by `npm test` (test/requirements.test.js, 12 tests, all passing). **Manual** = checked in the browser (desktop 1440 px and phone 375 px, light and dark).

## Roles & permissions
| Requirement | Status | Where | Verified |
|---|---|---|---|
| Lead: full edit of work items, people, settings | ✅ | `requireRole('lead')` in routes | Automated |
| Member: log time, move cards, edit statuses/comments | ✅ | `requireRole('member')` | Automated |
| Viewer: read-only | ✅ | Every write route is guarded | Automated |
| Enforced server-side, not just hidden in UI | ✅ | `lib/auth.js` | Automated (403s) |
| SSO identity maps to a member record for the role | ✅ | `x-forwarded-email` → `users.login_id`; unknown = viewer | Automated |

## Screens
| Requirement | Status | Where | Verified |
|---|---|---|---|
| Overview: KPI tiles (open items, actual vs approved) + summary charts | ✅ | `views/overview.js`, `charts.js` (doughnuts, line, bars) | Automated + manual |
| Work Items: search, filter by category/status/active | ✅ | `views/items.js` | Automated |
| Work Items: leads add/edit; everyone opens detail | ✅ | | Automated + manual |
| CSV export with column picker and its own (seeded) filters | ✅ | `exportDialog` in `ui.js` | Manual |
| Detail: header facts (status, owner, target date, hours) | ✅ | `views/item-detail.js` | Manual |
| Detail: tab per category with its own sub-status and thread | ✅ | | Automated |
| Card-level comment shows on every tab; tab comment on that tab only | ✅ | `comments.category_id NULL` | Automated |
| Time-log notes appear under their category | ✅ | `timeNotes` in detail | Manual |
| Board: columns = statuses, drag to change, click to open | ✅ | `views/board.js` (+ Enter key) | Manual |
| Timesheet: month grid, one row per item × category, merged item cell | ✅ | `views/timesheet.js` | Manual |
| Timesheet: confirmation dialog shows before → after | ✅ | | Manual |
| Editing one category never disturbs the others | ✅ | One row per cell (unique key) | Automated |
| Weeks freeze after weekly deadline | ✅ | `lib/time.js isFrozen` | Automated |
| Per-person daily hour cap | ✅ | `lib/time-entries.js` | Automated |
| Support: own statuses, activity feed, target dates, assignees | ✅ | `routes/support.js` | Automated |
| Support: close only when Done/Cancelled | ✅ | | Automated |
| Team: cards, filters (search, location, role, active), CSV export | ✅ | `views/team.js` | Manual |
| Team: contact + reveal-to-call for team roles only, never viewers | ✅ | Stripped in API for viewers | Automated |
| Team: activate/deactivate asks for confirmation | ✅ | | Manual |
| Audit log: chronological, filterable by entity | ✅ | `views/audit.js` | Automated |

## Data model
| Entity | Status |
|---|---|
| User (displayName, loginId, role, location, isActive, skills) | ✅ plus email/phone |
| WorkItem (reference, title, description, primaryCategory, overallStatus, overallSubStatus, owner, estimated/approved hours, targetDate, isActive) | ✅ |
| Category (code, label, sortOrder, isActive, isCustom, ownerWorkItemId) | ✅ |
| WorkItemCategory, GroupState | ✅ |
| TimeEntry, Comment (categoryId null = all tabs) | ✅ |
| Status / SubStatus lookups (code, label, sortOrder, isTerminal, isInactive) | ✅ (sub-status `is_inactive` added in migration 002) |
| SupportTask, SupportActivity (comment / status / state) | ✅ |
| AuditEntry (entity, action, field, old → new, actor, time) | ✅ |

## Status workflow
| Requirement | Status |
|---|---|
| Configurable work-item states incl. terminal Cancelled/Withdrawn marked inactive | ✅ Settings → Work-item statuses |
| Inactive statuses drop out of default active views | ✅ list + board default |
| Support: Queued → In Progress → Hold → Done, plus Cancelled | ✅ |
| Per-category sub-status independent of overall status | ✅ Automated |

## Non-functional
| Requirement | Status | Notes |
|---|---|---|
| Validations: required fields, daily cap, freeze, terminal-close rule, duplicate reference | ✅ | All automated |
| No new time on inactive items | ✅ | Added in this pass; reducing/clearing still allowed |
| Every create/update/delete writes an audit entry | ✅ | Same transaction as the change |
| Single business timezone for "today", freeze, display | ✅ | `BUSINESS_TZ` |
| Hosted data app, JS SPA, REST API, Postgres with versioned migrations | ✅ | Databricks Apps + Lakebase; `db/migrations/` |
| Security headers (CSP, nosniff), health check | ✅ | `server.js`, `/healthz` |
| Accessibility: skip link, keyboard-openable cards/rows, focus rings, reduced motion, labelled controls | ✅ | Manual |
| Responsive: no horizontal page scroll at 375 px | ✅ | Manual |

## Beyond the spec (added for a complete experience)
| Feature | Verified |
|---|---|
| Reference links on work items (http/https only; adder or lead can remove) | Automated |
| Watchers: watch/unwatch, "Only items I'm watching" filter | Automated |
| Activity timeline per item, built from the audit trail | Automated |
| Bulk edit (leads): status, owner, target date, each change audited | Automated |
| Due-date reminders: overdue / due-in-N-days badges, Due filter, Due soon list, sidebar badge | Automated + manual |

## Not verified
- **Deploying on Databricks Apps with a real Lakebase instance.** The OAuth token path in `db/index.js` follows the documented approach but has no workspace to run against here.
