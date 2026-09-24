# @apurimeno/domain

Reglas de negocio de **El Apurimeño** como funciones puras sobre los tipos de `@apurimeno/contracts`.
Es la única fuente de verdad del cálculo de tiempo, precio y caja (Planos Técnicos §3.3): ningún otro
paquete recalcula estas reglas, y las interfaces nunca calculan precio ni tiempo (SRS §28.1).

- **Sin efectos secundarios:** no usa base de datos, red ni reloj del sistema. La hora (`ahora`) y el
  generador de ids se reciben como parámetros (`Contexto`). Por eso todo se puede probar.
- **Inmutable:** nunca modifica lo que recibe; devuelve objetos nuevos que el backend persiste.
- **Validado contra el contrato:** toda entidad que devuelve pasa por su esquema de `@apurimeno/contracts`.

La misma política de cambios de `packages/contracts` aplica aquí: **todo cambio pasa por revisión antes
de mergear a `main`**, porque un error en este paquete es dinero mal cobrado (RIE-01).

## Uso

```json
{ "dependencies": { "@apurimeno/domain": "workspace:*" } }
```

```ts
import { ErrorNegocio, iniciarAlquiler, armarTicketCobro, pagoEnEfectivo } from "@apurimeno/domain";

try {
  const { alquiler, habitacion, cotizacion } = iniciarAlquiler(
    { habitacion, clienteId, preciosEspeciales, parametros: configuracion.parametrosAlquiler, horasAdicionalesAlIngreso: 0, turno },
    { ahora: new Date().toISOString(), generarId: cuid },
  );
  const ticket = armarTicketCobro(
    {
      numero,
      origen: "INGRESO_ALQUILER",
      turno,
      alquilerId: alquiler.id,
      habitacionReferenciaId: null,
      cotizacion,
      pagos: [pagoEnEfectivo(efectivo.id, cotizacion.total, montoRecibido)],
      creadoPorId: usuario.id,
    },
    ctx,
  );
  // El backend persiste alquiler, habitación y ticket en UNA transacción.
} catch (error) {
  if (error instanceof ErrorNegocio) {
    // error.codigo es un CodigoErrorNegocio estable: ROOM_NOT_AVAILABLE, PAYMENT_INSUFFICIENT, ...
  }
  throw error;
}
```

### Errores

| Tipo | Cuándo | Qué hace quien llama |
|---|---|---|
| `ErrorNegocio` (`codigo` estable) | Se rompe una regla de negocio: sin turno, sobretiempo sin resolver, ajuste a la baja, stock insuficiente, etc. | Lo devuelve al usuario con `MENSAJE_ERROR_NEGOCIO[codigo]` |
| `RangeError` o `ZodError` | Datos que violan el contrato: montos con decimales, ids que no coinciden, una entidad inválida | Es un defecto: no se oculta (§24.1 "Integridad") |

## Módulos

| Archivo | Funciones principales |
|---|---|
| `tiempo.ts` | `calcularSalidaInicial`, `calcularEstadoTemporal`, `calcularHoraAdicional` |
| `precios.ts` | `resolverPrecioHabitacion`, `cotizarIngreso`, `cotizarHoraAdicional`, `aplicarAjustePuntual`, `precioProducto`, `cotizarVenta` |
| `alquileres.ts` | `iniciarAlquiler`, `registrarHoraAdicional`, `registrarSalida`, `registrarSalidaSinPago`, `aplicarAnulacionHoraAdicional`, `aplicarAnulacionIngreso` |
| `habitaciones.ts` | `ocuparHabitacion`, `liberarPorSalida`, `marcarHabitacionLista`, `reportarMantenimiento`, `bloquearPorMantenimiento`, `reactivarHabitacion`, `liberarPorAnulacion` |
| `caja.ts` | `asegurarTurnoAbierto`, `calcularEfectivoEsperado`, `cerrarTurno`, `forzarCierreTurno`, `prepararMovimientoCaja` |
| `inventario.ts` | `aplicarVentaAInventario`, `reponerStock`, `revertirVentaEnInventario` |
| `tickets.ts` | `pagoEnEfectivo`, `pagoSinVuelto`, `armarTicketCobro`, `validarInvariantesTicket` |
| `anulacion.ts` | `crearCodigoAutorizacion`, `validarCodigoAutorizacion`, `anularTicket` |
| `permisos.ts` | `permisosEfectivos`, `puede`, `PERMISO_POR_OPERACION`, `permisoAjustePuntual` |

## Trazabilidad RN-01 a RN-46

Las pruebas se nombran con la regla que verifican (`describe("RN-xx · …")`). La tabla obligatoria
§16.10 (T-01 a T-16) está completa en `test/tabla-16-10.test.ts` (criterio de aceptación §33).

| RN | Regla | Implementación | Prueba |
|---|---|---|---|
| RN-01 | 8 horas base, configurables | `calcularSalidaInicial` | tiempo |
| RN-02 | Sin devolución por salida anticipada | `registrarSalida` | alquileres |
| RN-03 | Aviso 10 min antes | `calcularEstadoTemporal` (`POR_VENCER`) | tiempo |
| RN-04 | Cortesía de 15 min, una vez | `calcularEstadoTemporal` (`EN_CORTESIA`) | tiempo |
| RN-05 | Superada la cortesía: pagar o retirarse | `calcularEstadoTemporal` (`EN_SOBRETIEMPO`) | tiempo |
| RN-06 | Sobretiempo: nueva salida desde el pago | `calcularHoraAdicional` | tiempo |
| RN-07 | La cortesía no vuelve | `calcularHoraAdicional`, `calcularEstadoTemporal` | tiempo |
| RN-08 | Horas anticipadas (al ingreso y durante) | `calcularSalidaInicial`, `cotizarIngreso`, `calcularHoraAdicional` | tiempo, precios |
| RN-09 | Bloque de una hora completa | `calcularHoraAdicional`, `cotizarHoraAdicional` | tiempo |
| RN-10 | Precio fijo de la hora adicional | `cotizarHoraAdicional` | precios |
| RN-11 | Estado temporal calculado, nunca guardado | `calcularEstadoTemporal` | tiempo |
| RN-12 | No cerrar en sobretiempo sin resolver | `registrarSalida`, `registrarSalidaSinPago` | alquileres |
| RN-13 | Precio individual por habitación | `resolverPrecioHabitacion` | precios |
| RN-14 | El precio especial reemplaza al de lista | `resolverPrecioHabitacion` | precios |
| RN-15 | El precio especial solo en su habitación | `resolverPrecioHabitacion` | precios |
| RN-16 | Solo `client_pricing.manage` | `puede` | permisos |
| RN-17 | Ajuste puntual con motivo | `aplicarAjustePuntual`, `permisoAjustePuntual` | precios, permisos |
| RN-18 | El ajuste nunca a la baja | `aplicarAjustePuntual` | precios |
| RN-19 | El ajuste solo en esa transacción | `aplicarAjustePuntual` | precios |
| RN-20 | Dos precios por producto | `precioProducto` | precios |
| RN-21 | Stock único | `aplicarVentaAInventario` | inventario |
| RN-22 | Precio de huésped si hay alquiler abierto | `cotizarVenta` (`esHuesped` lo decide el backend, ver abajo) | precios |
| RN-23 | Todo se cobra en el momento | `armarTicketCobro`, `pagoEnEfectivo` | tickets |
| RN-24 | Asociar venta a habitación es opcional | `cotizarVenta`, `armarTicketCobro` | tickets |
| RN-25 | Solo `inventory.manage` repone | `puede`, `reponerStock` | permisos, inventario |
| RN-26 | Sin stock negativo salvo configuración | `aplicarVentaAInventario` | inventario |
| RN-27 | Un alquiler abierto por habitación | `ocuparHabitacion` + índice único en la base de datos (ver abajo) | habitaciones, T-15 |
| RN-28 | Solo desde "Libre" | `ocuparHabitacion` | habitaciones |
| RN-29 | Salida → pendiente de limpieza | `liberarPorSalida` | habitaciones, alquileres |
| RN-30 | Limpieza marca lista, sin el cajero | `marcarHabitacionLista` | habitaciones |
| RN-31 | Mantenimiento hasta reactivar | `reportarMantenimiento`, `bloquearPorMantenimiento`, `reactivarHabitacion` | habitaciones |
| RN-32 | Nada sin turno abierto | `asegurarTurnoAbierto` (en ingreso, hora adicional, ticket, movimiento y anulación) | caja, alquileres, tickets |
| RN-33 | Efectivo esperado | `calcularEfectivoEsperado` | caja |
| RN-34 | Arqueo ciego | `cerrarTurno` (el orden de pantallas lo aplica el POS) | caja |
| RN-35 | Pagos digitales fuera del efectivo | `calcularEfectivoEsperado` | caja |
| RN-36 | Corregir sin borrar | `anularTicket` | anulacion |
| RN-37 | Céntimos enteros | Validación de montos en todas las funciones | precios, tickets |
| RN-38 | Comprobante sin datos del cliente | Las descripciones de línea no los incluyen (`cotizarIngreso`) | precios |
| RN-39 | Comprobante no fiscal | **Fuera de domain:** `DatosComprobanteSchema` (contracts) y la impresión (backend) | contracts |
| RN-40 | Cuentas individuales | **Fuera de domain:** autenticación (backend) | — |
| RN-41 | Permisos fijos, rangos configurables | `permisosEfectivos`, `puede` | permisos |
| RN-42 | Auditoría inmutable | **Fuera de domain:** el backend escribe `RegistroAuditoria` en la misma transacción | contracts |
| RN-43 | Configuración no retroactiva | `iniciarAlquiler` copia los parámetros; el resto usa `parametrosAplicados` | alquileres, tiempo, precios |
| RN-44 | Precio de habitación no retroactivo | `iniciarAlquiler` guarda `precioHabitacionAplicado` | alquileres |
| RN-45 | Resumen remoto con demora | **Fuera de domain:** sincronización con la nube | — |
| RN-46 | Código de autorización temporal | `crearCodigoAutorizacion`, `validarCodigoAutorizacion`, `anularTicket` | anulacion |

## Lo que queda para el backend

Implementado en `apps/server` (ver su README):

- **Concurrencia (RN-27, RF-58):** `ocuparHabitacion` rechaza una habitación que no está libre, pero
  dos cajeros pueden leerla libre al mismo tiempo. La garantía final es el índice único parcial
  `UNIQUE(habitacionId) WHERE estado = 'ABIERTO'` (Planos §9.4) y la transacción.
- **Idempotencia (RF-59):** la cabecera `idempotency-key` de cada cobro, guardada en el ticket.
- **Permisos:** el backend comprueba `puede(permisos, operacion)` antes de llamar a cada función.
  Excepción: en `anularTicket`, la vía del código de autorización es lógica de negocio y va dentro.
- **Huésped o público (RN-22):** `esHuesped` lo indica el cajero de forma explícita en la venta;
  ni el dominio ni el backend lo infieren, porque la tienda no conoce alquileres (RES-02).
- **Código de autorización:** el valor lo genera el backend con una fuente aleatoria criptográfica
  (pendiente: la anulación aún no tiene ruta).
- **Auditoría (RN-42):** cada operación exitosa se registra en la misma transacción.

## Decisiones del proyecto

Resuelven puntos que el SRS dejaba abiertos.

### Anular una hora adicional (§32)

Al anular el ticket de una hora adicional, `aplicarAnulacionHoraAdicional` recalcula la salida programada
desde la **salida base** (ingreso + horas base + horas pagadas al ingreso) con **solo las horas adicionales
que siguen vigentes**. La hora anulada deja de contar: el cliente no conserva ese tiempo.

Las horas vigentes se aplican en orden cronológico, cada una con su regla:
- **Extensión anticipada:** suma 1 h a la salida acumulada. Si todas son anticipadas, la salida es la base
  más la suma de las horas vigentes.
- **Liquidación de sobretiempo:** fija la salida en su momento de pago + 1 h (RN-06), porque así se pactó.
  Si se sumara como una hora más sobre la base, el cliente perdería tiempo que sí pagó.

`cortesiaConsumida` no cambia, porque entrar en cortesía es un hecho que ya ocurrió. Un alquiler cerrado no
se modifica, porque su salida ya es historia. Anular el ingreso sigue exigiendo anular antes sus horas
vigentes (escenario 31.5).

### Arqueo con diferencia (PEND-05)

Si el efectivo contado no coincide con el esperado, `cerrarTurno` exige un comentario (`REASON_REQUIRED`)
para cualquier diferencia, sin umbral y sin código de autorización. Sin diferencia, el comentario es
opcional. En el cierre forzado (CU-20) el comentario es opcional. El comentario se guarda en
`Turno.comentarioCierre` (decisión 15 de contracts).
