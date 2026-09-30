import { jsPDF } from "jspdf";
import { supaAdmin, madridDateKey, esLongDate, eur } from "./_lib.js";

/* ---------------------------------------------------------
   Cada noche (ver vercel.json → "crons"), esta función:
   1. calcula la fecha de recogida de mañana,
   2. lee de Supabase los pedidos de esa fecha,
   3. genera el mismo PDF de "Lista de preparación" que el
      botón "Descargar PDF" de Equipo Ícara,
   4. lo manda por correo (con Resend) a TEAM_EMAIL.

   Se ejecuta sola, sin que nadie tenga que entrar al panel.
--------------------------------------------------------- */

// Mismo dibujo que downloadPrepPdf() en src/App.jsx — si se cambia
// uno, hay que cambiar el otro para que el PDF automático y el
// manual salgan iguales.
function buildPrepPdf({ dateKey, orders }) {
  const totals = {};
  let revenue = 0;
  orders.forEach((o) => {
    revenue += o.total;
    (o.items || []).forEach((i) => {
      if (!totals[i.name]) totals[i.name] = { qty: 0 };
      totals[i.name].qty += i.qty;
    });
  });
  const totalItemsCount = Object.values(totals).reduce((s, i) => s + i.qty, 0);

  const doc = new jsPDF();
  const marginX = 18;
  let y = 22;

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
  doc.text(`Recogida: ${esLongDate(dateKey)}`, marginX, y);
  y += 5.5;
  doc.text(`${orders.length} pedidos · ${totalItemsCount} artículos · ${eur(revenue)}`, marginX, y);
  y += 4;

  doc.setDrawColor(216, 201, 175);
  doc.line(marginX, y, 192, y);
  y += 10;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text("Cantidad total por producto", marginX, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const sorted = Object.entries(totals).sort((a, b) => b[1].qty - a[1].qty);
  if (sorted.length === 0) {
    doc.setTextColor(110, 110, 110);
    doc.text("No hay pedidos para este día.", marginX, y);
    y += 8;
  }
  sorted.forEach(([name, info]) => {
    if (y > 275) { doc.addPage(); y = 22; }
    doc.setFont("helvetica", "bold");
    doc.text(String(info.qty), marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(`×  ${name}`, marginX + 12, y);
    y += 8;
  });

  y += 4;
  if (y > 270) { doc.addPage(); y = 22; }
  doc.setDrawColor(216, 201, 175);
  doc.line(marginX, y, 192, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Total: ${totalItemsCount} artículos`, marginX, y);

  return { buffer: Buffer.from(doc.output("arraybuffer")), orders: orders.length, totalItemsCount, revenue };
}

async function sendPrepPdfEmail({ dateKey, pdfBuffer, orderCount, totalItemsCount, revenue }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta la variable de entorno RESEND_API_KEY");

  const teamEmail = process.env.TEAM_EMAIL;
  if (!teamEmail) throw new Error("Falta la variable de entorno TEAM_EMAIL");

  const fromAddress = process.env.RESEND_FROM || "Kiosko Ícara <onboarding@resend.dev>";
  const to = teamEmail.split(",").map((s) => s.trim()).filter(Boolean);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #2b2b2b;">
      <h2 style="color: #d9704c;">Lista de preparación de mañana</h2>
      <p>Recogida: <strong>${esLongDate(dateKey)}</strong></p>
      <p>${orderCount} pedidos · ${totalItemsCount} artículos · ${eur(revenue)}</p>
      <p style="color: #666; font-size: 14px;">Adjunto va el PDF con el desglose por producto, igual que el que se descarga desde "Equipo Ícara".</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to,
      subject: `Lista de preparación Ícara — ${dateKey}`,
      html,
      attachments: [
        {
          filename: `preparacion-icara-${dateKey}.pdf`,
          content: pdfBuffer.toString("base64"),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text}`);
  }
}

export default async function handler(req, res) {
  // Solo la tarea programada (o alguien con el secreto) puede
  // disparar esto — si no, cualquiera podría hacer que se mandaran
  // correos a voluntad.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "No autorizado" });
    }
  }

  try {
    // A las 00:30 ya ha pasado la medianoche: el "mañana" de ayer es
    // ya el día de hoy, así que se usa la fecha de hoy (hora de
    // Madrid), no "mañana".
    const dateKey = madridDateKey(new Date());

    const rows = await supaAdmin(`pedidos?date=eq.${dateKey}&select=*&order=created_at.asc`);
    const orders = (rows || [])
      .filter((r) => r.status !== "cancelado")
      .map((r) => ({ items: r.items || [], total: Number(r.total) || 0 }));

    const { buffer, orders: orderCount, totalItemsCount, revenue } = buildPrepPdf({ dateKey, orders });
    await sendPrepPdfEmail({ dateKey, pdfBuffer: buffer, orderCount, totalItemsCount, revenue });

    return res.status(200).json({ ok: true, date: dateKey, orders: orderCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se ha podido enviar el PDF de preparación" });
  }
}
