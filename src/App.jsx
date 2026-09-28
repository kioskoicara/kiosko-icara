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
  return { accessToken: data.access_token, email: data.user?.email || email };
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
        {view !== "cocina" ? (
          <button className="link-btn" onClick={() => setView("cocina")}>Equipo Ícara</button>
        ) : (
          <button className="link-btn" onClick={() => setView("menu")}>Salir</button>
        )}
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
              onBack={() => setView("menu")}
              onPay={submitOrder}
            />
          )}

          {view === "confirmacion" && confirmedOrder && (
            <ConfirmationView order={confirmedOrder} config={config} onNew={resetForNewOrder} onCancel={cancelOrder} />
          )}

          {view === "cocina" && <CocinaView config={config} saveConfig={saveConfig} />}
        </>
      )}
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
        <h2><Wheat size={18} strokeWidth={2.2} /> Pan y tostadas</h2>
        <PanBuilder cart={cart} addItem={addItem} breadTypes={config.breadTypes} extras={config.extras} baseTostada={config.baseTostada} />
      </section>

      {Object.entries(CATS).map(([catId, meta]) => {
        const Icon = meta.icon;
        const items = config.menu.filter((m) => m.cat === catId);
        return (
          <section className="cat-block" key={catId}>
            <h2><Icon size={18} strokeWidth={2.2} /> {meta.label}</h2>
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
function CheckoutView({ targetDate, cartItems, total, name, setName, email, setEmail, payMethod, setPayMethod, paying, onBack, onPay }) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canPay = name.trim().length > 1 && emailValid && cartItems.length > 0;
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

      <button className="btn-primary btn-wide" disabled={!canPay || paying} onClick={onPay}>
        {paying ? <><Loader2 size={16} className="spin" /> Conectando con Stripe…</> : <>Pagar {eur(total)}</>}
      </button>
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
        <button className={panelTab === "menu" ? "tab-active" : ""} onClick={() => setPanelTab("menu")}>
          Editar menú
        </button>
      </div>

      {panelTab === "menu" ? (
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
.cat-block h2{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;margin:0 0 12px;color:var(--iris);}

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
