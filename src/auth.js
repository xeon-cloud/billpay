const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'billpay_session';
// id = 1, чтобы на админа из .env ссылались created_by и paid_by
const ENV_ADMIN_ID = 1;
const USER_COLS = 'id, login, name, role, password_hash, is_env_admin, created_at';

async function upsertEnvAdmin(pool) {
  const { login, password, name } = config.admin;
  const clash = await pool.query('SELECT id FROM users WHERE lower(login) = $1 AND id <> $2', [login, ENV_ADMIN_ID]);
  if (clash.rowCount) throw new Error(`ADMIN_LOGIN "${login}" уже занят пользователем id=${clash.rows[0].id}. Выберите другой логин.`);
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [ENV_ADMIN_ID]);
  // хэш заново только если пароль в .env сменился
  const hash = rows.length && (await bcrypt.compare(password, rows[0].password_hash)) ? rows[0].password_hash : await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (id, login, name, role, password_hash, is_env_admin)
     VALUES ($1, $2, $3, 'admin', $4, true)
     ON CONFLICT (id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, role = 'admin', password_hash = EXCLUDED.password_hash, is_env_admin = true`,
    [ENV_ADMIN_ID, login, name, hash]
  );
  // id не переиспользуем: в JWT sub — это id пользователя
  await pool.query(`SELECT setval(s, GREATEST((SELECT max(id) FROM users), COALESCE(pg_sequence_last_value(s), 0), 1))
                  FROM (SELECT pg_get_serial_sequence('users', 'id')::regclass AS s) q`);
}

function createAuth(pool) {
  const adminHash = bcrypt.hashSync(config.admin.password, 10);
  const envAdmin = () => ({ id: ENV_ADMIN_ID, login: config.admin.login, name: config.admin.name, role: 'admin', from_env: true, created_at: null });

  const publicUser = (u) => (u.is_env_admin || u.id === ENV_ADMIN_ID ? envAdmin() : { id: u.id, login: u.login, name: u.name, role: u.role, from_env: false, created_at: u.created_at });
  async function findById(id) {
    if (id === ENV_ADMIN_ID) return envAdmin();
    if (!Number.isSafeInteger(id)) return null;
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] || null;
  }
  async function allUsers() {
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id <> $1 ORDER BY id`, [ENV_ADMIN_ID]);
    return [envAdmin(), ...rows.map(publicUser)];
  }

  async function verify(login, password) {
    if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) return null;
    login = login.trim().toLowerCase();
    if (login === config.admin.login) return (await bcrypt.compare(password, adminHash)) ? envAdmin() : null;
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE lower(login) = $1 AND id <> $2`, [login, ENV_ADMIN_ID]);
    const u = rows[0];
    // тот же bcrypt и для неизвестного логина, чтобы по времени не было видно, есть ли пользователь
    const ok = await bcrypt.compare(password, u ? u.password_hash : adminHash.replace(/.$/, '.'));
    return u && ok ? publicUser(u) : null;
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

  return { ENV_ADMIN_ID, envAdmin, publicUser, findById, allUsers, verify, sign, setCookie, clearCookie, attach, requireAuth, requireAdmin };
}

module.exports = { createAuth, upsertEnvAdmin, COOKIE, ENV_ADMIN_ID };
