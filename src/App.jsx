import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Wheat, Croissant, Coffee, ShoppingBag, Clock, Check, ArrowLeft,
  Plus, Minus, Search, Loader2, CreditCard, Smartphone, Mail,
  Sandwich, Cookie, CupSoda, Milk, Droplet, Camera, Keyboard, FileDown,
  Sprout, Leaf, XCircle, AlertTriangle,
  Ham, Beef, Slice, Soup, Drumstick, Package, Egg, UtensilsCrossed,
} from "lucide-react";
/* ---------------------------------------------------------
   CONEXIÓN A SUPABASE — base de datos real del kiosko.
   La "publishable key" está pensada para vivir en el navegador,
   no es un secreto (a diferencia de la "service role key").
   Se habla con Supabase por su API REST (PostgREST) usando fetch,
   en vez del paquete @supabase/supabase-js, que este entorno de
   artefactos no puede importar.
--------------------------------------------------------- */
const SUPABASE_URL = "https://dwrxriowwrlyemnzjsxb.supabase.co";
const SUPABASE_KEY = "sb_publishable_tCdZHbfVVsQ5tzGPfR4rrQ_OuSyZPjv";

async function supaRequest(path, { method = "GET", body, prefer, token } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    // Para lecturas y acciones públicas usamos la clave publicable.
    // Para acciones del equipo (marcar entregado, editar el menú) se
    // pasa el "token" real de la persona que ha iniciado sesión, y
    // Supabase solo lo deja pasar si las reglas de seguridad (RLS)
    // lo permiten para gente autenticada.
    Authorization: `Bearer ${token || SUPABASE_KEY}`,
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

/* Inicio de sesión real del equipo Ícara contra Supabase Auth.
   Las cuentas del equipo se crean a mano desde el panel de Supabase
   (Authentication → Users) — esta app nunca deja crear cuentas. */
async function supaTeamLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error_description || data.msg || "Email o contraseña incorrectos"
    );
  }
  const accessToken = data.access_token;
  const userId = data.user?.id;

  // Cada cuenta del equipo tiene una fila en "perfiles" con su rol
  // ("admin" o "equipo"). Si por lo que sea no existe esa fila,
  // tratamos la cuenta como "equipo" (el nivel con menos permisos)
  // en vez de darle acceso completo por error.
  let role = "equipo";
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}&select=rol`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` } }
    ).then((r) => (r.ok ? r.json() : []));
    if (rows?.[0]?.rol) role = rows[0].rol;
  } catch {
    // si falla la consulta, se queda como "equipo"
  }

  return { accessToken, email: data.user?.email || email, role };
}

const TEAM_SESSION_KEY = "icara_team_session";

/* Conversión entre las columnas de la tabla (snake_case) y los
   objetos que usa el resto de la app (camelCase). */
const configFromRow = (row) => ({
  baseTostada: Number(row.base_tostada),
  breadTypes: row.bread_types,
  extras: row.extras,
  menu: row.menu,
  // Estos cuatro son nuevos: si la tabla de Supabase todavía no tiene
  // estas columnas (porque no se ha ejecutado el SQL que las añade),
  // se usan los valores de fábrica en vez de romper la app.
  bocbasSizes: row.bocbas_sizes || DEFAULT_CONFIG.bocbasSizes,
  bocbasIngredients: row.bocbas_ingredients || DEFAULT_CONFIG.bocbasIngredients,
  icaraSizes: row.icara_sizes || DEFAULT_CONFIG.icaraSizes,
  icaraRellenos: row.icara_rellenos || DEFAULT_CONFIG.icaraRellenos,
  salsas: row.salsas || DEFAULT_CONFIG.salsas,
});
const configToRow = (config) => ({
  base_tostada: config.baseTostada,
  bread_types: config.breadTypes,
  extras: config.extras,
  menu: config.menu,
  bocbas_sizes: config.bocbasSizes,
  bocbas_ingredients: config.bocbasIngredients,
  icara_sizes: config.icaraSizes,
  icara_rellenos: config.icaraRellenos,
  salsas: config.salsas,
});
const orderFromRow = (row) => ({
  orderId: row.order_id,
  code: row.code,
  date: row.date,
  name: row.name,
  email: row.email,
  items: row.items,
  total: Number(row.total),
  payMethod: row.pay_method,
  status: row.status,
  createdAt: new Date(row.created_at).getTime(),
});
const orderToRow = (order) => ({
  order_id: order.orderId,
  code: order.code,
  date: order.date,
  name: order.name,
  email: order.email,
  items: order.items,
  total: order.total,
  pay_method: order.payMethod,
  status: order.status,
});

/* ---------------------------------------------------------
   CONFIGURACIÓN DEL MENÚ — valores de fábrica, usados solo si
   la tabla "menu_config" de Supabase no responde. El equipo edita
   el menú real desde "Equipo Ícara → Editar menú", que guarda los
   cambios en esa tabla. Los iconos se guardan como texto (clave de
   ICON_MAP) porque los componentes de React no se pueden guardar tal cual.
--------------------------------------------------------- */
const ICON_MAP = {
  wheat: Wheat, croissant: Croissant, cookie: Cookie, sandwich: Sandwich, cupsoda: CupSoda,
  milk: Milk, coffee: Coffee, droplet: Droplet, sprout: Sprout, leaf: Leaf,
  // Iconos propios para que cada ingrediente se distinga del resto de
  // un vistazo, en vez de repetir siempre el mismo (ver más abajo,
  // FACTORY_BASICO_INGREDIENTS / FACTORY_ICARA_RELLENOS).
  ham: Ham, beef: Beef, slice: Slice, soup: Soup, drumstick: Drumstick,
  package: Package, egg: Egg, utensils: UtensilsCrossed,
};
const ICON_KEYS = Object.keys(ICON_MAP);
const resolveIcon = (key) => ICON_MAP[key] || Wheat;

// Valores de fábrica de los bocadillos y las salsas — se usan solo
// si la tabla de Supabase todavía no tiene sus propias columnas
// para esto. Desde "Editar menú" se puede cambiar todo: tamaños,
// precios, ingredientes/rellenos y salsas.
const FACTORY_BASICO_SIZES = [
  { id: "peq", label: "Pequeño", price: 1.40, icon: "wheat" },
  { id: "peq-integral", label: "Pequeño integral", price: 1.50, icon: "sprout" },
  { id: "grande", label: "Grande", price: 2.00, icon: "wheat" },
  { id: "grande-integral", label: "Grande integral", price: 2.10, icon: "sprout" },
];
const FACTORY_BASICO_INGREDIENTS = [
  { id: "jamon-cocido", label: "Jamón cocido", icon: "ham" },
  { id: "salchichon", label: "Salchichón", icon: "beef" },
  { id: "queso", label: "Queso", icon: "slice" },
  { id: "pate", label: "Paté", icon: "soup" },
  { id: "zurrapa-lomo", label: "Zurrapa de lomo", icon: "package" },
  { id: "mantequilla-mermelada", label: "Mantequilla y mermelada", icon: "croissant" },
  { id: "chopped", label: "Chopped", icon: "utensils" },
  { id: "pavo", label: "Pavo", icon: "drumstick" },
];
const FACTORY_ICARA_SIZES = [
  { id: "peq", label: "Pequeño", price: 1.70, icon: "wheat" },
  { id: "peq-integral", label: "Pequeño integral", price: 1.80, icon: "sprout" },
  { id: "grande", label: "Grande", price: 2.30, icon: "wheat" },
  { id: "grande-integral", label: "Grande integral", price: 2.40, icon: "sprout" },
];
const FACTORY_ICARA_RELLENOS = [
  { id: "tortilla", label: "Tortilla", icon: "egg" },
  { id: "jamon-serrano", label: "Jamón serrano", icon: "ham" },
  { id: "mixto", label: "Mixto (York y queso)", icon: "sandwich" },
];
const FACTORY_SALSAS = [
  { id: "salsa-mayonesa", name: "Mayonesa", price: 0.1 },
  { id: "salsa-ketchup", name: "Ketchup", price: 0.1 },
];

const DEFAULT_CONFIG = {
  baseTostada: 1.0,
  breadTypes: [
    { id: "trigo", name: "Pan de trigo", extra: 0, icon: "wheat" },
    { id: "chia", name: "Pan de chía", extra: 0.2, icon: "sprout" },
    { id: "centeno", name: "Pan de centeno", extra: 0.2, icon: "leaf" },
    { id: "viena", name: "Pan de Viena", extra: 0.2, icon: "sandwich" },
  ],
  extras: [
    { id: "tomate", name: "Tomate y AOVE", price: 0.5 },
    { id: "jamonqueso", name: "Jamón y queso", price: 1.0 },
    { id: "chorizo", name: "Chorizo", price: 1.0 },
    { id: "mermelada", name: "Mantequilla y mermelada", price: 0.4 },
  ],
  menu: [
    { id: "d1", cat: "dulce", name: "Croissant", price: 1.2, icon: "croissant" },
    { id: "d2", cat: "dulce", name: "Napolitana de chocolate", price: 1.3, icon: "cookie" },
    { id: "d3", cat: "dulce", name: "Palmera de chocolate", price: 1.4, icon: "cookie" },
    { id: "d4", cat: "dulce", name: "Bollo de mantequilla", price: 1.2, icon: "croissant" },
    { id: "b1", cat: "bebida", name: "Agua pequeña", price: 0.6, icon: "droplet" },
    { id: "b2", cat: "bebida", name: "Coca Cola", price: 1.2, icon: "cupsoda" },
    { id: "b3", cat: "bebida", name: "Nestea", price: 1.2, icon: "cupsoda" },
    { id: "b4", cat: "bebida", name: "Bifrutas", price: 1.0, icon: "cupsoda" },
    { id: "b5", cat: "bebida", name: "Aquarius", price: 1.2, icon: "cupsoda" },
    { id: "b6", cat: "bebida", name: "Batido", price: 1.2, icon: "milk" },
  ],
  bocbasSizes: FACTORY_BASICO_SIZES,
  bocbasIngredients: FACTORY_BASICO_INGREDIENTS,
  icaraSizes: FACTORY_ICARA_SIZES,
  icaraRellenos: FACTORY_ICARA_RELLENOS,
  salsas: FACTORY_SALSAS,
};

const CATS = {
  bebida: { label: "Bebidas", icon: Coffee },
};

/* ---------------------------------------------------------
   UTILIDADES
--------------------------------------------------------- */
const eur = (n) => n.toFixed(2).replace(".", ",") + " €";
const iconFor = (id, config) => {
  const menuItem = config?.menu?.find((m) => m.id === id);
  if (menuItem) return resolveIcon(menuItem.icon);
  if (id.startsWith("bocbas-") || id.startsWith("bocicara-")) return Sandwich;
  if (id.startsWith("salsa-")) return Droplet;
  return Wheat;
};

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dateKey(d) {
  // OJO: nunca usar d.toISOString() aquí — convierte a UTC y en
  // España eso desplaza la fecha un día hacia atrás (la medianoche
  // local ya es "el día anterior" en UTC). Construimos la clave a
  // partir de los componentes locales de la fecha en su lugar.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function longDate(d) {
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}
function msUntilMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next - now;
}
function fmtCountdown(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

/* Ticket: recorte tipo entrada, con dos muescas laterales */
function Ticket({ children, style }) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--paper)",
        borderRadius: 6,
        boxShadow: "0 10px 30px -12px rgba(43,43,46,0.25)",
        ...style,
      }}
    >
      <span style={notchStyle("left")} />
      <span style={notchStyle("right")} />
      {children}
    </div>
  );
}
function notchStyle(side) {
  return {
    position: "absolute",
    top: "50%",
    [side]: -13,
    width: 26,
    height: 26,
    background: "var(--cream)",
    borderRadius: "50%",
    transform: "translateY(-50%)",
  };
}

/* Marca — logo oficial de Centro ícara, incrustado en base64 */
const LOGO_ICARA = "data:image/png;base64,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";

const CAT_IMG_PAN = "data:image/jpeg;base64,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";
const CAT_IMG_ICARA = "data:image/jpeg;base64,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";
const CAT_IMG_BEBIDA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCACgAeADASIAAhEBAxEB/8QAHAAAAQUBAQEAAAAAAAAAAAAABQECAwQGBwAI/8QAOxAAAgEDAwMCBAQFAwMEAwAAAQIDAAQRBRIhBjFBE1EUImFxByMykRUzQlKBQ2KhFlOCJUSDknKx0f/EABoBAAIDAQEAAAAAAAAAAAAAAAMEAAECBQb/xAAyEQACAgEEAQMDAwMCBwAAAAABAgADEQQSITFBEzJRBRQiYXGRI0JSgcEVobHR4fDx/9oADAMBAAIRAxEAPwDlGqXjLOwBoaWMsgB96S5cyyFj702AEuMCsAASEkzc9MadGyAsBVjqC2jjHyUJ0jUXtQFYEVLqd+ZxzzWlznMWcjqJZZAzmiIlKr3oTaSqF70lxehOAc0bdAekTNJpbhpK0Hq7E4rIaDc5bLCj1xdgLwa5eqzvnrfpioaQJdDmf5c099NUoSRzQyyvAr96MPqC7KWBwY+6EddTPXOjAylgKlgf4JlXOBV6S/iyckZoPfSetMGB4zXVqO6vBnlNZ/T1GRNhptyZYhzV1zlaCaHxEOfFGSw20g/BnTrORmCdSTOaLdNkBBQ2/wAEGk07U4rXhmArKmSzqbWSUKvesR1nfsYHjjYZNRa51dDFGwjfn6GsfHfz6pc7nJwT296aRCeTOfbaPaJXs9KeVvVfJzzRm10tpFxFEWP0Fafp/pu4u1QyJ6cXnPmug6Zo1pZQhEjXPuRUZnY4BjtK01pkjJnGVhu9OlykbKfbFHrLW7l0CuCPc1vtc0q3uIS2xd47HFZaTQprghbSLnsT4FEq65iesbLZQYlZZRMxLHNRzjepCqT7YFajSej/AEwGvZcn+1a0cGm2VuoCQJ98UK2prD+kZ0moXTrnGTOB6z07rF+5+EspnB7ECq9h+G3U8rBvgvT/APybFfRgCLwqKP8AFLu+lEWvaMQd2pax9xnGtP8Aw315VHqGFfu1Foug9Wj7tCf/ACrp5Y+9JvPvWTQplDUuJzhelNWhPMasPoanTTb+D+Zbvj6CugeofNL6g8gGhHSKejCDVt5Ew0cW5GRxjI8is492dH1MFv0McGurvb203641rMdUdFxatEzWsvpSjlc8irroKOCTxMveGQjzJ9Mv0uYwyEEEZolHEZG+Wuf6Ta6roO63voyAD8rjlTWm03qFYmAl4p9tNjlJzV1YPFnBmmisc43Vbjto08VRttZt5gMOBmr8U8TDIcUAqR3GlZSODH7VHinqPpTGlTwRXhMPBqsgTWDHlfpTCoPinbi3akJYeKnEkjMCn+mqlxYRSDBUGrrSkd6QEHkkVnI8S8fMymo6OYyXiHHtQkKVfaRg+1budoyp3YoJd2cMk24cVCrv1M5VOYIggdpcqDig2ty+lOy58VrZXjgjIUf5rnfUV1uvZDmh31bEGTGNK+8kjqUby570B1CV+eDRi1hNw+WyafqGmhYSxFYRcQ5bJxMQ8xLEHvTlYmvXUW2dgPekXitwqmXbai1q4GKDQsRiiEDGhsI5UcTT2Eq8UbgIcCsXBO8ZFFbPUypGTWOo2GyJqhb7hxTWtSPFV7PU0YDLUVgnSQdwa2ApkJIgtomB7V4ZFGjDHJ2xUUljntUNY8SxcPMHxTshojbagVxk1VexcdhURtpFPANUEI6ltsfucCVAyVd0W3SS5CsPNUrdsDFEdKDfFKw96bfozyFfuE1TaIhiDAUN1K0W3i79hWlEjfCDv2rIa2907MApIoemsJ4JhtXQB+QEGpc7SQK8H3yDPvVrSNLluWwymilx0/JGm4A05mIgSTTXWNM1LNd5Peg3pz277STj61ctlMjDNUUD9yLqLKDlTL0FzhquT3pEGRVVLJjgjirJtSY9rGlzp1zHh9XtKYMAvqEhmbJIGaV9T245zRGPpu+v5MWduz5P6scUe0z8Mb+Rg96yoO+BRdypxE8Pcd2InTt+0sa+BitMHytE9I6KtrJQGJJHvWht9Htosflj9qSsUs2ROnU21cGc9v0kMZ2ox+wrG6na6tLIRbWs558Ka78LG3x/LX9qkisYM8Rr+1XXWVMq6wMuOp882XQ/UOoSAvbOAT3c10zpHoFNMVZr4epKPHgV0iOBEHAAqUKMdqaKluzFFKr0IH+SJQqjaB4prXGB3xReSCOQEMo5oZNpY9ZWRzs8igtWw6jCWqe5FFG10fmzs96vRRRwrtjUAUu0IAqjAFKBRUXAgLH3Ge5969TgKUCtwUZikxUm2vbakkjxXttSba9tqS5AQaYQanK00rVGSQZIpVkx5p7LxULCqlyWSOG6jMcyBgfesZ1Poh05WuYATBnJ/wBtawMQasBUuoXgmAZGGCDRKrSjQV1ItXHmcnhv3XmKbjxzRK1166jIBbIrL9XWb6Drs1qCfSY74/saHwXkshCxlmY+F5rtCut13Tz5a6tsTpsHVBGPUYUSh6lQgciuf6f09q17hjEYkPmQ1pLHoxwAZ7t/slJW/aJwWGY9Q2vbpeP1moh6iXwKmOvKRxQ+06atowMvIx+poguh22B8p/elTZQfbmdBa9T/AHYkEutp5NUp+oUQcNRGXp61c8of3qjP0pZSZwZF+xrSW6cdzFlWrI/Ej+YNm6hZ2ATnmrEN5JKAxPB8V7/pOOI/lTkn/dUi6XcQYGAwHtRTbSR+Bgq6bwc2CSyqDaySN4Fcx1BHnupH7/Ma6XqRMensmCC3GKyklkqrkikLvzYCdWo7EMHaXBtxuGKk1s4t2A9qmRxG+Pah+tXKmIjIoT8Q2nyTmYe8/mMfrVde9T3bZc1WX9VUI35l2Fc0Rt1NULXuKL2yg4xWGjlQ4liOEMORViO0yeBU1tEDii9rbg44rBjQEp21k/GM0XtYJkx3q1bwAY4ojAijuKgEhbErQPInfNX4ZsgbqmWBGHikNrjkVsAiBLqZNGEYU/4ZG8VDGhU1aRsVsGLtkdGfKjgo1GNAcGcZ96qXtv5FLokhjulB960zbkJE41abbQDOoWESyQqCKde6TDNCcKARTNJfNutE1JdSu0k/SuWrENO8yBlwYC0qBLa42kCi+oCMxHgVFHol/Pc7oo9q57mtHB0u8yKLlz27CuotoxzOC9TbiAJy++jEkjbFyc9gKm03Sb2Vx6UD4Pkiuu2XSlhbfN6Klvc80TjsreEfLGox9Kv7gjoTB0an3Gc6tOmr10G8BaK6Z0mvrA3Lbh7VrpSq8KBSWbb5s+1BNzMcQq6WtRnEuWVjBaxKsUaqAPAq4Me1NLqB3pPUXxROJrEkKDFIEpnqCnLJV8GSSiP615nESE47V5JBT8hq2P0gyM9wNqXU1rpsfq3SyBB3IUnFM0rrTQtSIS2voi+f0scGiV1axTRskiBlPcGuN/iL0jFZT/H6cpiOednGKGbGU89TYqVup3FZUkXKtkHtimngVx78POpdQiUWty8kyL2ZucV0+HVElEeSBmiLYGEEyFTiXPNOFeZeNy9qVBRIKKBTsUmcVHJMkYy7AVCQO5AJLSE1Ql1S3j7uKrtrlqO8g/egnUVDzCClz4hbdSb6AXPUlnE6gyDB+tRP1Taf0uD/AJoZ1dQ8wg01h8TSbgaTis2vVFsT+sVag161k49QfvVDWUn+6UdPYOxDJAIqGROajivIpR8jg1MrbqYDBuoIqR3KzipLTmUCllXjNPiC28RleoSByZAJiPxF6Zl17WbFo2EcaKRK/nGaIaJ0zY6TCoiiXcO7sMk0ZkkMjGVhyf0ikQbjlz/ikLdbY/4A8RmvS1od2OY5Ain5RmpkLd8ACnpH8ucYFK9vI0JK57UJVbGRClhPQ+pK2IyOPNWfRl7b+apadMbeQxy8UXGCcjzTOnAsXPmBtJUykbaYuMv8tOksiynZIQavd69TP26YgvVaZu9S8tskrvX3FUP4lIpyQRWuuFVoyGGcis9cWBhk9RlBjY8iuVqqLKmzWxx/0jtFquMMJX/iEE423CA1UvdJju4i9lIM/wBpojd6VA6BkG0n2oS8F1ZOShJFZGqupP8AU5E0aa7B+JwZi9YSexlZZkZCPcd6yuqXrMSM8V2C4az1i3NrqMYDkYD+a5V1r05d6JcbiPUtnPySAcf5p5LltGVl0L6eVbuZiV81GDzUTvzShs0YTZ7hnSLS5v5lhtImkk9lFG1tLmyl9K6ieNh4YVo/wVjiZ7yWRMvwFb2rpGqaJaalEUuIgxPZvIrJUnqaXVem2COJyqzwcUYt8DFSah0veaa7PCPVhHYjuKitra6fBWB/2oR47nSW1GGQYQicZq3G4qlFaXY7wt+1XIbS5b/TIqAymZfmXYZKsiTIqGDT7g9+KtLp03vWwYq9lfzI9wpQ4Feks54/GR9KqszKcEEVeZFCt0ZzhPw6uZhiVwPtV3T/AMLoIZhJJI7GupBFHtS8UEAgYzEMjOcTOWPS9tboFC5x70Th0u3hPCCiG4Cmsc1QRRLNjHzPRRRp2UVKWA7VBuxSF61nEzjMmMlV5pgoNIXNVrgEg/assxlgRrybwcUitJEMoOahgODg0XggDICRVIN3UtjtlKO7cfzM5pRerng1clslkBxxVF9GjLZefaPvRxVYeoJrqx3J0vB5NTrcKfNVFj0u1H5k24j61G+r6XHwKOunsMXfV0jzCaz/AFqaG4JPJoGdf07HFPTXLBgCGwaJ9vYIMayk+ZonlUISSKxXV0yTW8kZwc8CjY1G1nGBMvP1oLrugNqcR+GutrZyOaFbRYeIWvUVDmQ9M6NFZaeHZRvfmiVxbSIm+Lwc0HtrfW7JFilcSKvAOKuLqlzEhSeDOeMihhCvBmjYrczRaVqIkQJKeRRXuuVNZOBdo3DjIzV+11CWLgnIowMCRH6zrPwKkFGHHfHFYfVOqZZCdr8V0UzW13GVnRWB8EUD1PonRr8l41aBz/VGcUpbpnsbLNx8Rqi6pO15nPJNZmlzmQ/vVR792zmU/vRzVPw4uIpR8LqiMhPZl5Aojpn4dWaqGvJpJ2++BWRVUnGI0dQSMjqYS6vif6ya9FNO6DakjfZTXX7TpHSrVAEs48jsSM0Ui0u0hGFhRf8AxFb2D/GY+4PzOHGS8A/kT/8A1NejvL2M59OYfdTXdGsbbBzGp/8AEVC9hZleY05/2ihNSD2BNrqjORWPUt3auNzMB9a6H0trFzqiDEEhH9xGBVy40bTnPzwx+/KjvVyC7azhEcSIUHA2jFCrRa3znAmLmFi8LzCqosab5iOKoXM4umjEZ/Kzj70I1q6u7qB0QlGI4xVvRI3XSIVk/mJ3pqy1bVKrFURkbJEtTERg48Utr82CRyarXrYxg96ljkMcKuo81z9w9Q56Eax+MMCEPFjNNSUw/lyjgdjTYmdowy+RTGlbGJF3LXT3AAMOIpgk4Mdc28dwMjhvcVFFJPanbIu5PBFeVlP8p9v+015p2j4bj/8AVCYrneOD+k2Acbe5eguI5hlDz7GntIo7kUPWRR8+MH6eaiaYlvl2L9WNFGpwOZj0sniFAyHkmqGp3CNH6cY3sf7abHH6pAkmLD2WrirbwLnAB/5qMWtQjoSABGz3KFs5DIkyY44zUs72kh9OQDNK0clxL6gXCgfLVCWzd7tUbjJ5pZmdFwoyCfMKArHJOJQ1XSl/XDyO/FUHih1Cyk0vUk3rIMKTWmntZLRdyktH5B8UKvrRHUTR/qU7hSrI1Nm5Rj5EOrh1wZ8+dT6PPoeqzWc6kbTlD/cvihIYiu99ddHP1UNPntyI5V4kc/20ujfhZodlGr3EbXMuOS54/ausuSII3ADnuZn8HblRFcR5w27NdZjlIwGrPz6Rb6V81jaLGB/YMUT0+8DIN3IoXKP+8vcLBkQmwV1ORUEUar/SMfarPylcrScAUQ88wYOBiNxH2wP2pfTQc4FM7tT1BxwancqIcYOB2pwxge9RurYOKixKp7VWcTWARLDkdhUD28cn6lFIPUPepERictVZzJyvRlPdSbqaTSUOajs0hNJkU0mqMuKeaa1Iz4qJpKwTLjwcHmmzHK4HJPimpulbaKdc3Fvp8JeVgWAotVDW9dQV16VDJkdvZsD6krBF+tSXeuWtom0NuI9qyupa/NckqjHb9KCSCWckSMcE12tP9PVBzODqfqjOcJNLfdWSMSIjtH0oTJrFzcsQXf8AeqK2oI4Gat20G0/MPFPCutRwJzDbdYeTKMtzcu5+aoJRdNyWNG4rNS+cDFPnthj5RWg4B4Eo0MwyTMy63A7sah9aeM4DtWgkt/DCq0tmhHAFb9QQf25HUErqNynIc8fWrtn1PeWzjLsQKjmsQBwKHTWzKDWSEbsTS+oh4M32j9YRXJ2XWMnjNaXZb3cQePaynyK4ed8TbkJDCtP0x1NLayLFO5KE4OTSd2mBGROjp9YwOGnQ5/yYseBVeKXNTTP8bZh4DuDDIxUcafDRKHXdO3j2ri3uKPdO5UvrAYk/qBBljg+3mpUaaQqpkCKx8mqk7i2tjNK6F/Ynmhcl3PqLqtnE2R5rlXa1if8AadGrSjH+8NXF9bWMrRyMCV85zmq79VW6ZWONjntTLPpie4b1L2TAPJUUZg6dsYcEQBiPeon3LcqMCaY6deDyYCfqW8lO2GAgDsaY+sao3Ijb/wCta+Ozt4v0wouPpSs9nGvzMgNENN55azEwLqh7UmJfVdVUg8888rVVtZ1VpDkqAPGK3Ml1p4/UQ30xVC8/h0yNhFB8cUu4dRxbmFSxCea5kZdb1ERhSNz5yTipDrt6ikNECrckYqxNaqJCVHyUR0jRTfkliFjHc0tXZdawVeTGH9FVyRxKtj1BbXCqk6MkmeM9jRSOVfTZ7eQrzyM8Gk1XpG3a3PwoZp/BoTHp2p6NauJvniY5PnFHdLas7h/H/eLg02ew/wChmgYq1qFkbEngEU+0kWSIwycN4zVWxu4NRtlRuJV4H0qxbxi4VoiuJ4/+RRF/Mhl54/n/AMwLfiCDJ1up7IgFSyVN/FYJBiRStVj60fysdw8g1FPHE5G5Sv2rXq21jAPHwZWxG5P/ACl13hlHyOKjBkUYzuT2NUPhwDmN8VPA8kZALbhWPWJP5DE1sA6MtTyRxKocMeOwqBLmEH5YB/5GrZVGYEjJI7VUl9FXIZFz96JZuXkEfxMLg8SUX+BwyoP9oryXYLD043lc+TVdXtlPZKsJeRIo2EY+gqltY+5pZQeBCdtNIqZnwp8LTDIA5nk4A7A0PN7n5o4yx+tIPUlO+c8e1M/cggBeYL0ecmWvjGnil3Lhew+tVH+SDZjluAKnABHPAFPhtyZPWmGEX9INUFewjMslUEt20e2BFx2FSAAeeKqNd7UYqPOAKpztcyKQjla6DOtYEUVS5hZvSbKuV596FX+nrETNakH3UGsBqEmp/wASmge7lGDxg0W0uy1IkN8fLg9wTmlzer8YjS6dl/INNLaXeVxnn2qx6wyMmhn8KuCfUjn+f7d6q3t1PYgfFxlVH+oO3+ayWKzagOZoFkUee9SrIPFZWDWoJhmKZW+xq/DqG7GTVraJGpIh8MK8SKHRXOfNTibNF3iB2GWgBTguKhjlB81KHFaBBmTxAm6l3Uwq2eKekW48mhrUzDMaCfMbupN1LdzQWkOWYGQ8Ko71SNxxn3odoCHGZNstkA00R7jgVV+KwDVzTn9RWlb9IrNQFj7ZmxtiFoy/uotMtWc49QjisRfXk187FiSDVrqS9ku7tgp+UHGKgtYAFGR3r0unqWtAZ5PVXNc5HiQRW3sKspZ55ojDa9sCr0NnwNwojWzCUQXHaYxhasx2bHxRPbFGOSB96hl1CziOHnQf5pZ9Sq9mOJpSepCtmABmk+HXziqOq9UabY7MOZATzt8V5Ot+n/hg3qx7j4J5pf7xfEZGjMnkskbuaqy2KqeDQq66/wBNBYRpnHahUvX0DE/lYFUNaPiQ6EzQyWSuMA81QutPYDgUITrm1L/Mhx9KK23UthdYAlAJ8GiprUJ7gH0TAdQNd2pQnK0HcNFOAK3M6QXSZUg58igM2mb72KHH8xwtOCwMMxP0irYm86Jlmi0ITXI7nEYPkVfnufhkeV5B6w5AI7/SrMkMdqkFsg+SJM4HagWoH1rhYwc7jXifqGpay0mex0OnVKwsfZWk+uXnqSgiPOTjtW20/TILOILEgGPPvUGiWqWtqiAc+TRdeaa0emUDc3Zg9TeWO0dTwCqM4xQ661NVf0oF3yHtiptWlaK0Yp3PFVOn7ZdrSsMtnvRrbGNgpTj5MCiqENjSWGxuLn8y7kKj+wVLJb2duuPS3Hx5zV8nLbfaqKPu1Bg3YDittVXXgAcnyeZkOzZmcvlPxDgRhB4UUW03SIxErTjc7DPPirF3prT3IlwuKvRxyqoBZeKWo0e21mcZHiGt1GUAUwLeaEXuMQ8Ke9EbO2ksbf041Q49/NWXlZBy6ZqlK15NJtjOE96L6VVLFkByfiY3u4wx4kV3qV3ABujQZ7e9BtSvp7hCsx+U+AKLmybeN53Me/NQ6pbRw2xIAz70lqBe6kknEPV6asMDmZGC4a0u12cKx5rT+t6c9tcr/UQrVkrrl88HnitIo3aZD/eWAFJ6ZiM4/eN6hQcGH5p4xMYp0Hbg0htYpeY3FU9V+WWI+dlRRyOvYmvRsit7hOKHZejLr2Lg8KCPpUJtShzsNLHeSqO9TrqLY+ZQaA2krPUKL3EZsDICzEFaqPYxtIWYMc0SjvY3zmMcfSn/ABdue6Csto1ccmaGoIgtbOHdxDn71ajswBwgWrIurf8AtpTew+FqJokEo6hjIVtSPOfsKeLRj5wPrXjf5/SoFRPdSPx4oy6asTBuYywEhg5Y7mHvVW7uGk4X9NRvkjJOaY8kcUYaUgDPmjYCjgQeSTzJIl3kE9hVnAqmNQtx2cUyXVraMZyT9qUYljnEYGFGIH6itFiu1u9vB4ao7LU4Y8LuAp+ra9HLA8SWzvkeRWOluWB5Qg0Io45AjFViEbWM6PBqQfhPmHvV2QR3kDRzIGVhggjvXN9P1eWNwo7VoIeoFt2VJ5ApPbJrSuR3CtpwfYZzDr/SbjprXt+nzyJbzHcqg9j7UQ0rqq4toU+LO/61Y/Em7TULhSrBkiXuKxcRa5VUQf5qmwwjFYwMGdY0fqu3vTiJ1D+xNHotQ3+c/QVxEWk1o4ljcow8itx05q1zPAoYgsvBJrByvR4lNSD0J0OK6OMtxV6GVnHyjj3rNWbSnDM4Y+xorFcygDJA+lGRok6Qg0IcbVIBFVLlEhUmSX/mgltqt7qrf+mRkxH/AFn4X/FEodI3kPfTtM39vZacSuxhzwIF9QtfGcwFc3Hr3YjtUaU55I5AorHp0zoCWCnHY0YhtYIBiGJV+wqUpkZHFFOlqI55iray0nImcmsJk8hqvWu5dLmB4IU0QaPnk1CCqzNE3ZxVV6ZK23LMWah7E2tOezKTKpPJLUZtLYOFPtUGpWjWt+Y2X5d2VPuKu/GQ2Nk085AVR+9dKy0Km49Tk10kvtl38q3j3uQqjuTWV17rq0st0VsQ7jjIrG9X9ZzXkjQ27lYh7GsHPcvISWYkmuU1tl3t4E7FenSsZbubDVOtr65Y4k2j2BoBPrlzKTulc/5oOzk02qWlRCG3HAl+bUp5OGckfeqhlYnOeajPAr1F2gTBcmSGVj5pvqN702vVMCVuMeJGWpUupEOQxFV69UKgyBzNDpXUt1ZuPnLJ5BNdA6e1aDVLm2kUD1FkBK1yWytLi9uEt7WNpJXOFVRzXV9C0OPo3Szfak4a9kH6QeEq61ZT+PUDcUK5budQ1BMXKE9mXFZy7Bhvo3bld3etFaTJqmjQXURydoahmqWomg3R/r9vavN62kpYZ3tJaGUTU6fIskClTRCNvlrE9P6sYWFvcfKR2zWtgmR8MrcU9pNQGUDzFtRSVaWrmBZoWVuc0PsgbKRg7fIaKIwI8UrxJIMMARTj1BmDr2Iqtm0FT1I0ZZGDowPHbNRSWkcjEurBvcGnfARKdyFlP0NPWKRe0xP3FXtLe9ZMge0xkdsV/wBZyPYmpjEpHJP703bL/eP2r2xj+pia0ABwBMkk+Z4pDH7Z/emF2fiMYHuakESjmlLKo9hUwf2kB/1jEjCrknJ+tZ/qW6VYii0Q1LVIreMgMN1YfUr+S7nKJ8zN/wAVytfqVC+mkf0lDFt7SvbxtcXaIozg81sLWD1b2CFeUh+Zz9aCadbnTogzjfcyfoTyfvWm0tGtLNvV5mkOWNC0NG5uf/f/ALC6u3jiU9al3XgA7AVGj0zUNrXIyeQKj5XtXZzzOTiWwc8ing58VXRsCpN9aBly3CBtJFMA70xJMDFLu4qcSsGOIrwFR7x707ePFXJJO1IGNN3U6PlqkoSRziPHk1UurU3TohztHJqeeUIMKMt4p0Hrj5iAM1lnA7mghMWHSI1AytS/wyHGCo/aphPMBj5aQySn+oVXqrL9IylPpMPOEH7UIu9Hth3Rc0cvjMLZ2RyGwaz8F+gP5r7m8k0Nr1HENXpy0HzaX6eTbwAnwcUJv9EklR5ZclwM/at1aSpOPkIIp13aLJC4AAJFCILDMdrAqOJwnV/iLqOS3tlJccE1S0NZ7KcW15EVY8gnzXVo+lTAZJVwSxyRig/UWlWa2ElzcP6dxH+kdqwDxtxCbwGDZgaeBZU+UZqtbTzaZch1BKeRRfp+NbiBWPJNXb7S1kQ4XxQY3kS5pusWt4gEcgD/ANpOCKJrLIMYc4rnF1ZSWU6yISpDdxRvTtWuYZPSnJdcZBqZxAsgM6nbQrDEscShVUcADAFPnuLa0jMl1OkaAZJY4p8tpIYisUoVj5I7UMu+nrS7tzHeqbgkfMXJrsWagDqcBNOSeeINu/xH6Xs2MfxPrOP+2M0f0/VodRso7q1TfDIMqc1gdc/D7SvRY2cPoyAcban/AA7nmsbafTZjxbvx9jSx1DN7TGV0q9GbmW6jTPqRuh9yOKD69fpb2yXUf6k780b+WROQCCP3rGdcadPFatc2is0WMOg/p+tE0+q3MFeLX6bAJWFbO7s+orBXBAmXsfINc9/E97/Tolg9Fxbt/qKPlNUdM1K50+5WWBiAQCQDwa32mdRW2qwGDUIEdSMFXGQacvo3qPiKU2hH5HM+dppWduTUNd41f8NOndXLTWUjWUh5/LOU/asbqP4RazCSdPuba7j8c7T+1D2ERg2BpzmvVqLn8PuqLbO7Spn+sY3UPl6X12L+ZpN4v/xGpJkQQeRSYPgUXj6Z12ThNJvD/wDEaIWnQfVVyQItHuRn+5cVO5MzMc16ug2f4RdSykG6FvaqfLyZP7Vo9P8Awi0y2UNq+rs5HdIhgVApMosB3OOpGzsFRSzHgKBkmtj03+HOsawyS3EZs7U93lGCR9BXVLGz6Z0Bdum6fG0g/wBRhlv+aj1LXbiYEJ8i+AKKtJ8wLXjxK+m6VofR9q3wqiS5x80r8sf/AOVg+sNYuNTmILEIOwo3fGSUlmYnNZq+gLTAYPJwKKwCLFhusbmdN/DPVXTRbYMcovyOPtW0uLNZVM9phlYZZa550PaNa2bgHMbMB9jW1srqW2bKEke1cq+tbRhp1qXZMYlC+06Oc+ogZJB47Uyy1K704iO4Vig/qrTLJZ6goZvype24VWutLmwcKJU9x3rj26Oys7k5/adOvVKw2tJLLW4Z1G18feiUWoIw4cGslLpcO7jdE/nxUfwt1F/Jl3D61S6u6vuWdPU/Rm3+M+2PvTvi/tWE9TU1yM5+gpfi9SUDMZwfrRB9Sb4mPsh4Im5N2PcVG98q92FYr1tSbspGfrXlgv5iA77Puao/UXPAEsaNR2ZqbjWoYs5ftQS+6iLgrEf+KpDTWLkS3Ab6Kc5ohZ6MWwYbViP7pOBQmt1NxxNhKK+TAxW91F8YITyxolpemgNts4/VmP6pT+laPRaQgAa7lyP+2nC1aaaOFAkCBVHhRimaPpxzueBt1vGEkVtYw2QLv+bcN3duf2rzkkkmlVizZavSjOcV1lRUGFE55YscmZrVJGN2Sp/TxToZt6c96fcwGR2ZBk5qqA8Tcrj70qLATDbCBLytxT1NVY3zUyGiB5krLSk0/PFRIR5NSEj3rYMrERlGacBxTQR3Jpj3CqcDk/Sr3StslJxUtuXckAce9Nt4GkUNJkD2q4q7RhRgVhrMdTSpnueSJFbJ5NS8VH2r1L5hsSTivZFMApcVMyRzYYEHsaxPUWmSW05mhB9Fjk48VtMU2WJZUKOAQe9ZZd03XZsORAGgmOKPCnjGaLXE6+kSD4oTqNt/DAJoFYx/1KPFBr3WW9JvRyagtCDBjSgWNnM1Wml5eZQME8VX6h6dstWtylxGMg5BFDNK1ZfQXc43D3ouNTjZQGYZNbR0K4My9bbsiAU6ejtUCwLtIHGKj2kExSjDCtaqCaMbf3oFrVuYnWQjkHvWSmBkS1sOcGZPqCzDQMQOQc1Qa2IEEuPvWk1GMSW7Y8iqiW4a3VSO1BeHVuJ0tpEHc0wzx4xQuS5HvVS4vRGM7qZNuIgK4SuljZWJxWStzbWerXLySIisuBk4q5Pq4KkBv81hurc3jRrCxJJ5IqqU9e4IOMy7W+3qNh8TaS9VWsC+mLhML5zS2nWmkyFo7y6iUY/q7VzCPRZdvZjQ2/0WfklGFdP/AIUoHu5nJP1cH+zE1XUU+iza6n8GuEkEwJdE7K1WNLhMcrxt5rmkMU9hfxyqD8p811ayljmt4rgH9ag0xg1VBT4gVIst3DzIfirmyuCBI2zPbNFodXu2h3xAgDyKoBIrqUxswGTwaKektvbekhBJ7mr3qR+sH6TBjjqej6lvFO084qf/AKnmx8wA+4oU0Q7gVE8IYc962oQ9zDiwdGHh1NOVLDAXPAArza3qEsRePcVH1rPCGTGAaJ2c/pW5jZTzWiiDqYBsPcRtTvZyfnPseagl9dzy5NLC4WQjHc1cO0jIFQsF6E0lZbuCpNy/rWoFT1nwc4oo8QfxUYhCngUNreIZaeZRkt0CYrL3YX+InP6V7D61sLoFY2NZzT7A3mpbiMru5pRnyDmMbcEACarQVlSxjjUH5jvNaa2O7HvjkVDYWyRBVAwBRF4FWUOnGRyKRFmSY+1WFB8yOFRnB96uJcSwHCMSPYmqo+V6kooMCRLw1GNxieEMPtXsaZL3j2H6cVRwKXbkVCit7hmQEjoy6tjp7/pmkH03ZpRp1kP/AHEn70NYFTSgkkcmsfbU/wCImvWs+YRbTbLs1xLz7NUkVlpyHOwyH/cc0HupSsyAE4FE9MT1AHlPFRaKgeFEo2WEdwjCIUGIIEX7CkkuNp2s2D7CnyzR28LOB24H38VUtBvbcec9yaMSF4WRE3ZZpK8fqKWV9xHiqWfmwferk67HDIMe9LNarLGJIuDjOKsHMy6YwRKyHmmXEojhdwfGF+9ROSGC5IY8YqG6YErEvZe/3odz7Ul1plpDADnmrsVss3DKCKrwRliABRq1h2qKTorLGM2OAIKuNFcDfB+1UGhnibDRsMe4rXjivbFbuoNOmkeIsLDMghkJ/TViOGeQ4VK0voRZz6a5+1PCKOwAqCnHmQ2QLBpEjjM8mB7CrsemQxfpQE+5q+K9RAgmNxlJrfHam+gav4pNorBqE16hg1oyDzSYxRFogahe3HihtSfE2LPmVaUVJ6DV4wkCh7Gm9wjK9XiMcUmKqXGyxrIhV1BB96A3XTcMjlo22g+K0BFJihsobubVivUy0vTISJ2V8sBxig1qsiXeLg7dpxiuhbRjBode6NbXZLMuG9xQ2qxysYr1BHBMfYXEccarngin3cEd8MN2FUbfRHiYD4hyg8Gi0MIiQKP3owYlcEQblc5B5lEaRb7NpUGqV1oIzm3OB7UfxXsVkoDMixh5mLlv196E6nqMcakyShB9TRfpyDTr6zS6X8x/6gx7GsT19cRx6y8MaggIPlUeaCMlsGMgjxLE8rzAC2ZX3diG4FX9D0G7lnR7sxlSe2a5c9lrUspks4J1BPG04rX9D2OvSTK19cXEaqf0Oe9diq2jTrlBz/JnJvo1Gpfa54/gTqqaFAo5VKnbp7S2TM00Y9xxVVLYlfmkf96hubWExlZMnP1oZ1+epB9PH6TP9V9K6Q+DZSgv544rPWsHw97FZBzHG/6STkVv+ltPgjN3xvVnGN/OKvX/AE5pt9y8AVweGXgitffhl2kQX2BrfcpmGm0e7tJPUcggHutEEO9B71pxpEqQ+k7+qoGFJ74oBdWT2kh2qduefpWFuycGHNWOZSnUqpIqhJIXY0Z2B15qlPYNuLJzTlNwHBid9LHkSnHIUOc5ogo3oCKqC2lJwUxRS1h2oFIoljjxB1IR3KTRlCCPFWIn3AVNNDkGqpJQ4oZfMMEwZYIHimstRCQ55pWd3ISMFmPgUB2hlGZWuhv/ACxzmjvTugC3h9eVPmYcD2q7oegbGFxdr83dVrSBAFwOBSljkjAjCLg5My2s3A06Ay9sdhQ/T9aluFDqhIzyPpWl1PTY7xdsi7h9aZa6XBax7UQAD6UoA2cCdAW1+ngjmOhRbiD1F9s0wZFSqVgYhDwfFMYgtkdjTyqdozOYxG44kZYivepipGjBFV3jYeeK1u+ZnHPEkZ1NRvIB2qJzhPrVZ5frVbpsLJnlGRk5Oa9fag8NpmJsFfahsrknOajY+qCjfpPehliepvYByZpLDUJNS05ZHXGDt+5o1aIVUE4oVpkCwadBDGPqaLQbgvatJ3kwjDCYEWf5mVT71PaHCsv9rVGQSckU61P5rD6UUdwL8piVtQt9r+tGuXPFUUsZCcvgZo9KMqR9KpqQ4wPsaFbWC3MlTYEhggWL60Rhwy5WquMcU+2bbKUPZhmtpheBJYM8y3Xq9XqNAT1LSGkzUkjq9TQaUGrlRaWkpakk9Xq8K9UkiEU2TG2nmqs8mBgVhyAJpQSZBIfmppNeyDXuKTPJjI6iBqXNewK9iqlxc0mRSYr3FSSLmlzSZr1SSLXq9SgVck//2Q==";
const CAT_IMAGES = { bebida: CAT_IMG_BEBIDA };
function Brand() {
  return (
    <div className="brand">
      <img className="brand-logo" src={LOGO_ICARA} alt="Centro ícara — Fundación Asprodisis" />
    </div>
  );
}

/* ---------------------------------------------------------
   APP
--------------------------------------------------------- */
export default function KioskoIcara() {
  const [view, setView] = useState("menu"); // menu | checkout | confirmacion | cocina
  const [cart, setCart] = useState({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [payMethod, setPayMethod] = useState("tarjeta");
  const [paying, setPaying] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const rows = await supaRequest("menu_config?id=eq.1&select=*");
        setConfig(rows?.[0] ? configFromRow(rows[0]) : DEFAULT_CONFIG);
      } catch {
        setConfig(DEFAULT_CONFIG);
      } finally {
        setConfigLoading(false);
      }
    })();
  }, []);

  // Vuelta desde la página de pago de Stripe (éxito o cancelación).
  // La app se recarga entera al volver, así que recuperamos el
  // pedido (o el carrito) según lo que dejamos guardado antes de irnos.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pago = params.get("pago");
    const orderId = params.get("pedido");
    if (!pago || !orderId) return;

    const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);

    if (pago === "cancelado") {
      fetch("/api/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      }).catch(() => {});
      try {
        const draft = JSON.parse(sessionStorage.getItem("icara_draft") || "null");
        if (draft) {
          setCart(draft.cart || {});
          setName(draft.name || "");
          setEmail(draft.email || "");
          setPayMethod(draft.payMethod || "tarjeta");
        }
      } catch {}
      setView("checkout");
      cleanUrl();
      alert("Has cancelado el pago. Tu pedido sigue aquí por si quieres intentarlo de nuevo.");
      return;
    }

    if (pago === "exito") {
      setAwaitingPayment(true);
      let attempts = 0;
      const poll = async () => {
        attempts += 1;
        try {
          const rows = await supaRequest(`pedidos?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
          const row = rows?.[0];
          if (row && row.status !== "pendiente_pago") {
            setConfirmedOrder(orderFromRow(row));
            setView("confirmacion");
            setAwaitingPayment(false);
            sessionStorage.removeItem("icara_draft");
            cleanUrl();
            return;
          }
        } catch {}
        if (attempts < 12) {
          setTimeout(poll, 1500);
        } else {
          setAwaitingPayment(false);
          cleanUrl();
          alert("Tu pago se ha recibido, pero está tardando en confirmarse. Consulta tu correo en unos minutos, o pide en \"Equipo Ícara\" que busquen tu código.");
        }
      };
      poll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = async (nextConfig, token) => {
    await supaRequest("menu_config?id=eq.1", {
      method: "PATCH",
      body: configToRow(nextConfig),
      prefer: "return=minimal",
      token,
    });
    setConfig(nextConfig);
    return true;
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const targetDate = useMemo(() => tomorrow(), [now]);
  const countdown = useMemo(() => fmtCountdown(msUntilMidnight()), [now]);

  const cartItems = useMemo(() => Object.values(cart).filter((i) => i.qty > 0), [cart]);
  const total = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
  const itemCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const addItem = (item, delta) => {
    setCart((c) => {
      const existingQty = c[item.id]?.qty || 0;
      const qty = Math.max(0, existingQty + delta);
      if (qty === 0) {
        const rest = { ...c };
        delete rest[item.id];
        return rest;
      }
      return { ...c, [item.id]: { ...item, qty } };
    });
  };

  const submitOrder = async () => {
    if (!acceptedPrivacy) {
      alert("Tienes que aceptar la política de privacidad antes de pagar.");
      return;
    }
    setPaying(true);
    try {
      const dKey = dateKey(targetDate);

      // Guardamos el carrito por si el alumno cancela el pago y vuelve.
      sessionStorage.setItem(
        "icara_draft",
        JSON.stringify({ cart, name, email, payMethod })
      );

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartItems.map(({ id, name, qty }) => ({ id, name, qty })),
          name,
          email,
          date: dKey,
          privacyAccepted: acceptedPrivacy,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "No se ha podido iniciar el pago");

      // Llevamos al alumno a la página de pago real de Stripe.
      window.location.href = data.url;
    } catch (e) {
      alert(e.message || "No se ha podido procesar el pedido. Inténtalo de nuevo.");
      setPaying(false);
      if (e.message?.includes("hora límite")) {
        window.location.reload();
      }
    }
  };

  const resetForNewOrder = () => {
    setName("");
    setEmail("");
    setConfirmedOrder(null);
    setView("menu");
  };

  const cancelOrder = async () => {
    if (!confirmedOrder) return;
    const res = await fetch("/api/cancel-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: confirmedOrder.orderId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "No se ha podido cancelar el pedido");
    }
    setConfirmedOrder({ ...confirmedOrder, status: "cancelado" });
  };

  return (
    <div style={rootStyle}>
      <style>{css}</style>

      <header className="topbar">
        <Brand />
        <div className="topbar-links">
          {view !== "privacidad" && (
            <button className="link-btn" onClick={() => setView("privacidad")}>Privacidad</button>
          )}
          {view !== "cocina" ? (
            <button className="link-btn" onClick={() => setView("cocina")}>Equipo Ícara</button>
          ) : (
            <button className="link-btn" onClick={() => setView("menu")}>Salir</button>
          )}
        </div>
      </header>

      {configLoading || awaitingPayment ? (
        <div className="screen center">
          <div className="hint">
            {awaitingPayment ? "Confirmando tu pago…" : "Cargando kiosko…"}
          </div>
        </div>
      ) : (
        <>
          {view === "menu" && (
            <MenuView
              targetDate={targetDate}
              countdown={countdown}
              cart={cart}
              addItem={addItem}
              itemCount={itemCount}
              total={total}
              config={config}
              onCheckout={() => setView("checkout")}
            />
          )}

          {view === "checkout" && (
            <CheckoutView
              targetDate={targetDate}
              cartItems={cartItems}
              total={total}
              name={name} setName={setName}
              email={email} setEmail={setEmail}
              payMethod={payMethod} setPayMethod={setPayMethod}
              paying={paying}
              acceptedPrivacy={acceptedPrivacy}
              setAcceptedPrivacy={setAcceptedPrivacy}
              onOpenPrivacy={() => setView("privacidad")}
              onBack={() => setView("menu")}
              onPay={submitOrder}
            />
          )}

          {view === "confirmacion" && confirmedOrder && (
            <ConfirmationView order={confirmedOrder} config={config} onNew={resetForNewOrder} onCancel={cancelOrder} />
          )}

          {view === "cocina" && <CocinaView config={config} saveConfig={saveConfig} />}

          {view === "privacidad" && (
            <PrivacidadView onBack={() => setView(cartItems.length > 0 || name || email ? "checkout" : "menu")} />
          )}
        </>
      )}

      <footer className="site-footer">
        Centro ícara. Todos los derechos reservados. {new Date().getFullYear()}
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------
   VISTA: MENÚ
--------------------------------------------------------- */
function MenuView({ targetDate, countdown, cart, addItem, itemCount, total, config, onCheckout }) {
  return (
    <div className="screen">
      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">Pedido para</div>
          <h1>{longDate(targetDate)}</h1>
          <p>Elige tu desayuno, págalo ahora y recógelo con tu código en el recreo. La food truck de Ícara te espera en el patio.</p>
          <div className="truck-scene" aria-hidden="true">
            <svg viewBox="0 0 200 92" className="truck-svg">
              <ellipse cx="100" cy="80" rx="60" ry="5" className="truck-shadow" />
              <g className="truck-motion-lines">
                <line x1="6" y1="30" x2="30" y2="30" />
                <line x1="2" y1="42" x2="26" y2="42" />
                <line x1="8" y1="54" x2="28" y2="54" />
              </g>
              <g className="truck-group">
                <path d="M16,62 L16,38 Q16,16 42,16 L158,16 Q184,16 184,38 L184,62 Z" className="truck-roof" />
                <rect x="16" y="46" width="168" height="16" className="truck-band" />
                <rect x="16" y="58" width="168" height="5" className="truck-bumper" />
                <rect x="64" y="24" width="92" height="4" rx="2" className="truck-awning" />
                <rect x="66" y="28" width="88" height="20" rx="3" className="truck-hatch" />
                <rect x="26" y="30" width="26" height="18" rx="2" className="truck-cab-window" />
                <line x1="52" y1="30" x2="52" y2="62" className="truck-door" />
                <circle cx="24" cy="52" r="4" className="truck-headlight" />
                <circle cx="52" cy="66" r="13" className="truck-wheel" />
                <circle cx="52" cy="66" r="5" className="truck-hub" />
                <circle cx="148" cy="66" r="13" className="truck-wheel" />
                <circle cx="148" cy="66" r="5" className="truck-hub" />
              </g>
              <circle cx="16" cy="56" r="5" className="truck-puff" />
              <g className="truck-delivery">
                <rect x="100" y="30" width="22" height="17" rx="3" className="delivery-bag" />
                <rect x="102" y="24" width="18" height="8" rx="2" className="delivery-fold" />
                <circle cx="111" cy="22" r="4.5" className="delivery-pastry" />
              </g>
              <g className="delivery-sparkles">
                <circle cx="130" cy="18" r="2" className="sparkle sparkle-a" />
                <circle cx="90" cy="14" r="1.6" className="sparkle sparkle-b" />
                <circle cx="122" cy="10" r="1.3" className="sparkle sparkle-c" />
              </g>
            </svg>
          </div>
        </div>
        <div className="countdown">
          <Clock size={16} />
          <span>Cierra en <strong>{countdown}</strong></span>
        </div>
      </section>

      <section className="cat-block">
        <div className="cat-banner">
          <img className="cat-banner-img" src={CAT_IMG_PAN} alt="" />
          <h2><Sandwich size={18} strokeWidth={2.2} /> Bocadillos básicos</h2>
        </div>
        <BocadilloBuilder
          idPrefix="bocbas"
          itemLabel="Bocadillo básico"
          sizeOptions={config.bocbasSizes}
          ingredientOptions={config.bocbasIngredients}
          maxIngredients={1}
          ingredientsRequired={false}
          ingredientStepLabel="2. Añade tu ingrediente (opcional)"
          joinWord="con"
          cart={cart}
          addItem={addItem}
        />
      </section>

      <section className="cat-block">
        <div className="cat-banner">
          <img className="cat-banner-img" src={CAT_IMG_ICARA} alt="" />
          <h2><Sandwich size={18} strokeWidth={2.2} /> Bocadillos Ícara</h2>
        </div>
        <BocadilloBuilder
          idPrefix="bocicara"
          itemLabel="Bocadillo Ícara"
          sizeOptions={config.icaraSizes}
          ingredientOptions={config.icaraRellenos}
          maxIngredients={1}
          ingredientsRequired={true}
          ingredientStepLabel="2. Elige el relleno"
          joinWord="de"
          cart={cart}
          addItem={addItem}
        />
      </section>

      <section className="cat-block salsas-block">
        <h2 className="salsas-title"><Droplet size={17} strokeWidth={2.2} /> Salsas</h2>
        <div className="grid salsas-grid">
          {config.salsas.map((s) => {
            const qty = cart[s.id]?.qty || 0;
            return (
              <div className={"card card-salsa" + (qty > 0 ? " card-active" : "")} key={s.id}>
                <div className="card-top">
                  <div className="card-name">{s.name}</div>
                  <div className="card-price">+{eur(s.price)}</div>
                </div>
                <div className="stepper">
                  <button aria-label="Quitar" onClick={() => addItem({ id: s.id, name: s.name, price: s.price, icon: Droplet }, -1)} disabled={qty === 0}>
                    <Minus size={15} />
                  </button>
                  <span>{qty}</span>
                  <button aria-label="Añadir" onClick={() => addItem({ id: s.id, name: s.name, price: s.price, icon: Droplet }, 1)}>
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {Object.entries(CATS).map(([catId, meta]) => {
        const Icon = meta.icon;
        const items = config.menu.filter((m) => m.cat === catId);
        return (
          <section className="cat-block" key={catId}>
            <div className="cat-banner">
              <img className="cat-banner-img" src={CAT_IMAGES[catId]} alt="" />
              <h2><Icon size={18} strokeWidth={2.2} /> {meta.label}</h2>
            </div>
            <div className="grid">
              {items.map((item) => {
                const qty = cart[item.id]?.qty || 0;
                const ItemIcon = resolveIcon(item.icon);
                return (
                  <div className={"card" + (qty > 0 ? " card-active" : "")} key={item.id}>
                    <div className="card-icon"><ItemIcon size={20} strokeWidth={2} /></div>
                    <div className="card-top">
                      <div className="card-name">{item.name}</div>
                      <div className="card-price">{eur(item.price)}</div>
                    </div>
                    {item.desc && <div className="card-desc">{item.desc}</div>}
                    <div className="stepper">
                      <button aria-label="Quitar" onClick={() => addItem({ id: item.id, name: item.name, price: item.price, icon: ItemIcon }, -1)} disabled={qty === 0}>
                        <Minus size={15} />
                      </button>
                      <span>{qty}</span>
                      <button aria-label="Añadir" onClick={() => addItem({ id: item.id, name: item.name, price: item.price, icon: ItemIcon }, 1)}>
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {itemCount > 0 && (
        <div className="cart-bar">
          <div>
            <strong>{itemCount}</strong> {itemCount === 1 ? "artículo" : "artículos"} · {eur(total)}
          </div>
          <button className="btn-primary" onClick={onCheckout}>
            <ShoppingBag size={16} /> Ver pedido
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   PAN Y TOSTADAS — paso 1: elige el pan, paso 2: ingredientes
--------------------------------------------------------- */
function BocadilloBuilder({
  cart, addItem, idPrefix, itemLabel,
  sizeOptions, ingredientOptions, maxIngredients, ingredientsRequired,
  ingredientStepLabel, joinWord,
}) {
  const [sizeId, setSizeId] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const draftIdRef = useRef(null);

  const sizeObj = sizeId ? sizeOptions.find((s) => s.id === sizeId) : null;
  const ingredientObjs = ingredientOptions.filter((i) => ingredients.includes(i.id));
  const price = sizeObj ? sizeObj.price : 0;
  const ready = !!sizeObj && (!ingredientsRequired || ingredients.length > 0);
  const name = sizeObj
    ? `${itemLabel} ${(sizeObj.label || "").toLowerCase()}` +
      (ingredientObjs.length ? ` ${joinWord} ${ingredientObjs.map((i) => (i.label || "").toLowerCase()).join(", ")}` : "")
    : "";
  const entryId = ready ? `${idPrefix}-${sizeId}--${[...ingredients].sort().join(".")}` : null;

  // Se añade (o actualiza) sola en el pedido en cuanto la selección queda completa — sin botón.
  useEffect(() => {
    if (!entryId) return;
    const prevId = draftIdRef.current;
    if (prevId && prevId !== entryId) {
      const prevQty = cart[prevId]?.qty || 1;
      addItem({ id: prevId }, -prevQty);
      addItem({ id: entryId, name, price, icon: Sandwich }, prevQty);
    } else if (!prevId) {
      addItem({ id: entryId, name, price, icon: Sandwich }, 1);
    }
    draftIdRef.current = entryId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const toggleIngredient = (id) =>
    setIngredients((ing) => {
      if (ing.includes(id)) return ing.filter((x) => x !== id);
      if (maxIngredients === 1) return [id];
      if (ing.length >= maxIngredients) return ing;
      return [...ing, id];
    });

  const startAnother = () => {
    draftIdRef.current = null;
    setSizeId(null);
    setIngredients([]);
  };

  const addedItems = Object.values(cart).filter((i) => i.id.startsWith(`${idPrefix}-`));

  return (
    <div className="pan-builder">
      <div className="builder-step">
        <div className="builder-label">1. Elige el pan y el tamaño</div>
        <div className="bread-options">
          {sizeOptions.map((s) => {
            const SizeIcon = resolveIcon(s.icon);
            return (
              <button
                key={s.id}
                className={"bread-opt" + (sizeId === s.id ? " bread-opt-active" : "")}
                onClick={() => setSizeId(s.id)}
              >
                <span className="bread-opt-top">
                  <SizeIcon size={17} strokeWidth={2} />
                  <span>{s.label}</span>
                </span>
                <span className="bread-extra">{eur(s.price)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="builder-step">
        <div className="builder-label">{ingredientStepLabel}</div>
        <div className="extras-options">
          {ingredientOptions.map((ing) => {
            const IngIcon = resolveIcon(ing.icon);
            return (
              <button
                key={ing.id}
                className={"extra-opt" + (ingredients.includes(ing.id) ? " extra-opt-active" : "")}
                onClick={() => toggleIngredient(ing.id)}
              >
                <IngIcon size={15} strokeWidth={2} />
                <span>{ing.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sizeObj && !ready && (
        <div className="builder-live">Elige {maxIngredients === 1 ? "el relleno" : "los ingredientes"} para añadirlo al pedido.</div>
      )}
      {ready && (
        <div className="builder-live">
          <Check size={14} strokeWidth={2.5} /> Añadido: <strong>{name}</strong> · {eur(price)}
        </div>
      )}

      {addedItems.length > 0 && (
        <div className="pan-added-list">
          {addedItems.map((i) => (
            <div className="pan-added-row" key={i.id}>
              <span className="pan-added-name">{i.qty} × {i.name}</span>
              <div className="stepper">
                <button aria-label="Quitar" onClick={() => addItem(i, -1)}>
                  <Minus size={14} />
                </button>
                <span>{i.qty}</span>
                <button aria-label="Añadir" onClick={() => addItem(i, 1)}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ))}
          <button className="pan-new-link" onClick={startAnother}>
            <Plus size={13} /> Pedir otro bocadillo distinto
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   VISTA: CHECKOUT
--------------------------------------------------------- */
function CheckoutView({ targetDate, cartItems, total, name, setName, email, setEmail, payMethod, setPayMethod, paying, acceptedPrivacy, setAcceptedPrivacy, onOpenPrivacy, onBack, onPay }) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canPay = name.trim().length > 1 && emailValid && cartItems.length > 0 && acceptedPrivacy;
  return (
    <div className="screen narrow">
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Seguir eligiendo</button>

      <h1 className="section-title">Tu pedido para {longDate(targetDate)}</h1>

      <div className="summary-box">
        {cartItems.map((i) => {
          const ItemIcon = i.icon;
          return (
            <div className="summary-row" key={i.id}>
              <span className="summary-row-name"><ItemIcon size={15} strokeWidth={2} /> {i.qty} × {i.name}</span>
              <span>{eur(i.price * i.qty)}</span>
            </div>
          );
        })}
        <div className="summary-row summary-total">
          <span>Total</span>
          <span>{eur(total)}</span>
        </div>
      </div>

      <label className="field">
        <span>Nombre y apellidos</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Lucía Gómez" />
      </label>
      <label className="field">
        <span>Correo electrónico</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tunombre@ejemplo.com" />
        {email.trim().length > 0 && !emailValid && <div className="field-error">Escribe un correo válido</div>}
      </label>

      <div className="pay-methods">
        <button className="pay-opt pay-opt-active" disabled>
          <CreditCard size={18} /> Tarjeta
        </button>
        <button className="pay-opt" disabled title="Disponible cuando la cuenta de Stripe esté verificada">
          <Smartphone size={18} /> Bizum (próximamente)
        </button>
      </div>
      <p className="hint">Pago con tarjeta a través de Stripe — en modo de prueba no se realiza ningún cargo real.</p>

      <label className="privacy-check">
        <input
          type="checkbox"
          checked={acceptedPrivacy}
          onChange={(e) => setAcceptedPrivacy(e.target.checked)}
        />
        <span>
          He leído y acepto la{" "}
          <button type="button" className="link-inline" onClick={onOpenPrivacy}>
            política de privacidad
          </button>
        </span>
      </label>

      <button className="btn-primary btn-wide" disabled={!canPay || paying} onClick={onPay}>
        {paying ? <><Loader2 size={16} className="spin" /> Conectando con Stripe…</> : <>Pagar {eur(total)}</>}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------
   VISTA: PRIVACIDAD
   Aviso básico de protección de datos. Esto no sustituye el
   asesoramiento legal de un profesional — antes de usarlo con
   alumnos reales, conviene que alguien de la fundación (o su
   asesoría) revise y complete los datos marcados entre [corchetes].
--------------------------------------------------------- */
function PrivacidadView({ onBack }) {
  return (
    <div className="screen narrow">
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <h1 className="section-title">Política de privacidad</h1>
      <div className="privacy-text">
        <p><strong>Responsable del tratamiento:</strong> Centro Ícara - Fundación Asprodisis, con domicilio en C/ Fernando de los Ríos, 2, Ronda (Málaga).</p>

        <h2>¿Qué datos recogemos?</h2>
        <p>Cuando haces un pedido en este kiosko digital, recogemos tu nombre, tu correo electrónico, los productos que pides y la fecha de recogida. El pago se gestiona directamente por Stripe, que trata los datos de tu tarjeta — nosotros no los vemos ni los guardamos en ningún momento.</p>

        <h2>¿Para qué los usamos?</h2>
        <p>Únicamente para gestionar tu pedido: prepararlo, cobrarlo, generarte un código de recogida y avisarte por correo. No usamos estos datos para publicidad ni los vendemos a terceros.</p>

        <h2>¿Con quién los compartimos?</h2>
        <p>Con los proveedores que hacen posible el servicio, que actúan como encargados del tratamiento:</p>
        <ul>
          <li><strong>Supabase</strong> — almacena la base de datos de pedidos (servidores en la Unión Europea).</li>
          <li><strong>Stripe</strong> — procesa el pago con tarjeta.</li>
          <li><strong>Resend</strong> — envía el correo de confirmación con tu código y QR.</li>
          <li><strong>Vercel</strong> — aloja esta página web.</li>
        </ul>

        <h2>¿Cuánto tiempo los guardamos?</h2>
        <p>Mientras dure el curso escolar y el tiempo necesario para cumplir con obligaciones legales (por ejemplo, fiscales o contables), y no más.</p>

        <h2>Menores de edad</h2>
        <p>Si tienes menos de 14 años, necesitas la autorización de tu padre, madre o tutor legal para usar este servicio.</p>

        <h2>Tus derechos</h2>
        <p>Puedes pedir acceder a tus datos, corregirlos, borrarlos o limitarnos su uso escribiendo a [email de contacto de la fundación]. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es) si crees que tus datos no se están tratando correctamente.</p>

        <p className="hint">Última actualización: {new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long" })}.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   VISTA: CONFIRMACIÓN
--------------------------------------------------------- */
function ConfirmationView({ order, config, onNew, onCancel }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const isCancelled = order.status === "cancelado";

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } catch (e) {
      alert("No se ha podido cancelar el pedido. Inténtalo de nuevo.");
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  };

  if (isCancelled) {
    return (
      <div className="screen narrow center">
        <div className="cancelled-box">
          <XCircle size={30} strokeWidth={2} />
          <div className="cancelled-title">Pedido cancelado</div>
          <div className="cancelled-code">{order.code}</div>
          <p className="hint">Este pedido no se preparará. Si quieres desayunar mañana, haz uno nuevo.</p>
        </div>
        <button className="btn-secondary" onClick={onNew}>Hacer otro pedido</button>
      </div>
    );
  }

  const qrData = encodeURIComponent(`ICARA|${order.date}|${order.code}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${qrData}`;
  return (
    <div className="screen narrow center">
      <Ticket style={{ width: "100%", maxWidth: 380, padding: "28px 24px" }}>
        <div className="ticket-check"><Check size={22} strokeWidth={3} /></div>
        <div className="ticket-label">Pedido confirmado</div>
        <div className="ticket-code">{order.code}</div>
        <img className="ticket-qr" src={qrUrl} alt={`Código QR del pedido ${order.code}`} width={140} height={140} />
        <div className="ticket-dashes" />
        <div className="ticket-meta">
          <div>{order.name}</div>
          <div>{order.email}</div>
          <div>Recogida: {longDate(new Date(order.date + "T00:00:00"))}</div>
        </div>
        <ul className="ticket-items">
          {order.items.map((i) => {
            const ItemIcon = iconFor(i.id, config);
            return (
              <li key={i.id}><ItemIcon size={15} strokeWidth={2} /> {i.qty} × {i.name}</li>
            );
          })}
        </ul>
        <div className="ticket-total">Total pagado: {eur(order.total)}</div>
      </Ticket>
      <div className="email-note">
        <Mail size={15} /> Hemos enviado este código y el QR a <strong>{order.email}</strong>
      </div>
      <p className="confirm-note">Descarga el correo o haz una captura del QR. En el recreo, enséñalo en la food truck de Ícara para recoger tu desayuno — no hace falta nada más.</p>

      {!confirmingCancel ? (
        <button className="cancel-link" onClick={() => setConfirmingCancel(true)}>Cancelar pedido</button>
      ) : (
        <div className="cancel-confirm">
          <span><AlertTriangle size={14} /> ¿Seguro que quieres cancelarlo?</span>
          <div className="cancel-confirm-actions">
            <button className="btn-secondary" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
              Volver
            </button>
            <button className="btn-danger" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <><Loader2 size={14} className="spin" /> Cancelando…</> : "Sí, cancelar"}
            </button>
          </div>
        </div>
      )}

      <button className="btn-secondary" onClick={onNew}>Hacer otro pedido</button>
    </div>
  );
}

/* Carga jsQR bajo demanda (solo al abrir el modo cámara) desde cdnjs */
function loadJsQR() {
  if (typeof window === "undefined") return Promise.reject(new Error("Sin ventana"));
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!window.__jsQRLoading) {
    window.__jsQRLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js";
      script.async = true;
      script.onload = () => resolve(window.jsQR);
      script.onerror = () => reject(new Error("No se pudo cargar el lector de QR"));
      document.head.appendChild(script);
    });
  }
  return window.__jsQRLoading;
}

/* Carga jsPDF bajo demanda (solo al pulsar "Descargar PDF") desde cdnjs */
function loadJsPDF() {
  if (typeof window === "undefined") return Promise.reject(new Error("Sin ventana"));
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!window.__jsPDFLoading) {
    window.__jsPDFLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.async = true;
      script.onload = () => resolve(window.jspdf?.jsPDF);
      script.onerror = () => reject(new Error("No se pudo cargar el generador de PDF"));
      document.head.appendChild(script);
    });
  }
  return window.__jsPDFLoading;
}

/* ---------------------------------------------------------
   VISTA: EQUIPO ÍCARA (COCINA / RECOGIDA)
--------------------------------------------------------- */
function CocinaView({ config, saveConfig }) {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(TEAM_SESSION_KEY) || "null");
    } catch {
      return null;
    }
  });
  const authed = !!session;
  const isAdmin = session?.role === "admin";
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [panelTab, setPanelTab] = useState("pedidos"); // 'pedidos' | 'menu'
  const [dateSel, setDateSel] = useState(dateKey(new Date()));
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mode, setMode] = useState("manual"); // 'manual' | 'camera'
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleScanResult = useCallback((text) => {
    stopCamera();
    // formato esperado: ICARA|YYYY-MM-DD|IC-000  (ver ConfirmationView)
    const parts = text.split("|");
    let code = text.trim();
    if (parts.length === 3 && parts[0] === "ICARA") {
      const [, scannedDate, scannedCode] = parts;
      code = scannedCode.trim();
      if (scannedDate && scannedDate !== dateSel) setDateSel(scannedDate);
    }
    setLookup(code);
    setMode("manual");
    setScanStatus("");
  }, [dateSel, stopCamera]);

  const scanLoop = useCallback((jsQR) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(() => scanLoop(jsQR));
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    if (result?.data) {
      handleScanResult(result.data);
    } else {
      rafRef.current = requestAnimationFrame(() => scanLoop(jsQR));
    }
  }, [handleScanResult]);

  const startCamera = useCallback(async () => {
    setScanError("");
    setScanStatus("Cargando lector de códigos…");
    try {
      const jsQR = await loadJsQR();
      setScanStatus("Iniciando cámara…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanStatus("Apunta la cámara al código QR");
      scanLoop(jsQR);
    } catch (e) {
      setScanStatus("");
      setScanError(
        e?.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Usa \"Escribir código\" en su lugar."
          : "No se pudo acceder a la cámara en este dispositivo."
      );
    }
  }, [scanLoop]);

  useEffect(() => {
    if (mode === "camera") startCamera();
    else stopCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const loadOrders = useCallback(async (dKey) => {
    setLoading(true);
    try {
      const rows = await supaRequest(`pedidos?date=eq.${dKey}&select=*&order=created_at.asc`);
      setOrders((rows || []).map(orderFromRow));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) loadOrders(dateSel);
  }, [authed, dateSel, loadOrders]);

  // Si una cuenta sin permiso de "admin" tuviera guardada la pestaña
  // de "menu" (p.ej. de una sesión anterior), la devolvemos a "pedidos".
  useEffect(() => {
    if (authed && !isAdmin && panelTab === "menu") setPanelTab("pedidos");
  }, [authed, isAdmin, panelTab]);

  const toggleStatus = async (order) => {
    const next = order.status === "entregado" ? "pendiente" : "entregado";
    const updated = { ...order, status: next };
    await supaRequest(`pedidos?order_id=eq.${encodeURIComponent(order.orderId)}`, {
      method: "PATCH",
      body: { status: next },
      prefer: "return=minimal",
      token: session?.accessToken,
    });
    setOrders((os) => os.map((o) => (o.orderId === order.orderId ? updated : o)));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const s = await supaTeamLogin(loginEmail.trim(), loginPassword);
      sessionStorage.setItem(TEAM_SESSION_KEY, JSON.stringify(s));
      setSession(s);
      setLoginPassword("");
    } catch (e) {
      setLoginError(e.message || "No se ha podido iniciar sesión");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TEAM_SESSION_KEY);
    setSession(null);
  };

  if (!authed) {
    return (
      <form className="screen narrow center" onSubmit={handleLogin}>
        <h1 className="section-title">Acceso del equipo</h1>
        <p className="hint">Inicia sesión con tu cuenta del equipo Ícara.</p>
        <input
          className="field-input"
          type="email"
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
          placeholder="Email"
          autoComplete="username"
          required
        />
        <input
          className="field-input"
          type="password"
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          placeholder="Contraseña"
          autoComplete="current-password"
          required
        />
        {loginError && <p className="lookup-empty">{loginError}</p>}
        <button className="btn-primary btn-wide" type="submit" disabled={loginLoading}>
          {loginLoading ? <><Loader2 size={16} className="spin" /> Entrando…</> : "Entrar"}
        </button>
      </form>
    );
  }

  const found = orders.find((o) => (o.code || "").toLowerCase() === lookup.trim().toLowerCase());
  const activeOrders = orders.filter((o) => o.status !== "cancelado");
  const totals = {};
  let revenue = 0;
  activeOrders.forEach((o) => {
    revenue += o.total;
    o.items.forEach((i) => {
      if (!totals[i.name]) totals[i.name] = { qty: 0, id: i.id };
      totals[i.name].qty += i.qty;
    });
  });
  const totalItemsCount = Object.values(totals).reduce((s, i) => s + i.qty, 0);

  const downloadPrepPdf = async () => {
    setPdfLoading(true);
    try {
      const jsPDF = await loadJsPDF();
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
      doc.text(`Recogida: ${longDate(new Date(dateSel + "T00:00:00"))}`, marginX, y);
      y += 5.5;
      doc.text(`${activeOrders.length} pedidos · ${totalItemsCount} artículos · ${eur(revenue)}`, marginX, y);
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

      doc.save(`preparacion-icara-${dateSel}.pdf`);
    } catch (e) {
      alert("No se ha podido generar el PDF. Inténtalo de nuevo.");
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="screen">
      <div className="cocina-header">
        <h1 className="section-title">Panel de recogida</h1>
        <button className="link-btn" onClick={handleLogout}>
          {session?.email} · Cerrar sesión
        </button>
      </div>

      <div className="lookup-tabs panel-tabs">
        <button className={panelTab === "pedidos" ? "tab-active" : ""} onClick={() => setPanelTab("pedidos")}>
          Pedidos
        </button>
        {isAdmin && (
          <button className={panelTab === "menu" ? "tab-active" : ""} onClick={() => setPanelTab("menu")}>
            Editar menú
          </button>
        )}
      </div>

      {panelTab === "menu" && isAdmin ? (
        <MenuEditor config={config} saveConfig={saveConfig} token={session?.accessToken} />
      ) : (
      <>
      <div className="cocina-controls">
        <label className="field field-inline">
          <span>Día</span>
          <input type="date" value={dateSel} onChange={(e) => setDateSel(e.target.value)} />
        </label>
        <div className="stat">
          <strong>{activeOrders.length}</strong> pedidos · {eur(revenue)}
          {orders.length !== activeOrders.length && (
            <span className="stat-cancelled"> · {orders.length - activeOrders.length} cancelado{orders.length - activeOrders.length > 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      <div className="lookup-tabs">
        <button className={mode === "manual" ? "tab-active" : ""} onClick={() => setMode("manual")}>
          <Keyboard size={14} /> Escribir código
        </button>
        <button className={mode === "camera" ? "tab-active" : ""} onClick={() => setMode("camera")}>
          <Camera size={14} /> Escanear QR
        </button>
      </div>

      {mode === "manual" ? (
        <div className="lookup-box">
          <Search size={16} />
          <input
            placeholder="Escribe el código que enseña el alumno (ej. IC-004)"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
        </div>
      ) : (
        <div className="scan-box">
          <div className="scan-frame">
            <video ref={videoRef} playsInline muted className="scan-video" />
            <span className="scan-corner tl" /><span className="scan-corner tr" />
            <span className="scan-corner bl" /><span className="scan-corner br" />
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {scanStatus && <div className="hint scan-status">{scanStatus}</div>}
          {scanError && <div className="lookup-empty">{scanError}</div>}
        </div>
      )}
      {lookup && (
        found ? (
          found.status === "cancelado" ? (
            <div className="lookup-cancelled">
              <AlertTriangle size={16} />
              <div>
                <strong>{found.code}</strong> — {found.name} ({found.email})
                <div>Este pedido está <strong>cancelado</strong>. No lo entregues.</div>
              </div>
            </div>
          ) : (
            <div className="lookup-result">
              <div>
                <strong>{found.code}</strong> — {found.name} ({found.email})
                <div className="hint">{found.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
              </div>
              <button className={"btn-secondary" + (found.status === "entregado" ? " btn-done" : "")} onClick={() => toggleStatus(found)}>
                {found.status === "entregado" ? "Entregado ✓" : "Marcar entregado"}
              </button>
            </div>
          )
        ) : (
          <div className="lookup-empty">Ningún pedido con ese código para este día.</div>
        )
      )}

      <div className="prep-header">
        <h2 className="prep-title">Para preparar</h2>
        {activeOrders.length > 0 && (
          <button className="btn-secondary btn-pdf" onClick={downloadPrepPdf} disabled={pdfLoading}>
            {pdfLoading ? <><Loader2 size={14} className="spin" /> Generando…</> : <><FileDown size={14} /> Descargar PDF</>}
          </button>
        )}
      </div>
      {loading ? (
        <div className="hint">Cargando pedidos…</div>
      ) : orders.length === 0 ? (
        <div className="hint">Todavía no hay pedidos para este día.</div>
      ) : (
        <>
          <div className="prep-grid">
            {Object.entries(totals).map(([name, info]) => {
              const ItemIcon = iconFor(info.id, config);
              return (
                <div className="prep-item" key={name}>
                  <span><ItemIcon size={15} strokeWidth={2} /> {name}</span><strong>{info.qty}</strong>
                </div>
              );
            })}
          </div>

          <h2 className="prep-title">Todos los pedidos</h2>
          <div className="order-list">
            {orders.map((o) => {
              const cancelled = o.status === "cancelado";
              return (
                <div className={"order-row" + (o.status === "entregado" ? " order-done" : "") + (cancelled ? " order-cancelled" : "")} key={o.orderId}>
                  <div className="order-row-code">{o.code}</div>
                  <div className="order-row-info">
                    <div>{o.name} · {o.email}</div>
                    <div className="hint">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                  </div>
                  {cancelled ? (
                    <span className="chip-cancelled"><XCircle size={13} /> Cancelado</span>
                  ) : (
                    <button className="chip-btn" onClick={() => toggleStatus(o)}>
                      {o.status === "entregado" ? "Entregado" : "Pendiente"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   EDITOR DE MENÚ — el equipo cambia productos y precios
   sin tocar código. Se guarda todo junto en "menu-config".
--------------------------------------------------------- */
function MenuEditor({ config, saveConfig, token }) {
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  const updateMenuItem = (id, field, value) =>
    setDraft((d) => ({ ...d, menu: d.menu.map((m) => (m.id === id ? { ...m, [field]: value } : m)) }));
  const removeMenuItem = (id) => setDraft((d) => ({ ...d, menu: d.menu.filter((m) => m.id !== id) }));
  const addMenuItem = (cat) =>
    setDraft((d) => ({ ...d, menu: [...d.menu, { id: `${cat}${Date.now()}`, cat, name: "Producto nuevo", price: 0, icon: "wheat" }] }));

  // Helpers genéricos para las listas nuevas: tamaños (con precio),
  // ingredientes/rellenos (sin precio) y salsas (con precio, campo "name").
  const updateListItem = (listKey, itemId, field, value) =>
    setDraft((d) => ({ ...d, [listKey]: d[listKey].map((it) => (it.id === itemId ? { ...it, [field]: value } : it)) }));
  const removeListItem = (listKey, itemId) =>
    setDraft((d) => ({ ...d, [listKey]: d[listKey].filter((it) => it.id !== itemId) }));
  const addSizeItem = (listKey) =>
    setDraft((d) => ({ ...d, [listKey]: [...d[listKey], { id: `size${Date.now()}`, label: "Nuevo tamaño", price: 0, icon: "wheat" }] }));
  const addOptionItem = (listKey) =>
    setDraft((d) => ({ ...d, [listKey]: [...d[listKey], { id: `op${Date.now()}`, label: "Nueva opción", icon: "sandwich" }] }));
  const addSalsaItem = () =>
    setDraft((d) => ({ ...d, salsas: [...d.salsas, { id: `salsa${Date.now()}`, name: "Nueva salsa", price: 0 }] }));

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg("");
    try {
      await saveConfig(draft, token);
      setSavedMsg("Cambios guardados");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setErrorMsg("No se ha podido guardar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(config);

  return (
    <div className="menu-editor">
      <div className="editor-block">
        <div className="editor-block-title">Bocadillos básicos — tamaños y precios</div>
        {draft.bocbasSizes.map((s) => (
          <div className="editor-row" key={s.id}>
            <div className="icon-picker">
              {ICON_KEYS.map((k) => {
                const Ic = ICON_MAP[k];
                return (
                  <button key={k} className={"icon-opt" + (s.icon === k ? " icon-opt-active" : "")} onClick={() => updateListItem("bocbasSizes", s.id, "icon", k)} aria-label={k}>
                    <Ic size={14} />
                  </button>
                );
              })}
            </div>
            <input className="editor-name-input" value={s.label} onChange={(e) => updateListItem("bocbasSizes", s.id, "label", e.target.value)} />
            <input type="number" step="0.10" min="0" className="editor-price-input" value={s.price} onChange={(e) => updateListItem("bocbasSizes", s.id, "price", parseFloat(e.target.value) || 0)} />
            <button className="editor-remove" onClick={() => removeListItem("bocbasSizes", s.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={() => addSizeItem("bocbasSizes")}><Plus size={13} /> Añadir tamaño</button>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Bocadillos básicos — ingredientes</div>
        {draft.bocbasIngredients.map((it) => (
          <div className="editor-row" key={it.id}>
            <div className="icon-picker">
              {ICON_KEYS.map((k) => {
                const Ic = ICON_MAP[k];
                return (
                  <button key={k} className={"icon-opt" + (it.icon === k ? " icon-opt-active" : "")} onClick={() => updateListItem("bocbasIngredients", it.id, "icon", k)} aria-label={k}>
                    <Ic size={14} />
                  </button>
                );
              })}
            </div>
            <input className="editor-name-input" value={it.label} onChange={(e) => updateListItem("bocbasIngredients", it.id, "label", e.target.value)} />
            <button className="editor-remove" onClick={() => removeListItem("bocbasIngredients", it.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={() => addOptionItem("bocbasIngredients")}><Plus size={13} /> Añadir ingrediente</button>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Bocadillos Ícara — tamaños y precios</div>
        {draft.icaraSizes.map((s) => (
          <div className="editor-row" key={s.id}>
            <div className="icon-picker">
              {ICON_KEYS.map((k) => {
                const Ic = ICON_MAP[k];
                return (
                  <button key={k} className={"icon-opt" + (s.icon === k ? " icon-opt-active" : "")} onClick={() => updateListItem("icaraSizes", s.id, "icon", k)} aria-label={k}>
                    <Ic size={14} />
                  </button>
                );
              })}
            </div>
            <input className="editor-name-input" value={s.label} onChange={(e) => updateListItem("icaraSizes", s.id, "label", e.target.value)} />
            <input type="number" step="0.10" min="0" className="editor-price-input" value={s.price} onChange={(e) => updateListItem("icaraSizes", s.id, "price", parseFloat(e.target.value) || 0)} />
            <button className="editor-remove" onClick={() => removeListItem("icaraSizes", s.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={() => addSizeItem("icaraSizes")}><Plus size={13} /> Añadir tamaño</button>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Bocadillos Ícara — rellenos</div>
        {draft.icaraRellenos.map((it) => (
          <div className="editor-row" key={it.id}>
            <div className="icon-picker">
              {ICON_KEYS.map((k) => {
                const Ic = ICON_MAP[k];
                return (
                  <button key={k} className={"icon-opt" + (it.icon === k ? " icon-opt-active" : "")} onClick={() => updateListItem("icaraRellenos", it.id, "icon", k)} aria-label={k}>
                    <Ic size={14} />
                  </button>
                );
              })}
            </div>
            <input className="editor-name-input" value={it.label} onChange={(e) => updateListItem("icaraRellenos", it.id, "label", e.target.value)} />
            <button className="editor-remove" onClick={() => removeListItem("icaraRellenos", it.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={() => addOptionItem("icaraRellenos")}><Plus size={13} /> Añadir relleno</button>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Salsas</div>
        {draft.salsas.map((s) => (
          <div className="editor-row" key={s.id}>
            <input className="editor-name-input" value={s.name} onChange={(e) => updateListItem("salsas", s.id, "name", e.target.value)} />
            <input type="number" step="0.05" min="0" className="editor-price-input" value={s.price} onChange={(e) => updateListItem("salsas", s.id, "price", parseFloat(e.target.value) || 0)} />
            <button className="editor-remove" onClick={() => removeListItem("salsas", s.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={addSalsaItem}><Plus size={13} /> Añadir salsa</button>
      </div>

      {["bebida"].map((cat) => (
        <div className="editor-block" key={cat}>
          <div className="editor-block-title">Bebidas</div>
          {draft.menu.filter((m) => m.cat === cat).map((m) => (
            <div className="editor-row" key={m.id}>
              <div className="icon-picker">
                {ICON_KEYS.map((k) => {
                  const Ic = ICON_MAP[k];
                  return (
                    <button key={k} className={"icon-opt" + (m.icon === k ? " icon-opt-active" : "")} onClick={() => updateMenuItem(m.id, "icon", k)} aria-label={k}>
                      <Ic size={14} />
                    </button>
                  );
                })}
              </div>
              <input className="editor-name-input" value={m.name} onChange={(e) => updateMenuItem(m.id, "name", e.target.value)} />
              <input type="number" step="0.10" min="0" className="editor-price-input" value={m.price} onChange={(e) => updateMenuItem(m.id, "price", parseFloat(e.target.value) || 0)} />
              <button className="editor-remove" onClick={() => removeMenuItem(m.id)} aria-label="Eliminar"><XCircle size={16} /></button>
            </div>
          ))}
          <button className="pan-new-link" onClick={() => addMenuItem(cat)}><Plus size={13} /> Añadir producto</button>
        </div>
      ))}

      <div className="editor-save-bar">
        {savedMsg && <span className="editor-saved"><Check size={14} /> {savedMsg}</span>}
        {errorMsg && <span className="editor-error">{errorMsg}</span>}
        <button className="btn-secondary" onClick={handleDiscard} disabled={!isDirty || saving}>Descartar cambios</button>
        <button className="btn-primary" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? <><Loader2 size={14} className="spin" /> Guardando…</> : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   ESTILO — paleta y tipografía inspiradas en centroicara.es
   (salmón de marca, gris del icono, azul de los enlaces activos)
--------------------------------------------------------- */
const rootStyle = {
  "--salmon": "#F2938C",
  "--salmon-deep": "#E8776D",
  "--salmon-soft": "#FBEAE8",
  "--ink": "#2B2B2E",
  "--paper": "#FFFFFF",
  "--mist": "#9CA3AF",
  "--iris": "#5B6EE0",
  "--cream": "#FBF7F5",
  "--line": "#F0DAD7",
  background: "var(--cream)",
  minHeight: "100vh",
  overflowX: "hidden",
  fontFamily: "'Poppins', sans-serif",
  color: "var(--ink)",
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Poppins:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 20px;border-bottom:1px solid var(--line);background:var(--paper);}
.brand{display:flex;align-items:center;}
.brand-logo{height:68px;width:auto;display:block;}
.link-btn{background:none;border:1px solid var(--line);color:var(--iris);font-size:12px;padding:7px 12px;border-radius:100px;cursor:pointer;font-weight:600;}
.link-btn:hover{border-color:var(--iris);}
.topbar-links{display:flex;align-items:center;gap:8px;}

.site-footer{margin-top:24px;padding:18px 20px;background:#f6a99b;color:#fff;text-align:center;font-size:14px;font-weight:600;}
.link-inline{background:none;border:none;padding:0;color:var(--iris);font-weight:600;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:inherit;}
.privacy-check{display:flex;align-items:flex-start;gap:8px;margin:14px 0;font-size:13px;color:var(--mist);line-height:1.4;cursor:pointer;}
.privacy-check input{margin-top:2px;flex-shrink:0;}
.privacy-text h2{font-size:15px;margin:20px 0 6px;color:var(--ink);}
.privacy-text p{font-size:13.5px;line-height:1.6;color:var(--mist);margin:0 0 10px;}
.privacy-text ul{margin:0 0 10px;padding-left:20px;}
.privacy-text li{font-size:13.5px;line-height:1.6;color:var(--mist);margin-bottom:4px;}

.screen{max-width:760px;margin:0 auto;padding:24px 18px 100px;}
.screen.narrow{max-width:440px;}
.screen.center{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:48px;}

.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:28px;}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--iris);font-weight:700;margin-bottom:4px;}
.hero-text h1{font-family:'Baloo 2',cursive;font-weight:700;font-size:30px;margin:0 0 8px;text-transform:capitalize;color:var(--ink);}
.hero-text p{font-size:14px;color:var(--mist);max-width:440px;margin:0;line-height:1.5;}
.countdown{display:flex;align-items:center;gap:6px;background:var(--salmon-soft);border:1px solid var(--line);padding:8px 14px;border-radius:100px;font-size:13px;color:var(--salmon-deep);font-weight:600;white-space:nowrap;}

.truck-scene{margin-top:14px;max-width:220px;cursor:pointer;}
.truck-svg{width:100%;height:auto;display:block;overflow:visible;}
.truck-group{animation:truckEnter 2.6s cubic-bezier(.22,1,.36,1) both;transform-box:fill-box;transform-origin:center;}
.truck-wheel{fill:var(--ink);animation:wheelEnter 2.6s ease-out both;transform-box:fill-box;transform-origin:center;}
.truck-hub{fill:var(--paper);}
.truck-roof{fill:#A9D9C4;}
.truck-band{fill:var(--paper);stroke:var(--line);stroke-width:1;}
.truck-bumper{fill:#D8D3C9;}
.truck-awning{fill:var(--paper);}
.truck-hatch{fill:#2E3A3A;stroke:#A9D9C4;stroke-width:1.4;animation:hatchGlow 1s ease 2.6s both;}
.truck-cab-window{fill:#2E3A3A;stroke:#A9D9C4;stroke-width:1.1;}
.truck-door{stroke:#7FBBA3;stroke-width:1;}
.truck-headlight{fill:var(--paper);stroke:var(--mist);stroke-width:.6;}
.truck-shadow{fill:rgba(43,43,46,.15);animation:shadowGrow 2.6s ease both;}
.truck-motion-lines{animation:linesFade 2.6s ease both;}
.truck-motion-lines line{stroke:var(--mist);stroke-width:2;stroke-linecap:round;}
.truck-puff{fill:var(--mist);opacity:0;animation:puffPop .7s ease 2.3s both;}
.truck-delivery{opacity:0;transform-box:fill-box;transform-origin:center;animation:deliveryPop .9s cubic-bezier(.3,1.4,.4,1) 2.7s both;}
.delivery-bag{fill:var(--salmon-deep);}
.delivery-fold{fill:var(--salmon);}
.delivery-pastry{fill:#E8C28A;stroke:var(--paper);stroke-width:1;}
.sparkle{fill:#F2C9A0;opacity:0;transform-box:fill-box;transform-origin:center;}
.sparkle-a{animation:sparklePop .6s ease 3s both;}
.sparkle-b{animation:sparklePop .6s ease 3.15s both;}
.sparkle-c{animation:sparklePop .6s ease 3.3s both;}

/* Al pasar el ratón: arranca y circula muy despacio, sin moverse de su sitio */
@media (hover: hover) and (pointer: fine) {
  .truck-scene:hover .truck-group{animation:truckIdleDrive 4s ease-in-out infinite;}
  .truck-scene:hover .truck-wheel{animation:wheelIdleSpin 2.6s linear infinite;}
  .truck-scene:hover .truck-motion-lines{animation:linesIdleLoop 4s ease-in-out infinite;}
}

@keyframes truckEnter{
  0%{transform:translateX(-70vw);}
  100%{transform:translateX(0);}
}
@keyframes wheelEnter{from{transform:rotate(0deg);}to{transform:rotate(900deg);}}
@keyframes shadowGrow{0%{opacity:0;transform:scaleX(.25);}100%{opacity:1;transform:scaleX(1);}}
@keyframes linesFade{0%{opacity:0;}10%{opacity:.7;}30%{opacity:0;}100%{opacity:0;}}
@keyframes puffPop{0%{opacity:0;transform:scale(.2);}45%{opacity:.5;}100%{opacity:0;transform:scale(1.7);}}
@keyframes hatchGlow{0%{fill:#2E3A3A;}45%{fill:#F2C9A0;}100%{fill:#2E3A3A;}}
@keyframes deliveryPop{0%{opacity:0;transform:translateY(6px) scale(.3);}60%{opacity:1;transform:translateY(-9px) scale(1.08);}80%{transform:translateY(-5px) scale(.96);}100%{opacity:1;transform:translateY(-7px) scale(1);}}
@keyframes sparklePop{0%{opacity:0;transform:scale(.2);}55%{opacity:1;transform:scale(1.3);}100%{opacity:0;transform:scale(.6);}}

@keyframes truckIdleDrive{0%{transform:translateX(0);}50%{transform:translateX(14px);}100%{transform:translateX(0);}}
@keyframes wheelIdleSpin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@keyframes linesIdleLoop{0%{opacity:0;}20%{opacity:.5;}55%{opacity:0;}100%{opacity:0;}}


.cat-block{margin-bottom:30px;}
.cat-block h2{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;margin:0;color:var(--iris);}

.salsas-block{margin-top:-14px;}
.salsas-title{margin-bottom:10px;}
.salsas-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}
.card-salsa{padding:12px 14px;}

.cat-banner{position:relative;border-radius:14px;overflow:hidden;margin-bottom:12px;height:96px;}
.cat-banner-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.cat-banner h2{position:absolute;left:0;right:0;bottom:0;padding:10px 14px;margin:0;color:#fff;background:linear-gradient(0deg, rgba(0,0,0,.62), rgba(0,0,0,0));}
.cat-banner h2 svg{color:#fff;}

.pan-builder{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px;}
.builder-step{margin-bottom:16px;}
.builder-label{font-size:12px;font-weight:700;color:var(--mist);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;}
.bread-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;}
.bread-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);cursor:pointer;font-weight:600;font-size:13px;color:var(--ink);text-align:left;}
.bread-opt-top{display:flex;align-items:center;gap:7px;}
.bread-opt-active{border-color:var(--salmon-deep);background:var(--salmon-soft);}
.bread-opt-active svg{color:var(--salmon-deep);}
.bread-extra{font-family:'Space Mono',monospace;font-size:11px;color:var(--mist);font-weight:400;margin-left:24px;}
.extras-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}
.extra-opt{display:flex;justify-content:flex-start;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);cursor:pointer;font-weight:600;font-size:13px;color:var(--ink);}
.extra-opt-active{border-color:var(--iris);background:rgba(91,110,224,.06);color:var(--iris);}
.extra-price{font-family:'Space Mono',monospace;font-size:11.5px;color:var(--mist);}
.extra-opt-active .extra-price{color:var(--iris);}
.builder-live{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--iris);background:rgba(91,110,224,.07);border-radius:10px;padding:9px 12px;margin-top:4px;}
.builder-live svg{flex-shrink:0;}
.pan-added-list{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px;}
.pan-added-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;}
.pan-added-name{flex:1;}
.pan-new-link{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;background:none;border:none;color:var(--salmon-deep);font-size:12.5px;font-weight:700;cursor:pointer;padding:4px 0;margin-top:2px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px;transition:border-color .15s;}
.card-active{border-color:var(--salmon-deep);box-shadow:0 0 0 2px rgba(232,119,109,.18);}
.card-icon{width:36px;height:36px;border-radius:10px;background:var(--salmon-soft);color:var(--salmon-deep);display:flex;align-items:center;justify-content:center;margin-bottom:10px;}
.card-active .card-icon{background:var(--salmon-deep);color:var(--paper);}
.card-top{display:flex;justify-content:space-between;gap:8px;font-weight:600;font-size:14.5px;}
.card-price{font-family:'Space Mono',monospace;color:var(--mist);white-space:nowrap;}
.card-desc{font-size:12px;color:var(--mist);margin-top:4px;line-height:1.4;}
.stepper{display:flex;align-items:center;gap:12px;margin-top:12px;}
.stepper button{width:28px;height:28px;border-radius:50%;border:1px solid var(--ink);background:var(--paper);display:flex;align-items:center;justify-content:center;cursor:pointer;}
.stepper button:disabled{opacity:.3;cursor:default;}
.stepper button:not(:disabled):hover{background:var(--salmon-deep);border-color:var(--salmon-deep);color:var(--paper);}
.stepper span{font-family:'Space Mono',monospace;font-weight:700;min-width:16px;text-align:center;}

.cart-bar{position:fixed;left:0;right:0;bottom:0;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:space-between;padding:14px 20px;max-width:760px;margin:0 auto;border-radius:14px 14px 0 0;}
.btn-primary{background:var(--salmon-deep);color:var(--paper);border:none;padding:11px 18px;border-radius:100px;font-weight:700;font-size:14px;display:inline-flex;align-items:center;gap:7px;cursor:pointer;}
.btn-primary:disabled{opacity:.45;cursor:default;}
.btn-primary:not(:disabled):hover{filter:brightness(1.06);}
.btn-wide{width:100%;justify-content:center;padding:13px;}
.btn-secondary{background:none;border:1.5px solid var(--ink);color:var(--ink);padding:10px 18px;border-radius:100px;font-weight:600;font-size:13px;cursor:pointer;}
.btn-secondary.btn-done{background:var(--iris);border-color:var(--iris);color:var(--paper);}

.back-btn{display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:var(--iris);font-size:13px;cursor:pointer;padding:0;margin-bottom:18px;font-weight:600;}
.section-title{font-family:'Baloo 2',cursive;font-weight:700;font-size:23px;margin:0 0 16px;color:var(--ink);}
.summary-box{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:18px;}
.summary-row{display:flex;justify-content:space-between;font-size:13.5px;padding:5px 0;}
.summary-row-name{display:inline-flex;align-items:center;gap:6px;}
.summary-row-name svg{color:var(--mist);flex-shrink:0;}
.summary-total{border-top:1px dashed var(--line);margin-top:6px;padding-top:10px;font-weight:700;font-family:'Space Mono',monospace;}
.field{display:block;margin-bottom:14px;}
.field span{display:block;font-size:12px;font-weight:600;color:var(--mist);margin-bottom:5px;}
.field input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit;background:var(--paper);color:var(--ink);}
.field input:focus{outline:2px solid var(--iris);outline-offset:1px;}
.field-error{font-size:11.5px;color:var(--salmon-deep);margin-top:5px;font-weight:600;}
.field-inline{display:flex;align-items:center;gap:8px;margin:0;}
.field-inline span{margin:0;}
.field-inline input{width:auto;padding:6px 10px;}

.pay-methods{display:flex;gap:10px;margin:6px 0 4px;}
.pay-opt{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);cursor:pointer;font-weight:600;font-size:13.5px;color:var(--mist);}
.pay-opt-active{border-color:var(--iris);color:var(--iris);background:rgba(91,110,224,.06);}
.hint{font-size:12px;color:var(--mist);margin:6px 0 16px;}
.spin{animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}

.ticket-check{width:40px;height:40px;border-radius:50%;background:var(--salmon-deep);color:var(--paper);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;}
.ticket-label{text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mist);font-weight:700;}
.ticket-code{text-align:center;font-family:'Space Mono',monospace;font-weight:700;font-size:38px;color:var(--ink);margin:4px 0 14px;}
.ticket-qr{display:block;margin:0 auto 16px;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--paper);}
.ticket-dashes{border-top:2px dashed var(--line);margin:0 -24px 14px;}
.ticket-meta{font-size:12.5px;color:var(--mist);margin-bottom:10px;line-height:1.6;}
.ticket-items{list-style:none;padding:0;margin:0 0 12px;font-size:13.5px;line-height:1.8;}
.ticket-items li{display:flex;align-items:center;gap:7px;}
.ticket-items svg{color:var(--mist);flex-shrink:0;}
.ticket-total{font-weight:700;font-family:'Space Mono',monospace;font-size:14px;border-top:1px solid var(--line);padding-top:10px;}
.confirm-note{font-size:13px;color:var(--mist);max-width:360px;margin:20px 0;line-height:1.6;}
.cancel-link{background:none;border:none;color:var(--mist);font-size:12.5px;font-weight:600;text-decoration:underline;cursor:pointer;margin-bottom:14px;}
.cancel-link:hover{color:var(--salmon-deep);}
.cancel-confirm{display:flex;flex-direction:column;align-items:center;gap:10px;background:var(--salmon-soft);border-radius:12px;padding:14px 16px;margin-bottom:14px;font-size:13px;color:var(--ink);max-width:360px;}
.cancel-confirm span{display:flex;align-items:center;gap:6px;}
.cancel-confirm svg{color:var(--salmon-deep);flex-shrink:0;}
.cancel-confirm-actions{display:flex;gap:10px;}
.btn-danger{background:var(--salmon-deep);color:var(--paper);border:none;padding:9px 16px;border-radius:100px;font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
.btn-danger:disabled{opacity:.6;cursor:default;}
.cancelled-box{display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:30px 24px;margin-bottom:18px;color:var(--mist);max-width:360px;}
.cancelled-box svg{color:var(--salmon-deep);margin-bottom:6px;}
.cancelled-title{font-family:'Baloo 2',cursive;font-weight:700;font-size:20px;color:var(--ink);}
.cancelled-code{font-family:'Space Mono',monospace;font-weight:700;font-size:19px;color:var(--mist);text-decoration:line-through;margin:4px 0 10px;}
.email-note{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--ink);background:var(--salmon-soft);border-radius:10px;padding:10px 14px;margin-top:18px;}
.email-note svg{color:var(--salmon-deep);flex-shrink:0;}
.badge-demo{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--mist);border:1px solid var(--line);border-radius:100px;padding:2px 7px;font-weight:700;}

.field-input{width:100%;max-width:280px;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit;background:var(--paper);color:var(--ink);margin:6px 0;}
.field-input:focus{outline:2px solid var(--iris);outline-offset:1px;}
.cocina-header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.cocina-header .section-title{margin-bottom:0;}
.cocina-controls{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px;}
.stat{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;}
.stat-cancelled{font-family:'Poppins',sans-serif;font-weight:600;color:var(--salmon-deep);font-size:12px;}
.lookup-cancelled{display:flex;align-items:flex-start;gap:8px;background:var(--salmon-soft);border:1px solid var(--salmon-deep);border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13.5px;color:var(--ink);}
.lookup-cancelled svg{color:var(--salmon-deep);flex-shrink:0;margin-top:2px;}
.lookup-box{display:flex;align-items:center;gap:8px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;color:var(--mist);}
.lookup-box input{flex:1;border:none;background:none;font-size:14px;font-family:inherit;color:var(--ink);}
.lookup-box input:focus{outline:none;}
.lookup-tabs{display:flex;gap:8px;margin-bottom:10px;}
.lookup-tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--mist);font-weight:600;font-size:12.5px;cursor:pointer;}
.lookup-tabs button.tab-active{border-color:var(--iris);color:var(--iris);background:rgba(91,110,224,.06);}
.scan-box{margin-bottom:8px;}
.scan-frame{position:relative;width:100%;max-width:300px;aspect-ratio:1;margin:0 auto;border-radius:16px;overflow:hidden;background:var(--ink);}
.scan-video{width:100%;height:100%;object-fit:cover;}
.scan-corner{position:absolute;width:26px;height:26px;border-color:var(--salmon);}
.scan-corner.tl{top:10px;left:10px;border-top:3px solid;border-left:3px solid;border-radius:6px 0 0 0;}
.scan-corner.tr{top:10px;right:10px;border-top:3px solid;border-right:3px solid;border-radius:0 6px 0 0;}
.scan-corner.bl{bottom:10px;left:10px;border-bottom:3px solid;border-left:3px solid;border-radius:0 0 0 6px;}
.scan-corner.br{bottom:10px;right:10px;border-bottom:3px solid;border-right:3px solid;border-radius:0 0 6px 0;}
.scan-status{text-align:center;}
.lookup-result{display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(91,110,224,.07);border:1px solid var(--iris);border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13.5px;}
.lookup-empty{font-size:13px;color:var(--salmon-deep);margin-bottom:18px;}
.prep-title{font-size:15px;font-weight:700;color:var(--iris);margin:22px 0 10px;}
.prep-header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.prep-header .prep-title{margin:22px 0 10px;}
.btn-pdf{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;font-size:12px;}
.prep-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}
.prep-item{display:flex;justify-content:space-between;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:13px;}
.prep-item span{display:inline-flex;align-items:center;gap:7px;}
.prep-item svg{color:var(--iris);flex-shrink:0;}
.prep-item strong{font-family:'Space Mono',monospace;}
.order-list{display:flex;flex-direction:column;gap:8px;}
.order-row{display:flex;align-items:center;gap:12px;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px 12px;}
.order-done{opacity:.55;}
.order-cancelled{opacity:.6;background:var(--salmon-soft);}
.chip-cancelled{display:inline-flex;align-items:center;gap:4px;color:var(--salmon-deep);font-size:12px;font-weight:700;white-space:nowrap;}
.order-row-code{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;background:var(--salmon-soft);color:var(--salmon-deep);border-radius:6px;padding:4px 8px;}
.order-row-info{flex:1;font-size:13px;}
.chip-btn{border:1px solid var(--line);background:none;border-radius:100px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;color:var(--mist);}
.order-done .chip-btn{border-color:var(--iris);color:var(--iris);}

.panel-tabs{margin-bottom:22px;}
.menu-editor{display:flex;flex-direction:column;gap:22px;padding-bottom:90px;}
.editor-block{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px;}
.editor-block-title{font-size:13px;font-weight:700;color:var(--iris);text-transform:uppercase;letter-spacing:.03em;margin-bottom:12px;}
.editor-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;}
.editor-name-input{flex:1;min-width:140px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;background:var(--cream);color:var(--ink);}
.editor-price-input{width:76px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:'Space Mono',monospace;background:var(--cream);color:var(--ink);}
.editor-remove{background:none;border:none;color:var(--mist);cursor:pointer;display:flex;align-items:center;padding:4px;flex-shrink:0;}
.editor-remove:hover{color:var(--salmon-deep);}
.icon-picker{display:flex;flex-wrap:wrap;gap:3px;max-width:150px;}
.icon-opt{width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--cream);color:var(--mist);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
.icon-opt-active{border-color:var(--salmon-deep);background:var(--salmon-soft);color:var(--salmon-deep);}
.editor-save-bar{position:sticky;bottom:16px;display:flex;align-items:center;justify-content:flex-end;gap:10px;background:var(--paper);border:1px solid var(--line);border-radius:100px;padding:10px 14px;box-shadow:0 8px 24px -10px rgba(43,43,46,.25);flex-wrap:wrap;}
.editor-saved{display:flex;align-items:center;gap:5px;color:var(--iris);font-size:12.5px;font-weight:700;margin-right:auto;}
.editor-error{color:var(--salmon-deep);font-size:12.5px;font-weight:700;margin-right:auto;}

@media (max-width:480px){
  .hero-text h1{font-size:25px;}
  .ticket-code{font-size:30px;}
  .brand-logo{height:52px;}
}
`;
