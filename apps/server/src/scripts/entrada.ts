import { createInterface } from "node:readline";

/** Pregunta por la terminal. Con `oculto`, lo que se escribe no se muestra (para la clave privada). */
export function preguntar(texto: string, oculto = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (oculto) {
    const salida = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let mostrada = false;
    salida._writeToOutput = (s: string) => {
      // Solo se muestra la pregunta; lo que se escribe después, no.
      if (!mostrada) {
        salida.output.write(s);
        mostrada = true;
      } else if (s.includes("\n")) {
        salida.output.write("\n");
      }
    };
  }
  return new Promise((resolver) => {
    rl.question(texto, (respuesta) => {
      rl.close();
      resolver(respuesta.trim());
    });
  });
}
