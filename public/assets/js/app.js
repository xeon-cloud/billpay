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
      <div class="bot"><div class="h">${ic('send')}Напоминания</div><p>За ${S.remindDaysBefore} дня до срока · чат «${esc(S.telegramChat)}»</p></div>
      <div class="me"><div class="ava">${initials(u.name)}</div><div class="who"><b>${esc(u.name)}</b><small>${isAdmin ? 'Администратор' : 'Пользователь'}</small></div><button class="ibtn sm" data-logout aria-label="Выйти" title="Выйти">${ic('logout')}</button></div>`;
    const top = $('#top');
    if (top) top.innerHTML = `<a class="logo" href="/app" aria-label="BillPay">${LOGO}</a><div class="crumb lbl">${crumb}</div>
      <div class="tb">${actions}<button class="ibtn mo" data-cmdk aria-label="Поиск">${ic('search')}</button>${TT()}${mobileActions}<button class="ibtn mo" data-logout aria-label="Выйти">${ic('logout')}</button></div>`;
    document.body.insertAdjacentHTML('beforeend', `<nav class="tabbar" aria-label="Разделы">${nav.map(([k, h, i, l]) => `<a class="tab ${k === active ? 'on' : ''}" href="${h}">${ic(i)}<span>${l}</span></a>`).join('')}</nav>
      <div class="ov" id="ov"><div class="pal" role="dialog" aria-label="Командная палитра"><div class="pin">${ic('search')}<input id="q" placeholder="Команда или название платежа" autocomplete="off"><span class="kbd">esc</span></div><div id="opts"></div><div class="pf"><span>↑↓ выбрать</span><span>↵ выполнить</span><span>esc закрыть</span></div></div></div>
      <div class="toasts" id="toasts" aria-live="polite"></div>`);
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

  const reminderRows = (meta, occ, limit = 3) => meta.reminders.filter((r) => occ.some((x) => x.id === r.occurrence_id)).slice(0, limit).map((r) => {
    const o = occ.find((x) => x.id === r.occurrence_id); if (!o) return '';
    return `<div class="ri"><span class="d">${dm(r.send_date)}</span><span class="nm">${esc(o.name)}<small>${num(o.amount, o.currency)} ${o.currency} · до ${dm(o.due_date)}</small></span><span class="s ${r.status === 'sent' ? 'ok' : ''}">${r.status === 'sent' ? ic('check') + '<span class="st">наступило</span>' : ic('clock') + '<span class="st">' + r.time + '</span>'}</span></div>`;
  }).join('');
  const reminderCard = (meta, occ) => `<div class="tgh"><span class="bi">${ic('bell')}</span><div><b>Напоминания в Telegram</b><small>за ${meta.remindDaysBefore} дня до срока · «${esc(meta.telegramChat)}»</small></div></div><div class="rl">${reminderRows(meta, occ) || `<div class="rl-e">${ic('bell')}<span>Ближайших напоминаний нет. Они появятся, когда в месяце будут неоплаченные платежи.</span></div>`}</div>`;
  const sideCounts = (occ) => ['RUB', 'USD', 'EUR'].forEach((c) => $$(`[data-count="${c}"]`).forEach((n) => (n.textContent = occ.filter((o) => o.currency === c).length)));
  const todayChip = () => `${ic('cal')}сегодня ${dmy(TODAY)}`;

  async function dashboard() {
    const isAdmin = S.currentUser.role === 'admin';
    shell('payments', `Платежи<i></i><b>${monthName} ${year}</b>`,
      `<a class="btn ghost hide-m" href="${monthUrl('/app', shiftMonth(VM, -1))}#history">${ic('history')}История</a>${isAdmin ? `<a class="btn hide-m" href="/app/admin#new">${ic('plus')}Новый платёж</a>` : ''}`,
      isAdmin ? `<a class="ibtn solid mo" href="/app/admin#new" aria-label="Новый платёж">${ic('plus')}</a>` : '');
    palette();
    $$('#history [data-ic], #sheet [data-ic]').forEach((e) => (e.outerHTML = ic(e.dataset.ic)));

    // поиск, фильтры и сортировка периодов — на сервере; состояние хранится в адресе (?q=&status=&currency=&sort=&order=)
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
    // подсветка совпадения в названии
    const hl = (text) => {
      const q = qv(); if (!q) return esc(text);
      const lo = text.toLowerCase(), ql = q.toLowerCase(); let i = 0, out = '', j;
      while ((j = lo.indexOf(ql, i)) !== -1) { out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>'; i = j + q.length; }
      return out + esc(text.slice(i));
    };
    // дата оплаты — та, что укажет человек, не обязательно сегодня
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
        // суммы не конвертируются — группы по валютам, внутри — по сумме
        let i = 0;
        $('#rows').innerHTML = PAGE.totals.filter((t) => t.count).map((t) => `<div class="grp"><span class="cd">${SYM[t.currency]}</span><b>${t.currency}</b><span>${t.count} ${plural(t.count, 'платёж', 'платежа', 'платежей')} · ${fmt(t.total, t.currency)}</span></div>` + list.filter((o) => o.currency === t.currency).map((o) => row(o, i++, mode)).join('')).join('');
      } else {
        $('#rows').innerHTML = list.map((o, i) => row(o, i, mode)).join('');
      }
    };
    const render = (mode) => { controls(); rows(mode); };
    // перезапрос списка; quiet — после отметки оплаты: счётчики и итоги сразу, строки — только если порядок/состав изменился
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

    // одна отметка — общий объект для карточек и списка
    const find = (id) => PAGE.items.find((x) => x.id === id) || occ.find((x) => x.id === id);
    const setLocal = (id, paidAt) => [PAGE.items, occ].forEach((l) => l.forEach((x) => { if (x.id === id) { x.paid_at = paidAt; x.is_paid = !!paidAt; x.status = status(x); x.overdue_days = late(x); } }));
    const refresh = async (first) => {
      const sum = await BillPayApi.getSummary();
      sum.forEach((s) => {
        ['to_pay', 'paid', 'overdue'].forEach((k) => { const n = $(`[data-c="${s.currency}"][data-k="${k}"]`); const from = +(n.dataset.v || 0); n.dataset.v = s[k]; tween(n, from, s[k], s.currency, first ? 1100 : 700); });
        $(`[data-odw="${s.currency}"]`).className = s.overdue ? 'od' : 'z';
        // бюджет из настроек, иначе доля оплаченного
        const b = (meta.budgets && meta.budgets[s.currency]) || 0, base = b || s.total;
        $(`[data-blt="${s.currency}"]`).textContent = b ? 'Бюджет месяца' : 'Оплачено за месяц';
        $(`[data-bar="${s.currency}"]`).style.width = (base ? Math.max(2, Math.min(100, (s.paid / base) * 100)) : 0) + '%';
        $(`[data-bl="${s.currency}"]`).textContent = base ? `${fmt(s.paid, s.currency)} / ${fmt(base, s.currency)}` : 'нет платежей';
      });
      occ.forEach((o) => { const d = $(`[data-dot="${o.id}"]`); if (d) d.className = 'dt ' + status(o); const t = $(`[data-tst="${o.id}"]`); if (t) t.textContent = ST[status(o)].toLowerCase(); });
    };
    const paint = (o) => { const r = $('#r-' + o.id); if (!r) return; r.classList.remove('rise'); r.innerHTML = inner(o); $$('.pill,.fd,.lt,.ac', r).forEach((e) => e.classList.add('swap')); };
    const focusDate = (id) => { const inp = $(`[data-date="${id}"]`); if (inp) { inp.focus(); inp.closest('.rw').scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' }); } };
    // период скрыт фильтрами (например, из командной палитры) — сбрасываем фильтры, чтобы строка была видна
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
    // сохраняем только enter или кнопкой, смена дня в календаре ещё не запись
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

    /* мобильный bottom sheet: статус, валюта, сортировка */
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
      // строки списка перерисовываются раньше, поэтому проверяем путь события, а не текущий DOM
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
    const y = +year, m = +VM.slice(5, 7), first = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate(), prev = new Date(y, m - 1, 0).getDate();
    let cells = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => `<div class="wd lbl">${w}</div>`).join('');
    const total = Math.ceil((first + dim) / 7) * 7;
    for (let i = 0; i < total; i++) {
      const d = i - first + 1, inM = d >= 1 && d <= dim, iso = inM ? `${VM}-${String(d).padStart(2, '0')}` : '';
      const label = inM ? d : d < 1 ? prev + d : d - dim;
      const os = inM ? occ.filter((o) => o.due_date === iso) : [], rem = inM && meta.reminders.find((r) => r.send_date === iso), ro = rem && occ.find((o) => o.id === rem.occurrence_id);
      cells += `<div class="mc ${inM ? '' : 'out'} ${iso === TODAY ? 'td' : ''} ${i % 7 >= 5 ? 'we' : ''} ${i >= total - 7 ? 'lr' : ''}"><span class="n">${label}</span>${os.map((o) => `<div class="ev ${status(o)}" title="${esc(o.name)} · ${ST[status(o)]}"><i></i><b>${esc(o.name)}</b><span>${fmt(o.amount, o.currency)}</span></div>`).join('')}${ro ? `<div class="remc" title="Напоминание: ${esc(ro.name)}">${ic('bell')}<span>${esc(ro.name)}</span></div>` : ''}</div>`;
    }
    $('#month').innerHTML = `<div class="mhead"><span class="h3">${monthName} ${year}</span>${IS_CUR ? '' : `<a class="btn ghost sm" href="/app/calendar">Сегодня</a>`}<a class="ibtn sm" href="${monthUrl('/app/calendar', shiftMonth(VM, -1))}" aria-label="Предыдущий месяц" title="${mName(shiftMonth(VM, -1))}">${ic('back')}</a><a class="ibtn sm" href="${monthUrl('/app/calendar', shiftMonth(VM, 1))}" aria-label="Следующий месяц" title="${mName(shiftMonth(VM, 1))}">${ic('chev')}</a></div><div class="mgrid">${cells}</div>`;
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
    const draw = async () => {
      const users = USERS = await BillPayApi.getUsers();
      $('#ucount').textContent = users.length;
      $('#users').innerHTML = users.map((u, i) => `<div class="ug ur rise" style="--d:${i * 30}ms"><span class="un2"><span class="ava ${u.from_env ? '' : 'n'}">${initials(u.name)}</span><span class="t"><b>${esc(u.name)}</b><small>${u.from_env ? 'главный админ' : '@' + esc(u.login)}</small></span></span><span class="rc"><span class="role ${u.role}">${u.role === 'admin' ? 'Администратор' : 'Пользователь'}</span></span><span class="dc ul2" style="display:block">${dmy(u.created_at)}</span><span class="ia">${u.from_env ? `<span class="lock">${ic('lock')}Защищён</span>` : `<button class="ibtn sm" data-edit="${u.id}" aria-label="Изменить" title="Изменить">${ic('edit')}</button>${u.id === ME.id ? '' : `<button class="ibtn sm del" data-del="${u.id}" aria-label="Удалить" title="Удалить">${ic('trash')}</button>`}`}</span></div>`).join('')
        + (users.length === 1 ? emptyCta('users', 'Пока в команде только вы', 'Добавьте сотрудников: они видят платежи и отмечают оплату. Администратор задаётся в .env.', `<button class="btn" type="button" data-adduser>${ic('plus')}Добавить пользователя</button>`) : '');
    };
    await draw();
    const ufMode = (u) => {
      SILENT = true; uf.reset(); SILENT = false; EDIT = u || null;
      $('#ufTitle').textContent = u ? 'Изменить пользователя' : 'Новый пользователь';
      $('#ufSub').textContent = u ? '@' + u.login + ' · пароль можно оставить пустым' : 'Логин и пароль передайте сотруднику';
      U('login').disabled = !!u; U('login').value = u ? u.login : '';
      if (u) U('name').value = u.name;
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
      const bad = { login: !EDIT && !/^[a-z0-9._-]{3,32}$/i.test(login), name: !body.name, password: EDIT ? pass.length > 0 && pass.length < 6 : pass.length < 6 };
      Object.entries(bad).forEach(([k, v]) => U(k).setAttribute('aria-invalid', v));
      if (bad.login) return toast('Логин: 3–32 символа, латиница, цифры, . _ -');
      if (bad.name) return toast('Укажите имя');
      if (bad.password) return toast('Пароль: минимум 6 символов');
      if (pass) body.password = pass;
      try {
        if (EDIT) { await BillPayApi.updateUser(EDIT.id, body); toast(`Сохранено<small>${esc(body.name)}</small>`); }
        else { await BillPayApi.createUser({ ...body, login }); toast(`Пользователь добавлен<small>@${esc(login.toLowerCase())}</small>`); }
      } catch (x) { toast(esc(x.message)); return; }
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
    $('#settingsBox').innerHTML = `<div class="kv"><div><div class="lbl">Telegram-чат</div><div class="v">«${esc(meta.telegramChat)}»</div></div><div><div class="lbl">Часовой пояс</div><div class="v">${meta.timezone}</div></div><div><div class="lbl">Напоминание</div><div class="v">за ${meta.remindDaysBefore} дня до срока</div></div></div>`;
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
