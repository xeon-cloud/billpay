const config = require('./config');
const D = require('./dates');
const { tx } = require('./db');

const CURRENCIES = ['RUB', 'USD', 'EUR'];
const round2 = (n) => Math.round(n * 100) / 100;

const RP_COLS = 'id, name, amount, currency::text AS currency, periodicity, day, start_date, active, created_at, created_by, deleted_at';
const OCC_COLS = 'id, recurring_payment_id, month::text AS month, name, amount, currency::text AS currency, due_date, paid_at, paid_by';

function createPayments(pool) {
  function status(o, today = D.today()) {
    if (o.paid_at) return 'paid';
    return D.diffDays(today, o.due_date) > 0 ? 'overdue' : 'unpaid';
  }
  function view(o, today = D.today()) {
    const st = status(o, today);
    return {
      id: o.id, recurring_payment_id: o.recurring_payment_id, month: o.month,
      name: o.name, amount: o.amount, currency: o.currency,
      due_date: o.due_date, paid_at: o.paid_at, is_paid: !!o.paid_at,
      status: st, overdue_days: Math.max(0, D.diffDays(o.paid_at || today, o.due_date))
    };
  }

  // период месяца создаётся при первом запросе; конфликт при гонке игнорируем
  async function ensureMonth(month, db = pool) {
    const limit = D.addMonths(D.today().slice(0, 7), 12);
    if (month > limit) return;
    const { rows } = await db.query(
      `SELECT rp.id, rp.name, rp.amount, rp.currency::text AS currency, rp.day
         FROM recurring_payments rp
        WHERE to_char(rp.start_date, 'YYYY-MM') <= $1
          AND (rp.active OR (rp.deleted_at IS NOT NULL AND to_char(rp.deleted_at, 'YYYY-MM') > $1))
          AND NOT EXISTS (SELECT 1 FROM payment_occurrences o WHERE o.recurring_payment_id = rp.id AND o.month = $1)`,
      [month]
    );
    for (const rp of rows) {
      await db.query(
        `INSERT INTO payment_occurrences (recurring_payment_id, month, name, amount, currency, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (recurring_payment_id, month) DO NOTHING`,
        [rp.id, month, rp.name, rp.amount, rp.currency, D.dueInMonth(month, rp.day)]
      );
    }
  }

  async function occurrences(month, filter = {}) {
    await ensureMonth(month);
    const today = D.today();
    const { rows } = await pool.query(`SELECT ${OCC_COLS} FROM payment_occurrences WHERE month = $1 ORDER BY due_date, id`, [month]);
    return rows
      .map((o) => view(o, today))
      .filter((o) => !filter.status || o.status === filter.status)
      .filter((o) => !filter.currency || o.currency === filter.currency);
  }

  async function getOccurrence(id) {
    const { rows } = await pool.query(`SELECT ${OCC_COLS} FROM payment_occurrences WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async function summary(month) {
    const t = Object.fromEntries(CURRENCIES.map((c) => [c, { currency: c, to_pay: 0, paid: 0, overdue: 0, total: 0, count: 0 }]));
    for (const o of await occurrences(month)) {
      const s = t[o.currency];
      s[o.status === 'paid' ? 'paid' : o.status === 'overdue' ? 'overdue' : 'to_pay'] += o.amount;
      s.total += o.amount; s.count++;
    }
    return Object.values(t).map((s) => ({ ...s, to_pay: round2(s.to_pay), paid: round2(s.paid), overdue: round2(s.overdue), total: round2(s.total) }));
  }

  async function reminders(month) {
    const today = D.today(), before = config.remindDaysBefore;
    return (await occurrences(month))
      .filter((o) => o.due_date >= today && (!o.paid_at || o.paid_at >= D.addDays(o.due_date, -before)))
      .map((o) => { const send = D.addDays(o.due_date, -before); return { occurrence_id: o.id, send_date: send, time: '10:00', status: send <= today ? 'sent' : 'scheduled' }; })
      .sort((a, b) => a.send_date.localeCompare(b.send_date));
  }

  async function nextDates(rps) {
    if (!rps.length) return new Map();
    await ensureMonth(D.today().slice(0, 7));
    const { rows } = await pool.query(
      `SELECT recurring_payment_id AS id,
              min(due_date) FILTER (WHERE paid_at IS NULL) AS open_due,
              max(month)::text AS last_month
         FROM payment_occurrences WHERE recurring_payment_id = ANY($1::bigint[]) GROUP BY recurring_payment_id`,
      [rps.map((r) => r.id)]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const month = D.today().slice(0, 7);
    return new Map(rps.map((rp) => {
      const r = byId.get(rp.id);
      if (r && r.open_due) return [rp.id, r.open_due];
      return [rp.id, D.dueInMonth(D.addMonths((r && r.last_month) || month, 1), rp.day)];
    }));
  }
  const rpView = (rp, next) => ({ id: rp.id, name: rp.name, amount: rp.amount, currency: rp.currency, periodicity: rp.periodicity, start_date: rp.start_date, next_date: rp.active ? next : null, active: rp.active, created_at: rp.created_at });
  async function rpViewOne(rp) { return rpView(rp, (await nextDates([rp])).get(rp.id)); }

  async function listRecurring({ includeInactive = false } = {}) {
    const { rows } = await pool.query(`SELECT ${RP_COLS} FROM recurring_payments ${includeInactive ? '' : 'WHERE active'} ORDER BY id`);
    const next = await nextDates(rows.filter((r) => r.active));
    return rows.map((rp) => rpView(rp, next.get(rp.id)));
  }

  async function getActiveRecurring(id) {
    const { rows } = await pool.query(`SELECT ${RP_COLS} FROM recurring_payments WHERE id = $1 AND active`, [id]);
    return rows[0] || null;
  }

  function validateRecurring(b, partial = false) {
    const err = [];
    if (!partial || b.name !== undefined) if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 120) err.push('name: от 1 до 120 символов');
    if (!partial || b.amount !== undefined) if (typeof b.amount !== 'number' || !isFinite(b.amount) || b.amount <= 0 || b.amount > 1e12) err.push('amount: положительное число');
    if (!partial || b.currency !== undefined) if (!CURRENCIES.includes(b.currency)) err.push('currency: RUB, USD или EUR');
    if (!partial || b.next_date !== undefined) if (!D.isDate(b.next_date)) err.push('next_date: дата YYYY-MM-DD');
    if (b.periodicity !== undefined && b.periodicity !== 'monthly') err.push('periodicity: поддерживается только monthly');
    return err;
  }

  async function createRecurring(b, userId) {
    const rp = await tx(pool, async (c) => {
      const { rows: [rp] } = await c.query(
        `INSERT INTO recurring_payments (name, amount, currency, periodicity, day, start_date, active, created_at, created_by)
         VALUES ($1, $2, $3, 'monthly', $4, $5, true, $6, $7) RETURNING ${RP_COLS}`,
        [b.name.trim(), round2(b.amount), b.currency, +b.next_date.slice(8), b.next_date, D.today(), userId]
      );
      await c.query(
        `INSERT INTO payment_occurrences (recurring_payment_id, month, name, amount, currency, due_date) VALUES ($1, $2, $3, $4, $5, $6)`,
        [rp.id, b.next_date.slice(0, 7), rp.name, rp.amount, rp.currency, b.next_date]
      );
      return rp;
    });
    return rpViewOne(rp);
  }

  // правка только неоплаченных периодов с текущего месяца
  async function updateRecurring(rp, b) {
    const updated = await tx(pool, async (c) => {
      const name = b.name !== undefined ? b.name.trim() : rp.name;
      const amount = b.amount !== undefined ? round2(b.amount) : rp.amount;
      const currency = b.currency !== undefined ? b.currency : rp.currency;
      const day = b.next_date !== undefined ? +b.next_date.slice(8) : rp.day;
      const { rows: [u] } = await c.query(
        `UPDATE recurring_payments SET name = $2, amount = $3, currency = $4, day = $5 WHERE id = $1 AND active RETURNING ${RP_COLS}`,
        [rp.id, name, amount, currency, day]
      );
      if (!u) return null;
      const month = D.today().slice(0, 7);
      const { rows: occ } = await c.query(
        `SELECT id, month::text AS month FROM payment_occurrences WHERE recurring_payment_id = $1 AND paid_at IS NULL AND month >= $2 FOR UPDATE`,
        [rp.id, month]
      );
      for (const o of occ) {
        const due = b.next_date === undefined ? null : o.month === b.next_date.slice(0, 7) ? b.next_date : D.dueInMonth(o.month, day);
        await c.query(
          `UPDATE payment_occurrences SET name = $2, amount = $3, currency = $4, due_date = COALESCE($5::date, due_date) WHERE id = $1`,
          [o.id, name, amount, currency, due]
        );
      }
      return u;
    });
    return updated ? rpViewOne(updated) : null;
  }

  // скрываем платёж и будущие неоплаченные периоды, оплаченное оставляем
  async function deleteRecurring(rp) {
    return tx(pool, async (c) => {
      const { rowCount } = await c.query('UPDATE recurring_payments SET active = false, deleted_at = $2 WHERE id = $1 AND active', [rp.id, D.today()]);
      if (!rowCount) return false;
      await c.query('DELETE FROM payment_occurrences WHERE recurring_payment_id = $1 AND paid_at IS NULL AND month >= $2', [rp.id, D.today().slice(0, 7)]);
      return true;
    });
  }

  async function setPaid(o, isPaid, paidAt, userId) {
    const { rows: [u] } = await pool.query(
      `UPDATE payment_occurrences SET paid_at = $2, paid_by = $3 WHERE id = $1 RETURNING ${OCC_COLS}`,
      [o.id, isPaid ? paidAt || D.today() : null, isPaid ? userId : null]
    );
    return view(u);
  }

  async function getSetting(key, fallback = null) {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows.length ? rows[0].value : fallback;
  }

  return { CURRENCIES, status, view, ensureMonth, occurrences, getOccurrence, summary, reminders, listRecurring, getActiveRecurring, validateRecurring, createRecurring, updateRecurring, deleteRecurring, setPaid, getSetting };
}

module.exports = { createPayments, CURRENCIES };
