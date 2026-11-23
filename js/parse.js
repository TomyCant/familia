// Entiende frases como "Dentista jueves 17h", "Cena con Luis mañana a las 9 de la noche",
// "Basura todos los martes 21:00", "Cumpleaños mamá 12 de marzo".
import { ymd, addDays } from './dates.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUM = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12 };

export const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseEvent(text, baseDate = new Date()) {
  const original = text.trim();
  // Trabajamos sobre una versión sin acentos con la MISMA longitud que el original
  let t = norm(original);
  if (t.length !== original.length) t = original.toLowerCase();
  const used = new Array(t.length).fill(false);
  const take = (m) => { for (let i = m.index; i < m.index + m[0].length; i++) used[i] = true; };
  const find = (re) => { re.lastIndex = 0; let m; while ((m = re.exec(t))) { const free = !used.slice(m.index, m.index + m[0].length).some(Boolean); if (free) return m; } return null; };

  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  let date = null, time = '', repeat = 'none', m;

  // --- Repetición
  if ((m = find(/\b(cada|todos los|todas las)\s+(dia|dias)\b/g))) { repeat = 'daily'; take(m); }
  else if ((m = find(/\b(cada|todos los)\s+(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/g))) {
    repeat = 'weekly'; take(m);
    const idx = DIAS.indexOf(m[2]) >= 0 ? DIAS.indexOf(m[2]) : DIAS.indexOf(m[2].replace(/s$/, ''));
    date = nextWeekday(today, idx, true);
  }
  else if ((m = find(/\b(cada|todas las)\s+(semana|semanas)\b/g))) { repeat = 'weekly'; take(m); }
  else if ((m = find(/\b(cada|todos los)\s+(mes|meses)\b/g))) { repeat = 'monthly'; take(m); }
  else if ((m = find(/\b(cada|todos los)\s+(ano|anos|año|años)\b/g))) { repeat = 'yearly'; take(m); }
  else if ((m = find(/\b(cada|todos los)\s+(\d{1,2})\b/g))) {
    repeat = 'monthly'; take(m);
    date = nextMonthDay(today, +m[2]);
  }
  if (repeat === 'none' && /\bcumplea(n|ñ)os\b/.test(t)) repeat = 'yearly';

  // --- Varios días de la semana: "lunes y miércoles", "L y X", "de lunes a viernes", "entre semana"
  let days = null;
  if ((m = find(/\b(?:todos\s+los\s+dias\s+)?(?:de\s+)?lunes\s+a\s+viernes\b|\bentre\s+semana\b/g))) { days = [1, 2, 3, 4, 5]; take(m); }
  else if ((m = find(/\b(?:los\s+)?fines?\s+de\s+semana\b|\bfindes?\b/g))) { days = [6, 0]; take(m); }
  else {
    const found = [];
    const reDay = /\b(?:(?:todos|cada)\s+)?(?:los\s+|el\s+)?(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/g;
    let mm; reDay.lastIndex = 0;
    while ((mm = reDay.exec(t))) found.push(mm);
    // Letras sueltas en mayúscula: L M X J V S D
    const reLet = /(?:^|[\s,(])([LMXJVSD])(?=$|[\s,).y])/g;
    const LET = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
    const lets = [];
    while ((mm = reLet.exec(original))) lets.push(mm);
    if (found.length >= 2 || lets.length >= 2 || (found.length === 1 && repeat === 'weekly')) {
      days = [];
      for (const f of found) { days.push(DIAS.indexOf(f[1].replace(/s$/, '')) >= 0 ? DIAS.indexOf(f[1].replace(/s$/, '')) : DIAS.indexOf(f[1])); take(f); }
      if (lets.length >= 2) for (const l of lets) { days.push(LET[l[1]]); const i = l.index + l[0].indexOf(l[1]); used[i] = true; }
      // quitar las "y" / comas que unían los días
      const re2 = /\s(y|e)\s/g; let y;
      while ((y = re2.exec(t))) { const a = used[y.index - 1], b = used[y.index + y[0].length]; if (a && b) for (let i = y.index; i < y.index + y[0].length; i++) used[i] = true; }
      days = [...new Set(days)].filter(d => d >= 0);
    }
  }
  if (days && days.length) {
    repeat = 'weekly';
    const td = today.getDay();
    const diff = Math.min(...days.map(d => (d - td + 7) % 7));
    date = addDays(today, diff);
  }

  // --- Fecha
  if (!date) {
    if ((m = find(/\bpasado\s+manana\b/g))) { date = addDays(today, 2); take(m); }
    else if ((m = find(/\b(hoy|esta\s+(tarde|noche|manana))\b/g))) {
      date = today; take(m);
    }
    else if ((m = find(/(?<!(de|por) la )\bmanana\b/g))) { date = addDays(today, 1); take(m); }
  }
  if (!date && (m = find(/\b(?:el\s+)?(\d{1,2})\s*(?:\/|-|\.)\s*(\d{1,2})(?:\s*(?:\/|-|\.)\s*(\d{2,4}))?\b/g))) {
    const d = +m[1], mo = +m[2] - 1; let y = m[3] ? +m[3] : null;
    if (y && y < 100) y += 2000;
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) { date = fixYear(today, mo, d, y); take(m); }
  }
  if (!date && (m = find(/\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?(\d{4}))?\b/g))) {
    const mo = m[2] === 'setiembre' ? 8 : MESES.indexOf(m[2]);
    date = fixYear(today, mo, +m[1], m[3] ? +m[3] : null); take(m);
  }
  if (!date && (m = find(/\b(?:el\s+|este\s+|proximo\s+|el\s+proximo\s+|el\s+que\s+viene\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(\s+que\s+viene|\s+proximo)?\b/g))) {
    const wd = DIAS.indexOf(m[1]);
    const next = /proximo|que viene/.test(m[0]);
    date = nextWeekday(today, wd, !next);
    take(m);
  }
  if (!date && (m = find(/\bdentro\s+de\s+(\d+|una|uno|dos|tres|cuatro|cinco|seis|siete)\s+(dias?|semanas?)\b/g))) {
    const n = /\d/.test(m[1]) ? +m[1] : NUM[m[1]];
    date = addDays(today, /semana/.test(m[2]) ? n * 7 : n); take(m);
  }
  if (!date && (m = find(/\b(?:el\s+)?dia\s+(\d{1,2})\b/g))) { date = nextMonthDay(today, +m[1]); take(m); }

  // --- Hora
  const ampm = (h, part) => {
    if (!part) return h;
    if (/tarde|noche/.test(part) && h < 12) return h + 12;
    if (/manana|madrugada/.test(part) && h === 12) return 0;
    return h;
  };
  if ((m = find(/\b(?:a\s+las?\s+|a\s+la\s+)?(\d{1,2})[:.h](\d{2})\s*(?:h|horas?)?(?:\s+de\s+la\s+(manana|tarde|noche|madrugada))?/g))) {
    time = pad(ampm(+m[1], m[3])) + ':' + m[2]; take(m);
  } else if ((m = find(/\b(?:a\s+las?\s+|a\s+la\s+)?(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s*(h\b|horas?\b))?(\s+y\s+(media|cuarto)|\s+menos\s+cuarto)?(?:\s+de\s+la\s+(manana|tarde|noche|madrugada)|\s+(am|pm))?/g))) {
    // Solo aceptamos números sueltos si hay pista de hora (a las / h / de la tarde)
    const hint = /a\s+las?|a\s+la/.test(m[0]) || m[2] || m[5] || m[6];
    if (hint) {
      let h = /\d/.test(m[1]) ? +m[1] : NUM[m[1]];
      let min = 0;
      if (m[4] === 'media') min = 30; else if (m[4] === 'cuarto') min = 15;
      if (m[3] && /menos/.test(m[3])) { h -= 1; min = 45; }
      if (m[6] === 'pm' && h < 12) h += 12;
      h = ampm(h, m[5]);
      // "a las 5" sin más -> tarde (nadie queda a las 5 de la mañana)
      if (!m[5] && !m[6] && !m[2] && h >= 1 && h <= 7) h += 12;
      if (h < 24) { time = pad(h) + ':' + pad(min); take(m); }
    }
  }
  if (!time && (m = find(/\b(mediodia)\b/g))) { time = '13:00'; take(m); }

  // --- Título: lo que sobra
  let title = '';
  for (let i = 0; i < original.length; i++) title += used[i] ? ' ' : original[i];
  title = title.replace(/\s+/g, ' ')
    .replace(/(^|\s)(el|la|a|las|de|del|para|por la|por|en)\s*$/i, '')
    .replace(/^\s*(el|la|a las|a)\s+/i, '')
    .replace(/\s+(el|la|a|a las|de|del|y)\s*$/i, '')
    .replace(/\s+(el|la|a|a las|de|del|y)\s*$/i, '')
    .trim();
  title = title.replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*(?=[,;])/g, '').replace(/^[,;.\s]+|[,;.\s]+$/g, '');
  if (title) title = title[0].toUpperCase() + title.slice(1);

  return { title, date: date ? ymd(date) : null, time, repeat, days: days && days.length ? days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : null };
}

export function parseShopping(text) {
  return text.split(/[,;\n]|\s+y\s+|\s+e\s+/i)
    .map(s => s.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .map(s => s[0].toUpperCase() + s.slice(1));
}

function pad(n) { return String(n).padStart(2, '0'); }

function nextWeekday(today, wd, allowToday) {
  let diff = (wd - today.getDay() + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return addDays(today, diff);
}

function nextMonthDay(today, d) {
  let dt = new Date(today.getFullYear(), today.getMonth(), d);
  if (dt < today) dt = new Date(today.getFullYear(), today.getMonth() + 1, d);
  return dt;
}

function fixYear(today, mo, d, y) {
  if (y) return new Date(y, mo, d);
  let dt = new Date(today.getFullYear(), mo, d);
  if (dt < addDays(today, -1)) dt = new Date(today.getFullYear() + 1, mo, d);
  return dt;
}
