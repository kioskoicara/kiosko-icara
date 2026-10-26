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
  // Curso 2026-2027 (Ronda, Málaga). Provisional: confirmar con el centro.
  "2026-10-12", // Fiesta Nacional de España
  "2026-11-02", // Todos los Santos (trasladado)
  "2026-12-07", // Constitución (trasladada)
  "2026-12-08", // Inmaculada Concepción
  "2027-01-25", // Virgen de la Paz, patrona de Ronda
  "2027-03-01", // Día de Andalucía (trasladado)
  "2027-05-03", // día no lectivo por fiesta local (a confirmar con el centro)
];

// Vacaciones: rangos de fechas, ambos extremos incluidos.
export const NON_SCHOOL_RANGES = [
  ["2026-12-23", "2027-01-06"], // Navidad
  ["2027-02-22", "2027-02-26"], // Semana Blanca (incluye Día de la Comunidad Educativa, 26/2)
  ["2027-03-22", "2027-03-28"], // Semana Santa
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
  if (NON_SCHOOL_RANGES.some(([from, to]) => key >= from && key <= to)) return false;
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

/* ---------------------------------------------------------
   Dibujo del PDF "Lista de preparación". Lo usan los dos sitios
   que lo generan, para que salga siempre igual:
   - el botón "Descargar PDF" del panel (src/App.jsx, navegador)
   - el envío automático de cada noche (api/send-daily-prep-pdf.js)

   Recibe un documento jsPDF ya creado, así que este archivo no
   importa nada y vale para navegador y servidor.

   Parte 1: panes por tamaño (para la panadería).
   Parte 2: cantidad total de cada producto (qué preparar).
   Parte 3: detalle por pedido (qué lleva cada código IC-NNN).
--------------------------------------------------------- */

const eurTxt = (n) => `${Number(n).toFixed(2).replace(".", ",")} €`;

// Panes de los bocadillos: el tamaño va dentro del id de cada línea
// ("bocbas-peq--jamon-cocido", "bocicara-grande-integral--tortilla"…).
const BREAD_ORDER = ["peq", "grande", "peq-integral", "grande-integral"];
const BREAD_LABELS = {
  peq: "Pequeños",
  grande: "Grandes",
  "peq-integral": "Pequeños integrales",
  "grande-integral": "Grandes integrales",
};
function breadSizeOf(id) {
  const m = /^boc(?:bas|icara)-(.+?)--/.exec(String(id || ""));
  return m ? m[1] : null;
}

/* orders: [{ code, name, status, total, items: [{id, name, qty}] }]
   (ya sin cancelados ni pendientes de pago). */
export function drawPrepPdf(doc, { dateLabel, orders }) {
  const marginX = 18;
  const right = 192;
  const pageEnd = 278;
  let y = 22;

  const totals = {};
  let revenue = 0;
  orders.forEach((o) => {
    revenue += Number(o.total) || 0;
    (o.items || []).forEach((i) => {
      totals[i.name] = (totals[i.name] || 0) + i.qty;
    });
  });
  const totalItemsCount = Object.values(totals).reduce((s, q) => s + q, 0);

  // Panes por tamaño (para el encargado de la panadería).
  const breads = {};
  orders.forEach((o) =>
    (o.items || []).forEach((i) => {
      const size = breadSizeOf(i.id);
      if (size) breads[size] = (breads[size] || 0) + i.qty;
    })
  );
  const breadKeys = [
    ...BREAD_ORDER,
    ...Object.keys(breads).filter((k) => !BREAD_ORDER.includes(k)),
  ];
  const totalBreads = Object.values(breads).reduce((s, q) => s + q, 0);

  const ensure = (h) => {
    if (y + h > pageEnd) { doc.addPage(); y = 22; }
  };
  const rule = () => {
    doc.setDrawColor(216, 201, 175);
    doc.line(marginX, y, right, y);
  };

  // Cabecera
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Panadería Ícara", marginX, y);
  y += 7;
  doc.setFontSize(12);
  doc.text("Lista de preparación", marginX, y);
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(110, 110, 110);
  doc.text(`Recogida: ${dateLabel}`, marginX, y);
  y += 5.5;
  doc.text(`${orders.length} pedidos · ${totalItemsCount} artículos · ${eurTxt(revenue)}`, marginX, y);
  y += 4;
  rule();
  y += 10;

  // Parte 1 — panes por tamaño
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text("1. Panes para la panadería", marginX, y);
  y += 9;
  doc.setFontSize(12);
  breadKeys.forEach((k) => {
    ensure(8);
    doc.setFont("helvetica", "bold");
    doc.text(String(breads[k] || 0), marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(`×  ${BREAD_LABELS[k] || k}`, marginX + 12, y);
    y += 8;
  });
  ensure(16);
  y += 1;
  rule();
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${totalBreads} panes`, marginX, y);
  y += 12;

  // Parte 2 — totales por producto
  ensure(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text("2. Cantidad total por producto", marginX, y);
  y += 9;
  doc.setFontSize(12);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sorted.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text("No hay pedidos para este día.", marginX, y);
    y += 8;
  }
  sorted.forEach(([name, qty]) => {
    ensure(8);
    doc.setFont("helvetica", "bold");
    doc.text(String(qty), marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(`×  ${name}`, marginX + 12, y);
    y += 8;
  });
  y += 2;
  ensure(16);
  rule();
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${totalItemsCount} artículos`, marginX, y);
  y += 12;

  // Parte 2 — detalle por pedido
  if (orders.length > 0) {
    ensure(20);
    doc.setFontSize(12.5);
    doc.text("3. Detalle por pedido", marginX, y);
    y += 9;

    const sortedOrders = [...orders].sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
    sortedOrders.forEach((o) => {
      const lines = (o.items || []).map((i) => ({
        qty: i.qty,
        text: doc.splitTextToSize(`×  ${i.name}`, right - marginX - 22),
      }));
      const bodyH = lines.reduce((s, l) => s + l.text.length * 6, 0);
      ensure(10 + bodyH + 6); // el pedido entero en la misma página

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
      const delivered = o.status === "entregado" ? "  (ya entregado)" : "";
      doc.text(`${o.code || "—"}  ·  ${o.name || ""}${delivered}`, marginX, y);
      y += 6.5;

      doc.setFontSize(11);
      lines.forEach((l) => {
        doc.setFont("helvetica", "bold");
        doc.text(String(l.qty), marginX + 6, y);
        doc.setFont("helvetica", "normal");
        doc.text(l.text, marginX + 18, y);
        y += l.text.length * 6;
      });
      y += 2;
      doc.setDrawColor(230, 222, 207);
      doc.line(marginX, y, right, y);
      y += 6;
    });
  }
  return doc;
}
