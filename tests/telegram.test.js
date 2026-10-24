process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.REMIND_DAYS_BEFORE = '3';
process.env.APP_TIMEZONE = 'Europe/Moscow';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatReminder, shouldNotify } = require('../src/telegram');

test('напоминание — карточка без сводки', () => {
  const text = formatReminder({ name: 'Аренда <офиса>', amount: 85000, currency: 'RUB', due_date: '2026-10-25' }, '2026-10-22');
  assert.match(text, /🔔 Напоминание/);
  assert.match(text, /<b><i>за 3 дня<\/i><\/b>/);
  assert.match(text, /<b><i>Срок:<\/i><\/b> <i>25\.10\.2026<\/i>/);
  assert.match(text, /Аренда &lt;офиса&gt;/);
  assert.match(text, /Сумма: 85 000 ₽/);
  assert.match(text, /Валюта: RUB/);
  assert.match(text, /<b><i>Не оплачено!<\/i><\/b>/);
  assert.doesNotMatch(text, /К оплате/);
});

test('окно: за 3 дня и раньше — да, дальше — нет', () => {
  assert.equal(shouldNotify('2026-10-25', '2026-10-22', 3), true);
  assert.equal(shouldNotify('2026-10-26', '2026-10-22', 3), false);
  assert.equal(shouldNotify('2026-10-22', '2026-10-22', 3), true);
  assert.equal(shouldNotify('2026-10-21', '2026-10-22', 3), true);
});
