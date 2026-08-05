import "./styles.css";
import { Camera } from "./camera";
import { loadFontDB } from "./data";
import { CardLayer } from "./map/cards";

const world = document.getElementById("world")!;
const viewport = document.getElementById("viewport")!;

async function boot(): Promise<void> {
  const db = await loadFontDB();
  const camera = new Camera(world, viewport);
  const layer = new CardLayer(world, db.entries);

  camera.onChange = () => layer.render(camera.view());
  layer.render(camera.view());
  addEventListener("resize", () => layer.render(camera.view()));

  console.log(`twofonts: ${db.entries.length} famílias`);
}

void boot();
