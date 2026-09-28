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
    { id: "b1", cat: "bebida", name: "Zumo de naranja natural", price: 1.5, icon: "cupsoda" },
    { id: "b2", cat: "bebida", name: "Batido de cacao", price: 1.3, icon: "milk" },
    { id: "b3", cat: "bebida", name: "Café con leche", price: 1.2, icon: "coffee" },
    { id: "b4", cat: "bebida", name: "Cola Cao", price: 1.0, icon: "milk" },
    { id: "b5", cat: "bebida", name: "Agua", price: 0.8, icon: "droplet" },
  ],
};

const CATS = {
  dulce: { label: "Bollería y dulces", icon: Croissant },
  bebida: { label: "Para beber", icon: Coffee },
};


/* ---------------------------------------------------------
   UTILIDADES
--------------------------------------------------------- */
const eur = (n) => n.toFixed(2).replace(".", ",") + " €";
const iconFor = (id, config) => {
  const menuItem = config?.menu?.find((m) => m.id === id);
  if (menuItem) return resolveIcon(menuItem.icon);
  if (id.startsWith("pan-")) return Sandwich;
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
const CAT_IMG_BOLLERIA = "data:image/jpeg;base64,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";
const CAT_IMG_BEBIDA = "data:image/jpeg;base64,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";
const CAT_IMAGES = { dulce: CAT_IMG_BOLLERIA, bebida: CAT_IMG_BEBIDA };
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
          <h2><Wheat size={18} strokeWidth={2.2} /> Pan y tostadas</h2>
        </div>
        <PanBuilder cart={cart} addItem={addItem} breadTypes={config.breadTypes} extras={config.extras} baseTostada={config.baseTostada} />
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
function PanBuilder({ cart, addItem, breadTypes, extras: extrasCatalog, baseTostada }) {
  const [bread, setBread] = useState(null);
  const [extras, setExtras] = useState([]);
  const draftIdRef = useRef(null);

  const breadObj = bread ? breadTypes.find((b) => b.id === bread) : null;
  const extrasObjs = extrasCatalog.filter((e) => extras.includes(e.id));
  const price = breadObj
    ? baseTostada + breadObj.extra + extrasObjs.reduce((s, e) => s + e.price, 0)
    : 0;
  const name = breadObj
    ? `Tostada de ${breadObj.name.replace("Pan de ", "").replace("Pan ", "")}` +
      (extrasObjs.length ? ` con ${extrasObjs.map((e) => e.name.toLowerCase()).join(", ")}` : "")
    : "";
  const entryId = breadObj ? `pan-${bread}-${[...extras].sort().join(".")}` : null;

  // Se añade (o actualiza) sola en el pedido en cuanto cambia la selección — sin botón.
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

  const toggleExtra = (id) =>
    setExtras((ex) => (ex.includes(id) ? ex.filter((x) => x !== id) : [...ex, id]));

  const startAnother = () => {
    draftIdRef.current = null;
    setBread(null);
    setExtras([]);
  };

  const panItems = Object.values(cart).filter((i) => i.id.startsWith("pan-"));

  return (
    <div className="pan-builder">
      <div className="builder-step">
        <div className="builder-label">1. Elige el pan</div>
        <div className="bread-options">
          {breadTypes.map((b) => {
            const BreadIcon = resolveIcon(b.icon);
            return (
              <button
                key={b.id}
                className={"bread-opt" + (bread === b.id ? " bread-opt-active" : "")}
                onClick={() => setBread(b.id)}
              >
                <span className="bread-opt-top">
                  <BreadIcon size={17} strokeWidth={2} />
                  <span>{b.name}</span>
                </span>
                {b.extra > 0 && <span className="bread-extra">+{eur(b.extra)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="builder-step">
        <div className="builder-label">2. Añade ingredientes</div>
        <div className="extras-options">
          {extrasCatalog.map((e) => (
            <button
              key={e.id}
              className={"extra-opt" + (extras.includes(e.id) ? " extra-opt-active" : "")}
              onClick={() => toggleExtra(e.id)}
            >
              <span>{e.name}</span>
              <span className="extra-price">+{eur(e.price)}</span>
            </button>
          ))}
        </div>
      </div>

      {breadObj && (
        <div className="builder-live">
          <Check size={14} strokeWidth={2.5} /> Añadido: <strong>{name}</strong> · {eur(price)}
        </div>
      )}

      {panItems.length > 0 && (
        <div className="pan-added-list">
          {panItems.map((i) => (
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
            <Plus size={13} /> Pedir otra tostada distinta
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

  const updateBread = (id, field, value) =>
    setDraft((d) => ({ ...d, breadTypes: d.breadTypes.map((b) => (b.id === id ? { ...b, [field]: value } : b)) }));
  const removeBread = (id) => setDraft((d) => ({ ...d, breadTypes: d.breadTypes.filter((b) => b.id !== id) }));
  const addBread = () =>
    setDraft((d) => ({ ...d, breadTypes: [...d.breadTypes, { id: `pan${Date.now()}`, name: "Nuevo pan", extra: 0, icon: "wheat" }] }));

  const updateExtra = (id, field, value) =>
    setDraft((d) => ({ ...d, extras: d.extras.map((e) => (e.id === id ? { ...e, [field]: value } : e)) }));
  const removeExtra = (id) => setDraft((d) => ({ ...d, extras: d.extras.filter((e) => e.id !== id) }));
  const addExtra = () =>
    setDraft((d) => ({ ...d, extras: [...d.extras, { id: `extra${Date.now()}`, name: "Nuevo ingrediente", price: 0 }] }));

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
      <div className="editor-block">
        <div className="editor-block-title">Precio base de la tostada</div>
        <div className="editor-row">
          <input
            type="number" step="0.10" min="0" className="editor-price-input"
            value={draft.baseTostada}
            onChange={(e) => setDraft((d) => ({ ...d, baseTostada: parseFloat(e.target.value) || 0 }))}
          />
          <span className="hint">€ — precio del pan solo, sin ingredientes</span>
        </div>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Panes</div>
        {draft.breadTypes.map((b) => (
          <div className="editor-row" key={b.id}>
            <div className="icon-picker">
              {ICON_KEYS.map((k) => {
                const Ic = ICON_MAP[k];
                return (
                  <button key={k} className={"icon-opt" + (b.icon === k ? " icon-opt-active" : "")} onClick={() => updateBread(b.id, "icon", k)} aria-label={k}>
                    <Ic size={14} />
                  </button>
                );
              })}
            </div>
            <input className="editor-name-input" value={b.name} onChange={(e) => updateBread(b.id, "name", e.target.value)} />
            <input type="number" step="0.10" min="0" className="editor-price-input" value={b.extra} onChange={(e) => updateBread(b.id, "extra", parseFloat(e.target.value) || 0)} />
            <button className="editor-remove" onClick={() => removeBread(b.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={addBread}><Plus size={13} /> Añadir tipo de pan</button>
      </div>

      <div className="editor-block">
        <div className="editor-block-title">Ingredientes extra</div>
        {draft.extras.map((e) => (
          <div className="editor-row" key={e.id}>
            <input className="editor-name-input" value={e.name} onChange={(ev) => updateExtra(e.id, "name", ev.target.value)} />
            <input type="number" step="0.10" min="0" className="editor-price-input" value={e.price} onChange={(ev) => updateExtra(e.id, "price", parseFloat(ev.target.value) || 0)} />
            <button className="editor-remove" onClick={() => removeExtra(e.id)} aria-label="Eliminar"><XCircle size={16} /></button>
          </div>
        ))}
        <button className="pan-new-link" onClick={addExtra}><Plus size={13} /> Añadir ingrediente</button>
      </div>

      {["dulce", "bebida"].map((cat) => (
        <div className="editor-block" key={cat}>
          <div className="editor-block-title">{cat === "dulce" ? "Bollería y dulces" : "Bebidas"}</div>
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
.truck-group{animation:truckEnter 5.5s cubic-bezier(.32,.02,.28,1) both;transform-box:fill-box;transform-origin:center;}
.truck-wheel{fill:var(--ink);animation:wheelEnter 5.5s ease-out both;transform-box:fill-box;transform-origin:center;}
.truck-hub{fill:var(--paper);}
.truck-roof{fill:#A9D9C4;}
.truck-band{fill:var(--paper);stroke:var(--line);stroke-width:1;}
.truck-bumper{fill:#D8D3C9;}
.truck-awning{fill:var(--paper);}
.truck-hatch{fill:#2E3A3A;stroke:#A9D9C4;stroke-width:1.4;animation:hatchGlow 1s ease 5.5s both;}
.truck-cab-window{fill:#2E3A3A;stroke:#A9D9C4;stroke-width:1.1;}
.truck-door{stroke:#7FBBA3;stroke-width:1;}
.truck-headlight{fill:var(--paper);stroke:var(--mist);stroke-width:.6;}
.truck-shadow{fill:rgba(43,43,46,.15);animation:shadowGrow 5.5s ease both;}
.truck-motion-lines{animation:linesFade 5.5s ease both;}
.truck-motion-lines line{stroke:var(--mist);stroke-width:2;stroke-linecap:round;}
.truck-puff{fill:var(--mist);opacity:0;animation:puffPop .7s ease 4.9s both;}
.truck-delivery{opacity:0;transform-box:fill-box;transform-origin:center;animation:deliveryPop .9s cubic-bezier(.3,1.4,.4,1) 5.7s both;}
.delivery-bag{fill:var(--salmon-deep);}
.delivery-fold{fill:var(--salmon);}
.delivery-pastry{fill:#E8C28A;stroke:var(--paper);stroke-width:1;}
.sparkle{fill:#F2C9A0;opacity:0;transform-box:fill-box;transform-origin:center;}
.sparkle-a{animation:sparklePop .6s ease 6.3s both;}
.sparkle-b{animation:sparklePop .6s ease 6.55s both;}
.sparkle-c{animation:sparklePop .6s ease 6.75s both;}

/* Al pasar el ratón: arranca y circula muy despacio, sin moverse de su sitio */
.truck-scene:hover .truck-group{animation:truckIdleDrive 4s ease-in-out infinite;}
.truck-scene:hover .truck-wheel{animation:wheelIdleSpin 2.6s linear infinite;}
.truck-scene:hover .truck-motion-lines{animation:linesIdleLoop 4s ease-in-out infinite;}

@keyframes truckEnter{
  0%{transform:translateX(-70vw);}
  72%{transform:translateX(4px);}
  86%{transform:translateX(-2px);}
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
