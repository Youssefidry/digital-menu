'use strict';
// Digital Menu server - no external dependencies (Node >= 18).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const QRCode = require('./lib/qrcode'), QRLevel = require('./lib/qrcode/QRErrorCorrectLevel');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ROOT = __dirname, DATA = path.join(ROOT, 'data'), PUB = path.join(ROOT, 'public'), UPLOADS = path.join(PUB, 'uploads');
const ORDER_STATUS = ['new', 'preparing', 'ready', 'done', 'canceled'];
fs.mkdirSync(UPLOADS, { recursive: true });

const readJSON = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch { return fallback; } };
const writeJSON = (name, value) => {
  const f = path.join(DATA, name); fs.writeFileSync(f + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(f + '.tmp', f);
};
const uid = p => p + crypto.randomBytes(5).toString('hex');
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };

// ---- auth ----
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function checkPassword(pw) {
  const a = readJSON('auth.json', null);
  if (!a) return pw === DEFAULT_PASSWORD;
  return crypto.timingSafeEqual(Buffer.from(hash(pw, a.salt)), Buffer.from(a.hash));
}
const sessions = new Map(); // token -> expiry
const attempts = new Map(); // ip -> {n, until}
function newSession() { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 12 * 3600e3); return t; }
function isAdmin(req) {
  const t = req.headers['x-token']; const exp = sessions.get(t);
  if (!exp) return false; if (exp < Date.now()) { sessions.delete(t); return false; } return true;
}

// ---- rate limit ----
const hits = new Map();
const GEO_CACHE = new Map();
function limit(key, max, ms) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => t > now - ms);
  if (arr.length >= max) throw new HttpError(429, 'محاولات كثيرة، حاول بعد قليل');
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
}

// ---- helpers ----
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
};
const COMPRESSIBLE = /text\/|json|javascript|image\/svg|xml/;
const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
  if (res.headersSent) return;
  const isJSON = type.startsWith('application/json') || type.startsWith('application/manifest+json');
  let payload = isJSON ? Buffer.from(JSON.stringify(body)) : (Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
  const headers = { 'Content-Type': type, ...SEC, ...extra };
  const ae = String((res.req && res.req.headers && res.req.headers['accept-encoding']) || '');
  if (status === 200 && COMPRESSIBLE.test(type) && payload.length > 1024 && /\bgzip\b/.test(ae)) {
    payload = zlib.gzipSync(payload, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = payload.length;
  res.writeHead(status, headers);
  if (res.req && res.req.method === 'HEAD') return res.end();
  res.end(payload);
};
function body(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'الملف كبير جدا')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'بيانات غير صالحة')); } });
    req.on('error', reject);
  });
}
const loadMenu = () => readJSON('menu.json', { settings: {}, categories: [], dishes: [] });
function publicMenu() {
  const m = loadMenu(); const vis = new Set(m.categories.filter(c => c.visible).map(c => c.id));
  return {
    settings: m.settings, categories: m.categories.filter(c => c.visible),
    dishes: m.dishes.filter(d => vis.has(d.category) && (d.available || m.settings.showUnavailable))
  };
}
const cleanCategory = (b, old = {}) => ({ id: old.id || uid('c'), name: str(b.name, 60) || old.name || 'فئة', visible: b.visible === undefined ? (old.visible ?? true) : !!b.visible });
function cleanDish(b, m, old = {}) {
  const category = m.categories.some(c => c.id === b.category) ? b.category : (old.category || (m.categories[0] && m.categories[0].id) || '');
  const image = typeof b.image === 'string' && /^\/uploads\/[a-f0-9]+\.(png|jpg|webp|svg)$/.test(b.image) ? b.image : (b.image === '' ? '' : (old.image || ''));
  return {
    id: old.id || uid('d'), name: str(b.name, 80) || old.name || 'طبق', desc: str(b.desc, 600), price: num(b.price), category, image,
    available: b.available === undefined ? (old.available ?? true) : !!b.available,
    ingredients: Array.isArray(b.ingredients) ? b.ingredients.map(i => str(i, 40)).filter(Boolean).slice(0, 12) : (old.ingredients || [])
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
  deliveryFee: v => Math.min(500, Math.max(0, Math.round((Number(v) || 0) * 100) / 100)),
  minOrder: v => Math.min(5000, Math.max(0, Math.round((Number(v) || 0) * 100) / 100)),
  prepTime: v => str(v, 40),
  payments: v => str(v, 120)
};
function saveImage(b) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '');
  if (!m) throw new HttpError(400, 'صيغة الصورة غير مدعومة (PNG / JPG / WEBP)');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4 * 1024 * 1024) throw new HttpError(413, 'الصورة أكبر من 4MB');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1], name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), buf); return '/uploads/' + name;
}
// remove uploaded files no longer referenced by any dish or the logo
function cleanUploads() {
  const m = loadMenu(), used = new Set(m.dishes.map(d => d.image).filter(Boolean));
  if (m.settings.logo) used.add(m.settings.logo);
  let removed = 0;
  for (const f of fs.readdirSync(UPLOADS)) {
    if (f.startsWith('.') || used.has('/uploads/' + f)) continue;
    try { fs.unlinkSync(path.join(UPLOADS, f)); removed++; } catch {}
  }
  return removed;
}
function qrSvg(text) {
  const qr = new QRCode(-1, QRLevel.M); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const s = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---- API ----
async function api(req, res, url) {
  const m = req.method, p = url.pathname, id = p.split('/')[3], ip = req.socket.remoteAddress || 'x';
  if (m === 'GET' && p === '/api/menu') return send(res, 200, publicMenu(), undefined, { 'Cache-Control': 'no-store' });
  if (m === 'GET' && p === '/api/qr') {
    limit('qr:' + ip, 120, 60e3);
    const t = str(url.searchParams.get('text'), 300); if (!t) throw new HttpError(400, 'text required');
    return send(res, 200, qrSvg(t), 'image/svg+xml', { 'Cache-Control': 'no-store' });
  }
  if (m === 'POST' && p === '/api/login') {
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpError(429, 'محاولات كثيرة، حاول بعد دقائق');
    const b = await body(req);
    if (!checkPassword(str(b.password, 200))) { a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60e3; a.n = 0; } attempts.set(ip, a); throw new HttpError(401, 'كلمة المرور غير صحيحة'); }
    attempts.delete(ip);
    const hasAuth = fs.existsSync(path.join(DATA, 'auth.json'));
    return send(res, 200, { token: newSession(), mustChange: !hasAuth });
  }
  if (m === 'GET' && p === '/api/geo/reverse') {
    limit('geo:' + ip, 40, 60e3);
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const lat = Number(qs.get('lat')), lon = Number(qs.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'إحداثيات غير صحيحة');
    const key = lat.toFixed(5) + ',' + lon.toFixed(5);
    if (GEO_CACHE.has(key)) return send(res, 200, { label: GEO_CACHE.get(key) }, undefined, { 'Cache-Control': 'no-store' });
    let label = '';
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ar&lat=' + lat + '&lon=' + lon, {
        signal: ctl.signal, headers: { 'User-Agent': 'digital-menu/1.1 (restaurant menu)', Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json(), a = j.address || {};
        const parts = [a.house_number, a.road, a.neighbourhood || a.quarter || a.suburb, a.city || a.town || a.village || a.municipality || a.county].filter(Boolean);
        label = (parts.length ? parts.slice(0, 4).join('، ') : String(j.display_name || '')).slice(0, 300);
      }
    } catch { /* offline or timeout: client falls back to coordinates */ }
    if (label) { if (GEO_CACHE.size > 200) GEO_CACHE.clear(); GEO_CACHE.set(key, label); }
    return send(res, 200, { label }, undefined, { 'Cache-Control': 'no-store' });
  }
  if (m === 'POST' && p === '/api/orders') {
    limit('order:' + ip, 20, 10 * 60e3);
    const b = await body(req), menu = loadMenu();
    if (!menu.settings.ordersEnabled) throw new HttpError(403, 'الطلبات متوقفة حاليا');
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map(i => {
      const d = menu.dishes.find(x => x.id === i.id && x.available); const qty = Math.min(50, parseInt(i.qty, 10) || 0);
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
    const round2 = n => Math.round(n * 100) / 100;
    const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
    const fee = type === 'delivery' ? (Number(menu.settings.deliveryFee) || 0) : 0;
    const minOrder = type === 'delivery' ? (Number(menu.settings.minOrder) || 0) : 0;
    if (minOrder > 0 && subtotal < minOrder) throw new HttpError(400, 'الحد الأدنى للتوصيل هو ' + minOrder + ' ' + (menu.settings.currency || ''));
    const payment = str(b.payment, 30);
    const orders = readJSON('orders.json', []);
    const order = {
      id: uid('o'), type, table: type === 'dinein' ? table : '', name, phone, address: type === 'delivery' ? address : '',
      lat: hasGeo ? Math.round(lat * 1e6) / 1e6 : null, lng: hasGeo ? Math.round(lng * 1e6) / 1e6 : null,
      note: str(b.note, 300), items, subtotal, deliveryFee: round2(fee), total: round2(subtotal + fee), payment,
      status: 'new', createdAt: new Date().toISOString()
    };
    orders.push(order);
    if (orders.length > 1000) {
      const overflow = orders.splice(0, orders.length - 1000);
      const arch = readJSON('orders-archive.json', []);
      writeJSON('orders-archive.json', arch.concat(overflow).slice(-20000));
    }
    writeJSON('orders.json', orders);
    return send(res, 201, {
      id: order.id, type: order.type, table: order.table, name: order.name, phone: order.phone, address: order.address,
      lat: order.lat, lng: order.lng, status: order.status, createdAt: order.createdAt,
      subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, payment: order.payment, canCancel: true
    });
  }
  // public order tracking (random id acts as the secret)
  if (m === 'GET' && p.startsWith('/api/order/') && id) {
    limit('track:' + ip, 120, 60e3);
    const o = readJSON('orders.json', []).find(x => x.id === id);
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    const canCancel = o.status === 'new' && Date.now() - new Date(o.createdAt).getTime() < 10 * 60e3;
    return send(res, 200, {
      id: o.id, type: o.type || 'dinein', table: o.table, name: o.name || '', phone: o.phone || '', address: o.address || '',
      lat: o.lat ?? null, lng: o.lng ?? null, status: o.status, createdAt: o.createdAt,
      subtotal: o.subtotal ?? o.total, deliveryFee: o.deliveryFee || 0, total: o.total, payment: o.payment || '', canCancel, items: o.items
    }, undefined, { 'Cache-Control': 'no-store' });
  }
  if (m === 'POST' && p.startsWith('/api/order/') && p.endsWith('/cancel') && id) {
    limit('cancel:' + ip, 12, 60e3);
    const orders = readJSON('orders.json', []), o = orders.find(x => x.id === id);
    if (!o) throw new HttpError(404, 'الطلب غير موجود');
    if (o.status !== 'new') throw new HttpError(409, 'بدأ تحضير الطلب، تواصل مع المطعم للإلغاء');
    if (Date.now() - new Date(o.createdAt).getTime() > 10 * 60e3) throw new HttpError(409, 'انتهت مدة الإلغاء الذاتي، تواصل مع المطعم');
    o.status = 'canceled'; o.canceledAt = new Date().toISOString();
    writeJSON('orders.json', orders);
    return send(res, 200, { ok: true, status: 'canceled' });
  }
  // ---- admin only ----
  if (!isAdmin(req)) throw new HttpError(401, 'غير مصرح');
  const menu = loadMenu();
  if (m === 'GET' && p === '/api/admin/menu') return send(res, 200, menu);
  if (m === 'GET' && p === '/api/backup') return send(res, 200, {
    app: 'digital-menu', version: 2, exportedAt: new Date().toISOString(),
    menu, orders: readJSON('orders.json', []), archived: readJSON('orders-archive.json', []).length
  }, undefined, { 'Content-Disposition': 'attachment; filename="digital-menu-backup-' + new Date().toISOString().slice(0, 10) + '.json"' });
  if (m === 'POST' && p === '/api/restore') {
    const b = await body(req);
    if (!b || typeof b !== 'object' || !b.menu || !Array.isArray(b.menu.dishes) || !Array.isArray(b.menu.categories)) throw new HttpError(400, 'ملف النسخة الاحتياطية غير صالح');
    const settings = { ...(loadMenu().settings || {}), ...(b.menu.settings || {}) };
    writeJSON('menu.json', { settings, categories: b.menu.categories, dishes: b.menu.dishes });
    if (Array.isArray(b.orders)) writeJSON('orders.json', b.orders.slice(-1000));
    cleanUploads();
    return send(res, 200, { ok: true, dishes: b.menu.dishes.length, orders: Array.isArray(b.orders) ? b.orders.length : 0 });
  }
  if (m === 'PUT' && p === '/api/settings') {
    const b = await body(req); for (const k in SETTING_KEYS) if (k in b) menu.settings[k] = SETTING_KEYS[k](b[k]);
    writeJSON('menu.json', menu); if ('logo' in b) cleanUploads(); return send(res, 200, menu.settings);
  }
  if (m === 'POST' && p === '/api/password') {
    const b = await body(req), pw = str(b.password, 200); if (pw.length < 6) throw new HttpError(400, 'كلمة المرور قصيرة (6 أحرف على الأقل)');
    const salt = crypto.randomBytes(16).toString('hex'); writeJSON('auth.json', { salt, hash: hash(pw, salt) }); return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/upload') return send(res, 201, { url: saveImage(await body(req)) });
  if (m === 'POST' && p === '/api/dishes/reorder') {
    const b = await body(req), ids = Array.isArray(b.ids) ? b.ids : [];
    menu.dishes.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)); writeJSON('menu.json', menu); return send(res, 200, menu.dishes);
  }
  if (m === 'POST' && p === '/api/categories/reorder') {
    const b = await body(req), ids = Array.isArray(b.ids) ? b.ids : [];
    menu.categories.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)); writeJSON('menu.json', menu); return send(res, 200, menu.categories);
  }
  if (m === 'POST' && p === '/api/cleanup') return send(res, 200, { removed: cleanUploads() });
  for (const [name, clean] of [['categories', cleanCategory], ['dishes', (b, old) => cleanDish(b, menu, old)]]) {
    if (p === '/api/' + name && m === 'POST') { const item = clean(await body(req)); menu[name].push(item); writeJSON('menu.json', menu); return send(res, 201, item); }
    if (p.startsWith('/api/' + name + '/') && id) {
      const i = menu[name].findIndex(x => x.id === id); if (i < 0) throw new HttpError(404, 'غير موجود');
      if (m === 'PUT') { menu[name][i] = clean(await body(req), menu[name][i]); writeJSON('menu.json', menu); cleanUploads(); return send(res, 200, menu[name][i]); }
      if (m === 'DELETE') {
        if (name === 'categories' && menu.dishes.some(d => d.category === id)) throw new HttpError(409, 'احذف أو انقل أطباق هذه الفئة أولا');
        menu[name].splice(i, 1); writeJSON('menu.json', menu); cleanUploads(); return send(res, 200, { ok: true });
      }
    }
  }
  if (m === 'GET' && p === '/api/orders') return send(res, 200, readJSON('orders.json', []).reverse());
  if (p.startsWith('/api/orders/') && id) {
    const orders = readJSON('orders.json', []), o = orders.find(x => x.id === id);
    if (!o) throw new HttpError(404, 'غير موجود');
    if (m === 'PUT') {
      const b = await body(req);
      if (!ORDER_STATUS.includes(b.status)) throw new HttpError(400, 'حالة غير صالحة');
      o.status = b.status; writeJSON('orders.json', orders); return send(res, 200, o);
    }
    if (m === 'DELETE') { writeJSON('orders.json', orders.filter(x => x.id !== id)); return send(res, 200, { ok: true }); }
  }
  throw new HttpError(404, 'غير موجود');
}

// ---- static ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webp2': 'image/webp' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/admin') rel = '/admin/'; if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  const cache = rel.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache, ...SEC }); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) return notFound(res);
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cache, ETag: etag });
    });
  });
}
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function serveIndex(req, res) {
  fs.readFile(path.join(PUB, 'index.html'), 'utf8', (err, html) => {
    if (err) return notFound(res);
    const s = loadMenu().settings || {};
    const origin = (s.baseUrl || ('http://' + (req.headers.host || 'localhost'))).replace(/\/+$/, '');
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
    const etag = '"' + crypto.createHash('sha1').update(out).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', ...SEC }); return res.end(); }
    send(res, 200, out, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache', ETag: etag });
  });
}
function notFound(res) {
  send(res, 404, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>الصفحة غير موجودة</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF7F0;color:#1F1A17;font-family:system-ui,Tahoma,sans-serif;text-align:center;padding:24px">
<div><p style="font-size:64px;margin:0">🍽️</p><h1 style="margin:8px 0">الصفحة غير موجودة</h1><p style="color:#5C524A">تأكد من الرابط أو عد إلى القائمة.</p>
<a href="/" style="display:inline-block;margin-top:16px;padding:14px 26px;border-radius:14px;background:#C2410C;color:#fff;text-decoration:none;font-weight:700">العودة للقائمة</a></div></body></html>`, 'text/html; charset=utf-8');
}
function manifest() {
  const s = loadMenu().settings || {};
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

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (u.pathname === '/' || u.pathname === '/index.html') return serveIndex(req, res);
    if (u.pathname === '/manifest.webmanifest') return send(res, 200, manifest(), 'application/manifest+json', { 'Cache-Control': 'no-cache' });
    if (u.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /admin/\n', 'text/plain; charset=utf-8');
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, u);
    send(res, 405, 'Method not allowed', 'text/plain');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e); send(res, 500, { error: 'خطأ في الخادم' });
  }
}).listen(PORT, () => console.log(`Digital menu running:  http://localhost:${PORT}   |   admin: http://localhost:${PORT}/admin/`));
