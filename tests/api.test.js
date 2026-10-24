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

test('список периодов: поиск, фильтры, сортировка, счётчики и итоги по валютам', async () => {
  const M = mon(D18), c = await login('anna', 'secret1');
  const made = {};
  for (const [k, name, amount, currency] of [['a', 'ФТ Аренда офиса', 85000, 'RUB'], ['b', 'ФТ Сервер', 48, 'USD'], ['c', 'ФТ Подписка', 10, 'EUR'], ['d', 'ФТ Аренда склада', 45000, 'RUB']]) {
    made[k] = await createPayment({ name, amount, currency, next_date: D18 });
  }
  const d = await occOf(made.d.id, M);
  await call('PATCH', `/api/v1/payment-occurrences/${d.id}`, { cookie: c, body: { is_paid: true, paid_at: D.addDays(D18, 2) } });
  const page = async (qs, cookie = c) => { const r = await call('GET', `/api/v1/payment-occurrences?month=${M}&include=meta&${qs}`, { cookie }); assert.equal(r.status, 200, r.text); return r.json; };

  // без конвертации
  let p = await page('q=фт');
  assert.equal(p.month, M);
  assert.ok(p.total >= 4);
  assert.equal(p.count, 4);
  assert.deepEqual(p.counts, { all: 4, unpaid: 0, overdue: 3, paid: 1 });
  assert.deepEqual(p.totals.map((t) => [t.currency, t.count, t.total, t.paid, t.overdue, t.to_pay]), [['RUB', 2, 130000, 45000, 85000, 0], ['USD', 1, 48, 0, 48, 0], ['EUR', 1, 10, 0, 10, 0]]);
  assert.deepEqual((await page('q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0')).items.filter((o) => o.name.startsWith('ФТ')).map((o) => o.name).sort(), ['ФТ Аренда офиса', 'ФТ Аренда склада']);

  // список валют
  p = await page('q=фт&currency=rub,EUR');
  assert.deepEqual(p.items.map((o) => o.currency).sort(), ['EUR', 'RUB', 'RUB']);
  assert.equal(p.totals.find((t) => t.currency === 'USD').count, 0);
  p = await page('q=фт&status=paid');
  assert.deepEqual([p.count, p.counts.all, p.items[0].name], [1, 4, 'ФТ Аренда склада']);
  assert.deepEqual(p.totals.find((t) => t.currency === 'RUB').total, 45000);

  // внутри валюты
  p = await page('q=фт&sort=amount&order=desc');
  assert.deepEqual(p.items.map((o) => [o.currency, o.amount]), [['RUB', 85000], ['RUB', 45000], ['USD', 48], ['EUR', 10]]);
  p = await page('q=фт&sort=amount&order=asc');
  assert.deepEqual(p.items.map((o) => [o.currency, o.amount]), [['RUB', 45000], ['RUB', 85000], ['USD', 48], ['EUR', 10]]);
  p = await page('q=фт&sort=name&order=asc');
  assert.deepEqual(p.items.map((o) => o.name), ['ФТ Аренда офиса', 'ФТ Аренда склада', 'ФТ Подписка', 'ФТ Сервер']);
  p = await page('q=фт&sort=name&order=desc');
  assert.equal(p.items[0].name, 'ФТ Сервер');
  for (const order of ['asc', 'desc']) assert.equal((await page(`q=фт&sort=paid_at&order=${order}`)).items[0].name, 'ФТ Аренда склада', 'без даты оплаты — в конце');
  p = await page('q=фт&sort=status&order=asc');
  assert.equal(p.items[p.items.length - 1].status, 'paid');
  p = await page('q=фт&sort=overdue_days&order=desc');
  assert.ok(p.items[0].overdue_days >= p.items[p.items.length - 1].overdue_days);
  assert.equal(p.items[p.items.length - 1].name, 'ФТ Аренда склада');
  assert.deepEqual((await page('q=фт&sort=due_date&order=asc')).items.map((o) => o.id), [...p.items].sort((x, y) => x.id - y.id).map((o) => o.id));

  p = await page('q=zzz-нет-такого');
  assert.deepEqual([p.count, p.items, p.counts.all], [0, [], 0]);
  assert.ok(p.totals.every((t) => t.count === 0 && t.total === 0));

  const arr = (await call('GET', `/api/v1/payment-occurrences?month=${M}&q=фт&currency=USD,EUR&sort=amount&order=desc`, { cookie: c })).json;
  assert.ok(Array.isArray(arr));
  assert.deepEqual(arr.map((o) => o.currency), ['USD', 'EUR']);
  const sum = (await call('GET', `/api/v1/payments/summary?month=${M}&q=фт&status=overdue`, { cookie: c })).json;
  assert.deepEqual(sum.map((t) => [t.currency, t.overdue, t.count]), [['RUB', 85000, 1], ['USD', 48, 1], ['EUR', 10, 1]]);

  for (const qs of ['sort=foo', 'order=up', 'currency=GBP', 'currency=RUB,XXX', 'status=late', 'include=all', `q=${'я'.repeat(101)}`, 'currency=RUB&currency=USD', 'sort=amount&sort=name']) {
    assert.equal((await call('GET', `/api/v1/payment-occurrences?month=${M}&${qs}`, { cookie: c })).status, 400, qs);
  }
  assert.equal((await call('GET', `/api/v1/payments/summary?month=${M}&currency=GBP`, { cookie: c })).status, 400);
  assert.equal((await call('GET', `/api/v1/payment-occurrences?month=${M}&include=meta&q=фт`)).status, 401);
  for (const k of Object.keys(made)) assert.equal((await call('DELETE', `/api/v1/recurring-payments/${made[k].id}`, { cookie: A })).status, 204);
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
  // короткий месяц
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

test('итоги на дату: оплачено/к оплате — месяц даты, просрочено — все периоды до даты, включая прошлые месяцы', async () => {
  const W = D.addMonths(CUR, -2), X = D.addMonths(CUR, -1), DX = `${X}-20`;
  // ищем 31-е
  let M31 = W; while (D.daysInMonth(M31) < 31) M31 = D.addMonths(M31, -1);
  const mk = (name, amount, currency, next_date) => createPayment({ name, amount, currency, next_date });
  const P = {
    late: await mk('НД оплата после даты', 101, 'USD', `${W}-15`),
    dueOn: await mk('НД срок в дату', 2002, 'RUB', DX),
    paid: await mk('НД оплачено до даты', 3003, 'RUB', `${X}-05`),
    d31: await mk('НД 31-е', 31, 'EUR', `${M31}-31`),
    prev: await mk('НД прошлый месяц', 50, 'EUR', `${W}-10`),
    del: await mk('НД удалённый', 70, 'USD', `${W}-12`)
  };
  const ids = new Set(Object.values(P).map((p) => p.id));
  // лениво
  const { rows: before } = await pool.query('SELECT month::text AS month FROM payment_occurrences WHERE recurring_payment_id = $1', [P.prev.id]);
  assert.ok(before.some((r) => r.month === W) && !before.some((r) => r.month === X));

  const occIn = async (rp, m) => (await occ(m)).find((o) => o.recurring_payment_id === rp.id);
  const pay = async (rp, m, date) => { const o = await occIn(rp, m); assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${o.id}`, { cookie: A, body: { is_paid: true, paid_at: date } })).status, 200); };
  await pay(P.late, W, `${W}-15`);
  await pay(P.late, X, `${X}-25`); // оплачено позже даты итогов
  await pay(P.paid, X, `${X}-05`);
  await pay(P.del, W, `${W}-12`);
  assert.equal((await call('DELETE', `/api/v1/recurring-payments/${P.del.id}`, { cookie: A })).status, 204);
  // досоздание
  await pool.query('DELETE FROM payment_occurrences WHERE recurring_payment_id = $1 AND month = $2', [P.prev.id, X]);

  const get = (qs, cookie = A) => call('GET', `/api/v1/payments/summary?${qs}`, { cookie });
  const r = await get(`date=${DX}&include=items`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.as_of, DX);
  assert.equal(r.json.month, X);
  const mine = r.json.items.filter((o) => ids.has(o.recurring_payment_id));
  const b = (rp, m) => { const o = mine.find((x) => x.recurring_payment_id === rp.id && x.month === m); return o ? o.on_date.bucket : null; };
  assert.equal(b(P.late, X), 'overdue', 'оплачено позже даты → на дату просрочено');
  assert.equal(b(P.late, W), null, 'оплаченный вовремя прошлый период не попадает');
  assert.equal(b(P.dueOn, X), 'to_pay', 'срок в саму дату → к оплате');
  assert.equal(b(P.paid, X), 'paid');
  assert.equal(b(P.prev, W), 'overdue', 'неоплаченный период прошлого месяца → просрочено');
  assert.equal(b(P.prev, X), 'overdue', 'месяц X досоздан и просрочен');
  const d31 = mine.find((o) => o.recurring_payment_id === P.d31.id && o.month === X);
  assert.equal(d31.due_date, D.dueInMonth(X, 31), '31-е → последний день месяца');
  assert.equal(d31.day, 31, 'число по графику отдаётся в периоде');
  assert.equal(d31.on_date.bucket, 'to_pay');
  assert.equal(mine.find((o) => o.recurring_payment_id === P.prev.id && o.month === W).on_date.overdue_days, D.diffDays(DX, `${W}-10`));

  // прошлые месяцы
  for (const t of r.json.totals) {
    const xs = r.json.items.filter((o) => o.currency === t.currency), sum = (f) => Math.round(xs.filter(f).reduce((a, o) => a + o.amount, 0) * 100) / 100;
    assert.equal(t.paid, sum((o) => o.on_date.bucket === 'paid'));
    assert.equal(t.to_pay, sum((o) => o.on_date.bucket === 'to_pay'));
    assert.equal(t.overdue, sum((o) => o.on_date.bucket === 'overdue'));
    assert.equal(t.overdue_earlier, sum((o) => o.on_date.bucket === 'overdue' && o.month < X));
    assert.equal(t.month_total, sum((o) => o.month === X));
    assert.equal(t.count, xs.length);
  }
  // тот же массив
  const plain = (await get(`date=${DX}`)).json;
  assert.deepEqual(plain.map((t) => t.currency), ['RUB', 'USD', 'EUR']);
  assert.ok(plain.every((t) => t.as_of === DX && 'paid_count' in t && 'to_pay_count' in t && 'overdue_count' in t));
  assert.deepEqual(plain.map((t) => t.overdue), r.json.totals.map((t) => t.overdue));

  // без будущих
  const fut = D.addDays(TODAY, 40), F2 = await get(`date=${fut}&include=items`);
  assert.equal(F2.status, 200);
  assert.ok(!F2.json.items.some((o) => o.recurring_payment_id === P.del.id && o.month >= CUR), 'удалённый — без периодов с месяца удаления');
  // только отмеченное
  const fm = F2.json.items.filter((o) => ids.has(o.recurring_payment_id));
  assert.equal(F2.json.month, fut.slice(0, 7));
  for (const o of fm) {
    if (o.month === fut.slice(0, 7)) assert.equal(o.on_date.bucket, o.paid_at && o.paid_at <= fut ? 'paid' : o.due_date >= fut ? 'to_pay' : 'overdue');
    else assert.ok(o.due_date < fut && !o.paid_at && o.on_date.bucket === 'overdue');
  }
  assert.ok(fm.some((o) => o.recurring_payment_id === P.dueOn.id && o.month === X && o.on_date.bucket === 'overdue'));

  await call('POST', '/api/v1/users', { cookie: A, body: { login: 'ndtest', password: 'secret1', name: 'НД', role: 'user' } });
  const u = await login('ndtest', 'secret1');
  assert.equal((await get(`date=${DX}`, u)).status, 200);

  for (const qs of [`date=${DX}&month=${X}`, 'date=2026-02-30', 'date=26-10-01', `date=${DX}&q=x`, `date=${DX}&currency=RUB`, `date=${DX}&include=all`, 'include=items', `date=${D.addMonths(CUR, 13)}-01`]) {
    assert.equal((await get(qs)).status, 400, qs);
  }
  assert.equal((await call('GET', `/api/v1/payments/summary?date=${DX}`)).status, 401);
  for (const k of ['late', 'dueOn', 'paid', 'd31', 'prev']) await call('DELETE', `/api/v1/recurring-payments/${P[k].id}`, { cookie: A });
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
  // старый id
  await createApp({ pool });
  const v = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'after.restart', password: 'secret1', name: 'Y' } });
  assert.ok(v.json.id > u.json.id);
});
