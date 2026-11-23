// Servidor de la app Familia (Cloudflare Worker, plan gratuito).
// - Guarda una copia de los datos de cada familia para sincronizar los móviles.
// - Envía avisos (Web Push) al resto de la familia.
// Cada familia vive en su propio Durable Object; su identificador secreto solo lo conocen sus móviles.
import { DurableObject } from 'cloudflare:workers';
import { sendPush, makeVapidKeys } from './webpush.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/f\/([a-z0-9]{20,64})\/([a-z]+)$/);
    if (!m) return json({ ok: true, app: 'familia' });
    const stub = env.FAMILY.get(env.FAMILY.idFromName(m[1]));
    return stub.fetch(new Request(`https://do/${m[2]}${url.search}`, req));
  },
};

export class Family extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL, upd INTEGER NOT NULL, srv INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS items_srv ON items(srv);
      CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, member TEXT NOT NULL, sub TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
  }

  now() {
    // Reloj del servidor estrictamente creciente, sirve como "cursor" de sincronización
    const last = Number(this.kvGet('clock') || 0);
    const t = Math.max(Date.now(), last + 1);
    this.kvSet('clock', String(t));
    return t;
  }
  kvGet(k) { const r = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray(); return r.length ? r[0].v : null; }
  kvSet(k, v) { this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, v); }

  async vapid() {
    let v = this.kvGet('vapid');
    if (!v) { v = JSON.stringify(await makeVapidKeys()); this.kvSet('vapid', v); }
    return JSON.parse(v);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const action = url.pathname.slice(1);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : null;

    switch (action) {
      case 'items': {
        if (req.method === 'GET') {
          const since = Number(url.searchParams.get('since') || 0);
          const rows = this.sql.exec('SELECT data FROM items WHERE srv > ? ORDER BY srv LIMIT 2000', since).toArray();
          const last = this.sql.exec('SELECT MAX(srv) AS m FROM items').toArray()[0]?.m || 0;
          return json({ items: rows.map(r => JSON.parse(r.data)), cursor: last, more: rows.length === 2000 });
        }
        const list = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
        let changed = 0;
        for (const it of list) {
          if (!it || typeof it.id !== 'string' || it.id.length > 64) continue;
          const upd = Number(it.updatedAt) || 0;
          const cur = this.sql.exec('SELECT upd FROM items WHERE id = ?', it.id).toArray()[0];
          if (cur && cur.upd >= upd) continue; // gana el cambio más reciente
          const data = JSON.stringify(it);
          if (data.length > 20000) continue;
          this.sql.exec('INSERT OR REPLACE INTO items (id, data, upd, srv) VALUES (?, ?, ?, ?)', it.id, data, upd, this.now());
          changed++;
        }
        return json({ ok: true, changed });
      }
      case 'vapid':
        return json({ key: (await this.vapid()).publicKey });
      case 'subscribe': {
        const s = body.sub;
        if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !body.member) return json({ error: 'bad' }, 400);
        this.sql.exec('INSERT OR REPLACE INTO subs (endpoint, member, sub) VALUES (?, ?, ?)', s.endpoint, String(body.member), JSON.stringify(s));
        return json({ ok: true });
      }
      case 'unsubscribe': {
        if (body.endpoint) this.sql.exec('DELETE FROM subs WHERE endpoint = ?', body.endpoint);
        return json({ ok: true });
      }
      case 'notify': {
        const payload = JSON.stringify({
          title: String(body.title || 'Familia').slice(0, 120),
          body: String(body.body || '').slice(0, 400),
          tab: String(body.tab || ''),
          tag: String(body.tag || ''),
        });
        const to = String(body.to || '');
        const subs = (to && to !== 'all'
          ? this.sql.exec('SELECT endpoint, sub FROM subs WHERE member = ?', to)
          : this.sql.exec('SELECT endpoint, sub FROM subs WHERE member != ?', String(body.from || ''))).toArray();
        const keys = await this.vapid();
        let sent = 0;
        await Promise.all(subs.map(async r => {
          try {
            const res = await sendPush(JSON.parse(r.sub), payload, keys);
            if (res.status === 404 || res.status === 410) this.sql.exec('DELETE FROM subs WHERE endpoint = ?', r.endpoint);
            else if (res.ok) sent++;
          } catch (e) { console.log('push error', e); }
        }));
        return json({ ok: true, sent });
      }
    }
    return json({ error: 'not found' }, 404);
  }
}
