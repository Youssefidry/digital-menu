(() => {
'use strict';
const root = document.getElementById('app');
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const rawTable = (new URLSearchParams(location.search).get('table') || '').trim();
const table = /^[0-9]{1,5}$/.test(rawTable) ? rawTable : '';
const STATUS = {
  new: { label: 'تم استلام الطلب', step: 1 },
  preparing: { label: 'قيد التحضير', step: 2 },
  ready: { label: 'جاهز للتقديم', step: 3 },
  done: { label: 'تم التقديم', step: 4 },
  canceled: { label: 'ملغى', step: 0 }
};
const CART_KEY = 'dm_cart_' + (table || 'x');
const CHECKOUT_KEY = 'dm_checkout';
const checkout = { type: table ? 'dinein' : 'delivery', name: '', phone: '', address: '', payment: '', geo: null };
try {
  const saved = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || 'null');
  if (saved) {
    if (saved.type === 'dinein' || saved.type === 'delivery') checkout.type = saved.type;
    if (typeof saved.name === 'string') checkout.name = saved.name.slice(0, 60);
    if (typeof saved.phone === 'string') checkout.phone = saved.phone.slice(0, 20);
    if (typeof saved.address === 'string') checkout.address = saved.address.slice(0, 300);
    if (typeof saved.payment === 'string') checkout.payment = saved.payment.slice(0, 30);
    if (saved.geo && Number.isFinite(saved.geo.lat) && Number.isFinite(saved.geo.lng)) checkout.geo = { lat: saved.geo.lat, lng: saved.geo.lng };
  }
} catch {}
const saveCheckout = () => { try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify(checkout)); } catch {} };
const LAST_KEY = 'dm_last_order';
let S = null, menu = null, cat = 'all', q = '', cart = {};
let listEl, chipsEl, barEl, bannerEl, searchEl, countEl;
let pollTimer = null;

try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch { cart = {}; }
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} };
const fmt = n => new Intl.NumberFormat('ar-MA', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const money = n => (S && S.showPrices ? fmt(n) + ' ' + (S.currency || '') : '');
const dishById = id => menu.dishes.find(d => d.id === id);
const lines = () => Object.entries(cart).map(([id, qty]) => ({ d: dishById(id), qty })).filter(l => l.d && l.d.available && l.qty > 0);
const count = () => lines().reduce((s, l) => s + l.qty, 0);
const total = () => lines().reduce((s, l) => s + l.d.price * l.qty, 0);
const imgStyle = d => (d.image ? `background-image:url('${d.image}')` : '');
const initial = d => (d.name || '·').trim().charAt(0);
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(d, size = 18) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = d; return s;
}
const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-3.6-3.6"/>',
  plate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  cart: '<path d="M3 4h2l2.5 11h10.5l2-7H7"/><circle cx="9" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/>',
  wa: '<path fill="currentColor" stroke="none" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.09c-.24.68-1.42 1.3-1.95 1.35-.53.05-1.03.24-3.47-.72-2.93-1.16-4.78-4.18-4.92-4.37-.14-.19-1.17-1.56-1.17-2.98 0-1.42.75-2.12 1.01-2.41.26-.29.57-.36.76-.36l.55.01c.18 0 .41-.07.64.49.24.58.82 2 .89 2.14.07.14.12.31.02.5-.1.19-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.12.57.17.29.75 1.24 1.61 2.01 1.11.99 2.04 1.3 2.33 1.44.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.64-.14.26.1 1.65.78 1.93.92.29.14.48.22.55.34.07.13.07.72-.17 1.4Z"/>',
  ig: '<rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.2" cy="6.9" r="1.1" fill="currentColor" stroke="none"/>',
  fb: '<path fill="currentColor" stroke="none" d="M13.4 22v-8.1h2.8l.42-3.2h-3.22V8.65c0-.93.26-1.56 1.6-1.56h1.7V4.2c-.3-.04-1.3-.13-2.47-.13-2.45 0-4.12 1.5-4.12 4.24v2.38H7.3v3.2h2.8V22h3.3Z"/>',
  tel: '<path d="M6.6 3.2h2.3l1.4 3.6-1.8 1.4a12.7 12.7 0 0 0 5.7 5.7l1.4-1.8 3.6 1.4v2.3a2.2 2.2 0 0 1-2.4 2.2A15.5 15.5 0 0 1 4.4 5.6 2.2 2.2 0 0 1 6.6 3.2Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  pin: '<path d="M12 21s6.5-5.2 6.5-10a6.5 6.5 0 1 0-13 0C5.5 15.8 12 21 12 21Z"/><circle cx="12" cy="11" r="2.4"/>',
  scooter: '<circle cx="5.5" cy="17.5" r="3"/><circle cx="18.5" cy="17.5" r="3"/><path d="M8.5 17.5h7"/><path d="M15.5 17.5 13 9.5H9.5l2 8"/><path d="M12.5 9.5H17l1.5 5"/>',
  map: '<path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6l5-2Z"/><path d="M9 4v14M15 6v14"/>',
  gps: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'
};
function thumb(d, cls = 'thumb') {
  return h('div', { class: cls, style: imgStyle(d), 'aria-hidden': 'true' }, d.image ? null : h('span', { class: 'ph' }, initial(d)));
}
function add(id, n = 1) {
  cart[id] = Math.min(50, Math.max(0, (cart[id] || 0) + n));
  if (!cart[id]) delete cart[id];
  saveCart();
}
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 2200);
}

/* ---------- layers ---------- */
function trap(pane) {
  const sel = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const onKey = e => {
    if (e.key !== 'Tab') return;
    const f = [...pane.querySelectorAll(sel)].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  };
  pane.addEventListener('keydown', onKey);
  return () => pane.removeEventListener('keydown', onKey);
}
function layer(el) {
  const restore = document.activeElement;
  el._cleanup = () => {
    el.remove();
    if (!document.querySelector('.overlay,.page')) document.body.classList.remove('locked');
    try { restore && restore.focus(); } catch {}
    drawBar();
  };
  document.body.append(el);
  document.body.classList.add('locked');
  const untrap = trap(el), esc = e => { if (e.key === 'Escape') close(el); };
  document.addEventListener('keydown', esc);
  const base = el._cleanup;
  el._cleanup = () => { untrap(); document.removeEventListener('keydown', esc); base(); };
  return el;
}
function close(el) { if (el && el._cleanup) { const c = el._cleanup; el._cleanup = null; c(); } }

/* ---------- menu ---------- */
function drawList() {
  const needle = q.toLowerCase();
  const items = menu.dishes.filter(d => (cat === 'all' || d.category === cat) &&
    (!needle || (d.name + ' ' + d.desc + ' ' + (d.ingredients || []).join(' ')).toLowerCase().includes(needle)));
  listEl.className = 'list' + (S.layout === 'grid' ? ' grid' : '');
  if (!items.length) {
    listEl.replaceChildren(h('p', { class: 'empty' }, h('span', { class: 'big' }, '🔍'),
      h('span', {}, 'لا توجد أطباق مطابقة.'),
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn ghost', onclick: () => { q = ''; if (searchEl) searchEl.value = ''; cat = 'all'; syncChips(); drawList(); } }, 'مسح البحث'))));
    return;
  }
  listEl.replaceChildren(...items.map(card));
}
function card(d) {
  const canOrder = S.ordersEnabled && d.available;
  const addBtn = canOrder ? h('button', {
    class: 'add', 'aria-label': 'إضافة ' + d.name + ' إلى الطلب',
    onclick: e => { e.stopPropagation(); add(d.id); drawBar(); e.currentTarget.classList.remove('pop'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('pop'); }
  }, '+') : null;
  return h('div', { class: 'dish', role: 'button', tabindex: '0', 'aria-label': d.name, onclick: () => openSheet(d), onkeydown: e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(d); } } },
    thumb(d),
    h('div', { class: 'info' },
      h('div', {}, h('h2', {}, d.name), h('p', {}, d.desc || '')),
      h('div', { class: 'row' },
        d.available ? h('span', { class: 'price' }, money(d.price)) : h('span', { class: 'tag' }, 'غير متوفر'),
        addBtn)));
}
function drawBar() {
  if (!barEl) return;
  const n = count();
  barEl.replaceChildren();
  if (n && S.ordersEnabled) {
    barEl.append(h('div', { class: 'inner' }, h('button', { onclick: openCart },
      h('span', {}, 'عرض الطلب'),
      h('span', {}, `${n} ${n === 1 ? 'طبق' : n === 2 ? 'طبقان' : 'أطباق'}${S.showPrices ? ' · ' + money(total()) : ''}`))));
  }
}
function chips() {
  const visibleCategories = menu.categories.filter(c => menu.dishes.some(d => d.category === c.id));
  const all = [['all', 'الكل'], ...visibleCategories.map(c => [c.id, c.name])];
  chipsEl.replaceChildren(...all.map(([id, name]) => {
    const n = id === 'all' ? menu.dishes.length : menu.dishes.filter(d => d.category === id).length;
    return h('button', { class: 'chip', 'data-cat': id, 'aria-pressed': String(cat === id), onclick: e => { cat = id; syncChips(); drawList(); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } }, name, h('b', {}, n));
  }));
}
function syncChips() { if (chipsEl) for (const b of chipsEl.children) b.setAttribute('aria-pressed', String(b.dataset.cat === cat)); }

const isUrl = v => /^https?:\/\//i.test(String(v || '').trim());
const socialLink = {
  wa: v => isUrl(v) ? v.trim() : 'https://wa.me/' + String(v).replace(/[^\d]/g, ''),
  ig: v => isUrl(v) ? v.trim() : 'https://instagram.com/' + String(v).trim().replace(/^@/, '').replace(/[^\w.\-]/g, ''),
  fb: v => isUrl(v) ? v.trim() : 'https://facebook.com/' + String(v).trim().replace(/^@/, '').replace(/[^\w.\-]/g, '')
};
function contactBar() {
  const links = [];
  if (S.whatsapp) links.push(['wa', socialLink.wa(S.whatsapp), 'واتساب']);
  if (S.instagram) links.push(['ig', socialLink.ig(S.instagram), 'إنستغرام']);
  if (S.facebook) links.push(['fb', socialLink.fb(S.facebook), 'فيسبوك']);
  if (S.phone) links.push(['tel', 'tel:' + String(S.phone).replace(/[^\d+]/g, ''), 'اتصال هاتفي']);
  const info = [];
  if (S.hours) info.push(['clock', 'ساعات العمل: ' + S.hours, null]);
  if (S.address) info.push(['pin', S.address, 'https://maps.google.com/?q=' + encodeURIComponent(S.address)]);
  if (!links.length && !info.length) return null;
  return h('div', { class: 'contact' },
    links.length ? h('div', { class: 'socials' }, links.map(([k, href, label]) => h('a', {
      class: 'social ' + k, href: href, 'aria-label': label, title: label,
      target: k === 'tel' ? null : '_blank', rel: k === 'tel' ? null : 'noopener noreferrer'
    }, svg(ICON[k], 22)))) : null,
    info.length ? h('div', { class: 'info-chips' }, info.map(([k, text, href]) =>
      href ? h('a', { class: 'info-chip', href: href, target: '_blank', rel: 'noopener noreferrer', title: text }, svg(ICON[k], 15), text)
        : h('span', { class: 'info-chip' }, svg(ICON[k], 15), text))) : null);
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'noir' || t === 'mint') root.dataset.theme = t; else root.removeAttribute('data-theme');
  const dark = t === 'noir';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', (dark ? '#141110' : (t === 'mint' ? '#F3F7F6' : S.color)) || '#C2410C');
}

function render() {
  document.title = S.name + ' · قائمة الطعام';
  document.documentElement.style.setProperty('--c', S.themeAccent || S.color);
  applyTheme(S.theme);
  listEl = h('div', { class: 'list' }); barEl = h('div', { class: 'cartbar', 'aria-live': 'polite' });
  bannerEl = h('div', {});
  chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'الفئات' });
  searchEl = h('input', { class: 'search input', type: 'search', placeholder: 'ابحث عن طبق أو مكوّن...', 'aria-label': 'بحث في القائمة', oninput: e => { q = e.target.value.trim(); drawList(); } });
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'search-wrap' }, h('span', { class: 'ico' }, svg(ICON.search, 18)), searchEl),
    chipsEl);
  window.addEventListener('scroll', () => toolbar.classList.toggle('stuck', window.scrollY > 8), { passive: true });

  const contact = contactBar();
  listEl.id = 'dm-list';
  root.replaceChildren(
    h('a', { class: 'skip', href: '#dm-list' }, 'تجاوز إلى قائمة الأطباق'),
    h('div', { class: 'app' },
    h('header', { class: 'resto-card' },
      h('div', { class: 'site-head' },
        h('div', { class: 'brand' },
          S.logo ? h('img', { class: 'logo', src: S.logo, alt: 'شعار ' + S.name }) : h('div', { class: 'monogram', 'aria-hidden': 'true' }, initial({ name: S.name })),
          h('div', {}, h('small', {}, 'مرحبا بك في'), h('h1', {}, S.name), S.tagline ? h('p', {}, S.tagline) : null)),
        h('div', { class: 'head-meta' },
          table ? h('span', { class: 'pill' }, svg(ICON.plate, 18), 'طاولة ' + table) : null,
          S.ordersEnabled ? h('span', { class: 'pill beacon' }, '● الطلبات مفتوحة') : h('span', { class: 'pill' }, 'الطلبات متوقفة'))),
      contact),
    bannerEl,
    toolbar,
    listEl,
    barEl));
  chips(); drawList(); drawBar();
  checkLastOrder();
}

/* ---------- dish sheet ---------- */
function openSheet(d) {
  let n = 1;
  const canOrder = S.ordersEnabled && d.available;
  const qtyEl = h('span', {}, '1');
  const addBtn = h('button', { class: 'btn', onclick: () => { add(d.id, n); toast('أُضيف إلى طلبك'); close(ov); } });
  const upd = () => { qtyEl.textContent = n; addBtn.textContent = 'أضف إلى الطلب' + (S.showPrices ? ' · ' + money(d.price * n) : ''); };
  const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) close(ov); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.name },
      h('div', { class: 'grip' }),
      h('div', { class: 'hero', style: imgStyle(d) }, d.image ? null : h('span', { class: 'ph' }, initial(d)),
        h('button', { class: 'close', 'aria-label': 'إغلاق', onclick: () => close(ov) }, '✕')),
      h('div', { class: 'row' }, h('h2', {}, d.name),
        d.available ? h('span', { class: 'price', style: 'font-size:20px' }, money(d.price)) : h('span', { class: 'tag' }, 'غير متوفر')),
      d.desc ? h('p', { class: 'muted', style: 'margin:0;line-height:1.8' }, d.desc) : null,
      (d.ingredients || []).length ? h('div', { class: 'tags' }, d.ingredients.map(i => h('span', {}, i))) : null,
      canOrder ? h('div', { class: 'sheet-actions' },
        h('div', { class: 'qty' },
          h('button', { 'aria-label': 'زيادة الكمية', onclick: () => { n = Math.min(50, n + 1); upd(); } }, '+'),
          qtyEl,
          h('button', { 'aria-label': 'إنقاص الكمية', onclick: () => { n = Math.max(1, n - 1); upd(); } }, '−')),
        addBtn) : h('p', { class: 'tag' }, 'هذا الطبق غير متوفر حاليا.'),
      S.orderNote ? h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, S.orderNote) : null));
  upd(); layer(ov); ov.querySelector('.close').focus();
}

/* ---------- cart ---------- */
/* ---------- location picker ---------- */
const geoFallback = (lat, lng) => 'خط العرض ' + lat.toFixed(5) + '، خط الطول ' + lng.toFixed(5);
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch('/api/geo/reverse?lat=' + lat + '&lon=' + lng, { cache: 'no-store' });
    if (!r.ok) return '';
    return String(((await r.json()) || {}).label || '').trim();
  } catch { return ''; }
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('جهازك لا يدعم تحديد الموقع'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      e => rej(new Error(e.code === 1 ? 'تم رفض الوصول إلى الموقع. اسمح به من إعدادات المتصفح أو اختر الموقع من الخريطة.' : 'تعذر تحديد موقعك الآن، جرّب الاختيار من الخريطة.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}
function openLocSheet(apply) {
  const note = h('p', { class: 'sheet-note', role: 'alert' });
  const gpsSub = h('span', { class: 'muted' }, 'تحديد تلقائي عبر GPS');
  const gps = h('button', { class: 'opt', type: 'button', onclick: () => runGps() },
    h('span', { class: 'opt-ic' }, svg(ICON.gps, 22)),
    h('span', { class: 'opt-tx' }, h('strong', {}, 'إرسال موقعي الحالي'), gpsSub));
  const map = h('button', { class: 'opt', type: 'button', onclick: () => { close(sheet); openMapPicker({ start: checkout.geo, onPick: apply }); } },
    h('span', { class: 'opt-ic' }, svg(ICON.map, 22)),
    h('span', { class: 'opt-tx' }, h('strong', {}, 'اختيار من الخريطة'), h('span', { class: 'muted' }, 'حرّك الخريطة وحدّد النقطة بدقة')));
  const sheet = h('div', { class: 'overlay', onclick: e => { if (e.target === sheet) close(sheet); } },
    h('div', { class: 'sheet small', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'تحديد الموقع' },
      h('div', { class: 'grip' }),
      h('div', { class: 'sheet-head' }, h('h2', {}, 'تحديد الموقع'),
        h('button', { class: 'pill', type: 'button', 'aria-label': 'إغلاق', onclick: () => close(sheet) }, '×')),
      gps, map, note,
      h('p', { class: 'muted', style: 'font-size:12px;margin:2px 2px 0' }, 'يُستخدم موقعك فقط لكتابة عنوان التوصيل، ولا يُحفظ إلا مع الطلب.')));
  async function runGps() {
    note.textContent = ''; gps.disabled = true; gpsSub.textContent = 'جارٍ تحديد موقعك…';
    try {
      const p = await getPosition();
      const label = await reverseGeocode(p.lat, p.lng);
      close(sheet);
      apply({ lat: p.lat, lng: p.lng, label: label || geoFallback(p.lat, p.lng) });
    } catch (e) {
      note.textContent = e.message || 'تعذر تحديد الموقع';
    } finally { gps.disabled = false; gpsSub.textContent = 'تحديد تلقائي عبر GPS'; }
  }
  layer(sheet);
}
function openMapPicker({ start, onPick } = {}) {
  const TILE = 256, MIN_Z = 4, MAX_Z = 19;
  let center = start ? { lat: start.lat, lng: start.lng } : { lat: 31.7917, lng: -7.0926 };
  let z = start ? 16 : 6;
  const scaleAt = k => Math.pow(2, k);
  const lon2x = (lon, k) => ((lon + 180) / 360) * scaleAt(k);
  const lat2y = (lat, k) => {
    const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * scaleAt(k);
  };
  const x2lon = (x, k) => x / scaleAt(k) * 360 - 180;
  const y2lat = (y, k) => {
    const n = Math.PI - 2 * Math.PI * y / scaleAt(k);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };
  const tiles = h('div', { class: 'map-tiles' });
  const pin = h('div', { class: 'map-pin', 'aria-hidden': 'true' }, svg(ICON.pin, 36));
  const stage = h('div', { class: 'map', role: 'application', 'aria-label': 'خريطة اختيار الموقع' }, tiles, pin,
    h('a', { class: 'map-attr', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap'));
  const coords = h('span', { class: 'map-coords', dir: 'ltr' });
  const hint = h('p', { class: 'sheet-note', role: 'status' });
  const pool = new Map();
  let raf = 0, drag = null;
  const render = () => {
    const w = stage.clientWidth, ht = stage.clientHeight;
    if (!w || !ht) return;
    const cx = lon2x(center.lng, z) * TILE, cy = lat2y(center.lat, z) * TILE;
    const left = cx - w / 2, top = cy - ht / 2;
    const x0 = Math.floor(left / TILE), x1 = Math.floor((left + w) / TILE);
    const y0 = Math.floor(top / TILE), y1 = Math.floor((top + ht) / TILE);
    const total = scaleAt(z), need = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= total) continue;
      const key = z + '/' + x + '/' + y;
      need.add(key);
      let img = pool.get(key);
      if (!img) {
        img = new Image(); img.className = 'tile'; img.alt = ''; img.decoding = 'async';
        img.src = 'https://tile.openstreetmap.org/' + z + '/' + (((x % total) + total) % total) + '/' + y + '.png';
        pool.set(key, img); tiles.append(img);
      }
      img.style.transform = 'translate3d(' + Math.round(x * TILE - left) + 'px,' + Math.round(y * TILE - top) + 'px,0)';
    }
    for (const [k, img] of pool) if (!need.has(k)) { img.remove(); pool.delete(k); }
    coords.textContent = center.lat.toFixed(5) + ', ' + center.lng.toFixed(5);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const zoomBy = d => { z = Math.max(MIN_Z, Math.min(MAX_Z, z + d)); schedule(); };
  stage.addEventListener('pointerdown', e => {
    if (e.button) return;
    drag = { x: e.clientX, y: e.clientY, px: lon2x(center.lng, z) * TILE, py: lat2y(center.lat, z) * TILE };
    stage.setPointerCapture(e.pointerId); stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    center = { lng: x2lon((drag.px - (e.clientX - drag.x)) / TILE, z), lat: y2lat((drag.py - (e.clientY - drag.y)) / TILE, z) };
    schedule();
  });
  const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  const gpsBtn = h('button', { class: 'map-ctl wide', type: 'button', onclick: async () => {
    gpsBtn.disabled = true;
    try { const p = await getPosition(); center = p; z = Math.max(z, 16); schedule(); hint.textContent = ''; }
    catch (e) { hint.textContent = e.message; }
    finally { gpsBtn.disabled = false; }
  } }, svg(ICON.gps, 16), 'موقعي');
  const ok = h('button', { class: 'btn', type: 'button', onclick: async () => {
    ok.disabled = true; ok.textContent = 'جارٍ تحديد العنوان…';
    const lat = Math.round(center.lat * 1e6) / 1e6, lng = Math.round(center.lng * 1e6) / 1e6;
    const label = await reverseGeocode(lat, lng);
    close(sheet);
    onPick({ lat, lng, label: label || geoFallback(lat, lng) });
  } }, 'تأكيد الموقع');
  const sheet = h('div', { class: 'overlay map-overlay', onclick: e => { if (e.target === sheet) close(sheet); } },
    h('div', { class: 'sheet map-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'اختيار الموقع من الخريطة' },
      h('div', { class: 'grip' }),
      h('div', { class: 'sheet-head' }, h('h2', {}, 'اختر الموقع'),
        h('button', { class: 'pill', type: 'button', 'aria-label': 'إغلاق', onclick: () => close(sheet) }, '×')),
      h('div', { class: 'map-wrap' }, stage,
        h('div', { class: 'map-ctl-stack' },
          h('button', { class: 'map-ctl', type: 'button', 'aria-label': 'تكبير', onclick: () => zoomBy(1) }, '+'),
          h('button', { class: 'map-ctl', type: 'button', 'aria-label': 'تصغير', onclick: () => zoomBy(-1) }, '−')),
        h('div', { class: 'map-ctl-stack end' }, gpsBtn)),
      hint,
      h('div', { class: 'map-foot' }, h('span', { class: 'muted', style: 'font-size:12px' }, 'الموقع المحدد: '), coords, ok)));
  layer(sheet);
  requestAnimationFrame(() => { render(); setTimeout(render, 250); });
}
function openCart() {
  const pg = h('div', { class: 'page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'سلة الطلب' });
  let noteText = '';
  const paint = done => {
    const ls = lines();
    if (done) {
      pg.replaceChildren(h('div', { class: 'app' }, successView(done, pg)));
      return;
    }
    if (!ls.length) {
      pg.replaceChildren(h('div', { class: 'app' },
        h('div', { class: 'cart-head' }, h('button', { class: 'pill', 'aria-label': 'رجوع', onclick: () => close(pg) }, '→'), h('h1', {}, 'طلبي')),
        h('p', { class: 'empty' }, h('span', { class: 'big' }, svg(ICON.cart, 40)), h('span', {}, 'السلة فارغة.'),
          h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => close(pg) }, 'تصفح القائمة')))));
      return;
    }
    const note = h('textarea', { class: 'input', placeholder: 'ملاحظات للمطبخ (اختياري)', 'aria-label': 'ملاحظات للمطبخ', maxlength: '300', oninput: e => { noteText = e.target.value; } }, noteText);
    const err = h('div', { class: 'err', role: 'alert' });
    const subtitle = () => (checkout.type === 'delivery' ? ' · توصيل' : table ? ' · طاولة ' + table : ' · على الطاولة');
    const headSub = h('span', { class: 'cart-sub' }, subtitle());
    const nameIn = h('input', { class: 'input', type: 'text', value: checkout.name, maxlength: '60', placeholder: 'اسمك', 'aria-label': 'الاسم', autocomplete: 'name', oninput: e => { checkout.name = e.target.value; saveCheckout(); } });
    const addrIn = h('input', { class: 'input', id: 'dm-addr', type: 'text', value: checkout.address, maxlength: '300', placeholder: 'الحي، الشارع، رقم المنزل…', 'aria-label': 'عنوان التوصيل', autocomplete: 'street-address', oninput: e => { checkout.address = e.target.value; saveCheckout(); } });
    const nameField = h('label', { class: 'field' }, 'الاسم', nameIn);
    const phoneIn = h('input', { class: 'input tel', type: 'tel', inputmode: 'tel', dir: 'ltr', value: checkout.phone, maxlength: '20', placeholder: '06 12 34 56 78', 'aria-label': 'رقم الهاتف', autocomplete: 'tel', oninput: e => { checkout.phone = e.target.value; saveCheckout(); } });
    const phoneField = h('label', { class: 'field' }, 'رقم الهاتف', phoneIn);
    const locBtn = h('button', { class: 'loc-btn', type: 'button', 'aria-label': 'إرسال موقعي الحالي أو اختياره من الخريطة', title: 'تحديد الموقع', onclick: () => openLocSheet(applyGeo) }, svg(ICON.pin, 18));
    const locState = h('div', { class: 'loc-state', hidden: !checkout.geo }, svg(ICON.gps, 13),
      h('span', {}, 'تم تحديد الموقع'), h('button', { class: 'linkish', type: 'button', onclick: () => { checkout.geo = null; saveCheckout(); paintLoc(); } }, 'مسح'));
    const addrField = h('div', { class: 'field', hidden: checkout.type !== 'delivery' },
      h('label', { class: 'field-lbl', for: 'dm-addr' }, 'عنوان التوصيل'),
      h('div', { class: 'input-wrap' }, addrIn, locBtn), locState);
    function paintLoc() { locState.hidden = !checkout.geo; }
    function applyGeo(g) {
      checkout.address = String(g.label || '').slice(0, 300);
      addrIn.value = checkout.address;
      checkout.geo = { lat: Math.round(g.lat * 1e6) / 1e6, lng: Math.round(g.lng * 1e6) / 1e6 };
      saveCheckout(); paintLoc(); err.textContent = '';
      if (checkout.type !== 'delivery') setType('delivery');
    }
    const setType = k => {
      checkout.type = k; saveCheckout(); headSub.textContent = subtitle();
      segBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === k)));
      addrField.hidden = k !== 'delivery'; paintLoc(); refreshTotals();
      (k === 'delivery' ? (checkout.phone.replace(/[^0-9]/g, '') ? addrIn : phoneIn) : nameIn).focus();
    };
    const segBtns = [['dinein', 'على الطاولة', ICON.plate], ['delivery', 'توصيل', ICON.scooter]].map(([k, label, icon]) => h('button', {
      type: 'button', class: 'seg-btn', 'data-t': k, 'aria-pressed': String(checkout.type === k),
      onclick: () => setType(k)
    }, svg(icon, 18), label));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'طريقة الطلب' }, segBtns);
    const payOptions = String(S.payments || '').split('·').map(x => x.trim()).filter(Boolean);
    if (payOptions.length && !payOptions.includes(checkout.payment)) { checkout.payment = payOptions[0]; }
    const payBtns = payOptions.map(p => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(checkout.payment === p),
      onclick: () => { checkout.payment = p; saveCheckout(); payBtns.forEach(b => b.setAttribute('aria-pressed', String(b.textContent === p))); }
    }, p));
    const payField = payOptions.length ? h('div', { class: 'field' },
      h('div', { class: 'field-lbl' }, 'طريقة الدفع'), h('div', { class: 'pay-opts' }, payBtns)) : null;
    const feeOf = () => (checkout.type === 'delivery' ? Math.max(0, Number(S.deliveryFee) || 0) : 0);
    const grand = () => total() + feeOf();
    const totalsEl = h('div', { class: 'price-lines' });
    const minHint = h('p', { class: 'min-hint', hidden: '' });
    const refreshTotals = () => {
      if (!S.showPrices) { totalsEl.replaceChildren(); minHint.hidden = true; return; }
      totalsEl.replaceChildren(
        h('div', { class: 'line' }, h('span', {}, 'المجموع الفرعي'), h('span', {}, money(total()))),
        feeOf() ? h('div', { class: 'line' }, h('span', {}, 'رسوم التوصيل'), h('span', {}, money(feeOf()))) : null,
        h('div', { class: 'total' }, h('span', {}, 'الإجمالي'), h('span', {}, money(grand()))),
        S.prepTime ? h('div', { class: 'prep' }, '⏱ مدة التحضير: ' + S.prepTime) : null);
      const min = checkout.type === 'delivery' ? (Number(S.minOrder) || 0) : 0;
      const short = min > 0 && total() < min;
      minHint.hidden = !short;
      if (short) minHint.textContent = 'الحد الأدنى للتوصيل ' + min + ' ' + (S.currency || '') + ' — أضف ' + (min - total()).toFixed(2) + ' ' + (S.currency || '');
    };
    refreshTotals();
    const send = h('button', { class: 'btn', style: 'width:100%;min-height:56px', onclick: async () => {
      send.disabled = true; err.textContent = '';
      const isDelivery = checkout.type === 'delivery';
      const phone = checkout.phone.replace(/[^0-9]/g, '');
      if (phone.length > 15) { err.textContent = 'رقم الهاتف طويل جدا'; send.disabled = false; phoneIn.focus(); return; }
      if (phone && phone.length < 8) { err.textContent = 'أدخل رقم هاتف صحيح'; send.disabled = false; phoneIn.focus(); return; }
      if (isDelivery && !phone) { err.textContent = 'أدخل رقم الهاتف للتوصيل'; send.disabled = false; phoneIn.focus(); return; }
      if (isDelivery && checkout.address.trim().length < 5) { err.textContent = 'أدخل عنوان التوصيل كاملا'; send.disabled = false; addrIn.focus(); return; }
      const min = isDelivery ? (Number(S.minOrder) || 0) : 0;
      if (min > 0 && total() < min) { err.textContent = 'الحد الأدنى للتوصيل هو ' + min + ' ' + (S.currency || ''); send.disabled = false; return; }
      if (payOptions.length && !checkout.payment) { err.textContent = 'اختر طريقة الدفع'; send.disabled = false; return; }
      try {
        const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          type: checkout.type, table: isDelivery ? '' : table, name: checkout.name.trim(), phone, address: isDelivery ? checkout.address.trim() : '',
          lat: checkout.geo ? checkout.geo.lat : null, lng: checkout.geo ? checkout.geo.lng : null,
          payment: checkout.payment || '', note: noteText, items: ls.map(l => ({ id: l.d.id, qty: l.qty }))
        }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'تعذر إرسال الطلب');
        cart = {}; saveCart();
        try { localStorage.setItem(LAST_KEY, JSON.stringify({ id: j.id, at: j.createdAt || new Date().toISOString() })); } catch {}
        paint(j);
      } catch (e) { err.textContent = e.message || 'تعذر إرسال الطلب'; send.disabled = false; }
    } }, 'تأكيد الطلب');
    const items = ls.map(l => h('div', { class: 'item' },
      thumb(l.d),
      h('div', { class: 'body' }, h('strong', {}, l.d.name), h('div', { class: 'price' }, money(l.d.price))),
      h('div', { class: 'qty' },
        h('button', { 'aria-label': 'إنقاص ' + l.d.name, onclick: () => { add(l.d.id, -1); paint(); } }, '−'),
        h('span', {}, l.qty),
        h('button', { 'aria-label': 'زيادة ' + l.d.name, onclick: () => { add(l.d.id, 1); paint(); } }, '+'))));
    pg.replaceChildren(h('div', { class: 'app has-summary' },
      h('div', { class: 'cart-head' }, h('button', { class: 'pill', 'aria-label': 'رجوع', onclick: () => close(pg) }, '→'),
        h('h1', {}, 'طلبي', headSub), h('span', { class: 'muted', style: 'margin-inline-start:auto' }, count() + ' عنصر')),
      h('div', { class: 'cart-grid with-summary' },
        h('div', { class: 'form', style: 'display:flex;flex-direction:column;gap:12px' }, items,
          h('section', { class: 'checkout-box' },
            h('div', { class: 'checkout-title' }, 'طريقة الطلب'), seg, nameField, phoneField, addrField, payField),
          h('div', {}, h('label', { class: 'muted', style: 'font-size:13px;display:block;margin-bottom:6px' }, 'ملاحظات'), note),
          S.orderNote ? h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, S.orderNote) : null),
        h('div', { class: 'foot' }, h('div', { class: 'inner' },
          totalsEl, minHint, err, send)))));
  };
  drawBar();
  paint(); layer(pg);
  const stop = () => { clearInterval(pollTimer); pollTimer = null; };
  const base = pg._cleanup; pg._cleanup = () => { stop(); base(); };
  pg.querySelector('.pill')?.focus();
  return pg;
}
function successView(j, pg) {
  const code = String(j.id || '').slice(-6).toUpperCase();
  const st = STATUS[j.status] || STATUS.new;
  const typeLabel = j.type === 'delivery' ? 'توصيل' : 'على الطاولة' + (j.table ? ' · طاولة ' + j.table : '');
  const pollHint = h('div', { class: 'poll-hint' }, 'يتحدّث تلقائيًا كل 10 ثوانٍ');
  const errBox = h('div', { class: 'err' });
  const track = h('div', { class: 'track' },
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'رقم الطلب'), h('span', { class: 'code' }, '#' + code)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الحالة'), h('strong', { class: 'st' }, st.label)),
    h('div', { class: 'steps' }, [1, 2, 3, 4].map(i => h('i', { class: i <= st.step ? 'on' : '' }))),
    pollHint,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'نوع الطلب'), h('span', {}, typeLabel)),
    j.name ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الاسم'), h('span', {}, j.name)) : null,
    j.phone ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الهاتف'), h('a', { class: 'tel', href: 'tel:' + j.phone, dir: 'ltr' }, j.phone)) : null,
    j.lat != null && j.lng != null ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الموقع'), h('a', { class: 'map-link', href: 'https://www.google.com/maps?q=' + j.lat + ',' + j.lng, target: '_blank', rel: 'noopener' }, 'عرض على الخريطة')) : null,
    j.address ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'العنوان'), h('span', { style: 'text-align:end;max-width:70%' }, j.address)) : null,
    S.showPrices && j.subtotal != null ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'المجموع الفرعي'), h('span', {}, money(j.subtotal))) : null,
    S.showPrices && j.deliveryFee ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'رسوم التوصيل'), h('span', {}, money(j.deliveryFee))) : null,
    S.showPrices && j.total != null ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الإجمالي'), h('strong', {}, money(j.total))) : null,
    j.payment ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'الدفع'), h('span', {}, j.payment)) : null);
  const cancelBtn = j.canCancel ? h('button', { class: 'btn ghost cancel-btn', onclick: async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'جارٍ الإلغاء…'; errBox.textContent = '';
    try {
      const r = await fetch('/api/order/' + encodeURIComponent(j.id) + '/cancel', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'تعذر إلغاء الطلب');
      const s2 = STATUS.canceled;
      track.querySelector('.st').textContent = s2.label;
      [...track.querySelectorAll('.steps i')].forEach((el, i) => { el.className = i + 1 <= s2.step ? 'on' : ''; });
      pollHint.textContent = 'تم إلغاء الطلب.';
      clearInterval(pollTimer); pollTimer = null;
      try { localStorage.removeItem(LAST_KEY); } catch {}
      b.remove();
      toast('تم إلغاء طلبك');
    } catch (err) { errBox.textContent = err.message; b.disabled = false; b.textContent = 'إلغاء الطلب'; }
  } }, 'إلغاء الطلب') : null;
  const done = h('div', { class: 'done' },
    h('div', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
    h('h1', {}, 'تم إرسال طلبك'),
    h('p', { class: 'muted', style: 'margin:0' }, 'سيصلك الطلب في أقرب وقت. يمكنك متابعة حالته أدناه.'),
    track, errBox,
    h('div', { class: 'done-actions' },
      cancelBtn,
      h('button', { class: 'btn', onclick: () => close(pg) }, 'العودة للقائمة')));
  // live status
  clearInterval(pollTimer); pollTimer = null;
  if (j.id) {
    let tries = 0;
    const tick = async () => {
      if (document.hidden) return;
      if (++tries > 120) { pollHint.textContent = 'توقف التحديث التلقائي — أعد فتح الصفحة للمتابعة.'; clearInterval(pollTimer); pollTimer = null; return; }
      try {
        const r = await fetch('/api/order/' + encodeURIComponent(j.id), { cache: 'no-store' });
        if (!r.ok) return;
        const o = await r.json();
        const s2 = STATUS[o.status] || STATUS.new;
        track.querySelector('.st').textContent = s2.label;
        [...track.querySelectorAll('.steps i')].forEach((el, i) => { el.className = i + 1 <= s2.step ? 'on' : ''; });
        if (o.status === 'done' || o.status === 'canceled') {
          clearInterval(pollTimer); pollTimer = null;
          pollHint.textContent = o.status === 'done' ? 'تم تقديم طلبك، بالهناء والشفاء.' : 'تم إلغاء الطلب.';
          cancelBtn && cancelBtn.remove();
        } else if (o.canCancel === false && cancelBtn) { cancelBtn.remove(); }
      } catch {}
    };
    pollTimer = setInterval(tick, 10000);
  }
  return done;
}

/* ---------- last order banner ---------- */
async function checkLastOrder() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch {}
  if (!last || !last.id) return;
  try {
    const r = await fetch('/api/order/' + encodeURIComponent(last.id), { cache: 'no-store' });
    if (!r.ok) { localStorage.removeItem(LAST_KEY); return; }
    const o = await r.json();
    if (o.status === 'done' || o.status === 'canceled') { localStorage.removeItem(LAST_KEY); return; }
    const s2 = STATUS[o.status] || STATUS.new;
    bannerEl.replaceChildren(h('div', { class: 'banner' },
      h('span', {}, 'طلبك #' + String(o.id).slice(-6).toUpperCase() + ' — ' + s2.label),
      h('button', { onclick: () => { const pg = h('div', { class: 'page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'متابعة الطلب' }); pg.replaceChildren(h('div', { class: 'app' }, successView(o, pg))); layer(pg); const base = pg._cleanup; pg._cleanup = () => { clearInterval(pollTimer); pollTimer = null; base(); }; } }, 'تتبع الطلب')));
  } catch {}
}

/* ---------- boot ---------- */
function skeleton() {
  root.replaceChildren(h('div', { class: 'app', 'aria-busy': 'true', 'aria-label': 'جاري التحميل' },
    h('div', { class: 'skeleton', style: 'height:64px;margin:20px 0 16px' }),
    h('div', { class: 'skeleton', style: 'height:46px;margin-bottom:16px' }),
    h('div', { class: 'skeleton', style: 'height:44px;margin-bottom:16px;width:70%' }),
    [1, 2, 3, 4].map(() => h('div', { class: 'skeleton sk-card' }))));
}
async function load() {
  skeleton();
  try {
    const r = await fetch('/api/menu', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const m = await r.json();
    menu = { categories: m.categories || [], dishes: (m.dishes || []).map(d => ({ ...d, ingredients: d.ingredients || [] })) };
    S = Object.assign({ name: 'قائمة الطعام', currency: '', showPrices: true, ordersEnabled: true, layout: 'list', color: '#C2410C' }, m.settings || {});
    render();
  } catch {
    root.replaceChildren(h('div', { class: 'app' }, h('p', { class: 'empty' }, h('span', { class: 'big' }, svg(ICON.plate, 40)), h('span', {}, 'تعذر تحميل القائمة. تحقق من اتصالك.'),
      h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: load }, 'إعادة المحاولة')))));
  }
}
load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
