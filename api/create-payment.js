import { supaAdmin, getMenuConfig, priceForLine, readJsonBody, serverPickupDateKey } from "./_lib.js";
import { buildPaymentForm, newRedsysOrder } from "./_redsys.js";

/* Crea el pedido como "pendiente de pago" y devuelve los datos firmados
   para enviar al alumno a la pasarela de pago de Redsys (CaixaBank).
   El código de recogida NO se asigna aquí: solo lo asigna la
   notificación del banco cuando confirma que el pago ha salido bien. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body && Object.keys(req.body).length ? req.body : await readJsonBody(req);
    const { items, name, email, date, privacyAccepted, payMethod } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El pedido está vacío" });
    }
    if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() || "")) {
      return res.status(400).json({ error: "Nombre o correo no válidos" });
    }
    if (privacyAccepted !== true) {
      return res.status(400).json({ error: "Hay que aceptar la política de privacidad" });
    }
    if (!date) {
      return res.status(400).json({ error: "Falta la fecha de recogida" });
    }
    const method = payMethod === "bizum" ? "bizum" : "tarjeta";

    // Nunca nos fiamos de la fecha de recogida que calcula el navegador
    // del alumno (podría tener el reloj cambiado): se calcula con la
    // hora real del servidor. La recogida es el SIGUIENTE DÍA CON COLE
    // (vie/sáb/dom → lunes; festivos saltados).
    const validDate = serverPickupDateKey();
    if (date !== validDate) {
      return res.status(409).json({
        error: "Ya no se puede pedir para esa fecha (ha pasado la hora límite). Recarga la página para pedir para el día correcto.",
        code: "FECHA_CADUCADA",
      });
    }

    // Recalculamos cada línea con los precios reales guardados en
    // Supabase — nunca nos fiamos del precio que manda el navegador.
    const config = await getMenuConfig();
    const orderItems = [];
    let total = 0;

    for (const raw of items) {
      const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
      const price = priceForLine(String(raw.id), config);
      if (price == null) {
        return res.status(400).json({ error: `Producto no reconocido: ${raw.id}` });
      }
      total += price * qty;
      orderItems.push({ id: raw.id, name: raw.name, price, qty });
    }
    total = Number(total.toFixed(2));
    if (!(total > 0)) {
      return res.status(400).json({ error: "El importe del pedido no es válido" });
    }

    // El número de pedido que ve el banco es también nuestro order_id.
    const orderId = newRedsysOrder();

    await supaAdmin("pedidos", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        order_id: orderId,
        code: null,
        date,
        name: name.trim(),
        email: email.trim(),
        items: orderItems,
        total,
        pay_method: method,
        status: "pendiente_pago",
      },
    });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const form = buildPaymentForm({
      order: orderId,
      amountEur: total,
      origin,
      payMethod: method,
      description: "Desayuno Kiosko Icara",
    });

    return res.status(200).json({ url: form.url, fields: form.fields, orderId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se ha podido iniciar el pago" });
  }
}
