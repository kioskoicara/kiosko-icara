import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Wheat, Croissant, Coffee, ShoppingBag, Clock, Check, ArrowLeft,
  Plus, Minus, Search, Loader2, CreditCard, Smartphone, Mail,
  Sandwich, Cookie, CupSoda, Milk, Droplet, Camera, Keyboard, FileDown,
  Sprout, Leaf, XCircle, AlertTriangle,
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
});
const configToRow = (config) => ({
  base_tostada: config.baseTostada,
  bread_types: config.breadTypes,
  extras: config.extras,
  menu: config.menu,
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
const ICON_MAP = { wheat: Wheat, croissant: Croissant, cookie: Cookie, sandwich: Sandwich, cupsoda: CupSoda, milk: Milk, coffee: Coffee, droplet: Droplet, sprout: Sprout, leaf: Leaf };
const ICON_KEYS = Object.keys(ICON_MAP);
const resolveIcon = (key) => ICON_MAP[key] || Wheat;

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
};

const CATS = {
  bebida: { label: "Bebidas", icon: Coffee },
};

// Tamaños de "Bocadillos básicos" — el precio depende solo del
// tamaño/tipo de pan, nunca de los ingredientes.
const BASICO_SIZES = [
  { id: "peq", label: "Pequeño", price: 1.40 },
  { id: "peq-integral", label: "Pequeño integral", price: 1.50 },
  { id: "grande", label: "Grande", price: 2.00 },
  { id: "grande-integral", label: "Grande integral", price: 2.10 },
];
const BASICO_INGREDIENTS = [
  { id: "jamon-cocido", label: "Jamón cocido" },
  { id: "salchichon", label: "Salchichón" },
  { id: "queso", label: "Queso" },
  { id: "pate", label: "Paté" },
  { id: "zurrapa-lomo", label: "Zurrapa de lomo" },
  { id: "mantequilla-mermelada", label: "Mantequilla y mermelada" },
  { id: "chopped", label: "Chopped" },
  { id: "pavo", label: "Pavo" },
];

// Tamaños de "Bocadillos Ícara" — mismos panes/tamaños que los
// básicos, pero con precio distinto, y un único relleno a elegir.
const ICARA_SIZES = [
  { id: "peq", label: "Pequeño", price: 1.70 },
  { id: "peq-integral", label: "Pequeño integral", price: 1.80 },
  { id: "grande", label: "Grande", price: 2.30 },
  { id: "grande-integral", label: "Grande integral", price: 2.40 },
];
const ICARA_RELLENOS = [
  { id: "tortilla", label: "Tortilla" },
  { id: "jamon-serrano", label: "Jamón serrano" },
  { id: "mixto", label: "Mixto (York y queso)" },
];

// Mini apartado de salsas, compartido por los dos bloques de
// bocadillos — se pueden pedir las dos a la vez.
const SALSAS = [
  { id: "salsa-mayonesa", name: "Mayonesa", price: 0.1 },
  { id: "salsa-ketchup", name: "Ketchup", price: 0.1 },
];


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
const CAT_IMG_BEBIDA = "data:image/jpeg;base64,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";
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
          sizeOptions={BASICO_SIZES}
          ingredientOptions={BASICO_INGREDIENTS}
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
          sizeOptions={ICARA_SIZES}
          ingredientOptions={ICARA_RELLENOS}
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
          {SALSAS.map((s) => {
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
    ? `${itemLabel} ${sizeObj.label.toLowerCase()}` +
      (ingredientObjs.length ? ` ${joinWord} ${ingredientObjs.map((i) => i.label.toLowerCase()).join(", ")}` : "")
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
          {sizeOptions.map((s) => (
            <button
              key={s.id}
              className={"bread-opt" + (sizeId === s.id ? " bread-opt-active" : "")}
              onClick={() => setSizeId(s.id)}
            >
              <span className="bread-opt-top">
                <Wheat size={17} strokeWidth={2} />
                <span>{s.label}</span>
              </span>
              <span className="bread-extra">{eur(s.price)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="builder-step">
        <div className="builder-label">{ingredientStepLabel}</div>
        <div className="extras-options">
          {ingredientOptions.map((ing) => (
            <button
              key={ing.id}
              className={"extra-opt" + (ingredients.includes(ing.id) ? " extra-opt-active" : "")}
              onClick={() => toggleIngredient(ing.id)}
            >
              <span>{ing.label}</span>
            </button>
          ))}
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

  const found = orders.find((o) => o.code.toLowerCase() === lookup.trim().toLowerCase());
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
      <p className="hint" style={{ marginBottom: 4 }}>
        Los precios de los bocadillos (básicos e Ícara) están fijados en el código,
        no se editan desde aquí — dile a quien lleve la web si hay que cambiarlos.
      </p>

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

.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--paper);}
.brand{display:flex;align-items:center;}
.brand-logo{height:46px;width:auto;display:block;}
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
.extra-opt{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);cursor:pointer;font-weight:600;font-size:13px;color:var(--ink);}
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
}
`;
