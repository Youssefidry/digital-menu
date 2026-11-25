/* Digital Menu service worker - offline shell with network-first updates */
const CACHE = 'dm-v5';
const SHELL = ['/', '/index.html', '/offline.html', '/css/app.css', '/js/customer.js', '/icon.svg', '/icon-192.png',
  '/manifest.webmanifest', '/fonts/fonts.css', '/fonts/arabic-400.woff2', '/fonts/latin-400.woff2'];
const NET_FIRST = [/^\/$/, /^\/index\.html$/, /^\/css\//, /^\/js\//, /^\/admin\//, /^\/fonts\//];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const FALLBACK = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>لا يوجد اتصال</title><body style="font-family:Tajawal,system-ui,sans-serif;text-align:center;padding:48px 20px;background:#FBF7F0;color:#1F1A17"><h1 style="font-size:20px">لا يوجد اتصال بالإنترنت</h1><p style="color:#5C524A">أعد المحاولة بعد التحقق من الشبكة.</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;border:0;border-radius:12px;background:#C2410C;color:#fff;font:inherit">إعادة المحاولة</button></body></html>';
const put = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/menu') {
      e.respondWith(fetch(req, { cache: 'no-store' }).then(r => put(req, r)).catch(() =>
        caches.match(req).then(r => r || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    }
    return; // other API calls and admin panel always go to the network
  }
  if (req.mode === 'navigate') {
    // bypass the HTTP cache so an offline navigation reliably falls back to the app shell
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() =>
      caches.match('/').then(r => r || caches.match('/offline.html')).then(r => r || new Response(FALLBACK,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (NET_FIRST.some(re => re.test(url.pathname))) {
    e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req).then(r => r || caches.match('/'))));
    return;
  }
  // static assets (images, icons, fonts): cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => (r.ok ? put(req, r) : r)).catch(() => r512())));
  function r512() { return new Response('', { status: 504 }); }
});
