import "./styles.css";
import { Camera } from "./camera";
import { loadFontDB } from "./data";

const world = document.getElementById("world")!;
const viewport = document.getElementById("viewport")!;

async function boot(): Promise<void> {
  const db = await loadFontDB();
  const camera = new Camera(world, viewport);
  camera.onChange = () => {
    // A camada virtualizada do mapa é conectada na Task 7.
  };
  console.log(`twofonts: ${db.entries.length} famílias`);
}

void boot();
