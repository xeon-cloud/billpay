(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P = window.BillPay;

  const lh = $('#lh'); const onScroll = () => lh.classList.toggle('sc', scrollY > 8); onScroll(); addEventListener('scroll', onScroll, { passive: true });
  const links = $$('.lh nav a');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    $$('section[id]').forEach((s) => io.observe(s));
  }

  const els = $$('[data-rv]');
  if (RM || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('rv-in'));
  else { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('rv-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }); els.forEach((e) => io.observe(e)); }

  $$('.qa details').forEach((d) => d.addEventListener('toggle', () => { if (d.open) $$('.qa details').forEach((x) => x !== d && (x.open = false)); }));

  const vc = $('#vcal');
  if (vc) { const ev = { 5: 'o', 10: 'p', 15: 'p', 18: 'p', 20: 'o', 25: 'e', 26: 'e' }; let h = ''; for (let d = 13; d <= 26; d++) h += `<i class="${ev[d] ? 'e ' + ev[d] : ''} ${d === 23 ? 't' : ''}">${d}</i>`; vc.innerHTML = h; }

  const CHK = '<svg viewBox="0 0 16 16"><path d="M3.5 8.4l2.8 2.8 6-6.2"/></svg>';
  const rows = [
    { id: 'a', n: 'Аренда офиса', a: '85 000', c: 'RUB', due: 'до 25.10', s: 'unpaid' },
    { id: 'b', n: 'Сервер', a: '49.00', c: 'USD', due: '3 дн. просрочки', s: 'overdue' },
    { id: 'c', n: 'Notion', a: '10.00', c: 'EUR', due: 'до 26.10', s: 'unpaid' },
    { id: 'd', n: 'Подписка Figma', a: '15.00', c: 'EUR', due: 'оплачено 14.10', s: 'paid' }];
  const LBL = { paid: 'Оплачено', unpaid: 'Не оплачено', overdue: 'Просрочено' };
  const rowHTML = (r) => `<div class="pv-r" id="pv-${r.id}"><span class="nm">${r.n}<small>${r.due}</small></span><span class="amt">${r.a}<span class="cc">${r.c}</span></span><span class="pill ${r.s}"><i></i>${LBL[r.s]}</span><span class="mp ${r.s === 'paid' ? 'done' : ''}"><span class="ck">${CHK}</span></span></div>`;
  const pvl = $('#pvl'); pvl.innerHTML = rows.map(rowHTML).join('');
  const rub = $('#pvRUB'), pvn = $('#pvn'), ok = $('#pvOk');
  const fmtR = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + '\u2009₽';
  const tween = (from, to, ms = 800) => { if (RM) { rub.textContent = fmtR(to); return; } const t0 = performance.now(); const f = (n) => { const k = Math.min(1, (n - t0) / ms), e = 1 - Math.pow(1 - k, 4); rub.textContent = fmtR(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  rub.textContent = fmtR(97000);
  const setRow = (r, s, due) => { const el = $('#pv-' + r.id); el.querySelector('.pill').className = 'pill ' + s; el.querySelector('.pill').innerHTML = `<i></i>${LBL[s]}`; el.querySelector('.mp').classList.toggle('done', s === 'paid'); el.querySelector('small').textContent = due; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let visible = true;
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => (visible = es[0].isIntersecting)).observe($('#pvw'));
  async function loop() {
    while (true) {
      await wait(1400); if (!visible || document.hidden) continue;
      pvn.classList.add('on'); await wait(1600);
      ok.classList.add('press'); await wait(380); ok.classList.remove('press');
      pvn.classList.remove('on');
      const el = $('#pv-a'); setRow(rows[0], 'paid', 'оплачено 23.10'); el.classList.add('flash'); tween(97000, 12000);
      await wait(700); el.classList.remove('flash');
      await wait(3600);
      setRow(rows[0], 'unpaid', 'до 25.10'); tween(12000, 97000, 600);
    }
  }
  if (!RM) loop();

  const pv = $('#pv'), hero = $('.hero');
  if (!RM && matchMedia('(pointer:fine)').matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const step = () => { cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08; pv.style.setProperty('--rx', cy.toFixed(2) + 'deg'); pv.style.setProperty('--ry', cx.toFixed(2) + 'deg'); raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.01 ? requestAnimationFrame(step) : 0; };
    hero.addEventListener('pointermove', (e) => { const r = pv.getBoundingClientRect(); tx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 6; ty = -((e.clientY - (r.top + r.height / 2)) / r.height) * 5; if (!raf) raf = requestAnimationFrame(step); });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(step); });
  }

  const b = $('#tgPaid');
  b && b.addEventListener('click', () => {
    if (b.classList.contains('done')) return;
    b.classList.add('done'); b.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Оплачено';
    setTimeout(() => { $('#chat').insertAdjacentHTML('beforeend', '<div class="bub sys"><svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Аренда офиса отмечена оплаченной · 22.10.2026</div>'); P && P.toast('Период «Аренда офиса» закрыт<small>пример: так работает кнопка в Telegram</small>'); }, 300);
  });
})();
