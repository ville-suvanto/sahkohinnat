const CACHE = 'sahkohinnat-v1';
const CONTRACT = 7.79;

function pad(n) { return String(n).padStart(2, '0'); }

// ── INSTALL & ACTIVATE ─────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── PERIODIC SYNC (Android Chrome) ────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'morning-prices') {
    e.waitUntil(sendMorningNotification());
  }
});

// ── PUSH (fallback viesti pääsivulta) ─────────────────────
self.addEventListener('push', e => {
  if (e.data) {
    const d = e.data.json();
    e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: d.icon }));
  }
});

// ── MESSAGE from main page ─────────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_ALARM') {
    scheduleAlarm(e.data.targetHour, e.data.targetMinute);
  }
});

// ── ALARM via setTimeout chain ─────────────────────────────
function scheduleAlarm(targetHour, targetMinute) {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target - now;

  setTimeout(async () => {
    await sendMorningNotification();
    // Reschedule for next day
    scheduleAlarm(targetHour, targetMinute);
  }, delay);
}

// ── FETCH PRICES & NOTIFY ──────────────────────────────────
async function sendMorningNotification() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);
    const url = `https://sahkotin.fi/prices?fix&vat&start=${todayStart.toISOString()}&end=${tomorrowEnd.toISOString()}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const todayPrices = [];
    for (const p of data.prices) {
      const d = new Date(p.date);
      const localStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if (localStr === todayStr) todayPrices.push({ hour: d.getHours(), price: p.value });
    }
    todayPrices.sort((a, b) => a.hour - b.hour);
    if (!todayPrices.length) return;

    const avg = todayPrices.reduce((s, p) => s + p.price, 0) / todayPrices.length;
    const minP = todayPrices.reduce((a, b) => a.price < b.price ? a : b);
    const cheap = todayPrices.filter(p => p.price < CONTRACT).sort((a, b) => a.price - b.price);

    let body = `Halvin: klo ${pad(minP.hour)}–${pad((minP.hour+1)%24)} (${minP.price.toFixed(1)} snt)\n`;
    body += `Päivän keskihinta: ${avg.toFixed(1)} snt/kWh\n`;
    if (cheap.length > 0) {
      body += `Halvat tunnit: ${cheap.slice(0, 5).map(p => pad(p.hour)+':00').join(', ')}`;
    } else {
      body += '⚠️ Kaikki tunnit yli sopimushintasi tänään.';
    }

    await self.registration.showNotification('⚡ Tänään sähkön hinnat', {
      body,
      icon: 'https://em-content.zobj.net/source/apple/354/high-voltage_26a1.png',
      badge: 'https://em-content.zobj.net/source/apple/354/high-voltage_26a1.png',
      tag: 'morning-prices',
      renotify: false
    });
  } catch(e) {
    console.error('SW notification error:', e);
  }
}
