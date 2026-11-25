/* Dice a la web si el kiosko está "fuera de servicio" (pausado).

   Se controla desde Vercel con variables de entorno, sin tocar código:
   - APP_PAUSED = 1        → la web muestra el aviso de fuera de servicio
                             y no deja crear pedidos nuevos.
   - APP_PAUSED_MESSAGE    → (opcional) texto del aviso.

   Para volver a abrir: borrar APP_PAUSED (o ponerla a 0) y hacer
   Redeploy. Los pagos que ya están en marcha en el banco siguen
   confirmándose con normalidad. */
import { isAppPaused } from "./_lib.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const paused = isAppPaused();
  res.status(200).json({
    paused,
    message: paused
      ? (process.env.APP_PAUSED_MESSAGE || "Esta app está momentáneamente fuera de servicio. Vuelve a intentarlo más tarde.")
      : "",
  });
}
