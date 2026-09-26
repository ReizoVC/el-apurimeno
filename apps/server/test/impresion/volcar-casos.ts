import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { casos } from "./casos.js";

// Guarda las líneas de cada caso en casos.json, la entrada de generar_esperados.py.
const destino = fileURLToPath(new URL("./casos.json", import.meta.url));
writeFileSync(destino, `${JSON.stringify(casos(), null, 2)}\n`);
console.log(`Escrito ${destino}`);
