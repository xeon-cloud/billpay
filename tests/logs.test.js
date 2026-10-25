const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.TRUST_PROXY = '1';
process.env.LOG_RETENTION_DAYS = '';

const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp } = require('../src/app');
const { purgeLogs } = require('../src/bot');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_logs_${process.pid}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
let admin, pool, servers = [], base, limited, A, U, dimaId;

async function start(opts) {
  const app = await createApp({ pool, ...opts });
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  servers.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}

before(async () => {
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool({ connectionString: url, schema });
  base = await start({ loginRateMax: 1000 });
  limited = await start({ loginRateMax: 2 });
});
after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function call(method, path, { body, cookie, ua = UA, ip, b = base, auth } = {}) {
  const headers = { 'User-Agent': ua };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['X-Forwarded-For'] = ip;
  if (auth) headers.Authorization = auth;
  const res = await fetch(b + path, { method, redirect: 'manual', headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const rows = async () => (await pool.query(`SELECT * FROM audit_log WHERE kind = 'auth' ORDER BY id`)).rows;
const last = async () => (await pool.query(`SELECT *, host(ip) AS ip_text FROM audit_log WHERE kind = 'auth' ORDER BY id DESC LIMIT 1`)).rows[0];
async function login(l, p, opts = {}) {
  const r = await call('POST', '/api/v1/auth/login', { body: { login: l, password: p }, ...opts });
  return { ...r, cookie: r.headers.get('set-cookie') ? r.headers.get('set-cookie').split(';')[0] : null };
}
const logs = (qs = '', cookie = A) => call('GET', '/api/v1/logs/auth' + qs, { cookie });

test('успешный вход пишется в журнал: IP с учётом TRUST_PROXY, user agent, источник', async () => {
  const r = await login('admin', 'test-admin-pass', { ip: '203.0.113.24' });
  assert.equal(r.status, 200);
  A = r.cookie;
  const e = await last();
  assert.deepEqual([e.kind, e.event, e.result, e.reason, +e.actor_id, e.actor_login, e.ip_text, e.user_agent, e.source], ['auth', 'login', 'ok', null, 1, 'admin', '203.0.113.24', UA, 'web']);
  const created = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'dima', name: 'Дмитрий Орлов', password: 'dima-pass-1' } });
  assert.equal(created.status, 201);
  dimaId = created.json.id;
  const u = await login('dima', 'dima-pass-1', { ua: IPH, ip: '192.0.2.17' });
  assert.equal(u.status, 200);
  U = u.cookie;
  const d = await last();
  assert.deepEqual([d.event, d.result, +d.actor_id, d.actor_name, d.ip_text], ['login', 'ok', dimaId, 'Дмитрий Орлов', '192.0.2.17']);
});

test('неудачный вход: причина в журнале, а ответ клиенту одинаковый', async () => {
  const wrong = await login('Dima', 'nope-nope', { ip: '192.0.2.17' });
  const unknown = await login('root', 'nope-nope', { ip: '198.51.100.77', ua: 'curl/8.7.1' });
  const empty = await login('admin', '', { ip: '198.51.100.77' });
  assert.deepEqual([wrong.status, unknown.status, empty.status], [401, 401, 401]);
  assert.deepEqual(wrong.json, unknown.json);
  assert.deepEqual(wrong.json, { detail: 'Неверный логин или пароль' });
  const all = await rows();
  const [w, u, e] = all.slice(-3);
  assert.deepEqual([w.result, w.reason, +w.actor_id, w.actor_login], ['fail', 'wrong_password', dimaId, 'dima']);
  assert.deepEqual([u.result, u.reason, u.actor_id, u.actor_login, u.actor_name], ['fail', 'unknown_login', null, 'root', null]);
  assert.deepEqual([e.reason, +e.actor_id], ['wrong_password', 1]);
});

test('длинный user agent обрезается до 300 символов, логин попытки — до 64', async () => {
  await login('x'.repeat(200), 'whatever', { ua: 'A'.repeat(1000) });
  const e = await last();
  assert.equal(e.user_agent.length, 300);
  assert.equal(e.actor_login.length, 64);
});

test('429: превышение лимита попыток пишется один раз за окно', async () => {
  const before = (await rows()).length;
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await login('admin', 'bad-' + i, { b: limited, ip: '198.51.100.9' })).status);
  assert.deepEqual(codes, [401, 401, 429, 429, 429]);
  const added = (await rows()).slice(before);
  assert.deepEqual(added.map((r) => r.reason), ['wrong_password', 'wrong_password', 'rate_limited']);
  assert.equal(+added[2].actor_id, 1);
  const r = await call('POST', '/api/v1/auth/login', { b: limited, ip: '198.51.100.9', body: { login: 'ghost', password: 'x' } });
  assert.equal(r.status, 429);
  assert.equal((await rows()).length, before + 3);
});

test('выход пишется только при активной сессии', async () => {
  const s = await login('dima', 'dima-pass-1', { ip: '192.0.2.17' });
  const n = (await rows()).length;
  assert.equal((await call('POST', '/api/v1/auth/logout', { cookie: s.cookie, ip: '192.0.2.17' })).status, 204);
  const e = await last();
  assert.deepEqual([e.event, e.result, +e.actor_id], ['logout', 'ok', dimaId]);
  assert.equal((await call('POST', '/api/v1/auth/logout')).status, 204);
  assert.equal((await rows()).length, n + 1);
});

test('вход по Bearer-токену отмечается источником api', async () => {
  const r = await login('admin', 'test-admin-pass');
  const n = (await rows()).length;
  assert.equal((await call('POST', '/api/v1/auth/logout', { auth: 'Bearer ' + r.json.access_token })).status, 204);
  const e = await last();
  assert.equal((await rows()).length, n + 1);
  assert.deepEqual([e.event, e.source], ['logout', 'api']);
});

test('в журнале нет паролей, хешей, токенов и cookie', async () => {
  const r = await login('admin', 'test-admin-pass');
  const dump = JSON.stringify(await rows());
  const { rows: [h] } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [dimaId]);
  for (const secret of ['test-admin-pass', 'dima-pass-1', 'nope-nope', 'bad-0', h.password_hash, r.json.access_token, A.split('=')[1], config.sessionSecret]) {
    assert.ok(!dump.includes(secret), 'утечка: ' + secret.slice(0, 6));
  }
  const api = JSON.stringify((await logs('?limit=100')).json);
  for (const secret of ['test-admin-pass', 'dima-pass-1', h.password_hash, r.json.access_token]) assert.ok(!api.includes(secret));
});

test('доступ только администратору: API 401/403, страница /app/logs', async () => {
  assert.equal((await logs('', null)).status, 401);
  assert.equal((await logs('', U)).status, 403);
  assert.equal((await call('GET', '/api/v1/logs/1', { cookie: U })).status, 403);
  assert.equal((await call('GET', '/api/v1/logs/1')).status, 401);
  assert.equal((await logs()).status, 200);
  const page = await call('GET', '/app/logs', { cookie: U });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/app');
  const anon = await call('GET', '/app/logs');
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /^\/login\?next=/);
  const ok = await call('GET', '/app/logs', { cookie: A });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /data-page="logs"/);
  assert.match(ok.text, /"logRetentionDays":180/);
});

test('список: сначала новые, счётчики, фильтры type / user_id / unknown / q / даты', async () => {
  const all = (await logs('?limit=100')).json;
  const ids = all.items.map((x) => x.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  const db = await rows();
  assert.equal(all.counts.all, db.length);
  assert.equal(all.counts.login_ok, db.filter((r) => r.event === 'login' && r.result === 'ok').length);
  assert.equal(all.counts.login_fail, db.filter((r) => r.result === 'fail').length);
  assert.equal(all.counts.logout, db.filter((r) => r.event === 'logout').length);
  assert.equal(all.next_cursor, null);
  const item = all.items.find((x) => x.login === 'root');
  assert.deepEqual([item.kind, item.event, item.result, item.reason, item.user, item.ip, item.device, item.user_deleted], ['auth', 'login', 'fail', 'unknown_login', null, '198.51.100.77', 'curl 8.7', false]);
  assert.equal(item.user_agent, undefined);
  assert.match(item.local_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(item.local_at.slice(0, 10), D.today());

  const fail = (await logs('?type=login_fail&limit=100')).json;
  assert.ok(fail.items.length && fail.items.every((x) => x.result === 'fail'));
  assert.deepEqual(fail.counts, all.counts);
  const out = (await logs('?type=logout')).json;
  assert.ok(out.items.every((x) => x.event === 'logout'));
  const okIn = (await logs('?type=login_ok&limit=100')).json;
  assert.ok(okIn.items.every((x) => x.event === 'login' && x.result === 'ok'));

  const dima = (await logs(`?user_id=${dimaId}&limit=100`)).json;
  assert.ok(dima.items.length >= 3 && dima.items.every((x) => x.user && x.user.id === dimaId && x.user.role === 'user'));
  assert.equal(dima.counts.all, db.filter((r) => +r.actor_id === dimaId).length);
  const unknown = (await logs('?user_id=unknown&limit=100')).json;
  assert.ok(unknown.items.length >= 2 && unknown.items.every((x) => x.user === null));
  assert.ok(unknown.items.some((x) => x.login === 'root'));

  assert.deepEqual((await logs('?q=192.0.2.17&limit=100')).json.items.map((x) => x.ip).filter((v, i, a) => a.indexOf(v) === i), ['192.0.2.17']);
  assert.ok((await logs('?q=IPHONE&limit=100')).json.items.every((x) => x.device === 'Safari · iPhone'));
  assert.equal((await logs('?q=%25%25%25')).json.items.length, 0);
  assert.equal((await logs(`?from=${D.today()}&to=${D.today()}`)).json.counts.all, db.length);
  assert.equal((await logs(`?to=${D.addDays(D.today(), -1)}`)).json.counts.all, 0);
  assert.equal((await logs(`?from=${D.addDays(D.today(), 1)}`)).json.counts.all, 0);
});

test('пагинация курсором без пропусков и повторов', async () => {
  const all = (await logs('?limit=100')).json.items.map((x) => x.id);
  const seen = [];
  let cursor = '';
  for (let i = 0; i < 50; i++) {
    const page = (await logs(`?limit=3${cursor ? '&cursor=' + cursor : ''}`)).json;
    assert.ok(page.items.length <= 3);
    seen.push(...page.items.map((x) => x.id));
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  assert.deepEqual(seen, all);
});

test('422 на неверные параметры', async () => {
  for (const qs of ['?type=hack', '?user_id=abc', '?from=2026-13-01', '?to=yesterday', '?from=2026-10-10&to=2026-10-01', '?limit=0', '?limit=101', '?limit=x', '?cursor=zzz', '?q=' + 'a'.repeat(101)]) {
    const r = await logs(qs);
    assert.equal(r.status, 422, qs);
    assert.ok(r.json.detail);
  }
});

test('GET /logs/{id}: полная запись с user agent, 404 для несуществующей', async () => {
  const id = (await logs('?q=root')).json.items[0].id;
  const r = await call('GET', '/api/v1/logs/' + id, { cookie: A });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.id, r.json.reason, r.json.user_agent, r.json.device], [id, 'unknown_login', 'curl/8.7.1', 'curl 8.7']);
  assert.equal((await call('GET', '/api/v1/logs/999999', { cookie: A })).status, 404);
  assert.equal((await call('GET', '/api/v1/logs/abc', { cookie: A })).status, 404);
});

test('удалённый пользователь остаётся в журнале по снимку логина', async () => {
  const c = await call('POST', '/api/v1/users', { cookie: A, body: { login: 'temp', name: 'Временный', password: 'temp-pass-1' } });
  await login('temp', 'temp-pass-1');
  assert.equal((await call('DELETE', '/api/v1/users/' + c.json.id, { cookie: A })).status, 204);
  const e = (await logs('?q=temp')).json.items[0];
  assert.deepEqual([e.login, e.user, e.user_deleted], ['temp', null, true]);
  assert.ok(!(await logs('?user_id=unknown&limit=100')).json.items.some((x) => x.login === 'temp'));
});

test('очистка: записи старше LOG_RETENTION_DAYS удаляются, свежие остаются', async () => {
  assert.equal(config.logRetentionDays, 180);
  await pool.query(`INSERT INTO audit_log (kind, event, result, at) VALUES ('auth', 'logout', 'ok', now() - interval '200 days'), ('auth', 'logout', 'ok', now() - interval '179 days')`);
  const n = (await rows()).length;
  assert.equal(await purgeLogs(pool), 1);
  assert.equal((await rows()).length, n - 1);
  assert.equal(await purgeLogs(pool, 30), 1);
  assert.equal(await purgeLogs(pool), 0);
});
