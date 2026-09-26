// Ejecuta un comando (tauri, cargo) con el entorno de compilación de C++ de una instalación ESTABLE de Visual Studio.
//
// Por qué: Rust elige la instalación de Visual Studio más nueva aunque sea una versión preliminar ("Insiders"), y esa
// puede no traer las bibliotecas de C++ para x64: el enlace falla con `LNK1104: msvcrt.lib`. rustc respeta un entorno
// de desarrollador ya cargado (VCINSTALLDIR), así que aquí se carga el `vcvars64.bat` de la última instalación estable
// que tenga las herramientas de C++ y se ejecuta el comando dentro de ese entorno.
//
// Uso: node scripts/con-msvc.mjs <comando> [argumentos…]   (fuera de Windows, ejecuta el comando tal cual)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const [comando, ...argumentos] = process.argv.slice(2);
if (comando === undefined) {
  console.error("Uso: node scripts/con-msvc.mjs <comando> [argumentos…]");
  process.exit(2);
}

function entornoMsvc() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) {
    throw new Error("No se encontró Visual Studio (vswhere.exe). Instale 'Desarrollo para el escritorio con C++' (ver CLAUDE.md).");
  }
  // Sin -prerelease: vswhere solo devuelve instalaciones estables.
  const ruta = execFileSync(
    vswhere,
    ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
    { encoding: "utf8" },
  ).trim();
  if (ruta === "") {
    throw new Error("Ninguna instalación estable de Visual Studio tiene 'Desarrollo para el escritorio con C++' (herramientas VC x64).");
  }
  const vcvars = join(ruta, "VC", "Auxiliary", "Build", "vcvars64.bat");
  if (!existsSync(vcvars)) throw new Error(`No existe ${vcvars}.`);
  // vcvars64.bat llama a vswhere.exe por su nombre: su carpeta tiene que estar en el PATH.
  const path = `${dirname(vswhere)};${process.env.PATH ?? process.env.Path ?? ""}`;
  const salida = execFileSync("cmd.exe", ["/d", "/s", "/c", `"call "${vcvars}" >nul && set"`], {
    encoding: "utf8",
    windowsVerbatimArguments: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: path, Path: path },
  });
  const env = {};
  for (const linea of salida.split(/\r?\n/)) {
    const i = linea.indexOf("=");
    if (i > 0) env[linea.slice(0, i)] = linea.slice(i + 1);
  }
  if (env.VCINSTALLDIR === undefined) throw new Error(`${vcvars} no dejó cargado el entorno de C++.`);
  console.error(`Compilando con Visual Studio en ${ruta} (MSVC ${env.VCToolsVersion ?? "?"}).`);
  return env;
}

const env = process.platform === "win32" ? entornoMsvc() : process.env;
const r = spawnSync(comando, argumentos, { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
