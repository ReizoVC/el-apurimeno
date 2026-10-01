// Hace de impresora-windows.ps1 en las pruebas: el mismo protocolo (una línea JSON por mensaje; "ENVIAR <base64>" o
// "CANCELAR" en la entrada), sin tocar ningún dispositivo. Argumentos: <modo> <respuesta de apertura en JSON> <archivo>.
//   normal: responde la apertura, y si recibe ENVIAR escribe los bytes en <archivo> y responde "enviado".
//   mudo: nunca responde (un dispositivo colgado). falla-envio: responde error al enviar. muere: termina sin responder.
import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { createInterface } from "node:readline";
import { setInterval } from "node:timers";

const [modo, apertura, archivo] = process.argv.slice(2);
const responder = (objeto) => process.stdout.write(`${JSON.stringify(objeto)}\n`);

if (modo === "muere") process.exit(3);
if (modo === "mudo") setInterval(() => undefined, 1000);
else {
  responder(JSON.parse(apertura));
  const entrada = createInterface({ input: process.stdin });
  entrada.once("line", (orden) => {
    if (orden.startsWith("ENVIAR ")) {
      if (modo === "falla-envio") responder({ evento: "error", mensaje: "La impresora no recibió los datos a tiempo." });
      else {
        appendFileSync(archivo, Buffer.from(orden.slice(7), "base64"));
        responder({ evento: "enviado" });
      }
    }
    process.exit(0);
  });
}
