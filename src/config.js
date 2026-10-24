const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const production = env.NODE_ENV === 'production';

function databaseUrl() {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const u = encodeURIComponent(env.POSTGRES_USER || 'billpay');
  const p = encodeURIComponent(env.POSTGRES_PASSWORD || '');
  const h = env.PGHOST || env.POSTGRES_HOST || 'localhost';
  const port = env.PGPORT || env.POSTGRES_PORT || 5432;
  const db = encodeURIComponent(env.POSTGRES_DB || 'billpay');
  return `postgres://${u}${p ? ':' + p : ''}@${h}:${port}/${db}`;
}

const config = {
  root: path.join(__dirname, '..'),
  port: +env.PORT || 3000,
  host: env.HOST || '0.0.0.0',
  production,
  sessionSecret: env.SESSION_SECRET || env.JWT_SECRET || '',
  sessionTtlHours: +env.SESSION_TTL_HOURS || 168,
  cookieSecure: bool(env.COOKIE_SECURE, false),
  trustProxy: env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? 1 : (/^\d+$/.test(env.TRUST_PROXY) ? +env.TRUST_PROXY : env.TRUST_PROXY),
  loginRateLimit: { windowMin: +env.LOGIN_RATE_WINDOW_MIN || 15, max: +env.LOGIN_RATE_MAX || 10 },
  admin: {
    login: (env.ADMIN_LOGIN || 'admin').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Главный администратор'
  },
  timezone: env.APP_TIMEZONE || env.TZ || 'Europe/Moscow',
  telegramChat: env.TELEGRAM_CHAT || 'Финансы',
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: env.TELEGRAM_CHAT_ID || '',
  remindDaysBefore: +env.REMIND_DAYS_BEFORE || 3,
  databaseUrl: databaseUrl(),
  databaseSsl: bool(env.DATABASE_SSL, false),
  dbPoolMax: +env.DB_POOL_MAX || 10,
  smtp: {
    host: (env.SMTP_HOST || '').trim(),
    port: +env.SMTP_PORT || 0,
    user: (env.SMTP_USER || '').trim(),
    pass: env.SMTP_PASS || '',
    from: (env.SMTP_FROM || '').trim()
  },
  appUrl: (env.APP_URL || '').trim().replace(/\/+$/, '')
};
config.emailEnabled = !!(config.smtp.host && config.smtp.from);

if (!config.admin.password) {
  throw new Error('ADMIN_PASSWORD не задан. Главный администратор обязателен (см. .env.example).');
}
if (!config.sessionSecret) {
  if (production) throw new Error('SESSION_SECRET не задан. В продакшене это обязательно (см. .env.example).');
  config.sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[billpay] SESSION_SECRET не задан: используется временный ключ, сессии сбросятся при перезапуске.');
}
const placeholder = (v) => !v || /change-me/i.test(v);
const problems = [];
if (placeholder(config.sessionSecret) || config.sessionSecret.length < 32) problems.push('SESSION_SECRET (случайная строка от 32 символов)');
const WEAK = ['admin123', 'password', '12345678', 'qwerty123', 'administrator'];
if (placeholder(config.admin.password) || config.admin.password.length < 8 || WEAK.includes(config.admin.password.toLowerCase())) problems.push('ADMIN_PASSWORD (свой пароль от 8 символов, не change-me/admin123)');
if (/change-me/i.test(env.POSTGRES_PASSWORD || '') || /change-me/i.test(env.DATABASE_URL || '')) problems.push('POSTGRES_PASSWORD');
if (problems.length) {
  const msg = `замените значения в .env: ${problems.join(', ')}. Образец: .env.example`;
  if (production) throw new Error(msg);
  console.warn('[billpay] ВНИМАНИЕ (в продакшене приложение не запустится): ' + msg);
}

module.exports = config;
