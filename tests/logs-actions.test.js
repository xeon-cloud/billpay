const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.TRUST_PROXY = '1';

const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp } = require('../src/app');
const { createPayments } = require('../src/payments');
const { createAudit } = require('../src/audit');
const { onPaid } = require('../src/bot');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_actions_${process.pid}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const TODAY = D.today(), MONTH = TODAY.slice(0, 7);
let admin, pool, server, base, A, U, dimaId, rpId, occId, token;

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool({ connectionString: url, schema });
  const app = await createApp({ pool, loginRateMax: 1000 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function call(method, path, { body, cookie = A, ua = UA, ip = '203.0.113.24', auth } = {}) {
  const headers = { 'User-Agent': ua, 'X-Forwarded-For': ip };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (auth) headers.Authorization = auth;
  const res = await fetch(base + path, { method, redirect: 'manual', headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const actions = async () => (await pool.query(`SELECT *, host(ip) AS ip_text FROM audit_log WHERE kind = 'action' ORDER BY id`)).rows;
const last = async () => (await actions()).at(-1);
const count = async () => (await actions()).length;
const list = (qs = '', cookie = A) => call('GET', '/api/v1/logs/actions' + qs, { cookie });
const pick = (changes) => Object.fromEntries(changes.map((c) => [c.field, [c.before, c.after]]));

async function signIn(login, password, ua = UA) {
  const r = await call('POST', '/api/v1/auth/login', { body: { login, password }, cookie: null, ua });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get('set-cookie').split(';')[0], token: r.json.access_token };
}

test('платёж: создание, изменение с диффом полей и удаление', async () => {
  const s = await signIn('admin', 'test-admin-pass');
  A = s.cookie; token = s.token;
  const due = `${MONTH}-05`;
  const c = await call('POST', '/api/v1/recurring-payments', { body: { name: 'Аренда офиса', amount: 185000, currency: 'RUB', next_date: due } });
  assert.equal(c.status, 201);
  rpId = c.json.id;
  const e1 = await last();
  assert.deepEqual([e1.event, e1.result, +e1.actor_id, e1.actor_login, e1.actor_name, e1.source, e1.object_type, +e1.object_id, e1.ip_text, e1.user_agent],
    ['payment.created', 'ok', 1, 'admin', config.admin.name, 'web', 'payment', rpId, '203.0.113.24', UA]);
  assert.equal(e1.object_label, 'Аренда офиса\nежемесячно · 185 000 ₽');
  assert.deepEqual(pick(e1.changes), { name: [null, 'Аренда офиса'], amount: [null, '185 000 ₽'], day: [null, '5 число'], next_date: [null, D.isDate(due) && due.split('-').reverse().join('.')] });

  const n = await count();
  const u = await call('PATCH', `/api/v1/recurring-payments/${rpId}`, { body: { amount: 195000, next_date: `${MONTH}-07` } });
  assert.equal(u.status, 200);
  assert.equal(await count(), n + 1);
  const e2 = await last();
  assert.equal(e2.event, 'payment.updated');
  assert.equal(e2.object_label, 'Аренда офиса\nежемесячно · 195 000 ₽');
  const d2 = pick(e2.changes);
  assert.deepEqual(d2.amount, ['185 000 ₽', '195 000 ₽']);
  assert.deepEqual(d2.day, ['5 число', '7 число']);
  assert.equal(d2.name, undefined);

  await call('PATCH', `/api/v1/recurring-payments/${rpId}`, { body: { name: 'Офис', currency: 'USD' } });
  const d3 = pick((await last()).changes);
  assert.deepEqual([d3.name, d3.currency, d3.amount], [['Аренда офиса', 'Офис'], ['RUB', 'USD'], ['195 000 ₽', '$195000.00']]);

  const same = await count();
  assert.equal((await call('PATCH', `/api/v1/recurring-payments/${rpId}`, { body: { name: 'Офис' } })).status, 200);
  assert.equal(await count(), same, 'изменение без разницы не пишется');

  const tmp = await call('POST', '/api/v1/recurring-payments', { body: { name: 'Телефония', amount: 1900, currency: 'RUB', next_date: TODAY } });
  assert.equal((await call('DELETE', `/api/v1/recurring-payments/${tmp.json.id}`)).status, 204);
  const e4 = await last();
  assert.deepEqual([e4.event, +e4.object_id, e4.object_label], ['payment.deleted', tmp.json.id, 'Телефония\nежемесячно · 1 900 ₽']);
  assert.deepEqual(pick(e4.changes).active, ['активен', 'удалён · история оплат сохранена']);
});

test('оплата: отметка, смена даты и снятие отметки — от имени пользователя', async () => {
  const dima = await call('POST', '/api/v1/users', { body: { login: 'dima', name: 'Дмитрий Орлов', password: 'dima-pass-1' } });
  dimaId = dima.json.id;
  U = (await signIn('dima', 'dima-pass-1', IPH)).cookie;
  const occ = (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}`, { cookie: U })).json.find((o) => o.recurring_payment_id === rpId);
  occId = occ.id;
  const y = D.addDays(TODAY, -1);
  assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${occId}`, { cookie: U, ua: IPH, ip: '192.0.2.17', body: { is_paid: true } })).status, 200);
  const p = await last();
  assert.deepEqual([p.event, +p.actor_id, p.actor_login, p.object_type, +p.object_id, p.ip_text], ['occurrence.paid', dimaId, 'dima', 'occurrence', occId, '192.0.2.17']);
  assert.match(p.object_label, /^Офис\n\S+ \d{4} · \$195000\.00$/);
  assert.deepEqual(pick(p.changes).paid_at, [null, TODAY.split('-').reverse().join('.')]);

  const n = await count();
  await call('PATCH', `/api/v1/payment-occurrences/${occId}`, { cookie: U, body: { is_paid: true, paid_at: TODAY } });
  assert.equal(await count(), n, 'та же дата — без записи');
  await call('PATCH', `/api/v1/payment-occurrences/${occId}`, { cookie: U, body: { paid_at: y } });
  const pa = await last();
  assert.equal(pa.event, 'occurrence.paid_at');
  assert.deepEqual(pick(pa.changes).paid_at, [TODAY.split('-').reverse().join('.'), y.split('-').reverse().join('.')]);
  await call('PATCH', `/api/v1/payment-occurrences/${occId}`, { cookie: U, body: { is_paid: false } });
  const un = await last();
  assert.equal(un.event, 'occurrence.unpaid');
  assert.deepEqual(pick(un.changes).paid_at, [y.split('-').reverse().join('.'), null]);
});

test('кнопка «Оплачено» в Telegram: источник telegram, аккаунт и чат', async () => {
  const payments = createPayments(pool);
  const audit = createAudit(pool);
  const real = global.fetch;
  const sent = [];
  global.fetch = async (u, o) => { sent.push(String(u)); return { ok: true, json: async () => ({ ok: true, result: true }) }; };
  const q = { id: 'cb1', data: `paid:${occId}`, from: { id: 42, username: 'dima_orlov' }, message: { message_id: 7, chat: { id: -100, title: 'Финансы' } } };
  try {
    await onPaid(payments, q, audit);
    const n = await count();
    await onPaid(payments, { ...q, id: 'cb2' }, audit);
    assert.equal(await count(), n, 'повторное нажатие не пишется');
  } finally { global.fetch = real; }
  assert.ok(sent.length >= 2);
  const e = (await actions()).filter((r) => r.source === 'telegram').at(-1);
  assert.deepEqual([e.event, e.actor_id, e.actor_login, e.actor_name, e.source, e.source_ref, e.ip, e.user_agent], ['occurrence.paid', null, null, null, 'telegram', '@dima_orlov\nФинансы', null, null]);
  const api = (await list(`?q=dima_orlov`)).json.items[0];
  assert.deepEqual([api.source, api.telegram, api.user, api.user_deleted], ['telegram', { user: '@dima_orlov', chat: 'Финансы' }, null, false]);
  const { rows: [o] } = await pool.query('SELECT paid_at, paid_by FROM payment_occurrences WHERE id = $1', [occId]);
  assert.deepEqual([o.paid_at, o.paid_by], [TODAY, null]);
});

test('пользователи: создание, изменение и удаление; пароль — только факт', async () => {
  const c = await call('POST', '/api/v1/users', { body: { login: 'o.belova', name: 'Ольга Белова', password: 'belova-secret-1', email: 'o.belova@company.ru' } });
  assert.equal(c.status, 201);
  const e1 = await last();
  assert.deepEqual([e1.event, e1.object_type, +e1.object_id, e1.object_label], ['user.created', 'user', c.json.id, 'o.belova\nОльга Белова']);
  assert.deepEqual(pick(e1.changes), { login: [null, 'o.belova'], name: [null, 'Ольга Белова'], email: [null, 'o.belova@company.ru'], password: [null, 'задан'] });

  await call('PATCH', `/api/v1/users/${c.json.id}`, { body: { name: 'Ольга Белова-Смирнова', password: 'belova-secret-2', email: null } });
  const e2 = await last();
  assert.equal(e2.event, 'user.updated');
  assert.deepEqual(pick(e2.changes), { name: ['Ольга Белова', 'Ольга Белова-Смирнова'], email: ['o.belova@company.ru', null], password: ['••••', 'изменён'] });
  const n = await count();
  await call('PATCH', `/api/v1/users/${c.json.id}`, { body: { name: 'Ольга Белова-Смирнова' } });
  assert.equal(await count(), n);

  assert.equal((await call('DELETE', `/api/v1/users/${c.json.id}`)).status, 204);
  const e3 = await last();
  assert.deepEqual([e3.event, +e3.object_id, e3.object_label], ['user.deleted', c.json.id, 'o.belova\nОльга Белова-Смирнова']);
  assert.deepEqual(pick(e3.changes).user, ['o.belova · Ольга Белова-Смирнова', null]);

  const { rows: hashes } = await pool.query('SELECT password_hash FROM users');
  const dump = JSON.stringify(await actions()) + JSON.stringify((await list('?limit=100')).json);
  for (const secret of ['belova-secret-1', 'belova-secret-2', 'dima-pass-1', 'test-admin-pass', token, A.split('=')[1], config.sessionSecret, ...hashes.map((h) => h.password_hash)]) {
    assert.ok(!dump.includes(secret), 'утечка: ' + secret.slice(0, 6));
  }
  assert.ok(!/\$2[aby]\$/.test(dump), 'в журнале нет bcrypt-хешей');
});

test('своя почта через PATCH /auth/me', async () => {
  const r = await call('PATCH', '/api/v1/auth/me', { cookie: U, ua: IPH, body: { email: 'Dima@Company.ru' } });
  assert.equal(r.status, 200);
  const e = await last();
  assert.deepEqual([e.event, +e.actor_id, e.object_type, +e.object_id, e.object_label], ['profile.email', dimaId, 'user', dimaId, 'dima\nсвоя почта']);
  assert.deepEqual(pick(e.changes).email, [null, 'dima@company.ru']);
  const n = await count();
  await call('PATCH', '/api/v1/auth/me', { cookie: U, body: { email: 'dima@company.ru' } });
  assert.equal(await count(), n);
});

test('запрос через Bearer-токен отмечается источником api', async () => {
  await call('PATCH', `/api/v1/recurring-payments/${rpId}`, { cookie: null, auth: 'Bearer ' + token, ua: 'curl/8.7.1', body: { name: 'Аренда офиса' } });
  const e = await last();
  assert.deepEqual([e.event, e.source, +e.actor_id], ['payment.updated', 'api', 1]);
  assert.equal((await list('?limit=1')).json.items[0].device, 'curl 8.7');
});

test('ошибка записи журнала не ломает действие', async () => {
  await pool.query(`ALTER TABLE audit_log ADD CONSTRAINT audit_log_test_block CHECK (kind <> 'action') NOT VALID`);
  const err = console.error; const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const n = await count();
    const c = await call('POST', '/api/v1/recurring-payments', { body: { name: 'Хостинг', amount: 20, currency: 'EUR', next_date: TODAY } });
    assert.equal(c.status, 201);
    const occ = (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}`)).json.find((o) => o.recurring_payment_id === c.json.id);
    assert.equal((await call('PATCH', `/api/v1/payment-occurrences/${occ.id}`, { body: { is_paid: true } })).status, 200);
    assert.equal((await call('PATCH', '/api/v1/auth/me', { body: { email: 'admin@company.ru' } })).status, 200);
    const { rows: [rp] } = await pool.query('SELECT name FROM recurring_payments WHERE id = $1', [c.json.id]);
    assert.equal(rp.name, 'Хостинг');
    const { rows: [o] } = await pool.query('SELECT paid_at FROM payment_occurrences WHERE id = $1', [occ.id]);
    assert.equal(o.paid_at, TODAY);
    assert.equal(await count(), n);
    assert.ok(logged.some((l) => /журнал: запись не сохранена/.test(l)));
  } finally {
    console.error = err;
    await pool.query('ALTER TABLE audit_log DROP CONSTRAINT audit_log_test_block');
  }
});

test('действия удалённого пользователя остаются по снимку логина и имени', async () => {
  const c = await call('POST', '/api/v1/users', { body: { login: 'temp', name: 'Временный', password: 'temp-pass-1' } });
  const t = (await signIn('temp', 'temp-pass-1')).cookie;
  await call('PATCH', '/api/v1/auth/me', { cookie: t, body: { email: 'temp@company.ru' } });
  assert.equal((await call('DELETE', `/api/v1/users/${c.json.id}`)).status, 204);
  const e = (await list('?q=temp@company')).json.items.find((x) => x.event === 'profile.email');
  assert.deepEqual([e.login, e.user, e.user_deleted, e.object.label, e.object.detail], ['temp', null, true, 'temp', 'своя почта']);
});

test('список действий: сначала новые, счётчики, фильтры object_type / user_id / q / даты', async () => {
  const all = (await list('?limit=100')).json;
  const ids = all.items.map((x) => x.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  const db = await actions();
  assert.equal(all.counts.all, db.length);
  for (const k of ['payment', 'occurrence', 'user']) assert.equal(all.counts[k], db.filter((r) => r.object_type === k).length, k);
  assert.ok(all.items.every((x) => x.kind === 'action' && Array.isArray(x.changes) && x.object && x.object.type && x.user_agent === undefined));
  const upd = all.items.find((x) => x.event === 'payment.updated' && x.source === 'web');
  assert.deepEqual([upd.object.type, upd.object.id, upd.object.label, upd.user.login, upd.user.role, upd.ip, upd.device, upd.telegram], ['payment', rpId, 'Офис', 'admin', 'admin', '203.0.113.24', 'Chrome 141 · macOS', null]);
  assert.match(upd.local_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

  const pay = (await list('?object_type=payment&limit=100')).json;
  assert.ok(pay.items.length && pay.items.every((x) => x.object.type === 'payment'));
  assert.deepEqual(pay.counts, all.counts);
  assert.ok((await list('?object_type=occurrence&limit=100')).json.items.every((x) => /^occurrence\./.test(x.event)));
  assert.ok((await list('?object_type=user&limit=100')).json.items.every((x) => /^(user|profile)\./.test(x.event)));

  const dima = (await list(`?user_id=${dimaId}&limit=100`)).json;
  assert.ok(dima.items.length >= 4 && dima.items.every((x) => x.user && x.user.id === dimaId));
  assert.equal(dima.counts.all, db.filter((r) => +r.actor_id === dimaId).length);
  assert.ok((await list('?q=аренда&limit=100')).json.items.length >= 2);
  assert.ok((await list('?q=195%20000&limit=100')).json.items.every((x) => JSON.stringify(x).includes('195 000')));
  assert.equal((await list('?q=%25_%25')).json.items.length, 0);
  assert.equal((await list(`?from=${TODAY}&to=${TODAY}`)).json.counts.all, db.length);
  assert.equal((await list(`?to=${D.addDays(TODAY, -1)}`)).json.counts.all, 0);

  const seen = []; let cursor = '';
  for (let i = 0; i < 50; i++) {
    const page = (await list(`?limit=4${cursor ? '&cursor=' + cursor : ''}`)).json;
    seen.push(...page.items.map((x) => x.id));
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  assert.deepEqual(seen, ids);
  const auth = (await call('GET', '/api/v1/logs/auth?limit=100')).json;
  assert.ok(auth.items.every((x) => x.kind === 'auth'));
});

test('журнал действий доступен только администратору, 422 и 404', async () => {
  assert.equal((await list('', null)).status, 401);
  assert.equal((await list('', U)).status, 403);
  for (const qs of ['?object_type=hack', '?user_id=unknown', '?user_id=x', '?from=2026-02-30', '?limit=500', '?cursor=@@', '?q=' + 'я'.repeat(101)]) {
    const r = await list(qs);
    assert.equal(r.status, 422, qs);
    assert.ok(r.json.detail);
  }
  const id = (await list('?object_type=payment&limit=100')).json.items.find((x) => x.event === 'payment.updated' && x.source === 'web').id;
  assert.equal((await call('GET', `/api/v1/logs/${id}`, { cookie: U })).status, 403);
  const full = await call('GET', `/api/v1/logs/${id}`);
  assert.equal(full.status, 200);
  assert.deepEqual([full.json.kind, full.json.event, full.json.user_agent, full.json.object.detail], ['action', 'payment.updated', UA, 'ежемесячно · $195000.00']);
  assert.ok(full.json.changes.some((c) => c.field === 'currency'));
  assert.equal((await call('GET', '/api/v1/logs/99999999')).status, 404);
});
