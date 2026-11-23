// Sincronización con el servidor de la familia (Cloudflare). Opcional: sin servidor, todo sigue en el móvil.
// Regla de fusión: cada elemento por separado, gana el cambio más reciente (updatedAt).
// Como cada cosa de la compra es un elemento distinto, las listas se suman solas.
import { allItems, putItems, getItem, meta } from './db.js';

const API = () => (window.API_URL || '').replace(/\/$/, '');
let familyId = null, onChange = null, status = 'off', statusCb = null, running = null, again = false, timer = 0;

export const syncStatus = () => status;
export const onSyncStatus = cb => { statusCb = cb; };
export const hasServer = () => !!API();
export const apiBase = () => `${API()}/f/${familyId}`;
function setStatus(s) { if (s !== status) { status = s; statusCb && statusCb(s); } }

export function startSync(fid, changed) {
  familyId = fid; onChange = changed;
  if (!API()) { setStatus('off'); return; }
  setStatus(navigator.onLine ? 'connecting' : 'offline');
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); else flushSoon(0); });
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data === 'sync') syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 30000);
  syncNow();
}

// Pide una sincronización (se agrupan las peticiones seguidas)
export function syncNow() {
  if (!API() || !familyId) return Promise.resolve();
  if (running) { again = true; return running; }
  running = doSync().finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

async function doSync() {
  try {
    // 1) Subir lo cambiado en este móvil
    const dirty = (await allItems()).filter(i => i.dirty);
    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200).map(({ dirty: _d, ...c }) => c);
      const r = await fetch(`${apiBase()}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: chunk }) });
      if (!r.ok) throw new Error('push ' + r.status);
    }
    for (const it of dirty) {
      const now = await getItem(it.id);
      if (now && now.updatedAt === it.updatedAt) await putItems([{ ...now, dirty: false }]);
    }
    // 2) Bajar lo cambiado en otros móviles
    let changed = false, more = true;
    while (more) {
      const since = (await meta.get('cursor')) || 0;
      const r = await fetch(`${apiBase()}/items?since=${since}`);
      if (!r.ok) throw new Error('pull ' + r.status);
      const data = await r.json();
      const incoming = [];
      for (const it of data.items) {
        const local = await getItem(it.id);
        if (!local || (it.updatedAt || 0) > (local.updatedAt || 0)) incoming.push({ ...it, dirty: false });
      }
      if (incoming.length) { await putItems(incoming); changed = true; }
      await meta.set('cursor', data.cursor || since);
      more = data.more;
    }
    // 3) Enviar los avisos pendientes (después de subir los datos)
    await flushOutbox();
    setStatus('ok');
    if (changed && onChange) onChange();
  } catch (e) {
    console.warn('sync', e);
    setStatus('offline');
  }
}

// ---------------------------------------------------------------- avisos
// Se guardan en una bandeja de salida y se envían cuando hay internet.
// Lo de la compra se agrupa: un solo aviso con todo lo añadido seguido.
export async function queueNotice(n) {
  const box = (await meta.get('outbox')) || [];
  if (n.group) {
    const g = box.find(x => x.group === n.group && !x.sent);
    if (g) { g.items = [...new Set([...g.items, ...n.items])]; g.at = Date.now(); await meta.set('outbox', box); flushSoon(); return; }
  }
  box.push({ ...n, id: Math.random().toString(36).slice(2), at: Date.now() });
  await meta.set('outbox', box);
  if (n.urgent) syncNow(); else flushSoon(1500);
}

function flushSoon(ms = 12000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

async function flushOutbox() {
  const box = (await meta.get('outbox')) || [];
  if (!box.length) return;
  const sent = new Set(), keep = [];
  for (const n of box) {
    // Los de la compra esperan unos segundos por si se añade algo más
    if (n.group && Date.now() - n.at < 10000 && !document.hidden) { keep.push(n); continue; }
    const body = n.group ? `${n.who} ha añadido: ${n.items.join(', ')}` : n.body;
    try {
      const r = await fetch(`${apiBase()}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: n.from, to: n.to || '', title: n.title, body, tab: n.tab, tag: n.group || '' }) });
      if (r.ok) sent.add(n.id);
    } catch {}
  }
  if (sent.size) await meta.set('outbox', ((await meta.get('outbox')) || []).filter(n => !sent.has(n.id)));
  if (keep.length) flushSoon();
}

// ---------------------------------------------------------------- suscripción a avisos
export function pushSupport() {
  if (!API()) return 'noserver';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('PushManager' in window) || !('Notification' in window)) return standalone ? 'unsupported' : 'install';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}

export async function enablePush(memberId) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch(`${apiBase()}/vapid`)).json();
  let sub = await reg.pushManager.getSubscription();
  if (sub && b64u(sub.options?.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
  const r = await fetch(`${apiBase()}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member: memberId, sub: sub.toJSON() }) });
  if (r.ok) await meta.set('pushOn', true);
  return r.ok;
}

// Re-registra la suscripción al abrir la app (por si el móvil la renovó)
export async function refreshPush(memberId) {
  if (pushSupport() !== 'granted' || !(await meta.get('pushOn'))) return;
  try { await enablePush(memberId); } catch {}
}

const b64u = buf => buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

// Quitar a un miembro: sus móviles dejan de recibir avisos
export function removeMemberFromServer(memberId) {
  if (!API() || !familyId) return;
  fetch(`${apiBase()}/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member: memberId }) }).catch(() => {});
}
