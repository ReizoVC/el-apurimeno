// Después de `next build`: escribe out/_headers, las cabeceras HTTP que Cloudflare Pages aplica a cada respuesta.
//
// La Content-Security-Policy solo permite scripts propios. Next pone scripts en línea en cada página (los datos de
// la hidratación); en vez de abrir la puerta a cualquier script en línea ('unsafe-inline'), se autoriza cada uno por
// su hash SHA-256, calculado aquí sobre las páginas ya compiladas. `connect-src` solo admite el proyecto de Supabase.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Las mismas variables que usó `next build`, con la misma precedencia (lo que ya está en el entorno gana).
for (const archivo of [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let origenSupabase;
try {
  origenSupabase = new URL(url).origin;
} catch {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL no es una URL válida: "${url}"`);
}
if (!origenSupabase.startsWith("https://"))
  throw new Error("NEXT_PUBLIC_SUPABASE_URL debe usar https.");

const SALIDA = "out";
const paginas = [];
(function recorrer(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) recorrer(ruta);
    else if (e.name.endsWith(".html")) paginas.push(ruta);
  }
})(SALIDA);

const hash = (texto) =>
  `'sha256-${createHash("sha256").update(texto, "utf8").digest("base64")}'`;
const scripts = new Set();
const estilos = new Set();
for (const pagina of paginas) {
  const html = readFileSync(pagina, "utf8");
  for (const m of html.matchAll(
    /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
  ))
    if (m[1] !== "") scripts.add(hash(m[1]));
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
    if (m[1] !== "") estilos.add(hash(m[1]));
}

const csp = [
  "default-src 'none'",
  `script-src 'self' ${[...scripts].sort().join(" ")}`.trim(),
  `style-src 'self' ${[...estilos].sort().join(" ")}`.trim(),
  // El código QR del autenticador llega como imagen SVG en una URL data:.
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${origenSupabase}`,
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const cabeceras = `/*
  Content-Security-Policy: ${csp}
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()
  Strict-Transport-Security: max-age=31536000
`;
writeFileSync(join(SALIDA, "_headers"), cabeceras);
console.log(
  `_headers: ${paginas.length} páginas, ${scripts.size} scripts en línea autorizados por hash; connect-src ${origenSupabase}`,
);
