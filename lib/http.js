// Small shared helpers for route handlers.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

const intOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) throw new HttpError(400, `"${v}" is not a valid number`);
  return n;
};

const required = (v, label) => {
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === undefined || s === null || s === '') throw new HttpError(400, `${label} is required`);
  return s;
};

// Map a Postgres unique-violation into a friendly 409.
function uniqueGuard(message) {
  return (e) => {
    if (e && (e.code === '23505' || /duplicate key|unique constraint/i.test(e.message))) throw new HttpError(409, message);
    throw e;
  };
}

module.exports = { HttpError, wrap, intOrNull, numOrNull, required, uniqueGuard };
