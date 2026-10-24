// отдельная схема на прогон, даты от сегодняшнего дня в APP_TIMEZONE
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.REMIND_DAYS_BEFORE = '3';

const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool, migrate } = require('../src/db');
const { createApp } = require('../src/app');
const { resetData } = require('../src/reset');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_test_${process.pid}`;
const TODAY = D.today(), CUR = TODAY.slice(0, 7);
const mon = (d) => d.slice(0, 7);
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

async function call(method, url, { body, cookie, b = base } = {}) {
  const res = await fetch(b + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
async function login(l, p) {
  const r = await call('POST', '/api/v1/auth/login', { body: { login: l, password: p } });
  assert.equal(r.status, 200, `вход ${l}`);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  return r.headers.get('set-cookie').split(';')[0];
}
const occ = (month, cookie = A) => call('GET', `/api/v1/payment-occurrences?month=${month}`, { cookie }).then((r) => r.json);
const occOf = async (rpId, month) => (await occ(month)).find((o) => o.recurring_payment_id === rpId);
async function createPayment(body) {
  const r = await call('POST', '/api/v1/recurring-payments', { cookie: A, body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
const sumOf = async (month, c) => (await call('GET', `/api/v1/payments/summary?month=${month}`, { cookie: A })).json.find((x) => x.currency === c);

const F = {};
const D18 = D.addDays(TODAY, -18), FUT = D.addDays(TODAY, 10), M40 = mon(D.addDays(TODAY, 40));

test('чистая база: только главный админ, платежей нет', async () => {
  const users = (await call('GET', '/api/v1/users', { cookie: A })).json;
  assert.deepEqual(users.map((u) => [u.id, u.login, u.role, u.from_env]), [[1, 'admin', 'admin', true]]);
  assert.deepEqual((await call('GET', '/api/v1/recurring-payments?include_inactive=true', { cookie: A })).json, []);
  assert.deepEqual(await occ(CUR), []);
  const s = (await call('GET', `/api/v1/payments/summary?month=${CUR}`, { cookie: A })).json;
  assert.deepEqual(s.map((x) => [x.currency, x.to_pay, x.paid, x.overdue, x.total, x.count]), [['RUB', 0, 0, 0, 0, 0], ['USD', 0, 0, 0, 0, 0], ['EUR', 0, 0, 0, 0, 0]]);
  const meta = (await call('GET', `/api/v1/meta?month=${CUR}`, { cookie: A })).json;
  assert.deepEqual([meta.today, meta.budgets, meta.reminders], [TODAY, {}, []]);
});

test('healthz проверяет БД, заголовки безопасности (helmet)', async () => {
  const h = await call('GET', '/healthz');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json, { status: 'ok', db: 'ok' });
  assert.equal((await call('GET', '/api/v1/health')).json.db, 'ok');
  const p = await call('GET', '/');
  assert.match(p.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(p.headers.get('x-frame-options'), 'DENY');
  assert.equal(p.headers.get('x-powered-by'), null);
});

test('без авторизации: API 401, панель → /login; на странице входа нет тестовых аккаунтов', async () => {
  assert.equal((await call('GET', '/api/v1/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/v1/payment-occurrences')).status, 401);
  const p = await call('GET', '/app');
  assert.equal(p.status, 302);
  assert.match(p.headers.get('location'), /^\/login/);
  const l = await call('GET', '/login');
  assert.equal(l.status, 200);
  assert.doesNotMatch(l.text, /Тестовые аккаунты|demoAccounts|test-admin-pass/);
});

test('неверный пароль → 401', async () => {
  assert.equal((await call('POST', '/api/v1/auth/login', { body: { login: 'admin', password: 'x' } })).status, 401);
  assert.equal((await call('POST', '/api/v1/auth/login', { body: { login: 'nobody', password: 'x' } })).status, 401);
});

test('админ создаёт пользователя; итоги по валютам без конвертации; просрочка в днях', async () => {
  const u = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'anna', password: 'secret1', name: 'Анна', role: 'user' } });
  assert.equal(u.status, 201);
  F.user = u.json;
  F.rent = await createPayment({ name: 'Бухгалтерия', amount: 12000, currency: 'RUB', next_date: D18 });
  F.net = await createPayment({ name: 'Интернет', amount: 2500, currency: 'RUB', next_date: D18 });
  F.srv = await createPayment({ name: 'Сервер', amount: 49, currency: 'USD', next_date: D18 });
  F.notion = await createPayment({ name: 'Notion', amount: 10, currency: 'EUR', next_date: FUT });
  assert.equal(F.notion.next_date, FUT);

  const c = await login('anna', 'secret1');
  assert.equal((await call('GET', '/api/v1/auth/me', { cookie: c })).json.role, 'user');
  const net = await occOf(F.net.id, mon(D18));
  assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${net.id}`, { cookie: c, body: { is_paid: true, paid_at: D18 } })).json.status, 'paid');

  const rub = await sumOf(mon(D18), 'RUB'), usd = await sumOf(mon(D18), 'USD');
  assert.deepEqual([rub.to_pay, rub.paid, rub.overdue], [0, 2500, 12000]);
  assert.deepEqual([usd.to_pay, usd.paid, usd.overdue], [0, 0, 49]);
  const eur = await sumOf(mon(FUT), 'EUR');
  assert.deepEqual([eur.to_pay, eur.overdue, eur.count], [10, 0, 1]);

  const od = (await call('GET', `/api/v1/payment-occurrences?month=${mon(D18)}&status=overdue`, { cookie: c })).json;
  assert.deepEqual(od.map((o) => [o.name, o.overdue_days]).sort(), [['Бухгалтерия', 18], ['Сервер', 18]]);
  assert.equal((await call('GET', `/api/v1/payment-occurrences?month=${mon(D18)}&currency=USD`, { cookie: c })).json.length, 1);
});

test('напоминания: за 3 дня до срока, только по актуальным периодам', async () => {
  const meta = (await call('GET', `/api/v1/meta?month=${mon(FUT)}`, { cookie: A })).json;
  const o = await occOf(F.notion.id, mon(FUT));
  const r = meta.reminders.find((x) => x.occurrence_id === o.id);
  assert.deepEqual([r.send_date, r.status], [D.addDays(FUT, -3), 'scheduled']);
  assert.ok(meta.reminders.every((x) => x.send_date >= D.addDays(TODAY, -3)));
});

test('права: user отмечает оплату, но не управляет платежами и пользователями', async () => {
  const c = await login('anna', 'secret1');
  assert.equal((await call('POST', '/api/v1/recurring-payments', { cookie: c, body: { name: 'X', amount: 1, currency: 'RUB', next_date: FUT } })).status, 403);
  assert.equal((await call('DELETE', `/api/v1/recurring-payments/${F.rent.id}`, { cookie: c })).status, 403);
  assert.equal((await call('GET', '/api/v1/users', { cookie: c })).status, 403);
  const o = await occOf(F.rent.id, mon(D18));
  assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: c, body: { is_paid: true, paid_at: TODAY } })).json.status, 'paid');
  assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: c, body: { amount: 1 } })).status, 403);
  assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: c, body: { is_paid: true, paid_at: D.addDays(TODAY, 1) } })).status, 422);
  const un = (await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: c, body: { is_paid: false } })).json;
  assert.deepEqual([un.status, un.overdue_days, un.paid_at], ['overdue', 18, null]);
  assert.equal((await call('PATCH', '/api/v1/payment-occurrences/999999', { cookie: c, body: { is_paid: true } })).status, 404);
  const one = await call('GET', `/api/v1/payment-occurrences/${o.id}`, { cookie: c });
  assert.equal(one.status, 200); assert.equal(one.json.id, o.id); assert.ok(['paid', 'unpaid', 'overdue'].includes(one.json.status));
  assert.equal((await call('GET', '/api/v1/payment-occurrences/999999', { cookie: c })).status, 404);
  assert.equal((await call('GET', `/api/v1/payment-occurrences/${o.id}`)).status, 401);
});

test('валидация платежа и защита главного админа', async () => {
  assert.equal((await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: '', amount: -1, currency: 'GBP', next_date: 'x' } })).status, 422);
  assert.equal((await call('POST', '/api/v1/recurring-payments', { cookie: A, body: { name: 'X', amount: 1, currency: 'RUB', next_date: '2026-02-30' } })).status, 422);
  assert.equal((await call('DELETE', '/api/v1/users/1', { cookie: A })).status, 403);
  assert.equal((await call('PATCH', '/api/v1/users/1', { cookie: A, body: { name: 'x' } })).status, 403);
});

test('каждый месяц — новый период; срок 31-го → последний день месяца; без дублей', async () => {
  // месяц с 31-м числом, следующий за ним короче
  let m = D.addMonths(CUR, 1);
  while (D.daysInMonth(m) !== 31 || D.daysInMonth(D.addMonths(m, 1)) === 31) m = D.addMonths(m, 1);
  const next = D.addMonths(m, 1);
  const p = await createPayment({ name: 'GitHub', amount: 20, currency: 'USD', next_date: `${m}-31` });
  assert.equal((await occOf(p.id, m)).due_date, `${m}-31`);
  assert.equal((await occOf(p.id, next)).due_date, `${next}-${D.daysInMonth(next)}`);
  const nextList = await occ(next);
  for (const id of [F.rent.id, F.net.id, F.srv.id, F.notion.id, p.id]) assert.ok(nextList.some((o) => o.recurring_payment_id === id), `период ${id} в ${next}`);
  await Promise.all([1, 2, 3, 4].map(() => occ(D.addMonths(next, 1))));
  const { rows } = await pool.query('SELECT 1 FROM payment_occurrences GROUP BY recurring_payment_id, month HAVING count(*) > 1');
  assert.equal(rows.length, 0);
});

test('изменение платежа: меняются неоплаченные периоды, оплаченная история — нет', async () => {
  const before = await occOf(F.net.id, M40);
  assert.equal(before.amount, 2500);
  const r = await call('PATCH', `/api/v1/recurring-payments/${F.net.id}`, { cookie: A, body: { amount: 3000 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.amount, 3000);
  assert.equal((await occOf(F.net.id, M40)).amount, 3000);
  const hist = await occOf(F.net.id, mon(D18));
  assert.deepEqual([hist.amount, hist.status], [2500, 'paid']);
  assert.equal((await call('PATCH', `/api/v1/recurring-payments/${F.net.id}`, { cookie: A, body: { currency: 'GBP' } })).status, 422);
});

test('мягкое удаление платежа: история сохраняется, новые периоды не создаются', async () => {
  const o = await occOf(F.srv.id, mon(D18));
  await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: A, body: { is_paid: true, paid_at: D18 } });
  assert.equal((await call('DELETE', `/api/v1/recurring-payments/${F.srv.id}`, { cookie: A })).status, 204);
  assert.equal((await call('DELETE', `/api/v1/recurring-payments/${F.srv.id}`, { cookie: A })).status, 404);
  assert.equal((await call('PATCH', `/api/v1/recurring-payments/${F.srv.id}`, { cookie: A, body: { amount: 1 } })).status, 404);
  assert.ok(!(await call('GET', '/api/v1/recurring-payments', { cookie: A })).json.some((p) => p.id === F.srv.id));
  const all = (await call('GET', '/api/v1/recurring-payments?include_inactive=true', { cookie: A })).json.find((p) => p.id === F.srv.id);
  assert.deepEqual([all.active, all.next_date], [false, null]);
  const { rows: [rp] } = await pool.query('SELECT deleted_at, active FROM recurring_payments WHERE id = $1', [F.srv.id]);
  assert.deepEqual(rp, { deleted_at: TODAY, active: false });
  assert.equal((await occOf(F.srv.id, mon(D18))).status, 'paid', 'оплаченная история осталась');
  for (const m of [CUR, M40, D.addMonths(CUR, 3)].filter((m) => m !== mon(D18))) assert.equal(await occOf(F.srv.id, m), undefined, `нет периода в ${m}`);
});

test('пользователи: CRUD, уникальный логин, удалённый теряет доступ', async () => {
  const r = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'New.User', password: 'secret1', name: ' Новый ' } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.json.login, r.json.name, r.json.role, r.json.from_env], ['new.user', 'Новый', 'user', false]);
  assert.equal((await call('POST', '/api/v1/users', { cookie: A, body: { login: 'boss', password: 'secret1', name: 'Босс', role: 'admin' } })).status, 403);
  assert.equal((await call('POST', '/api/v1/users', { cookie: A, body: { login: 'new.user', password: 'secret1', name: 'x' } })).status, 409);
  assert.equal((await call('POST', '/api/v1/users', { cookie: A, body: { login: 'ADMIN', password: 'secret1', name: 'x' } })).status, 409);
  assert.equal((await call('POST', '/api/v1/users', { cookie: A, body: { login: 'x', password: '1', name: '' } })).status, 422);
  const c = await login('new.user', 'secret1');
  assert.equal((await call('GET', '/api/v1/users', { cookie: c })).status, 403);
  assert.equal((await call('PATCH', `/api/v1/users/${r.json.id}`, { cookie: A, body: { role: 'admin' } })).status, 403);
  const patched = await call('PATCH', `/api/v1/users/${r.json.id}`, { cookie: A, body: { name: 'Переименован', password: 'secret2' } });
  assert.equal(patched.json.name, 'Переименован');
  assert.equal(patched.json.role, 'user');
  await login('new.user', 'secret2');
  const users = (await call('GET', '/api/v1/users', { cookie: A })).json;
  assert.deepEqual(users.map((u) => u.login), ['admin', 'anna', 'new.user']);
  assert.equal((await call('DELETE', `/api/v1/users/${r.json.id}`, { cookie: A })).status, 204);
  assert.equal((await call('GET', '/api/v1/auth/me', { cookie: c })).status, 401);
  assert.equal((await call('DELETE', `/api/v1/users/${r.json.id}`, { cookie: A })).status, 404);
});

test('ограничение попыток входа → 429', async () => {
  const app = await createApp({ pool, loginRateMax: 2 });
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    const bad = () => call('POST', '/api/v1/auth/login', { b, body: { login: 'anna', password: 'wrong' } });
    assert.equal((await bad()).status, 401);
    assert.equal((await bad()).status, 401);
    const third = await bad();
    assert.equal(third.status, 429);
    assert.match(third.json.detail, /Слишком много/);
  } finally { await new Promise((r) => s.close(r)); }
});

test('logout очищает cookie', async () => {
  const r = await call('POST', '/api/v1/auth/logout');
  assert.equal(r.status, 204);
  assert.match(r.headers.get('set-cookie'), /billpay_session=;/);
});

test('миграции повторно не применяются; reset оставляет только главного админа; id не переиспользуются', async () => {
  assert.deepEqual(await migrate(pool, { log: false }), []);
  const { rows: [{ max }] } = await pool.query('SELECT max(id)::int AS max FROM users');
  await resetData(pool);
  const { rows } = await pool.query('SELECT id, login, is_env_admin FROM users');
  assert.deepEqual(rows, [{ id: 1, login: 'admin', is_env_admin: true }]);
  for (const t of ['recurring_payments', 'payment_occurrences', 'reminders', 'settings']) {
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
  }
  assert.equal((await call('GET', '/api/v1/auth/me', { cookie: A })).status, 200, 'главный админ продолжает работать');
  const u = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'after.reset', password: 'secret1', name: 'X' } });
  assert.equal(u.status, 201);
  assert.ok(u.json.id > max, 'id удалённых пользователей не выдаются повторно');
  // повторный старт не должен выдать старый id
  await createApp({ pool });
  const v = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'after.restart', password: 'secret1', name: 'Y' } });
  assert.ok(v.json.id > u.json.id);
});
