import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import "../public/styles.css";
import { ProfilerApp } from "./ProfilerApp.jsx";

const ObservatoryApp = lazy(() =>
  import("./observatory/ObservatoryApp.jsx").then((module) => ({
    default: module.ObservatoryApp,
  })),
);

export function resolveAppMode(search) {
  return new URLSearchParams(search).get("mode") === "observatory"
    ? "observatory"
    : "workbench";
}

export function RootApp({
  mode = resolveAppMode(globalThis.location?.search ?? ""),
} = {}) {
  if (mode === "observatory") {
    return (
      <Suspense
        fallback={
          <main className="observatory-boot" aria-busy="true">
            <span>Opening Silicon Observatory…</span>
          </main>
        }
      >
        <ObservatoryApp />
      </Suspense>
    );
  }
  return <ProfilerApp />;
}

const rootElement = globalThis.document?.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RootApp />
    </StrictMode>,
  );
}
