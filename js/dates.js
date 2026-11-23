export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const todayStr = () => ymd(new Date());

export const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function niceDate(s) {
  const d = fromYmd(s);
  const t = fromYmd(todayStr());
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const base = `${DIAS_LARGO[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  const out = d.getFullYear() !== t.getFullYear() ? `${base} de ${d.getFullYear()}` : base;
  return out[0].toUpperCase() + out.slice(1);
}

// ¿El evento ocurre en este día (YYYY-MM-DD)?
export function occursOn(ev, s) {
  if (ev.date === s) return true;
  if (!ev.repeat || ev.repeat === 'none' || s < ev.date) return false;
  if (ev.skip && ev.skip.includes(s)) return false;
  const a = fromYmd(ev.date), b = fromYmd(s);
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekly': return a.getDay() === b.getDay();
    case 'monthly': return a.getDate() === b.getDate();
    case 'yearly': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
  }
  return false;
}

export const REPEAT_LABEL = { none: 'No se repite', daily: 'Cada día', weekly: 'Cada semana', monthly: 'Cada mes', yearly: 'Cada año' };
