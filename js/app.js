import { meta, allItems, putItems, uid, clearAll } from './db.js';
import { parseEvent, parseShopping, norm } from './parse.js';
import { ymd, fromYmd, addDays, todayStr, niceDate, occursOn, DIAS_LARGO, DIAS_CORTO, MESES, REPEAT_LABEL, LETRAS, setHolidays, holidayOn } from './dates.js';
import { removeMemberFromServer, startSync, syncNow, syncStatus, onSyncStatus, queueNotice, pushSupport, enablePush, refreshPush, hasServer } from './sync.js';

const VERSION = '0.4.1';
const COLORS = ['#0d9488', '#3b82f6', '#f97316', '#a855f7', '#e11d48', '#ca8a04'];
const ALL_COLOR = '#64748b';
const APP_URL = location.origin + location.pathname;

const S = {
  family: null, me: null, items: [],
  tab: 'hoy', calMonth: null, calDay: todayStr(), place: 'despensa',
  joinPayload: null,
};

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- datos
const members = () => S.items.filter(i => i.kind === 'member' && !i.deleted);
const member = id => members().find(m => m.id === id);
const events = () => S.items.filter(i => i.kind === 'event' && !i.deleted);
const shop = () => S.items.filter(i => i.kind === 'shop' && !i.deleted);
const pantry = () => S.items.filter(i => i.kind === 'pantry' && !i.deleted);
const holidays = () => S.items.filter(i => i.kind === 'holiday' && !i.deleted).sort((a, b) => a.from.localeCompare(b.from));
const tasks = () => S.items.filter(i => i.kind === 'task' && !i.deleted);
const forMe = t => t.to === S.me || (t.to === 'all' && t.from !== S.me);
const myPending = () => tasks().filter(t => !t.done && forMe(t)).sort((a, b) => b.createdAt - a.createdAt);
const PLACES = [['despensa', '🥫', 'Despensa'], ['nevera', '🧊', 'Nevera'], ['congelador', '❄️', 'Congelador'], ['hogar', '🧴', 'Limpieza y hogar']];
const colorOf = who => (who && who !== 'all' && member(who)?.color) || ALL_COLOR;

async function reload() {
  const before = new Set(myPending().map(t => t.id));
  S.items = await allItems(); render();
  const nuevos = myPending().filter(t => !before.has(t.id));
  if (nuevos.length) { toast(`📣 ${member(nuevos[0].from)?.name || ''}: ${nuevos[0].title}`); navigator.vibrate?.(300); }
}

async function save(list) {
  const now = Date.now();
  const arr = (Array.isArray(list) ? list : [list]).map((it, i) => ({ ...it, updatedAt: now + i, by: S.me, dirty: true }));
  await putItems(arr);
  for (const it of arr) {
    const k = S.items.findIndex(x => x.id === it.id);
    if (k >= 0) S.items[k] = it; else S.items.push(it);
  }
  render();
  syncNow();
}

function eventsOn(day) {
  return events().filter(e => occursOn(e, day))
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00') || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- arranque
async function init() {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const h = location.hash;
  if (h.startsWith('#unir=')) S.joinPayload = decodePayload(h.slice(6));
  const qt = new URLSearchParams(location.search).get('tab');
  if (['hoy', 'cal', 'tareas', 'compra', 'despensa'].includes(qt)) { S.tab = qt; history.replaceState(null, '', APP_URL + location.hash); }
  S.family = await meta.get('family');
  S.me = await meta.get('me');
  S.items = await allItems();
  const d = new Date(); S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  if (S.family && S.joinPayload) { history.replaceState(null, '', APP_URL); S.joinPayload = null; }
  render();
  if (S.family) { startSync(S.family.id, reload); refreshPush(S.me); }
  onSyncStatus(() => renderSyncDot());
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.tab && S.family) { S.tab = e.data.tab; closeSheet(); render(); } });
  registerSW();
}

// ---------------------------------------------------------------- render
function render() {
  if (!S.family) return renderWelcome();
  const active = document.activeElement;
  const keep = active && active.id && app.contains(active) ? { id: active.id, v: active.value, s: active.selectionStart } : null;

  setHolidays(holidays());
  const title = { hoy: 'Hoy', cal: 'Calendario', tareas: 'Encargos', compra: 'Compra', despensa: 'Despensa' }[S.tab];
  const meM = member(S.me);
  app.innerHTML = `
  <header class="top">
    <h1>${title}</h1>
    <button class="me" data-act="settings" aria-label="Ajustes">
      <span class="sync" id="syncdot"></span>
      <span class="avatar" style="background:${meM?.color || ALL_COLOR}">${esc((meM?.name || '?')[0].toUpperCase())}</span>
    </button>
  </header>
  <main id="main">${S.tab === 'hoy' ? viewHoy() : S.tab === 'cal' ? viewCal() : S.tab === 'despensa' ? viewDespensa() : S.tab === 'tareas' ? viewTareas() : viewCompra()}</main>
  <button class="fab" data-act="plus" aria-label="Añadir">+</button>
  <nav class="tabs">
    ${tabBtn('hoy', '🏠', 'Hoy')}${tabBtn('cal', '📅', 'Calendario')}${tabBtn('tareas', '📣', 'Encargos', myPending().length)}${tabBtn('compra', '🛒', 'Compra', shop().filter(s => !s.done).length)}${tabBtn('despensa', '🥫', 'Despensa', pantry().filter(x => x.qty <= 0).length)}
  </nav>`;
  renderSyncDot();
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch {} }
  }
}

function tabBtn(id, icon, label, badge) {
  return `<button class="tab ${S.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">
    <span class="ti">${icon}${badge ? `<b class="badge">${badge}</b>` : ''}</span><span>${label}</span></button>`;
}

function renderSyncDot() {
  const el = document.getElementById('syncdot'); if (!el) return;
  const st = syncStatus();
  el.className = 'sync ' + st;
  el.title = { off: 'Solo en este móvil', ok: 'Sincronizado', offline: 'Sin conexión', connecting: 'Conectando…' }[st];
}

function repeatText(e) {
  if (e.repeat === 'weekly' && e.days?.length) {
    const d = [...e.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (d.join() === '1,2,3,4,5') return 'de lunes a viernes';
    return d.map(x => LETRAS[x]).join(', ');
  }
  return REPEAT_LABEL[e.repeat].toLowerCase();
}

function eventRow(e, day) {
  const who = e.who && e.who !== 'all' ? member(e.who)?.name : 'Todos';
  return `<button class="ev" data-act="editEvent" data-id="${e.id}" data-day="${day}" style="--c:${colorOf(e.who)}">
    <span class="evtime">${e.time ? esc(e.time) : '<small>Todo<br>el día</small>'}</span>
    <span class="evbody"><span class="evtitle">${esc(e.title)}</span>
      <span class="evmeta">${esc(who || '')}${e.repeat && e.repeat !== 'none' ? ' · 🔁 ' + repeatText(e) : ''}</span></span>
  </button>`;
}

function viewHoy() {
  const t = todayStr();
  const hour = new Date().getHours();
  const hola = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const d = new Date();
  const hoy = eventsOn(t);
  const man = eventsOn(ymd(addDays(d, 1)));
  let prox = '';
  for (let i = 2; i <= 7; i++) {
    const day = ymd(addDays(d, i));
    const evs = eventsOn(day);
    if (evs.length) prox += `<h3 class="dayh">${niceDate(day)}</h3>` + evs.map(e => eventRow(e, day)).join('');
  }
  const pend = shop().filter(s => !s.done);
  return `
  <p class="hello">${hola}, ${esc(member(S.me)?.name || '')} 👋<br><span>${DIAS_LARGO[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}</span></p>
  ${pushCard()}
  ${myPending().length ? `<section class="card taskcard"><h2>📣 Te han pedido</h2>${myPending().map(taskRow).join('')}</section>` : ''}
  <section class="card">
    <h2>Hoy</h2>
    ${hoy.length ? hoy.map(e => eventRow(e, t)).join('') : `<p class="empty">Nada para hoy 🎉</p>`}
  </section>
  <button class="card shopcard" data-act="tab" data-tab="compra">
    <span class="big">🛒</span>
    <span>${pend.length ? `<b>Faltan ${pend.length} ${pend.length === 1 ? 'cosa' : 'cosas'}</b><br><small>${esc(pend.slice(0, 5).map(p => p.name).join(', '))}${pend.length > 5 ? '…' : ''}</small>` : '<b>La lista de la compra está vacía</b>'}</span>
  </button>
  ${(() => { const out = pantry().filter(x => x.qty <= 0); return out.length ? `<button class="card shopcard" data-act="tab" data-tab="despensa"><span class="big">🥫</span><span><b>Se ha acabado: ${out.length === 1 ? '1 cosa' : out.length + ' cosas'}</b><br><small>${esc(out.slice(0, 5).map(p => p.name).join(', '))}${out.length > 5 ? '…' : ''}</small></span></button>` : ''; })()}
  <section class="card">
    <h2>Mañana</h2>
    ${man.length ? man.map(e => eventRow(e, ymd(addDays(d, 1)))).join('') : `<p class="empty">Nada todavía</p>`}
  </section>
  ${prox ? `<section class="card"><h2>Próximos días</h2>${prox}</section>` : ''}
  <div class="spacer"></div>`;
}

function pushCard() {
  if (!hasServer() || members().length < 2) return '';
  const st = pushSupport();
  if (st === 'default') return `<button class="card shopcard notice" data-act="enablePush"><span class="big">🔔</span><span><b>Activa los avisos</b><br><small>Para enterarte cuando ${esc(members().filter(m => m.id !== S.me).map(m => m.name).join(' y '))} añada un evento o algo a la compra.</small></span></button>`;
  if (st === 'install') return `<div class="card shopcard notice"><span class="big">📲</span><span><b>Instala la app para recibir avisos</b><br><small>En Safari: botón Compartir → “Añadir a pantalla de inicio”, y ábrela desde el icono.</small></span></div>`;
  return '';
}

function viewCal() {
  const m = S.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7)); // semana empieza en lunes
  const t = todayStr();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== m.getMonth()) break;
    const s = ymd(d);
    const evs = eventsOn(s);
    const dots = evs.slice(0, 4).map(e => `<i style="background:${colorOf(e.who)}"></i>`).join('');
    cells += `<button class="cd ${holidayOn(s) ? 'hol' : ''} ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${s === t ? 'today' : ''} ${s === S.calDay ? 'sel' : ''}" data-act="pickDay" data-day="${s}">
      <span>${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  const evs = eventsOn(S.calDay);
  return `
  <div class="calhead">
    <button class="round" data-act="month" data-d="-1" aria-label="Mes anterior">‹</button>
    <h2>${MESES[m.getMonth()][0].toUpperCase() + MESES[m.getMonth()].slice(1)} ${m.getFullYear()}</h2>
    <button class="round" data-act="month" data-d="1" aria-label="Mes siguiente">›</button>
  </div>
  <button class="link todaybtn" data-act="goToday">Ir a hoy</button>
  <div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<b>${x}</b>`).join('')}${cells}</div>
  <section class="card">
    <h2>${niceDate(S.calDay)}</h2>
    ${holidayOn(S.calDay) ? `<p class="holtag">🏖️ ${esc(holidayOn(S.calDay).name || 'Vacaciones')}</p>` : ''}
    ${evs.length ? evs.map(e => eventRow(e, S.calDay)).join('') : `<p class="empty">Nada este día</p>`}
    <button class="btn ghost" data-act="addEvent" data-day="${S.calDay}">＋ Añadir a este día</button>
  </section>
  <button class="btn ghost" data-act="holidays">🏖️ Vacaciones y días no lectivos</button>
  <div class="spacer"></div>`;
}

function taskRow(t) {
  const from = member(t.from)?.name || '';
  const to = t.to === 'all' ? 'todos' : member(t.to)?.name || '';
  const when = new Date(t.createdAt);
  const hora = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const dia = ymd(when) === todayStr() ? hora : `${niceDate(ymd(when)).toLowerCase()}, ${hora}`;
  if (t.done) {
    const dw = new Date(t.doneAt);
    return `<div class="task done-t"><span class="tchk">✓</span><span class="tbody"><b>${esc(t.title)}</b><small>Hecho por ${esc(member(t.doneBy)?.name || '')} a las ${String(dw.getHours()).padStart(2, '0')}:${String(dw.getMinutes()).padStart(2, '0')}</small></span>
      <button class="x" data-act="delTask" data-id="${t.id}" aria-label="Quitar">✕</button></div>`;
  }
  if (forMe(t)) return `<div class="task" style="--c:${colorOf(t.from)}"><span class="tbody"><b>${esc(t.title)}</b><small>${esc(from)} · ${dia}</small></span>
    <button class="btn done-btn" data-act="doneTask" data-id="${t.id}">✓ Hecho</button></div>`;
  return `<div class="task wait" style="--c:${colorOf(t.to)}"><span class="tbody"><b>${esc(t.title)}</b><small>Esperando a ${esc(to)} · ${dia}</small></span>
    <button class="x" data-act="delTask" data-id="${t.id}" aria-label="Cancelar">✕</button></div>`;
}

function viewTareas() {
  const mine = myPending();
  const asked = tasks().filter(t => !t.done && !forMe(t)).sort((a, b) => b.createdAt - a.createdAt);
  const done = tasks().filter(t => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 15);
  return `
  <button class="btn big" data-act="newTask">📣 Nuevo encargo</button>
  <p class="hint center">Le llega un aviso al momento y tiene que marcarlo como hecho.</p>
  <section class="card"><h2>Para ti</h2>${mine.length ? mine.map(taskRow).join('') : '<p class="empty">Nada pendiente 🙌</p>'}</section>
  ${asked.length ? `<section class="card"><h2>Has pedido</h2>${asked.map(taskRow).join('')}</section>` : ''}
  ${done.length ? `<section class="card done"><div class="rowh"><h2>Hechos</h2><button class="link" data-act="clearTasks">Vaciar</button></div>${done.map(taskRow).join('')}</section>` : ''}
  <div class="spacer"></div>`;
}

function taskSheet() {
  const others = members().filter(m => m.id !== S.me);
  const def = others.length === 1 ? others[0].id : 'all';
  const opts = [...others, { id: 'all', name: 'Todos', color: ALL_COLOR }];
  openSheet(`
    <form data-act="sendTask">
      <h2>📣 Nuevo encargo</h2>
      <p class="hint">Ej: <i>“Recoger a Lola del cole a las 4:15”</i>, <i>“Bajar al portal en 5 minutos”</i></p>
      <input id="taskText" name="text" type="text" placeholder="¿Qué hay que hacer?" autocomplete="off" enterkeyhint="send" required>
      <label>¿Para quién?</label>
      <div class="chips who">${opts.map(o => `<button type="button" class="chip ${def === o.id ? 'on' : ''}" data-act="who" data-id="${o.id}" style="--c:${o.color}">${esc(o.name)}</button>`).join('')}</div>
      <input type="hidden" name="who" value="${def}">
      ${others.length ? '' : '<p class="note">Aún no hay nadie más en la familia. Invita desde Ajustes.</p>'}
      <button class="btn big" type="submit">📣 Enviar aviso ya</button>
    </form>`, el => setTimeout(() => el.querySelector('input').focus(), 250));
}

function holidaysSheet() {
  const list = holidays();
  openSheet(`
    <h2>🏖️ Vacaciones y no lectivos</h2>
    <p class="hint">Los eventos repetitivos marcados con “No se hace en vacaciones” se saltan estos días.</p>
    <section class="card">${list.length ? list.map(h => `<div class="shop"><span class="sname">${esc(h.name || 'Vacaciones')}<br><small class="muted">${niceDate(h.from)}${h.to && h.to !== h.from ? ' → ' + niceDate(h.to).toLowerCase() : ''}</small></span><button class="x" data-act="delHoliday" data-id="${h.id}" aria-label="Quitar">✕</button></div>`).join('') : '<p class="empty">Ninguno todavía</p>'}</section>
    <form data-act="addHoliday">
      <label>Nombre</label>
      <input name="name" placeholder="Ej: Navidad, Puente, No lectivo" autocomplete="off" required>
      <div class="grid2">
        <div><label>Desde</label><input type="date" name="from" value="${todayStr()}" required></div>
        <div><label>Hasta</label><input type="date" name="to" value="${todayStr()}"></div>
      </div>
      <button class="btn big" type="submit">Añadir</button>
    </form>`, el => { const f = el.querySelector('form'); f.from.addEventListener('change', () => { if (f.to.value < f.from.value) f.to.value = f.from.value; }); });
}

async function favSheet() {
  // La primera vez convertimos los habituales automáticos en una lista propia, editable y compartida
  if (!favItems().length) await save(favorites().slice(0, 14).map(n => ({ id: uid(), kind: 'fav', name: n })));
  openSheet(`
    <h2>⭐ Habituales</h2>
    <p class="hint">Aparecen en la Compra para añadirlos con un toque. Se comparten con la familia.</p>
    <form data-act="addFav" class="row">
      <input name="name" id="favInput" placeholder="Ej: Galletas, Detergente" autocomplete="off" required>
      <button class="btn" type="submit">Añadir</button>
    </form>
    <div class="chips">${favItems().map(f => `<button class="chip" data-act="delFav" data-id="${f.id}">${esc(f.name)} <span class="muted">✕</span></button>`).join('')}</div>
    <button class="btn big" data-act="close">Hecho</button>`);
}

function viewCompra() {
  const all = shop();
  const pend = all.filter(s => !s.done).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const done = all.filter(s => s.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const onList = new Set(pend.map(p => norm(p.name)));
  const favs = favorites().filter(f => !onList.has(norm(f))).slice(0, 40);
  return `
  <form class="addshop" data-act="addShop">
    <input id="shopInput" type="text" placeholder="Añadir: leche, pan, huevos…" autocomplete="off" enterkeyhint="done">
    <button class="btn" type="submit">Añadir</button>
  </form>
  <div class="rowh favh"><small class="muted">⭐ Habituales</small><button class="link" data-act="editFavs">Editar</button></div>
  ${favs.length ? `<div class="chips">${favs.map(f => `<button class="chip" data-act="fav" data-name="${esc(f)}">＋ ${esc(f)}</button>`).join('')}</div>` : ''}
  <section class="card">
    ${pend.length ? pend.map(p => shopRow(p)).join('') : `<p class="empty">Nada que comprar 🎉<br><small>Escribe arriba o pulsa en los habituales</small></p>`}
  </section>
  ${done.length ? `<section class="card done">
    <div class="rowh"><h2>Comprado (${done.length})</h2><button class="link" data-act="clearDone">Vaciar</button></div>
    ${done.map(p => shopRow(p)).join('')}
  </section>` : ''}
  <div class="spacer"></div>`;
}

function viewDespensa() {
  const list = pantry().filter(x => (x.place || 'despensa') === S.place)
    .sort((a, b) => (a.qty > 0) - (b.qty > 0) || a.name.localeCompare(b.name, 'es'));
  const count = pl => pantry().filter(x => (x.place || 'despensa') === pl).length;
  return `
  <div class="chips places">${PLACES.map(([id, ic, n]) => `<button class="chip ${S.place === id ? 'on' : ''}" data-act="place" data-place="${id}">${ic} ${n}${count(id) ? ` <small>${count(id)}</small>` : ''}</button>`).join('')}</div>
  <form class="addshop" data-act="addPantry">
    <input id="pantryInput" type="text" placeholder="Añadir: arroz 2, atún 6…" autocomplete="off" enterkeyhint="done">
    <button class="btn" type="submit">Añadir</button>
  </form>
  <section class="card">
    ${list.length ? list.map(pantryRow).join('') : `<p class="empty">Aún no hay nada aquí<br><small>Escribe el producto y cuántos tenéis: <i>arroz 2, leche 6</i></small></p>`}
  </section>
  <p class="hint center">Al marcar algo como comprado en la Compra, se suma solo aquí.</p>
  <div class="spacer"></div>`;
}

function pantryRow(p) {
  const out = p.qty <= 0;
  const onList = shop().some(s => !s.done && norm(s.name) === norm(p.name));
  return `<div class="pan ${out ? 'is-out' : ''}">
    <button class="pname" data-act="editPantry" data-id="${p.id}">${esc(p.name)}${out ? `<small>${onList ? '✓ En la lista de la compra' : 'Se ha acabado'}</small>` : ''}</button>
    ${out && !onList ? `<button class="tobuy" data-act="pantryToShop" data-id="${p.id}">🛒 Comprar</button>` : ''}
    <button class="step" data-act="qty" data-id="${p.id}" data-d="-1" aria-label="Quitar uno">−</button>
    <b class="qty">${p.qty}</b>
    <button class="step" data-act="qty" data-id="${p.id}" data-d="1" aria-label="Añadir uno">+</button>
  </div>`;
}

function pantrySheet(p) {
  openSheet(`
    <form data-act="savePantry" data-id="${p.id}">
      <h2>${esc(p.name)}</h2>
      <label>Nombre</label>
      <input name="name" value="${esc(p.name)}" required autocomplete="off">
      <label>Cantidad</label>
      <input name="qty" type="number" inputmode="numeric" min="0" value="${p.qty}">
      <label>Dónde está</label>
      <select name="place">${PLACES.map(([id, ic, n]) => `<option value="${id}" ${(p.place || 'despensa') === id ? 'selected' : ''}>${ic} ${n}</option>`).join('')}</select>
      <button class="btn big" type="submit">Guardar</button>
      <button type="button" class="btn danger ghost" data-act="delPantry" data-id="${p.id}">Quitar de la despensa</button>
    </form>`);
}

// "arroz 2", "6 latas de atún", "leche x3" -> {name, qty}
function parsePantry(text) {
  return parseShopping(text).map(t => {
    let m, qty = 1, name = t;
    if ((m = t.match(/^(\d+)\s*(?:x\s*)?(.+)$/i))) { qty = +m[1]; name = m[2]; }
    else if ((m = t.match(/^(.+?)\s*(?:x\s*)?(\d+)$/i))) { qty = +m[2]; name = m[1]; }
    name = name.trim(); name = name[0].toUpperCase() + name.slice(1);
    return { name, qty };
  });
}

async function addPantry(entries) {
  const out = [];
  for (const { name, qty } of entries) {
    const ex = pantry().find(x => norm(x.name) === norm(name));
    if (ex) out.push({ ...ex, qty: ex.qty + qty });
    else out.push({ id: uid(), kind: 'pantry', name, qty, place: S.place, createdAt: Date.now() });
  }
  if (out.length) await save(out);
}

function shopRow(p) {
  return `<div class="shop ${p.done ? 'is-done' : ''}">
    <button class="check" data-act="toggleShop" data-id="${p.id}" aria-label="Marcar">${p.done ? '✓' : ''}</button>
    <button class="sname" data-act="toggleShop" data-id="${p.id}">${esc(p.name)}</button>
    <span class="whodot" style="background:${colorOf(p.by)}" title="${esc(member(p.by)?.name || '')}"></span>
    <button class="x" data-act="delShop" data-id="${p.id}" aria-label="Quitar">✕</button>
  </div>`;
}

// Habituales: lo que más se compra (se aprende solo)
let freqCache = null;
const favItems = () => S.items.filter(i => i.kind === 'fav' && !i.deleted).sort((a, b) => a.name.localeCompare(b.name, 'es'));
// Habituales: los que elegís vosotros (compartidos). Si aún no hay ninguno, se aprenden solos.
function favorites() {
  if (favItems().length) return favItems().map(f => f.name);
  const f = freqCache || {};
  const names = Object.entries(f).sort((a, b) => b[1].n - a[1].n).map(([, v]) => v.name);
  const defaults = ['Leche', 'Pan', 'Huevos', 'Fruta', 'Agua', 'Café', 'Papel higiénico', 'Yogures'];
  for (const d of defaults) if (!names.some(n => norm(n) === norm(d))) names.push(d);
  return names;
}
async function bumpFreq(names) {
  const f = (await meta.get('freq')) || {};
  for (const n of names) { const k = norm(n); f[k] = { name: n, n: (f[k]?.n || 0) + 1 }; }
  freqCache = f; await meta.set('freq', f);
}

// ---------------------------------------------------------------- hojas (ventanas)
let sheetEl = null;
function openSheet(html, onMount) {
  closeSheet();
  sheetEl = document.createElement('div');
  sheetEl.className = 'overlay';
  sheetEl.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(sheetEl);
  sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); });
  sheetEl.addEventListener('click', onClick);
  sheetEl.addEventListener('submit', onSubmit);
  requestAnimationFrame(() => sheetEl && sheetEl.classList.add('in'));
  onMount && onMount(sheetEl);
}
function closeSheet() {
  stopCamera();
  if (sheetEl) { sheetEl.remove(); sheetEl = null; }
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('in'), 10);
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 1800);
}

function plusSheet() {
  openSheet(`
    <h2 class="center">¿Qué quieres añadir?</h2>
    <div class="bigchoices">
      <button data-act="newTask" class="wide"><span>📣</span>Encargo con aviso</button>
      <button data-act="addEvent"><span>📅</span>Evento</button>
      <button data-act="addRepeat"><span>🔁</span>Repetitivo</button>
      <button data-act="addShopSheet"><span>🛒</span>Compra</button>
      <button data-act="addPantrySheet"><span>🥫</span>Despensa</button>
    </div>`);
}

function whoChips(sel) {
  const opts = [{ id: 'all', name: 'Todos', color: ALL_COLOR }, ...members()];
  return `<div class="chips who">${opts.map(o => `<button type="button" class="chip ${sel === o.id ? 'on' : ''}" data-act="who" data-id="${o.id}" style="--c:${o.color}">${esc(o.name)}</button>`).join('')}</div>`;
}

function eventSheet({ ev = null, day = null, repeat = false } = {}) {
  const isNew = !ev;
  const e = ev || { title: '', date: day || (S.tab === 'cal' ? S.calDay : todayStr()), time: '', who: 'all', repeat: repeat ? 'weekly' : 'none' };
  const occ = day || e.date;
  openSheet(`
    <form class="evform" data-act="saveEvent">
      <h2>${isNew ? (repeat ? 'Nuevo evento repetitivo' : 'Nuevo evento') : 'Editar evento'}</h2>
      ${isNew ? `<p class="hint">Escríbelo como lo dirías: <i>${repeat ? '“Basura todos los martes 21h”' : '“Dentista jueves 17h”'}</i>. Puedes usar el micrófono del teclado 🎤</p>` : ''}
      <input name="text" id="evText" type="text" value="${esc(e.title)}" placeholder="${repeat ? 'Ej: Pádel cada miércoles a las 7' : 'Ej: Cena con Luis mañana 21h'}" autocomplete="off" enterkeyhint="done" required>
      <label>¿Para quién?</label>
      ${whoChips(e.who || 'all')}
      <input type="hidden" name="who" value="${esc(e.who || 'all')}">
      <div class="grid2">
        <div><label>Día</label><input type="date" name="date" value="${esc(e.date)}" required></div>
        <div><label>Hora</label><input type="time" name="time" value="${esc(e.time)}"></div>
      </div>
      <label>Repetir</label>
      <select name="repeat">${Object.entries(REPEAT_LABEL).map(([k, v]) => `<option value="${k}" ${e.repeat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="rep-opts">
        <div class="weekonly"><label>Qué días</label>
          <div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="dp" data-act="dayToggle" data-d="${d}">${LETRAS[d]}</button>`).join('')}</div>
        </div>
        <input type="hidden" name="days" value="${esc((e.days || []).join(','))}">
        <label class="check-row"><input type="checkbox" name="noHolidays" ${e.noHolidays ? 'checked' : ''}> 🏖️ No se hace en vacaciones ni días no lectivos</label>
        <label>Hasta (opcional)</label>
        <input type="date" name="until" value="${esc(e.until || '')}">
      </div>
      <button class="btn big" type="submit">Guardar</button>
      ${!isNew ? (e.repeat && e.repeat !== 'none'
        ? `<div class="grid2"><button type="button" class="btn danger ghost" data-act="delOcc" data-day="${occ}">Borrar solo ${niceDate(occ).toLowerCase()}</button><button type="button" class="btn danger ghost" data-act="delEvent">Borrar todos</button></div>`
        : `<button type="button" class="btn danger ghost" data-act="delEvent">Borrar</button>`) : ''}
    </form>`, el => {
    const f = el.querySelector('form');
    f.dataset.id = ev ? ev.id : '';
    const touched = new Set();
    ['date', 'time', 'repeat'].forEach(n => f[n].addEventListener('input', () => touched.add(n)));
    f.repeat.addEventListener('change', () => syncRepeatUI(f));
    f.date.addEventListener('change', () => { if (!f.days.value) syncRepeatUI(f); });
    syncRepeatUI(f);
    const txt = f.text;
    txt.addEventListener('input', () => {
      if (!isNew) return;
      const p = parseEvent(txt.value);
      if (!touched.has('date')) f.date.value = p.date || e.date;
      if (!touched.has('time')) f.time.value = p.time || '';
      if (!touched.has('repeat')) f.repeat.value = p.repeat !== 'none' ? p.repeat : (repeat ? 'weekly' : 'none');
      if (!f.dataset.touchedDays) f.days.value = p.days ? p.days.join(',') : '';
      syncRepeatUI(f);
      // detectar persona por nombre
      const tn = norm(txt.value);
      for (const m of members()) if (new RegExp('\\b' + norm(m.name) + '\\b').test(tn)) setWho(f, m.id);
    });
    if (isNew) setTimeout(() => txt.focus(), 250);
  });
}

function syncRepeatUI(f) {
  const rep = f.repeat.value;
  f.querySelector('.rep-opts').hidden = rep === 'none';
  f.querySelector('.weekonly').hidden = rep !== 'weekly';
  let days = f.days.value ? f.days.value.split(',').map(Number) : [];
  if (rep === 'weekly' && !days.length && f.date.value) days = [fromYmd(f.date.value).getDay()];
  f.querySelectorAll('.dp').forEach(b => b.classList.toggle('on', rep === 'weekly' && days.includes(+b.dataset.d)));
}

function setWho(form, id) {
  form.who.value = id;
  form.querySelectorAll('.chips.who .chip').forEach(c => c.classList.toggle('on', c.dataset.id === id));
}

function shopSheet() {
  openSheet(`
    <form data-act="addShopSheet2">
      <h2>Añadir a la compra</h2>
      <p class="hint">Separa con comas: <i>leche, pan, huevos</i></p>
      <input id="shopSheetInput" name="text" type="text" placeholder="leche, pan, huevos" autocomplete="off" enterkeyhint="done" required>
      <button class="btn big" type="submit">Añadir</button>
    </form>`, el => setTimeout(() => el.querySelector('input').focus(), 250));
}

function settingsSheet() {
  const me = member(S.me);
  const st = syncStatus();
  const nube = {
    off: '⚪ Aún sin servidor: los datos están guardados solo en este móvil.',
    ok: '🟢 Sincronizado con la nube.',
    offline: '🟠 Sin conexión. Todo se guarda en el móvil y se enviará al volver internet.',
    connecting: '🟡 Conectando…',
  }[st];
  openSheet(`
    <h2>Ajustes</h2>
    <label>Familia</label>
    <div class="memlist">${members().map(m => `<div class="memrow"><span class="avatar" style="background:${m.color}">${esc(m.name[0].toUpperCase())}</span><span class="sname">${esc(m.name)}${m.id === S.me ? ' (tú)' : ''}</span>${m.id === S.me ? '' : `<button class="link danger-t" data-act="askDelMember" data-id="${m.id}">Quitar</button>`}</div>`).join('')}</div>
    <button class="btn" data-act="invite">📷 Invitar a alguien (mostrar código)</button>
    <label>Tu nombre y color</label>
    <form data-act="saveMe" class="row">
      <input name="name" value="${esc(me?.name || '')}" required autocomplete="off">
      <button class="btn" type="submit">Guardar</button>
    </form>
    <div class="colors">${COLORS.map(c => `<button class="color ${me?.color === c ? 'on' : ''}" data-act="myColor" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
    <label>Nube</label>
    <p class="note">${nube}</p>
    <label>Avisos</label>
    ${(() => { const p = pushSupport(); return {
      noserver: '<p class="note">Los avisos estarán disponibles cuando se active el servidor.</p>',
      install: '<p class="note">📲 Para recibir avisos, instala la app: en Safari, Compartir → “Añadir a pantalla de inicio”.</p>',
      unsupported: '<p class="note">Este móvil no admite avisos (hace falta iOS 16.4 o superior).</p>',
      denied: '<p class="note">🔕 Los avisos están bloqueados. Actívalos en Ajustes del iPhone → Notificaciones → Familia.</p>',
      granted: '<p class="note">🔔 Avisos activados en este móvil.</p><button class="btn ghost" data-act="testPush">Probar aviso</button>',
      default: '<button class="btn" data-act="enablePush">🔔 Activar avisos</button>',
    }[p]; })()}
    <label>Copia de seguridad</label>
    <div class="grid2">
      <button class="btn ghost" data-act="backup">⬇️ Guardar copia</button>
      <label class="btn ghost filebtn">⬆️ Cargar copia<input type="file" accept="application/json,.json" data-act="restore" hidden></label>
    </div>
    <button class="link danger-t leave" data-act="askLeave">Salir de la familia en este móvil</button>
    <p class="ver">Versión ${VERSION}</p>`, el => {
    el.querySelector('input[type=file]').addEventListener('change', restoreBackup);
  });
}

// ---------------------------------------------------------------- invitación / QR
function encodePayload() {
  const obj = { f: S.family.id, m: members().map(m => [m.id, m.name, m.color]) };
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodePayload(s) {
  try {
    s = s.trim();
    const i = s.indexOf('#unir='); if (i >= 0) s = s.slice(i + 6);
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(b))));
    return o && o.f ? o : null;
  } catch { return null; }
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
function inviteSheet(first = false) {
  const url = APP_URL + '#unir=' + encodePayload();
  openSheet(`
    <h2 class="center">${first ? '¡Familia creada! 🎉' : 'Invitar a la familia'}</h2>
    <p class="hint center">En el otro móvil: abre la app, escribe tu nombre, pulsa <b>“Unirme a mi familia”</b> y apunta la cámara a este código.<br><small>También vale escanearlo con la cámara normal del iPhone.</small></p>
    <div class="qr">${qrSvg(url)}</div>
    <button class="btn ghost" data-act="copyInvite" data-url="${esc(url)}">Copiar enlace de invitación</button>
    <button class="btn big" data-act="close">Hecho</button>`);
}

// ---------------------------------------------------------------- bienvenida
let welcomeColor = COLORS[0];
function renderWelcome() {
  const jp = S.joinPayload;
  const used = new Set((jp?.m || []).map(m => m[2]));
  if (jp && used.has(welcomeColor)) welcomeColor = COLORS.find(c => !used.has(c)) || COLORS[1];
  const host = jp?.m?.[0]?.[1];
  app.innerHTML = `
  <div class="welcome">
    <img src="icons/icon-192.png" alt="" class="logo">
    <h1>${jp ? `Unirte a la familia${host ? ' de ' + esc(host) : ''}` : 'Vuestra agenda familiar'}</h1>
    <p class="sub">${jp ? 'Solo falta tu nombre.' : 'Eventos y compra, compartidos y siempre a mano, incluso sin internet.'}</p>
    <form data-act="${jp ? 'joinFamily' : 'createFamily'}">
      <label>¿Cómo te llamas?</label>
      <input id="wName" name="name" type="text" placeholder="Tu nombre" autocomplete="given-name" required>
      <label>Elige tu color</label>
      <div class="colors">${COLORS.map(c => `<button type="button" class="color ${c === welcomeColor ? 'on' : ''}" data-act="wColor" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <button class="btn big" type="submit">${jp ? 'Unirme' : 'Crear familia nueva'}</button>
    </form>
    ${jp ? '' : `<button class="btn ghost big" data-act="joinScan">📷 Unirme a mi familia</button>
    <p class="hint center">¿Tu pareja ya ha creado la familia? Pulsa “Unirme” y escanea el código de su móvil.</p>`}
  </div>`;
}

async function createFamily(name) {
  const fam = { id: uid() + uid(), createdAt: Date.now() };
  const me = { id: uid(), kind: 'member', name, color: welcomeColor };
  await meta.set('family', fam); await meta.set('me', me.id);
  S.family = fam; S.me = me.id;
  await save(me);
  startSync(fam.id, reload);
  inviteSheet(true);
}

async function joinFamily(name, payload) {
  const fam = { id: payload.f, joinedAt: Date.now() };
  const others = (payload.m || []).map(([id, n, c]) => ({ id, kind: 'member', name: n, color: c, updatedAt: 1, dirty: false }));
  await putItems(others);
  const me = { id: uid(), kind: 'member', name, color: welcomeColor };
  await meta.set('family', fam); await meta.set('me', me.id);
  S.family = fam; S.me = me.id; S.joinPayload = null;
  history.replaceState(null, '', APP_URL);
  S.items = await allItems();
  await save(me);
  startSync(fam.id, reload);
  toast('¡Ya estás dentro! 🎉');
}

// Escáner de QR con la cámara
let camStream = null, camRaf = 0;
function stopCamera() {
  cancelAnimationFrame(camRaf);
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}
function scanSheet() {
  openSheet(`
    <h2 class="center">Escanea el código</h2>
    <p class="hint center">Apunta al código que aparece en el otro móvil (Ajustes → Invitar).</p>
    <div class="cam"><video playsinline muted></video><div class="frame"></div></div>
    <p class="hint center" id="camMsg"></p>
    <form data-act="pasteCode">
      <label>¿No funciona la cámara? Pega el enlace de invitación:</label>
      <div class="row"><input name="code" autocomplete="off" placeholder="Enlace o código"><button class="btn" type="submit">OK</button></div>
    </form>`, async el => {
    const video = el.querySelector('video');
    const msg = el.querySelector('#camMsg');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = camStream; await video.play();
      const c = document.createElement('canvas'); const ctx = c.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (!camStream) return;
        if (video.readyState >= 2) {
          const w = 480, h = Math.round(480 * video.videoHeight / video.videoWidth) || 480;
          c.width = w; c.height = h; ctx.drawImage(video, 0, 0, w, h);
          const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          if (r && r.data) { const p = decodePayload(r.data); if (p) return gotPayload(p); }
        }
        camRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      msg.textContent = 'No se pudo abrir la cámara. Permite el acceso a la cámara o usa el enlace.';
    }
  });
}
function gotPayload(p) {
  closeSheet();
  S.joinPayload = p;
  const name = document.getElementById('wName')?.value;
  renderWelcome();
  if (name) document.getElementById('wName').value = name;
}

// ---------------------------------------------------------------- copias
async function backup() {
  const data = { app: 'familia', version: VERSION, family: S.family, me: S.me, items: S.items.map(({ dirty, ...i }) => i), at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], `familia-${todayStr()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia Familia' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
}
async function restoreBackup(ev) {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'familia' || !Array.isArray(data.items)) throw new Error();
    if (data.family?.id !== S.family.id) { toast('Esa copia es de otra familia'); return; }
    const byId = new Map(S.items.map(i => [i.id, i]));
    const newer = data.items.filter(i => !byId.has(i.id) || (i.updatedAt || 0) > (byId.get(i.id).updatedAt || 0)).map(i => ({ ...i, dirty: true }));
    await putItems(newer); await reload(); syncNow();
    closeSheet(); toast(`Copia cargada (${newer.length} cambios)`);
  } catch { toast('Ese archivo no es una copia válida'); }
}

// ---------------------------------------------------------------- eventos de interfaz
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
  const a = b.dataset.act;
  switch (a) {
    case 'tab': S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'plus': plusSheet(); break;
    case 'settings': settingsSheet(); break;
    case 'close': closeSheet(); break;
    case 'addEvent': eventSheet({ day: b.dataset.day }); break;
    case 'addRepeat': eventSheet({ repeat: true }); break;
    case 'addShopSheet': shopSheet(); break;
    case 'editEvent': { const ev = S.items.find(i => i.id === b.dataset.id); if (ev) eventSheet({ ev, day: b.dataset.day }); break; }
    case 'who': setWho(b.closest('form'), b.dataset.id); break;
    case 'delEvent': { const id = b.closest('form').dataset.id; const ev = S.items.find(i => i.id === id); closeSheet(); await save({ ...ev, deleted: true }); toast('Borrado'); break; }
    case 'delOcc': { const id = b.closest('form').dataset.id; const ev = S.items.find(i => i.id === id); closeSheet(); await save({ ...ev, skip: [...(ev.skip || []), b.dataset.day] }); toast('Borrado ese día'); break; }
    case 'dayToggle': {
      const f = b.closest('form');
      let days = f.days.value ? f.days.value.split(',').map(Number) : [];
      if (!days.length && f.date.value) days = [fromYmd(f.date.value).getDay()];
      const d = +b.dataset.d;
      days = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
      f.days.value = days.join(',');
      f.dataset.touchedDays = '1';
      syncRepeatUI(f); break;
    }
    case 'holidays': holidaysSheet(); break;
    case 'delHoliday': { const it = S.items.find(i => i.id === b.dataset.id); await save({ ...it, deleted: true }); holidaysSheet(); break; }
    case 'newTask': taskSheet(); break;
    case 'editFavs': favSheet(); break;
    case 'delFav': { const it = S.items.find(i => i.id === b.dataset.id); await save({ ...it, deleted: true }); favSheet(); break; }
    case 'doneTask': {
      const t = S.items.find(i => i.id === b.dataset.id);
      await save({ ...t, done: true, doneBy: S.me, doneAt: Date.now() });
      queueNotice({ urgent: true, from: S.me, to: t.from, title: '✅ Hecho', body: `${member(S.me)?.name || ''}: ${t.title}`, tab: 'tareas' });
      toast('✅ Avisado de que está hecho'); break;
    }
    case 'delTask': { const t = S.items.find(i => i.id === b.dataset.id); await save({ ...t, deleted: true }); break; }
    case 'clearTasks': await save(tasks().filter(t => t.done).map(t => ({ ...t, deleted: true }))); break;
    case 'pickDay': S.calDay = b.dataset.day; render(); break;
    case 'month': S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + +b.dataset.d, 1); render(); break;
    case 'goToday': { const d = new Date(); S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); S.calDay = todayStr(); render(); break; }
    case 'toggleShop': {
      const it = S.items.find(i => i.id === b.dataset.id);
      const pan = pantry().find(x => norm(x.name) === norm(it.name));
      const list = [{ ...it, done: !it.done, doneAt: Date.now() }];
      if (pan) list.push({ ...pan, qty: Math.max(0, pan.qty + (it.done ? -1 : 1)) });
      await save(list);
      if (pan && !it.done) toast(`Despensa: ${pan.name} → ${pan.qty + 1}`);
      break;
    }
    case 'delShop': { const it = S.items.find(i => i.id === b.dataset.id); await save({ ...it, deleted: true }); break; }
    case 'clearDone': await save(shop().filter(s => s.done).map(s => ({ ...s, deleted: true }))); break;
    case 'fav': await addShop([b.dataset.name]); break;
    case 'place': S.place = b.dataset.place; render(); break;
    case 'qty': { const it = S.items.find(i => i.id === b.dataset.id); await save({ ...it, qty: Math.max(0, it.qty + +b.dataset.d) }); break; }
    case 'pantryToShop': { const it = S.items.find(i => i.id === b.dataset.id); await addShop([it.name]); toast(`${it.name}: a la compra`); break; }
    case 'editPantry': { const it = S.items.find(i => i.id === b.dataset.id); if (it) pantrySheet(it); break; }
    case 'delPantry': { const it = S.items.find(i => i.id === b.dataset.id); closeSheet(); await save({ ...it, deleted: true }); toast('Quitado'); break; }
    case 'addPantrySheet': closeSheet(); S.tab = 'despensa'; render(); setTimeout(() => document.getElementById('pantryInput')?.focus(), 50); break;
    case 'invite': inviteSheet(); break;
    case 'askDelMember': {
      const m = member(b.dataset.id);
      openSheet(`<h2>¿Quitar a ${esc(m.name)}?</h2>
        <p class="hint">Desaparecerá de la familia en todos los móviles y dejará de recibir avisos. Lo que añadió (eventos, compra…) se queda.</p>
        <button class="btn big danger-bg" data-act="delMember" data-id="${m.id}">Sí, quitar a ${esc(m.name)}</button>
        <button class="btn ghost" data-act="settings">Cancelar</button>`);
      break;
    }
    case 'delMember': {
      const m = member(b.dataset.id);
      await save({ ...m, deleted: true });
      removeMemberFromServer(m.id);
      toast(`${m.name} quitado`); settingsSheet(); break;
    }
    case 'askLeave':
      openSheet(`<h2>¿Salir de la familia?</h2>
        <p class="hint">Se borran los datos de <b>este móvil</b> y vuelves a la pantalla de inicio para crear o unirte a una familia. Los demás móviles no pierden nada.</p>
        <button class="btn big danger-bg" data-act="leave">Sí, salir en este móvil</button>
        <button class="btn ghost" data-act="settings">Cancelar</button>`);
      break;
    case 'leave': {
      removeMemberFromServer(S.me);
      const m = member(S.me);
      if (m && members().length > 1) { await save({ ...m, deleted: true }); try { await syncNow(); } catch {} }
      await clearAll();
      location.replace(APP_URL);
      break;
    }
    case 'copyInvite': try { await navigator.clipboard.writeText(b.dataset.url); toast('Enlace copiado'); } catch { toast('No se pudo copiar'); } break;
    case 'myColor': { const me = member(S.me); await save({ ...me, color: b.dataset.c }); settingsSheet(); break; }
    case 'backup': backup(); break;
    case 'enablePush': {
      try { const ok = await enablePush(S.me); toast(ok ? '🔔 Avisos activados' : 'No se activaron los avisos'); }
      catch (err) { console.warn(err); toast('No se pudieron activar los avisos'); }
      if (sheetEl) settingsSheet(); else render();
      break;
    }
    case 'testPush': {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('🔔 Así se verán los avisos', { body: 'Ejemplo: Ana ha añadido: leche, pan', icon: 'icons/icon-192.png' });
      break;
    }
    case 'wColor': welcomeColor = b.dataset.c; document.querySelectorAll('.welcome .color').forEach(c => c.classList.toggle('on', c.dataset.c === welcomeColor)); break;
    case 'joinScan': scanSheet(); break;
  }
}

async function addShop(names) {
  const existing = new Set(shop().filter(s => !s.done).map(s => norm(s.name)));
  const t = Date.now();
  const add = [];
  for (const n of names) {
    const k = norm(n);
    if (existing.has(k)) continue;
    existing.add(k);
    // si estaba en "comprado", lo reactivamos en vez de duplicar
    const old = shop().find(s => s.done && norm(s.name) === k);
    add.push(old ? { ...old, done: false, createdAt: t + add.length } : { id: uid(), kind: 'shop', name: n, done: false, createdAt: t + add.length });
  }
  if (add.length) {
    await bumpFreq(names); await save(add);
    queueNotice({ group: 'compra', from: S.me, who: member(S.me)?.name || '', title: '🛒 Lista de la compra', items: add.map(a => a.name), tab: 'compra' });
  }
  else toast('Ya está en la lista');
}

async function onSubmit(e) {
  const f = e.target; const a = f.dataset.act; if (!a) return;
  e.preventDefault();
  const fd = new FormData(f);
  switch (a) {
    case 'createFamily': await createFamily(fd.get('name').trim()); break;
    case 'joinFamily': await joinFamily(fd.get('name').trim(), S.joinPayload); break;
    case 'addShop': {
      const names = parseShopping(fd.get('text') ?? f.querySelector('input').value);
      f.querySelector('input').value = '';
      await addShop(names);
      document.getElementById('shopInput')?.focus();
      break;
    }
    case 'addShopSheet2': { const names = parseShopping(fd.get('text')); closeSheet(); S.tab = 'compra'; await addShop(names); render(); toast('Añadido a la compra'); break; }
    case 'saveEvent': {
      const id = f.dataset.id;
      let title = fd.get('text').trim();
      if (!id) title = parseEvent(title).title || title;
      const base = id ? S.items.find(i => i.id === id) : { id: uid(), kind: 'event', createdAt: Date.now() };
      const repeat = fd.get('repeat') || 'none';
      let days = fd.get('days') ? fd.get('days').split(',').map(Number) : [];
      let date = fd.get('date');
      if (repeat === 'weekly' && days.length) {
        // la primera vez: el primer día marcado a partir de la fecha elegida
        const d0 = fromYmd(date); const diff = Math.min(...days.map(d => (d - d0.getDay() + 7) % 7));
        date = ymd(addDays(d0, diff));
      } else days = [];
      const ev = { ...base, title, date, time: fd.get('time') || '', who: fd.get('who') || 'all', repeat, days,
        noHolidays: repeat !== 'none' && !!fd.get('noHolidays'), until: repeat !== 'none' ? (fd.get('until') || '') : '' };
      closeSheet();
      await save(ev);
      if (!id) queueNotice({ from: S.me, title: '📅 Nuevo evento', body: `${member(S.me)?.name || ''}: ${ev.title} · ${niceDate(ev.date)}${ev.time ? ', ' + ev.time : ''}${ev.repeat !== 'none' ? ' (' + repeatText(ev) + ')' : ''}`, tab: 'cal' });
      toast(`Guardado: ${niceDate(ev.date)}${ev.time ? ' ' + ev.time : ''}`);
      break;
    }
    case 'addFav': {
      const names = parseShopping(fd.get('name'));
      const have = new Set(favItems().map(f => norm(f.name)));
      await save(names.filter(n => !have.has(norm(n))).map(n => ({ id: uid(), kind: 'fav', name: n })));
      await favSheet(); setTimeout(() => document.getElementById('favInput')?.focus(), 50); break;
    }
    case 'sendTask': {
      const title = fd.get('text').trim(); if (!title) break;
      const to = fd.get('who') || 'all';
      const t = { id: uid(), kind: 'task', title, from: S.me, to, done: false, createdAt: Date.now() };
      closeSheet();
      S.tab = 'tareas';
      await save(t);
      queueNotice({ urgent: true, from: S.me, to, title: `📣 ${member(S.me)?.name || ''} te pide`, body: title, tab: 'tareas' });
      toast(navigator.onLine ? '📣 Aviso enviado' : '📣 Se enviará al volver internet');
      break;
    }
    case 'addHoliday': {
      const from = fd.get('from'); const to = fd.get('to') && fd.get('to') >= from ? fd.get('to') : from;
      await save({ id: uid(), kind: 'holiday', name: fd.get('name').trim(), from, to, createdAt: Date.now() });
      holidaysSheet(); toast('Añadido'); break;
    }
    case 'addPantry': {
      const inp = f.querySelector('input'); const entries = parsePantry(inp.value); inp.value = '';
      await addPantry(entries); document.getElementById('pantryInput')?.focus(); break;
    }
    case 'savePantry': {
      const it = S.items.find(i => i.id === f.dataset.id);
      closeSheet();
      await save({ ...it, name: fd.get('name').trim(), qty: Math.max(0, parseInt(fd.get('qty'), 10) || 0), place: fd.get('place') });
      toast('Guardado'); break;
    }
    case 'saveMe': { const me = member(S.me); await save({ ...me, name: fd.get('name').trim() }); closeSheet(); toast('Guardado'); break; }
    case 'pasteCode': { const p = decodePayload(fd.get('code') || ''); if (p) gotPayload(p); else toast('Código no válido'); break; }
  }
}

app.addEventListener('click', onClick);
app.addEventListener('submit', onSubmit);
// Si cambia el día con la app abierta
let shownDay = todayStr();
setInterval(() => { if (todayStr() !== shownDay && S.family && !sheetEl && document.activeElement?.tagName !== 'INPUT') { shownDay = todayStr(); S.calDay = shownDay; render(); } }, 60000);
meta.get('freq').then(f => { freqCache = f || {}; });

// ---------------------------------------------------------------- actualizaciones automáticas
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Nueva versión instalada: recargamos (salvo la primera vez, o si estás escribiendo)
    if (!hadController || reloaded) return;
    reloaded = true;
    if (!sheetEl && document.activeElement?.tagName !== 'INPUT') location.reload();
  });
}

init();
