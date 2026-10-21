import { jsPDF } from "jspdf";
import { supaAdmin, madridDateKey, esLongDate, eur } from "./_lib.js";
import { isSchoolDay, drawPrepPdf } from "../shared/school-calendar.js";

/* ---------------------------------------------------------
   Cada noche (ver vercel.json → "crons"), esta función:
   1. calcula la fecha de recogida de hoy (a las 00:15 de Madrid),
   2. lee de Supabase los pedidos de esa fecha,
   3. genera el mismo PDF de "Lista de preparación" que el
      botón "Descargar PDF" de Equipo Ícara,
   4. lo manda por correo (con Resend) a TEAM_EMAIL.

   Se ejecuta sola, sin que nadie tenga que entrar al panel.
--------------------------------------------------------- */

// El dibujo del PDF vive en shared/prep-pdf.js y es el mismo que usa
// el botón "Descargar PDF" del panel.
function buildPrepPdf({ dateKey, orders }) {
  const doc = new jsPDF();
  drawPrepPdf(doc, { dateLabel: esLongDate(dateKey), orders });
  const totalItemsCount = orders.reduce((s, o) => s + o.items.reduce((t, i) => t + i.qty, 0), 0);
  const revenue = orders.reduce((s, o) => s + o.total, 0);
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
      <h2 style="color: #d9704c;">Lista de preparación de hoy</h2>
      <p>Recogida: <strong>${esLongDate(dateKey)}</strong></p>
      <p>${orderCount} pedidos · ${totalItemsCount} artículos · ${eur(revenue)}</p>
      <p style="color: #666; font-size: 14px;">Adjunto va el PDF con el total por producto y el detalle de cada pedido, igual que el que se descarga desde "Equipo Ícara".</p>
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
    // Tras la medianoche, los pedidos que se hicieron el día anterior
    // (o el fin de semana, si hoy es lunes) ya son "de hoy": se usa
    // la fecha de hoy en hora de Madrid.
    const dateKey = madridDateKey(new Date());

    const rows = await supaAdmin(`pedidos?date=eq.${dateKey}&select=*&order=created_at.asc`);
    const orders = (rows || [])
      // Solo pedidos pagados: ni cancelados ni pendientes de pago.
      .filter((r) => r.status === "pendiente" || r.status === "entregado")
      .map((r) => ({
        code: r.code,
        name: r.name,
        status: r.status,
        items: r.items || [],
        total: Number(r.total) || 0,
      }));

    // Sábado, domingo o festivo: no hay cole y no se prepara nada,
    // así que no se manda correo (salvo que hubiera algún pedido).
    if (!isSchoolDay(dateKey) && orders.length === 0) {
      return res.status(200).json({ ok: true, skipped: "no lectivo", date: dateKey });
    }

    const { buffer, orders: orderCount, totalItemsCount, revenue } = buildPrepPdf({ dateKey, orders });
    await sendPrepPdfEmail({ dateKey, pdfBuffer: buffer, orderCount, totalItemsCount, revenue });

    return res.status(200).json({ ok: true, date: dateKey, orders: orderCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se ha podido enviar el PDF de preparación" });
  }
}
