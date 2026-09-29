import React from "react";
import ReactDOM from "react-dom/client";
import KioskoIcara from "./App.jsx";

/* Si algo revienta en la app, en vez de quedarse la pantalla en
   blanco (que no dice nada de qué ha pasado), se muestra el error
   aquí mismo. Así, si vuelve a pasar, basta con hacer una captura
   de la pantalla — no hace falta abrir las herramientas de
   desarrollador del navegador. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Error atrapado por ErrorBoundary:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "sans-serif", maxWidth: 560, margin: "40px auto", padding: 20, color: "#2b2b2e" }}>
          <h2 style={{ color: "#d9704c" }}>Ha ocurrido un error</h2>
          <p>La página no ha podido cargar correctamente. Haz una captura de esto y mándasela a quien lleve la web:</p>
          <pre style={{ background: "#fbeae8", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
            {String(this.state.error && this.state.error.stack ? this.state.error.stack : this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: "10px 18px", borderRadius: 100, border: "none", background: "#f2938c", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Recargar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <KioskoIcara />
    </ErrorBoundary>
  </React.StrictMode>
);
