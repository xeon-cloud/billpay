const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const D = require('./dates');
const { createPool, waitForDb, migrate } = require('./db');
const { createAuth, upsertEnvAdmin } = require('./auth');
const { createPayments } = require('./payments');
const apiRouter = require('./routes/api');

async function initDb(pool) {
  await waitForDb(pool);
  await migrate(pool);
  await upsertEnvAdmin(pool);
}

async function createApp({ pool = createPool(), loginRateMax = config.loginRateLimit.max } = {}) {
  await initDb(pool);
  const auth = createAuth(pool);
  const payments = createPayments(pool);
  const app = express();
  const VIEWS = path.join(config.root, 'views');

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 15552000 } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' }
  }));

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'error', db: 'unavailable' });
    }
  });

  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMin * 60e3,
    limit: loginRateMax,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ detail: 'Слишком много попыток входа. Попробуйте позже.' })
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/assets', express.static(path.join(config.root, 'public', 'assets'), { maxAge: config.production ? '1d' : 0, index: false }));
  app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(config.root, 'public', 'assets', 'img', 'favicon.ico')));

  const specPath = path.join(config.root, 'docs', 'openapi.yaml');
  const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
  app.get('/api/v1/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(specPath));
  app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'BillPay API', swaggerOptions: { withCredentials: true } }));

  app.use(auth.attach);

  app.use('/api/v1', apiRouter({ pool, auth, payments, loginLimiter }));
  app.use('/api', (_req, res) => res.status(404).json({ detail: 'Не найдено' }));

  const cache = new Map();
  const readView = (name) => {
    if (config.production && cache.has(name)) return cache.get(name);
    const html = fs.readFileSync(path.join(VIEWS, name + '.html'), 'utf8');
    cache.set(name, html);
    return html;
  };
  const boot = (data) => `<script>window.BILLPAY_BOOT=${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  const render = (res, name, data) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(readView(name).replace('<!--BILLPAY_BOOT-->', data ? boot(data) : ''));
  };
  const appBoot = (user) => ({ today: D.today(), timezone: config.timezone, telegramChat: config.telegramChat, remindDaysBefore: config.remindDaysBefore, currentUser: user, email: { enabled: config.emailEnabled } });

  const page = (name, { admin = false } = {}) => (req, res) => {
    if (!req.user) return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
    if (admin && req.user.role !== 'admin') return res.redirect(302, '/app');
    render(res, name, appBoot(req.user));
  };

  app.get('/', (_req, res) => render(res, 'landing'));
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect(302, '/app');
    render(res, 'login');
  });
  app.get('/app', page('app'));
  app.get('/app/calendar', page('calendar'));
  app.get('/app/admin', page('admin', { admin: true }));

  const legacy = { '/index.html': '/app', '/calendar.html': '/app/calendar', '/admin.html': '/app/admin', '/login.html': '/login', '/landing.html': '/' };
  Object.entries(legacy).forEach(([from, to]) => app.get(from, (_req, res) => res.redirect(301, to)));

  app.use((_req, res) => res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>404 · BillPay</title><body style="font:16px system-ui;background:#0A0A0A;color:#F2F2F2;display:grid;place-items:center;height:100vh;margin:0"><div>Страница не найдена · <a style="color:inherit" href="/">На главную</a></div>'));

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ detail: 'Некорректный JSON' });
    console.error(err);
    if (req.path.startsWith('/api')) return res.status(500).json({ detail: 'Внутренняя ошибка сервера' });
    res.status(500).send('Внутренняя ошибка сервера');
  });

  app.locals.pool = pool;
  return app;
}

module.exports = { createApp, initDb };
