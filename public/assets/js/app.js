(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ic = window.ic;
  const SYM = { RUB: '₽', USD: '$', EUR: '€' }, CN = { RUB: 'Российский рубль', USD: 'Доллар США', EUR: 'Евро' };
  const ST = { paid: 'Оплачено', unpaid: 'Не оплачено', overdue: 'Просрочено' };
  const S = window.BILLPAY_BOOT || {};
  const TODAY = (S && S.today) || new Date().toISOString().slice(0, 10);

  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dmy = (iso) => (iso ? iso.split('-').reverse().join('.') : '—');
  const dm = (iso) => dmy(iso).slice(0, 5);
  const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  const num = (a, c) => (c === 'RUB' ? Math.round(a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') : (+a).toFixed(2));
  const fmt = (a, c) => (c === 'RUB' ? num(a, c) + '\u2009₽' : SYM[c] + num(a, c));
  const status = (o) => (o.paid_at ? 'paid' : days(TODAY, o.due_date) > 0 ? 'overdue' : 'unpaid');
  const late = (o) => Math.max(0, days(o.paid_at || TODAY, o.due_date));
  const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const CUR = TODAY.slice(0, 7), VM = (window.BillPayApi && BillPayApi.month()) || CUR, IS_CUR = VM === CUR;
  const monthName = MONTHS[+VM.slice(5, 7) - 1], monthIn = MONTHS_IN[+VM.slice(5, 7) - 1], year = VM.slice(0, 4);
  const shiftMonth = (m, n) => { const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const monthUrl = (path, m) => (m === CUR ? path : `${path}?month=${m}`);
  const mName = (m) => MONTHS[+m.slice(5, 7) - 1] + (m.slice(0, 4) !== CUR.slice(0, 4) ? ' ' + m.slice(0, 4) : '');
  const setHead = () => { const h = $('.phead h1'); if (h) h.innerHTML = `${monthName} <span>${year}</span>`; };
  const emptyCta = (icon, title, text, action = '') => `<div class="ecta rise"><span class="ec-ic">${ic(icon)}</span><b>${title}</b><p>${text}</p>${action ? `<div class="ec-a">${action}</div>` : ''}</div>`;
  const CHK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.8 2.8 6-6.2"/></svg>';
  const TT = (cls = '') => `<button class="ibtn tt ${cls}" data-theme-toggle aria-label="Сменить тему">${ic('moon', 'moon')}${ic('sun', 'sun')}</button>`;
  const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
  const mailOn = () => !!(S.email && S.email.enabled && S.currentUser.email);
  const remWhere = () => `чат «${esc(S.telegramChat)}»${mailOn() ? ' и почта' : ''}`;
  const LOGO = '<img src="/assets/img/logo-128.png" width="28" height="28" alt=""><span class="wm">billpay</span>';

  const NAV = [['payments', '/app', 'card', 'Платежи'], ['calendar', '/app/calendar', 'cal', 'Календарь'], ['users', '/app/admin', 'users', 'Пользователи'], ['settings', '/app/admin#settings', 'sliders', 'Настройки']];
  function shell(active, crumb, actions = '', mobileActions = '') {
    const u = S.currentUser, isAdmin = u.role === 'admin';
    const nav = NAV.filter((n) => isAdmin || (n[0] !== 'users' && n[0] !== 'settings'));
    const side = $('#side');
    if (side) side.innerHTML = `<a class="logo" href="/app" aria-label="BillPay">${LOGO}</a>
      <button class="srch" data-cmdk aria-label="Поиск и команды">${ic('search')}<span class="t">Поиск и команды</span><span class="kbd">⌘K</span></button>
      <nav class="nv">${nav.map(([k, h, i, l]) => `<a class="ni ${k === active ? 'on' : ''}" href="${h}" title="${l}">${ic(i)}<span class="tx">${l}</span></a>`).join('')}</nav>
      <div class="lbl sl">Валюты</div>
      <div class="nv" style="margin-top:0">${['RUB', 'USD', 'EUR'].map((c) => `<a class="ni cur-l" href="/app#${c}"><span class="cd">${SYM[c]}</span><span class="tx">${c}</span><span class="c" data-count="${c}"></span></a>`).join('')}</div>
      <div class="bot"><div class="h">${ic('send')}Напоминания</div><p data-remwhere>За ${S.remindDaysBefore} дня до срока · ${remWhere()}</p></div>
      <div class="me"><div class="ava">${initials(u.name)}</div><div class="who"><b>${esc(u.name)}</b><small>${isAdmin ? 'Администратор' : 'Пользователь'}</small></div><button class="ibtn sm" data-profile aria-label="Почта для оповещений" title="Почта для оповещений">${ic('mail')}</button><button class="ibtn sm" data-logout aria-label="Выйти" title="Выйти">${ic('logout')}</button></div>`;
    const top = $('#top');
    if (top) top.innerHTML = `<a class="logo" href="/app" aria-label="BillPay">${LOGO}</a><div class="crumb lbl">${crumb}</div>
      <div class="tb">${actions}<button class="ibtn mo" data-cmdk aria-label="Поиск">${ic('search')}</button>${TT()}${mobileActions}<button class="ibtn mo" data-profile aria-label="Почта для оповещений">${ic('mail')}</button><button class="ibtn mo" data-logout aria-label="Выйти">${ic('logout')}</button></div>`;
    document.body.insertAdjacentHTML('beforeend', `<nav class="tabbar" aria-label="Разделы">${nav.map(([k, h, i, l]) => `<a class="tab ${k === active ? 'on' : ''}" href="${h}">${ic(i)}<span>${l}</span></a>`).join('')}</nav>
      <div class="ov" id="ov"><div class="pal" role="dialog" aria-label="Командная палитра"><div class="pin">${ic('search')}<input id="q" placeholder="Команда или название платежа" autocomplete="off"><span class="kbd">esc</span></div><div id="opts"></div><div class="pf"><span>↑↓ выбрать</span><span>↵ выполнить</span><span>esc закрыть</span></div></div></div>
      <div class="toasts" id="toasts" aria-live="polite"></div>
      <div class="sheet-ov" id="prof" aria-hidden="true"><form class="sheet pfs" role="dialog" aria-label="Почта для оповещений" novalidate></form></div>`);
    profile();
  }

  let openProfile = () => {};
  function profile() {
    const ov = $('#prof'), f = $('form', ov);
    const draw = (err = '') => {
      const u = S.currentUser, has = !!u.email;
      f.innerHTML = `<div class="grab"></div><div class="sh-h"><b>Почта для оповещений</b><button class="ibtn sm" type="button" data-pclose aria-label="Закрыть">${ic('x')}</button></div>
        <div class="sh-b"><div class="pf-who"><span class="ava">${initials(u.name)}</span><span><b>${esc(u.name)}</b><small>${u.from_env ? 'главный админ' : '@' + esc(u.login)}</small></span></div>
          <div class="f"><label for="pEmail">Почта <span class="optl">необязательно</span></label><input class="inp" id="pEmail" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="name@company.ru" value="${esc(u.email || '')}" aria-invalid="${!!err}" aria-describedby="pEmailNote">
          <span class="fnote ${err ? 'err' : ''}" id="pEmailNote">${err ? esc(err) : `Напоминания о неоплаченных платежах — за ${S.remindDaysBefore} дня до срока, как в Telegram. Пусто — писем не будет.`}</span></div>
          ${S.email && S.email.enabled ? '' : `<div class="hint">${ic('info')}<span>Отправка писем сейчас выключена: SMTP не настроен в .env. Адрес сохранится и начнёт работать после настройки.</span></div>`}</div>
        <div class="sh-f pfs-f">${has ? '<button class="btn ghost lg" type="button" data-premove>Убрать почту</button>' : ''}<button class="btn lg" type="submit">Сохранить</button></div>`;
    };
    const open = () => { draw(); ov.classList.add('on'); ov.setAttribute('aria-hidden', 'false'); setTimeout(() => $('#pEmail').focus({ preventScroll: true }), 250); };
    const close = () => { ov.classList.remove('on'); ov.setAttribute('aria-hidden', 'true'); };
    const save = async (email) => {
      if (email && !EMAIL_RE.test(email)) { draw('Проверьте адрес: нужен вид name@company.ru'); $('#pEmail').value = email; $('#pEmail').focus(); return; }
      try { S.currentUser = await BillPayApi.updateMe({ email: email || null }); } catch (x) { draw(x.message); $('#pEmail').value = email; return; }
      close(); $$('[data-remwhere]').forEach((n) => (n.innerHTML = `За ${S.remindDaysBefore} дня до срока · ${remWhere()}`));
      $$('[data-remsub]').forEach((n) => (n.innerHTML = remSub(S)));
      document.dispatchEvent(new CustomEvent('billpay:me'));
      toast(email ? `Почта сохранена<small>${esc(email.toLowerCase())}</small>` : 'Почта убрана<small>письма больше не придут</small>');
    };
    document.addEventListener('click', (e) => { if (e.target.closest('[data-profile]')) open(); if (e.target.closest('[data-pclose]') || e.target === ov) close(); if (e.target.closest('[data-premove]')) save(''); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
    f.addEventListener('submit', (e) => { e.preventDefault(); save($('#pEmail').value.trim()); });
    openProfile = open;
  }

  function setTheme(next, x = innerWidth - 40, y = 32) {
    const apply = () => { document.documentElement.dataset.theme = next; try { localStorage.setItem('billpay-theme', next); } catch (e) {} };
    if (!document.startViewTransition || RM) return apply();
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.6,0,.2,1)', pseudoElement: '::view-transition-new(root)' }));
  }
  const toggleTheme = (x, y) => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', x, y);
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-theme-toggle]'); if (t) { const r = t.getBoundingClientRect(); toggleTheme(r.left + r.width / 2, r.top + r.height / 2); } });

  function tween(el, from, to, c, ms = 900) {
    if (RM || from === to) { el.textContent = fmt(to, c); return; }
    const t0 = performance.now();
    const f = (n) => { const k = Math.min(1, (n - t0) / ms), e = 1 - Math.pow(1 - k, 4); el.textContent = fmt(from + (to - from) * e, c); if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }
  function toast(html, undo) {
    const box = $('#toasts'); if (!box) return;
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<span class="tic">${ic('check')}</span><span class="tx">${html}</span>${undo ? '<button type="button">Отменить</button>' : ''}`;
    if (undo) t.querySelector('button').onclick = () => { undo(); close(); };
    box.appendChild(t); requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    const close = () => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); };
    setTimeout(close, 3200);
  }
  function ringBells() { if (RM) return; setInterval(() => $$('.tgc').forEach((c) => { c.classList.remove('ring'); void c.offsetWidth; c.classList.add('ring'); }), 6000); setTimeout(() => $$('.tgc').forEach((c) => c.classList.add('ring')), 900); }

  async function logout() { try { await BillPayApi.logout(); } finally { location.href = '/login'; } }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) logout(); });

  let COMMANDS = () => [];
  function palette() {
    const ov = $('#ov'), q = $('#q'), opts = $('#opts'); let sel = 0, cur = [];
    const isAdmin = S.currentUser.role === 'admin';
    const base = () => [
      { t: 'Перейти: Платежи', m: 'список', ic: 'card', run: () => (location.href = '/app') },
      { t: 'Перейти: Календарь', m: 'месяц', ic: 'cal', run: () => (location.href = '/app/calendar') },
      ...(isAdmin ? [{ t: 'Новый регулярный платёж', m: 'админ', ic: 'plus', run: () => (location.href = '/app/admin#new') }, { t: 'Перейти: Пользователи', m: 'админ', ic: 'users', run: () => (location.href = '/app/admin') }] : []),
      { t: 'Почта для оповещений', m: 'профиль', ic: 'mail', run: () => openProfile() },
      { t: 'Сменить тему', m: 'тёмная / светлая', ic: 'moon', run: () => toggleTheme() },
      { t: 'Открыть лендинг', m: 'о продукте', ic: 'home', run: () => (location.href = '/') },
      { t: 'Выйти', m: S.currentUser.login, ic: 'logout', run: () => logout() }];
    const draw = () => {
      const v = q.value.trim().toLowerCase(); const a = [...COMMANDS(), ...base()].filter((c) => !v || c.t.toLowerCase().includes(v));
      const g1 = a.filter((c) => c.g), g2 = a.filter((c) => !c.g); cur = [...g1, ...g2]; sel = Math.min(sel, Math.max(0, cur.length - 1)); let i = 0;
      const row = (c) => `<div class="po ${i === sel ? 'sel' : ''}" data-i="${i++}">${ic(c.ic)}<span class="t">${esc(c.t)}</span><span class="m">${esc(c.m)}</span></div>`;
      opts.innerHTML = ((g1.length ? `<div class="pgl lbl">Оплата</div>${g1.map(row).join('')}` : '') + (g2.length ? `<div class="pgl lbl">Навигация и действия</div>${g2.map(row).join('')}` : '')) || '<div class="empty">Ничего не найдено</div>';
      const s = $('.po.sel', opts); s && s.scrollIntoView({ block: 'nearest' });
    };
    const open = () => { ov.classList.add('on'); q.value = ''; sel = 0; draw(); setTimeout(() => q.focus(), 30); };
    const close = () => { ov.classList.remove('on'); q.blur(); };
    const run = (c) => { close(); setTimeout(c.run, 180); };
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ov.classList.contains('on') ? close() : open(); return; }
      if (!ov.classList.contains('on')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && cur[sel]) run(cur[sel]);
    });
    q.addEventListener('input', () => { sel = 0; draw(); });
    opts.addEventListener('mousemove', (e) => { const p = e.target.closest('.po'); if (p && +p.dataset.i !== sel) { sel = +p.dataset.i; $$('.po', opts).forEach((x) => x.classList.toggle('sel', +x.dataset.i === sel)); } });
    opts.addEventListener('click', (e) => { const p = e.target.closest('.po'); if (p) run(cur[+p.dataset.i]); });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('click', (e) => { if (e.target.closest('[data-cmdk]')) open(); });
  }

  const remSub = (m) => `за ${m.remindDaysBefore} дня до срока · «${esc(m.telegramChat)}»${mailOn() ? ' · копия на почту' : ''}`;
  const reminderRows = (meta, occ, limit = 3) => meta.reminders.filter((r) => occ.some((x) => x.id === r.occurrence_id)).slice(0, limit).map((r) => {
    const o = occ.find((x) => x.id === r.occurrence_id); if (!o) return '';
    return `<div class="ri"><span class="d">${dm(r.send_date)}</span><span class="nm">${esc(o.name)}<small>${num(o.amount, o.currency)} ${o.currency} · до ${dm(o.due_date)}</small></span><span class="s ${r.status === 'sent' ? 'ok' : ''}">${r.status === 'sent' ? ic('check') + '<span class="st">наступило</span>' : ic('clock') + '<span class="st">' + r.time + '</span>'}</span></div>`;
  }).join('');
  const reminderCard = (meta, occ) => `<div class="tgh"><span class="bi">${ic('bell')}</span><div><b>Напоминания в Telegram</b><small data-remsub>${remSub(meta)}</small></div></div><div class="rl">${reminderRows(meta, occ) || `<div class="rl-e">${ic('bell')}<span>Ближайших напоминаний нет. Они появятся, когда в месяце будут неоплаченные платежи.</span></div>`}</div>`;
  const sideCounts = (occ) => ['RUB', 'USD', 'EUR'].forEach((c) => $$(`[data-count="${c}"]`).forEach((n) => (n.textContent = occ.filter((o) => o.currency === c).length)));
  const todayChip = () => `${ic('cal')}сегодня ${dmy(TODAY)}`;

  async function dashboard() {
    const isAdmin = S.currentUser.role === 'admin';
    shell('payments', `Платежи<i></i><b>${monthName} ${year}</b>`,
      `<a class="btn ghost hide-m" href="${monthUrl('/app', shiftMonth(VM, -1))}#history">${ic('history')}История</a>${isAdmin ? `<a class="btn hide-m" href="/app/admin#new">${ic('plus')}Новый платёж</a>` : ''}`,
      isAdmin ? `<a class="ibtn solid mo" href="/app/admin#new" aria-label="Новый платёж">${ic('plus')}</a>` : '');
    palette();
    $$('#history [data-ic], #sheet [data-ic]').forEach((e) => (e.outerHTML = ic(e.dataset.ic)));

    const CURS = ['RUB', 'USD', 'EUR'];
    const SORTS = { name: 'Название', amount: 'Сумма', due_date: 'Срок', status: 'Статус', paid_at: 'Факт. дата', overdue_days: 'Просрочка' };
    const DEF = { sort: 'due_date', order: 'asc' };
    const firstDir = (k) => (k === 'amount' || k === 'overdue_days' ? 'desc' : 'asc');
    const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
    const P = new URLSearchParams(location.search);
    const F = {
      q: (P.get('q') || '').slice(0, 100),
      status: ST[P.get('status')] ? P.get('status') : 'all',
      cur: new Set((P.get('currency') || '').toUpperCase().split(',').filter((c) => CURS.includes(c))),
      sort: SORTS[P.get('sort')] ? P.get('sort') : DEF.sort,
      order: P.get('order') === 'desc' ? 'desc' : P.get('order') === 'asc' ? 'asc' : SORTS[P.get('sort')] ? 'asc' : DEF.order
    };
    const qv = () => F.q.trim();
    const curList = () => CURS.filter((c) => F.cur.has(c));
    const isDefSort = () => F.sort === DEF.sort && F.order === DEF.order;
    const filterQs = () => {
      const p = new URLSearchParams();
      if (qv()) p.set('q', qv());
      if (F.status !== 'all') p.set('status', F.status);
      if (F.cur.size) p.set('currency', curList().join(','));
      if (!isDefSort()) { p.set('sort', F.sort); p.set('order', F.order); }
      return p;
    };
    const monthLink = (m) => { const p = filterQs(); if (m !== CUR) p.set('month', m); const s = p.toString(); return `/app${s ? '?' + s : ''}#history`; };
    const writeUrl = () => {
      const p = filterQs(); if (VM !== CUR) p.set('month', VM);
      const s = p.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
      navMonths();
    };
    const navMonths = () => {
      $('#mnav').innerHTML = `${IS_CUR ? '' : `<a class="more cur-m" href="${monthLink(CUR)}">Текущий</a>`}<a class="ibtn sm" href="${monthLink(shiftMonth(VM, -1))}" aria-label="Предыдущий месяц: ${mName(shiftMonth(VM, -1))}" title="${mName(shiftMonth(VM, -1))}">${ic('back')}</a><span class="mlabel">${monthName} ${year}</span><a class="ibtn sm" href="${monthLink(shiftMonth(VM, 1))}" aria-label="Следующий месяц: ${mName(shiftMonth(VM, 1))}" title="${mName(shiftMonth(VM, 1))}">${ic('chev')}</a>`;
    };
    const params = () => ({ q: qv(), status: F.status === 'all' ? '' : F.status, currency: curList().join(','), sort: F.sort, order: F.order });

    const [meta, occ, first] = await Promise.all([BillPayApi.getMeta(), BillPayApi.getOccurrences(), BillPayApi.listOccurrences(params())]);
    let PAGE = first, SEQ = 0;
    sideCounts(occ); setHead(); navMonths();
    $('#today').innerHTML = todayChip();

    $('#cards').innerHTML = ['RUB', 'USD', 'EUR'].map((c, i) => `<section class="card cur rise" style="--d:${i * 60}ms" id="${c}"><div class="ch"><span class="sym">${SYM[c]}</span><div><b>${c}</b><small>${CN[c]}</small></div></div>
      <div class="big" data-c="${c}" data-k="to_pay">${fmt(0, c)}</div><div class="sub">к оплате в ${monthIn}</div>
      <div class="split"><div class="ok"><span>Оплачено</span><b data-c="${c}" data-k="paid">${fmt(0, c)}</b></div><div data-odw="${c}"><span>Просрочено</span><b data-c="${c}" data-k="overdue">${fmt(0, c)}</b></div></div>
      <div class="bud"><div class="l"><span data-blt="${c}">Оплачено за месяц</span><b data-bl="${c}"></b></div><div class="track"><i data-bar="${c}"></i></div></div></section>`).join('') +
      `<section class="card tgc rise" style="--d:180ms">${reminderCard(meta, occ)}</section>`;
    $('#tg-m').innerHTML = reminderCard(meta, occ);

    const W = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], month = VM, dim = new Date(+year, +VM.slice(5, 7), 0).getDate();
    let html = '';
    for (let d = 1; d <= dim; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`, w = (new Date(iso).getDay() + 6) % 7;
      const o = occ.find((x) => x.due_date === iso), rem = meta.reminders.find((r) => r.send_date === iso), ro = rem && occ.find((x) => x.id === rem.occurrence_id);
      html += `<div class="dy ${w >= 5 ? 'we' : ''} ${iso === TODAY ? 'td' : ''}"><span class="w">${W[w]}</span><span class="n">${d}</span><span class="slot">${o ? `<span class="dt ${status(o)}" data-dot="${o.id}"></span>` : ro ? ic('bell') : ''}</span>${o || ro ? `<div class="tip">${o ? `<b>${esc(o.name)}</b><span>${fmt(o.amount, o.currency)} · <em data-tst="${o.id}" style="font-style:normal">${ST[status(o)].toLowerCase()}</em></span>` : ''}${ro ? `<span>напоминание: ${esc(ro.name)}</span>` : ''}</div>` : ''}</div>`;
    }
    $('#days').innerHTML = html;
    const td = $('.dy.td'); if (td && innerWidth <= 900) $('#days').scrollLeft = td.offsetLeft - 64;

    const tabs = $('#tabs'), hist = $('#history');
    const hl = (text) => {
      const q = qv(); if (!q) return esc(text);
      const lo = text.toLowerCase(), ql = q.toLowerCase(); let i = 0, out = '', j;
      while ((j = lo.indexOf(ql, i)) !== -1) { out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>'; i = j + q.length; }
      return out + esc(text.slice(i));
    };
    let PICK = null, EDIT = null;
    const editing = (o) => PICK === o.id || EDIT === o.id;
    const fact = (o) => {
      if (editing(o)) {
        const val = PICK === o.id ? TODAY : o.paid_at;
        return `<span class="fd"><span class="lb">Факт</span><input class="fdt" type="date" max="${TODAY}" value="${val}" data-date="${o.id}" aria-label="Фактическая дата оплаты"></span>`;
      }
      if (o.paid_at) return `<span class="fd"><span class="lb">Факт</span><button type="button" class="fdb" data-fix="${o.id}" title="Исправить дату">${dmy(o.paid_at)}</button></span>`;
      return `<span class="fd m"><span class="lb">Факт</span>—</span>`;
    };
    const inner = (o) => { const s = status(o), l = late(o); return `<span class="nm">${hl(o.name)}<small>ежемесячно</small></span><span class="amt">${num(o.amount, o.currency)}<span class="cc">${o.currency}</span></span><span class="due"><span class="lb">Срок</span>${dmy(o.due_date)}</span><span class="stc"><span class="pill ${s}"><i></i>${ST[s]}</span></span>${fact(o)}<span class="lt ${l ? 'late' : 'm'}"><span class="lb">Просрочка</span>${l ? l + '\u00a0дн.' : '—'}</span><span class="ac">${editing(o) ? `<button class="mp" data-save="${o.id}" title="Сохранить дату"><span class="ck">${CHK}</span><span class="tx">Сохранить</span></button>` : s === 'paid' ? `<button class="un" data-un="${o.id}" title="Снять отметку">${ic('undo')}<span class="tx">Снять отметку</span></button>` : `<button class="mp" data-pay="${o.id}" title="Отметить оплату"><span class="ck">${CHK}</span><span class="tx">Отметить оплату</span></button>`}</span>`; };
    const row = (o, i, mode) => `<div class="grid rw ${mode ? 'rise' : ''}" id="r-${o.id}" style="--d:${(mode === 'load' ? 240 : 0) + Math.min(i, 12) * 26}ms">${inner(o)}</div>`;
    const head = () => {
      $('#ghead').innerHTML = [['name'], ['amount', 'r'], ['due_date'], ['status'], ['paid_at'], ['overdue_days', 'r']].map(([k, r]) => {
        const on = F.sort === k;
        return `<button type="button" class="hs ${r ? 'r' : ''} ${on ? 'on' : ''}" data-sort="${k}" aria-sort="${on ? (F.order === 'asc' ? 'ascending' : 'descending') : 'none'}" title="${k === 'amount' ? 'Сортировка внутри каждой валюты' : 'Сортировать'}"><span>${SORTS[k]}</span><span class="ar">${on ? ic(F.order === 'asc' ? 'up' : 'dn') : ic('sort')}</span></button>`;
      }).join('') + '<span></span>';
    };
    const controls = () => {
      const c = PAGE.counts;
      $$('.chip', tabs).forEach((b) => { const on = b.dataset.f === F.status; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); $('em', b).textContent = c[b.dataset.f]; });
      const inp = $('#pq'); if (document.activeElement !== inp && inp.value !== F.q) inp.value = F.q;
      $('#pqclear').hidden = !F.q; $('#psearch').classList.toggle('has', !!F.q);
      $('#curVal').textContent = F.cur.size ? curList().join(', ') : 'все';
      $('[data-dd=cur]').classList.toggle('set', F.cur.size > 0);
      $('#curOpts').innerHTML = CURS.map((k) => `<button type="button" class="opt ${F.cur.has(k) ? 'on' : ''}" data-cur="${k}" role="menuitemcheckbox" aria-checked="${F.cur.has(k)}"><span class="cb">${CHK}</span><span class="cd">${SYM[k]}</span>${k}<em>${occ.filter((o) => o.currency === k).length}</em></button>`).join('');
      $('#resetL').hidden = !(qv() || F.cur.size || F.status !== 'all' || !isDefSort());
      const nf = (F.cur.size ? 1 : 0) + (F.status !== 'all' ? 1 : 0) + (isDefSort() ? 0 : 1);
      $('#fcount').hidden = !nf; $('#fcount').textContent = nf;
      const n = PAGE.count, all = PAGE.total;
      $('#psum').innerHTML = `<div class="cnt"><b>${n === all ? n : `${n} из ${all}`}</b><span>${plural(n, 'платёж', 'платежа', 'платежей')}${n === all ? ' в периоде' : ' найдено'}</span></div>
        <div class="tots">${PAGE.totals.map((t) => `<div class="tot ${t.count ? '' : 'z'}"><span class="cd">${SYM[t.currency]}</span><div><b>${t.count ? fmt(t.total, t.currency) : '—'}</b><small>${t.count ? [t.to_pay ? `к оплате ${fmt(t.to_pay, t.currency)}` : '', t.overdue ? `<i class="od">просрочено ${fmt(t.overdue, t.currency)}</i>` : '', t.paid ? `оплачено ${fmt(t.paid, t.currency)}` : ''].filter(Boolean).join(' · ') : `нет платежей в ${t.currency}`}</small></div></div>`).join('')}</div>
        <span class="sum-n" title="Итоги считаются отдельно по каждой валюте">без конвертации</span>`;
      head(); sheet();
    };
    const rows = (mode) => {
      const list = PAGE.items;
      hist.classList.toggle('is-empty', !list.length);
      hist.classList.toggle('no-data', !PAGE.total);
      if (!PAGE.total) {
        $('#rows').innerHTML = !IS_CUR ? emptyCta('history', `В ${monthIn} ${year} периодов нет`, 'Периоды появляются для каждого активного регулярного платежа начиная с месяца первой оплаты.', `<a class="btn ghost" href="/app">${ic('back')}К текущему месяцу</a>`)
          : isAdmin ? emptyCta('card', 'Платежей пока нет', `Добавьте первый регулярный платёж: BillPay будет создавать период каждый месяц и напоминать за ${S.remindDaysBefore} дня до срока.`, `<a class="btn" href="/app/admin#new">${ic('plus')}Добавить первый платёж</a>`)
          : emptyCta('card', 'Платежей пока нет', 'Администратор ещё не добавил регулярные платежи. Как только он это сделает, они появятся здесь.');
      } else if (!list.length) {
        $('#rows').innerHTML = emptyCta('search', 'Ничего не найдено', `${qv() ? `По запросу «${esc(qv())}»` : 'По выбранным фильтрам'} в ${monthIn} ${year} нет платежей. Измените запрос или сбросьте фильтры.`, `<button class="btn" type="button" data-reset>${ic('undo')}Сбросить фильтры</button>`);
      } else if (F.sort === 'amount') {
        let i = 0;
        $('#rows').innerHTML = PAGE.totals.filter((t) => t.count).map((t) => `<div class="grp"><span class="cd">${SYM[t.currency]}</span><b>${t.currency}</b><span>${t.count} ${plural(t.count, 'платёж', 'платежа', 'платежей')} · ${fmt(t.total, t.currency)}</span></div>` + list.filter((o) => o.currency === t.currency).map((o) => row(o, i++, mode)).join('')).join('');
      } else {
        $('#rows').innerHTML = list.map((o, i) => row(o, i, mode)).join('');
      }
    };
    const render = (mode) => { controls(); rows(mode); };
    async function load(mode = 'filter', quiet = false) {
      const my = ++SEQ;
      let p; try { p = await BillPayApi.listOccurrences(params()); } catch (e) { toast(esc(e.message)); return; }
      if (my !== SEQ) return;
      const ids = (x) => x.items.map((o) => o.id).join(',');
      const moved = ids(p) !== ids(PAGE);
      PAGE = p; controls();
      if (!quiet) rows(mode);
      else if (moved) setTimeout(() => { if (my === SEQ && !PICK && !EDIT) rows(); }, 650);
    }
    let DEB = 0;
    const apply = (mode = 'filter') => { clearTimeout(DEB); PICK = null; EDIT = null; writeUrl(); controls(); load(mode); };

    const find = (id) => PAGE.items.find((x) => x.id === id) || occ.find((x) => x.id === id);
    const setLocal = (id, paidAt) => [PAGE.items, occ].forEach((l) => l.forEach((x) => { if (x.id === id) { x.paid_at = paidAt; x.is_paid = !!paidAt; x.status = status(x); x.overdue_days = late(x); } }));
    const refresh = async (first) => {
      const sum = await BillPayApi.getSummary();
      sum.forEach((s) => {
        ['to_pay', 'paid', 'overdue'].forEach((k) => { const n = $(`[data-c="${s.currency}"][data-k="${k}"]`); const from = +(n.dataset.v || 0); n.dataset.v = s[k]; tween(n, from, s[k], s.currency, first ? 1100 : 700); });
        $(`[data-odw="${s.currency}"]`).className = s.overdue ? 'od' : 'z';
        const b = (meta.budgets && meta.budgets[s.currency]) || 0, base = b || s.total;
        $(`[data-blt="${s.currency}"]`).textContent = b ? 'Бюджет месяца' : 'Оплачено за месяц';
        $(`[data-bar="${s.currency}"]`).style.width = (base ? Math.max(2, Math.min(100, (s.paid / base) * 100)) : 0) + '%';
        $(`[data-bl="${s.currency}"]`).textContent = base ? `${fmt(s.paid, s.currency)} / ${fmt(base, s.currency)}` : 'нет платежей';
      });
      occ.forEach((o) => { const d = $(`[data-dot="${o.id}"]`); if (d) d.className = 'dt ' + status(o); const t = $(`[data-tst="${o.id}"]`); if (t) t.textContent = ST[status(o)].toLowerCase(); });
    };
    const paint = (o) => { const r = $('#r-' + o.id); if (!r) return; r.classList.remove('rise'); r.innerHTML = inner(o); $$('.pill,.fd,.lt,.ac', r).forEach((e) => e.classList.add('swap')); };
    const focusDate = (id) => { const inp = $(`[data-date="${id}"]`); if (inp) { inp.focus(); inp.closest('.rw').scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' }); } };
    async function reveal(id) {
      if ($('#r-' + id)) return;
      Object.assign(F, { q: '', status: 'all', sort: DEF.sort, order: DEF.order }); F.cur.clear();
      writeUrl(); await load('filter');
    }
    async function askDate(id) {
      const o = find(id); if (!o || o.paid_at) return;
      await reveal(id);
      PICK = id; EDIT = null; paint(find(id)); focusDate(id);
    }
    function openDate(id) {
      const o = find(id); if (!o || !o.paid_at) return;
      EDIT = id; PICK = null; paint(o); focusDate(id);
    }
    async function commitDate(id, date) {
      const o = find(id); if (!o) return;
      if (!date) return toast('Укажите фактическую дату');
      if (date > TODAY) return toast('Дата не может быть в будущем');
      const fresh = !o.paid_at;
      if (o.paid_at && date === o.paid_at) { PICK = null; EDIT = null; paint(o); return; }
      try { const u = await BillPayApi.setPaid(id, date); setLocal(id, u.paid_at || date); }
      catch (e) { return toast(esc(e.message)); }
      PICK = null; EDIT = null; paint(o);
      const r = $('#r-' + id); if (r && fresh) r.classList.add('flash');
      refresh(); load('filter', true);
      toast(fresh ? `${esc(o.name)} — оплачено<small>${dmy(o.paid_at)}</small>` : `${esc(o.name)} — дата ${dmy(o.paid_at)}`, fresh ? () => unpay(id) : undefined);
    }
    async function unpay(id) {
      const o = find(id); if (!o) return;
      try { await BillPayApi.setPaid(id, null); } catch (e) { return toast(esc(e.message)); }
      setLocal(id, null); if (PICK === id) PICK = null; if (EDIT === id) EDIT = null;
      paint(o); refresh(); load('filter', true);
    }

    const sh = $('#sheet');
    function sheet() {
      const c = PAGE.counts;
      $('#shStatus').innerHTML = [['all', 'Все'], ['unpaid', 'Не оплачено'], ['overdue', 'Просрочено'], ['paid', 'Оплачено']].map(([k, l]) => `<button type="button" class="chip ${F.status === k ? 'on' : ''}" data-f="${k}" aria-pressed="${F.status === k}">${l}<em>${c[k]}</em></button>`).join('');
      $('#shCur').innerHTML = CURS.map((k) => `<button type="button" class="chip ${F.cur.has(k) ? 'on' : ''}" data-cur="${k}" aria-pressed="${F.cur.has(k)}">${SYM[k]} ${k}</button>`).join('');
      $('#shSort').innerHTML = Object.entries(SORTS).map(([k, l]) => `<button type="button" class="srow ${F.sort === k ? 'on' : ''}" data-sk="${k}" data-sd="${F.sort === k ? (F.order === 'asc' ? 'desc' : 'asc') : firstDir(k)}"><span class="rb"></span>${l}<span class="sd">${F.sort === k ? (F.order === 'asc' ? ic('up') + 'по возрастанию' : ic('dn') + 'по убыванию') : ''}</span></button>`).join('');
      const n = PAGE.count; $('#shApply').textContent = n ? `Показать ${n} ${plural(n, 'платёж', 'платежа', 'платежей')}` : 'Ничего не найдено';
    }
    const openSheet = () => { sh.classList.add('on'); sh.setAttribute('aria-hidden', 'false'); };
    const closeSheet = () => { sh.classList.remove('on'); sh.setAttribute('aria-hidden', 'true'); };
    const closeDd = () => $$('.dd.open').forEach((d) => { d.classList.remove('open'); $('[data-dd]', d).setAttribute('aria-expanded', 'false'); });
    const resetAll = () => { Object.assign(F, { q: '', status: 'all', sort: DEF.sort, order: DEF.order }); F.cur.clear(); $('#pq').value = ''; apply(); };

    $('#pq').addEventListener('input', (e) => {
      F.q = e.target.value.slice(0, 100);
      $('#pqclear').hidden = !F.q; $('#psearch').classList.toggle('has', !!F.q);
      clearTimeout(DEB); DEB = setTimeout(() => apply(), 250);
    });
    $('#pqclear').addEventListener('click', () => { F.q = ''; $('#pq').value = ''; apply(); $('#pq').focus(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || $('#ov').classList.contains('on')) return;
      if (document.activeElement === $('#pq') && F.q) { F.q = ''; $('#pq').value = ''; apply(); return; }
      closeDd(); closeSheet();
    });
    const onFilters = (e) => {
      const t = e.target;
      const tab = t.closest('[data-f]'); if (tab) { F.status = tab.dataset.f; apply(); return true; }
      const c = t.closest('[data-cur]'); if (c) { F.cur.has(c.dataset.cur) ? F.cur.delete(c.dataset.cur) : F.cur.add(c.dataset.cur); apply(); return true; }
      const sk = t.closest('[data-sk]'); if (sk) { F.sort = sk.dataset.sk; F.order = sk.dataset.sd; apply(); return true; }
      if (t.closest('[data-reset]')) { resetAll(); return true; }
      return false;
    };
    document.addEventListener('click', (e) => {
      const t = e.target;
      const dd = t.closest('[data-dd]');
      if (dd) { const box = dd.parentElement, was = box.classList.contains('open'); closeDd(); box.classList.toggle('open', !was); dd.setAttribute('aria-expanded', !was); return; }
      if (!e.composedPath().some((n) => n.classList && n.classList.contains('pop'))) closeDd();
      if (t.closest('[data-sheet]')) { openSheet(); return; }
      if (t.closest('[data-close-sheet]') || t === sh) { closeSheet(); return; }
    });
    hist.addEventListener('click', (e) => {
      if (onFilters(e)) return;
      const hs = e.target.closest('[data-sort]');
      if (hs) { const k = hs.dataset.sort; if (F.sort === k) F.order = F.order === 'asc' ? 'desc' : 'asc'; else { F.sort = k; F.order = firstDir(k); } apply(); }
    });
    sh.addEventListener('click', onFilters);
    const bar = $('#bar'); addEventListener('scroll', () => bar.classList.toggle('stuck', innerWidth <= 900 && bar.getBoundingClientRect().top <= 61), { passive: true });

    $('#rows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pay]'); if (b) return askDate(+b.dataset.pay);
      const fix = e.target.closest('[data-fix]'); if (fix) return openDate(+fix.dataset.fix);
      const s = e.target.closest('[data-save]'); if (s) { const inp = $(`[data-date="${s.dataset.save}"]`); return commitDate(+s.dataset.save, inp ? inp.value : TODAY); }
      const u = e.target.closest('[data-un]'); if (u) unpay(+u.dataset.un);
    });
    $('#rows').addEventListener('keydown', (e) => {
      const inp = e.target.closest('[data-date]'); if (!inp || e.key !== 'Enter') return;
      e.preventDefault();
      commitDate(+inp.dataset.date, inp.value);
    });
    COMMANDS = () => occ.filter((o) => !o.paid_at).map((o) => ({ g: 1, t: `Отметить оплату — ${o.name}`, m: `${fmt(o.amount, o.currency)} · ${dm(o.due_date)}`, ic: 'check', run: () => askDate(o.id) }));
    writeUrl(); render('load'); ringBells();
    setTimeout(() => refresh(true), RM ? 0 : 200);
  }

  async function calendar() {
    shell('calendar', `Календарь<i></i><b>${monthName} ${year}</b>`, `<a class="btn ghost hide-m" href="${monthUrl('/app', VM)}">${ic('list')}Список</a>`);
    palette();
    const [meta, occ] = await Promise.all([BillPayApi.getMeta(), BillPayApi.getOccurrences()]); sideCounts(occ); setHead();
    $('#today').innerHTML = todayChip();
    const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
    const pays = (n) => `${n} ${plural(n, 'платёж', 'платежа', 'платежей')}`;
    const CURS = ['RUB', 'USD', 'EUR'];
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d)) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
    const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const longDate = (d) => `${+d.slice(8)} ${MONTHS_G[+d.slice(5, 7) - 1]}`;
    const mLabel = (m, ref) => MONTHS[+m.slice(5, 7) - 1].toLowerCase() + (m.slice(0, 4) !== ref.slice(0, 4) ? ' ' + m.slice(0, 4) : '');
    const y = +year, m = +VM.slice(5, 7), first = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate(), prev = new Date(y, m - 1, 0).getDate();

    const qd = new URLSearchParams(location.search).get('date');
    let SEL = isDate(qd) && qd.slice(0, 7) === VM ? qd : IS_CUR ? TODAY : `${VM}-01`;
    const calUrl = (d) => { const p = new URLSearchParams(); if (d.slice(0, 7) !== CUR) p.set('month', d.slice(0, 7)); if (d !== TODAY) p.set('date', d); const s = p.toString(); return '/app/calendar' + (s ? '?' + s : ''); };
    const go = (d) => { if (d.slice(0, 7) !== VM) { location.href = calUrl(d); return; } select(d); };

    function grid() {
      let cells = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => `<div class="wd lbl">${w}</div>`).join('');
      const total = Math.ceil((first + dim) / 7) * 7;
      for (let i = 0; i < total; i++) {
        const d = i - first + 1, inM = d >= 1 && d <= dim, iso = inM ? `${VM}-${String(d).padStart(2, '0')}` : '';
        const label = inM ? d : d < 1 ? prev + d : d - dim;
        const os = inM ? occ.filter((o) => o.due_date === iso) : [], rems = inM ? meta.reminders.filter((r) => r.send_date === iso) : [];
        const cls = ['mc', inM ? 'pick' : 'out', iso === TODAY ? 'td' : '', iso === SEL ? 'sel' : '', i % 7 >= 5 ? 'we' : '', i >= total - 7 ? 'lr' : ''].join(' ');
        const attrs = inM ? `data-day="${iso}" role="button" tabindex="${iso === SEL ? 0 : -1}" aria-pressed="${iso === SEL}" aria-label="${longDate(iso)}: ${os.length ? pays(os.length) : 'сроков нет'}"` : 'aria-hidden="true"';
        cells += `<div class="${cls}" ${attrs}><span class="n">${label}</span><div class="evs">${os.map((o) => { const sh = o.day && o.day > +o.due_date.slice(8); return `<div class="ev ${status(o)}" title="${esc(o.name)} · ${ST[status(o)]}${sh ? ` · по графику ${o.day}-е → последний день месяца` : ''}"><i></i><b>${esc(o.name)}</b><span>${fmt(o.amount, o.currency)}${sh ? ` · <em class="sh">${o.day}→${+o.due_date.slice(8)}</em>` : ''}</span></div>`; }).join('')}</div>${rems.map((r) => { const ro = occ.find((o) => o.id === r.occurrence_id); return ro ? `<div class="remc" title="Напоминание: ${esc(ro.name)}">${ic('bell')}<span>${esc(ro.name)}</span></div>` : ''; }).join('')}</div>`;
      }
      $('#month').innerHTML = `<div class="mhead"><span class="h3">${monthName} ${year}</span>${IS_CUR ? '' : `<a class="btn ghost sm" href="/app/calendar">Сегодня</a>`}<a class="ibtn sm" href="${monthUrl('/app/calendar', shiftMonth(VM, -1))}" aria-label="Предыдущий месяц" title="${mName(shiftMonth(VM, -1))}">${ic('back')}</a><a class="ibtn sm" href="${monthUrl('/app/calendar', shiftMonth(VM, 1))}" aria-label="Следующий месяц" title="${mName(shiftMonth(VM, 1))}">${ic('chev')}</a></div>
        <div class="mgrid" role="grid" aria-label="${monthName} ${year}">${cells}</div>
        <div class="cleg"><span><i class="paid"></i>оплачено</span><span><i class="unpaid"></i>не оплачено</span><span><i class="overdue"></i>просрочено</span><span>${ic('bell')}напоминание в Telegram</span><span class="chint">Нажмите на день — платежи и итоги на эту дату</span></div>`;
    }

    function day() {
      const os = occ.filter((o) => o.due_date === SEL), rems = meta.reminders.filter((r) => r.send_date === SEL);
      const dd = days(SEL, TODAY), rel = dd === 0 ? 'сегодня' : dd === 1 ? 'завтра' : dd === -1 ? 'вчера' : '';
      const item = (o) => {
        const s = status(o), l = late(o), sh = o.day && o.day > +o.due_date.slice(8), until = days(o.due_date, TODAY);
        const sub = s === 'paid' ? `оплачено ${dm(o.paid_at)}${l ? ` · просрочка ${l}\u00a0дн.` : ''}` : s === 'overdue' ? `просрочка ${l}\u00a0дн.` : until === 0 ? 'срок сегодня' : until === 1 ? 'срок завтра' : `через ${until}\u00a0дн.`;
        return `<div class="ri dri"><span class="cd">${SYM[o.currency]}</span><span class="nm">${esc(o.name)}<small><b class="am">${fmt(o.amount, o.currency)}</b> · ${sub}</small>${sh ? `<small class="shn">${ic('info')}по графику ${o.day}-е — в ${monthIn} ${dim} дней, срок в последний день месяца</small>` : ''}</span><span class="pill ${s}"><i></i>${ST[s]}</span></div>`;
      };
      const sums = CURS.filter((c) => os.some((o) => o.currency === c)).map((c) => `<span><em>${c}</em>${fmt(os.filter((o) => o.currency === c).reduce((a, o) => a + o.amount, 0), c)}</span>`).join('');
      $('#day').innerHTML = `<div class="th dh"><div><span class="lbl">${WD[new Date(SEL + 'T00:00:00Z').getUTCDay()]}${rel ? ' · ' + rel : ''}</span><span class="h3">${longDate(SEL)}</span></div><div class="dnav"><button class="ibtn sm" type="button" data-dstep="-1" aria-label="Предыдущий день">${ic('back')}</button><button class="ibtn sm" type="button" data-dstep="1" aria-label="Следующий день">${ic('chev')}</button></div></div>
        <div class="ulst">${os.length ? os.map(item).join('') : `<div class="dempty">${ic('cal')}<span>В этот день сроков оплаты нет</span></div>`}
        ${rems.map((r) => { const ro = occ.find((o) => o.id === r.occurrence_id); return ro ? `<div class="drem">${ic('bell')}<span>Напоминание в Telegram: <b>${esc(ro.name)}</b> — срок ${dm(ro.due_date)}</span></div>` : ''; }).join('')}</div>
        ${os.length ? `<div class="dsum">${sums}<small>срок ${dm(SEL)} · без конвертации</small></div>` : ''}`;
    }

    let SEQ = 0;
    async function ondate() {
      const my = ++SEQ, d = SEL;
      let r; try { r = await BillPayApi.getSummaryOnDate(d); } catch (e) { toast(esc(e.message)); return; }
      if (my !== SEQ) return;
      const mi = +d.slice(5, 7) - 1, ml = MONTHS[mi].toLowerCase();
      const pct = (a, t) => { const s = t.paid + t.to_pay + t.overdue; return s ? (a / s) * 100 : 0; };
      const line = (cls, label, a, n, t, extra = '') => `<div class="ol ${cls} ${n ? '' : 'z'}"><i></i><span class="k">${label}${extra}</span><span class="c">${n}</span><b>${n ? fmt(a, t.currency) : '—'}</b></div>`;
      const od = r.items.filter((o) => o.on_date.bucket === 'overdue').sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
      const note = d === TODAY ? '' : d > TODAY ? `<div class="onote">${ic('info')}<span>Дата в будущем: учтены только уже отмеченные оплаты. Неоплаченное со сроком раньше ${dmy(d)} показано как просроченное на эту дату, если его не оплатить.</span></div>`
        : `<div class="onote">${ic('history')}<span>Прошедшая дата: оплаты с фактической датой позже ${dmy(d)} на этот день ещё не учитываются.</span></div>`;
      $('#ondate').innerHTML = `<div class="th oh"><span class="h3">Итоги на дату</span>
          <div class="otools">${d === TODAY ? '' : `<a class="more" href="${calUrl(TODAY)}">Сегодня</a>`}
            <label class="dpick" title="Выбрать дату">${ic('cal')}<span class="dv">${dmy(d)}</span>${ic('down')}<input type="date" id="dateIn" value="${d}" aria-label="Дата для итогов"></label></div></div>
        <p class="osub">На конец дня <b>${dmy(d)}</b>${d === TODAY ? ' (сегодня)' : ''}: оплачено и к оплате — периоды ${MONTHS_G[mi]} ${d.slice(0, 4)}, просрочено — все неоплаченные к этой дате периоды со сроком раньше, включая прошлые месяцы. Отдельно по каждой валюте, без конвертации.</p>
        <div class="otots">${r.totals.map((t) => `<div class="otot ${t.count ? '' : 'zz'}">
            <div class="oth"><span class="cd">${SYM[t.currency]}</span><b>${t.currency}</b><small>${pays(t.count)}</small></div>
            <div class="obar" aria-hidden="true"><i class="paid" style="width:${pct(t.paid, t)}%"></i><i class="unpaid" style="width:${pct(t.to_pay, t)}%"></i><i class="overdue" style="width:${pct(t.overdue, t)}%"></i></div>
            ${line('paid', 'Оплачено', t.paid, t.paid_count, t)}${line('unpaid', 'К оплате', t.to_pay, t.to_pay_count, t)}${line('overdue', 'Просрочено', t.overdue, t.overdue_count, t)}
            ${t.overdue_earlier_count ? `<div class="oear">в т. ч. прошлые месяцы: ${fmt(t.overdue_earlier, t.currency)} · ${t.overdue_earlier_count}</div>` : ''}
            <div class="ofoot"><span>Всего за ${ml}</span><b>${t.month_count ? fmt(t.month_total, t.currency) : '—'}</b></div>
          </div>`).join('')}</div>
        ${od.length ? `<div class="odl"><div class="lbl odl-h">Просрочено на ${dmy(d)} · ${pays(od.length)}</div>${od.map((o) => `<div class="ri"><span class="d">${dm(o.due_date)}</span><span class="nm">${esc(o.name)}${o.month !== d.slice(0, 7) ? `<em class="mtag">${mLabel(o.month, d)}</em>` : ''}<small>${fmt(o.amount, o.currency)} · просрочка ${o.on_date.overdue_days}\u00a0дн.${o.paid_at ? ` · оплачено ${dm(o.paid_at)}` : ''}</small></span><span class="pill overdue"><i></i>${ST.overdue}</span></div>`).join('')}</div>` : ''}
        ${note}
        <div class="ohelp"><div><b><i class="paid"></i>Оплачено</b><span>периоды месяца даты с фактической датой оплаты не позже неё</span></div><div><b><i class="unpaid"></i>К оплате</b><span>периоды месяца даты со сроком в эту дату или позже, не оплаченные к ней</span></div><div><b><i class="overdue"></i>Просрочено</b><span>все периоды со сроком раньше даты, не оплаченные к ней, включая прошлые месяцы — со следующего дня после срока</span></div></div>`;
    }

    const select = (d) => {
      SEL = d; grid(); day(); ondate();
      const p = new URLSearchParams(location.search); if (d !== TODAY) p.set('date', d); else p.delete('date');
      const s = p.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
    };
    $('#month').addEventListener('click', (e) => { const c = e.target.closest('[data-day]'); if (!c) return; select(c.dataset.day); const n = $(`[data-day="${SEL}"]`); if (n) n.focus({ preventScroll: true }); if (innerWidth <= 900) $('#day').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' }); });
    $('#month').addEventListener('keydown', (e) => {
      const c = e.target.closest('[data-day]'); if (!c) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step) { e.preventDefault(); go(addD(SEL, step)); const n = $(`[data-day="${SEL}"]`); if (n) n.focus(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.dataset.day); const n = $(`[data-day="${SEL}"]`); if (n) n.focus(); }
    });
    $('#day').addEventListener('click', (e) => { const b = e.target.closest('[data-dstep]'); if (b) go(addD(SEL, +b.dataset.dstep)); });
    $('#ondate').addEventListener('click', (e) => { const dp = e.target.closest('.dpick'); if (dp && e.target.tagName !== 'INPUT') { try { $('input', dp).showPicker(); } catch (x) {} } });
    $('#ondate').addEventListener('change', (e) => { if (e.target.id === 'dateIn' && isDate(e.target.value)) go(e.target.value); });

    select(SEL);
    const upcoming = occ.filter((o) => !o.paid_at).sort((a, b) => a.due_date.localeCompare(b.due_date));
    $('#upcoming').innerHTML = `<div class="th"><span class="h3">Ближайшие и просроченные</span></div><div class="ulst">${upcoming.length ? '' : occ.length ? emptyCta('check', 'Всё оплачено', `В ${monthIn} неоплаченных платежей нет.`) : S.currentUser.role === 'admin' ? emptyCta('cal', 'Платежей пока нет', 'Добавьте первый регулярный платёж — сроки появятся в календаре.', `<a class="btn" href="/app/admin#new">${ic('plus')}Добавить платёж</a>`) : emptyCta('cal', 'Платежей пока нет', 'Сроки появятся здесь, когда администратор добавит платежи.')}${upcoming.map((o) => { const s = status(o), l = late(o); return `<div class="ri"><span class="d">${dm(o.due_date)}</span><span class="nm">${esc(o.name)}<small>${fmt(o.amount, o.currency)}${l ? ` · просрочка ${l}\u00a0дн.` : ''}</small></span><span class="pill ${s}"><i></i>${ST[s]}</span></div>`; }).join('')}</div>`;
    $('#cal-tg').innerHTML = reminderCard(meta, occ);
    ringBells();
  }

  async function admin() {
    shell(location.hash === '#settings' ? 'settings' : 'users', 'Администрирование<i></i><b>Команда</b>', `<a class="btn hide-m" href="#new">${ic('plus')}Новый платёж</a>`, `<a class="ibtn solid mo" href="#new" aria-label="Новый платёж">${ic('plus')}</a>`);
    palette();
    const [meta, occ] = await Promise.all([BillPayApi.getMeta(), BillPayApi.getOccurrences()]); sideCounts(occ);
    const ME = S.currentUser;
    const uf = $('#userForm'), U = (n) => $(`[name=${n}]`, uf); let EDIT = null, USERS = [], SILENT = false;
    const EMAIL_NOTE = $('#uEmailHint').textContent;
    const emailNote = (err = '') => { const n = $('#uEmailHint'); n.textContent = err || EMAIL_NOTE; n.classList.toggle('err', !!err); U('email').setAttribute('aria-invalid', !!err); };
    uf.addEventListener('input', (e) => { if (e.target === U('email') && U('email').getAttribute('aria-invalid') === 'true') emailNote(); });
    const draw = async () => {
      const users = USERS = await BillPayApi.getUsers();
      $('#ucount').textContent = users.length;
      $('#users').innerHTML = users.map((u, i) => `<div class="ug ur rise" style="--d:${i * 30}ms"><span class="un2"><span class="ava ${u.from_env ? '' : 'n'}">${initials(u.name)}</span><span class="t"><b>${esc(u.name)}</b><small>${u.from_env ? 'главный админ' : '@' + esc(u.login)}</small></span></span><span class="ec ul2 ${u.email ? '' : 'none'}" title="${esc(u.email || '')}">${u.email ? ic('mail') + '<span>' + esc(u.email) + '</span>' : 'не указана'}</span><span class="rc"><span class="role ${u.role}">${u.role === 'admin' ? 'Администратор' : 'Пользователь'}</span></span><span class="dc ul2" style="display:block">${dmy(u.created_at)}</span><span class="ia">${u.from_env ? `<span class="lock">${ic('lock')}Защищён</span>` : `<button class="ibtn sm" data-edit="${u.id}" aria-label="Изменить" title="Изменить">${ic('edit')}</button>${u.id === ME.id ? '' : `<button class="ibtn sm del" data-del="${u.id}" aria-label="Удалить" title="Удалить">${ic('trash')}</button>`}`}</span></div>`).join('')
        + (users.length === 1 ? emptyCta('users', 'Пока в команде только вы', 'Добавьте сотрудников: они видят платежи и отмечают оплату. Администратор задаётся в .env.', `<button class="btn" type="button" data-adduser>${ic('plus')}Добавить пользователя</button>`) : '');
    };
    await draw();
    document.addEventListener('billpay:me', () => draw());
    const ufMode = (u) => {
      SILENT = true; uf.reset(); SILENT = false; EDIT = u || null;
      $('#ufTitle').textContent = u ? 'Изменить пользователя' : 'Новый пользователь';
      $('#ufSub').textContent = u ? '@' + u.login + ' · пароль можно оставить пустым' : 'Логин и пароль передайте сотруднику';
      U('login').disabled = !!u; U('login').value = u ? u.login : '';
      if (u) U('name').value = u.name;
      U('email').value = u && u.email ? u.email : ''; emailNote();
      U('password').placeholder = u ? 'не менять' : 'минимум 6 символов';
      $('#ufSubmit').textContent = u ? 'Сохранить' : 'Добавить';
      $$('[aria-invalid]', uf).forEach((x) => x.removeAttribute('aria-invalid'));
    };
    const focusUf = () => { uf.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => (EDIT ? U('name') : U('login')).focus({ preventScroll: true }), RM ? 0 : 350); };
    $('#users').addEventListener('click', async (e) => {
      if (e.target.closest('[data-adduser]')) { ufMode(null); focusUf(); return; }
      const ed = e.target.closest('[data-edit]'); if (ed) { ufMode(USERS.find((u) => u.id === +ed.dataset.edit)); focusUf(); return; }
      const d = e.target.closest('[data-del]'); if (!d) return;
      const u = USERS.find((x) => x.id === +d.dataset.del);
      if (!confirm(`Удалить пользователя «${u ? u.name : ''}»? Он сразу потеряет доступ.`)) return;
      try { await BillPayApi.deleteUser(+d.dataset.del); if (EDIT && EDIT.id === +d.dataset.del) ufMode(null); await draw(); toast('Пользователь удалён'); } catch (x) { toast(esc(x.message)); }
    });
    uf.addEventListener('reset', () => { if (!SILENT && EDIT) setTimeout(() => ufMode(null)); });
    uf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: U('name').value.trim() };
      const pass = U('password').value, login = U('login').value.trim();
      const email = U('email').value.trim();
      const bad = { login: !EDIT && !/^[a-z0-9._-]{3,32}$/i.test(login), name: !body.name, password: EDIT ? pass.length > 0 && pass.length < 6 : pass.length < 6, email: !!email && !EMAIL_RE.test(email) };
      Object.entries(bad).forEach(([k, v]) => U(k).setAttribute('aria-invalid', v));
      if (bad.login) return toast('Логин: 3–32 символа, латиница, цифры, . _ -');
      if (bad.name) return toast('Укажите имя');
      if (bad.password) return toast('Пароль: минимум 6 символов');
      if (bad.email) { emailNote('Проверьте адрес: нужен вид name@company.ru'); return U('email').focus(); }
      if (pass) body.password = pass;
      if (email) body.email = email; else if (EDIT && EDIT.email) body.email = null;
      try {
        if (EDIT) { await BillPayApi.updateUser(EDIT.id, body); toast(`Сохранено<small>${esc(body.name)}</small>`); }
        else { await BillPayApi.createUser({ ...body, login }); toast(`Пользователь добавлен<small>@${esc(login.toLowerCase())}</small>`); }
      } catch (x) { if (/почт|email/i.test(x.message)) { U('email').setAttribute('aria-invalid', true); emailNote(x.message); } else toast(esc(x.message)); return; }
      ufMode(null); await draw();
    });
    ufMode(null);

    const drawRp = async () => {
      const list = await BillPayApi.getRecurringPayments();
      $('#rpcount').textContent = list.length;
      $('#rplist').innerHTML = list.length ? list.map((p, i) => `<div class="rpr rise" style="--d:${i * 30}ms"><span class="nm">${esc(p.name)}<small>ежемесячно · следующая оплата ${dmy(p.next_date)}</small></span><span class="amt">${num(p.amount, p.currency)}<span class="cc">${p.currency}</span></span><button class="ibtn sm del" data-rpdel="${p.id}" aria-label="Удалить платёж" title="Удалить">${ic('trash')}</button></div>`).join('')
        : emptyCta('card', 'Регулярных платежей пока нет', `Заполните форму «Новый регулярный платёж»: укажите название, сумму, валюту и дату ближайшей оплаты.`, `<button class="btn" type="button" data-newrp>${ic('plus')}Добавить первый платёж</button>`);
    };
    await drawRp();
    $('#rplist').addEventListener('click', async (e) => {
      if (e.target.closest('[data-newrp]')) { $('#newPayment').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => $('[name=name]', f).focus({ preventScroll: true }), RM ? 0 : 350); return; }
      const d = e.target.closest('[data-rpdel]'); if (!d) return;
      if (!confirm('Удалить регулярный платёж? Новые периоды создаваться не будут, неоплаченные периоды с текущего месяца исчезнут, история оплат сохранится.')) return;
      try { await BillPayApi.deleteRecurringPayment(+d.dataset.rpdel); await drawRp(); toast('Платёж удалён<small>история оплат сохранена</small>'); } catch (x) { toast(esc(x.message)); }
    });

    const f = $('#newPayment'), date = $('[name=next_date]', f), hint = $('#remHint');
    const upd = () => {
      if (!date.value) { hint.innerHTML = `${ic('info')}<span>Укажите дату ближайшей оплаты — напоминание уйдёт за ${meta.remindDaysBefore} дня.</span>`; return; }
      const d = new Date(date.value + 'T12:00:00'); d.setDate(d.getDate() - meta.remindDaysBefore);
      hint.innerHTML = `${ic('bell')}<span>Напоминание придёт в чат «${esc(meta.telegramChat)}» <b class="num">${dmy(d.toISOString().slice(0, 10))}</b>. Новый период создаётся каждый месяц, ${+date.value.slice(8)}-го числа.</span>`;
    };
    f.addEventListener('input', upd); f.addEventListener('reset', () => setTimeout(upd)); upd();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(f);
      const body = { name: String(fd.get('name') || '').trim(), amount: +fd.get('amount'), currency: fd.get('currency'), next_date: fd.get('next_date'), periodicity: fd.get('periodicity') };
      const bad = { name: !body.name, amount: !(body.amount > 0), next_date: !body.next_date };
      Object.entries(bad).forEach(([k, v]) => $(`[name=${k}]`, f).setAttribute('aria-invalid', v));
      if (Object.values(bad).some(Boolean)) { toast('Заполните название, сумму и дату'); return; }
      try { await BillPayApi.createRecurringPayment(body); } catch (x) { toast(esc(x.message)); return; } toast(`Платёж «${esc(body.name)}» создан<small>${fmt(body.amount, body.currency)} · ежемесячно</small>`); f.reset(); drawRp();
    });
    $('#settingsBox').innerHTML = `<div class="kv"><div><div class="lbl">Telegram-чат</div><div class="v">«${esc(meta.telegramChat)}»</div></div><div><div class="lbl">Часовой пояс</div><div class="v">${meta.timezone}</div></div><div><div class="lbl">Напоминание</div><div class="v">за ${meta.remindDaysBefore} дня до срока</div></div><div><div class="lbl">Почта (SMTP)</div><div class="v ${meta.email && meta.email.enabled ? '' : 'off'}">${meta.email && meta.email.enabled ? 'включена' : 'выключена — SMTP не задан'}</div></div></div>`;
    if (location.hash === '#new') setTimeout(() => $('[name=name]', f).focus({ preventScroll: innerWidth > 1279 }), 300);
    if (location.hash === '#settings') $('#settings').scrollIntoView();
  }

  function login() {
    $$('[data-tt-slot]').forEach((s) => (s.outerHTML = TT()));
    const f = $('#loginForm'), err = $('#err'), pw = $('[name=password]', f), tg = $('#pwToggle');
    tg.onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; tg.textContent = pw.type === 'password' ? 'показать' : 'скрыть'; pw.focus(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const b = $('button[type=submit]', f); b.disabled = true;
      try { await BillPayApi.login(f.login.value.trim(), pw.value); const n = new URLSearchParams(location.search).get('next'); location.href = n && /^\/app(\/|$)/.test(n) ? n : '/app'; }
      catch (x) { err.textContent = x.message || 'Неверный логин или пароль'; b.disabled = false; }
    });
  }

  window.BillPay = { status, late, fmt, num, dmy, toast, setTheme, toggleTheme, TODAY };
  const run = () => ({ dashboard, calendar, admin, login }[document.body.dataset.page] || (() => {}))();
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', run) : run();
})();
