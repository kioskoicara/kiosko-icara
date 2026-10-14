import crypto from "node:crypto";

/* ---------------------------------------------------------
   Utilidades de Redsys (TPV virtual de CaixaBank / Cyberpac).

   Cómo funciona el pago por redirección:
   1. Nuestro servidor prepara los datos del pago, los codifica en
      Base64 y los FIRMA con la clave secreta del terminal.
   2. El navegador del alumno envía esos datos a la página de pago
      del banco, donde paga con tarjeta o con Bizum.
   3. El banco avisa a nuestro servidor (notificación) del resultado,
      con otra firma que comprobamos antes de fiarnos.

   La clave secreta SOLO vive en las variables de entorno de Vercel.

   Variables de entorno:
   - REDSYS_MERCHANT_CODE  → número de comercio (FUC)
   - REDSYS_TERMINAL       → número de terminal
   - REDSYS_SECRET_KEY     → clave de firma SHA-256 (Base64)
   - REDSYS_ENV            → "test" (pruebas) o "prod" (real)
--------------------------------------------------------- */

const URL_TEST = "https://sis-t.redsys.es:25443/sis/realizarPago";
const URL_PROD = "https://sis.redsys.es/sis/realizarPago";

export function redsysConfig() {
  const merchantCode = process.env.REDSYS_MERCHANT_CODE?.trim();
  const terminal = process.env.REDSYS_TERMINAL?.trim();
  const secretKey = process.env.REDSYS_SECRET_KEY?.trim();
  if (!merchantCode || !terminal || !secretKey) {
    throw new Error("Faltan variables de entorno de Redsys (REDSYS_MERCHANT_CODE, REDSYS_TERMINAL, REDSYS_SECRET_KEY)");
  }
  const env = (process.env.REDSYS_ENV || "test").trim().toLowerCase();
  return {
    merchantCode,
    terminal,
    secretKey,
    env,
    url: env === "prod" ? URL_PROD : URL_TEST,
  };
}

/* Número de pedido válido para Redsys: entre 4 y 12 caracteres,
   los 4 primeros numéricos y solo letras/números, y nunca repetido.
   Usamos 12 cifras: segundos desde 1970 (10) + 2 aleatorias. */
export function newRedsysOrder() {
  const secs = String(Math.floor(Date.now() / 1000));
  const rnd = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return secs + rnd;
}

// Base64 "normal" ↔ Base64 "URL-safe" (Redsys devuelve la firma de la
// notificación en esta segunda variante).
function fromBase64Url(s) {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return b;
}

/* Clave de firma propia de cada pedido: se cifra el número de pedido
   con 3DES (CBC, IV de ceros, relleno de ceros) usando la clave del
   terminal, y el resultado es la clave para el HMAC-SHA256. */
function deriveOrderKey(secretKeyB64, order) {
  const key = Buffer.from(secretKeyB64, "base64");
  const cipher = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  cipher.setAutoPadding(false);
  const orderBuf = Buffer.from(String(order), "utf8");
  const padLen = (8 - (orderBuf.length % 8)) % 8;
  const padded = Buffer.concat([orderBuf, Buffer.alloc(padLen, 0)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

export function signParams(merchantParamsB64, order, secretKeyB64) {
  const orderKey = deriveOrderKey(secretKeyB64, order);
  return crypto.createHmac("sha256", orderKey).update(merchantParamsB64).digest("base64");
}

export function encodeParams(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function decodeParams(b64) {
  const json = Buffer.from(fromBase64Url(b64), "base64").toString("utf8");
  return JSON.parse(json);
}

// Los nombres de los parámetros de respuesta pueden venir en mayúsculas
// o en formato "Ds_Xxx", según el entorno.
export function getParam(params, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(params).find((k) => k.toLowerCase() === wanted);
  return key ? params[key] : undefined;
}

/* Datos que el navegador enviará por POST a la pasarela del banco.
   payMethod: "tarjeta" | "bizum". */
export function buildPaymentForm({ order, amountEur, origin, payMethod, description }) {
  const cfg = redsysConfig();

  const params = {
    DS_MERCHANT_AMOUNT: String(Math.round(amountEur * 100)),
    DS_MERCHANT_ORDER: order,
    DS_MERCHANT_MERCHANTCODE: cfg.merchantCode,
    DS_MERCHANT_CURRENCY: "978", // euros
    DS_MERCHANT_TRANSACTIONTYPE: "0", // autorización
    DS_MERCHANT_TERMINAL: cfg.terminal,
    DS_MERCHANT_MERCHANTURL: `${origin}/api/redsys-notification`,
    DS_MERCHANT_URLOK: `${origin}/?pago=exito&pedido=${order}`,
    DS_MERCHANT_URLKO: `${origin}/?pago=cancelado&pedido=${order}`,
    DS_MERCHANT_CONSUMERLANGUAGE: "001", // español
    DS_MERCHANT_MERCHANTNAME: "Kiosko Icara",
    // OJO: no usar el carácter % en ningún texto (error SIS0431).
    DS_MERCHANT_PRODUCTDESCRIPTION: String(description || "Desayuno").replace(/%/g, "").slice(0, 120),
  };
  // "z" = botón de Bizum. Para tarjeta no se manda nada y el banco
  // muestra su pantalla de pago normal.
  if (payMethod === "bizum") params.DS_MERCHANT_PAYMETHODS = "z";

  const merchantParams = encodeParams(params);
  return {
    url: cfg.url,
    fields: {
      Ds_SignatureVersion: "HMAC_SHA256_V1",
      Ds_MerchantParameters: merchantParams,
      Ds_Signature: signParams(merchantParams, order, cfg.secretKey),
    },
  };
}

/* Comprueba que la notificación viene realmente del banco (firma
   correcta) y devuelve sus datos ya decodificados. Lanza un error si
   la firma no coincide. */
export function verifyNotification({ Ds_MerchantParameters, Ds_Signature }) {
  const cfg = redsysConfig();
  if (!Ds_MerchantParameters || !Ds_Signature) throw new Error("Notificación incompleta");
  const params = decodeParams(Ds_MerchantParameters);
  const order = getParam(params, "Ds_Order");
  if (!order) throw new Error("Notificación sin número de pedido");

  const expected = Buffer.from(signParams(Ds_MerchantParameters, order, cfg.secretKey), "base64");
  const received = Buffer.from(fromBase64Url(Ds_Signature), "base64");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new Error("Firma de Redsys no válida");
  }
  return { params, order: String(order), cfg };
}
