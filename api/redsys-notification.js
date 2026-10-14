import { supaAdmin, readRawBody, sendConfirmationEmail } from "./_lib.js";
import { verifyNotification, getParam } from "./_redsys.js";

/* Aviso que manda el banco (Redsys) a nuestro servidor cuando termina
   un pago, tanto si ha salido bien como si ha sido denegado.

   Aquí, y solo aquí, se confirma el pedido y se genera el código de
   recogida. Antes de fiarnos comprobamos: 1) la firma del banco,
   2) que el comercio es el nuestro y 3) que el importe pagado es
   exactamente el del pedido. */

// Necesitamos el cuerpo sin procesar: lo leemos nosotros.
export const config = {
  api: { bodyParser: false },
};

async function readNotificationBody(req) {
  const raw = await readRawBody(req);
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  let verified;
  try {
    const body = await readNotificationBody(req);
    verified = verifyNotification(body);
  } catch (err) {
    console.error("Notificación de Redsys no válida:", err.message);
    return res.status(400).send("Notificación no válida");
  }

  try {
    const { params, order: orderId, cfg } = verified;
    const response = Number(getParam(params, "Ds_Response"));
    const amountCents = Number(getParam(params, "Ds_Amount"));
    const merchantCode = String(getParam(params, "Ds_MerchantCode") || "");

    const rows = await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
    const order = rows?.[0];
    if (!order) {
      console.error(`Redsys: pedido ${orderId} no encontrado`);
      return res.status(200).send("OK");
    }

    // Respuestas 0000–0099 = pago autorizado.
    const approved = Number.isInteger(response) && response >= 0 && response <= 99;

    if (approved) {
      const expectedCents = Math.round(Number(order.total) * 100);
      if (merchantCode !== cfg.merchantCode || amountCents !== expectedCents) {
        console.error(
          `Redsys: datos que no cuadran en el pedido ${orderId} (comercio ${merchantCode}, importe ${amountCents} vs ${expectedCents})`
        );
        return res.status(200).send("OK");
      }
      if (!order.code) {
        const existing = await supaAdmin(`pedidos?date=eq.${order.date}&code=not.is.null&select=order_id`);
        const nextNum = (existing?.length || 0) + 1;
        const code = `IC-${String(nextNum).padStart(3, "0")}`;
        await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { code, status: "pendiente" },
        });
        await sendConfirmationEmail({ ...order, code });
      }
    } else if (!order.code) {
      // Pago denegado: el pedido no se prepara.
      await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: "cancelado" },
      });
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    // Respondemos 200 igualmente: el error ya queda en los registros
    // y así el banco no marca la notificación como fallida.
    return res.status(200).send("OK");
  }
}
