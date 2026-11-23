// Sincronización con la nube (Firebase Firestore). Opcional: si no hay configuración, no hace nada.
// Regla de fusión: cada elemento por separado, gana el cambio más reciente (updatedAt).
// Como cada cosa de la compra es un elemento distinto, las listas se suman solas.
import { allItems, putItems, getItem, meta } from './db.js';

const V = '10.12.2';
let fs = null, db = null, familyId = null, onChange = null, status = 'off', statusCb = null, pushing = false;

export const syncStatus = () => status;
export const onSyncStatus = cb => { statusCb = cb; };
function setStatus(s) { status = s; statusCb && statusCb(s); }

export async function startSync(fid, changed) {
  familyId = fid; onChange = changed;
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) { setStatus('off'); return; }
  try {
    setStatus(navigator.onLine ? 'connecting' : 'offline');
    const appMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
    fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    await authMod.signInAnonymously(auth);
    db = fs.getFirestore(app);
    listen();
    pushDirty();
    window.addEventListener('online', () => { setStatus('connecting'); pushDirty(); });
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pushDirty(); });
  } catch (e) {
    console.warn('sync', e);
    setStatus('offline');
    // Sin internet al arrancar: reintentamos cuando vuelva
    window.addEventListener('online', () => { if (!db) startSync(familyId, onChange); }, { once: true });
  }
}

async function listen() {
  const since = ((await meta.get('lastRemote')) || 0) - 10 * 60 * 1000;
  const col = fs.collection(db, 'families', familyId, 'items');
  const q = fs.query(col, fs.where('updatedAt', '>', since));
  fs.onSnapshot(q, async snap => {
    const incoming = [];
    let maxT = 0;
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') continue;
      const r = ch.doc.data();
      maxT = Math.max(maxT, r.updatedAt || 0);
      const local = await getItem(r.id);
      if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) incoming.push({ ...r, dirty: false });
    }
    if (incoming.length) { await putItems(incoming); onChange && onChange(); }
    if (maxT) await meta.set('lastRemote', Math.max(maxT, (await meta.get('lastRemote')) || 0));
    if (!snap.metadata.fromCache) setStatus('ok');
  }, err => { console.warn(err); setStatus('offline'); });
}

export async function pushDirty() {
  if (!db || pushing) return;
  pushing = true;
  try {
    const dirty = (await allItems()).filter(i => i.dirty);
    for (const it of dirty) {
      const { dirty: _d, ...clean } = it;
      await fs.setDoc(fs.doc(db, 'families', familyId, 'items', it.id), clean);
      const now = await getItem(it.id);
      if (now && now.updatedAt === it.updatedAt) await putItems([{ ...now, dirty: false }]);
    }
    if (navigator.onLine) setStatus('ok');
  } catch (e) { console.warn('push', e); setStatus('offline'); }
  finally { pushing = false; }
}
