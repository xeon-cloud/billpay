const path = require('path');
const nodemailer = require('nodemailer');
const config = require('./config');
const D = require('./dates');
const { money, dmy, whenLabel, daysWord } = require('./telegram');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const LOGO = path.join(config.root, 'public', 'assets', 'img', 'logo-128.png');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function parseEmail(v) {
  if (v === null || v === '') return { value: null };
  if (typeof v !== 'string') return { error: true };
  const e = v.trim().toLowerCase();
  if (!e) return { value: null };
  if (e.length > 254 || !EMAIL_RE.test(e)) return { error: true };
  return { value: e };
}

function createTransport(s = config.smtp) {
  const port = s.port || 587;
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure: port === 465,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: LOOPBACK.has(s.host) ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function leftLabel(due, today) {
  const n = D.diffDays(due, today);
  if (n > 0) return `${n} ${daysWord(n)}`;
  if (n === 0) return 'срок сегодня';
  return `просрочено на ${-n} ${daysWord(-n)}`;
}

function buildReminder(o, { today, to, appUrl = config.appUrl }) {
  const when = whenLabel(o.due_date, today);
  const overdue = D.diffDays(o.due_date, today) < 0;
  const sum = money(o.amount, o.currency);
  const link = appUrl ? `${appUrl}/app/calendar?date=${o.due_date}` : '';
  const subject = `🔔 Напоминание · ${when}: ${o.name} — ${sum}`;
  const text = [
    `🔔 Напоминание · ${when}`, '',
    `Срок: ${dmy(o.due_date)}`, `Название: ${o.name}`, `Сумма: ${sum}`, `Валюта: ${o.currency}`,
    `${overdue ? 'Просрочка' : 'Осталось'}: ${leftLabel(o.due_date, today)}`, '', 'Не оплачено!', '',
    ...(link ? [`Открыть в BillPay: ${link}`, ''] : []),
    '—', `Письмо отправлено на ${to}: эта почта указана в вашем профиле BillPay.`, 'Чтобы не получать письма, уберите почту в профиле.', ''
  ].join('\n');

  const F = "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  const FD = "Unbounded,Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
  const row = (k, v, cls = 'fg', last = false) => `<tr><td class="mut line" width="42%" style="padding:14px 0;border-bottom:${last ? '0' : '1px solid #E4E3DD'};font-family:${F};font-size:13px;line-height:18px;color:#6E6E69;">${k}</td><td class="${cls} line" align="right" style="padding:14px 0;border-bottom:${last ? '0' : '1px solid #E4E3DD'};font-family:${F};font-size:14px;line-height:18px;font-weight:700;color:${cls === 'red' ? '#C25A48' : '#0A0A0A'};">${v}</td></tr>`;
  const weekday = WD[new Date(o.due_date + 'T00:00:00Z').getUTCDay()];
  const html = `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
  body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table{border-collapse:collapse}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  a{text-decoration:none}
  @media (max-width:620px){
    .wrap{padding:16px 10px!important}
    .card{padding:24px 20px!important;border-radius:18px!important}
    .ttl{font-size:21px!important;line-height:26px!important}
    .amt{font-size:30px!important;line-height:34px!important}
    .btnt{width:100%!important}
    .btnc a{display:block!important;text-align:center!important}
  }
  @media (prefers-color-scheme:dark){
    .bg{background:#0A0A0A!important}
    .card{background:#131313!important;border-color:#232323!important}
    .fg{color:#FFFFFF!important}
    .mut{color:#8A8A8A!important}
    .line{border-color:#232323!important}
    .red{color:#E58A7B!important}
    .pill{background:#2A1C19!important;color:#E58A7B!important}
    .btnc{background:#FFFFFF!important}
    .btnc a{color:#0A0A0A!important}
  }
  [data-ogsc] .fg{color:#FFFFFF!important} [data-ogsc] .mut{color:#8A8A8A!important} [data-ogsc] .red{color:#E58A7B!important}
  [data-ogsb] .bg{background:#0A0A0A!important} [data-ogsb] .card{background:#131313!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#F4F3EF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Срок ${dmy(o.due_date)} · ${esc(sum)} · не оплачено&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F3EF" style="background:#F4F3EF;">
<tr><td class="wrap" align="center" style="padding:40px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;border-spacing:0;">
    <tr><td style="padding:0 4px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="32" style="padding-right:10px;"><img src="cid:logo@billpay" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:8px;"></td>
        <td class="fg" style="font-family:${FD};font-size:19px;line-height:24px;font-weight:600;letter-spacing:-0.8px;color:#0A0A0A;">billpay</td>
      </tr></table>
    </td></tr>
    <tr><td class="card" style="background:#FFFFFF;border:1px solid #E4E3DD;border-radius:24px;padding:32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="mut" style="font-family:${F};font-size:11px;line-height:16px;letter-spacing:1.8px;text-transform:uppercase;font-weight:700;color:#6E6E69;">🔔&nbsp;Напоминание · ${esc(when)}</td></tr>
        <tr><td class="fg ttl" style="padding-top:14px;font-family:${FD};font-size:24px;line-height:30px;font-weight:600;letter-spacing:-1px;color:#0A0A0A;">${esc(o.name)}</td></tr>
        <tr><td class="fg amt" style="padding-top:18px;font-family:${FD};font-size:36px;line-height:40px;font-weight:600;letter-spacing:-1.6px;color:#0A0A0A;white-space:nowrap;">${esc(sum)}</td></tr>
        <tr><td style="padding-top:16px;"><span class="pill red" style="display:inline-block;padding:6px 12px;border-radius:999px;background:#F6E7E3;color:#C25A48;font-family:${F};font-size:12px;line-height:14px;font-weight:700;">●&nbsp;${overdue ? 'Просрочено' : 'Не оплачено'}</span></td></tr>
        <tr><td style="padding-top:22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="line" style="border-top:1px solid #E4E3DD;">
            ${row('Срок', `${dmy(o.due_date)}<span class="mut" style="font-weight:600;color:#6E6E69;"> · ${weekday}</span>`)}
            ${row(overdue ? 'Просрочка' : 'Осталось', esc(leftLabel(o.due_date, today)), overdue ? 'red' : 'fg')}
            ${row('Сумма', esc(sum))}
            ${row('Валюта', esc(o.currency), 'fg', true)}
          </table>
        </td></tr>
        ${link ? `<tr><td style="padding-top:24px;">
          <table role="presentation" class="btnt" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td class="btnc" bgcolor="#0A0A0A" style="border-radius:14px;background:#0A0A0A;">
            <a href="${esc(link)}" target="_blank" style="display:inline-block;padding:15px 24px;font-family:${F};font-size:14px;line-height:18px;font-weight:700;color:#FFFFFF;border-radius:14px;">Открыть в BillPay&nbsp;→</a>
          </td></tr></table>
        </td></tr>` : ''}
        <tr><td class="mut" style="padding-top:20px;font-family:${F};font-size:12.5px;line-height:19px;color:#6E6E69;">Отметьте оплату в BillPay. Напоминание по этому периоду приходит один раз.</td></tr>
      </table>
    </td></tr>
    <tr><td class="mut" style="padding:20px 8px 0;font-family:${F};font-size:12px;line-height:18px;color:#6E6E69;">
      Письмо отправлено на <span class="fg" style="color:#0A0A0A;font-weight:700;">${esc(to)}</span>: эта почта указана в вашем профиле BillPay. Чтобы не получать письма, уберите почту в профиле.<br><br>BillPay · напоминания о регулярных платежах команды
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
  return { subject, text, html };
}

function fromHeader(from = config.smtp.from) {
  return from.includes('<') ? from : { name: 'BillPay', address: from };
}

async function sendReminder(transport, o, to, today) {
  const m = buildReminder(o, { today, to });
  await transport.sendMail({
    from: fromHeader(), to, subject: m.subject, text: m.text, html: m.html,
    attachments: [{ filename: 'logo.png', path: LOGO, cid: 'logo@billpay', contentDisposition: 'inline' }]
  });
}

module.exports = { parseEmail, createTransport, buildReminder, sendReminder, fromHeader, EMAIL_RE };
