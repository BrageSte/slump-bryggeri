import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import no from "zod/v4/locales/no.js";
import { App } from "./app/App.tsx";
import "./design-system/tokens.css";
import { applyTheme } from "./lib/theme.ts";

z.config(no());
applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch((error: unknown) => console.warn("Service worker registration failed", error));
  });
}
