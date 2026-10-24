const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.REMIND_DAYS_BEFORE = '3';
process.env.APP_URL = 'https://billpay.example.ru/';
for (const k of ['SMTP_HOST', 'SMTP_FROM', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) process.env[k] = '';

const nodemailer = require('nodemailer');
const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp } = require('../src/app');
const { createPayments } = require('../src/payments');
const { dispatch } = require('../src/bot');
const { parseEmail, buildReminder, fromHeader } = require('../src/mailer');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_mail_${process.pid}`;
const TODAY = D.today();
let admin, pool, server, base, A;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool({ connectionString: url, schema });
  const app = await createApp({ pool, loginRateMax: 1000 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = await login('admin', 'test-admin-pass');
});
after(async () => {
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
const users = async () => (await call('GET', '/api/v1/users', { cookie: A })).json;
const mailbox = () => {
  const sent = [];
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const orig = t.sendMail.bind(t);
  t.sendMail = async (m) => { const info = await orig(m); sent.push({ ...m, raw: info.message.toString() }); return info; };
  return { t, sent };
};

test('parseEmail: нижний регистр, пусто — null, неверное — ошибка', () => {
  assert.deepEqual(parseEmail('  Anna.S@Company.RU '), { value: 'anna.s@company.ru' });
  assert.deepEqual(parseEmail(''), { value: null });
  assert.deepEqual(parseEmail('   '), { value: null });
  assert.deepEqual(parseEmail(null), { value: null });
  for (const v of ['anna', 'anna@company', 'a b@company.ru', 'anna@@company.ru', '@company.ru', 42, {}, 'x'.repeat(250) + '@a.ru']) assert.equal(parseEmail(v).error, true, String(v));
});

test('пользователи: почта необязательна, хранится в нижнем регистре, 422 и 409', async () => {
  assert.equal((await users())[0].email, null);
  const a = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'anna', password: 'secret1', name: 'Анна', email: 'A.Smirnova@Company.ru' } });
  assert.equal(a.status, 201);
  assert.equal(a.json.email, 'a.smirnova@company.ru');
  const i = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'ivan', password: 'secret1', name: 'Иван' } });
  assert.equal(i.status, 201);
  assert.equal(i.json.email, null);
  const bad = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'olga', password: 'secret1', name: 'Ольга', email: 'olga@company' } });
  assert.equal(bad.status, 422);
  assert.match(bad.json.detail, /email/);
  const dup = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'olga', password: 'secret1', name: 'Ольга', email: 'a.smirnova@COMPANY.ru' } });
  assert.equal(dup.status, 409);
  assert.match(dup.json.detail, /почта уже указана/);
  assert.deepEqual((await users()).map((u) => [u.login, u.email]), [['admin', null], ['anna', 'a.smirnova@company.ru'], ['ivan', null]]);
});

test('PATCH /users/{id}: задать, 409, убрать через null и пустую строку; главный админ — 403', async () => {
  const ivan = (await users()).find((u) => u.login === 'ivan');
  let r = await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: 'I.Petrov@company.ru' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.email, 'i.petrov@company.ru');
  r = await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { name: 'Иван Петров' } });
  assert.deepEqual([r.json.name, r.json.email], ['Иван Петров', 'i.petrov@company.ru']);
  assert.equal((await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: 'a.smirnova@company.ru' } })).status, 409);
  assert.equal((await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: 'нет' } })).status, 422);
  assert.equal((await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: null } })).json.email, null);
  await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: 'i.petrov@company.ru' } });
  assert.equal((await call('PATCH', `/api/v1/users/${ivan.id}`, { cookie: A, body: { email: '' } })).json.email, null);
  assert.equal((await call('PATCH', '/api/v1/users/1', { cookie: A, body: { email: 'boss@company.ru' } })).status, 403);
});

test('PATCH /auth/me: только своя почта, у любого пользователя и у главного админа', async () => {
  const U = await login('ivan', 'secret1');
  assert.equal((await call('PATCH', '/api/v1/auth/me', { body: { email: 'x@company.ru' } })).status, 401);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: 'x@company.ru', name: 'Хакер' } })).status, 403);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { name: 'Хакер' } })).status, 403);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: {} })).status, 422);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: 'ivan@' } })).status, 422);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: 'A.SMIRNOVA@company.ru' } })).status, 409);
  const me = await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: ' Ivan@Company.ru ' } });
  assert.deepEqual([me.status, me.json.login, me.json.email, me.json.role], [200, 'ivan', 'ivan@company.ru', 'user']);
  assert.equal((await call('GET', '/api/v1/auth/me', { cookie: U })).json.email, 'ivan@company.ru');
  const boss = await call('PATCH', '/api/v1/auth/me', { cookie: A, body: { email: 'Finance@company.ru' } });
  assert.deepEqual([boss.status, boss.json.from_env, boss.json.email], [200, true, 'finance@company.ru']);
  assert.equal((await users())[0].email, 'finance@company.ru');
  assert.equal((await call('GET', '/api/v1/auth/me', { cookie: A })).json.email, 'finance@company.ru');
  const meta = (await call('GET', '/api/v1/meta', { cookie: U })).json;
  assert.deepEqual([meta.email, meta.currentUser.email], [{ enabled: false }, 'ivan@company.ru']);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: null } })).json.email, null);
  await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: 'ivan@company.ru' } });
});

test('письмо: тема и поля как в Telegram, ссылка на календарь, логотип по cid', () => {
  const o = { name: 'Аренда <офиса>', amount: 185000, currency: 'RUB', due_date: '2026-11-05' };
  const m = buildReminder(o, { today: '2026-11-02', to: 'a@company.ru', appUrl: 'https://b.ru' });
  assert.equal(m.subject, '🔔 Напоминание · за 3 дня: Аренда <офиса> — 185 000 ₽');
  assert.match(m.text, /Срок: 05\.11\.2026\nНазвание: Аренда <офиса>\nСумма: 185 000 ₽\nВалюта: RUB\nОсталось: 3 дня\n\nНе оплачено!/);
  assert.match(m.text, /https:\/\/b\.ru\/app\/calendar\?date=2026-11-05/);
  assert.match(m.html, /Аренда &lt;офиса&gt;/);
  assert.match(m.html, /src="cid:logo@billpay"/);
  assert.doesNotMatch(m.html, /<!--/);
  const late = buildReminder({ ...o, due_date: '2026-10-30' }, { today: '2026-11-02', to: 'a@company.ru', appUrl: '' });
  assert.match(late.subject, /срок прошёл/);
  assert.match(late.text, /Просрочка: просрочено на 3 дня/);
  assert.doesNotMatch(late.text + late.html, /Открыть в BillPay/);
  assert.deepEqual(fromHeader('notify@company.ru'), { name: 'BillPay', address: 'notify@company.ru' });
  assert.equal(fromHeader('BillPay <notify@company.ru>'), 'BillPay <notify@company.ru>');
});

test('бот: письмо каждому с почтой, без дублей на (период, канал, получатель), повтор после ошибки', async () => {
  const payments = createPayments(pool);
  const soon = D.addDays(TODAY, 2), later = D.addDays(TODAY, 10);
  const p1 = (await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'Аренда офиса', amount: 185000, currency: 'RUB', next_date: soon } })).json;
  await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'Хостинг', amount: 240, currency: 'USD', next_date: later } });

  const off = await dispatch(pool, payments);
  assert.equal(off.skipped, 'config');
  assert.deepEqual(off.off, { telegram: true, email: true });

  const box = mailbox();
  const r1 = await dispatch(pool, payments, { transport: box.t });
  assert.deepEqual(r1.off, { telegram: true, email: false });
  assert.deepEqual(r1.emailed.map((x) => x.to).sort(), ['a.smirnova@company.ru', 'finance@company.ru', 'ivan@company.ru']);
  assert.equal(box.sent.length, 3);
  const m = box.sent.find((x) => x.to === 'a.smirnova@company.ru');
  assert.match(m.subject, /^🔔 Напоминание · за 2 дня: Аренда офиса — 185 000 ₽$/);
  assert.match(m.text, /Не оплачено!/);
  assert.match(m.text, /https:\/\/billpay\.example\.ru\/app\/calendar\?date=/);
  assert.equal(m.attachments[0].cid, 'logo@billpay');
  assert.match(m.raw, /Content-ID: <logo@billpay>/);
  assert.match(m.raw, /multipart\/alternative/);

  assert.equal((await dispatch(pool, payments, { transport: box.t })).emailed.length, 0);
  assert.equal(box.sent.length, 3);

  const anna = (await users()).find((u) => u.login === 'anna');
  await call('PATCH', `/api/v1/users/${anna.id}`, { cookie: A, body: { email: 'anna.new@company.ru' } });
  const r3 = await dispatch(pool, payments, { transport: box.t });
  assert.deepEqual(r3.emailed.map((x) => x.to), ['anna.new@company.ru']);

  const { rows } = await pool.query(`SELECT channel, recipient, status FROM reminders WHERE occurrence_id = (SELECT id FROM payment_occurrences WHERE recurring_payment_id = $1 AND due_date = $2) ORDER BY recipient`, [p1.id, soon]);
  assert.deepEqual(rows.map((x) => [x.channel, x.recipient, x.status]), [['email', 'a.smirnova@company.ru', 'sent'], ['email', 'anna.new@company.ru', 'sent'], ['email', 'finance@company.ru', 'sent'], ['email', 'ivan@company.ru', 'sent']]);
  await assert.rejects(pool.query(`INSERT INTO reminders (occurrence_id, channel, recipient, send_date) SELECT occurrence_id, channel, recipient, send_date FROM reminders LIMIT 1`), /reminders_once_per_recipient/);

  await call('POST', '/api/v1/users', { cookie: A, body: { login: 'olga', password: 'secret1', name: 'Ольга', email: 'olga@company.ru' } });
  const broken = { sendMail: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:2525'); } };
  assert.equal((await dispatch(pool, payments, { transport: broken })).emailed.length, 0);
  const failed = (await pool.query(`SELECT status, error FROM reminders WHERE recipient = 'olga@company.ru'`)).rows;
  assert.deepEqual(failed.map((x) => [x.status, x.error]), [['failed', 'connect ECONNREFUSED 127.0.0.1:2525']]);
  const r5 = await dispatch(pool, payments, { transport: box.t });
  assert.deepEqual(r5.emailed.map((x) => x.to), ['olga@company.ru']);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM reminders WHERE recipient = 'olga@company.ru' AND status = 'sent' AND error IS NULL`)).rows[0].n, 1);

  const o = (await call('GET', `/api/v1/payment-occurrences?month=${soon.slice(0, 7)}`, { cookie: A })).json.find((x) => x.recurring_payment_id === p1.id);
  await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: A, body: { is_paid: true } });
  await call('POST', '/api/v1/users', { cookie: A, body: { login: 'petr', password: 'secret1', name: 'Пётр', email: 'petr@company.ru' } });
  assert.equal((await dispatch(pool, payments, { transport: box.t })).emailed.length, 0);
});
