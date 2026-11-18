"""Application timezone — the app operates on US Eastern time (EST/EDT)."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")

FREEZE_WEEKDAY = 4   # Friday (Mon=0)
FREEZE_HOUR = 13     # 1 PM ET


def est_now() -> datetime:
    return datetime.now(EASTERN)


def editable_from(freeze_weekday: int = FREEZE_WEEKDAY, freeze_hour: int = FREEZE_HOUR,
                  freeze_before: date | None = None) -> date:
    """Earliest editable timesheet date. A week (Mon–Sun) locks at the configured
    weekday/hour ET; once that deadline passes, the next week opens. If `freeze_before`
    is set, everything on or before that date is also locked (a hard month-lock override).
    Any work_date before the returned date is frozen (read-only)."""
    now = est_now()
    monday = now.date() - timedelta(days=now.date().weekday())
    deadline = datetime.combine(monday + timedelta(days=freeze_weekday), time(freeze_hour, 0), tzinfo=EASTERN)
    wk = monday + timedelta(days=7) if now >= deadline else monday
    if freeze_before:
        wk = max(wk, freeze_before + timedelta(days=1))
    return wk


def est_today() -> date:
    return est_now().date()


def month_bounds(d: date) -> tuple[date, date]:
    """First and last calendar day of the month containing d."""
    first = d.replace(day=1)
    if first.month == 12:
        nxt = first.replace(year=first.year + 1, month=1)
    else:
        nxt = first.replace(month=first.month + 1)
    from datetime import timedelta
    return first, nxt - timedelta(days=1)
