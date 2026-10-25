const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const D = require('../dates');
const { parseEmail } = require('../mailer');
const { hostOf } = require('../webhook');
const { tx } = require('../db');
const { parseAuthQuery, parseActionsQuery, events: E } = require('../audit');
const R = require('../receipts');

module.exports = function apiRouter({ pool, auth, payments, loginLimiter, audit, receipts = R.createReceipts(pool) }) {
  const r = express.Router();
  const { requireAuth, requireAdmin } = auth;
  const bad = (res, detail, code = 400) => res.status(code).json({ detail });
  const monthParam = (req) => (req.query.month === undefined ? D.today().slice(0, 7) : req.query.month);
  const idParam = (req) => (/^\d+$/.test(req.params.id) ? +req.params.id : NaN);
  const RET = 'id, login, name, role, is_env_admin, created_at, email';
  const EMAIL_ERR = 'email: адрес вида name@company.ru или null';
  const EMAIL_TAKEN = 'Эта почта уже указана у другого пользователя';
  const emailTaken = (e) => e.code === '23505' && e.constraint === 'users_email_uq';

  const orderBudgets = (b) => Object.fromEntries(Object.entries(b || {}).sort(([x], [y]) => payments.CURRENCIES.indexOf(x) - payments.CURRENCIES.indexOf(y)));

  r.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'ok', today: D.today() }); }
    catch { res.status(503).json({ status: 'error', db: 'unavailable', today: D.today() }); }
  });

  r.post('/auth/login', loginLimiter, async (req, res) => {
    const { login, password } = req.body || {};
    const { user, reason, known } = await auth.check(login, password);
    if (!user) {
      await audit.auth(req, { event: 'login', ok: false, reason, user: known, login });
      return bad(res, 'Неверный логин или пароль', 401);
    }
    await audit.auth(req, { event: 'login', ok: true, user });
    const token = auth.sign(user);
    auth.setCookie(res, token);
    res.json({ user, access_token: token, token_type: 'bearer' });
  });
  r.post('/auth/logout', async (req, res) => {
    if (req.user) await audit.auth(req, { event: 'logout', ok: true, user: req.user });
    auth.clearCookie(res);
    res.status(204).end();
  });
  r.get('/auth/me', requireAuth, (req, res) => res.json(req.user));
  r.patch('/auth/me', requireAuth, async (req, res) => {
    const b = req.body || {};
    if (Object.keys(b).some((k) => k !== 'email')) return bad(res, 'Можно менять только email', 403);
    if (!('email' in b)) return bad(res, 'Передайте email (адрес или null)', 422);
    const e = parseEmail(b.email);
    if (e.error) return bad(res, EMAIL_ERR, 422);
    try {
      const u = await tx(pool, async (c) => {
        const { rows: [prev] } = await c.query('SELECT email FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
        if (!prev) return null;
        const { rows: [next] } = await c.query(`UPDATE users SET email = $2 WHERE id = $1 RETURNING ${RET}`, [req.user.id, e.value]);
        await audit.action(req)(c, E.profileEmail(req.user, prev.email, next.email));
        return next;
      });
      if (!u) return bad(res, 'Пользователь не найден', 404);
      res.json(auth.publicUser(u));
    } catch (x) {
      if (emailTaken(x)) return bad(res, EMAIL_TAKEN, 409);
      throw x;
    }
  });

  r.get('/meta', requireAuth, async (req, res) => {
    const month = monthParam(req);
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    res.json({
      today: D.today(), month, timezone: config.timezone, telegramChat: config.telegramChat,
      remindDaysBefore: config.remindDaysBefore, currentUser: req.user, email: { enabled: config.emailEnabled },
      webhook: { enabled: config.webhookEnabled, host: config.webhookEnabled && req.user.role === 'admin' ? hostOf(config.webhook.url) : null, signed: config.webhookEnabled && !!config.webhook.secret },
      budgets: orderBudgets(await payments.getSetting('budgets')), reminders: await payments.reminders(month)
    });
  });

  r.get('/recurring-payments', requireAuth, async (req, res) => res.json(await payments.listRecurring({ includeInactive: req.query.include_inactive === 'true' })));

  r.post('/recurring-payments', requireAdmin, async (req, res) => {
    const b = { periodicity: 'monthly', ...(req.body || {}) };
    const err = payments.validateRecurring(b);
    if (err.length) return bad(res, err.join('; '), 422);
    res.status(201).json(await payments.createRecurring(b, req.user.id, audit.action(req)));
  });

  r.patch('/recurring-payments/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    const rp = Number.isSafeInteger(id) ? await payments.getActiveRecurring(id) : null;
    if (!rp) return bad(res, 'Платёж не найден', 404);
    const err = payments.validateRecurring(req.body || {}, true);
    if (err.length) return bad(res, err.join('; '), 422);
    const updated = await payments.updateRecurring(rp, req.body, audit.action(req));
    if (!updated) return bad(res, 'Платёж не найден', 404);
    res.json(updated);
  });

  r.delete('/recurring-payments/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    const rp = Number.isSafeInteger(id) ? await payments.getActiveRecurring(id) : null;
    if (!rp || !(await payments.deleteRecurring(rp, audit.action(req)))) return bad(res, 'Платёж не найден', 404);
    res.status(204).end();
  });

  function listFilter(req, res) {
    const { q, status, currency, sort, order } = req.query;
    const one = (v) => (Array.isArray(v) ? NaN : v);
    if ([q, status, currency, sort, order].some((v) => Number.isNaN(one(v)))) { bad(res, 'Каждый параметр передаётся один раз; несколько валют — через запятую'); return null; }
    const f = {};
    if (q !== undefined) {
      if (q.trim().length > 100) { bad(res, 'q: не длиннее 100 символов'); return null; }
      if (q.trim()) f.q = q.trim();
    }
    if (status !== undefined && status !== '' && status !== 'all') {
      if (!['paid', 'unpaid', 'overdue'].includes(status)) { bad(res, 'status: paid, unpaid или overdue'); return null; }
      f.status = status;
    }
    if (currency !== undefined && currency !== '') {
      const list = [...new Set(currency.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))];
      if (!list.length || list.some((c) => !payments.CURRENCIES.includes(c))) { bad(res, 'currency: RUB, USD, EUR или их список через запятую'); return null; }
      f.currency = list;
    }
    if (sort !== undefined && sort !== '') {
      if (!payments.SORT_KEYS.includes(sort)) { bad(res, `sort: ${payments.SORT_KEYS.join(', ')}`); return null; }
      f.sort = sort;
    }
    if (order !== undefined && order !== '') {
      if (!['asc', 'desc'].includes(order)) { bad(res, 'order: asc или desc'); return null; }
      f.order = order;
    }
    return f;
  }

  r.get('/payment-occurrences', requireAuth, async (req, res) => {
    const month = monthParam(req);
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    const f = listFilter(req, res); if (!f) return;
    const { include } = req.query;
    if (include !== undefined && include !== 'meta') return bad(res, 'include: meta');
    res.json(include === 'meta' ? await payments.occurrencePage(month, f) : await payments.occurrences(month, f));
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
    res.json(await payments.setPaid(o, isPaid, isPaid ? b.paid_at : null, req.user.id, audit.action(req)));
  });

  const occurrenceOf = async (req, res, next) => {
    const id = idParam(req);
    const o = Number.isSafeInteger(id) ? await payments.getOccurrence(id) : null;
    if (!o) return bad(res, 'Период не найден', 404);
    req.occurrence = o;
    next();
  };
  const rawReceipt = express.raw({ type: R.MIMES, limit: R.MAX_SIZE });
  const receiptBody = (req, res, next) => {
    if (!req.occurrence.paid_at) return bad(res, 'Сначала отметьте оплату: чек прикрепляется к оплаченному периоду', 409);
    if (req.is('application/json')) return next();
    if (!req.is(R.MIMES)) return bad(res, 'Прикрепите PDF, JPG или PNG либо ссылку (application/json)', 415);
    rawReceipt(req, res, (e) => {
      if (!e) return next();
      if (e.type === 'entity.too.large') { res.set('Connection', 'close'); return bad(res, 'Файл больше 10 МБ', 413); }
      next(e);
    });
  };
  const RECEIPT_404 = 'Чек не прикреплён';

  r.put('/payment-occurrences/:id/receipt', requireAuth, occurrenceOf, receiptBody, async (req, res) => {
    let input;
    if (req.is('application/json')) {
      const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const extra = Object.keys(b).filter((k) => k !== 'url');
      if (extra.length) return bad(res, 'Передайте только url', 422);
      const err = R.checkUrl(b.url);
      if (err) return bad(res, err, 422);
      input = { kind: 'link', url: new URL(b.url.trim()).href };
      if (input.url.length > R.URL_MAX) return bad(res, `url: не длиннее ${R.URL_MAX} символов`, 422);
    } else {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!data.length) return bad(res, 'Пустой файл', 422);
      const t = R.sniff(data);
      if (!t) return bad(res, 'Содержимое файла не похоже на PDF, JPG или PNG', 415);
      const name = R.safeName(req.get('x-filename'), t.ext);
      if (!name) return bad(res, 'X-Filename: имя файла в percent-encoding (UTF-8)', 422);
      input = { kind: 'file', name, mime: t.mime, data };
    }
    const out = await receipts.put(req.occurrence, input, req.user, audit.action(req));
    res.status(out.created ? 201 : 200).json(out.receipt);
  });

  r.get('/payment-occurrences/:id/receipt', requireAuth, occurrenceOf, async (req, res) => {
    const x = await receipts.get(req.occurrence.id);
    if (!x) return bad(res, RECEIPT_404, 404);
    res.set('Cache-Control', 'no-store').json(x);
  });

  r.get('/payment-occurrences/:id/receipt/file', requireAuth, occurrenceOf, async (req, res) => {
    const f = await receipts.file(req.occurrence.id);
    if (!f) return bad(res, RECEIPT_404, 404);
    if (f.kind !== 'file') return bad(res, 'Прикреплена ссылка, файла нет', 404);
    const ext = R.sniff(f.data);
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.data.length),
      'Content-Disposition': `inline; filename="receipt.${ext ? ext.ext : 'bin'}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': f.mime === 'application/pdf' ? "default-src 'none'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    });
    res.end(f.data);
  });

  r.delete('/payment-occurrences/:id/receipt', requireAuth, occurrenceOf, async (req, res) => {
    if (!(await receipts.remove(req.occurrence, audit.action(req)))) return bad(res, RECEIPT_404, 404);
    res.status(204).end();
  });

  r.get('/payments/summary', requireAuth, async (req, res) => {
    const { date, include } = req.query;
    if (date !== undefined) {
      if (req.query.month !== undefined) return bad(res, 'Передайте либо month, либо date');
      if (['q', 'status', 'currency', 'sort', 'order'].some((k) => req.query[k] !== undefined)) return bad(res, 'date не сочетается с фильтрами списка');
      if (!D.isDate(date)) return bad(res, 'date: дата YYYY-MM-DD');
      if (date.slice(0, 7) > D.addMonths(D.today().slice(0, 7), 12)) return bad(res, 'date: не дальше 12 месяцев вперёд');
      if (include !== undefined && include !== 'items') return bad(res, 'include: items');
      return res.json(await payments.summaryOnDate(date, { items: include === 'items' }));
    }
    if (include !== undefined) return bad(res, 'include: только вместе с date');
    const month = monthParam(req);
    if (!D.isMonth(month)) return bad(res, 'month: формат YYYY-MM');
    const f = listFilter(req, res); if (!f) return;
    res.json(await payments.summary(month, f));
  });

  const LOGIN = /^[a-z0-9._-]{3,32}$/i;
  const protectedAdmin = (res) => bad(res, 'Главного администратора из .env нельзя изменить или удалить', 403);

  r.get('/users', requireAdmin, async (_req, res) => res.json(await auth.allUsers()));

  r.post('/users', requireAdmin, async (req, res) => {
    const { login, password, name, role, email } = req.body || {};
    if (role !== undefined && role !== 'user') return bad(res, 'Администратора нельзя добавить через панель: он задаётся в .env', 403);
    const err = [];
    if (typeof login !== 'string' || !LOGIN.test(login)) err.push('login: 3–32 символа (латиница, цифры, . _ -)');
    if (typeof password !== 'string' || password.length < 6) err.push('password: минимум 6 символов');
    if (typeof name !== 'string' || !name.trim()) err.push('name: обязательно');
    const e = email === undefined ? { value: null } : parseEmail(email);
    if (e.error) err.push(EMAIL_ERR);
    if (err.length) return bad(res, err.join('; '), 422);
    const l = login.toLowerCase();
    if (l === config.admin.login) return bad(res, 'Логин уже занят', 409);
    try {
      const hash = await bcrypt.hash(password, 10);
      const u = await tx(pool, async (c) => {
        const { rows: [created] } = await c.query(
          `INSERT INTO users (login, name, role, password_hash, created_at, email) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${RET}`,
          [l, name.trim(), 'user', hash, D.today(), e.value]
        );
        await audit.action(req)(c, E.userCreated(created));
        return created;
      });
      res.status(201).json(auth.publicUser(u));
    } catch (x) {
      if (emailTaken(x)) return bad(res, EMAIL_TAKEN, 409);
      if (x.code === '23505') return bad(res, 'Логин уже занят', 409);
      throw x;
    }
  });

  r.patch('/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    if (id === auth.ENV_ADMIN_ID) return protectedAdmin(res);
    const u = Number.isSafeInteger(id) ? await auth.findById(id) : null;
    if (!u) return bad(res, 'Пользователь не найден', 404);
    const { name, role, password, email } = req.body || {};
    if (role !== undefined) return bad(res, 'Роль изменить нельзя: администратор задаётся в .env', 403);
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) return bad(res, 'name: не может быть пустым', 422);
    if (password !== undefined && (typeof password !== 'string' || password.length < 6)) return bad(res, 'password: минимум 6 символов', 422);
    const e = email === undefined ? null : parseEmail(email);
    if (e && e.error) return bad(res, EMAIL_ERR, 422);
    try {
      const hash = password !== undefined ? await bcrypt.hash(password, 10) : null;
      const updated = await tx(pool, async (c) => {
        const { rows: [prev] } = await c.query(`SELECT ${RET} FROM users WHERE id = $1 AND NOT is_env_admin FOR UPDATE`, [id]);
        if (!prev) return null;
        const { rows: [next] } = await c.query(
          `UPDATE users SET name = COALESCE($2, name), password_hash = COALESCE($3, password_hash),
                  email = CASE WHEN $4 THEN $5 ELSE email END
            WHERE id = $1 RETURNING ${RET}`,
          [id, name !== undefined ? name.trim() : null, hash, !!e, e ? e.value : null]
        );
        await audit.action(req)(c, E.userUpdated(prev, next, password !== undefined));
        return next;
      });
      if (!updated) return bad(res, 'Пользователь не найден', 404);
      res.json(auth.publicUser(updated));
    } catch (x) {
      if (emailTaken(x)) return bad(res, EMAIL_TAKEN, 409);
      throw x;
    }
  });

  r.delete('/users/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    if (id === auth.ENV_ADMIN_ID) return protectedAdmin(res);
    if (id === req.user.id) return bad(res, 'Нельзя удалить самого себя', 400);
    const gone = Number.isSafeInteger(id) ? await tx(pool, async (c) => {
      const { rows: [u] } = await c.query(`DELETE FROM users WHERE id = $1 AND NOT is_env_admin RETURNING ${RET}`, [id]);
      if (u) await audit.action(req)(c, E.userDeleted(u));
      return u;
    }) : null;
    if (!gone) return bad(res, 'Пользователь не найден', 404);
    res.status(204).end();
  });

  r.get('/logs/auth', requireAdmin, async (req, res) => {
    const f = parseAuthQuery(req.query);
    if (f.err.length) return bad(res, f.err.join('; '), 422);
    res.json(await audit.listAuth(f));
  });

  r.get('/logs/actions', requireAdmin, async (req, res) => {
    const f = parseActionsQuery(req.query);
    if (f.err.length) return bad(res, f.err.join('; '), 422);
    res.json(await audit.listActions(f));
  });

  r.get('/logs/:id', requireAdmin, async (req, res) => {
    const id = idParam(req);
    const entry = Number.isSafeInteger(id) ? await audit.get(id) : null;
    if (!entry) return bad(res, 'Запись не найдена', 404);
    res.json(entry);
  });

  r.use((_req, res) => bad(res, 'Не найдено', 404));
  return r;
};
