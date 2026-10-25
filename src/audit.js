const config = require('./config');
const D = require('./dates');

const UA_MAX = 300;
const LOGIN_MAX = 64;
const Q_MAX = 100;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 50;
const TYPES = ['all', 'login_ok', 'login_fail', 'logout'];

const clientIp = (req) => {
  const ip = String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
};
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

function parseAuthQuery(query) {
  const err = [];
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  const q = one('q') === undefined ? '' : String(one('q')).trim();
  if (q.length > Q_MAX) err.push(`q: не длиннее ${Q_MAX} символов`);
  const type = one('type') === undefined || one('type') === '' ? 'all' : one('type');
  if (!TYPES.includes(type)) err.push(`type: одно из ${TYPES.join(', ')}`);
  let userId = null, unknown = false;
  const u = one('user_id');
  if (u !== undefined && u !== '') {
    if (u === 'unknown') unknown = true;
    else if (/^\d{1,15}$/.test(u)) userId = +u;
    else err.push('user_id: id пользователя или unknown');
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

const COLS = `l.id, l.at, to_char(l.at AT TIME ZONE $TZ, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_at, l.kind, l.event, l.result, l.reason,
  l.actor_id, l.actor_login, l.actor_name, l.source, host(l.ip) AS ip, l.user_agent, u.role AS actor_role, (l.actor_id IS NOT NULL AND u.id IS NULL) AS actor_gone`;

function createAudit(pool, { envAdminId = 1 } = {}) {
  async function record(entry) {
    try {
      await pool.query(
        `INSERT INTO audit_log (kind, event, result, reason, actor_id, actor_login, actor_name, source, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [entry.kind, entry.event, entry.result || 'ok', entry.reason || null, entry.actorId || null,
          entry.actorLogin ? String(entry.actorLogin).slice(0, LOGIN_MAX) : null, entry.actorName || null,
          entry.source || 'web', entry.ip || null, entry.userAgent || null]
      );
    } catch (e) {
      console.error('[billpay] журнал: запись не сохранена:', e.message);
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

  const item = (r, full = false) => {
    const user = r.actor_id ? { id: r.actor_id, login: r.actor_login, name: r.actor_name, role: r.actor_id === envAdminId ? 'admin' : r.actor_role, from_env: r.actor_id === envAdminId } : null;
    const out = {
      id: r.id, kind: r.kind, at: r.at, local_at: r.local_at, event: r.event, result: r.result, reason: r.reason,
      login: r.actor_login, user, user_deleted: !!r.actor_gone || (!r.actor_id && r.actor_name !== null),
      source: r.source, ip: r.ip, device: device(r.user_agent)
    };
    if (full) out.user_agent = r.user_agent;
    return out;
  };

  function where(f, params) {
    const w = [`l.kind = 'auth'`];
    const p = (v) => { params.push(v); return '$' + params.length; };
    if (f.q) {
      const like = '%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      const x = p(like);
      w.push(`(l.actor_login ILIKE ${x} OR l.actor_name ILIKE ${x} OR host(l.ip) ILIKE ${x} OR l.user_agent ILIKE ${x})`);
    }
    if (f.unknown) w.push('l.actor_id IS NULL AND l.actor_name IS NULL');
    if (f.userId !== null) w.push(`l.actor_id = ${p(f.userId)}`);
    if (f.from) w.push(`l.at >= (${p(f.from)}::date)::timestamp AT TIME ZONE ${p(config.timezone)}`);
    if (f.to) w.push(`l.at < ((${p(f.to)}::date) + 1)::timestamp AT TIME ZONE ${p(config.timezone)}`);
    return w;
  }
  const TYPE_SQL = { all: 'true', login_ok: `l.event = 'login' AND l.result = 'ok'`, login_fail: `l.result = 'fail'`, logout: `l.event = 'logout'` };

  async function listAuth(f) {
    const params = [];
    const w = where(f, params);
    const { rows: [c] } = await pool.query(
      `SELECT count(*)::int AS all, count(*) FILTER (WHERE ${TYPE_SQL.login_ok})::int AS login_ok,
              count(*) FILTER (WHERE ${TYPE_SQL.login_fail})::int AS login_fail, count(*) FILTER (WHERE ${TYPE_SQL.logout})::int AS logout
         FROM audit_log l WHERE ${w.join(' AND ')}`, params);
    const lp = [...params];
    const lw = [...w, TYPE_SQL[f.type]];
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

  return { record, auth, listAuth, get };
}

async function purge(db, days = config.logRetentionDays) {
  const { rowCount } = await db.query('DELETE FROM audit_log WHERE at < now() - make_interval(days => $1)', [days]);
  return rowCount;
}

module.exports = { createAudit, parseAuthQuery, purge, device, clientIp, userAgent, encodeCursor, decodeCursor };
