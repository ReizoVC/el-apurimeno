import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Acceso a la vista remota: contraseña (Supabase Auth), rol `lector` y verificación en dos pasos (TOTP). Ningún dato
// se pide hasta que la sesión está en el nivel aal2; la base también lo exige (supabase/migrations, aal2).

export type Paso =
  | { tipo: "ingreso" }
  | { tipo: "sinAcceso"; mensaje: string }
  /** Primera vez: dar de alta el autenticador con el QR o la clave. */
  | { tipo: "alta"; factorId: string; qr: string; clave: string }
  /** Ya tiene autenticador: pedir el código. */
  | { tipo: "codigo"; factorId: string }
  | { tipo: "resumen" };

/** Error para mostrar tal cual, ya en castellano. */
export class ErrorAcceso extends Error {}

const NOMBRE_AUTENTICADOR = "El Apurimeño";

function explicar(
  error: AuthError | Error | { message: string; code?: string },
): ErrorAcceso {
  const codigo = "code" in error ? error.code : undefined;
  const texto = error.message ?? "";
  if (
    codigo === "invalid_credentials" ||
    /invalid login credentials/i.test(texto)
  ) {
    return new ErrorAcceso("Correo o contraseña incorrectos.");
  }
  if (
    codigo === "mfa_verification_failed" ||
    /invalid totp code/i.test(texto)
  ) {
    return new ErrorAcceso(
      "El código no es correcto o ya venció. Escriba el código que muestra ahora su autenticador.",
    );
  }
  if (
    codigo === "over_request_rate_limit" ||
    codigo === "over_email_send_rate_limit" ||
    /rate limit/i.test(texto)
  ) {
    return new ErrorAcceso(
      "Demasiados intentos seguidos. Espere unos minutos y vuelva a intentarlo.",
    );
  }
  if (
    codigo === "mfa_totp_enroll_not_enabled" ||
    /enroll.*(disabled|not enabled)/i.test(texto)
  ) {
    return new ErrorAcceso(
      "La verificación en dos pasos no está habilitada en el proyecto. Avise a quien administra el sistema.",
    );
  }
  if (
    /fetch|network|failed to fetch|load failed/i.test(texto) ||
    ("name" in error && error.name === "AuthRetryableFetchError")
  ) {
    return new ErrorAcceso(
      "No hay conexión. Revise el internet del celular y vuelva a intentarlo.",
    );
  }
  return new ErrorAcceso(
    texto === "" ? "No se pudo completar la operación." : texto,
  );
}

/** Rol de la cuenta en el espejo, o `desconocido` si el proyecto aún no tiene la función (migración pendiente). */
async function rolDeLaCuenta(): Promise<
  "lector" | "sincronizador" | null | "desconocido"
> {
  const { data, error } = await supabase().rpc("espejo_mi_rol");
  if (error !== null) {
    // PGRST202: la función no existe. Se sigue; el acceso a los datos lo deciden igual las políticas de la base.
    if (error.code === "PGRST202") return "desconocido";
    throw explicar(error);
  }
  return data === "lector" || data === "sincronizador" ? data : null;
}

/** Descarta altas de autenticador que quedaron a medias (sin confirmar) y empieza una nueva. */
async function nuevaAlta(): Promise<Paso> {
  const mfa = supabase().auth.mfa;
  const factores = await mfa.listFactors();
  if (factores.error !== null) throw explicar(factores.error);
  for (const f of factores.data.all) {
    if (f.factor_type === "totp" && f.status === "unverified") {
      const r = await mfa.unenroll({ factorId: f.id });
      if (r.error !== null) throw explicar(r.error);
    }
  }
  const alta = await mfa.enroll({
    factorType: "totp",
    friendlyName: NOMBRE_AUTENTICADOR,
    issuer: NOMBRE_AUTENTICADOR,
  });
  if (alta.error !== null) throw explicar(alta.error);
  const svg = alta.data.totp.qr_code;
  const qr = svg.startsWith("data:")
    ? svg
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return {
    tipo: "alta",
    factorId: alta.data.id,
    qr,
    clave: alta.data.totp.secret,
  };
}

/** Dónde está la sesión actual: qué pantalla corresponde mostrar. */
export async function pasoActual(): Promise<Paso> {
  const cliente = supabase();
  const { data: sesion } = await cliente.auth.getSession();
  if (sesion.session === null) return { tipo: "ingreso" };

  const rol = await rolDeLaCuenta();
  if (rol === null || rol === "sincronizador") {
    await cliente.auth.signOut();
    return {
      tipo: "sinAcceso",
      mensaje:
        rol === "sincronizador"
          ? "Esta es la cuenta del servidor del local; no se usa para consultar el resumen."
          : "Esta cuenta no tiene acceso al resumen, o fue desactivada. Consulte a quien administra el sistema.",
    };
  }

  const nivel = await cliente.auth.mfa.getAuthenticatorAssuranceLevel();
  if (nivel.error !== null) throw explicar(nivel.error);
  if (nivel.data.currentLevel === "aal2") return { tipo: "resumen" };

  const factores = await cliente.auth.mfa.listFactors();
  if (factores.error !== null) throw explicar(factores.error);
  const verificado = factores.data.totp[0];
  return verificado !== undefined
    ? { tipo: "codigo", factorId: verificado.id }
    : nuevaAlta();
}

export async function ingresar(
  correo: string,
  contrasena: string,
): Promise<Paso> {
  const { error } = await supabase().auth.signInWithPassword({
    email: correo.trim(),
    password: contrasena,
  });
  if (error !== null) throw explicar(error);
  return pasoActual();
}

/** Confirma el alta o verifica el código de 6 dígitos; la sesión pasa al nivel aal2. */
export async function verificarCodigo(
  factorId: string,
  codigo: string,
): Promise<Paso> {
  const { error } = await supabase().auth.mfa.challengeAndVerify({
    factorId,
    code: codigo.trim(),
  });
  if (error !== null) throw explicar(error);
  return pasoActual();
}

export async function salir(): Promise<void> {
  await supabase().auth.signOut();
}

export function mensajeDe(error: unknown): string {
  if (error instanceof ErrorAcceso) return error.message;
  if (error instanceof Error) return explicar(error).message;
  return "No se pudo completar la operación.";
}
