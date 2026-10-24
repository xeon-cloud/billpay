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

function formatReminder(o, today) {
  const when = whenLabel(o.due_date, today);
  return `<i>🔔 Напоминание ·</i> <b><i>${esc(when)}</i></b>\n\n<blockquote><b><i>Срок:</i></b> <i>${esc(dmy(o.due_date))}</i>\n<b><i>Название:</i></b> <i>${esc(o.name)}\nСумма: ${esc(money(o.amount, o.currency))}\nВалюта: ${esc(o.currency)}</i></blockquote>\n\n<b><i>Не оплачено!</i></b>`;
}

async function sendMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram ${res.status}`);
}

module.exports = { formatReminder, shouldNotify, sendMessage, money, dmy, whenLabel, daysWord };
