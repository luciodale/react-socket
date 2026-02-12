import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { WebSocketProvider } from "./socket/index.ts";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<WebSocketProvider>
			<App />
		</WebSocketProvider>
	</React.StrictMode>,
);
