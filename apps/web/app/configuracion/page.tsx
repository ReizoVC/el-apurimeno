"use client";

import { useEffect, useState } from "react";
import {
  ConfiguracionEntradaSchema,
  LEYENDA_COMPROBANTE_POR_DEFECTO,
  type ConfiguracionGlobal,
  type MetodoPago,
  type Ticket,
} from "@apurimeno/contracts";
import { componerLineasComprobante } from "@apurimeno/domain";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import {
  Aviso,
  CLASE_SELECT,
  Campo,
  Encabezado,
} from "../../src/componentes/comunes";
import { useCarga } from "../../src/lib/carga";
import { aTextoSoles, leerSoles } from "../../src/lib/formato";
import { mensajeDe, servidor } from "../../src/lib/servidor";

/** Borrador del formulario: números y montos como texto, tal como se escriben. */
interface Borrador {
  horasBase: string;
  minutosAviso: string;
  minutosCortesia: string;
  precioHoraAdicional: string;
  nombreNegocio: string;
  datosAdicionales: string;
  leyenda: string;
  anchoPapelMm: "58" | "80";
  conexion: "USB" | "BLUETOOTH";
  permitirStockNegativo: boolean;
  minutosVigenciaCodigoAutorizacion: string;
}

const aBorrador = (c: ConfiguracionGlobal): Borrador => ({
  horasBase: String(c.parametrosAlquiler.horasBase),
  minutosAviso: String(c.parametrosAlquiler.minutosAviso),
  minutosCortesia: String(c.parametrosAlquiler.minutosCortesia),
  precioHoraAdicional: aTextoSoles(c.parametrosAlquiler.precioHoraAdicional),
  nombreNegocio: c.comprobante.nombreNegocio,
  datosAdicionales: c.comprobante.datosAdicionales ?? "",
  leyenda: c.comprobante.leyenda,
  anchoPapelMm: c.impresora.anchoPapelMm === 58 ? "58" : "80",
  conexion: c.impresora.conexion,
  permitirStockNegativo: c.permitirStockNegativo,
  minutosVigenciaCodigoAutorizacion: String(
    c.minutosVigenciaCodigoAutorizacion,
  ),
});

const entero = (t: string) =>
  /^\d+$/.test(t.trim()) ? Number(t.trim()) : Number.NaN;

/** Arma la configuración completa; la validan los mismos esquemas que usa el servidor. */
function desdeBorrador(b: Borrador) {
  return ConfiguracionEntradaSchema.safeParse({
    parametrosAlquiler: {
      horasBase: entero(b.horasBase),
      minutosAviso: entero(b.minutosAviso),
      minutosCortesia: entero(b.minutosCortesia),
      precioHoraAdicional: leerSoles(b.precioHoraAdicional) ?? Number.NaN,
    },
    comprobante: {
      nombreNegocio: b.nombreNegocio.trim(),
      datosAdicionales:
        b.datosAdicionales.trim() === "" ? null : b.datosAdicionales.trim(),
      leyenda: b.leyenda.trim(),
    },
    impresora: { anchoPapelMm: Number(b.anchoPapelMm), conexion: b.conexion },
    permitirStockNegativo: b.permitirStockNegativo,
    minutosVigenciaCodigoAutorizacion: entero(
      b.minutosVigenciaCodigoAutorizacion,
    ),
  });
}

/** Ticket de ejemplo para la vista previa; nunca se envía al servidor. */
const TICKET_EJEMPLO = (metodoId: string): Ticket => ({
  id: "ejemplo",
  numero: 1234,
  tipo: "COBRO",
  origen: "INGRESO_ALQUILER",
  estado: "EMITIDO",
  turnoId: "ejemplo",
  alquilerId: "ejemplo",
  habitacionReferenciaId: null,
  ticketOriginalId: null,
  total: 2500,
  ajustePuntual: null,
  anulacion: null,
  lineas: [
    {
      id: "l1",
      tipo: "BASE_HABITACION",
      descripcion: "Habitación 101 — 8 horas",
      cantidad: 1,
      precioUnitario: 2500,
      importe: 2500,
      productoId: null,
    },
  ],
  pagos: [
    {
      id: "p1",
      metodoPagoId: metodoId,
      monto: 2500,
      referencia: null,
      montoRecibido: 3000,
      vuelto: 500,
    },
  ],
  creadoPorId: "ejemplo",
  creadoEn: new Date().toISOString(),
});

/**
 * Configuración global (CU-27; RN-43, RF-50 a RF-52). Se guarda completa: el servidor reemplaza la
 * configuración entera y audita el antes y el después.
 */
export default function Configuracion() {
  const carga = useCarga(async () => {
    const [configuracion, metodos] = await Promise.all([
      servidor.configuracion(),
      servidor.metodosPago(),
    ]);
    return { configuracion, metodos };
  }, []);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (carga.datos !== null) setBorrador(aBorrador(carga.datos.configuracion));
  }, [carga.datos]);

  if (carga.error !== null) return <Aviso tipo="error">{carga.error}</Aviso>;
  if (borrador === null || carga.datos === null)
    return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const cambiar = <K extends keyof Borrador>(campo: K, valor: Borrador[K]) =>
    setBorrador({ ...borrador, [campo]: valor });
  const resultado = desdeBorrador(borrador);
  const errores = new Map<string, string>();
  if (!resultado.success)
    for (const i of resultado.error.issues)
      errores.set(i.path.join("."), i.message);
  const error = (ruta: string) => errores.get(ruta);
  const cambiado =
    JSON.stringify(aBorrador(carga.datos.configuracion)) !==
    JSON.stringify(borrador);

  const guardar = async () => {
    if (!resultado.success) return;
    setGuardando(true);
    setAviso(null);
    try {
      await servidor.cambiarConfiguracion(resultado.data);
      setAviso({
        tipo: "exito",
        texto:
          "Configuración guardada. Los parámetros de tiempo rigen para los ingresos nuevos.",
      });
      await carga.recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Encabezado
        titulo="Configuración"
        descripcion="Parámetros de alquiler, comprobante, impresora y tienda. Se guarda todo junto."
      >
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={!cambiado || guardando}
            onClick={() => setBorrador(aBorrador(carga.datos!.configuracion))}
          >
            Descartar cambios
          </Button>
          <Button
            disabled={!cambiado || !resultado.success || guardando}
            onClick={() => void guardar()}
          >
            {guardando ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </Encabezado>
      {aviso !== null && (
        <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Alquiler</CardTitle>
              <CardDescription>
                Solo rigen para los ingresos que se registren después de
                guardar; los alquileres abiertos conservan los valores con los
                que empezaron (RN-43).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo
                etiqueta="Horas base"
                ayuda={
                  error("parametrosAlquiler.horasBase") ??
                  "Duración del precio de la habitación."
                }
              >
                <Input
                  inputMode="numeric"
                  value={borrador.horasBase}
                  onChange={(e) => cambiar("horasBase", e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Aviso (min)"
                ayuda={
                  error("parametrosAlquiler.minutosAviso") ??
                  "Antes del vencimiento."
                }
              >
                <Input
                  inputMode="numeric"
                  value={borrador.minutosAviso}
                  onChange={(e) => cambiar("minutosAviso", e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Cortesía (min)"
                ayuda={
                  error("parametrosAlquiler.minutosCortesia") ??
                  "Una vez por alquiler."
                }
              >
                <Input
                  inputMode="numeric"
                  value={borrador.minutosCortesia}
                  onChange={(e) => cambiar("minutosCortesia", e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Hora adicional (S/)"
                ayuda={error("parametrosAlquiler.precioHoraAdicional")}
              >
                <Input
                  inputMode="decimal"
                  value={borrador.precioHoraAdicional}
                  onChange={(e) =>
                    cambiar("precioHoraAdicional", e.target.value)
                  }
                />
              </Campo>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comprobante</CardTitle>
              <CardDescription>
                Ningún texto puede usar términos ni series de comprobantes
                fiscales (RN-39).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Campo
                etiqueta="Nombre del negocio"
                ayuda={error("comprobante.nombreNegocio")}
              >
                <Input
                  value={borrador.nombreNegocio}
                  onChange={(e) => cambiar("nombreNegocio", e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Datos adicionales (opcional)"
                ayuda={
                  error("comprobante.datosAdicionales") ??
                  "Dirección, un mensaje breve…"
                }
              >
                <Input
                  value={borrador.datosAdicionales}
                  onChange={(e) => cambiar("datosAdicionales", e.target.value)}
                />
              </Campo>
              <Campo
                etiqueta="Leyenda al pie (obligatoria)"
                ayuda={
                  error("comprobante.leyenda") ?? (
                    <>
                      Va al pie de todo comprobante y declara que no es un
                      documento tributario. Se puede reformular si cambia la
                      situación tributaria del negocio, pero no omitir.{" "}
                      {borrador.leyenda.trim() !==
                        LEYENDA_COMPROBANTE_POR_DEFECTO && (
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            cambiar("leyenda", LEYENDA_COMPROBANTE_POR_DEFECTO)
                          }
                        >
                          Restaurar la leyenda original
                        </button>
                      )}
                    </>
                  )
                }
              >
                <Input
                  value={borrador.leyenda}
                  onChange={(e) => cambiar("leyenda", e.target.value)}
                />
              </Campo>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Impresora</CardTitle>
                <CardDescription>
                  Térmica ESC/POS, por USB o Bluetooth.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Ancho de papel">
                  <select
                    className={CLASE_SELECT}
                    value={borrador.anchoPapelMm}
                    onChange={(e) =>
                      cambiar(
                        "anchoPapelMm",
                        e.target.value === "58" ? "58" : "80",
                      )
                    }
                  >
                    <option value="58">58 mm</option>
                    <option value="80">80 mm</option>
                  </select>
                </Campo>
                <Campo etiqueta="Conexión">
                  <select
                    className={CLASE_SELECT}
                    value={borrador.conexion}
                    onChange={(e) =>
                      cambiar(
                        "conexion",
                        e.target.value === "USB" ? "USB" : "BLUETOOTH",
                      )
                    }
                  >
                    <option value="USB">USB</option>
                    <option value="BLUETOOTH">Bluetooth</option>
                  </select>
                </Campo>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tienda y autorizaciones</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={borrador.permitirStockNegativo}
                    onChange={(e) =>
                      cambiar("permitirStockNegativo", e.target.checked)
                    }
                  />
                  <span>
                    Permitir vender sin stock
                    <span className="block text-xs text-muted-foreground">
                      El stock puede quedar negativo (RN-26).
                    </span>
                  </span>
                </label>
                <Campo
                  etiqueta="Vigencia del código de autorización (min)"
                  ayuda={
                    error("minutosVigenciaCodigoAutorizacion") ??
                    "Cuánto vale un código de autorización antes de vencer (RF-65)."
                  }
                >
                  <Input
                    inputMode="numeric"
                    className="w-24"
                    value={borrador.minutosVigenciaCodigoAutorizacion}
                    onChange={(e) =>
                      cambiar(
                        "minutosVigenciaCodigoAutorizacion",
                        e.target.value,
                      )
                    }
                  />
                </Campo>
              </CardContent>
            </Card>
          </div>
        </div>
        <VistaPrevia borrador={borrador} metodos={carga.datos.metodos} />
      </div>
    </>
  );
}

/** El comprobante tal como lo compone el dominio con los textos del borrador. */
function VistaPrevia({
  borrador,
  metodos,
}: {
  borrador: Borrador;
  metodos: MetodoPago[];
}) {
  const efectivo = metodos.find((m) => m.afectaCaja) ?? metodos[0];
  const lineas = componerLineasComprobante(
    TICKET_EJEMPLO(efectivo?.id ?? "efectivo"),
    {
      datos: {
        nombreNegocio: borrador.nombreNegocio.trim() || "—",
        datosAdicionales:
          borrador.datosAdicionales.trim() === ""
            ? null
            : borrador.datosAdicionales.trim(),
        leyenda: borrador.leyenda.trim() || "—",
      },
      anchoPapelMm: borrador.anchoPapelMm === "58" ? 58 : 80,
      metodosPago: metodos,
      esCopia: false,
    },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vista previa</CardTitle>
        <CardDescription>
          Un ingreso de ejemplo en papel de {borrador.anchoPapelMm} mm.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="rounded-md border bg-white p-3 font-mono text-xs leading-snug text-black">
          {lineas.map((l, i) => (
            <div
              key={i}
              className={
                l.estilo === "normal"
                  ? ""
                  : l.estilo === "grande"
                    ? "font-bold text-sm"
                    : "font-bold"
              }
            >
              {l.texto || " "}
            </div>
          ))}
        </pre>
      </CardContent>
    </Card>
  );
}
