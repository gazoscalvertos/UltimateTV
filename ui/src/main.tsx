import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

if (window.ultimatetv) document.documentElement.classList.add("on-box");
render(() => <App />, document.getElementById("app")!);
