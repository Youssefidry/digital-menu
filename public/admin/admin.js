(() => {
'use strict';
const root = document.getElementById('root');
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'selected') e.selected = !!v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(d, size = 20) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.9');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = d; return s;
}
const AUTH_ICON = {
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="3"/><path d="M8.2 10V7.2a3.8 3.8 0 0 1 7.6 0V10"/><circle cx="12" cy="15.2" r="1.2" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3.1"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.7 6.2A11.6 11.6 0 0 1 12 6.1c6.2 0 9.8 5.9 9.8 5.9a17.3 17.3 0 0 1-3.6 4"/><path d="M6.6 7.2C3.9 9 2.2 12 2.2 12s3.6 6.5 9.8 6.5c1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  check: '<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>',
  arrow: '<path d="M15 5l-7 7 7 7"/>'
};
const token = () => { try { return sessionStorage.getItem('t') || ''; } catch { return ''; } };
const ST = { new: 'جديدة', preparing: 'قيد التحضير', ready: 'جاهزة', done: 'منجزة', canceled: 'ملغاة' };
const STEPS = ['new', 'preparing', 'ready', 'done'];

let data = null, orders = [], tab = 'overview', dishQuery = '', orderFilter = 'active';
let orderQuery = '', orderType = 'all', orderRange = 'all', orderLimit = 40;
let timer = null, sound = true, orderView = 'list';
try { orderView = localStorage.getItem('dm_order_view') === 'grid' ? 'grid' : 'list'; } catch {}
try { sound = localStorage.getItem('dm_sound') !== '0'; } catch {}

function toast(msg, bad) { const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2800); }
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-token': token() }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 401 && url !== '/api/login') { try { sessionStorage.removeItem('t'); } catch {} stopPolling(); showLogin(); throw new Error(j.error || 'انتهت الجلسة'); }
  if (!r.ok) throw new Error(j.error || 'حدث خطأ');
  return j;
}
const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, true); } };
const reload = async () => { data = await api('GET', '/api/admin/menu'); document.documentElement.style.setProperty('--c', data.settings.color); };
const field = (label, input) => h('label', {}, label, input);
const catName = id => (data.categories.find(c => c.id === id) || {}).name || '-';
const money = n => `${new Intl.NumberFormat('ar-MA', { maximumFractionDigits: 2 }).format(Number(n) || 0)} ${data.settings.currency || ''}`;
const pad2 = n => String(n).padStart(2, '0');
const fmtTs = d => { const x = new Date(d); return `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}/${x.getFullYear()} · ${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
const fmtTime = d => { const x = new Date(d); return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
const relTime = d => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 6e4);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'الآن';
  if (m < 60) return 'منذ ' + m + ' د';
  const h = Math.round(m / 60);
  if (h < 24) return 'منذ ' + h + ' س';
  const dd = Math.round(h / 24);
  return dd === 1 ? 'أمس' : 'منذ ' + dd + ' يوم';
};
const dayKey = d => new Date(d).toDateString();

function beep() {
  if (!sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(); ctx.resume && ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start(); o.stop(ctx.currentTime + 0.36);
    setTimeout(() => ctx.close && ctx.close(), 800);
  } catch {}
}

/* ---------- notifications ---------- */
function sysNotify(count) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification('🔔 طلب جديد (' + count + ')', { body: 'افتح لوحة التحكم لمراجعة الطلب', icon: '/icon-192.png', tag: 'dm-order', renotify: true });
    n.onclick = () => { try { window.focus(); } catch {} n.close(); };
  } catch {}
}
function flashTitle(count) {
  if (!document.hidden) return;
  const base = document.title.replace(/^🔔 \(\d+\) /, '');
  document.title = '🔔 (' + count + ') ' + base;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && data) document.title = 'لوحة التحكم · ' + (data.settings.name || '');
});

/* ---------- polling ---------- */
const newCount = () => orders.filter(o => o.status === 'new').length;
function drawBadge() {
  const n = newCount();
  const nav = document.querySelector('.side .nav .badge');
  if (nav) { nav.textContent = n || ''; nav.style.display = n ? 'grid' : 'none'; }
  const host = document.querySelector('.mtop-orders');
  if (!host) return;
  let top = host.querySelector('.badge');
  if (!top) { top = h('span', { class: 'badge' }); host.append(top); }
  top.textContent = n || '';
  top.style.display = n ? 'grid' : 'none';
}
async function refreshOrders(silent) {
  try {
    const prev = newCount();
    orders = await api('GET', '/api/orders');
    if (!silent && data) toast('تم تحديث الطلبات');
    else if (newCount() > prev && data) {
      toast('🔔 وصل طلب جديد (' + newCount() + ')');
      beep(); sysNotify(newCount()); flashTitle(newCount());
    }
    if (data && (tab === 'orders' || tab === 'overview')) draw();
    drawBadge();
  } catch {}
}
function startPolling() {
  stopPolling();
  timer = setInterval(() => { if (!document.hidden && token()) refreshOrders(true); }, 12000);
}
function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

/* ---------- login ---------- */
function showLogin() {
  stopPolling();
  root.replaceChildren();
  document.body.classList.add('auth-page');
  const info = { name: 'لوحة التحكم', tagline: '', logo: '' };
  document.title = 'تسجيل الدخول';

  const brandMount = h('div', { class: 'auth-brand-top' });
  const mobileMount = h('div', { class: 'auth-mobile-brand' });
  const logoSrc = () => (info.logo
    ? h('img', { class: 'auth-logo', src: info.logo, alt: 'شعار ' + info.name })
    : h('div', { class: 'auth-logo mono', 'aria-hidden': 'true' }, (info.name || 'م').trim().charAt(0)));
  function paintBrand() {
    brandMount.replaceChildren(logoSrc(), h('div', { class: 'auth-titles' },
      h('div', { class: 'auth-name' }, info.name), info.tagline ? h('p', { class: 'auth-tag' }, info.tagline) : null));
    mobileMount.replaceChildren(logoSrc(), h('div', { class: 'auth-titles' },
      h('div', { class: 'auth-name' }, info.name), info.tagline ? h('p', { class: 'auth-tag' }, info.tagline) : null));
    document.title = 'تسجيل الدخول · ' + info.name;
  }
  paintBrand();

  const pw = h('input', { class: 'input auth-input', id: 'admin-password', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'كلمة المرور', 'aria-label': 'كلمة المرور', required: '' });
  const caps = h('div', { class: 'auth-caps', hidden: '' }, 'Caps Lock مفعّل — قد تُكتب كلمة المرور بأحرف كبيرة');
  pw.addEventListener('keyup', e => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); });
  pw.addEventListener('blur', () => { caps.hidden = true; });

  const eyeBtn = h('button', { class: 'eye', type: 'button', 'aria-label': 'إظهار كلمة المرور', title: 'إظهار/إخفاء' });
  const paintEye = () => { const hidden = pw.type === 'password'; eyeBtn.replaceChildren(svg(hidden ? AUTH_ICON.eye : AUTH_ICON.eyeOff, 20)); eyeBtn.setAttribute('aria-label', hidden ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور'); };
  paintEye();
  eyeBtn.addEventListener('click', () => { pw.type = pw.type === 'password' ? 'text' : 'password'; paintEye(); pw.focus(); });

  const err = h('div', { class: 'auth-error', role: 'alert', 'aria-live': 'polite' });
  const label = h('span', {}, 'دخول');
  const btn = h('button', { class: 'btn auth-submit', type: 'submit' }, label, svg(AUTH_ICON.arrow, 18));
  let busy = false;
  const go = async () => {
    if (busy) return;
    err.textContent = '';
    if (!pw.value) { err.textContent = 'أدخل كلمة المرور للمتابعة.'; pw.focus(); return; }
    busy = true; btn.disabled = true; btn.classList.add('busy'); label.textContent = 'جارٍ التحقق...';
    try {
      const r = await api('POST', '/api/login', { password: pw.value });
      sessionStorage.setItem('t', r.token);
      if (r.mustChange) sessionStorage.setItem('mc', '1');
      await start();
    } catch (e) {
      err.textContent = e.message || 'تعذر تسجيل الدخول';
      pw.select();
    } finally {
      busy = false; btn.disabled = false; btn.classList.remove('busy'); label.textContent = 'دخول';
    }
  };

  const form = h('form', { class: 'auth-form', onsubmit: e => { e.preventDefault(); go(); } },
    h('label', { class: 'auth-label', for: 'admin-password' }, 'كلمة المرور'),
    h('div', { class: 'auth-field' }, svg(AUTH_ICON.lock, 18), pw, eyeBtn),
    caps, err, btn);

  const card = h('section', { class: 'auth-card' },
    mobileMount,
    h('div', { class: 'auth-card-head' },
      h('h1', {}, 'تسجيل الدخول'),
      h('p', { class: 'muted' }, 'أدخل كلمة المرور للوصول إلى لوحة التحكم.')),
    form,
    h('p', { class: 'auth-hint' }, 'كلمة المرور الافتراضية admin123 — غيّرها بعد الدخول من تبويب الإعدادات.'),
    h('a', { class: 'auth-back', href: '/' }, '→ العودة إلى قائمة الطعام'));

  const aside = h('aside', { class: 'auth-brand' },
    brandMount,
    h('div', { class: 'auth-brand-mid' },
      h('p', { class: 'auth-kicker' }, 'لوحة التحكم'),
      h('h2', { class: 'auth-headline' }, 'كل ما تحتاجه لإدارة قائمتك في مكان واحد'),
      h('ul', { class: 'auth-points' },
        ['تعديل الأطباق والفئات في ثوانٍ', 'متابعة الطلبات لحظيًا مع تنبيه صوتي', 'رموز QR جاهزة للطباعة لكل طاولة'].map(t => h('li', {}, svg(AUTH_ICON.check, 17), t)))),
    h('div', { class: 'auth-brand-foot' }, 'قائمة طعام رقمية · بدون مكتبات خارجية'));

  root.append(h('div', { class: 'auth' }, h('div', { class: 'auth-wrap' }, aside, card)));
  pw.focus();

  fetch('/api/menu', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(m => {
    const st = (m && m.settings) || {};
    if (st.name) info.name = st.name;
    if (st.logo) info.logo = st.logo;
    if (st.tagline) info.tagline = st.tagline;
    if (st.color) document.documentElement.style.setProperty('--c', st.color);
    paintBrand();
  }).catch(() => {});
}

/* ---------- shell ---------- */
const TABS = [['overview', 'نظرة عامة'], ['orders', 'الطلبات'], ['dishes', 'الأطباق'], ['categories', 'الفئات'], ['qr', 'رموز QR'], ['look', 'المظهر'], ['settings', 'الإعدادات']];
function go(k) { tab = k; closeDrawer(); draw(); }
function toggleDrawer(force) {
  const side = document.getElementById('admin-side');
  if (!side) return;
  const on = typeof force === 'boolean' ? force : !side.classList.contains('open');
  const ov = document.getElementById('drawer-ov');
  side.classList.toggle('open', on);
  if (ov) ov.classList.toggle('show', on);
  document.body.classList.toggle('drawer-open', on);
  const burger = document.querySelector('.burger');
  if (burger) burger.setAttribute('aria-expanded', String(on));
  if (on) setTimeout(() => side.querySelector('.side-close')?.focus(), 80);
}
function closeDrawer() {
  const side = document.getElementById('admin-side');
  if (!side || !side.classList.contains('open')) return;
  side.classList.remove('open');
  document.getElementById('drawer-ov')?.classList.remove('show');
  document.body.classList.remove('drawer-open', 'od-open');
  document.querySelector('.burger')?.setAttribute('aria-expanded', 'false');
}
async function draw() {
  if (!data) return;
  document.body.classList.remove('drawer-open');
  const view = { overview: vOverview, orders: vOrders, dishes: vDishes, categories: vCategories, qr: vQr, look: vLook, settings: vSettings }[tab];
  const content = view();
  const nav = TABS.map(([k, n]) => {
    const b = h('button', { class: 'nav', 'aria-current': tab === k ? 'page' : null, onclick: () => go(k) }, n);
    if (k === 'orders') { const badge = h('span', { class: 'badge' }, newCount() || ''); badge.style.display = newCount() ? 'grid' : 'none'; b.append(badge); }
    return b;
  });
  const pendingCount = newCount();
  const shell = h('div', { class: 'shell' },
    h('header', { class: 'mtop' },
      h('button', { class: 'burger', type: 'button', 'aria-label': 'فتح القائمة', 'aria-expanded': 'false', 'aria-controls': 'admin-side', onclick: () => toggleDrawer() },
        svg('<path d="M4 7h16M4 12h16M4 17h16"/>', 22)),
      h('div', { class: 'mtop-brand' },
        data.settings.logo
          ? h('img', { src: data.settings.logo, alt: '' })
          : h('span', { class: 'mtop-badge', 'aria-hidden': 'true' }, (data.settings.name || 'م').trim().charAt(0)),
        h('strong', {}, data.settings.name || 'لوحة التحكم')),
      h('button', { class: 'mtop-orders', type: 'button', onclick: () => go('orders') },
        'الطلبات', pendingCount ? h('span', { class: 'badge' }, pendingCount) : null)),
    h('aside', { class: 'side', id: 'admin-side', 'aria-label': 'قائمة التنقل' },
      h('div', { class: 'side-brand' },
        data.settings.logo
          ? h('img', { class: 'side-logo', src: data.settings.logo, alt: 'صورة ' + (data.settings.name || 'المطعم') })
          : h('div', { class: 'side-logo mono', 'aria-hidden': 'true' }, (data.settings.name || 'م').trim().charAt(0)),
        h('div', { class: 'side-brand-txt' }, h('div', { class: 'brand-name' }, data.settings.name || 'لوحة التحكم'), h('small', {}, 'لوحة إدارة القائمة')),
        h('button', { class: 'side-close', type: 'button', 'aria-label': 'إغلاق القائمة', onclick: () => toggleDrawer(false) }, '×')),
      ...nav,
      h('a', { class: 'nav', href: '/', target: '_blank', rel: 'noopener' }, '↗ صفحة الزبون'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'nav', onclick: () => { stopPolling(); try { sessionStorage.removeItem('t'); } catch {} showLogin(); } }, 'تسجيل الخروج')),
    h('div', { class: 'drawer-ov', id: 'drawer-ov', onclick: () => toggleDrawer(false) }),
    h('main', { class: 'main' }, securityBanner(), content));
  root.replaceChildren(shell);
  document.title = 'لوحة التحكم · ' + (data.settings.name || '');
}
function securityBanner() {
  if (!sessionStorage.getItem('mc')) return null;
  return h('section', { class: 'card pad warn-card' },
    h('strong', {}, '⚠️ ما زلت تستعمل كلمة المرور الافتراضية'),
    h('p', { class: 'muted', style: 'margin:4px 0 0;font-size:13.5px' }, 'أي شخص يعرف admin123 يمكنه الدخول إلى لوحة التحكم. غيّرها الآن.'),
    h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => go('settings') }, 'تغيير كلمة المرور'));
}
async function start() {
  document.body.classList.remove('auth-page');
  await reload();
  orders = await api('GET', '/api/orders');
  await draw();
  startPolling();
}

/* ---------- overview ---------- */
function vOverview() {
  const today = new Date().toDateString();
  const todays = orders.filter(o => dayKey(o.createdAt) === today && o.status !== 'canceled');
  const revenue = todays.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const pending = orders.filter(o => o.status === 'new' || o.status === 'preparing').length;
  const unavailable = data.dishes.filter(d => !d.available).length;
  const stat = (label, val, accent) => h('div', { class: 'stat' + (accent ? ' accent' : '') }, h('b', {}, val), h('span', {}, label));
  // top dishes from the last 30 days
  const cutoff = Date.now() - 30 * 864e5, tally = new Map();
  for (const o of orders) {
    if (o.status === 'canceled' || new Date(o.createdAt).getTime() < cutoff) continue;
    for (const i of o.items || []) tally.set(i.name, (tally.get(i.name) || 0) + i.qty);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), max = top.length ? top[0][1] : 1;
  const recent = orders.slice(0, 5);
  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'نظرة عامة'), h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: () => go('orders') }, 'الطلبات (' + newCount() + ' جديدة)'),
      h('button', { class: 'btn', onclick: () => { go('dishes'); openDishForm({ id: '', name: '', desc: '', price: 0, category: (data.categories[0] || {}).id || '', image: '', available: true, ingredients: [] }); } }, '+ طبق جديد'))),
    h('div', { class: 'stats' },
      stat('طلبات اليوم', todays.length, true),
      stat('إيرادات اليوم', money(revenue)),
      stat('طلبات قيد العمل', pending),
      stat('أطباق غير متوفرة', unavailable)),
    h('div', { class: 'split', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr)' },
      h('section', { class: 'card pad' }, h('h3', { style: 'margin:0 0 14px;font-size:17px' }, 'الأكثر طلبا (30 يوما)'),
        top.length ? h('div', { class: 'form', style: 'gap:10px' }, top.map(([name, n]) => h('div', {},
          h('div', { style: 'display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px' }, h('span', {}, name), h('b', {}, n)),
          h('div', { style: 'height:8px;border-radius:5px;background:#F3EADA;overflow:hidden' }, h('div', { style: `height:100%;width:${Math.round(n / max * 100)}%;background:var(--c)` })))))
          : h('p', { class: 'empty' }, 'لا توجد طلبات بعد.')),
      h('section', { class: 'card pad' }, h('h3', { style: 'margin:0 0 14px;font-size:17px' }, 'آخر الطلبات'),
        recent.length ? h('div', { class: 'form', style: 'gap:8px' }, recent.map(o => h('div', { style: 'display:flex;justify-content:space-between;gap:8px;font-size:14px;border-bottom:1px solid #F3EADA;padding-bottom:8px' },
          h('span', {}, orderKind(o) + (o.name ? ' · ' + o.name : '') + ' · ' + fmtTime(o.createdAt)),
          h('span', { class: 'pill-status', 'data-s': o.status }, ST[o.status] || o.status))))
          : h('p', { class: 'empty' }, 'لا توجد طلبات بعد. ستظهر هنا أول طلب يرسله الزبون.'))),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'التحديث التلقائي للطلبات كل 12 ثانية · الجرس ' + (sound ? 'مفعّل' : 'مكتوم')));
}

/* ---------- dishes ---------- */
function vDishes() {
  const body = h('section', { class: 'card tbl' });
  const countEl = h('span', { class: 'muted', style: 'font-size:13px' });
  const paint = () => {
    const list = data.dishes.filter(x => !dishQuery || (x.name + ' ' + x.desc + ' ' + catName(x.category)).toLowerCase().includes(dishQuery.toLowerCase()));
    const move = (x, dir) => run(async () => {
      const ids = data.dishes.map(d => d.id);
      const i = ids.indexOf(x.id), j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api('POST', '/api/dishes/reorder', { ids });
      await reload(); await draw();
    }, 'تم تغيير الترتيب');
    const rows = list.map(x => h('div', {
      class: 'tr', role: 'button', tabindex: '0',
      onclick: () => openDishForm({ ...x }),
      onkeydown: e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDishForm({ ...x }); } }
    },
      h('div', { class: 'sm c-img', style: x.image ? `background-image:url('${x.image}')` : '' }, x.image ? null : (x.name || '·').charAt(0)),
      h('div', { class: 'c-name' }, x.name, h('small', {}, x.desc || 'بدون وصف')),
      h('span', { class: 'c-cat' }, catName(x.category)),
      h('span', { class: 'c-price' }, money(x.price)),
      h('span', { class: 'c-avail ' + (x.available ? 'ok' : 'no') }, x.available ? '● متوفر' : '● موقوف'),
      h('div', { class: 'c-sort', onclick: e => e.stopPropagation(), onkeydown: e => e.stopPropagation() },
        h('button', { class: 'mini', type: 'button', 'aria-label': 'نقل ' + x.name + ' لأعلى', onclick: () => move(x, -1) }, '↑'),
        h('button', { class: 'mini', type: 'button', 'aria-label': 'نقل ' + x.name + ' لأسفل', onclick: () => move(x, 1) }, '↓'))));
    body.replaceChildren(h('div', { class: 'tr hd' }, h('span', {}, 'صورة'), h('span', {}, 'الاسم'), h('span', {}, 'الفئة'), h('span', { style: 'text-align:end' }, 'السعر'), h('span', { style: 'text-align:end' }, 'الحالة'), h('span', { style: 'text-align:end' }, 'ترتيب')),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, dishQuery ? 'لا توجد أطباق مطابقة.' : 'لا توجد أطباق بعد.')]));
    countEl.textContent = data.dishes.length + ' طبقا · ' + data.dishes.filter(x => x.available).length + ' متوفر · ' + list.length + ' معروض';
  };
  paint();
  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'الأطباق'), h('div', { class: 'actions' },
      h('button', { class: 'btn', disabled: !data.categories.length, onclick: () => openDishForm({ id: '', name: '', desc: '', price: 0, category: data.categories[0].id, image: '', available: true, ingredients: [] }) }, '+ إضافة طبق'))),
    !data.categories.length ? h('p', { class: 'tag' }, 'أضف فئة أولا من تبويب الفئات.') : null,
    h('div', { class: 'row-inline' }, h('input', { class: 'input grow', type: 'search', placeholder: 'ابحث بالاسم أو الفئة...', value: dishQuery, oninput: e => { dishQuery = e.target.value.trim(); paint(); } }), countEl),
    body);
}

/* ---------- dish modal ---------- */
let modal = null, modalRestore = null;
function closeDishForm() {
  if (!modal) return;
  document.removeEventListener('keydown', modal.onKey);
  modal.el.remove();
  document.body.classList.remove('locked');
  modal = null;
  try { modalRestore && modalRestore.focus(); } catch {}
}
function openDishForm(d) {
  closeDishForm();
  modalRestore = document.activeElement;
  const name = h('input', { class: 'input', value: d.name, maxlength: '80' }), desc = h('textarea', { class: 'input', maxlength: '600' }, d.desc);
  const price = h('input', { class: 'input', type: 'number', min: '0', step: '0.5', value: d.price, inputmode: 'decimal' });
  const cat = h('select', { class: 'input' }, data.categories.map(c => h('option', { value: c.id, selected: c.id === d.category }, c.name)));
  const ing = h('input', { class: 'input', value: (d.ingredients || []).join('، '), placeholder: 'افصل بينها بفاصلة' });
  const av = h('input', { type: 'checkbox', checked: d.available });
  const prev = h('div', { class: 'img-prev', style: d.image ? `background-image:url('${d.image}')` : '' }, d.image ? null : 'لا صورة');
  const fileHint = h('span', { class: 'file-hint' }, 'PNG / JPG / WEBP · حتى 4MB');
  const pick = h('button', { class: 'btn ghost', type: 'button' }, 'اختيار صورة');
  const file = h('input', {
    class: 'file-input', type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'صورة الطبق',
    onchange: () => run(async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) throw new Error('صيغة غير مدعومة (PNG / JPG / WEBP)');
      if (f.size > 4 * 1024 * 1024) throw new Error('الصورة أكبر من 4MB');
      pick.disabled = true; pick.textContent = 'جارٍ الرفع...';
      try {
        d.image = await upload(f);
        prev.style.backgroundImage = `url('${d.image}')`; prev.textContent = '';
        fileHint.textContent = f.name;
        toast('تم رفع الصورة');
      } finally {
        pick.disabled = false; pick.textContent = 'اختيار صورة'; file.value = '';
      }
    }, null)
  });
  pick.addEventListener('click', () => file.click());
  const fileRow = h('div', { class: 'file-row' }, pick, file, fileHint);
  const payload = () => ({ name: name.value, desc: desc.value, price: price.value, category: cat.value, image: d.image, available: av.checked, ingredients: ing.value.split(/[,،]/).map(s => s.trim()).filter(Boolean) });
  const save = async (dup) => {
    if (!name.value.trim()) throw new Error('اكتب اسم الطبق');
    if (d.id && !dup) await api('PUT', '/api/dishes/' + d.id, payload());
    else await api('POST', '/api/dishes', payload());
  };
  const finish = async (okMsg) => { await reload(); closeDishForm(); await draw(); toast(okMsg); };

  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: closeDishForm }, '✕');
  const body = h('div', { class: 'modal-body form' },
    prev, fileRow,
    field('الاسم', name), field('الوصف', desc),
    h('div', { class: 'grid2' }, field('السعر (' + (data.settings.currency || '') + ')', price), field('الفئة', cat)),
    field('المكونات', ing),
    h('label', { class: 'chk' }, av, 'متوفر حاليا'));
  const foot = h('div', { class: 'modal-foot' },
    h('button', { class: 'btn dark', type: 'button', onclick: () => run(async () => { await save(false); await finish('تم الحفظ'); }) }, d.id ? 'حفظ التغييرات' : 'إضافة الطبق'),
    h('button', { class: 'btn ghost', type: 'button', onclick: closeDishForm }, 'إلغاء'),
    h('div', { class: 'row-inline', style: 'margin-inline-start:auto' },
      d.id ? h('button', { class: 'btn ghost', type: 'button', onclick: () => run(async () => { await save(true); await finish('تم نسخ الطبق'); }) }, 'نسخ') : null,
      d.image ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { d.image = ''; prev.style.backgroundImage = ''; prev.textContent = 'لا صورة'; } }, 'إزالة الصورة') : null,
      d.id ? h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { if (confirm('حذف هذا الطبق نهائيا؟')) run(async () => { await api('DELETE', '/api/dishes/' + d.id); await finish('تم الحذف'); }); } }, 'حذف') : null));

  const card = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.id ? 'تعديل الطبق' : 'طبق جديد' },
    h('div', { class: 'modal-head' }, h('h3', {}, d.id ? 'تعديل الطبق' : 'طبق جديد'), closeBtn),
    body, foot);
  const el = h('div', { class: 'modal-overlay', onclick: e => { if (e.target === el) closeDishForm(); } }, card);
  document.body.append(el);
  document.body.classList.add('locked');

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); return closeDishForm(); }
    if (e.key !== 'Tab') return;
    const f = [...card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  };
  document.addEventListener('keydown', onKey);
  modal = { el, onKey };
  name.focus();
}

function upload(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('لم يتم اختيار ملف'));
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return reject(new Error('صيغة غير مدعومة (PNG / JPG / WEBP)'));
    const fr = new FileReader(); fr.onerror = () => reject(new Error('تعذر قراءة الملف'));
    fr.onload = () => api('POST', '/api/upload', { data: fr.result }).then(r => resolve(r.url), reject);
    fr.readAsDataURL(file);
  });
}

/* ---------- categories ---------- */
function vCategories() {
  const nn = h('input', { class: 'input', placeholder: 'اسم الفئة الجديدة', 'aria-label': 'اسم الفئة الجديدة', maxlength: '60', style: 'max-width:320px' });
  const move = (i, dir) => run(async () => {
    const ids = data.categories.map(c => c.id), j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('POST', '/api/categories/reorder', { ids }); await reload(); await draw();
  });
  const rows = data.categories.map((c, i) => {
    const n = data.dishes.filter(d => d.category === c.id).length;
    const name = h('input', { class: 'input grow', value: c.name, 'aria-label': 'اسم الفئة', maxlength: '60' });
    return h('div', { class: 'crow' }, name, h('span', { class: 'muted' }, n + ' أطباق'),
      h('button', { class: 'btn ghost', 'aria-label': 'أعلى', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'btn ghost', 'aria-label': 'أسفل', disabled: i === data.categories.length - 1, onclick: () => move(i, 1) }, '↓'),
      h('button', { class: 'btn ghost ' + (c.visible ? 'ok' : 'no'), onclick: () => run(async () => { await api('PUT', '/api/categories/' + c.id, { visible: !c.visible }); await reload(); await draw(); }) }, c.visible ? '● ظاهرة' : '● مخفية'),
      h('button', { class: 'btn ghost', onclick: () => run(async () => { await api('PUT', '/api/categories/' + c.id, { name: name.value }); await reload(); await draw(); }, 'تم الحفظ') }, 'حفظ'),
      h('button', { class: 'btn ghost', style: 'color:var(--bad)', onclick: () => { if (confirm('حذف الفئة؟')) run(async () => { await api('DELETE', '/api/categories/' + c.id); await reload(); await draw(); }, 'تم الحذف'); } }, 'حذف'));
  });
  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'الفئات'), h('div', { class: 'row-inline' }, nn, h('button', { class: 'btn', onclick: () => run(async () => { if (!nn.value.trim()) throw new Error('اكتب اسم الفئة'); await api('POST', '/api/categories', { name: nn.value }); await reload(); await draw(); }, 'تمت الإضافة') }, '+ إضافة'))),
    h('section', { class: 'card', style: 'max-width:1000px' }, rows.length ? rows : h('p', { class: 'empty' }, 'لا توجد فئات.')),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'استعمل الأسهم لتغيير ترتيب ظهور الفئات عند الزبون. الفئة المخفية لا تظهر في القائمة.'));
}

/* ---------- QR ---------- */
function vQr() {
  const base = h('input', { class: 'input', value: data.settings.baseUrl || '', placeholder: 'https://menu.example.com (اختياري)', 'aria-label': 'رابط الموقع' });
  const n = h('input', { class: 'input', type: 'number', min: '1', max: '200', value: data.settings.tables, 'aria-label': 'عدد الطاولات', style: 'max-width:120px' });
  const origin = (data.settings.baseUrl || location.origin).replace(/\/+$/, '');
  const cards = [];
  for (let i = 1; i <= data.settings.tables; i++) {
    const link = `${origin}/?table=${i}`;
    cards.push(h('div', { class: 'card qrc' }, h('img', { src: '/api/qr?text=' + encodeURIComponent(link), alt: 'رمز QR للطاولة ' + i, loading: 'lazy' }), h('strong', {}, 'طاولة ' + i),
      h('a', { class: 'btn ghost noprint', href: '/api/qr?text=' + encodeURIComponent(link) + '&download=1', download: `table-${i}.svg` }, 'تحميل SVG')));
  }
  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'رموز QR للطاولات'), h('div', { class: 'actions noprint' }, h('button', { class: 'btn ghost', onclick: () => window.print() }, 'طباعة الكل'))),
    h('section', { class: 'card pad form noprint' },
      h('div', { class: 'grid2' }, field('رابط الموقع داخل الرمز', base), field('عدد الطاولات', n)),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn', onclick: () => run(async () => { await api('PUT', '/api/settings', { baseUrl: base.value, tables: n.value }); await reload(); await draw(); }, 'تم إنشاء الرموز') }, 'حفظ وإنشاء'),
        h('span', { class: 'muted', style: 'font-size:13px' }, 'اترك الرابط فارغا لاستعمال عنوان الصفحة الحالي.')),
      h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'افتح لوحة التحكم من الدومين النهائي قبل الطباعة، حتى تفتح الرموز على الرابط الصحيح.')),
    h('div', { class: 'qrs' }, cards));
}

/* ---------- look ---------- */
function vLook() {
  const s = { ...data.settings };
  if (!['warm', 'noir', 'mint'].includes(s.theme)) s.theme = 'warm';
  const COLORS = ['#C2410C', '#B91C1C', '#2F6B4F', '#1D4ED8', '#7C3AED', '#1F1A17'];
  const PRESETS = [
    { id: 'warm', name: 'دافئ', desc: 'كريمي دافئ — المظهر الأساسي', accent: '' },
    { id: 'noir', name: 'ليلي', desc: 'خلفية داكنة مريحة للعين', accent: '#E8983F' },
    { id: 'mint', name: 'عصري', desc: 'ألوان باردة وزوايا أنعم', accent: '#1F7A5C' }
  ];
  const prevBtn = h('div', { style: 'height:40px;border-radius:12px;background:var(--pacc)' });
  const prevChip = h('span', { style: 'color:#fff;border-radius:14px;padding:6px 12px;font-size:12px;align-self:flex-start;background:var(--pacc)' }, 'الكل');
  const dishRow = n => h('div', { class: 'pv-row' }, h('div', { class: 'pv-th' }),
    h('div', { class: 'pv-lines' }, h('b', {}, n), h('em', {}, '00 ' + (s.currency || ''))));
  const prev = h('div', { class: 'prev t-' + s.theme, 'aria-label': 'معاينة صفحة الزبون' },
    h('strong', {}, s.name || 'اسم المطعم'), prevChip, dishRow('اسم الطبق'), dishRow('طبق آخر'), prevBtn);
  const sw = COLORS.map(c => h('button', { type: 'button', 'data-c': c, style: 'background:' + c, 'aria-label': 'اللون ' + c, onclick: () => setColor(c) }));
  const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#C2410C', 'aria-label': 'لون مخصص', oninput: () => setColor(pick.value), style: 'width:44px;height:44px;border:0;background:none;padding:0' });
  const presets = h('div', { class: 'presets' }, PRESETS.map(p => h('button', {
    class: 'preset', type: 'button', 'data-t': p.id, 'aria-pressed': String(s.theme === p.id),
    onclick: () => applyPreset(p.id)
  }, h('span', { class: 'pv t-' + p.id, 'aria-hidden': 'true' }, h('i', { class: 'pv-h' }), h('i', { class: 'pv-r' }), h('i', { class: 'pv-b' })),
    h('span', { class: 'pv-tx' }, h('strong', {}, p.name), h('small', {}, p.desc)))));
  function setColor(c) {
    s.color = c; s.themeAccent = '';
    prev.style.setProperty('--pacc', c);
    sw.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === c.toLowerCase())));
  }
  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id) || PRESETS[0];
    s.theme = p.id; prev.className = 'prev t-' + p.id;
    presets.querySelectorAll('.preset').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === p.id)));
    s.themeAccent = p.accent; prev.style.setProperty('--pacc', s.themeAccent || s.color);
  }
  const layoutBtns = [['list', 'قائمة'], ['grid', 'شبكة']].map(([k, n]) => h('button', { type: 'button', class: 'btn ' + (s.layout === k ? 'dark' : 'ghost'), onclick: e => { s.layout = k; layoutBtns.forEach(b => (b.className = 'btn ghost')); e.currentTarget.className = 'btn dark'; } }, n));
  const initAccent = s.themeAccent;
  setColor(s.color);
  if (initAccent) { s.themeAccent = initAccent; prev.style.setProperty('--pacc', initAccent); }
  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'المظهر والألوان'), h('div', { class: 'actions' },
      h('a', { class: 'btn ghost', href: '/', target: '_blank', rel: 'noopener' }, 'فتح صفحة الزبون'),
      h('button', { class: 'btn', onclick: () => run(async () => { await api('PUT', '/api/settings', { color: s.color, layout: s.layout, theme: s.theme, themeAccent: s.themeAccent }); await reload(); await draw(); }, 'تم نشر المظهر على صفحة الزبون') }, 'نشر التغييرات'))),
    h('div', { class: 'split' },
      h('section', { class: 'card pad form' },
        h('div', { class: 'lbl' }, 'اللون الرئيسي', h('div', { class: 'sw' }, sw, pick)),
        h('div', { class: 'lbl' }, 'مظهر جاهز (يُطبَّق على صفحة الزبون فقط)', presets),
        h('div', { class: 'lbl' }, 'شكل بطاقات الأطباق', h('div', { class: 'sw' }, layoutBtns)),
        h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'اختيار مظهر جاهز يضبط الألوان والزوايا لصفحة الزبون، ويمكنك بعدها تعديل اللون الرئيسي كما تشاء. لوحة التحكم لا تتأثر. لإضافة صورة المطعم استعمل تبويب «الإعدادات».')),
      prev));
}

/* ---------- settings ---------- */
function logoCard() {
  const s = data.settings;
  const prev = h('div', { class: 'logo-prev', style: s.logo ? `background-image:url('${s.logo}')` : '' }, s.logo ? null : (s.name || 'م').trim().charAt(0));
  const hint = h('span', { class: 'file-hint' }, s.logo ? 'الصورة الحالية' : 'لم تُضف صورة بعد');
  const pick = h('button', { class: 'btn ghost', type: 'button' }, s.logo ? 'تغيير الصورة' : 'إضافة صورة');
  const input = h('input', {
    class: 'file-input', type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'صورة المطعم',
    onchange: () => run(async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) throw new Error('صيغة غير مدعومة (PNG / JPG / WEBP)');
      if (f.size > 4 * 1024 * 1024) throw new Error('الصورة أكبر من 4MB');
      const label = pick.textContent;
      pick.disabled = true; pick.textContent = 'جارٍ الرفع...';
      try {
        const url = await upload(f);
        await api('PUT', '/api/settings', { logo: url });
        await reload(); await draw(); toast('تم حفظ صورة المطعم');
      } finally {
        pick.disabled = false; pick.textContent = label; input.value = '';
      }
    }, null)
  });
  pick.addEventListener('click', () => input.click());
  const remove = s.logo ? h('button', { class: 'btn ghost danger', type: 'button', onclick: () => run(async () => {
    await api('PUT', '/api/settings', { logo: '' }); await reload(); await draw(); toast('تم حذف الصورة');
  }) }, 'إزالة الصورة') : null;
  return h('section', { class: 'card pad form' },
    h('div', { class: 'head', style: 'gap:8px' }, h('strong', { style: 'font-size:17px' }, 'صورة المطعم'),
      h('span', { class: 'muted', style: 'font-size:13px' }, 'تظهر بجانب اسم المطعم في القائمة ولوحة التحكم')),
    h('div', { class: 'logo-row' }, prev,
      h('div', { class: 'form', style: 'gap:8px;flex:1;min-width:180px' },
        h('div', { class: 'file-row' }, pick, remove || null, input),
        hint)));
}

function vSettings() {
  const s = data.settings, F = {};
  const txt = (k, label, ph) => { F[k] = h('input', { class: 'input', value: s[k] || '', maxlength: '160', placeholder: ph || '' }); return field(label, F[k]); };
  const num = (k, label) => { F[k] = h('input', { class: 'input', type: 'number', min: '0', step: '0.5', value: s[k] ?? 0 }); return field(label + ' (' + (s.currency || '') + ')', F[k]); };
  const restoreFile = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const payload = JSON.parse(await f.text());
      const r = await api('POST', '/api/restore', payload);
      await reload(); await draw();
      toast('تمت الاستعادة: ' + r.dishes + ' طبقا و' + r.orders + ' طلبا');
    } catch (err) { toast('فشل الاستعادة: ' + (err.message || '')); }
    e.target.value = '';
  } });
  const tog = (k, label) => { F[k] = h('input', { type: 'checkbox', checked: s[k] }); return h('label', { class: 'chk' }, F[k], label); };
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'كلمة مرور جديدة (6 أحرف على الأقل)', 'aria-label': 'كلمة مرور جديدة' });
  return h('div', { class: 'form settings-form', style: 'max-width:900px' },
    h('div', { class: 'head' }, h('h2', {}, 'الإعدادات'), h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: () => downloadBackup() }, 'نسخة احتياطية'),
      h('button', { class: 'btn ghost', onclick: () => restoreFile.click() }, 'استعادة'),
      restoreFile, h('button', { class: 'btn', onclick: () => run(async () => {
        const b = {}; for (const k in F) b[k] = F[k].type === 'checkbox' ? F[k].checked : F[k].value;
        await api('PUT', '/api/settings', b); await reload(); await draw();
      }, 'تم الحفظ') }, 'حفظ'))),
    logoCard(),
    h('section', { class: 'card pad grid2' }, txt('name', 'اسم المطعم'), txt('tagline', 'العبارة التعريفية'), txt('currency', 'العملة'), txt('phone', 'رقم الهاتف'), txt('whatsapp', 'واتساب', 'رقم الهاتف أو رابط wa.me'), txt('instagram', 'إنستغرام', '@اسم_المستخدم أو الرابط'), txt('facebook', 'فيسبوك', 'اسم الصفحة أو الرابط'), txt('hours', 'ساعات العمل'), txt('address', 'العنوان'), txt('languages', 'اللغات'), txt('orderNote', 'ملاحظة تظهر في صفحة الطلب')),
    h('section', { class: 'card pad grid2' },
      num('deliveryFee', 'رسوم التوصيل'), num('minOrder', 'الحد الأدنى للتوصيل'),
      txt('prepTime', 'مدة التحضير (نص يظهر للزبون)', 'مثال: 20–30 دقيقة'),
      txt('payments', 'طرق الدفع (افصل بينها بـ ·)', 'نقدًا عند الاستلام · تحويل بنكي')),
    h('section', { class: 'card pad form' },
      tog('ordersEnabled', 'استقبال الطلبات من الزبائن'),
      tog('showPrices', 'عرض الأسعار للزبون'),
      tog('showUnavailable', 'عرض الأطباق غير المتوفرة'),
      h('div', { class: 'row-inline' }, h('button', { class: 'btn ghost', onclick: () => run(async () => { const r = await api('POST', '/api/cleanup'); toast('حُذف ' + r.removed + ' ملفا غير مستعمل'); }, null) }, 'تنظيف الصور غير المستعملة'))),
    h('section', { class: 'card pad form' }, h('strong', {}, 'كلمة مرور الأدمن'), pw,
      h('button', { class: 'btn dark', style: 'align-self:flex-start', onclick: () => run(async () => { await api('POST', '/api/password', { password: pw.value }); pw.value = ''; sessionStorage.removeItem('mc'); await draw(); }, 'تم تغيير كلمة المرور') }, 'تغيير كلمة المرور')));
}
async function downloadBackup() {
  try {
    const r = await fetch('/api/backup', { headers: { 'x-token': token() } });
    if (!r.ok) throw new Error('تعذر إنشاء النسخة');
    const blob = await r.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: 'digital-menu-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('نسخة احتياطية تشمل القائمة والطلبات');
  } catch (e) { toast(e.message || 'فشل'); }
}

/* ---------- orders (table + detail panel) ---------- */
const FILTERS = [['active', 'قيد العمل'], ['all', 'الكل'], ['new', 'جديدة'], ['preparing', 'قيد التحضير'], ['ready', 'جاهزة'], ['done', 'منجزة'], ['canceled', 'ملغاة']];
const orderKind = o => (o.type === 'delivery' ? 'توصيل' : o.table ? 'طاولة ' + o.table : 'على الطاولة');
const mapLink = addr => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
const posLink = o => (Number.isFinite(o.lat) && Number.isFinite(o.lng))
  ? 'https://www.google.com/maps?q=' + o.lat + ',' + o.lng
  : (o.address ? mapLink(o.address) : '');
const SHORT = id => String(id).slice(-6).toUpperCase();
const initials = n => (String(n || 'زبون').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || 'ز');
const hue = n => { let x = 0; for (const c of String(n || 'x')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const avatar = (name, size) => h('span', {
  class: 'oav', 'aria-hidden': 'true',
  style: `--h:${hue(name)};` + (size ? `width:${size}px;height:${size}px;font-size:${Math.round(size / 2.7)}px` : '')
}, initials(name));
const waHref = p => 'https://wa.me/' + String(p || '').replace(/\D/g, '').replace(/^0/, '212');

function closeMenus() { document.querySelectorAll('.kmenu').forEach(m => m.remove()); }
function openMenu(anchor, items) {
  closeMenus();
  const m = h('div', { class: 'kmenu', role: 'menu' },
    items.map(([label, fn, danger]) => h('button', { type: 'button', role: 'menuitem', class: danger ? 'danger' : '', onclick: () => { m.remove(); fn(); } }, label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth || 180, hh = m.offsetHeight || 120;
  m.style.top = Math.max(8, Math.min(innerHeight - hh - 8, r.bottom + 6)) + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width - w)) + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', function out(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', out); } });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', esc); } });
  }, 0);
}

let orderSort = 'new', openOrderId = null, orderSel = new Set();

function vOrders() {
  const byStatus = o => orderFilter === 'all' ? true : orderFilter === 'active' ? (o.status === 'new' || o.status === 'preparing' || o.status === 'ready') : o.status === orderFilter;
  const inRange = o => {
    if (orderRange === 'all') return true;
    const d = new Date(o.createdAt), now = new Date();
    if (orderRange === 'today') return d.toDateString() === now.toDateString();
    return Date.now() - d.getTime() <= Number(orderRange) * 864e5;
  };
  const needle = orderQuery.trim().toLowerCase();
  const match = o => {
    if (!byStatus(o) || !inRange(o)) return false;
    if (orderType !== 'all' && (o.type || 'dinein') !== orderType) return false;
    if (!needle) return true;
    return [o.id, o.name, o.phone, o.table, o.address, o.note].filter(Boolean).join(' ').toLowerCase().includes(needle);
  };
  const SORT = {
    new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    old: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    total: (a, b) => (Number(b.total) || 0) - (Number(a.total) || 0),
    status: (a, b) => STEPS.indexOf(a.status) - STEPS.indexOf(b.status) || new Date(b.createdAt) - new Date(a.createdAt)
  };
  const visible = () => orders.filter(match).sort(SORT[orderSort] || SORT.new);
  const current = () => orders.find(o => o.id === openOrderId) || null;
  const isNarrow = () => innerWidth < 1280;

  async function setStatus(o, s) {
    await run(async () => { await api('PUT', '/api/orders/' + o.id, { status: s }); o.status = s; await draw(); }, 'تم تحديث حالة الطلب');
  }
  const nextStatus = o => STEPS[Math.min(STEPS.indexOf(o.status) + 1, STEPS.length - 1)];
  function cycle(o) {
    if (o.status === 'canceled') return setStatus(o, 'new');
    if (o.status === 'done') return;
    setStatus(o, nextStatus(o));
  }
  function delOrder(o) {
    if (!confirm('حذف هذا الطلب نهائيا؟')) return;
    run(async () => { await api('DELETE', '/api/orders/' + o.id); orders = orders.filter(x => x.id !== o.id); orderSel.delete(o.id); if (openOrderId === o.id) openOrderId = null; await draw(); }, 'تم حذف الطلب');
  }
  function openDetail(o) {
    openOrderId = o.id; paint();
    if (isNarrow()) { detailHost.classList.add('open'); ov.classList.add('on'); document.body.classList.add('od-open'); }
    const c = detailHost.querySelector('.od-close'); if (c) c.focus({ preventScroll: true });
  }
  function closeDetail() {
    openOrderId = null; detailHost.classList.remove('open'); ov.classList.remove('on');
    document.body.classList.remove('od-open'); paint();
  }

  /* ---------- detail panel ---------- */
  const dishImg = id => (data.dishes.find(d => d.id === id) || {}).image;
  function panel() {
    const o = current();
    if (!o) return h('div', { class: 'oempty' },
      h('span', { class: 'big', 'aria-hidden': 'true' }, '🧾'),
      h('strong', {}, 'اختر طلبًا لعرض تفاصيله'),
      h('p', { class: 'muted' }, 'انقر أي صف في الجدول، أو اضغط شارة الحالة لتغييرها مباشرة.'));
    return h('div', { class: 'od-inner' },
      h('div', { class: 'od-head' },
        h('div', { class: 'od-idbox' }, h('span', { class: 'od-id' }, '#' + SHORT(o.id)),
          h('span', { class: 'pill-status', 'data-s': o.status }, ST[o.status])),
        h('button', { class: 'od-close', type: 'button', 'aria-label': 'إغلاق التفاصيل', onclick: closeDetail }, '✕')),
      h('div', { class: 'od-meta' },
        h('span', { class: 'muted' }, relTime(o.createdAt), h('span', { class: 'od-sep' }, '·'), fmtTs(o.createdAt)),
        o.payment ? h('span', { class: 'pay-chip' }, '💳 ' + o.payment) : null),
      h('div', { class: 'od-cust' }, avatar(o.name, 54),
        h('div', { class: 'od-cust-tx' },
          h('strong', {}, o.name || 'زبون'),
          h('span', { class: 'muted' }, orderKind(o) + (o.phone ? ' · ' + o.phone : '')))),
      (o.phone || posLink(o)) ? h('div', { class: 'od-contact' },
        o.phone ? h('a', { class: 'ocbtn', href: 'tel:' + o.phone, title: 'اتصال هاتفي', 'aria-label': 'اتصال' }, '📞') : null,
        o.phone ? h('a', { class: 'ocbtn', href: waHref(o.phone), target: '_blank', rel: 'noopener noreferrer', title: 'مراسلة واتساب', 'aria-label': 'واتساب' }, '💬') : null,
        posLink(o) ? h('a', { class: 'ocbtn', href: posLink(o), target: '_blank', rel: 'noopener noreferrer', title: 'الموقع على الخريطة', 'aria-label': 'الخريطة' }, '📍') : null) : null,
      o.type === 'delivery' && o.address ? h('div', { class: 'od-addr' }, h('b', {}, 'العنوان'), o.address) : null,
      h('div', { class: 'od-sub' }, h('span', {}, 'أصناف الطلب'), h('span', { class: 'muted' }, (o.items || []).length + ' صنف')),
      h('div', { class: 'od-items' }, (o.items || []).map(i => {
        const img = dishImg(i.id);
        return h('div', { class: 'od-item' },
          h('span', { class: 'od-th', style: img ? `background-image:url('${img}')` : '', 'aria-hidden': 'true' }, img ? null : '🍽️'),
          h('span', { class: 'od-iname' }, h('b', {}, `${i.qty}× ${i.name}`), h('small', {}, money(i.price) + ' للوحدة')),
          h('strong', { class: 'od-iprice' }, money(i.price * i.qty)));
      })),
      o.note ? h('div', { class: 'od-note' }, '📝 ' + o.note) : null,
      h('div', { class: 'od-totals' },
        h('div', { class: 'line' }, h('span', {}, 'المجموع الفرعي'), h('span', {}, money(o.subtotal ?? o.total))),
        o.deliveryFee ? h('div', { class: 'line' }, h('span', {}, 'رسوم التوصيل'), h('span', {}, money(o.deliveryFee))) : null,
        h('div', { class: 'line total' }, h('span', {}, 'الإجمالي'), h('strong', {}, money(o.total)))),
      h('div', { class: 'od-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => cycle(o), disabled: o.status === 'done' }, o.status === 'canceled' ? 'إعادة الطلب' : (o.status === 'done' ? 'مكتمل' : 'نقل إلى: ' + ST[nextStatus(o)])),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => printReceipt(o) }, '🖨 طباعة'),
        h('button', { class: 'btn ghost', type: 'button', style: 'color:var(--bad)', onclick: () => delOrder(o) }, 'حذف'),
        h('select', { class: 'input od-select', 'aria-label': 'تغيير الحالة', title: 'تغيير الحالة مباشرة', onchange: e => setStatus(o, e.target.value) },
          Object.keys(ST).map(k => h('option', { value: k, selected: k === o.status }, ST[k])))));
  }

  /* ---------- table ---------- */
  const chk = (o) => {
    const c = h('input', { type: 'checkbox', 'aria-label': 'تحديد الطلب ' + SHORT(o.id), checked: orderSel.has(o.id), onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? orderSel.add(o.id) : orderSel.delete(o.id); paint(); } });
    return c;
  };
  const QK = {
    new: ['▶', 'بدء التحضير', 'بدء'],
    preparing: ['✔', 'جاهزة للتسليم', 'جاهز'],
    ready: ['✓', 'تم التسليم', 'تسليم'],
    canceled: ['↺', 'إعادة الطلب', 'إعادة'],
    done: ['✓', 'منجزة', 'منجزة']
  };
  function quickBtn(o, withLabel) {
    const q = QK[o.status] || QK.new;
    const disabled = o.status === 'done';
    return h('button', {
      class: 'qbtn' + (withLabel ? ' wide' : '') + (disabled ? ' is-done' : ''),
      type: 'button', disabled,
      title: disabled ? 'الطلب منجز' : q[1],
      'aria-label': disabled ? 'الطلب منجز' : q[1],
      onclick: e => { e.stopPropagation(); if (!disabled) cycle(o); }
    }, h('span', { class: 'qico', 'aria-hidden': 'true' }, q[0]), withLabel ? h('span', { class: 'qtxt' }, q[2]) : null);
  }

  function row(o) {
    const late = o.status === 'new' && Date.now() - new Date(o.createdAt).getTime() >= 10 * 6e4;
    return h('div', {
      class: 'orow s-' + o.status + (openOrderId === o.id ? ' active' : ''),
      role: 'row', tabindex: '0', 'aria-selected': String(openOrderId === o.id),
      onclick: () => openDetail(o),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(o); } }
    },
      h('span', { class: 'ocell ochk' }, chk(o)),
      h('span', { class: 'ocell oid' }, '#' + SHORT(o.id)),
      h('span', { class: 'ocell ocust' }, avatar(o.name),
        h('span', { class: 'ocust-tx' }, h('b', {}, o.name || 'زبون'),
          h('small', {}, (o.type === 'delivery' ? '🛵 ' : '🍽️ ') + orderKind(o),
            o.phone ? h('span', { class: 'o-phone' }, ' · ' + o.phone) : null))),
      h('span', { class: 'ocell ost' },
        h('button', { class: 'pill-status', 'data-s': o.status, type: 'button', title: 'اضغط لنقل الطلب للمرحلة التالية', onclick: e => { e.stopPropagation(); cycle(o); } }, ST[o.status] || o.status)),
      h('span', { class: 'ocell otot' }, money(o.total)),
      h('span', { class: 'ocell odate' + (late ? ' late' : '') }, late ? '⏰ ' : '', relTime(o.createdAt)),
      h('span', { class: 'ocell okebab' },
        quickBtn(o, true),
        h('button', { class: 'kbtn', type: 'button', 'aria-label': 'خيارات الطلب ' + SHORT(o.id), onclick: e => { e.stopPropagation(); openMenu(e.currentTarget, [['عرض التفاصيل', () => openDetail(o)], ['طباعة الإيصال', () => printReceipt(o)], ['حذف الطلب', () => delOrder(o), true]]); } }, '⋮')));
  }

  /* ---------- grid card ---------- */
  const card = o => {
    const late = o.status === 'new' && Date.now() - new Date(o.createdAt).getTime() >= 10 * 6e4;
    const all = o.items || [], shown = all.slice(0, 2), extra = all.length - shown.length;
    return h('div', { class: 'order s-' + o.status + (o.status === 'new' ? ' urgent' : ''), tabindex: '0',
      onclick: e => { if (e.target.closest('button,select,a')) return; openDetail(o); },
      onkeydown: e => { if (e.key === 'Enter') openDetail(o); } },
      h('div', { class: 'top' },
        h('div', { class: 'who' },
          h('span', { class: 'otype ' + (o.type === 'delivery' ? 'delivery' : 'dinein') }, (o.type === 'delivery' ? '🛵 ' : '🍽️ ') + orderKind(o)),
          h('span', { class: 'oid-sm' }, '#' + SHORT(o.id)),
          o.name ? h('strong', { class: 'cust' }, o.name) : null,
          o.phone ? h('span', { class: 'phone' }, '📞 ' + o.phone) : null),
        h('div', { class: 'meta' },
          h('span', { class: 'muted ts' + (late ? ' late' : '') }, (late ? '⏰ ' : '') + relTime(o.createdAt)),
          h('button', { class: 'pill-status', 'data-s': o.status, type: 'button', title: 'نقل للمرحلة التالية', onclick: e => { e.stopPropagation(); cycle(o); } }, ST[o.status] || o.status))),
      o.type === 'delivery' && (o.address || Number.isFinite(o.lat)) ? h('div', { class: 'addr' }, '📍 ', o.address || 'الموقع على الخريطة') : null,
      h('div', { class: 'items' }, shown.map(i => h('span', {}, h('b', {}, `${i.qty}× ${i.name}`), h('span', {}, money(i.price * i.qty)))),
        extra > 0 ? h('span', { class: 'more-items' }, '+' + extra + ' أصناف أخرى') : null),
      h('div', { class: 'acts' },
        h('strong', { style: 'margin-inline-end:auto' }, money(o.total)),
        quickBtn(o, true),
        h('button', { class: 'btn ghost', type: 'button', onclick: e => { e.stopPropagation(); printReceipt(o); } }, 'طباعة'),
        h('button', { class: 'btn ghost', type: 'button', style: 'color:var(--bad)', onclick: e => { e.stopPropagation(); delOrder(o); } }, 'حذف')));
  };

  /* ---------- shell ---------- */
  const listHost = h('div', { class: 'olist-body' });
  const countEl = h('span', { class: 'ocount' });
  const more = h('button', { class: 'btn ghost load-more', type: 'button', onclick: () => { orderLimit += 40; paint(); } }, 'تحميل المزيد');
  const detailHost = h('aside', { class: 'odetail', id: 'order-detail', 'aria-label': 'تفاصيل الطلب' });
  const ov = h('div', { class: 'odetail-ov', onclick: closeDetail });
  const allChk = h('input', { type: 'checkbox', 'aria-label': 'تحديد كل الطلبات المعروضة', onclick: e => e.stopPropagation(), onchange: e => { visible().slice(0, orderLimit).forEach(o => e.target.checked ? orderSel.add(o.id) : orderSel.delete(o.id)); paint(); } });
  const bulkCount = h('strong', { class: 'obulk-n' });
  const bulk = h('div', { class: 'obulk', hidden: true },
    bulkCount,
    h('select', { class: 'input', 'aria-label': 'تغيير حالة الطلبات المحددة', onchange: e => {
      const s = e.target.value; e.target.value = '';
      if (!s) return;
      const list = [...orderSel];
      run(async () => {
        for (const id of list) await api('PUT', '/api/orders/' + id, { status: s });
        await reload(); await draw();
      }, 'تم تحديث ' + list.length + ' طلبا');
    } }, [['', 'تغيير الحالة…'], ...Object.entries(ST).map(([k, v]) => [k, v])].map(([v, t]) => h('option', { value: v }, t))),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => exportCSV(orders.filter(o => orderSel.has(o.id))) }, 'تصدير'),
    h('button', { class: 'btn ghost danger', type: 'button', onclick: () => {
      if (!confirm('حذف ' + orderSel.size + ' طلبا محددا؟')) return;
      const list = [...orderSel];
      run(async () => { for (const id of list) await api('DELETE', '/api/orders/' + id); orders = orders.filter(o => !orderSel.has(o.id)); orderSel.clear(); await draw(); }, 'تم حذف الطلبات');
    } }, 'حذف'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { orderSel.clear(); paint(); } }, 'إلغاء'));

  const viewBtns = [['list', 'قائمة', '☰'], ['grid', 'شبكة', '▦']].map(([v, n, ic]) =>
    h('button', { 'data-v': v, type: 'button', 'aria-pressed': String(orderView === v), title: v === 'grid' ? 'عرض شبكة' : 'عرض جدول', onclick: () => setView(v) },
      h('span', { 'aria-hidden': 'true', style: 'font-size:15px' }, ic), ' ', n));
  const viewToggle = h('div', { class: 'filters view-toggle', role: 'group', 'aria-label': 'شكل عرض الطلبات' }, viewBtns);
  function setView(v) {
    orderView = v === 'grid' ? 'grid' : 'list';
    try { localStorage.setItem('dm_order_view', orderView); } catch {}
    viewBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === orderView)));
    paint();
  }

  const search = h('input', { class: 'input grow osearch', type: 'search', value: orderQuery, placeholder: 'ابحث بالاسم، الهاتف، رقم الطلب أو الطاولة…', 'aria-label': 'بحث في الطلبات', oninput: e => { orderQuery = e.target.value; orderLimit = 40; paint(); } });
  const sel = (val, opts, onch, label) => h('select', { class: 'input ofilter', 'aria-label': label, onchange: e => { onch(e.target.value); } },
    opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));
  const statusSel = sel(orderFilter, FILTERS.map(([k, n]) => [k, n]), v => { orderFilter = v; draw(); }, 'تصفية بالحالة');
  const typeSel = sel(orderType, [['all', 'كل الأنواع'], ['dinein', 'على الطاولة'], ['delivery', 'توصيل']], v => { orderType = v; draw(); }, 'تصفية بالنوع');
  const rangeSel = sel(orderRange, [['all', 'كل الفترات'], ['today', 'اليوم'], ['7', 'آخر 7 أيام'], ['30', 'آخر 30 يوما']], v => { orderRange = v; draw(); }, 'الفترة');
  const sortSel = sel(orderSort, [['new', 'الأحدث أولا'], ['old', 'الأقدم أولا'], ['total', 'الأعلى قيمة'], ['status', 'حسب الحالة']], v => { orderSort = v; paint(); }, 'ترتيب');

  function paint() {
    closeMenus();
    orderSel.forEach(id => { if (!orders.some(x => x.id === id)) orderSel.delete(id); });
    if (openOrderId && !orders.some(x => x.id === openOrderId)) openOrderId = null;
    const vis = visible();
    const page = vis.slice(0, orderLimit);
    const o = current();
    listHost.className = 'olist-body';
    if (orderView === 'grid') {
      listHost.className = 'orders grid';
      const emptyCard = h('section', { class: 'card' }, h('p', { class: 'empty' }, orders.length ? 'لا توجد طلبات مطابقة.' : 'لا توجد طلبات بعد.'));
      listHost.replaceChildren(...(page.length ? page.map(card) : [emptyCard]));
    } else {
      const head = h('div', { class: 'orow ohead', role: 'row' },
        h('span', { class: 'ocell ochk' }, allChk),
        h('span', { class: 'ocell oid' }, 'الطلب'),
        h('span', { class: 'ocell ocust' }, 'الزبون'),
        h('span', { class: 'ocell ost' }, 'الحالة'),
        h('span', { class: 'ocell otot' }, 'الإجمالي'),
        h('span', { class: 'ocell odate' }, 'التاريخ'),
        h('span', { class: 'ocell okebab' }));
      const emptyMsg = h('p', { class: 'empty' }, orders.length ? 'لا توجد طلبات مطابقة لبحثك.' : 'لا توجد طلبات بعد — ستظهر هنا لحظة وصولها.');
      listHost.replaceChildren(...(page.length
        ? [h('div', { class: 'otable', role: 'table' }, head, ...page.map(row))]
        : [h('div', { class: 'otable' }, head), emptyMsg]));
    }
    detailHost.replaceChildren(panel());
    detailHost.classList.toggle('open', !!o && isNarrow());
    ov.classList.toggle('on', !!o && isNarrow());
    document.body.classList.toggle('od-open', !!o && isNarrow());
    countEl.textContent = vis.length ? 'عرض ' + page.length + ' من ' + vis.length + ' طلبا · ' + money(vis.reduce((a, x) => a + (Number(x.total) || 0), 0)) : 'لا نتائج';
    more.hidden = vis.length <= page.length;
    const n = orderSel.size;
    bulk.hidden = n === 0;
    bulkCount.textContent = n + ' محدد';
    if (allChk) allChk.checked = page.length > 0 && page.every(x => orderSel.has(x.id));
  }
  paint();

  return h('div', { class: 'form' },
    h('div', { class: 'head' }, h('h2', {}, 'الطلبات'), h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => refreshOrders(false) }, 'تحديث'),
      h('button', { class: 'btn ghost', type: 'button', title: 'التنبيه الصوتي', onclick: () => { sound = !sound; try { localStorage.setItem('dm_sound', sound ? '1' : '0'); } catch {} toast(sound ? '🔔 التنبيه مفعّل' : '🔕 التنبيه مكتوم'); } }, sound ? '🔔' : '🔕'),
      'Notification' in window && Notification.permission !== 'granted' ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { const p = await Notification.requestPermission(); toast(p === 'granted' ? 'تم تفعيل إشعارات المتصفح' : 'لم يُسمح بالإشعارات'); await draw(); } catch { toast('تعذر تفعيل الإشعارات'); } } }, 'إشعارات المتصفح') : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => exportCSV(visible()) }, 'تصدير CSV'),
      viewToggle)),
    h('div', { class: 'ofilters' }, search, statusSel, typeSel, rangeSel, sortSel),
    h('div', { class: 'olayout' },
      h('section', { class: 'ocard' },
        listHost,
        h('div', { class: 'ofoot' }, countEl, more)),
      detailHost),
    ov, bulk,
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'تحديث تلقائي كل 12 ثانية · اضغط شارة الحالة لنقلها للمرحلة التالية · تُؤرشف الطلبات الأقدم من 1000 تلقائيا'));
}

function printReceipt(o) {
  const st = data.settings || {};
  const logo = st.logo ? h('img', { class: 'rcpt-logo', src: st.logo, alt: '' }) : null;
  const items = o.items || [];
  const rowLine = (label, val, cls) => h('div', { class: 'row' + (cls ? ' ' + cls : '') }, h('span', {}, label), h('span', {}, val));

  const area = h('div', { class: 'print-only rcpt' },
    h('header', { class: 'rcpt-h' },
      logo,
      h('div', { class: 'rcpt-brand' },
        h('h1', {}, st.name || 'الفاتورة'),
        st.tagline ? h('p', {}, st.tagline) : null,
        st.address ? h('p', {}, '📍 ' + st.address) : null,
        st.phone ? h('p', { class: 'ltr' }, '☎ ' + st.phone + (st.whatsapp ? ' · واتساب ' + st.whatsapp : '')) : null)),
    h('div', { class: 'rcpt-rule' }),
    h('div', { class: 'rcpt-meta' },
      h('div', {}, h('span', {}, 'رقم الطلب'), h('b', { class: 'ltr' }, '#' + SHORT(o.id))),
      h('div', {}, h('span', {}, 'التاريخ'), h('b', { class: 'ltr' }, fmtTs(o.createdAt))),
      h('div', {}, h('span', {}, 'نوع الطلب'), h('b', {}, orderKind(o))),
      h('div', {}, h('span', {}, 'الوقت'), h('b', { class: 'ltr' }, fmtTime(o.createdAt))),
      h('div', { class: 'full' }, h('span', {}, 'الزبون'), h('b', {}, (o.name || 'زبون') + (o.phone ? ' · ' + o.phone : ''))),
      o.type === 'delivery' && o.address ? h('div', { class: 'full' }, h('span', {}, 'العنوان'), h('b', { class: 'addr' }, o.address)) : null,
      o.payment ? h('div', { class: 'full' }, h('span', {}, 'طريقة الدفع'), h('b', {}, o.payment)) : null),
    h('table', { class: 'rcpt-items' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'الصنف'), h('th', { class: 'num' }, 'الكمية'), h('th', { class: 'num' }, 'السعر'), h('th', { class: 'num' }, 'المجموع'))),
      h('tbody', {}, items.map(i => h('tr', {},
        h('td', {}, i.name),
        h('td', { class: 'num' }, i.qty),
        h('td', { class: 'num' }, money(i.price)),
        h('td', { class: 'num' }, money(i.price * i.qty)))))),
    h('div', { class: 'rcpt-tot' },
      rowLine('المجموع الفرعي', money(o.subtotal ?? o.total)),
      o.deliveryFee ? rowLine('رسوم التوصيل', money(o.deliveryFee)) : null,
      rowLine('الإجمالي', money(o.total), 'grand')),
    o.note ? h('div', { class: 'rcpt-note' }, h('b', {}, 'ملاحظة: '), o.note) : null,
    h('footer', { class: 'rcpt-foot' },
      h('b', {}, 'شكرًا لطلبكم 🌿'),
      st.hours ? h('p', {}, st.hours) : null,
      h('p', { class: 'ltr small' }, 'طُبع في ' + fmtTs(Date.now()) + ' · #' + SHORT(o.id))));

  document.body.append(area); document.body.classList.add('printing');
  window.print();
  setTimeout(() => { area.remove(); document.body.classList.remove('printing'); }, 600);
}
function exportCSV(list) {
  list = Array.isArray(list) ? list : orders;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'" + '$1') + '"';
  const rows = [['رقم', 'التاريخ', 'نوع الطلب', 'الطاولة', 'الاسم', 'الهاتف', 'العنوان', 'الإحداثيات', 'الأصناف', 'المجموع الفرعي', 'رسوم التوصيل', 'الإجمالي', 'الدفع', 'الحالة', 'ملاحظة']];
  for (const o of list) rows.push([o.id, fmtTs(o.createdAt), o.type === 'delivery' ? 'توصيل' : 'على الطاولة', o.table || '', o.name || '', o.phone || '', o.address || '', Number.isFinite(o.lat) ? o.lat + ',' + o.lng : '', (o.items || []).map(i => `${i.qty}× ${i.name}`).join(' + '), o.subtotal ?? o.total, o.deliveryFee || 0, o.total, o.payment || '', ST[o.status] || o.status, o.note || '']);
  const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'orders-' + new Date().toISOString().slice(0, 10) + '.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- boot ---------- */
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
window.addEventListener('resize', () => { if (window.innerWidth > 900) closeDrawer(); });
(async () => {
  if (!token()) return showLogin();
  try { await start(); } catch { /* api() shows the login screen */ }
})();
})();
