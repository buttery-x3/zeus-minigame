import "./styles.css";
import { TerrainLabApp } from "./TerrainLabApp";

const root = document.querySelector<HTMLElement>("#terrain-lab");
if (!root) throw new Error("Missing terrain workbench root");
new TerrainLabApp(root).mount();
