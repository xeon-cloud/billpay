const crypto = require('crypto');
const config = require('./config');
const D = require('./dates');

const EVENT = 'payment.reminder';
const TIMEOUT_MS = 10000;

function sign(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildPayload(o, { today, deliveryId, appUrl = config.appUrl, now = new Date() }) {
  const days = D.diffDays(o.due_date, today);
  return {
    event: EVENT,
    delivery_id: deliveryId,
    sent_at: now.toISOString(),
    data: {
      occurrence_id: Number(o.id),
      payment_id: Number(o.recurring_payment_id),
      name: o.name,
      amount: Number(o.amount),
      currency: o.currency,
      due_date: o.due_date,
      status: days < 0 ? 'overdue' : 'unpaid',
      days_left: days,
      url: appUrl ? `${appUrl}/app/calendar?date=${o.due_date}` : null
    }
  };
}

async function sendWebhook(o, { url, secret, today, deliveryId, timeoutMs = TIMEOUT_MS }) {
  const body = JSON.stringify(buildPayload(o, { today, deliveryId }));
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'BillPay-Webhook',
    'X-BillPay-Event': EVENT,
    'X-BillPay-Delivery': deliveryId
  };
  if (secret) headers['X-BillPay-Signature'] = sign(body, secret);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error(`таймаут ${Math.round(timeoutMs / 1000)} с`);
    throw new Error(e.cause && e.cause.message ? e.cause.message : e.message);
  }
  await res.arrayBuffer().catch(() => {});
  if (res.status < 200 || res.status > 299) throw new Error(`HTTP ${res.status}`);
  return res.status;
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

module.exports = { EVENT, sign, buildPayload, sendWebhook, hostOf };
