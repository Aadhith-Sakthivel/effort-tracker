// Identity and permissions.
// On Databricks Apps the platform injects the signed-in user's email (workspace SSO). That identity is
// matched to a users row to resolve the role. Unknown or inactive identities are read-only viewers.
// Locally (no platform header) the UI's "Sign in as" picker sends x-user; disable with DEV_LOGIN=false.
const db = require('../db');
const { HttpError } = require('./http');

const RANK = { viewer: 0, member: 1, lead: 2 };
const DEV_LOGIN = process.env.DEV_LOGIN !== 'false';
const BOOTSTRAP_LEADS = (process.env.LEAD_LOGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function identify(req, res, next) {
  try {
    const platform = req.get('x-forwarded-email') || req.get('x-forwarded-preferred-username');
    const login = (platform || (DEV_LOGIN ? req.get('x-user') : '') || '').trim();
    req.platformIdentity = Boolean(platform);
    req.user = { id: null, login_id: login || 'anonymous', display_name: login || 'Anonymous', role: 'viewer', unknown: true };
    if (!login) return next();

    let [u] = await db.query('SELECT id, login_id, display_name, role, is_active FROM users WHERE lower(login_id) = lower($1)', [login]);
    if (!u && BOOTSTRAP_LEADS.includes(login.toLowerCase())) {
      [u] = await db.query(
        `INSERT INTO users(display_name, login_id, role) VALUES ($1, $1, 'lead') RETURNING id, login_id, display_name, role, is_active`,
        [login],
      );
    }
    if (u && u.is_active) req.user = u;
    next();
  } catch (e) {
    next(e);
  }
}

const can = (user, role) => RANK[user.role] >= RANK[role];

// Route guard: require at least this role.
const requireRole = (role) => (req, res, next) => {
  if (can(req.user, role)) return next();
  next(new HttpError(403, role === 'lead' ? 'Only leads can do this' : 'Viewers have read-only access'));
};

module.exports = { identify, requireRole, can, DEV_LOGIN };
