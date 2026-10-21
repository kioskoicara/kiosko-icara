/* ---------------------------------------------------------
   Dibujo del PDF "Lista de preparación". Lo usan los dos sitios
   que lo generan, para que salga siempre igual:
   - el botón "Descargar PDF" del panel (src/App.jsx, navegador)
   - el envío automático de cada noche (api/send-daily-prep-pdf.js)

   Recibe un documento jsPDF ya creado, así que este archivo no
   importa nada y vale para navegador y servidor.

   Parte 1: cantidad total de cada producto (qué preparar).
   Parte 2: detalle por pedido (qué lleva cada código IC-NNN).
--------------------------------------------------------- */

const eurTxt = (n) => `${Number(n).toFixed(2).replace(".", ",")} €`;

/* orders: [{ code, name, status, total, items: [{name, qty}] }]
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

  // Parte 1 — totales por producto
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text("1. Cantidad total por producto", marginX, y);
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
    doc.text("2. Detalle por pedido", marginX, y);
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
