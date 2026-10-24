const config = require('./config');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function isDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const isMonth = (s) => typeof s === 'string' && MONTH.test(s);

// YYYY-MM-DD в часовом поясе приложения
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const toUTC = (s) => Date.parse(s + 'T00:00:00Z');
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 864e5);
function addDays(s, n) { const d = new Date(toUTC(s) + n * 864e5); return d.toISOString().slice(0, 10); }
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number); const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
// если в месяце нет такого дня — последний день месяца
const dueInMonth = (month, day) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;

module.exports = { isDate, isMonth, today, diffDays, addDays, addMonths, daysInMonth, dueInMonth };
