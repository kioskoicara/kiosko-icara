/* ---------------------------------------------------------
   Utilidades compartidas por las funciones de servidor (/api).
   Estas funciones corren en Vercel, nunca en el navegador, así
   que aquí sí se puede usar la "service role key" de Supabase
   (tiene permiso total y salta las reglas de RLS) y la clave
   secreta de Stripe.
--------------------------------------------------------- */

const SUPABASE_URL = "https://dwrxriowwrlyemnzjsxb.supabase.co";

export async function supaAdmin(path, { method = "GET", body, prefer } = {}) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const configFromRow = (row) => ({
  baseTostada: Number(row.base_tostada),
  breadTypes: row.bread_types,
  extras: row.extras,
  menu: row.menu,
});

export async function getMenuConfig() {
  const rows = await supaAdmin("menu_config?id=eq.1&select=*");
  if (!rows?.[0]) throw new Error("No se ha podido leer el menú");
  return configFromRow(rows[0]);
}

/* Recalcula el precio de una línea del pedido a partir de los
   precios guardados en la base de datos — nunca del precio que
   manda el navegador. Así nadie puede manipular el total pagado. */
export function priceForLine(id, config) {
  if (id.startsWith("pan-")) {
    const rest = id.slice(4);
    const dashIdx = rest.indexOf("-");
    const breadId = dashIdx === -1 ? rest : rest.slice(0, dashIdx);
    const extrasPart = dashIdx === -1 ? "" : rest.slice(dashIdx + 1);
    const extraIds = extrasPart ? extrasPart.split(".") : [];
    const bread = config.breadTypes.find((b) => b.id === breadId);
    if (!bread) return null;
    const extrasTotal = extraIds.reduce((sum, exId) => {
      const ex = config.extras.find((e) => e.id === exId);
      return ex ? sum + ex.price : sum;
    }, 0);
    return Number((config.baseTostada + bread.extra + extrasTotal).toFixed(2));
  }
  const item = config.menu.find((m) => m.id === id);
  return item ? item.price : null;
}

function esLongDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function eur(n) {
  return `${Number(n).toFixed(2).replace(".", ",")} €`;
}

/* Envía el correo de confirmación con el código de recogida y el QR,
   usando Resend. Si falta la clave o el envío falla, no rompe el
   webhook: el pedido ya está confirmado igualmente, solo se registra
   el aviso en los logs para poder revisarlo. */
export async function sendConfirmationEmail(order) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Falta la variable de entorno RESEND_API_KEY: no se envía el correo");
    return;
  }

  const fromAddress = process.env.RESEND_FROM || "Kiosko Ícara <onboarding@resend.dev>";
  const qrData = encodeURIComponent(`ICARA|${order.date}|${order.code}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${qrData}`;

  const itemsHtml = order.items
    .map((i) => `<li>${i.qty} × ${i.name}</li>`)
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #2b2b2b;">
      <h2 style="color: #d9704c;">¡Pedido confirmado!</h2>
      <p>Hola ${order.name}, tu desayuno de mañana ya está reservado y pagado.</p>
      <div style="text-align: center; margin: 24px 0;">
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 2px;">${order.code}</div>
        <img src="${qrUrl}" alt="Código QR" width="200" height="200" style="margin-top: 12px;" />
      </div>
      <p><strong>Recogida:</strong> ${esLongDate(order.date)}, en el recreo</p>
      <ul style="padding-left: 18px;">${itemsHtml}</ul>
      <p><strong>Total pagado:</strong> ${eur(order.total)}</p>
      <p style="margin-top: 24px; color: #666; font-size: 14px;">
        Enseña este código o el QR en la food truck de Ícara para recoger tu desayuno — no hace falta nada más.
      </p>
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
      to: [order.email],
      subject: `Tu código de recogida: ${order.code}`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Resend ${res.status}: ${text}`);
  }
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
