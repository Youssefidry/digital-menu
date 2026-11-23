'use strict';
// ============================================================
// digital-menu — Cloudflare Workers edition
// نسخة من الخادم الأصلي (Node.js) تعمل على Workers + D1 + KV
// ============================================================
import SEED_MENU from '../data/menu.json';
import QRCode from '../lib/qrcode/index.js';
import QRLevel from '../lib/qrcode/QRErrorCorrectLevel.js';

const ORDER_STATUS = ['new', 'preparing', 'ready', 'done', 'canceled'];
const DEFAULT_PASSWORD = 'admin123';
const SESSION_TTL = 12 * 3600e3;
const PBKDF2_ITERS = 30000;
const MAX_IMAGE = 4 * 1024 * 1024;

const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
};

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

// ---------- helpers ----------
const enc = new TextEncoder();
const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/.{2}/g) || [], h => parseInt(h, 16));
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const uid = p => p + rand(5);
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const round2 = n => Math.round(n * 100) / 100;

function res(body, status = 200, type = 'application/json; charset=utf-8', extra = {}) {
  const isJSON = type.startsWith('application/json') || type.startsWith('application/manifest+json');
  const payload = isJSON ? JSON.stringify(body) : body;
  return new Response(payload, { status, headers: { 'Content-Type': type, ...SEC, ...extra } });
}
const json = (status, body, extra = {}) => res(body, status, 'application/json; charset=utf-8', extra);

async function readBody(req, limit = 6 * 1024 * 1024) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > limit) throw new HttpError(413, 'الملف كبير جدا');
  const text = await req.text();
  if (!text) return {};
  if (text.length > limit) throw new HttpError(413, 'الملف كبير جدا');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'بيانات غير صالحة'); }
}

// ---------- rate limit (best effort per isolate) ----------
const hits = new Map();
function limit(key, max, ms) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => t > now - ms);
  if (arr.length >= max) throw new HttpError(429, 'محاولات كثيرة، حاول بعد قليل');
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
}

// ---------- storage: menu + settings ----------
const clone = v => JSON.parse(JSON.stringify(v));

async function getMenu(env) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('menu').first();
  if (row && row.v) { try { return JSON.parse(row.v); } catch { /* fall through */ } }
  return clone(SEED_MENU);
}
async function saveMenu(env, menu) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind('menu', JSON.stringify(menu)).run();
}
async function kvGet(env, key) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  if (!row || !row.v) return null;
  try { return JSON.parse(row.v); } catch { return null; }
}
async function kvSet(env, key, value) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}

// ---------- storage: orders ----------
async function listOrders(env) {
  const { results } = await env.DB.prepare('SELECT data FROM orders ORDER BY created_at DESC').all();
  return (results || []).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}
async function getOrder(env, id) {
  const r = await env.DB.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  return r ? JSON.parse(r.data) : null;
}
async function putOrder(env, o) {
  await env.DB.prepare(
    'INSERT INTO orders (id, status, created_at, data) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data'
  ).bind(o.id, o.status, o.createdAt, JSON.stringify(o)).run();
}
async function removeOrder(env, id) {
  await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
}
async function archiveIfNeeded(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first();
  const total = Number(row && row.n) || 0;
  if (total <= 1000) return;
  const extra = total - 1000;
  const { results } = await env.DB.prepare('SELECT id, data FROM orders ORDER BY created_at ASC LIMIT ?').bind(extra).all();
  const arch = (await kvGet(env, 'orders-archive')) || [];
  for (const r of results || []) { try { arch.push(JSON.parse(r.data)); } catch { /* skip */ } }
  await kvSet(env, 'orders-archive', arch.slice(-5000));
  const stmt = env.DB.prepare('DELETE FROM orders WHERE id = ?');
  await env.DB.batch((results || []).map(r => stmt.bind(r.id)));
}
async function replaceOrders(env, orders) {
  await env.DB.prepare('DELETE FROM orders').run();
  const stmt = env.DB.prepare('INSERT INTO orders (id, status, created_at, data) VALUES (?, ?, ?, ?)');
  const rows = (Array.isArray(orders) ? orders : []).filter(o => o && o.id).slice(-1000);
  if (rows.length) await env.DB.batch(rows.map(o => stmt.bind(o.id, o.status || 'new', o.createdAt || new Date().toISOString(), JSON.stringify(o))));
}

// ---------- auth ----------
const authCache = { salt: null, hash: null };
async function hashPassword(pw, saltHex, iters = PBKDF2_ITERS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iters }, key, 256);
  return hex(new Uint8Array(bits));
}
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
async function checkPassword(env, pw) {
  const a = await kvGet(env, 'auth');
  if (!a) return pw === (env.ADMIN_PASSWORD || DEFAULT_PASSWORD);
  const h = await hashPassword(pw, a.salt, a.iters || PBKDF2_ITERS);
  return safeEqual(h, a.hash);
}
async function newSession(env) {
  const token = rand(24);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, expires) VALUES (?, ?)').bind(token, now + SESSION_TTL).run();
  if (Math.random() < 0.1) await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now).run();
  return token;
}
async function isAdmin(req, env) {
  const token = req.headers.get('x-token');
  if (!token) return false;
  const row = await env.DB.prepare('SELECT expires FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return false;
  if (row.expires < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return false;
  }
  return true;
}

// ---------- menu shaping (same rules as the Node server) ----------
const cleanCategory = (b, old = {}) => ({
  id: old.id || uid('c'),
  name: str(b.name, 60) || old.name || 'فئة',
  visible: b.visible === undefined ? (old.visible ?? true) : !!b.visible
});

function cleanDish(b, m, old = {}) {
  const category = m.categories.some(c => c.id === b.category) ? b.category : (old.category || (m.categories[0] && m.categories[0].id) || '');
  const image = typeof b.image === 'string' && /^\/uploads\/[a-f0-9]+\.(png|jpg|webp|svg)$/.test(b.image)
    ? b.image
    : (b.image === '' ? '' : (old.image || ''));
  return {
    id: old.id || uid('d'),
    name: str(b.name, 80) || old.name || 'طبق',
    desc: str(b.desc, 600),
    price: num(b.price),
    category,
    image,
    available: b.available === undefined ? (old.available ?? true) : !!b.available,
    ingredients: Array.isArray(b.ingredients)
      ? b.ingredients.map(i => str(i, 40)).filter(Boolean).slice(0, 12)
      : (old.ingredients || [])
  };
}

const urlOrEmpty = v => { const s = str(v, 200).replace(/\/+$/, ''); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ''; };
const SETTING_KEYS = {
  name: v => str(v, 80), tagline: v => str(v, 120), currency: v => str(v, 10), phone: v => str(v, 30), whatsapp: v => str(v, 30),
  instagram: v => str(v, 100), facebook: v => str(v, 100), languages: v => str(v, 80), hours: v => str(v, 80), address: v => str(v, 160), orderNote: v => str(v, 200),
  ordersEnabled: Boolean, showPrices: Boolean, showUnavailable: Boolean,
  color: v => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#C2410C'), layout: v => (v === 'grid' ? 'grid' : 'list'),
  logo: v => (/^\/uploads\/[a-f0-9]+\.(png|jpg|webp)$/.test(v) ? v : ''), tables: v => Math.min(200, Math.max(1, parseInt(v, 10) || 1)),
  theme: v => (['warm', 'noir', 'mint'].includes(v) ? v : 'warm'),
  themeAccent: v => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : ''),
  baseUrl: urlOrEmpty,
  deliveryFee: v => Math.min(500, Math.max(0, round2(Number(v) || 0))),
  minOrder: v => Math.min(5000, Math.max(0, round2(Number(v) || 0))),
  prepTime: v => str(v, 40),
  payments: v => str(v, 120)
};

function publicMenu(m) {
  const vis = new Set(m.categories.filter(c => c.visible).map(c => c.id));
  return {
    settings: m.settings,
    categories: m.categories.filter(c => c.visible),
    dishes: m.dishes.filter(d => vis.has(d.category) && (d.available || m.settings.showUnavailable))
  };
}

// ---------- uploads (KV) ----------
async function saveImage(env, b) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '');
  if (!m) throw new HttpError(400, 'صيغة الصورة غير مدعومة (PNG / JPG / WEBP)');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > MAX_IMAGE) throw new HttpError(413, 'الصورة أكبر من 4MB');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = rand(8) + '.' + ext;
  await env.UPLOADS.put(name, bytes);
  return '/uploads/' + name;
}

async function cleanUploads(env) {
  const m = await getMenu(env);
  const used = new Set(m.dishes.map(d => d.image).filter(Boolean));
  if (m.settings.logo) used.add(m.settings.logo);
  let removed = 0, cursor;
  do {
    const page = await env.UPLOADS.list({ limit: 1000, cursor });
    for (const k of page.keys) {
      if (used.has('/uploads/' + k.name)) continue;
      await env.UPLOADS.delete(k.name);
      removed++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return removed;
}

// ---------- QR ----------
function qrSvg(value) {
  const qr = new QRCode(-1, QRLevel.M);
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount(), q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const s = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- API ----------
async function api(req, env, url) {
  const method = req.method, p = url.pathname, id = p.split('/')[3];
  const ip = req.headers.get('cf-connecting-ip') || 'x';

  if (method === 'GET' && p === '/api/menu') {
    return json(200, publicMenu(await getMenu(env)), { 'Cache-Control': 'no-store' });
  }

  if (method === 'GET' && p === '/api/qr') {
    limit('qr:' + ip, 120, 60e3);
    const t = str(url.searchParams.get('text'), 300);
    if (!t) throw new HttpError(400, 'text required');
    return res(qrSvg(t), 200, 'image/svg+xml', {
      'Cache-Control': 'public, max-age=86400',
      ...(url.searchParams.get('download') ? { 'Content-Disposition': 'attachment; filename="qr.svg"' } : {})
    });
  }

  if (method === 'POST' && p === '/api/login') {
    limit('login:' + ip, 40, 5 * 60e3);
    const b = await readBody(req);
    if (!(await checkPassword(env, str(b.password, 200)))) throw new HttpError(401, 'كلمة المرور غير صحيحة');
    const hasAuth = !!(await kvGet(env, 'auth'));
    return json(200, { token: await newSession(env), mustChange: !hasAuth }, { 'Cache-Control': 'no-store' });
  }

  if (method === 'GET' && p === '/api/geo/reverse') {
    limit('geo:' + ip, 40, 60e3);
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'إحداثيات غير صحيحة');
    let label = '';
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ar&lat=${lat}&lon=${lon}`,
        { headers: { 'User-Agent': 'digital-menu/1.5 (restaurant menu)', Accept: 'application/json' }, signal: AbortSignal.timeout(7000) }
      );
      if (r.ok) {
        const j = await r.json(), a = j.address || {};
        const parts = [a.house_number, a.road, a.neighbourhood || a.quarter || a.suburb, a.city || a.town || a.village || a.municipality || a.county].filter(Boolean);
        label = (parts.length ? parts.slice(0, 4).join('، ') : String(j.display_name || '')).slice(0, 300);
      }
    } catch { /* offline or timeout: client falls back to coordinates */ }
    return json(200, { label }, { 'Cache-Control': 'no-store' });
  }

  if (method === 'POST' && p === '/api/orders') {
    limit('order:' + ip, 20, 10 * 60e3);
    const b = await readBody(req), menu = await getMenu(env);
    if (!menu.settings.ordersEnabled) throw new HttpError(403, 'الطلبات متوقفة حاليا');
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map(i => {
      const d = menu.dishes.find(x => x.id === i.id && x.available);
      const qty = Math.min(50, parseInt(i.qty, 10) || 0);
      return d && qty > 0 ? { id: d.id, name: d.name, price: d.price, qty } : null;
    }).filter(Boolean);
    if (!items.length) throw new HttpError(400, 'السلة فارغة');
    const rawTable = str(b.table, 10), table = /^[0-9]{1,5}$/.test(rawTable) ? rawTable : '';
    const type = b.type === 'delivery' ? 'delivery' : 'dinein';
    const name = str(b.name, 60), address = str(b.address, 300);
    const phone = str(b.phone, 20).replace(/[^0-9]/g, '').slice(0, 15);
    const lat = Number(b.lat), lng = Number(b.lng);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (phone && phone.length < 8) throw new HttpError(400, 'رقم الهاتف غير صحيح');
    if (type === 'delivery' && !phone) throw new HttpError(400, 'أدخل رقم الهاتف للتوصيل');
    if (type === 'delivery' && address.length < 5) throw new HttpError(400, 'أدخل عنوان التوصيل كاملا');
    const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
    const fee = type === 'delivery' ? (Number(menu.settings.deliveryFee) || 0) : 0;
    const minOrder = type === 'delivery' ? (Number(menu.settings.minOrder) || 0) : 0;
    if (minOrder > 0 && subtotal < minOrder) throw new HttpError(400, 'الحد الأدنى للتوصيل هو ' + minOrder + ' ' + (menu.settings.currency || ''));
    const order = {
      id: uid('o'), type, table: type === 'dinein' ? table : '', name, phone,
      address: type === 'delivery' ? address : '',
      lat: hasGeo ? Math.round(lat * 1e6) / 1e6 : null,
      lng: hasGeo ? Math.round(lng * 1e6) / 1e6 : null,
      note: str(b.note, 300), items, subtotal,
      deliveryFee: round2(fee), total: round2(subtotal + fee),
      payment: str(b.payment, 30), status: 'new', createdAt: new Date().toISOString()
    };
    await putOrder(env, order);
    await archiveIfNeeded(env);
    return json(201, {
      id: order.id, type: order.type, table: order.table, name: order.name, phone: order.phone, address: order.address,
      lat: order.lat, lng: order.lng, status: order.status, createdAt: order.createdAt,
      subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, payment: order.payment, canCancel: true
    });
  }

  // public order tracking (the random id is the secret)
  if (method === 'GET' && p.startsWith('/api/order/') && id) {
    limit('track:' + ip, 120, 60e3);
    const o = await getOrder(env, id);
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    const canCancel = o.status === 'new' && Date.now() - new Date(o.createdAt).getTime() < 10 * 60e3;
    return json(200, {
      id: o.id, type: o.type || 'dinein', table: o.table, name: o.name || '', phone: o.phone || '', address: o.address || '',
      lat: o.lat ?? null, lng: o.lng ?? null, status: o.status, createdAt: o.createdAt,
      subtotal: o.subtotal ?? o.total, deliveryFee: o.deliveryFee || 0, total: o.total, payment: o.payment || '', canCancel, items: o.items
    }, { 'Cache-Control': 'no-store' });
  }

  if (method === 'POST' && p.startsWith('/api/order/') && p.endsWith('/cancel') && id) {
    limit('cancel:' + ip, 12, 60e3);
    const o = await getOrder(env, id);
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    if (o.status !== 'new') throw new HttpError(409, 'بدأ تحضير الطلب، تواصل مع المطعم للإلغاء');
    if (Date.now() - new Date(o.createdAt).getTime() > 10 * 60e3) throw new HttpError(409, 'انتهت مدة الإلغاء الذاتي، تواصل مع المطعم');
    o.status = 'canceled';
    o.canceledAt = new Date().toISOString();
    await putOrder(env, o);
    return json(200, { ok: true, status: 'canceled' });
  }

  // ---- admin only ----
  if (!(await isAdmin(req, env))) throw new HttpError(401, 'غير مصرح');
  const menu = await getMenu(env);

  if (method === 'GET' && p === '/api/admin/menu') return json(200, menu);

  if (method === 'GET' && p === '/api/backup') {
    const orders = await listOrders(env);
    const archived = (await kvGet(env, 'orders-archive')) || [];
    return json(200, {
      app: 'digital-menu', version: 2, exportedAt: new Date().toISOString(),
      menu, orders, archived: archived.length
    }, { 'Content-Disposition': `attachment; filename="digital-menu-backup-${new Date().toISOString().slice(0, 10)}.json"` });
  }

  if (method === 'POST' && p === '/api/restore') {
    const b = await readBody(req, 12 * 1024 * 1024);
    if (!b || typeof b !== 'object' || !b.menu || !Array.isArray(b.menu.dishes) || !Array.isArray(b.menu.categories)) {
      throw new HttpError(400, 'ملف النسخة الاحتياطية غير صالح');
    }
    const settings = { ...(menu.settings || {}), ...(b.menu.settings || {}) };
    await saveMenu(env, { settings, categories: b.menu.categories, dishes: b.menu.dishes });
    if (Array.isArray(b.orders)) await replaceOrders(env, b.orders);
    await cleanUploads(env);
    return json(200, { ok: true, dishes: b.menu.dishes.length, orders: Array.isArray(b.orders) ? b.orders.length : 0 });
  }

  if (method === 'PUT' && p === '/api/settings') {
    const b = await readBody(req);
    for (const k in SETTING_KEYS) if (k in b) menu.settings[k] = SETTING_KEYS[k](b[k]);
    await saveMenu(env, menu);
    if ('logo' in b) await cleanUploads(env);
    return json(200, menu.settings);
  }

  if (method === 'POST' && p === '/api/password') {
    const b = await readBody(req), pw = str(b.password, 200);
    if (pw.length < 6) throw new HttpError(400, 'كلمة المرور قصيرة (6 أحرف على الأقل)');
    const salt = rand(16);
    const hash = await hashPassword(pw, salt);
    await kvSet(env, 'auth', { salt, hash, iters: PBKDF2_ITERS });
    return json(200, { ok: true });
  }

  if (method === 'POST' && p === '/api/upload') {
    return json(201, { url: await saveImage(env, await readBody(req, 8 * 1024 * 1024)) });
  }

  if (method === 'POST' && p === '/api/dishes/reorder') {
    const b = await readBody(req), ids = Array.isArray(b.ids) ? b.ids : [];
    menu.dishes.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    await saveMenu(env, menu);
    return json(200, menu.dishes);
  }

  if (method === 'POST' && p === '/api/categories/reorder') {
    const b = await readBody(req), ids = Array.isArray(b.ids) ? b.ids : [];
    menu.categories.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    await saveMenu(env, menu);
    return json(200, menu.categories);
  }

  if (method === 'POST' && p === '/api/cleanup') {
    return json(200, { removed: await cleanUploads(env) });
  }

  for (const name of ['categories', 'dishes']) {
    const clean = name === 'categories' ? cleanCategory : (b, old) => cleanDish(b, menu, old);
    if (p === '/api/' + name && method === 'POST') {
      const item = clean(await readBody(req));
      menu[name].push(item);
      await saveMenu(env, menu);
      return json(201, item);
    }
    if (p.startsWith('/api/' + name + '/') && id) {
      const i = menu[name].findIndex(x => x.id === id);
      if (i < 0) throw new HttpError(404, 'غير موجود');
      if (method === 'PUT') {
        menu[name][i] = clean(await readBody(req), menu[name][i]);
        await saveMenu(env, menu);
        await cleanUploads(env);
        return json(200, menu[name][i]);
      }
      if (method === 'DELETE') {
        if (name === 'categories' && menu.dishes.some(d => d.category === id)) throw new HttpError(409, 'احذف أو انقل أطباق هذه الفئة أولا');
        menu[name].splice(i, 1);
        await saveMenu(env, menu);
        await cleanUploads(env);
        return json(200, { ok: true });
      }
    }
  }

  if (method === 'GET' && p === '/api/orders') return json(200, await listOrders(env));

  if (p.startsWith('/api/orders/') && id) {
    const o = await getOrder(env, id);
    if (!o) throw new HttpError(404, 'غير موجود');
    if (method === 'PUT') {
      const b = await readBody(req);
      if (!ORDER_STATUS.includes(b.status)) throw new HttpError(400, 'حالة غير صالحة');
      o.status = b.status;
      await putOrder(env, o);
      return json(200, o);
    }
    if (method === 'DELETE') {
      await removeOrder(env, id);
      return json(200, { ok: true });
    }
  }

  throw new HttpError(404, 'غير موجود');
}

// ---------- SEO index ----------
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function serveIndex(req, env, url) {
  const assetRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url), req));
  if (!assetRes.ok) return notFound();
  const html = await assetRes.text();
  const s = (await getMenu(env)).settings || {};
  const origin = (s.baseUrl || url.origin).replace(/\/+$/, '');
  const title = (s.name ? s.name + ' · ' : '') + 'قائمة الطعام';
  const desc = s.tagline || 'قائمة طعام رقمية: تصفح الأطباق واطلب مباشرة من طاولتك.';
  const img = origin + (s.logo || '/icon-512.png');
  const ld = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: s.name || '', description: desc,
    telephone: s.phone || '', url: origin + '/', image: img, servesCuisine: 'Moroccan',
    address: { '@type': 'PostalAddress', streetAddress: s.address || '' },
    hasMenu: { '@type': 'Menu', name: 'قائمة الطعام', url: origin + '/' }
  };
  const themeColor = s.theme === 'noir' ? '#141110' : (s.theme === 'mint' ? '#F3F7F6' : (s.themeAccent || s.color || '#C2410C'));
  const head = [
    '<meta name="theme-color" content="' + esc(themeColor) + '">',
    '<meta name="description" content="' + esc(desc) + '">',
    '<meta property="og:type" content="restaurant">',
    '<meta property="og:site_name" content="' + esc(s.name || 'قائمة الطعام') + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:image" content="' + esc(img) + '">',
    '<meta property="og:url" content="' + esc(origin) + '/">',
    '<meta property="og:locale" content="ar_MA">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(title) + '">',
    '<meta name="twitter:description" content="' + esc(desc) + '">',
    '<meta name="twitter:image" content="' + esc(img) + '">',
    '<title>' + esc(title) + '</title>',
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>'
  ].join('\n');
  const out = html.replace('<!--HEAD-->', head);
  return new Response(out, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEC }
  });
}

function manifest(settings) {
  const s = settings || {};
  return {
    name: s.name || 'قائمة الطعام', short_name: (s.name || 'القائمة').slice(0, 12),
    description: s.tagline || 'قائمة طعام رقمية', start_url: '/', scope: '/', display: 'standalone',
    dir: 'rtl', lang: 'ar',
    background_color: s.theme === 'noir' ? '#141110' : (s.theme === 'mint' ? '#F3F7F6' : '#FBF7F0'),
    theme_color: s.theme === 'noir' ? '#141110' : (s.themeAccent || s.color || '#C2410C'),
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  };
}

function notFound() {
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>الصفحة غير موجودة</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF7F0;color:#1F1A17;font-family:system-ui,Tahoma,sans-serif;text-align:center;padding:24px">
<div><p style="font-size:64px;margin:0">🍽️</p><h1 style="margin:8px 0">الصفحة غير موجودة</h1><p style="color:#5C524A">تأكد من الرابط أو عد إلى القائمة.</p>
<a href="/" style="display:inline-block;margin-top:16px;padding:14px 26px;border-radius:14px;background:#C2410C;color:#fff;text-decoration:none;font-weight:700">العودة للقائمة</a></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC } });
}

// ---------- static assets ----------
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

async function serveStatic(req, env, url) {
  let target = url.pathname;
  if (target.endsWith('/')) target += 'index.html';
  const assetRes = await env.ASSETS.fetch(new Request(new URL(target, url), req));
  if (assetRes.status !== 404) {
    const headers = new Headers(assetRes.headers);
    for (const [k, v] of Object.entries(SEC)) headers.set(k, v);
    if (url.pathname.startsWith('/uploads/')) headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache');
    return new Response(req.method === 'HEAD' ? null : assetRes.body, { status: assetRes.status, headers });
  }
  // uploaded images live in KV
  const name = url.pathname.replace('/uploads/', '');
  if (url.pathname.startsWith('/uploads/') && name && !name.includes('/')) {
    const bin = await env.UPLOADS.get(name, 'arrayBuffer');
    if (bin) {
      const ext = name.split('.').pop().toLowerCase();
      return new Response(req.method === 'HEAD' ? null : bin, {
        headers: { 'Content-Type': IMAGE_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', ...SEC }
      });
    }
  }
  return notFound();
}

// ---------- router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await api(req, env, url);
      if (p === '/' || p === '/index.html') return await serveIndex(req, env, url);
      if (p === '/manifest.webmanifest') return json(200, manifest((await getMenu(env)).settings), { 'Cache-Control': 'no-cache' });
      if (p === '/robots.txt') return res('User-agent: *\nDisallow: /admin/\n', 200, 'text/plain; charset=utf-8');
      if (p === '/admin') return Response.redirect(url.origin + '/admin/', 308);
      if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, env, url);
      return res('Method not allowed', 405, 'text/plain; charset=utf-8');
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e && e.stack ? e.stack : e);
      return json(500, { error: 'خطأ في الخادم' });
    }
  }
};
