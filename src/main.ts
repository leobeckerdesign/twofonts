import "./styles.css";
import { loadFontDB } from "./data";

loadFontDB().then((db) => console.log(`twofonts: ${db.entries.length} famílias`));
