const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.REMIND_DAYS_BEFORE = '3';
process.env.APP_URL = 'https://billpay.example.ru/';
for (const k of ['SMTP_HOST', 'SMTP_FROM', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WEBHOOK_URL', 'WEBHOOK_SECRET']) process.env[k] = '';

const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp } = require('../src/app');
const { createPayments } = require('../src/payments');
const { dispatch } = require('../src/bot');
const { sign, buildPayload, sendWebhook } = require('../src/webhook');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_hook_${process.pid}`;
const TODAY = D.today();
const SECRET = 'whsec-test';
let admin, pool, server, base, A, recv, hookUrl;
const got = [];
let reply = 204;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool({ connectionString: url, schema });
  const app = await createApp({ pool, loginRateMax: 1000 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  recv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      got.push({ method: req.method, path: req.url, headers: req.headers, raw, body: JSON.parse(raw), status: reply });
      if (reply === 'hang') return;
      res.statusCode = reply;
      res.end();
    });
  });
  recv.listen(0);
  await new Promise((r) => recv.once('listening', r));
  hookUrl = `http://127.0.0.1:${recv.address().port}/hooks/billpay`;
  A = await login('admin', 'test-admin-pass');
});
after(async () => {
  recv.closeAllConnections();
  await new Promise((r) => recv.close(r));
  await new Promise((r) => server.close(r));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}
async function login(l, p) {
  const res = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
const verify = (raw, header, secret) => {
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'));
  const have = Buffer.from(String(header || ''));
  return have.length === want.length && crypto.timingSafeEqual(have, want);
};
const rows = async () => (await pool.query(`SELECT occurrence_id, recipient, status, error FROM reminders WHERE channel = 'webhook' ORDER BY occurrence_id, recipient`)).rows;

test('подпись: sha256=<hex> HMAC-SHA256 от сырого тела', () => {
  const body = '{"a":1}';
  assert.equal(sign(body, 'k'), 'sha256=' + crypto.createHmac('sha256', 'k').update(body).digest('hex'));
  assert.match(sign(body, 'k'), /^sha256=[0-9a-f]{64}$/);
  assert.notEqual(sign(body, 'k'), sign('{"a":2}', 'k'));
});

test('payload: поля периода, статус, дни, ссылка через APP_URL', () => {
  const o = { id: '7', recurring_payment_id: '3', name: 'Аренда офиса', amount: '185000.00', currency: 'RUB', due_date: '2026-11-05' };
  const now = new Date('2026-11-02T07:00:00Z');
  assert.deepEqual(buildPayload(o, { today: '2026-11-02', deliveryId: '15', appUrl: 'https://b.ru', now }), {
    event: 'payment.reminder', delivery_id: '15', sent_at: '2026-11-02T07:00:00.000Z',
    data: { occurrence_id: 7, payment_id: 3, name: 'Аренда офиса', amount: 185000, currency: 'RUB', due_date: '2026-11-05', status: 'unpaid', days_left: 3, url: 'https://b.ru/app/calendar?date=2026-11-05' }
  });
  const late = buildPayload({ ...o, due_date: '2026-10-30' }, { today: '2026-11-02', deliveryId: '1', appUrl: '' });
  assert.deepEqual([late.data.status, late.data.days_left, late.data.url], ['overdue', -3, null]);
});

test('meta: вебхук выключен без WEBHOOK_URL, секрет и хост не раскрываются', async () => {
  assert.equal(config.webhookEnabled, false);
  const meta = (await call('GET', '/api/v1/meta', { cookie: A })).json;
  assert.deepEqual(meta.webhook, { enabled: false, host: null, signed: false });
});

test('бот: без WEBHOOK_URL вебхук не шлётся', async () => {
  const payments = createPayments(pool);
  await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'Аренда офиса', amount: 185000, currency: 'RUB', next_date: D.addDays(TODAY, 2) } });
  await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'Хостинг', amount: 240, currency: 'USD', next_date: D.addDays(TODAY, 10) } });
  const r = await dispatch(pool, payments);
  assert.equal(r.skipped, 'config');
  assert.equal(r.off.webhook, true);
  assert.equal(got.length, 0);
  assert.deepEqual(await rows(), []);
});

test('бот: подписанный вебхук, повтор после ошибки, без дублей', async () => {
  const payments = createPayments(pool);
  const hook = { url: hookUrl, secret: SECRET };
  reply = 500;
  const r1 = await dispatch(pool, payments, { webhook: hook });
  assert.deepEqual([r1.off.webhook, r1.hooked.length, got.length], [false, 0, 1]);
  let st = await rows();
  assert.deepEqual(st.map((x) => [x.status, x.error]), [['failed', 'HTTP 500']]);

  reply = 200;
  const r2 = await dispatch(pool, payments, { webhook: hook });
  assert.equal(r2.hooked.length, 1);
  assert.equal(got.length, 2);
  const g = got[1];
  assert.equal(g.method, 'POST');
  assert.equal(g.path, '/hooks/billpay');
  assert.equal(g.headers['content-type'], 'application/json');
  assert.equal(g.headers['x-billpay-event'], 'payment.reminder');
  assert.equal(g.headers['x-billpay-delivery'], got[0].headers['x-billpay-delivery']);
  assert.equal(g.body.delivery_id, g.headers['x-billpay-delivery']);
  assert.ok(verify(g.raw, g.headers['x-billpay-signature'], SECRET));
  assert.ok(!verify(g.raw, g.headers['x-billpay-signature'], 'wrong'));
  assert.equal(g.body.event, 'payment.reminder');
  assert.deepEqual([g.body.data.name, g.body.data.amount, g.body.data.currency, g.body.data.status, g.body.data.days_left], ['Аренда офиса', 185000, 'RUB', 'unpaid', 2]);
  assert.equal(g.body.data.url, `https://billpay.example.ru/app/calendar?date=${D.addDays(TODAY, 2)}`);
  st = await rows();
  assert.deepEqual(st.map((x) => [x.recipient, x.status, x.error]), [[hookUrl, 'sent', null]]);

  assert.equal((await dispatch(pool, payments, { webhook: hook })).hooked.length, 0);
  assert.equal((await dispatch(pool, payments, { webhook: hook })).hooked.length, 0);
  assert.equal(got.length, 2);
  await assert.rejects(pool.query(`INSERT INTO reminders (occurrence_id, channel, recipient, send_date) SELECT occurrence_id, channel, recipient, send_date FROM reminders WHERE channel = 'webhook' LIMIT 1`), /reminders_once_per_recipient/);
});

test('бот: без секрета запрос без подписи; недоступный адрес не роняет бота', async () => {
  const payments = createPayments(pool);
  const p = (await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'Связь', amount: 49.9, currency: 'EUR', next_date: D.addDays(TODAY, 1) } })).json;
  const r = await dispatch(pool, payments, { webhook: { url: hookUrl, secret: '' } });
  assert.equal(r.hooked.length, 1);
  const g = got.at(-1);
  assert.equal(g.headers['x-billpay-signature'], undefined);
  assert.equal(g.headers['x-billpay-event'], 'payment.reminder');
  assert.deepEqual([g.body.data.payment_id, g.body.data.amount, g.body.data.currency], [p.id, 49.9, 'EUR']);

  const tmp = http.createServer().listen(0);
  await new Promise((r) => tmp.once('listening', r));
  const dead = `http://127.0.0.1:${tmp.address().port}/hook`;
  await new Promise((r) => tmp.close(r));
  const n = got.length;
  const rd = await dispatch(pool, payments, { webhook: { url: dead, secret: SECRET } });
  assert.equal(rd.hooked.length, 0);
  const failed = (await rows()).filter((x) => x.recipient === dead);
  assert.equal(failed.length, 2);
  assert.ok(failed.every((x) => x.status === 'failed' && /ECONNREFUSED/.test(x.error)));
  assert.equal(got.length, n);
});

test('отправка: таймаут и редирект считаются ошибкой', async () => {
  const o = { id: 1, recurring_payment_id: 1, name: 'x', amount: 1, currency: 'RUB', due_date: TODAY };
  reply = 'hang';
  await assert.rejects(sendWebhook(o, { url: hookUrl, secret: '', today: TODAY, deliveryId: '1', timeoutMs: 300 }), /таймаут/);
  reply = 302;
  await assert.rejects(sendWebhook(o, { url: hookUrl, secret: '', today: TODAY, deliveryId: '1' }), /HTTP 302/);
  reply = 204;
  assert.equal(await sendWebhook(o, { url: hookUrl, secret: '', today: TODAY, deliveryId: '1' }), 204);
});
