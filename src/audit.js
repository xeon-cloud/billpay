const config = require('./config');
const D = require('./dates');
const { money, dmy } = require('./telegram');

const UA_MAX = 300;
const LOGIN_MAX = 64;
const REF_MAX = 200;
const Q_MAX = 100;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 50;
const AUTH_TYPES = ['all', 'login_ok', 'login_fail', 'logout'];
const OBJECT_TYPES = ['all', 'payment', 'occurrence', 'user'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const clientIp = (req) => {
  const ip = String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
};
const clean = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const userAgent = (req) => {
  const ua = req.get('user-agent');
  return ua ? String(ua).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, UA_MAX) || null : null;
};
const attemptLogin = (v) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, LOGIN_MAX) : '');

function device(ua) {
  if (!ua) return null;
  const m = (re) => { const x = re.exec(ua); return x ? x[1] : null; };
  let browser = null;
  if (m(/YaBrowser\/(\d+)/)) browser = 'Яндекс Браузер ' + m(/YaBrowser\/(\d+)/);
  else if (m(/Edg[A-Z]?\/(\d+)/)) browser = 'Edge ' + m(/Edg[A-Z]?\/(\d+)/);
  else if (m(/OPR\/(\d+)/)) browser = 'Opera ' + m(/OPR\/(\d+)/);
  else if (m(/(?:Firefox|FxiOS)\/(\d+)/)) browser = 'Firefox ' + m(/(?:Firefox|FxiOS)\/(\d+)/);
  else if (m(/(?:Chrome|CriOS)\/(\d+)/)) browser = 'Chrome ' + m(/(?:Chrome|CriOS)\/(\d+)/);
  else if (/Safari\//.test(ua) && /Version\/\d+/.test(ua)) browser = 'Safari';
  else if (m(/^curl\/(\d+\.\d+)/)) browser = 'curl ' + m(/^curl\/(\d+\.\d+)/);
  let os = null;
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (!browser && !os) return ua.split(/[\s;(]/)[0].slice(0, 40) || null;
  return [browser, os].filter(Boolean).join(' · ');
}

const encodeCursor = (id) => Buffer.from('a:' + id).toString('base64url');
function decodeCursor(c) {
  if (c === undefined || c === '') return null;
  if (typeof c !== 'string' || c.length > 40) return NaN;
  const m = /^a:(\d{1,18})$/.exec(Buffer.from(c, 'base64url').toString());
  return m ? +m[1] : NaN;
}

function parseQuery(query, kind) {
  const err = [];
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  const q = one('q') === undefined ? '' : String(one('q')).trim();
  if (q.length > Q_MAX) err.push(`q: не длиннее ${Q_MAX} символов`);
  const key = kind === 'auth' ? 'type' : 'object_type';
  const types = kind === 'auth' ? AUTH_TYPES : OBJECT_TYPES;
  const type = one(key) === undefined || one(key) === '' ? 'all' : one(key);
  if (!types.includes(type)) err.push(`${key}: одно из ${types.join(', ')}`);
  let userId = null, unknown = false;
  const u = one('user_id');
  if (u !== undefined && u !== '') {
    if (u === 'unknown' && kind === 'auth') unknown = true;
    else if (/^\d{1,15}$/.test(u)) userId = +u;
    else err.push(kind === 'auth' ? 'user_id: id пользователя или unknown' : 'user_id: id пользователя');
  }
  const from = one('from') || null, to = one('to') || null;
  if (from && !D.isDate(from)) err.push('from: дата YYYY-MM-DD');
  if (to && !D.isDate(to)) err.push('to: дата YYYY-MM-DD');
  if (from && to && D.isDate(from) && D.isDate(to) && from > to) err.push('from не может быть позже to');
  let limit = LIMIT_DEFAULT;
  const l = one('limit');
  if (l !== undefined && l !== '') {
    if (/^\d{1,3}$/.test(l) && +l >= 1 && +l <= LIMIT_MAX) limit = +l;
    else err.push(`limit: от 1 до ${LIMIT_MAX}`);
  }
  const cursor = decodeCursor(one('cursor'));
  if (Number.isNaN(cursor)) err.push('cursor: неверное значение');
  return { err, q, type, userId, unknown, from, to, limit, cursor };
}
const parseAuthQuery = (query) => parseQuery(query, 'auth');
const parseActionsQuery = (query) => parseQuery(query, 'action');

const label = (main, sub) => { const m = String(main).replace(/[\r\n]+/g, ' '); return sub ? `${m}\n${String(sub).replace(/[\r\n]+/g, ' ')}` : m; };
const split = (s) => {
  if (s == null) return [null, null];
  const i = s.indexOf('\n');
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
};
const amountOf = (x) => money(x.amount, x.currency);
const dayOf = (d) => `${d} число`;
const dateOf = (d) => (d ? dmy(String(d).slice(0, 10)) : null);
const monthOf = (m) => `${MONTHS[+String(m).slice(5, 7) - 1]} ${String(m).slice(0, 4)}`;
const ch = (field, before, after) => ({ field, before: before ?? null, after: after ?? null });
const paymentObject = (rp) => ({ objectType: 'payment', objectId: rp.id, objectLabel: label(rp.name, `ежемесячно · ${amountOf(rp)}`) });
const occurrenceObject = (o) => ({ objectType: 'occurrence', objectId: o.id, objectLabel: label(o.name, `${monthOf(o.month)} · ${amountOf(o)}`) });
const userObject = (u, sub) => ({ objectType: 'user', objectId: u.id, objectLabel: label(u.login, sub) });

const events = {
  paymentCreated: (rp, next) => ({
    event: 'payment.created', ...paymentObject(rp),
    changes: [ch('name', null, rp.name), ch('amount', null, amountOf(rp)), ch('day', null, dayOf(rp.day)), ch('next_date', null, dateOf(next))]
  }),
  paymentUpdated(before, after, nextBefore, nextAfter) {
    const c = [];
    if (before.name !== after.name) c.push(ch('name', before.name, after.name));
    if (before.currency !== after.currency) c.push(ch('currency', before.currency, after.currency));
    if (Number(before.amount) !== Number(after.amount) || before.currency !== after.currency) c.push(ch('amount', amountOf(before), amountOf(after)));
    if (before.day !== after.day) c.push(ch('day', dayOf(before.day), dayOf(after.day)));
    if (nextAfter && String(nextBefore || '').slice(0, 10) !== nextAfter) c.push(ch('next_date', dateOf(nextBefore), dateOf(nextAfter)));
    return c.length ? { event: 'payment.updated', ...paymentObject(after), changes: c } : null;
  },
  paymentDeleted: (rp) => ({ event: 'payment.deleted', ...paymentObject(rp), changes: [ch('active', 'активен', 'удалён · история оплат сохранена')] }),
  occurrenceChanged(paidBefore, after) {
    const b = paidBefore ? String(paidBefore).slice(0, 10) : null, a = after.paid_at ? String(after.paid_at).slice(0, 10) : null;
    if (b === a) return null;
    const event = !b ? 'occurrence.paid' : !a ? 'occurrence.unpaid' : 'occurrence.paid_at';
    return { event, ...occurrenceObject(after), changes: [ch('paid_at', dateOf(b), dateOf(a))] };
  },
  userCreated: (u) => ({
    event: 'user.created', ...userObject(u, u.name),
    changes: [ch('login', null, u.login), ch('name', null, u.name), ...(u.email ? [ch('email', null, u.email)] : []), ch('password', null, 'задан')]
  }),
  userUpdated(before, after, passwordChanged) {
    const c = [];
    if (before.name !== after.name) c.push(ch('name', before.name, after.name));
    if ((before.email || null) !== (after.email || null)) c.push(ch('email', before.email, after.email));
    if (passwordChanged) c.push(ch('password', '••••', 'изменён'));
    return c.length ? { event: 'user.updated', ...userObject(after, after.name), changes: c } : null;
  },
  userDeleted: (u) => ({ event: 'user.deleted', ...userObject(u, u.name), changes: [ch('user', `${u.login} · ${u.name}`, null)] }),
  profileEmail: (u, before, after) => ((before || null) === (after || null) ? null : {
    event: 'profile.email', ...userObject(u, 'своя почта'), changes: [ch('email', before, after)]
  })
};

function telegramRef(q) {
  const f = (q && q.from) || {};
  const who = f.username ? '@' + f.username : [f.first_name, f.last_name].filter(Boolean).join(' ') || (f.id ? 'id ' + f.id : 'Telegram');
  const chat = (q && q.message && q.message.chat) || {};
  const where = chat.title || (chat.username ? '@' + chat.username : [chat.first_name, chat.last_name].filter(Boolean).join(' '));
  return label(clean(who, 80), where ? clean(where, 100) : null).slice(0, REF_MAX);
}

const COLS = `l.id, l.at, to_char(l.at AT TIME ZONE $TZ, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_at, l.kind, l.event, l.result, l.reason,
  l.actor_id, l.actor_login, l.actor_name, l.source, l.source_ref, l.object_type, l.object_id, l.object_label, l.changes,
  host(l.ip) AS ip, l.user_agent, u.role AS actor_role, (l.actor_id IS NOT NULL AND u.id IS NULL) AS actor_gone`;

const FILTERS = {
  auth: { login_ok: `l.event = 'login' AND l.result = 'ok'`, login_fail: `l.result = 'fail'`, logout: `l.event = 'logout'` },
  action: { payment: `l.object_type = 'payment'`, occurrence: `l.object_type = 'occurrence'`, user: `l.object_type = 'user'` }
};

function createAudit(pool, { envAdminId = 1 } = {}) {
  async function record(entry, db = null) {
    const c = db || pool;
    try {
      if (db) await db.query('SAVEPOINT audit_entry');
      await c.query(
        `INSERT INTO audit_log (kind, event, result, reason, actor_id, actor_login, actor_name, source, source_ref, object_type, object_id, object_label, changes, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [entry.kind, entry.event, entry.result || 'ok', entry.reason || null, entry.actorId || null,
          entry.actorLogin ? String(entry.actorLogin).slice(0, LOGIN_MAX) : null, entry.actorName || null,
          entry.source || 'web', entry.sourceRef || null, entry.objectType || null, entry.objectId ?? null, entry.objectLabel || null,
          entry.changes ? JSON.stringify(entry.changes) : null, entry.ip || null, entry.userAgent || null]
      );
      if (db) await db.query('RELEASE SAVEPOINT audit_entry');
      return true;
    } catch (e) {
      if (db) await db.query('ROLLBACK TO SAVEPOINT audit_entry').catch(() => {});
      console.error('[billpay] журнал: запись не сохранена:', e.message);
      return false;
    }
  }

  const sourceOf = (req) => (/^Bearer /.test(req.get('authorization') || '') ? 'api' : 'web');

  function auth(req, { event, ok, reason = null, user = null, login = '' }) {
    return record({
      kind: 'auth', event, result: ok ? 'ok' : 'fail', reason: ok ? null : reason,
      actorId: user ? user.id : null, actorLogin: user ? user.login : attemptLogin(login), actorName: user ? user.name : null,
      source: sourceOf(req), ip: clientIp(req), userAgent: userAgent(req)
    });
  }

  const action = (req) => (db, entry) => (entry ? record({
    kind: 'action', actorId: req.user.id, actorLogin: req.user.login, actorName: req.user.name,
    source: sourceOf(req), ip: clientIp(req), userAgent: userAgent(req), ...entry
  }, db) : false);

  const telegram = (q) => (db, entry) => (entry ? record({ kind: 'action', source: 'telegram', sourceRef: telegramRef(q), ...entry }, db) : false);

  const item = (r, full = false) => {
    const user = r.actor_id ? { id: r.actor_id, login: r.actor_login, name: r.actor_name, role: r.actor_id === envAdminId ? 'admin' : r.actor_role, from_env: r.actor_id === envAdminId } : null;
    const out = {
      id: r.id, kind: r.kind, at: r.at, local_at: r.local_at, event: r.event, result: r.result, reason: r.reason,
      login: r.actor_login, user, user_deleted: !!r.actor_gone || (!r.actor_id && r.actor_name !== null),
      source: r.source
    };
    if (r.kind === 'action') {
      const [tgUser, tgChat] = split(r.source_ref);
      const [main, detail] = split(r.object_label);
      out.telegram = r.source === 'telegram' ? { user: tgUser, chat: tgChat } : null;
      out.object = { type: r.object_type, id: r.object_id, label: main, detail };
      out.changes = r.changes || [];
    }
    out.ip = r.ip;
    out.device = device(r.user_agent);
    if (full) out.user_agent = r.user_agent;
    return out;
  };

  function where(kind, f, params) {
    const w = [`l.kind = '${kind}'`];
    const p = (v) => { params.push(v); return '$' + params.length; };
    if (f.q) {
      const x = p('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
      w.push(kind === 'auth'
        ? `(l.actor_login ILIKE ${x} OR l.actor_name ILIKE ${x} OR host(l.ip) ILIKE ${x} OR l.user_agent ILIKE ${x})`
        : `(l.actor_login ILIKE ${x} OR l.actor_name ILIKE ${x} OR l.object_label ILIKE ${x} OR l.source_ref ILIKE ${x} OR l.changes::text ILIKE ${x})`);
    }
    if (f.unknown) w.push('l.actor_id IS NULL AND l.actor_name IS NULL');
    if (f.userId !== null) w.push(`l.actor_id = ${p(f.userId)}`);
    if (f.from) w.push(`l.at >= (${p(f.from)}::date)::timestamp AT TIME ZONE ${p(config.timezone)}`);
    if (f.to) w.push(`l.at < ((${p(f.to)}::date) + 1)::timestamp AT TIME ZONE ${p(config.timezone)}`);
    return w;
  }

  async function list(kind, f) {
    const params = [];
    const w = where(kind, f, params);
    const sets = FILTERS[kind];
    const { rows: [c] } = await pool.query(
      `SELECT count(*)::int AS all, ${Object.entries(sets).map(([k, s]) => `count(*) FILTER (WHERE ${s})::int AS ${k}`).join(', ')}
         FROM audit_log l WHERE ${w.join(' AND ')}`, params);
    const lp = [...params];
    const lw = [...w, f.type === 'all' ? 'true' : sets[f.type]];
    if (f.cursor) { lp.push(f.cursor); lw.push(`l.id < $${lp.length}`); }
    lp.push(config.timezone);
    const tz = '$' + lp.length;
    lp.push(f.limit + 1);
    const { rows } = await pool.query(
      `SELECT ${COLS.replace('$TZ', tz)} FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
        WHERE ${lw.join(' AND ')} ORDER BY l.id DESC LIMIT $${lp.length}`, lp);
    const more = rows.length > f.limit;
    const items = rows.slice(0, f.limit).map((r) => item(r));
    return { items, counts: c, next_cursor: more ? encodeCursor(items[items.length - 1].id) : null };
  }

  async function get(id) {
    const { rows } = await pool.query(`SELECT ${COLS.replace('$TZ', '$2')} FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.id = $1`, [id, config.timezone]);
    return rows[0] ? item(rows[0], true) : null;
  }

  return { record, auth, action, telegram, listAuth: (f) => list('auth', f), listActions: (f) => list('action', f), get };
}

async function purge(db, days = config.logRetentionDays) {
  const { rowCount } = await db.query('DELETE FROM audit_log WHERE at < now() - make_interval(days => $1)', [days]);
  return rowCount;
}

module.exports = { createAudit, parseAuthQuery, parseActionsQuery, events, telegramRef, purge, device, clientIp, userAgent, encodeCursor, decodeCursor };
