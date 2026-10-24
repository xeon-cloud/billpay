const config = require('./config');
const D = require('./dates');
const { createPool, waitForDb, migrate } = require('./db');
const { createPayments } = require('./payments');
const { formatReminder, sendMessage } = require('./telegram');

const LOCK = 727365;
const INTERVAL_MS = 60 * 1000;

async function dueOccurrences(client, today) {
  const until = D.addDays(today, config.remindDaysBefore);
  const { rows } = await client.query(
    `SELECT o.id, o.name, o.amount, o.currency::text AS currency, o.due_date::text AS due_date
       FROM payment_occurrences o
       JOIN recurring_payments rp ON rp.id = o.recurring_payment_id
      WHERE o.paid_at IS NULL
        AND rp.active
        AND o.due_date <= $1::date
        AND NOT EXISTS (
          SELECT 1 FROM reminders r
           WHERE r.occurrence_id = o.id AND r.channel = 'telegram' AND r.status = 'sent'
        )
      ORDER BY o.due_date, o.id`,
    [until]
  );
  return rows;
}

// пока телеграм не ответил, строка failed и её можно повторить
async function claim(client, id, today) {
  const inserted = await client.query(
    `INSERT INTO reminders (occurrence_id, channel, send_date, status)
     VALUES ($1, 'telegram', $2, 'failed')
     ON CONFLICT (occurrence_id, channel) DO NOTHING
     RETURNING id`,
    [id, today]
  );
  if (inserted.rowCount) return inserted.rows[0].id;
  const updated = await client.query(
    `UPDATE reminders SET send_date = $2, error = NULL, sent_at = now()
      WHERE occurrence_id = $1 AND channel = 'telegram' AND status = 'failed'
      RETURNING id`,
    [id, today]
  );
  return updated.rowCount ? updated.rows[0].id : null;
}

async function dispatch(pool, payments) {
  if (!config.telegramBotToken || !config.telegramChatId) return { skipped: 'config' };
  const today = D.today();
  const month = today.slice(0, 7);
  await payments.ensureMonth(month);
  await payments.ensureMonth(D.addMonths(month, 1));
  const client = await pool.connect();
  const sent = [];
  try {
    // второй бот ждёт, чтобы не послать то же дважды
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    const rows = await dueOccurrences(client, today);
    for (const o of rows) {
      const id = await claim(client, o.id, today);
      if (!id) continue;
      try {
        await sendMessage(config.telegramBotToken, config.telegramChatId, formatReminder(o, today));
        await client.query(`UPDATE reminders SET status = 'sent', error = NULL, sent_at = now() WHERE id = $1`, [id]);
        sent.push(o.id);
        console.log(`[billpay] напоминание отправлено: ${o.name} · ${o.due_date}`);
      } catch (e) {
        const msg = String(e.message || e).slice(0, 500);
        await client.query(`UPDATE reminders SET status = 'failed', error = $2, sent_at = now() WHERE id = $1`, [id, msg]);
        console.error(`[billpay] не отправилось (${o.id}): ${msg}`);
      }
    }
    return { sent };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

async function main() {
  const pool = createPool();
  await waitForDb(pool);
  await migrate(pool);
  const payments = createPayments(pool);
  let timer;
  let warned = false;
  const tick = async () => {
    try {
      const res = await dispatch(pool, payments);
      if (res && res.skipped === 'config' && !warned) {
        warned = true;
        console.log('[billpay] бот ждёт TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID');
      }
    } catch (e) {
      console.error('[billpay] проверка напоминаний:', e.message);
    }
  };
  await tick();
  timer = setInterval(tick, INTERVAL_MS);
  const stop = async () => {
    clearInterval(timer);
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[billpay] бот не запущен:', e.message);
    process.exit(1);
  });
}

module.exports = { dispatch, dueOccurrences, claim };
