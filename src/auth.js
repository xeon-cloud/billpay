const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'billpay_session';
const ENV_ADMIN_ID = 1;
const USER_COLS = 'id, login, name, role, password_hash, is_env_admin, created_at, email';

async function upsertEnvAdmin(pool) {
  const { login, password, name } = config.admin;
  const clash = await pool.query('SELECT id FROM users WHERE lower(login) = $1 AND id <> $2', [login, ENV_ADMIN_ID]);
  if (clash.rowCount) throw new Error(`ADMIN_LOGIN "${login}" уже занят пользователем id=${clash.rows[0].id}. Выберите другой логин.`);
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [ENV_ADMIN_ID]);
  const hash = rows.length && (await bcrypt.compare(password, rows[0].password_hash)) ? rows[0].password_hash : await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (id, login, name, role, password_hash, is_env_admin)
     VALUES ($1, $2, $3, 'admin', $4, true)
     ON CONFLICT (id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, role = 'admin', password_hash = EXCLUDED.password_hash, is_env_admin = true`,
    [ENV_ADMIN_ID, login, name, hash]
  );
  await pool.query(`SELECT setval(s, GREATEST((SELECT max(id) FROM users), COALESCE(pg_sequence_last_value(s), 0), 1))
                  FROM (SELECT pg_get_serial_sequence('users', 'id')::regclass AS s) q`);
}

function createAuth(pool) {
  const adminHash = bcrypt.hashSync(config.admin.password, 10);
  const envAdmin = (email = null) => ({ id: ENV_ADMIN_ID, login: config.admin.login, name: config.admin.name, role: 'admin', from_env: true, created_at: null, email });

  const publicUser = (u) => (u.is_env_admin || u.id === ENV_ADMIN_ID ? envAdmin(u.email ?? null) : { id: u.id, login: u.login, name: u.name, role: u.role, from_env: false, created_at: u.created_at, email: u.email ?? null });
  const envAdminEmail = async () => (await pool.query('SELECT email FROM users WHERE id = $1', [ENV_ADMIN_ID])).rows[0]?.email ?? null;
  async function findById(id) {
    if (id === ENV_ADMIN_ID) return envAdmin(await envAdminEmail());
    if (!Number.isSafeInteger(id)) return null;
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  async function allUsers() {
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id <> $1 ORDER BY id`, [ENV_ADMIN_ID]);
    return [envAdmin(await envAdminEmail()), ...rows.map(publicUser)];
  }

  async function check(login, password) {
    if (typeof login !== 'string' || !login.trim()) return { user: null, reason: 'unknown_login', known: null };
    login = login.trim().toLowerCase();
    const pass = typeof password === 'string' ? password : '';
    if (login === config.admin.login) {
      const admin = envAdmin(await envAdminEmail());
      const ok = !!pass && (await bcrypt.compare(pass, adminHash));
      return ok ? { user: admin, reason: null, known: admin } : { user: null, reason: 'wrong_password', known: admin };
    }
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE lower(login) = $1 AND id <> $2`, [login, ENV_ADMIN_ID]);
    const u = rows[0];
    const ok = await bcrypt.compare(pass || ' ', u ? u.password_hash : adminHash.replace(/.$/, '.'));
    if (!u) return { user: null, reason: 'unknown_login', known: null };
    return ok && pass ? { user: publicUser(u), reason: null, known: publicUser(u) } : { user: null, reason: 'wrong_password', known: publicUser(u) };
  }
  async function verify(login, password) {
    if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) return null;
    return (await check(login, password)).user;
  }
  async function findByLogin(login) {
    if (typeof login !== 'string' || !login.trim()) return null;
    login = login.trim().toLowerCase();
    if (login === config.admin.login) return envAdmin(await envAdminEmail());
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE lower(login) = $1 AND id <> $2`, [login, ENV_ADMIN_ID]);
    return rows[0] ? publicUser(rows[0]) : null;
  }

  const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, config.sessionSecret, { expiresIn: config.sessionTtlHours * 3600 });

  function setCookie(res, token) {
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionTtlHours * 3600e3, path: '/' });
  }
  const clearCookie = (res) => res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });

  async function readUser(req) {
    const h = req.get('authorization');
    const token = (h && h.startsWith('Bearer ') && h.slice(7)) || (req.cookies && req.cookies[COOKIE]);
    if (!token) return null;
    let p;
    try { p = jwt.verify(token, config.sessionSecret); } catch { return null; }
    const u = await findById(p.sub);
    return u ? publicUser(u) : null;
  }

  const attach = async (req, _res, next) => { req.user = await readUser(req); next(); };
  const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ detail: 'Требуется авторизация' }));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ detail: 'Требуется авторизация' });
    if (req.user.role !== 'admin') return res.status(403).json({ detail: 'Доступно только администратору' });
    next();
  };

  return { ENV_ADMIN_ID, envAdmin, publicUser, findById, findByLogin, allUsers, check, verify, sign, setCookie, clearCookie, attach, requireAuth, requireAdmin };
}

module.exports = { createAuth, upsertEnvAdmin, COOKIE, ENV_ADMIN_ID };
