import { createRoot } from "react-dom/client";
import { Logo } from "../components/ui";
import "../styles/global.css";

function NotFound() {
  return (
    <main className="container" style={{ minHeight: "100vh", display: "grid", placeContent: "center", gap: 20, textAlign: "center" }}>
      <a href="/" style={{ justifySelf: "center" }}>
        <Logo />
      </a>
      <h1 style={{ fontSize: 40 }}>Page not found</h1>
      <p style={{ color: "var(--muted)" }}>That page doesn't exist. Try the home page or the account list.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <a className="btn btn-primary" href="/app/">Open accounts</a>
        <a className="btn btn-ghost" href="/">Home</a>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<NotFound />);
