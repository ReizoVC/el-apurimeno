"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  AccionAuditoriaSchema,
  TipoEntidadAuditadaSchema,
  type AccionAuditoria,
  type AuditoriaConsulta,
  type RegistroAuditoria,
  type TipoEntidadAuditada,
} from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Card, CardContent } from "@apurimeno/ui/components/card";
import { Input } from "@apurimeno/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import {
  Aviso,
  CLASE_SELECT,
  Campo,
  Encabezado,
} from "../../src/componentes/comunes";
import { tienePermiso, useSesion } from "../../src/componentes/Shell";
import { periodoDeDias } from "../../src/lib/fechas";
import { fechaHora } from "../../src/lib/formato";
import { ACCION, ENTIDAD } from "../../src/lib/rotulos";
import { mensajeDe, servidor } from "../../src/lib/servidor";

const TAMANO_PAGINA = 50;

interface Filtros {
  usuarioId: string;
  accion: AccionAuditoria | "";
  tipoEntidad: TipoEntidadAuditada | "";
  entidadId: string;
  desde: string;
  hasta: string;
}
const SIN_FILTROS: Filtros = {
  usuarioId: "",
  accion: "",
  tipoEntidad: "",
  entidadId: "",
  desde: "",
  hasta: "",
};

/** Filtros del formulario a la consulta del servidor; los vacíos no se envían. */
function aConsulta(f: Filtros): Partial<AuditoriaConsulta> {
  const periodo =
    f.desde !== "" || f.hasta !== ""
      ? periodoDeDias(f.desde || "2000-01-01", f.hasta || "2999-12-31")
      : null;
  return {
    usuarioId: f.usuarioId || undefined,
    accion: f.accion || undefined,
    tipoEntidad: f.tipoEntidad || undefined,
    entidadId: f.entidadId.trim() || undefined,
    desde: f.desde !== "" ? periodo?.desde : undefined,
    hasta: f.hasta !== "" ? periodo?.hasta : undefined,
    limite: TAMANO_PAGINA,
  };
}

/**
 * Auditoría (CU-25; RF-46). Todos los filtros se combinan; los registros van del más reciente al más antiguo y
 * se cargan de 50 en 50. Cada fila se despliega para ver el valor previo y el nuevo.
 */
export default function Auditoria() {
  const sesion = useSesion();
  const [borrador, setBorrador] = useState<Filtros>(SIN_FILTROS);
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Map<string, string> | null>(null);

  // Los nombres de usuario solo se pueden listar con users.manage; sin ese permiso se muestra el id.
  const puedeListarUsuarios = tienePermiso(sesion, "users.manage");
  useEffect(() => {
    if (!puedeListarUsuarios) return;
    servidor
      .usuarios()
      .then((us) =>
        setUsuarios(new Map(us.map((u) => [u.id, u.nombreUsuario]))),
      )
      .catch(() => setUsuarios(null));
  }, [puedeListarUsuarios]);

  const consultar = useCallback(
    async (f: Filtros, despuesDe: string | null) => {
      setCargando(true);
      setError(null);
      try {
        const r = await servidor.auditoria({
          ...aConsulta(f),
          despuesDe: despuesDe ?? undefined,
        });
        setRegistros((previos) =>
          despuesDe === null ? r.registros : [...previos, ...r.registros],
        );
        setSiguiente(r.siguiente);
      } catch (e) {
        setError(mensajeDe(e));
      } finally {
        setCargando(false);
      }
    },
    [],
  );

  useEffect(() => {
    void consultar(filtros, null);
  }, [filtros, consultar]);

  const aplicar = (f: Filtros) => {
    setBorrador(f);
    setFiltros(f);
    setAbierto(null);
  };
  const cambiar = <K extends keyof Filtros>(campo: K, valor: Filtros[K]) =>
    setBorrador({ ...borrador, [campo]: valor });
  const nombreUsuario = (id: string | null) =>
    id === null ? "—" : (usuarios?.get(id) ?? id);
  const periodoInvalido =
    borrador.desde !== "" &&
    borrador.hasta !== "" &&
    borrador.desde > borrador.hasta;

  return (
    <>
      <Encabezado
        titulo="Auditoría"
        descripcion="Acciones sensibles: quién, qué, cuándo, sobre qué y con qué valores. Los filtros se combinan."
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <Campo etiqueta="Usuario">
            {usuarios !== null ? (
              <select
                className={CLASE_SELECT}
                value={borrador.usuarioId}
                onChange={(e) => cambiar("usuarioId", e.target.value)}
              >
                <option value="">Todos</option>
                {[...usuarios].map(([id, nombre]) => (
                  <option key={id} value={id}>
                    {nombre}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className="w-40"
                placeholder="Id de usuario"
                value={borrador.usuarioId}
                onChange={(e) => cambiar("usuarioId", e.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Acción">
            <select
              className={CLASE_SELECT}
              value={borrador.accion}
              onChange={(e) =>
                cambiar("accion", e.target.value as AccionAuditoria | "")
              }
            >
              <option value="">Todas</option>
              {AccionAuditoriaSchema.options.map((a) => (
                <option key={a} value={a}>
                  {ACCION[a]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Entidad">
            <select
              className={CLASE_SELECT}
              value={borrador.tipoEntidad}
              onChange={(e) =>
                cambiar(
                  "tipoEntidad",
                  e.target.value as TipoEntidadAuditada | "",
                )
              }
            >
              <option value="">Todas</option>
              {TipoEntidadAuditadaSchema.options.map((t) => (
                <option key={t} value={t}>
                  {ENTIDAD[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Id de la entidad">
            <Input
              className="w-44"
              value={borrador.entidadId}
              onChange={(e) => cambiar("entidadId", e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Desde">
            <Input
              type="date"
              value={borrador.desde}
              onChange={(e) => cambiar("desde", e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Hasta (incluido)">
            <Input
              type="date"
              value={borrador.hasta}
              onChange={(e) => cambiar("hasta", e.target.value)}
            />
          </Campo>
          <Button disabled={periodoInvalido} onClick={() => aplicar(borrador)}>
            Filtrar
          </Button>
          <Button variant="ghost" onClick={() => aplicar(SIN_FILTROS)}>
            Limpiar
          </Button>
        </CardContent>
      </Card>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {registros.map((r) => (
                <Fragment key={r.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setAbierto(abierto === r.id ? null : r.id)}
                  >
                    <TableCell className="whitespace-nowrap">
                      {fechaHora(r.ocurridoEn)}
                    </TableCell>
                    <TableCell>{nombreUsuario(r.usuarioId)}</TableCell>
                    <TableCell className="font-medium">
                      {ACCION[r.accion]}
                    </TableCell>
                    <TableCell>
                      {ENTIDAD[r.tipoEntidad]}
                      {r.entidadId !== null && (
                        <button
                          type="button"
                          title="Ver todo el historial de esta entidad"
                          className="ml-2 font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            aplicar({
                              ...SIN_FILTROS,
                              tipoEntidad: r.tipoEntidad,
                              entidadId: r.entidadId ?? "",
                            });
                          }}
                        >
                          {r.entidadId.length > 12
                            ? `${r.entidadId.slice(0, 8)}…`
                            : r.entidadId}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {r.motivo ?? ""}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {r.valorPrevio !== null || r.valorNuevo !== null
                        ? abierto === r.id
                          ? "Ocultar"
                          : "Detalle"
                        : ""}
                    </TableCell>
                  </TableRow>
                  {abierto === r.id && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6}>
                        <Detalle registro={r} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {!cargando && registros.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No hay registros con estos filtros.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
            <span>
              {registros.length} registro{registros.length === 1 ? "" : "s"}{" "}
              mostrados
              {siguiente !== null ? "; hay más." : "."}
            </span>
            {siguiente !== null && (
              <Button
                variant="outline"
                disabled={cargando}
                onClick={() => void consultar(filtros, siguiente)}
              >
                {cargando ? "Cargando…" : "Cargar más"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Detalle({ registro }: { registro: RegistroAuditoria }) {
  const cambiados = camposCambiados(registro.valorPrevio, registro.valorNuevo);
  return (
    <div className="flex flex-col gap-2 text-xs">
      {registro.entidadId !== null && (
        <div>
          <span className="text-muted-foreground">Id de la entidad: </span>
          <span className="font-mono">{registro.entidadId}</span>
        </div>
      )}
      {registro.motivo !== null && (
        <div>
          <span className="text-muted-foreground">Motivo: </span>
          {registro.motivo}
        </div>
      )}
      {cambiados.length > 0 && (
        <div>
          <span className="text-muted-foreground">Campos cambiados: </span>
          <span className="font-mono font-medium">{cambiados.join(", ")}</span>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Valor titulo="Valor previo" valor={registro.valorPrevio} />
        <Valor titulo="Valor nuevo" valor={registro.valorNuevo} />
      </div>
    </div>
  );
}

function Valor({
  titulo,
  valor,
}: {
  titulo: string;
  valor: RegistroAuditoria["valorPrevio"];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 font-medium">{titulo}</div>
      <pre className="max-h-72 overflow-auto rounded-md border bg-background p-2 font-mono">
        {valor === null ? "—" : JSON.stringify(valor, null, 2)}
      </pre>
    </div>
  );
}

/** Claves de primer nivel que difieren entre dos objetos; vacío si alguno no es un objeto. */
function camposCambiados(
  previo: RegistroAuditoria["valorPrevio"],
  nuevo: RegistroAuditoria["valorNuevo"],
): string[] {
  const esObjeto = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!esObjeto(previo) || !esObjeto(nuevo)) return [];
  const claves = new Set([...Object.keys(previo), ...Object.keys(nuevo)]);
  return [...claves].filter(
    (k) => JSON.stringify(previo[k]) !== JSON.stringify(nuevo[k]),
  );
}
