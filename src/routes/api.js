const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const D = require('../dates');

module.exports = function apiRouter({ pool, auth, payments, loginLimiter }) {
  const r = express.Router();
  const { requireAuth, requireAdmin } = auth;
  const bad = (res, detail, code = 400) => res.status(code).json({ detail });
  const monthParam = (req) => (req.query.month === undefined ? D.today().slice(0, 7) : req.query.month);
  const idParam = (req) => (/^\d+$/.test(req.params.id) ? +req.params.id : NaN);

  // JSONB не хранит порядок ключей
  const orderBudgets = (b) => Object.fromEntries(Object.entries(b || {}).sort(([x], [y]) => payments.CURRENCIES.indexOf(x) - payments.CURRENCIES.indexOf(y)));

  r.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'ok', today: D.today() }); }
    catch { res.status(503).json({ status: 'error', db: 'unavailable', today: D.today() }); }
  });

  r.post('/auth/login', loginLimiter, async (req, res) => {
    const { login, password } = req.body || {};
    const user = await auth.verify(login, password);
    if (!user) return bad(res, 'Неверный логин или пароль', 401);
    const token = auth.sign(user);
    auth.setCookie(res, token);
    res.json({ user, access_token: token, token_type: 'bearer' });
  });
  r.post('/auth/logout', (_req, res) => { auth.clearCookie(res); res.status(204).end(); });
  r.get('/auth/me', requireAuth, (req, res) => res.json(req.user));

  r.get('/meta', requireAuth, async (req, res) => {
    const month = monthParam(req);
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    res.json({
      today: D.today(), month, timezone: config.timezone, telegramChat: config.telegramChat,
      remindDaysBefore: config.remindDaysBefore, currentUser: req.user,
      budgets: orderBudgets(await payments.getSetting('budgets')), reminders: await payments.reminders(month)
    });
  });

  r.get('/recurring-payments', requireAuth, async (req, res) => res.json(await payments.listRecurring({ includeInactive: req.query.include_inactive === 'true' })));

  r.post('/recurring-payments', requireAdmin, async (req, res) => {
    const b = { periodicity: 'monthly', ...(req.body || {}) };
    const err = payments.validateRecurring(b);
    if (err.length) return bad(res, err.join('; '), 422);
    res.status(201).json(await payments.createRecurring(b, req.user.id));
  });

  r.patch('/recurring-payments/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    const rp = Number.isSafeInteger(id) ? await payments.getActiveRecurring(id) : null;
    if (!rp) return bad(res, 'Платёж не найден', 404);
    const err = payments.validateRecurring(req.body || {}, true);
    if (err.length) return bad(res, err.join('; '), 422);
    const updated = await payments.updateRecurring(rp, req.body);
    if (!updated) return bad(res, 'Платёж не найден', 404);
    res.json(updated);
  });

  r.delete('/recurring-payments/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    const rp = Number.isSafeInteger(id) ? await payments.getActiveRecurring(id) : null;
    if (!rp || !(await payments.deleteRecurring(rp))) return bad(res, 'Платёж не найден', 404);
    res.status(204).end();
  });

  r.get('/payment-occurrences', requireAuth, async (req, res) => {
    const month = monthParam(req), { status, currency } = req.query;
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    if (status && !['paid', 'unpaid', 'overdue'].includes(status)) return bad(res, 'status: paid, unpaid или overdue');
    if (currency && !payments.CURRENCIES.includes(currency)) return bad(res, 'currency: RUB, USD или EUR');
    res.json(await payments.occurrences(month, { status, currency }));
  });

  r.get('/payment-occurrences/:id', requireAuth, async (req, res) => {
    const id = idParam(req);
    const o = Number.isSafeInteger(id) ? await payments.getOccurrence(id) : null;
    if (!o) return bad(res, 'Период не найден', 404);
    res.json(payments.view(o));
  });

  r.patch('/payment-occurrences/:id', requireAuth, async (req, res) => {
    const id = idParam(req);
    const o = Number.isSafeInteger(id) ? await payments.getOccurrence(id) : null;
    if (!o) return bad(res, 'Период не найден', 404);
    const b = req.body || {};
    const extra = Object.keys(b).filter((k) => !['is_paid', 'paid_at'].includes(k));
    if (extra.length) return bad(res, 'Можно менять только is_paid и paid_at', 403);
    const isPaid = b.is_paid !== undefined ? b.is_paid : b.paid_at !== undefined ? b.paid_at !== null : undefined;
    if (typeof isPaid !== 'boolean') return bad(res, 'Передайте is_paid (true/false) и/или paid_at', 422);
    if (isPaid && b.paid_at != null && !D.isDate(b.paid_at)) return bad(res, 'paid_at: дата YYYY-MM-DD', 422);
    if (isPaid && b.paid_at && b.paid_at > D.today()) return bad(res, 'paid_at не может быть в будущем', 422);
    res.json(await payments.setPaid(o, isPaid, isPaid ? b.paid_at : null, req.user.id));
  });

  r.get('/payments/summary', requireAuth, async (req, res) => {
    const month = monthParam(req);
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    res.json(await payments.summary(month));
  });

  const LOGIN = /^[a-z0-9._-]{3,32}$/i;
  const protectedAdmin = (res) => bad(res, 'Главного администратора из .env нельзя изменить или удалить', 403);

  r.get('/users', requireAdmin, async (_req, res) => res.json(await auth.allUsers()));

  r.post('/users', requireAdmin, async (req, res) => {
    const { login, password, name, role } = req.body || {};
    // админа через панель не создаём
    if (role !== undefined && role !== 'user') return bad(res, 'Администратора нельзя добавить через панель: он задаётся в .env', 403);
    const err = [];
    if (typeof login !== 'string' || !LOGIN.test(login)) err.push('login: 3–32 символа (латиница, цифры, . _ -)');
    if (typeof password !== 'string' || password.length < 6) err.push('password: минимум 6 символов');
    if (typeof name !== 'string' || !name.trim()) err.push('name: обязательно');
    if (err.length) return bad(res, err.join('; '), 422);
    const l = login.toLowerCase();
    if (l === config.admin.login) return bad(res, 'Логин уже занят', 409);
    try {
      const { rows: [u] } = await pool.query(
        `INSERT INTO users (login, name, role, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, login, name, role, is_env_admin, created_at`,
        [l, name.trim(), 'user', await bcrypt.hash(password, 10), D.today()]
      );
      res.status(201).json(auth.publicUser(u));
    } catch (e) {
      if (e.code === '23505') return bad(res, 'Логин уже занят', 409);
      throw e;
    }
  });

  r.patch('/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    if (id === auth.ENV_ADMIN_ID) return protectedAdmin(res);
    const u = Number.isSafeInteger(id) ? await auth.findById(id) : null;
    if (!u) return bad(res, 'Пользователь не найден', 404);
    const { name, role, password } = req.body || {};
    if (role !== undefined) return bad(res, 'Роль изменить нельзя: администратор задаётся в .env', 403);
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) return bad(res, 'name: не может быть пустым', 422);
    if (password !== undefined && (typeof password !== 'string' || password.length < 6)) return bad(res, 'password: минимум 6 символов', 422);
    const { rows: [updated] } = await pool.query(
      `UPDATE users SET name = COALESCE($2, name), password_hash = COALESCE($3, password_hash)
        WHERE id = $1 AND NOT is_env_admin RETURNING id, login, name, role, is_env_admin, created_at`,
      [id, name !== undefined ? name.trim() : null, password !== undefined ? await bcrypt.hash(password, 10) : null]
    );
    if (!updated) return bad(res, 'Пользователь не найден', 404);
    res.json(auth.publicUser(updated));
  });

  r.delete('/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    if (id === auth.ENV_ADMIN_ID) return protectedAdmin(res);
    if (id === req.user.id) return bad(res, 'Нельзя удалить самого себя', 400);
    const { rowCount } = Number.isSafeInteger(id) ? await pool.query('DELETE FROM users WHERE id = $1 AND NOT is_env_admin', [id]) : { rowCount: 0 };
    if (!rowCount) return bad(res, 'Пользователь не найден', 404);
    res.status(204).end();
  });

  r.use((_req, res) => bad(res, 'Не найдено', 404));
  return r;
};
