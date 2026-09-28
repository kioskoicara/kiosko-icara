import { supaAdmin, readJsonBody } from "./_lib.js";

// Las políticas de seguridad de Supabase (RLS) no dejan que el
// navegador del alumno cambie el estado de un pedido directamente
// (solo el equipo autenticado podría hacerlo). Esta función hace ese
// cambio en el servidor, donde sí es seguro, tanto para una
// cancelación real como para limpiar un pago abandonado.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body && Object.keys(req.body).length ? req.body : await readJsonBody(req);
    const { orderId } = body;
    if (!orderId) return res.status(400).json({ error: "Falta el identificador del pedido" });

    const rows = await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}&select=status`);
    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    if (order.status === "entregado") {
      return res.status(409).json({ error: "Este pedido ya se ha entregado y no se puede cancelar" });
    }

    await supaAdmin(`pedidos?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "cancelado" },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se ha podido cancelar el pedido" });
  }
}
