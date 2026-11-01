import { render } from "solid-js/web";
import { App } from "./App";
import { installMouse } from "./mouse";
import "./styles.css";

if (window.ultimatetv) document.documentElement.classList.add("on-box");
// A desktop copy (and a browser) works with the mouse too; the TV box has none.
installMouse();
render(() => <App />, document.getElementById("app")!);
