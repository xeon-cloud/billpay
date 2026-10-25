const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.TRUST_PROXY = '1';

const config = require('../src/config');
const D = require('../src/dates');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { createApp } = require('../src/app');
const { safeName, sniff, checkUrl } = require('../src/receipts');

const url = process.env.TEST_DATABASE_URL || config.databaseUrl;
const schema = `billpay_receipts_${process.pid}`;
const TODAY = D.today(), MONTH = TODAY.slice(0, 7);
const MB10 = 10 * 1024 * 1024;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(2048), Buffer.from('\n%%EOF\n')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(512)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300 * 1024)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), crypto.randomBytes(256)]);
let admin, pool, server, base, A, U, token, occId, occ2Id;

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

async function call(method, path, { body, raw, type, filename, cookie = A, auth, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (cookie) headers.Cookie = cookie;
  if (auth) headers.Authorization = auth;
  let payload;
  if (raw !== undefined) { payload = raw; if (type) headers['Content-Type'] = type; if (filename !== undefined) headers['X-Filename'] = filename; }
  else if (body !== undefined) { payload = typeof body === 'string' ? body : JSON.stringify(body); headers['Content-Type'] = type || 'application/json'; }
  const res = await fetch(base + path, { method, redirect: 'manual', headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: res.status, json, buf, text: buf.toString('utf8'), headers: res.headers };
}
const R = (id = occId) => `/api/v1/payment-occurrences/${id}/receipt`;
const actions = async () => (await pool.query(`SELECT * FROM audit_log WHERE kind = 'action' ORDER BY id`)).rows;
const receiptEvents = async () => (await actions()).filter((e) => e.event.startsWith('occurrence.receipt_'));
const pay = (id, isPaid, cookie = A) => call('PATCH', `/api/v1/payment-occurrences/${id}`, { cookie, body: isPaid ? { is_paid: true, paid_at: TODAY } : { is_paid: false } });

async function signIn(login, password) {
  const r = await call('POST', '/api/v1/auth/login', { body: { login, password }, cookie: null });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get('set-cookie').split(';')[0], token: r.json.access_token };
}

test('подготовка: платежи, пользователь, одна оплата отмечена', async () => {
  const s = await signIn('admin', 'test-admin-pass');
  A = s.cookie; token = s.token;
  const a = await call('POST', '/api/v1/recurring-payments', { body: { name: 'Аренда офиса', amount: 195000, currency: 'RUB', next_date: `${MONTH}-05` } });
  const b = await call('POST', '/api/v1/recurring-payments', { body: { name: 'Хостинг', amount: 20, currency: 'EUR', next_date: `${MONTH}-06` } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await call('POST', '/api/v1/users', { body: { login: 'dima', name: 'Дмитрий Орлов', password: 'dima-pass-1' } })).status, 201);
  U = (await signIn('dima', 'dima-pass-1')).cookie;
  const list = (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}`)).json;
  occId = list.find((o) => o.recurring_payment_id === a.json.id).id;
  occ2Id = list.find((o) => o.recurring_payment_id === b.json.id).id;
  assert.ok(list.every((o) => o.receipt === null));
  assert.equal((await pay(occId, true)).status, 200);
});

test('без входа — 401 на всех маршрутах чека', async () => {
  for (const [m, p, o] of [['PUT', R(), { raw: PDF, type: 'application/pdf' }], ['GET', R(), {}], ['GET', R() + '/file', {}], ['DELETE', R(), {}]]) {
    const r = await call(m, p, { ...o, cookie: null });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  assert.equal((await call('PUT', R(), { raw: Buffer.alloc(MB10 + 1, 1), type: 'application/pdf', cookie: null })).status, 401, 'большое тело без входа отклоняется до чтения');
});

test('несуществующий период — 404', async () => {
  for (const id of [999999, 'abc']) {
    assert.equal((await call('PUT', R(id), { raw: PDF, type: 'application/pdf' })).status, 404);
    assert.equal((await call('GET', R(id))).status, 404);
    assert.equal((await call('GET', R(id) + '/file')).status, 404);
    assert.equal((await call('DELETE', R(id))).status, 404);
  }
  const g = await call('GET', R());
  assert.deepEqual([g.status, g.json.detail], [404, 'Чек не прикреплён']);
  assert.equal((await call('GET', R() + '/file')).status, 404);
  assert.equal((await call('DELETE', R())).status, 404);
});

test('неоплаченный период — 409, ничего не сохраняется', async () => {
  const r = await call('PUT', R(occ2Id), { raw: PDF, type: 'application/pdf', filename: 'x.pdf' });
  assert.deepEqual([r.status, r.json.detail], [409, 'Сначала отметьте оплату: чек прикрепляется к оплаченному периоду']);
  assert.equal((await call('PUT', R(occ2Id), { body: { url: 'https://lk.example.com/1' } })).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM occurrence_receipts')).rows[0].n, 0);
  assert.equal((await receiptEvents()).length, 0);
});

test('прикрепить PDF — 201, безопасное имя, журнал receipt_added', async () => {
  const r = await call('PUT', R(), { raw: PDF, type: 'application/pdf', filename: encodeURIComponent('../../etc/Счёт <аренда>\u0007.exe') });
  assert.equal(r.status, 201);
  assert.deepEqual({ ...r.json, added_at: undefined }, { kind: 'file', name: 'Счёт аренда.pdf', mime: 'application/pdf', size: PDF.length, added_at: undefined, added_by: { login: 'admin', name: config.admin.name } });
  assert.ok(!Number.isNaN(Date.parse(r.json.added_at)));
  const m = await call('GET', R());
  assert.deepEqual([m.status, m.json.name, m.headers.get('cache-control')], [200, 'Счёт аренда.pdf', 'no-store']);
  const [e] = await receiptEvents();
  assert.deepEqual([e.event, e.object_type, +e.object_id, e.actor_login, e.source], ['occurrence.receipt_added', 'occurrence', occId, 'admin', 'web']);
  assert.match(e.object_label, /^Аренда офиса\n/);
  assert.deepEqual(e.changes, [{ field: 'receipt', before: null, after: 'Файл: Счёт аренда.pdf (2 КБ)' }]);
  const row = (await pool.query('SELECT sha256, size, data FROM occurrence_receipts WHERE occurrence_id = $1', [occId])).rows[0];
  assert.equal(row.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  assert.ok(row.data.equals(PDF));
});

test('скачивание: только после входа, тип по содержимому, безопасные заголовки', async () => {
  const f = await call('GET', R() + '/file');
  assert.equal(f.status, 200);
  assert.ok(f.buf.equals(PDF));
  assert.equal(f.headers.get('content-type'), 'application/pdf');
  assert.equal(f.headers.get('content-length'), String(PDF.length));
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(f.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(f.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal(f.headers.get('content-disposition'), `inline; filename="receipt.pdf"; filename*=UTF-8''${encodeURIComponent('Счёт аренда.pdf')}`);
  const b = await call('GET', R() + '/file', { cookie: null, auth: 'Bearer ' + token });
  assert.equal(b.status, 200, 'Bearer-токен тоже подходит');
  assert.equal((await call('GET', R() + '/file', { cookie: 'billpay_session=forged' })).status, 401);
  assert.equal((await call('GET', '/assets/receipts/' + occId)).status, 404, 'публичного пути нет');
});

test('замена пользователем — 200, PNG с CSP sandbox, журнал receipt_replaced', async () => {
  const r = await call('PUT', R(), { cookie: U, raw: PNG, type: 'image/png', filename: encodeURIComponent('скрин.PNG') });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.kind, r.json.name, r.json.mime, r.json.added_by.login], ['file', 'скрин.png', 'image/png', 'dima']);
  const f = await call('GET', R() + '/file', { cookie: U });
  assert.equal(f.headers.get('content-type'), 'image/png');
  assert.match(f.headers.get('content-security-policy'), /sandbox/);
  assert.ok(f.buf.equals(PNG));
  const e = (await receiptEvents()).at(-1);
  assert.deepEqual([e.event, e.actor_login], ['occurrence.receipt_replaced', 'dima']);
  assert.deepEqual(e.changes, [{ field: 'receipt', before: 'Файл: Счёт аренда.pdf (2 КБ)', after: 'Файл: скрин.png (1 КБ)' }]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM occurrence_receipts')).rows[0].n, 1, 'одно вложение на период');
});

test('сигнатура: чужое содержимое под видом PDF/PNG/JPG — 415, неизвестный Content-Type — 415', async () => {
  const before = await call('GET', R());
  for (const [raw, type] of [[GIF, 'image/png'], [Buffer.from('<html><script>alert(1)</script>'), 'application/pdf'], [Buffer.from('MZ\x90\x00'), 'image/jpeg'], [PNG, 'image/jpeg-x']]) {
    const r = await call('PUT', R(), { raw, type, filename: 'renamed.png' });
    assert.equal(r.status, 415, type);
  }
  assert.equal((await call('PUT', R(), { raw: PDF, type: 'text/plain' })).status, 415);
  assert.equal((await call('PUT', R(), { raw: PDF, type: 'multipart/form-data; boundary=x' })).status, 415);
  const after = await call('GET', R());
  assert.deepEqual(after.json, before.json, 'вложение не изменилось');
  const j = await call('PUT', R(), { raw: PNG, type: 'application/pdf', filename: 'a.pdf' });
  assert.deepEqual([j.status, j.json.mime, j.json.name], [200, 'image/png', 'a.png'], 'тип и расширение — по содержимому');
});

test('лимит 10 МБ: ровно 10 МБ проходит, больше — 413', async () => {
  const big = Buffer.alloc(MB10, 0x20); PDF.copy(big, 0, 0, 9);
  const ok = await call('PUT', R(), { raw: big, type: 'application/pdf', filename: 'big.pdf' });
  assert.deepEqual([ok.status, ok.json.size], [200, MB10]);
  const tooBig = Buffer.concat([big, Buffer.from('x')]);
  const r = await call('PUT', R(), { raw: tooBig, type: 'application/pdf', filename: 'big2.pdf' });
  assert.deepEqual([r.status, r.json.detail], [413, 'Файл больше 10 МБ']);
  assert.equal((await call('GET', R())).json.name, 'big.pdf');
  const j = await call('PUT', R(), { body: JSON.stringify({ url: 'https://a.example.com/' + 'x'.repeat(200 * 1024) }) });
  assert.equal(j.status, 413, 'JSON больше лимита — 413, а не 500');
});

test('файл: пустое тело и битый X-Filename — 422', async () => {
  assert.equal((await call('PUT', R(), { raw: Buffer.alloc(0), type: 'application/pdf' })).status, 422);
  assert.equal((await call('PUT', R(), { raw: PDF, type: 'application/pdf', filename: '%E0%A4%A' })).status, 422);
  const n = await call('PUT', R(), { raw: JPG, type: 'image/jpeg' });
  assert.deepEqual([n.status, n.json.name], [200, 'чек.jpg'], 'без имени — «чек»');
});

test('ссылка: только http/https, без логина, до 2000 символов — иначе 422', async () => {
  const bad = [{}, { url: '' }, { url: 'javascript:alert(1)' }, { url: 'data:text/html,hi' }, { url: 'ftp://files.example.com/a' }, { url: 'file:///etc/passwd' },
    { url: 'lk.example.com/pay' }, { url: 'https://user:pass@lk.example.com/' }, { url: 'https://lk.example.com/' + 'a'.repeat(2000) }, { url: 42 }, { url: 'https://lk.example.com/', extra: 1 }];
  for (const body of bad) assert.equal((await call('PUT', R(), { body })).status, 422, JSON.stringify(body).slice(0, 60));
  const r = await call('PUT', R(), { body: { url: '  https://www.LK.example.com/payments/2026-10?id=7  ' } });
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.json, added_at: undefined }, { kind: 'link', url: 'https://www.lk.example.com/payments/2026-10?id=7', host: 'lk.example.com', added_at: undefined, added_by: { login: 'admin', name: config.admin.name } });
  const f = await call('GET', R() + '/file');
  assert.deepEqual([f.status, f.json.detail], [404, 'Прикреплена ссылка, файла нет']);
  assert.equal((await receiptEvents()).at(-1).changes[0].after, 'Ссылка: lk.example.com');
});

test('списки, период и итоги отдают только метаданные, без байтов', async () => {
  await call('PUT', R(), { raw: JPG, type: 'image/jpeg', filename: 'IMG_2041.jpg' });
  const checks = [
    (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}`)).json,
    (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}&include=meta`)).json.items,
    (await call('GET', `/api/v1/payments/summary?date=${TODAY}&include=items`)).json.items,
    [(await call('GET', `/api/v1/payment-occurrences/${occId}`, { cookie: U })).json]
  ];
  for (const list of checks) {
    const o = list.find((x) => x.id === occId);
    assert.deepEqual(Object.keys(o.receipt).sort(), ['added_at', 'added_by', 'kind', 'mime', 'name', 'size']);
    assert.equal(o.receipt.size, JPG.length);
    if (list.length > 1) assert.equal(list.find((x) => x.id === occ2Id).receipt, null);
    assert.ok(JSON.stringify(list).length < 20000, 'нет содержимого файла в ответе');
  }
});

test('снятие отметки сохраняет чек; прикрепить к неоплаченному — 409; повторная отметка показывает тот же чек', async () => {
  const n = (await receiptEvents()).length;
  const un = await pay(occId, false, U);
  assert.equal(un.status, 200);
  assert.equal(un.json.is_paid, false);
  assert.equal(un.json.receipt.name, 'IMG_2041.jpg');
  assert.equal((await receiptEvents()).length, n, 'снятие отметки не пишет удаление чека');
  assert.equal((await actions()).at(-1).event, 'occurrence.unpaid');
  assert.equal((await call('GET', R())).json.name, 'IMG_2041.jpg');
  assert.equal((await call('GET', R() + '/file')).status, 200);
  assert.equal((await call('PUT', R(), { raw: PDF, type: 'application/pdf' })).status, 409);
  assert.equal((await call('PUT', R(), { body: { url: 'https://lk.example.com/x' } })).status, 409);
  const re = await pay(occId, true);
  assert.equal(re.json.receipt.name, 'IMG_2041.jpg');
  const list = (await call('GET', `/api/v1/payment-occurrences?month=${MONTH}&status=paid`)).json;
  assert.equal(list.find((x) => x.id === occId).receipt.kind, 'file');
});

test('удаление — 204, журнал receipt_removed, повторное — 404', async () => {
  const d = await call('DELETE', R(), { cookie: U });
  assert.equal(d.status, 204);
  assert.equal((await call('DELETE', R(), { cookie: U })).status, 404);
  assert.equal((await call('GET', R())).status, 404);
  assert.equal((await call('GET', `/api/v1/payment-occurrences/${occId}`)).json.receipt, null);
  const e = (await receiptEvents()).at(-1);
  assert.deepEqual([e.event, e.actor_login], ['occurrence.receipt_removed', 'dima']);
  assert.deepEqual(e.changes, [{ field: 'receipt', before: 'Файл: IMG_2041.jpg (300 КБ)', after: null }]);
  assert.equal((await call('PUT', R(), { body: { url: 'https://lk.example.com/again' } })).status, 201, 'после удаления — снова 201');
});

test('журнал «Действия»: события чека видны админу в разделе «Оплаты», пользователю — 403', async () => {
  const r = await call('GET', '/api/v1/logs/actions?object_type=occurrence&limit=100');
  assert.equal(r.status, 200);
  const ev = r.json.items.map((i) => i.event);
  for (const k of ['occurrence.receipt_added', 'occurrence.receipt_replaced', 'occurrence.receipt_removed']) assert.ok(ev.includes(k), k);
  const one = r.json.items.find((i) => i.event === 'occurrence.receipt_removed');
  const full = await call('GET', '/api/v1/logs/' + one.id);
  assert.equal(full.status, 200);
  assert.equal(full.json.changes[0].field, 'receipt');
  assert.equal((await call('GET', '/api/v1/logs/actions', { cookie: U })).status, 403);
});

test('удаление периода каскадно удаляет вложение', async () => {
  await pool.query('DELETE FROM payment_occurrences WHERE id = $1', [occId]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM occurrence_receipts')).rows[0].n, 0);
});

test('хелперы: safeName, sniff, checkUrl', () => {
  assert.equal(safeName('', 'pdf'), 'чек.pdf');
  assert.equal(safeName(encodeURIComponent('C:\\Users\\a\\..\\чек.pdf'), 'pdf'), 'чек.pdf');
  assert.equal(safeName(encodeURIComponent('...hidden'), 'png'), 'hidden.png');
  assert.equal(safeName(encodeURIComponent('a"b<c>|d?.jpeg'), 'jpg'), 'abcd.jpg');
  assert.equal(safeName(encodeURIComponent('x'.repeat(300) + '.pdf'), 'pdf').length, 104);
  assert.equal(safeName('%ZZ', 'pdf'), null);
  assert.equal(sniff(PDF).mime, 'application/pdf');
  assert.equal(sniff(JPG).mime, 'image/jpeg');
  assert.equal(sniff(PNG).mime, 'image/png');
  assert.equal(sniff(GIF), null);
  assert.equal(sniff(Buffer.from('%PD')), null);
  assert.equal(checkUrl('https://a.example.com'), null);
  assert.ok(checkUrl('javascript:x'));
});
