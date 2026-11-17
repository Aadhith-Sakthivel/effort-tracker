// Business-time helpers. Dates are plain 'YYYY-MM-DD' strings; one business timezone decides "today".
const TZ = process.env.BUSINESS_TZ || 'Asia/Kolkata';

function nowInTz() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const toUtc = (d) => new Date(`${d}T00:00:00Z`);
const fmt = (dt) => dt.toISOString().slice(0, 10);

function addDays(d, n) {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

// Monday of the week containing d.
function weekStart(d) {
  const dow = toUtc(d).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

// A week freezes on `freezeWeekday` (1 = Mon … 7 = Sun) of the following week at `freezeHour`.
function freezeDeadline(d, settings) {
  return { date: addDays(weekStart(d), 7 + (Number(settings.freeze_weekday) - 1)), hour: Number(settings.freeze_hour) };
}

function isFrozen(d, settings, now = nowInTz()) {
  const deadline = freezeDeadline(d, settings);
  return now.date > deadline.date || (now.date === deadline.date && now.hour >= deadline.hour);
}

function monthDays(month) {
  const first = `${month}-01`;
  const days = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  return days;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s).getTime());

module.exports = { TZ, nowInTz, addDays, weekStart, freezeDeadline, isFrozen, monthDays, isDate };
