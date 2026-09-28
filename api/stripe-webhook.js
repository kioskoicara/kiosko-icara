import Stripe from "stripe";
import { supaAdmin, readRawBody, sendConfirmationEmail } from "./_lib.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Necesitamos el cuerpo de la petición SIN procesar para poder
// comprobar la firma de Stripe — por eso desactivamos el parseo
// automático de Vercel para esta función.
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Firma de webhook inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        const rows = await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
        const order = rows?.[0];
        if (order && !order.code) {
          // Solo aquí, con el pago ya confirmado por Stripe, se genera
          // el código de recogida real — es la única fuente de verdad.
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
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { status: "cancelado" },
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(err);
    // Devolvemos 200 igualmente: si Stripe recibe un error, reintenta
    // el mismo evento más tarde, y el problema ya ha quedado registrado.
    return res.status(200).json({ received: true, warning: "processing_error" });
  }
}
