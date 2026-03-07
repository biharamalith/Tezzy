import React from "react";
import ReactDOM from "react-dom/client";

import Layout from "./app/layout";

const rootElement = document.getElementById("root");

if (rootElement) {
	ReactDOM.createRoot(rootElement).render(
		<Layout />
	);
}
