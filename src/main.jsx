import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../public/styles.css";
import { ProfilerApp } from "./ProfilerApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ProfilerApp />
  </StrictMode>,
);
