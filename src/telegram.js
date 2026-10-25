const D = require('./dates');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function daysWord(n) {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дня';
  return 'дней';
}

function whenLabel(due, today) {
  const n = D.diffDays(due, today);
  if (n > 0) return `за ${n} ${daysWord(n)}`;
  if (n === 0) return 'сегодня';
  return 'срок прошёл';
}

function money(amount, currency) {
  const n = Number(amount);
  if (currency === 'RUB') return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
  const s = n.toFixed(2);
  if (currency === 'USD') return '$' + s;
  if (currency === 'EUR') return '€' + s;
  return s + ' ' + currency;
}

function dmy(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function shouldNotify(due, today, daysBefore) {
  return D.diffDays(due, today) <= daysBefore;
}

function formatReminder(o, today, paidAt) {
  const when = whenLabel(o.due_date, today);
  const foot = paidAt ? `Оплачено · ${esc(dmy(paidAt))}` : 'Не оплачено!';
  return `<i>🔔 Напоминание ·</i> <b><i>${esc(when)}</i></b>\n\n<blockquote><b><i>Срок:</i></b> <i>${esc(dmy(o.due_date))}</i>\n<b><i>Название:</i></b> <i>${esc(o.name)}\nСумма: ${esc(money(o.amount, o.currency))}\nВалюта: ${esc(o.currency)}</i></blockquote>\n\n<b><i>${foot}</i></b>`;
}

function payKeyboard(id) {
  return { inline_keyboard: [[{ text: 'Оплачено', callback_data: `paid:${id}` }]] };
}

async function callApi(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram ${res.status}`);
  return data;
}

async function sendMessage(token, chatId, text, replyMarkup) {
  await callApi(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

module.exports = { formatReminder, shouldNotify, sendMessage, callApi, payKeyboard, money, dmy, whenLabel, daysWord };
