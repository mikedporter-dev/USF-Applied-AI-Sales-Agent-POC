import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Research } from "./Research";
import "../styles/global.css";
import "../app/app.css";
import "./research.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Research />
  </StrictMode>,
);
