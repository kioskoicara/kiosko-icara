import Stripe from "stripe";
import { supaAdmin, getMenuConfig, priceForLine, readJsonBody } from "./_lib.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body && Object.keys(req.body).length ? req.body : await readJsonBody(req);
    const { items, name, email, date } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El pedido está vacío" });
    }
    if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() || "")) {
      return res.status(400).json({ error: "Nombre o correo no válidos" });
    }
    if (!date) {
      return res.status(400).json({ error: "Falta la fecha de recogida" });
    }

    // Recalculamos cada línea con los precios reales guardados en
    // Supabase — nunca nos fiamos del precio que manda el navegador.
    const config = await getMenuConfig();
    const lineItems = [];
    const orderItems = [];
    let total = 0;

    for (const raw of items) {
      const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
      const price = priceForLine(raw.id, config);
      if (price == null) {
        return res.status(400).json({ error: `Producto no reconocido: ${raw.id}` });
      }
      total += price * qty;
      orderItems.push({ id: raw.id, name: raw.name, price, qty });
      lineItems.push({
        quantity: qty,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(price * 100),
          product_data: { name: raw.name || raw.id },
        },
      });
    }
    total = Number(total.toFixed(2));

    const orderId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Guardamos el pedido como "pendiente de pago" ANTES de crear la
    // sesión de Stripe. Todavía no tiene código de recogida — ese se
    // asigna solo cuando el webhook confirme que el pago se completó.
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
        pay_method: "tarjeta",
        status: "pendiente_pago",
      },
    });

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: email.trim(),
      metadata: { orderId },
      success_url: `${origin}/?pago=exito&pedido=${orderId}`,
      cancel_url: `${origin}/?pago=cancelado&pedido=${orderId}`,
    });

    return res.status(200).json({ url: session.url, orderId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se ha podido iniciar el pago" });
  }
}
