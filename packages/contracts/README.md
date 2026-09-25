# @apurimeno/contracts

Contrato de dominio compartido de **El Apurimeño**: tipos TypeScript y esquemas Zod que usan
el backend y los tres frontends (POS, Dashboard y app de limpieza).

Este paquete es el límite entre los agentes que construyen el sistema en paralelo (Claude, Codex,
Gemini/Antigravity). Ningún módulo define su propia versión de una `Habitacion`, un `Alquiler` o un
`Ticket`: se importan desde aquí. La fuente de verdad del negocio es el SRS (`docs/SRS_El_Apurimeno_Parte1.md`
y `Parte2.md`); cada tipo cita la regla (RN), el requisito (RF) o la sección que lo justifica.

---

## ⚠️ Política de cambios

**Todo cambio a `packages/contracts` pasa por revisión de Reizo antes de mergear a `main`.** Sin excepciones.

- Nada de merges directos. Cada cambio va en su propia rama y su propio PR.
- Si un módulo necesita un tipo o un campo que no existe, **primero** se agrega aquí, en una tarea
  separada y revisada, y **después** se usa. No se improvisa dentro de `apps/*` (Planos Técnicos §16.1).
- La descripción del PR indica si el cambio es:
  - **aditivo**: un tipo nuevo o un enum nuevo que nadie usa todavía; o
  - **incompatible**: renombrar o quitar un campo, cambiar un tipo, agregar un campo obligatorio,
    agregar un valor a un enum existente o endurecer una validación. Este caso exige avisar a los
    agentes que dependen del paquete.
- Todo campo nuevo cita la sección del SRS que lo justifica. Si el SRS no lo menciona, se pregunta
  antes de agregarlo.
- `pnpm --filter @apurimeno/contracts check-types` y `pnpm --filter @apurimeno/contracts test` deben
  pasar antes de pedir revisión.

---

## Cómo usarlo

### 1. Agregar la dependencia

En el `package.json` de la app o paquete que lo necesite:

```json
{
  "dependencies": {
    "@apurimeno/contracts": "workspace:*"
  }
}
```

Luego ejecutar `pnpm install` en la raíz. El paquete exporta TypeScript fuente (sin paso de build),
igual que `@apurimeno/ui`. Next.js, Vite y cualquier servidor Node con `tsx` o un bundler lo consumen
directamente.

### 2. Importar

Todo se importa desde la raíz del paquete:

```ts
import {
  AlquilerSchema,
  EstadoHabitacion,
  TicketSchema,
  type Alquiler,
  type Habitacion,
} from "@apurimeno/contracts";
```

Cada concepto exporta tres cosas con el mismo patrón:

| Export | Qué es | Ejemplo |
|---|---|---|
| `XSchema` | Esquema Zod para validar en tiempo de ejecución | `HabitacionSchema.parse(json)` |
| `type X` | Tipo TypeScript inferido del esquema | `const h: Habitacion = …` |
| `X` (solo en enums) | Objeto con los valores | `EstadoHabitacion.LIBRE` |

### 3. Validar en los bordes

- **Backend (Codex):** valida con `XSchema.parse` todo lo que entra y todo lo que sale. Si una fila
  de Prisma no pasa `XSchema`, el error está en el mapeo, no en el contrato.
- **Frontends (Antigravity y demás):** validan las respuestas del servidor con `XSchema.safeParse`
  antes de usarlas. Los tipos sirven para autocompletado, pero solo la validación protege en tiempo
  de ejecución.

```ts
const resultado = TicketSchema.safeParse(await respuesta.json());
if (!resultado.success) {
  // El servidor devolvió algo fuera del contrato: es un defecto y no debe ocultarse (§24.1 "Integridad").
  throw resultado.error;
}
const ticket = resultado.data;
```

---

## Convenciones del contrato

| Convención | Detalle | Fuente |
|---|---|---|
| Dinero | Siempre en **céntimos enteros** (`S/ 30.00` → `3000`). Nunca `float`. `Centimos` no admite negativos; `CentimosConSigno` solo aparece donde el SRS lo exige (compensatorios y diferencias de arqueo). | RN-37 |
| Fechas | Texto ISO-8601 en **UTC con sufijo `Z`** (`"2026-09-23T19:00:00.000Z"`). No son objetos `Date`. La hora de Lima se calcula al mostrar. | Planos §9.1 |
| Campos vacíos | Todos los campos están siempre presentes. La ausencia de valor es `null` explícito, nunca `undefined` ni un campo omitido. | — |
| Campos extra | Los objetos son `strict`: un campo que no está en el contrato es un error de validación. Así nadie filtra datos por accidente (por ejemplo, `passwordHash`) ni agrega campos por su cuenta. | RES-06 |
| Textos obligatorios | Se recortan espacios. Un motivo de solo espacios es inválido. | RN-12, RN-17 |
| Idioma | Tipos, campos y valores de enum en español. Excepción: los códigos de error y los permisos se escriben textualmente como en el SRS (inglés). | Decisión de proyecto |
| Invariantes | Las reglas que dependen de un solo objeto se validan en el esquema (por ejemplo, la suma de líneas igual al total, o un ajuste nunca a la baja). Las que dependen de otras entidades o del reloj las valida el backend. | §21 |

---

## Qué hay en el paquete

| Archivo | Contenido | SRS |
|---|---|---|
| `comun.ts` | `Id`, `Centimos`, `CentimosConSigno`, `FechaISO`, `TextoRequerido` | RN-37, §21 |
| `estados.ts` | Todos los enums de estado y tipo, y las tablas de transición | §19.2, §20 |
| `permisos.ts` | `Permiso` (catálogo fijo de 24) y `RANGOS_INICIALES` | RN-41, §22, §41.3 |
| `errores.ts` | `CodigoErrorNegocio` y sus mensajes. Los 9 códigos del SRS más `SHIFT_NOT_OPEN`, `RENTAL_NOT_OPEN`, `INVALID_STATE_TRANSITION` y `SELF_LOCKOUT_FORBIDDEN`, definidos por el proyecto | §24.2, §16, RN-32, §20 |
| `habitaciones.ts` | `Habitacion` | RN-13, §20.1 |
| `clientes.ts` | `Cliente`, `PrecioEspecialCliente` | RN-14 a RN-16 |
| `alquileres.ts` | `Alquiler`, `HoraAdicional`, `ParametrosTiempoPrecio`, `MINUTOS_HORA_ADICIONAL` | RN-01 a RN-12, RF-64 |
| `tickets.ts` | `Ticket`, `LineaTicket`, `Pago`, `MetodoPago`, `AjustePuntual`, `AnulacionTicket` | RN-17 a RN-19, RN-36, CU-21 |
| `caja.ts` | `Turno`, `MovimientoCaja` | RN-32 a RN-35 |
| `tienda.ts` | `Producto`, `CategoriaProducto`, `MovimientoInventario` | RN-20 a RN-26, RES-02 |
| `usuarios.ts` | `Usuario`, `Rango` | RN-40, RN-41 |
| `auditoria.ts` | `RegistroAuditoria`, `AccionAuditoria`, `CodigoAutorizacion` | RN-42, RN-46, §23 |
| `comprobantes.ts` | `TrabajoImpresion` | RN-38, RN-39, §20.5 |
| `configuracion.ts` | `ConfiguracionGlobal` | RN-43, §26 |
| `api.ts` | `RUTAS`, cuerpos de entrada y respuesta de la API local, `CABECERA_IDEMPOTENCIA`, `RespuestaError`: autenticación, turnos, alquileres, tienda, anulación y reportes | Planos §11, RF-59, §25 |

### Estados

| Enum | Valores | ¿Se guarda? |
|---|---|---|
| `EstadoHabitacion` | `LIBRE`, `OCUPADA`, `PENDIENTE_LIMPIEZA`, `MANTENIMIENTO` | Sí |
| `EstadoAlquiler` | `ABIERTO`, `CERRADO`, `ANULADO` | Sí |
| `EstadoTemporalAlquiler` | `A_TIEMPO`, `POR_VENCER`, `EN_CORTESIA`, `EN_SOBRETIEMPO` | **No, nunca** (RN-11). Se calcula con la hora del servidor. |
| `EstadoTicket` | `EMITIDO`, `ANULADO` | Sí |
| `EstadoTurno` | `ABIERTO`, `CERRADO` | Sí |
| `EstadoTrabajoImpresion` | `PENDIENTE`, `IMPRESO`, `ERROR` | Sí |

Para validar un cambio de estado se usa `esTransicionValida(TRANSICIONES_HABITACION, desde, hacia)`
(y sus equivalentes para alquiler, ticket, turno e impresión).

### Roles y permisos

Los **permisos** son un enum fijo: cada uno corresponde a una verificación real en el backend. Los
**rangos** (roles) son datos (`Rango`) que la propietaria configura. `RANGOS_INICIALES` (Administrador,
Cajero, Limpieza) son solo los datos semilla, no un enum cerrado. En el código se comprueban
**permisos**, nunca nombres de rango:

```ts
// ✅ Correcto
if (permisosDelUsuario.includes("tickets.void")) { … }
// ❌ Incorrecto: se rompe cuando la propietaria crea el rango "Supervisor"
if (rango.nombre === "Administrador") { … }
```

---

## Qué NO está aquí

- **Cálculos de negocio:** estado temporal, precio de ingreso, tipo de hora adicional y efectivo
  esperado. Esos cálculos viven en `packages/domain` como funciones puras con la tabla de pruebas
  §16.10 (Planos §3.3). Este paquete define la forma de los datos, no cómo se calculan. Ninguna
  interfaz calcula precio ni tiempo (§28.1).
- **Rutas de limpieza, administración y caja manual:** se agregan a `api.ts` cuando se construyan esos endpoints.
- **Credenciales de usuario:** nunca salen del backend.
- **Resumen sincronizado (espejo en la nube):** el SRS aún no define sus campos.

---

## Decisiones de interpretación del SRS

Estos puntos requirieron interpretar el SRS. Si alguno es incorrecto, se corrige aquí primero.

1. **"Transacción" es `Ticket`.** El SRS llama así al registro de toda operación cobrada (§18.1). Las
   líneas y los pagos viajan dentro del ticket.
2. **La anulación es un segundo ticket.** Es un ticket `COMPENSATORIO` con importes negativos, que
   apunta al original mediante `ticketOriginalId` y lleva el motivo y el código de autorización. El
   original pasa a `ANULADO` y no se edita más (RN-36, RF-29).
3. **El ajuste puntual vive en el ticket.** Se registra en `ajustePuntual` (monto original, monto
   ajustado y motivo) junto con una línea `AJUSTE_PUNTUAL` por la diferencia. El autor es
   `creadoPorId` (RF-19).
4. **Cada `HoraAdicional` es exactamente una hora** (RN-09, CU-05). Las horas pagadas al ingreso no
   generan `HoraAdicional`: se guardan en `Alquiler.horasAdicionalesAlIngreso` (RF-64).
5. **El alquiler guarda una copia de los parámetros de tiempo y precio vigentes al ingreso**
   (`parametrosAplicados`), para que los cambios de configuración no sean retroactivos (RN-43, PEND-08).
6. **El bloque de hora adicional es fijo en 60 minutos** (RN-09), aunque el anexo §41.2 lo lista entre
   los parámetros iniciales.
7. **Las ventas no referencian alquileres** (RES-02). Solo guardan `habitacionReferenciaId` como
   referencia. Si ese campo existe, se aplicó el precio de huésped (RF-22).
8. **Limpieza reporta mantenimiento con `cleaning.mark_ready`** (CU-17). `rooms.maintenance` queda
   para el bloqueo y la reactivación administrativos (CU-14).
9. **Ajustes en ventas usan `store.manual_adjustment`.** Es el "equivalente de tienda" que CU-10
   menciona sin nombrar; no está en §41.3 y lo agregó el proyecto. Tiene las mismas reglas que el ajuste
   de habitación: nunca por debajo del precio calculado y con motivo obligatorio (RN-17, RN-18).
   `rentals.manual_adjustment` queda exclusivo para ingresos y horas adicionales. El Cajero tiene ambos.
10. **`OCUPADA → LIBRE` es válido** solo al anular el ingreso (RF-30, escenario 31.5). El diagrama
    §20.1 no lo muestra.
11. **`permitirStockNegativo` es una configuración global** (RN-26 no dice si es global o por producto).
12. **Cliente:** el documento es texto libre, sin tipo de documento (§21). Se exige documento o nombre.
    No se incluye el teléfono (Planos §9.2 lo menciona, pero el SRS no).
13. **Consumo de la cortesía y hora adicional pedida en cortesía** (RF-08 solo define "aún no venció"
    y "ya pasó la cortesía"; esta regla la definió el proyecto y precisa RN-04 y RN-07).
    - **La cortesía se consume la primera vez que el alquiler entra en `EN_CORTESIA`**, pague o no el
      cliente durante esa ventana. Desde ahí `cortesiaConsumida` queda en `true` para el resto del
      alquiler y no se vuelve a otorgar, aunque se pacte una nueva hora de salida.
    - **Pagar una hora adicional mientras el alquiler está en `A_TIEMPO` o `POR_VENCER`** (antes de
      vencer) no consume la cortesía, porque el alquiler nunca entró en `EN_CORTESIA`. Se registra como
      `EXTENSION_ANTICIPADA`: la nueva salida es la salida vigente más 1 h.
    - **Pagar estando en `EN_CORTESIA`:** se registra como `EXTENSION_ANTICIPADA`, y la nueva salida es la
      salida vigente más 1 h (no el momento del pago más 1 h). La cortesía ya quedó consumida al entrar en
      esa ventana: si el cliente vuelve a pasarse de la nueva salida, pasa directo a `EN_SOBRETIEMPO`.
    - **Pagar estando en `EN_SOBRETIEMPO`:** se registra como `LIQUIDACION_SOBRETIEMPO`, como ya estaba
      definido. La nueva salida es el momento del pago más 1 h, sin nueva cortesía (RN-06, RN-07).

    El estado temporal no se guarda (RN-11), así que nadie escribe `cortesiaConsumida` en el instante en
    que empieza la ventana. Se persiste en la siguiente operación que cambia la salida: al registrar una
    hora adicional pagada en `EN_CORTESIA` o en `EN_SOBRETIEMPO`, `cortesiaConsumida` pasa a `true`.
    Hasta entonces, el cálculo del estado temporal usa la salida vigente, que no cambió, así que no hace
    falta ningún proceso en segundo plano. La regla se implementa en `packages/domain`.
14. **`Producto.codigoBarras` es único, pero lo garantiza la base de datos**, no el contrato: el contrato
    valida un objeto a la vez y no puede ver los demás productos. Nota para el esquema de Prisma: declarar
    `codigoBarras String? @unique`. `UNIQUE` admite varios `NULL`, así que varios productos pueden no tener
    código. El tipo en el contrato sigue siendo `string | null`.
15. **Cierre con diferencia de arqueo exige comentario** (resuelve PEND-05). Si el cajero cierra su turno
    y el efectivo contado no coincide con el esperado (`diferencia ≠ 0`), debe escribir
    `comentarioCierre`, sin importar el monto: no hay umbral. No requiere código de autorización. Sin
    diferencia, el comentario es opcional. En un cierre forzado (CU-20), el comentario es opcional.
16. **Contraseña de al menos 8 caracteres** (`CONTRASENA_MINIMA`). El SRS no fija una longitud; la decidió
    el proyecto. Se aplica al crear un usuario y al cambiar su contraseña, no al iniciar sesión.
17. **`Cliente.documento` es único cuando existe**, y lo garantiza la base de datos (igual que la decisión
    14). El documento es la clave preferida (§32): dos clientes con el mismo documento repartirían sus
    precios especiales entre ambos y el cajero no sabría cuál elegir. Varios clientes pueden no tener
    documento. El nombre no es único.

    > **Nota para el futuro (usuarios):** cambiar la contraseña no cierra sesiones abiertas — revisar si
    > se necesita invalidarlas en caso de sospecha de cuenta comprometida. Hoy los tokens ya emitidos
    > siguen vigentes hasta vencer (12 h); desactivar la cuenta sí corta el acceso de inmediato.
18. **Los cambios de estado de una habitación no llevan `idempotency-key`** (Planos §11.1 lo pide para
    "operaciones que cambian una habitación"). La máquina de estados ya evita el doble efecto: repetir
    "marcar lista" sobre una habitación que ya está `LIBRE` responde `INVALID_STATE_TRANSITION` y no
    cambia nada. Así las rutas de limpieza coinciden con lo que `apps/cleaning` envía hoy (solo el id).
    Los movimientos manuales de caja sí la llevan: repetirlos duplicaría el efectivo.
19. **Nadie se deja a sí mismo sin acceso de administración** (`SELF_LOCKOUT_FORBIDDEN`, CU-23). Al
    editar su propia cuenta, un usuario no puede desactivarla ni quedarse sin `users.manage` en los
    rangos que se asigna. Otro usuario con `users.manage` sí puede hacerlo. El SRS no trae esta regla;
    la pidió el negocio para no quedar sin nadie que administre las cuentas.

## Decisiones pendientes que afectan el contrato

| ID | Tema | Estado en el contrato |
|---|---|---|
| — | Vigencia por defecto del código de autorización (RF-65: "algunos minutos") | Configurable (`minutosVigenciaCodigoAutorizacion`), sin valor inicial definido |
