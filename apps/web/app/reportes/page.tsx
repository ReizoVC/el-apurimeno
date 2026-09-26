"use client";

import { useState, type ComponentProps } from "react";
import type {
  ReporteArqueos,
  ReporteOcupacion,
  ReporteVentas,
} from "@apurimeno/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apurimeno/ui/components/alert";
import { Badge } from "@apurimeno/ui/components/badge";
import { Button } from "@apurimeno/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@apurimeno/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@apurimeno/ui/components/table";
import { Aviso, Encabezado } from "../../src/componentes/comunes";
import {
  SelectorPeriodo,
  hoyLima,
  type Dias,
} from "../../src/componentes/Periodo";
import { useCarga } from "../../src/lib/carga";
import { periodoDeDias } from "../../src/lib/fechas";
import { fechaHora, soles } from "../../src/lib/formato";
import { ORIGEN_TICKET } from "../../src/lib/rotulos";
import { servidor } from "../../src/lib/servidor";

type Pestana = "ventas" | "arqueos" | "ocupacion";

/**
 * Reportes por periodo (§25, RF-47, RF-48) sobre las rutas del servidor; la agregación es de @apurimeno/domain.
 * El periodo son días de Lima, ambos incluidos.
 */
export default function Reportes() {
  const [dias, setDias] = useState<Dias>(() => ({
    desde: hoyLima(),
    hasta: hoyLima(),
  }));
  const [pestana, setPestana] = useState<Pestana>("ventas");

  const datos = useCarga(async () => {
    const periodo = periodoDeDias(dias.desde, dias.hasta);
    const [ventas, arqueos, ocupacion, metodos, usuarios, abiertos] =
      await Promise.all([
        servidor.reporteVentas(periodo),
        servidor.reporteArqueos(periodo),
        servidor.reporteOcupacion(periodo),
        servidor.metodosPago(),
        servidor.usuarios(),
        servidor.turnosAbiertos(),
      ]);
    const cajero = new Map(usuarios.map((u) => [u.id, u.nombreUsuario]));
    // Turnos del periodo (cerrados y abiertos), para nombrar al cajero en "por turno".
    const turnos = new Map(
      [...arqueos.turnos, ...abiertos].map((t) => [
        t.id,
        `${cajero.get(t.usuarioId) ?? "?"} · desde ${fechaHora(t.abiertoEn)}`,
      ]),
    );
    return {
      ventas,
      arqueos,
      ocupacion,
      metodo: new Map(metodos.map((m) => [m.id, m.nombre])),
      cajero,
      turnos,
    };
  }, [dias]);

  return (
    <>
      <Encabezado
        titulo="Reportes"
        descripcion={`Del ${dias.desde} al ${dias.hasta} (hora de Lima)`}
      />
      <SelectorPeriodo valor={dias} onCambio={setDias} />
      <div className="flex gap-1" role="tablist">
        {(
          [
            ["ventas", "Ventas"],
            ["arqueos", "Arqueos"],
            ["ocupacion", "Ocupación"],
          ] as const
        ).map(([id, etiqueta]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            variant={pestana === id ? "secondary" : "ghost"}
            onClick={() => setPestana(id)}
          >
            {etiqueta}
          </Button>
        ))}
      </div>
      {datos.error !== null && <Aviso tipo="error">{datos.error}</Aviso>}
      {datos.cargando && datos.datos === null && (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      )}
      {datos.datos !== null && pestana === "ventas" && (
        <Ventas
          reporte={datos.datos.ventas}
          metodo={datos.datos.metodo}
          turnos={datos.datos.turnos}
        />
      )}
      {datos.datos !== null && pestana === "arqueos" && (
        <Arqueos reporte={datos.datos.arqueos} cajero={datos.datos.cajero} />
      )}
      {datos.datos !== null && pestana === "ocupacion" && (
        <Ocupacion reporte={datos.datos.ocupacion} />
      )}
    </>
  );
}

function Tarjeta({
  titulo,
  children,
}: {
  titulo: string;
  children: ComponentProps<typeof CardContent>["children"];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TablaMontos({
  filas,
  total,
  columna,
}: {
  filas: { clave: string; etiqueta: string; total: number }[];
  total: number;
  columna: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{columna}</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((f) => (
          <TableRow key={f.clave}>
            <TableCell>{f.etiqueta}</TableCell>
            <TableCell className="text-right">{soles(f.total)}</TableCell>
          </TableRow>
        ))}
        {filas.length === 0 && (
          <TableRow>
            <TableCell colSpan={2} className="text-muted-foreground">
              Sin cobros en el periodo.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right">{soles(total)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function Ventas({
  reporte,
  metodo,
  turnos,
}: {
  reporte: ReporteVentas;
  metodo: Map<string, string>;
  turnos: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Qué cuenta como venta</AlertTitle>
        <AlertDescription>
          Los cobros emitidos en el periodo (ingresos, horas adicionales y
          ventas de tienda) que siguen vigentes. Un cobro anulado no cuenta, y
          su ticket compensatorio (la devolución) tampoco: los dos quedan fuera.
          Los movimientos manuales de caja no son ventas.
        </AlertDescription>
      </Alert>
      <div className="flex gap-8">
        <div>
          <p className="text-3xl font-bold">{soles(reporte.total)}</p>
          <p className="text-sm text-muted-foreground">Total vendido</p>
        </div>
        <div>
          <p className="text-3xl font-bold">{reporte.cantidadTickets}</p>
          <p className="text-sm text-muted-foreground">Cobros vigentes</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Por origen">
          <TablaMontos
            columna="Origen"
            total={reporte.total}
            filas={reporte.porOrigen.map((o) => ({
              clave: o.origen,
              etiqueta: ORIGEN_TICKET[o.origen],
              total: o.total,
            }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Por método de pago">
          <TablaMontos
            columna="Método"
            total={reporte.total}
            filas={reporte.porMetodoPago.map((m) => ({
              clave: m.metodoPagoId,
              etiqueta: metodo.get(m.metodoPagoId) ?? m.metodoPagoId,
              total: m.total,
            }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Por día">
          <TablaMontos
            columna="Día"
            total={reporte.total}
            filas={reporte.porDia.map((d) => ({
              clave: d.dia,
              etiqueta: d.dia,
              total: d.total,
            }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Por turno">
          <TablaMontos
            columna="Turno"
            total={reporte.total}
            filas={reporte.porTurno.map((t) => ({
              clave: t.turnoId,
              etiqueta: turnos.get(t.turnoId) ?? t.turnoId,
              total: t.total,
            }))}
          />
        </Tarjeta>
      </div>
      <Tarjeta titulo="Productos de la tienda">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reporte.porProducto.map((p) => (
              <TableRow key={p.productoId}>
                <TableCell>{p.descripcion}</TableCell>
                <TableCell className="text-right">{p.cantidad}</TableCell>
                <TableCell className="text-right">{soles(p.total)}</TableCell>
              </TableRow>
            ))}
            {reporte.porProducto.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  Sin ventas de tienda en el periodo.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Tarjeta>
    </div>
  );
}

function Arqueos({
  reporte,
  cajero,
}: {
  reporte: ReporteArqueos;
  cajero: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Turnos cerrados en el periodo. Diferencia = contado − esperado; negativa
        es faltante.
      </p>
      <div className="flex gap-8">
        <div>
          <p
            className={`text-3xl font-bold ${reporte.diferenciaTotal < 0 ? "text-destructive" : ""}`}
          >
            {soles(reporte.diferenciaTotal)}
          </p>
          <p className="text-sm text-muted-foreground">Diferencia total</p>
        </div>
        <div>
          <p className="text-3xl font-bold">{reporte.turnosConDiferencia}</p>
          <p className="text-sm text-muted-foreground">Turnos con diferencia</p>
        </div>
      </div>
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cajero</TableHead>
                <TableHead>Abierto</TableHead>
                <TableHead>Cerrado</TableHead>
                <TableHead className="text-right">Inicial</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead>Comentario</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reporte.turnos.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {cajero.get(t.usuarioId) ?? t.usuarioId}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fechaHora(t.abiertoEn)}
                  </TableCell>
                  <TableCell>
                    {t.cerradoEn === null ? "—" : fechaHora(t.cerradoEn)}
                    {t.cierreForzado && (
                      <Badge variant="outline" className="ml-2">
                        forzado por {cajero.get(t.cerradoPorId ?? "") ?? "?"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {soles(t.efectivoInicial)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {t.efectivoEsperado === null
                      ? "—"
                      : soles(t.efectivoEsperado)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {t.efectivoContado === null
                      ? "sin conteo"
                      : soles(t.efectivoContado)}
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right font-medium ${t.diferencia !== null && t.diferencia !== 0 ? "text-destructive" : ""}`}
                  >
                    {t.diferencia === null ? "—" : soles(t.diferencia)}
                  </TableCell>
                  <TableCell className="max-w-xs text-muted-foreground">
                    {t.comentarioCierre ?? ""}
                  </TableCell>
                </TableRow>
              ))}
              {reporte.turnos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    Ningún turno cerrado en el periodo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Ocupacion({ reporte }: { reporte: ReporteOcupacion }) {
  const ordenadas = [...reporte.habitaciones].sort(
    (a, b) => b.alquileres - a.alquileres || b.ingresos - a.ingresos,
  );
  // "Menos usada" solo entre las que tuvieron uso; las que no tuvieron ninguno se marcan aparte.
  const usadas = ordenadas.filter((h) => h.alquileres > 0);
  const max = usadas[0]?.alquileres ?? 0;
  const min = usadas.at(-1)?.alquileres ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Alquileres que ingresaron en el periodo y no fueron anulados. De la más
        usada a la menos usada (RF-48).
      </p>
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Habitación</TableHead>
                <TableHead className="text-right">Alquileres</TableHead>
                <TableHead className="text-right">Horas vendidas</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenadas.map((h) => (
                <TableRow
                  key={h.habitacionId}
                  className={h.alquileres === 0 ? "text-muted-foreground" : ""}
                >
                  <TableCell className="flex items-center gap-2">
                    {h.numero}
                    {max > min && h.alquileres === max && (
                      <Badge className="bg-emerald-600 text-white">
                        más usada
                      </Badge>
                    )}
                    {max > min && h.alquileres === min && (
                      <Badge variant="outline">menos usada</Badge>
                    )}
                    {h.alquileres === 0 && (
                      <span className="text-xs">sin uso</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{h.alquileres}</TableCell>
                  <TableCell className="text-right">
                    {h.horasVendidas}
                  </TableCell>
                  <TableCell className="text-right">
                    {soles(h.ingresos)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right">
                  {ordenadas.reduce((s, h) => s + h.alquileres, 0)}
                </TableCell>
                <TableCell className="text-right">
                  {ordenadas.reduce((s, h) => s + h.horasVendidas, 0)}
                </TableCell>
                <TableCell className="text-right">
                  {soles(ordenadas.reduce((s, h) => s + h.ingresos, 0))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
