import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameServerProvider } from "@agent8/gameserver";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameServerProvider>
      <App />
    </GameServerProvider>
  </StrictMode>,
);
