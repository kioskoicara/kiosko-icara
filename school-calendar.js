/* ---------------------------------------------------------
   Calendario escolar y fecha de recogida.

   Regla: un pedido se recoge el SIGUIENTE día lectivo.
   - Lunes a jueves  → mañana.
   - Viernes, sábado y domingo → el lunes.
   - Si ese día es festivo o no hay cole → el siguiente día lectivo.

   Este archivo lo usan la app (navegador) y las funciones del
   servidor (/api), así que no depende de nada externo.

   ▶ AÑADE AQUÍ los días sin cole (festivos, puentes, vacaciones),
     en formato "AAAA-MM-DD", para que los pedidos salten esos días.
--------------------------------------------------------- */

export const NON_SCHOOL_DATES = [
  "2026-10-12", // Fiesta Nacional de España
  "2026-12-08", // Inmaculada Concepción
  "2027-01-01", // Año Nuevo
  "2027-01-06", // Reyes
  "2027-03-26", // Viernes Santo
];

export const TIMEZONE = "Europe/Madrid";

const fmtParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsInMadrid(date) {
  const o = {};
  fmtParts.formatToParts(date).forEach((p) => {
    if (p.type !== "literal") o[p.type] = Number(p.value);
  });
  return o;
}

/** "AAAA-MM-DD" de un instante, según la hora de Madrid. */
export function madridDateKey(date = new Date()) {
  const p = partsInMadrid(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Suma días a una clave "AAAA-MM-DD" (aritmética de calendario, sin husos). */
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Día de la semana de una clave: 0 = domingo … 6 = sábado. */
export function weekday(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ¿Hay cole ese día? (lunes–viernes y no está en la lista de no lectivos) */
export function isSchoolDay(key) {
  const wd = weekday(key);
  if (wd === 0 || wd === 6) return false;
  return !NON_SCHOOL_DATES.includes(key);
}

/** Siguiente día lectivo estrictamente posterior a `fromKey`. */
export function nextSchoolDayKey(fromKey) {
  let k = addDays(fromKey, 1);
  for (let i = 0; i < 400 && !isSchoolDay(k); i++) k = addDays(k, 1);
  return k;
}

/** Fecha de recogida válida ahora mismo (clave "AAAA-MM-DD"). */
export function pickupDateKey(now = new Date()) {
  return nextSchoolDayKey(madridDateKey(now));
}

/**
 * Milisegundos que faltan hasta que se cierran los pedidos para
 * `pickupKey`: las 00:00 (hora de Madrid) del propio día de recogida.
 */
export function msUntilCutoff(pickupKey, now = new Date()) {
  const p = partsInMadrid(now);
  const todayKey = madridDateKey(now);
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = pickupKey.split("-").map(Number);
  const dayDiff = Math.round((Date.UTC(ky, km - 1, kd) - Date.UTC(ty, tm - 1, td)) / 86400000);
  const secsToMidnight = 24 * 3600 - (p.hour * 3600 + p.minute * 60 + p.second);
  return Math.max(0, ((dayDiff - 1) * 86400 + secsToMidnight) * 1000);
}
