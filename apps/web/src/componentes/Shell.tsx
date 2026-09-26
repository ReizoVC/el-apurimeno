"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permiso } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import {
  ErrorApi,
  mensajeDe,
  registrarSesionInvalida,
  servidor,
  usarSesion,
} from "../lib/servidor";
import {
  borrarSesion,
  guardarSesion,
  leerSesion,
  type Sesion,
} from "../lib/sesion";
import { Aviso, Campo } from "./comunes";

const ContextoSesion = createContext<Sesion | null>(null);

/** Sesión del Administrador; solo existe dentro del Shell, con sesión iniciada. */
export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (sesion === null) throw new Error("useSesion fuera de una sesión.");
  return sesion;
}

export function tienePermiso(sesion: Sesion, permiso: Permiso): boolean {
  return sesion.permisos.includes(permiso);
}

/** Secciones del menú, cada una con el permiso que la habilita. */
const SECCIONES: {
  href: string;
  etiqueta: string;
  permiso: Permiso;
  grupo: string;
}[] = [
  {
    href: "/",
    etiqueta: "Vista general",
    permiso: "dashboard.access",
    grupo: "",
  },
  {
    href: "/reportes",
    etiqueta: "Reportes",
    permiso: "reports.view",
    grupo: "",
  },
  {
    href: "/administracion/habitaciones",
    etiqueta: "Habitaciones",
    permiso: "rooms.manage",
    grupo: "Administración",
  },
  {
    href: "/administracion/clientes",
    etiqueta: "Clientes y precios",
    permiso: "client_pricing.manage",
    grupo: "Administración",
  },
  {
    href: "/administracion/usuarios",
    etiqueta: "Usuarios",
    permiso: "users.manage",
    grupo: "Administración",
  },
  {
    href: "/administracion/rangos",
    etiqueta: "Rangos",
    permiso: "users.manage",
    grupo: "Administración",
  },
  {
    href: "/configuracion",
    etiqueta: "Configuración",
    permiso: "settings.manage",
    grupo: "Sistema",
  },
  {
    href: "/metodos-pago",
    etiqueta: "Métodos de pago",
    permiso: "settings.manage",
    grupo: "Sistema",
  },
  {
    href: "/auditoria",
    etiqueta: "Auditoría",
    permiso: "audit.view",
    grupo: "Control",
  },
  {
    href: "/turnos",
    etiqueta: "Turnos abiertos",
    permiso: "shifts.force_close",
    grupo: "Control",
  },
  {
    href: "/codigos-autorizacion",
    etiqueta: "Códigos de anulación",
    permiso: "tickets.void",
    grupo: "Control",
  },
  {
    href: "/reimpresion",
    etiqueta: "Reimpresión",
    permiso: "tickets.reprint",
    grupo: "Control",
  },
];

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sin-sesion"; aviso: string | null }
  | { tipo: "con-sesion"; sesion: Sesion };

/**
 * Marco del Dashboard: sin sesión, el login; con sesión, el menú lateral y la sección. La sesión se lee de
 * localStorage después de montar, para que el HTML del servidor y el del navegador coincidan.
 */
export function Shell({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const ruta = usePathname();

  const salir = useCallback((aviso: string | null) => {
    borrarSesion();
    usarSesion(null);
    setEstado({ tipo: "sin-sesion", aviso });
  }, []);

  useEffect(() => {
    const sesion = leerSesion();
    usarSesion(sesion);
    setEstado(
      sesion === null
        ? { tipo: "sin-sesion", aviso: null }
        : { tipo: "con-sesion", sesion },
    );
    registrarSesionInvalida(() =>
      salir("La sesión venció o la cuenta fue desactivada. Vuelva a ingresar."),
    );
  }, [salir]);

  if (estado.tipo === "cargando") return null;
  if (estado.tipo === "sin-sesion") {
    return (
      <Login
        avisoInicial={estado.aviso}
        onSesion={(sesion) => {
          guardarSesion(sesion);
          usarSesion(sesion);
          setEstado({ tipo: "con-sesion", sesion });
        }}
      />
    );
  }

  const { sesion } = estado;
  const visibles = SECCIONES.filter((s) => tienePermiso(sesion, s.permiso));
  const grupos = [...new Set(visibles.map((s) => s.grupo))];
  return (
    <ContextoSesion.Provider value={sesion}>
      <div className="flex min-h-screen bg-muted/30">
        <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
          <div className="border-b px-4 py-3">
            <p className="font-semibold">El Apurimeño</p>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
          <nav
            className="flex flex-1 flex-col gap-4 p-3 text-sm"
            aria-label="Secciones"
          >
            {grupos.map((grupo) => (
              <div key={grupo} className="flex flex-col gap-0.5">
                {grupo !== "" && (
                  <p className="px-2 pb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {grupo}
                  </p>
                )}
                {visibles
                  .filter((s) => s.grupo === grupo)
                  .map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      aria-current={ruta === s.href ? "page" : undefined}
                      className={`rounded-md px-2 py-1.5 hover:bg-muted ${ruta === s.href ? "bg-muted font-medium" : ""}`}
                    >
                      {s.etiqueta}
                    </Link>
                  ))}
              </div>
            ))}
          </nav>
          <div className="border-t p-3 text-sm">
            <p className="text-muted-foreground">
              Sesión:{" "}
              <span className="font-medium text-foreground">
                {sesion.usuario.nombreUsuario}
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 px-0"
              onClick={() => salir(null)}
            >
              Cerrar sesión
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          {children}
        </main>
      </div>
    </ContextoSesion.Provider>
  );
}

/** Inicio de sesión (RF-31). Solo entran cuentas con `dashboard.access`. */
function Login({
  avisoInicial,
  onSesion,
}: {
  avisoInicial: string | null;
  onSesion: (sesion: Sesion) => void;
}) {
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(avisoInicial);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const r = await servidor.login(nombreUsuario.trim(), contrasena);
      if (!r.permisos.includes("dashboard.access")) {
        throw new ErrorApi(
          403,
          "PERMISO_DENEGADO",
          "Esta cuenta no tiene acceso al Dashboard.",
        );
      }
      onSesion({ token: r.token, usuario: r.usuario, permisos: r.permisos });
    } catch (e) {
      setAviso(mensajeDe(e));
      setContrasena("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={(e) => void enviar(e)}>
          <CardHeader>
            <CardTitle>El Apurimeño</CardTitle>
            <CardDescription>Dashboard de administración.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {aviso !== null && <Aviso tipo="error">{aviso}</Aviso>}
            <Campo etiqueta="Usuario">
              <Input
                autoComplete="username"
                autoFocus
                required
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Contraseña">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </Campo>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Ingresando…" : "Ingresar"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
