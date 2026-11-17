const path = require('path');
const express = require('express');
const db = require('./db');
const { seed } = require('./db/seed');
const { identify } = require('./lib/auth');

const app = express();
app.disable('x-powered-by');
// Baseline security headers. Scripts only from this origin; inline style attributes are used for chart widths.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '1mb' }));
// Liveness check for the platform (no auth, no data).
app.get('/healthz', (req, res) => res.json({ ok: true }));
// no-cache = browsers revalidate (cheap 304s), so a redeploy is picked up immediately.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

app.use('/api', identify);
app.use('/api', require('./routes/meta').router);
app.use('/api', require('./routes/reports'));
app.use('/api/work-items', require('./routes/work-items'));
app.use('/api/timesheet', require('./routes/timesheet'));
app.use('/api/support', require('./routes/support'));
app.use('/api/team', require('./routes/team'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
});

const port = Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000);
db.connect()
  .then(async () => {
    if (process.env.SEED_DEMO !== 'false' && await seed()) console.log('Seeded demo data');
    app.listen(port, () => console.log(`Effort Tracker on http://localhost:${port} (db: ${db.name})`));
  })
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
