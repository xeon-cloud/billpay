const config = require('./config');
const D = require('./dates');
const { createPool, waitForDb, migrate } = require('./db');
const { createPayments } = require('./payments');
const { formatReminder, sendMessage, callApi, payKeyboard } = require('./telegram');
const { createTransport, sendReminder } = require('./mailer');
const { sendWebhook, hostOf } = require('./webhook');

const LOCK = 727365;
const INTERVAL_MS = 60 * 1000;

async function dueOccurrences(client, today, channel = 'telegram', recipient = '') {
  const until = D.addDays(today, config.remindDaysBefore);
  const { rows } = await client.query(
    `SELECT o.id, o.recurring_payment_id, o.name, o.amount, o.currency::text AS currency, o.due_date::text AS due_date
       FROM payment_occurrences o
       JOIN recurring_payments rp ON rp.id = o.recurring_payment_id
      WHERE o.paid_at IS NULL
        AND rp.active
        AND o.due_date <= $1::date
        AND NOT EXISTS (
          SELECT 1 FROM reminders r
           WHERE r.occurrence_id = o.id AND r.channel = $2 AND r.recipient = $3 AND r.status = 'sent'
        )
      ORDER BY o.due_date, o.id`,
    [until, channel, recipient]
  );
  return rows;
}

async function claim(client, id, today, channel = 'telegram', recipient = '') {
  const inserted = await client.query(
    `INSERT INTO reminders (occurrence_id, channel, recipient, send_date, status)
     VALUES ($1, $3, $4, $2, 'failed')
     ON CONFLICT (occurrence_id, channel, recipient) DO NOTHING
     RETURNING id`,
    [id, today, channel, recipient]
  );
  if (inserted.rowCount) return inserted.rows[0].id;
  const updated = await client.query(
    `UPDATE reminders SET send_date = $2, error = NULL, sent_at = now()
      WHERE occurrence_id = $1 AND channel = $3 AND recipient = $4 AND status = 'failed'
      RETURNING id`,
    [id, today, channel, recipient]
  );
  return updated.rowCount ? updated.rows[0].id : null;
}

async function deliver(client, today, channel, recipient, send) {
  const done = [];
  for (const o of await dueOccurrences(client, today, channel, recipient)) {
    const id = await claim(client, o.id, today, channel, recipient);
    if (!id) continue;
    const to = channel === 'webhook' ? hostOf(recipient) : recipient;
    const label = to ? `${o.name} · ${o.due_date} → ${to}` : `${o.name} · ${o.due_date}`;
    try {
      await send(o, id);
      await client.query(`UPDATE reminders SET status = 'sent', error = NULL, sent_at = now() WHERE id = $1`, [id]);
      done.push(o.id);
      console.log(`[billpay] ${{ email: 'письмо отправлено', webhook: 'вебхук доставлен' }[channel] || 'напоминание отправлено'}: ${label}`);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 500);
      await client.query(`UPDATE reminders SET status = 'failed', error = $2, sent_at = now() WHERE id = $1`, [id, msg]);
      console.error(`[billpay] не отправилось (${channel}, ${label}): ${msg}`);
    }
  }
  return done;
}

let sharedTransport = null;
const mailTransport = () => (sharedTransport ||= createTransport());

// кнопка в чате
async function onPaid(payments, q) {
  const token = config.telegramBotToken;
  const answer = (text) => callApi(token, 'answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
  const m = /^paid:(\d+)$/.exec(q.data || '');
  if (!m) return answer('Не понял кнопку');
  const o = await payments.getOccurrence(Number(m[1]));
  if (!o) return answer('Платёж не найден');
  o.due_date = String(o.due_date).slice(0, 10);
  if (o.paid_at) o.paid_at = String(o.paid_at).slice(0, 10);
  const paidAt = o.paid_at || D.today();
  if (!o.paid_at) await payments.setPaid(o, true, paidAt, null);
  const msg = q.message;
  if (msg) {
    await callApi(token, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id,
      text: formatReminder(o, D.today(), paidAt), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    }).catch((e) => { if (!/not modified/i.test(e.message)) throw e; });
  }
  await answer(o.paid_at ? 'Уже оплачено' : 'Оплачено');
}

async function listen(payments, stop) {
  const token = config.telegramBotToken;
  await callApi(token, 'deleteWebhook', {}).catch(() => {});
  let offset = 0;
  while (!stop.done) {
    try {
      const data = await callApi(token, 'getUpdates', { offset, timeout: 10, allowed_updates: ['callback_query'] });
      for (const u of data.result || []) {
        offset = u.update_id + 1;
        if (u.callback_query) {
          try { await onPaid(payments, u.callback_query); }
          catch (e) { console.error(`[billpay] кнопка оплаты: ${e.message}`); }
        }
      }
    } catch (e) {
      if (stop.done) return;
      console.error(`[billpay] телеграм: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function dispatch(pool, payments, { transport, webhook = config.webhook } = {}) {
  const telegram = !!(config.telegramBotToken && config.telegramChatId);
  const email = !!transport || config.emailEnabled;
  const hook = !!(webhook && webhook.url);
  const off = { telegram: !telegram, email: !email, webhook: !hook };
  if (!telegram && !email && !hook) return { skipped: 'config', off, sent: [], emailed: [], hooked: [] };
  const today = D.today();
  const month = today.slice(0, 7);
  await payments.ensureMonth(month);
  await payments.ensureMonth(D.addMonths(month, 1));
  const client = await pool.connect();
  const sent = [], emailed = [], hooked = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    if (telegram) {
      sent.push(...await deliver(client, today, 'telegram', '', (o) => sendMessage(config.telegramBotToken, config.telegramChatId, formatReminder(o, today), payKeyboard(o.id))));
    }
    if (email) {
      const t = transport || mailTransport();
      const { rows } = await client.query('SELECT DISTINCT email FROM users WHERE email IS NOT NULL ORDER BY email');
      for (const { email: to } of rows) {
        const ids = await deliver(client, today, 'email', to, (o) => sendReminder(t, o, to, today));
        emailed.push(...ids.map((id) => ({ occurrence_id: id, to })));
      }
    }
    if (hook) {
      hooked.push(...await deliver(client, today, 'webhook', webhook.url, (o, id) => sendWebhook(o, { url: webhook.url, secret: webhook.secret, today, deliveryId: String(id) })));
    }
    return { sent, emailed, hooked, off };
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
  if (config.emailEnabled) {
    mailTransport().verify().then(
      () => console.log(`[billpay] SMTP доступен: ${config.smtp.host}:${config.smtp.port || 587}`),
      (e) => console.error(`[billpay] SMTP недоступен (${config.smtp.host}:${config.smtp.port || 587}): ${e.message}. Письма будут повторяться каждую минуту.`)
    );
  }
  if (config.webhookEnabled) {
    console.log(`[billpay] вебхук включён: ${hostOf(config.webhook.url)}, ${config.webhook.secret ? 'подпись HMAC-SHA256' : 'без подписи'}`);
  }
  let timer;
  let busy = false;
  const stop = { done: false };
  if (config.telegramBotToken) listen(payments, stop);
  const warned = { telegram: false, email: false, webhook: false };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const res = await dispatch(pool, payments);
      if (res.off.telegram && !warned.telegram) {
        warned.telegram = true;
        console.log('[billpay] бот ждёт TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID');
      }
      if (res.off.email && !warned.email) {
        warned.email = true;
        console.log('[billpay] почта выключена: задайте SMTP_HOST и SMTP_FROM');
      }
      if (res.off.webhook && !warned.webhook) {
        warned.webhook = true;
        console.log('[billpay] вебхук выключен: задайте WEBHOOK_URL');
      }
    } catch (e) {
      console.error('[billpay] проверка напоминаний:', e.message);
    } finally {
      busy = false;
    }
  };
  await tick();
  timer = setInterval(tick, INTERVAL_MS);
  const halt = async () => {
    stop.done = true;
    clearInterval(timer);
    if (sharedTransport) sharedTransport.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', halt);
  process.on('SIGINT', halt);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[billpay] бот не запущен:', e.message);
    process.exit(1);
  });
}

module.exports = { dispatch, dueOccurrences, claim };
