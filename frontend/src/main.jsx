import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { WalletProvider } from "./context/WalletContext";
import APP_CONFIG from "./config/appConfig";

import "./index.css";


// جلوگیری از اجرای دوباره React Root
const ROOT_KEY = "__AI_POLIFY_ROOT_STARTED__";

if (!window[ROOT_KEY]) {
  window[ROOT_KEY] = true;

  ReactDOM.createRoot(
    document.getElementById("root")
  ).render(

    <TonConnectUIProvider
      manifestUrl={APP_CONFIG.tonConnectManifestUrl}
    >

      <WalletProvider>
        <App />
      </WalletProvider>

    </TonConnectUIProvider>

  );
}