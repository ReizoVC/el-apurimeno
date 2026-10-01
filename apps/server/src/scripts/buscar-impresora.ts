import { listarDispositivosWindows } from "../impresion/transporte.js";

// Lista lo que ve Windows y dónde podría estar la impresora, con el valor de IMPRESORA_DISPOSITIVO para cada caso.
// Solo lee (registro de Windows y WMI): no abre ningún puerto ni envía nada a ningún dispositivo.
//   pnpm buscar-impresora

if (process.platform !== "win32") {
  console.log("Solo en Windows. En Linux, la impresora USB suele ser /dev/usb/lp0 (IMPRESORA_DISPOSITIVO=/dev/usb/lp0).");
  process.exit(0);
}

const { puertos, usb, colas } = await listarDispositivosWindows();
const sugerencia = (valor: string) => `IMPRESORA_DISPOSITIVO="${valor}"`;

console.log("\nPuertos COM (Bluetooth, o impresora USB instalada como puerto serie):");
if (puertos.length === 0) console.log("  (ninguno)");
for (const p of puertos) console.log(`  ${p.puerto.padEnd(6)} ${p.nombre}\n         ${sugerencia(p.puerto)}`);

console.log("\nImpresoras USB directas (sin controlador de impresora):");
if (usb.length === 0) console.log("  (ninguna conectada)");
for (const u of usb) console.log(`  ${u.ruta}`);
if (usb.length === 1) console.log(`  ${sugerencia("usb")}`);
if (usb.length > 1) {
  for (const u of usb) console.log(`  ${sugerencia(`usb:${/VID_[0-9A-F]{4}&PID_[0-9A-F]{4}/i.exec(u.ruta)?.[0] ?? u.ruta}`)}`);
}

console.log("\nImpresoras instaladas en Windows (modo RAW; no informan papel ni tapa):");
// Las de un puerto USB o COM pueden ser la térmica; las demás (PDF, fax, OneNote) solo se nombran.
const fisicas = colas.filter((c) => /^(USB|COM)\d+/i.test(c.puerto));
const otras = colas.filter((c) => !fisicas.includes(c)).map((c) => c.nombre);
if (fisicas.length === 0) console.log("  (ninguna en un puerto USB o COM)");
if (otras.length > 0) console.log(`  Otras, que no son la térmica: ${otras.join(", ")}`);
for (const c of fisicas) console.log(`  "${c.nombre}" (puerto ${c.puerto}, ${c.controlador})\n         ${sugerencia(`windows:${c.nombre}`)}`);

console.log(`
La RED-E803 por Bluetooth aparece como un puerto COM ("Enlace serie estándar a través de Bluetooth"); por USB, como
impresora USB directa, como puerto COM o, si se instaló su controlador, como impresora de Windows. Preferir, en ese
orden: COM o usb (leen papel y tapa), y windows:<nombre> solo si los otros no funcionan. Probar con:
  pnpm prueba-impresora prueba.bin && pnpm enviar-impresora prueba.bin`);
