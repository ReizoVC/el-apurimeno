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
| `comun.ts` | `Id`, `Centimos`, `CentimosConSigno`, `FechaISO`, `TextoRequerido`, `Milesimas` e `importeDeLinea` (decisión 31) | RN-37, §21 |
| `estados.ts` | Todos los enums de estado y tipo, y las tablas de transición | §19.2, §20 |
| `permisos.ts` | `Permiso` (catálogo fijo de 24) y `RANGOS_INICIALES` | RN-41, §22, §41.3 |
| `errores.ts` | `CodigoErrorNegocio` y sus mensajes. Los 9 códigos del SRS más `SHIFT_NOT_OPEN`, `RENTAL_NOT_OPEN`, `INVALID_STATE_TRANSITION`, `SELF_LOCKOUT_FORBIDDEN` e `INVALID_QUANTITY` (decisión 31), definidos por el proyecto | §24.2, §16, RN-32, §20 |
| `habitaciones.ts` | `Habitacion` | RN-13, §20.1 |
| `clientes.ts` | `Cliente`, `PrecioEspecialCliente` | RN-14 a RN-16 |
| `alquileres.ts` | `Alquiler`, `HoraAdicional`, `ParametrosTiempoPrecio`, `MINUTOS_HORA_ADICIONAL` | RN-01 a RN-12, RF-64 |
| `tickets.ts` | `Ticket`, `LineaTicket`, `Pago`, `MetodoPago`, `AjustePuntual`, `AnulacionTicket` | RN-17 a RN-19, RN-36, CU-21 |
| `caja.ts` | `Turno`, `MovimientoCaja` | RN-32 a RN-35 |
| `tienda.ts` | `Producto` (con unidad, SKU, costo y mínimos), `CategoriaProducto`, `MovimientoInventario` | RN-20 a RN-26, RES-02, decisión 31 |
| `usuarios.ts` | `Usuario`, `Rango` | RN-40, RN-41 |
| `auditoria.ts` | `RegistroAuditoria`, `AccionAuditoria`, `CodigoAutorizacion` | RN-42, RN-46, §23 |
| `comprobantes.ts` | `TrabajoImpresion`, `CausaFallaImpresora` y sus mensajes, `EstadoImpresora`, `LogoComprobante` | RN-38, RN-39, §20.5, RF-56, RNF-OBS-01 |
| `configuracion.ts` | `ConfiguracionGlobal` | RN-43, §26 |
| `espejo.ts` | `ResumenDia`, `ResumenTurno` y sus filas de Postgres, `EstadoEspejo` (estado de la sincronización) | ADR-06, RN-45, RF-60, RF-61 |
| `respaldo.ts` | Frecuencias y retención de los respaldos, `EstadoRespaldos`, `RespaldarEntrada` | Planos §14.3, RNF-BKP-01, RNF-REC-02 |
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
    la pidió el negocio para no quedar sin nadie que administre las cuentas. Vale también al editar un
    rango que el usuario tiene asignado.
20. **`MetodoPago.afectaCaja` no se edita** una vez creado el método. El efectivo esperado de un turno
    abierto se calcula con el valor actual de cada método (RN-35): cambiarlo alteraría arqueos en curso
    sin que nadie lo note. Para otro comportamiento se crea un método nuevo y se deshabilita el anterior.
    Nombre, número de referencia y habilitación sí se editan (RF-54).
21. **La leyenda al pie del comprobante es configurable** (`DatosComprobante.leyenda`). La pidió el negocio,
    para poder reformularla rápido si cambia su situación tributaria. Por defecto es
    `LEYENDA_COMPROBANTE_POR_DEFECTO` ("Documento interno sin valor tributario."). RN-39 sigue
    vigente: la leyenda no puede quedar vacía, siempre se imprime al pie y pasa el mismo control de
    términos y series fiscales que el resto del comprobante. Mientras el sistema no emita comprobantes
    electrónicos, un texto como "Boleta" seguiría imitando uno fiscal. `datosAdicionales` queda para la
    dirección del local o un mensaje breve.
22. **Contenido del espejo en la nube** (`espejo.ts`; ADR-06, RN-45, RF-60). El SRS no define los campos del
    "resumen sincronizado"; los fijó el proyecto con los mismos cálculos de los reportes locales:
    - `ResumenDia`: por cada día de Lima, las ventas vigentes (total, por origen y por método de pago con su
      nombre), los cobros del día que hoy están anulados, y la ocupación por habitación de los alquileres que
      ingresaron ese día.
    - `ResumenTurno`: el arqueo de cada turno **cerrado**, con el nombre del cajero y el comentario de cierre
      recortado a 200 caracteres. Los turnos abiertos no viajan: su esperado es secreto hasta el cierre (RN-34).
    - **Ocupación es histórica, nunca en vivo.** RN-45 dice que la propietaria no quiere ver el tablero desde
      fuera: no se sincroniza el estado de las habitaciones ni cuáles están ocupadas ahora. No hay "% de
      ocupación": el SRS no define su denominador.
    - **Nunca salen del local:** clientes, tickets individuales, productos, auditoría, usuarios ni
      configuración (RIE-08).
    - **Autenticación remota:** RNF-SEG-06 pide "la misma autenticación que el sistema local"; ADR-06 elige
      Supabase Auth. Se interpreta como la misma exigencia (credenciales individuales, nunca acceso anónimo),
      no las mismas credenciales: las cuentas remotas son aparte y solo leen el resumen.

23. **Respaldos de la base** (`respaldo.ts`; Planos §14.3, RNF-BKP-01, RNF-REC-02). Los Planos piden una copia
    local cada 15 minutos y una diaria fuera del equipo, pero no fijaban destino, retención, hora ni cifrado. Los
    decidió la propietaria:
    - **Local:** cada 15 minutos en el disco del equipo; se guardan 24 horas.
    - **Ventana de 2 horas en la nube** (decidida por la propietaria después de la auditoría del 26/09): cada copia
      local, comprimida y cifrada, también va a la carpeta sincronizada como `apurimeno-reciente-….db.gz.cifrado`;
      ahí se guardan solo las últimas 8 (`COPIAS_RECIENTES_EXTERNAS`). Si se pierde el equipo, lo perdido ronda los
      15 minutos más lo que tarde Drive u OneDrive en subir el archivo.
    - **Externa:** una por día a las **04:00 de Lima**; si el servidor estaba apagado a esa hora, apenas vuelve a
      encender. Va a **una carpeta local que la propietaria sincroniza con la nube** (Google Drive u OneDrive); no
      hay soporte para discos USB. Se guardan **30 días**.
    - **La copia externa va cifrada.** La clave privada se genera una vez, se muestra una sola vez y la guarda la
      propietaria en su gestor de contraseñas: nunca en el repositorio ni junto a las copias. Por eso el cifrado es
      de clave pública (el servidor solo tiene la pública, que no sirve para abrir las copias).
    - **Si la copia externa falla**, el Dashboard lo muestra con el mismo "Desactualizado" del espejo.
    - **Restauración:** procedimiento escrito (`docs/RESPALDO_Y_RESTAURACION.md`) y un comando que la automatiza
      (`pnpm restaurar`).

    Detalles fijados por el proyecto, que solo agregan protección: la copia más reciente nunca se borra por
    retención (si las copias dejan de hacerse, la carpeta no queda vacía; las recientes se retienen por cantidad,
    así que también quedan las últimas 8); una falla de la copia reciente no cuenta como falla de la local; si la externa falla, se reintenta cada
    15 minutos; y "Desactualizado" aparece en las locales tras 30 minutos sin copia (dos intervalos, como el
    espejo) y en la externa una hora después de las 04:00 sin la copia del día (`MARGEN_RESPALDO_EXTERNO_MINUTOS`).
24. **El catálogo sin inactivos, salvo para gestionarlo** (`ProductosConsulta.incluirInactivos`). `GET /productos`
    devuelve solo los productos activos: es lo que vende el POS. La pantalla de productos del Dashboard necesita
    también los inactivos, o un producto desactivado no se podría volver a activar; los pide con
    `incluirInactivos=true`, que exige `inventory.manage`.

25. **El aviso de diferencia del arqueo ciego no sirve para adivinar el esperado** (RN-34; lo pidió el negocio tras
    la auditoría del 26/09). Si lo contado no coincide, el servidor responde `REASON_REQUIRED` sin decir por cuánto;
    sin más control, alguien podía probar montos por la API hasta que un cierre se aceptara sin comentario.
    - **Cada intento de cierre del turno propio queda en la auditoría con el monto contado y la hora:** el aceptado
      como `TURNO_CERRADO` (con `cierresRechazados`), el rechazado como `CIERRE_TURNO_RECHAZADO` y el que llega sin
      un código válido cuando hace falta como `ACCESO_DENEGADO`.
    - **Tras `MAX_CIERRES_RECHAZADOS_SIN_CODIGO` (3) rechazos, cada intento consume un código** de autorización de
      un Administrador, con el mismo mecanismo de las anulaciones (RN-46): 6 dígitos, un solo uso, vigencia
      configurable y bloqueo tras 5 códigos incorrectos en 15 minutos. El código es de la operación
      `REINTENTAR_CIERRE_TURNO` y registra el turno en `CodigoAutorizacion.turnoId`; uno de anulación no sirve.
    - El código se consume aunque el intento vuelva a rechazarse: el rechazo se confirma en la transacción y el error
      se responde después.
    - El cierre forzado de un turno ajeno (CU-20) no cambia.

26. **Por qué no se imprimió un comprobante, en palabras del cajero** (`CausaFallaImpresora`,
    `MENSAJE_FALLA_IMPRESORA`, `EstadoImpresora`; RF-56, §20.5, RNF-OBS-01, §24.1). El SRS pide reintentar y que el
    cobro siga firme, pero no dice qué ve el cajero. Cambio **aditivo**: tipos nuevos y dos rutas nuevas
    (`/impresora/estado`, `/impresora/reintento`); `TrabajoImpresion` no cambia.
    - Cinco causas, con códigos en inglés como los de error: `PRINTER_DISCONNECTED`, `PRINTER_OUT_OF_PAPER`,
      `PRINTER_COVER_OPEN`, `PRINTER_OVERHEATED` y `PRINTER_ERROR` (el resto). El servidor las deduce del estado de la
      impresora (ESC/POS `DLE EOT`) o de la falta de conexión; cada una tiene un mensaje que dice qué pasa y qué hacer,
      sin códigos ni luces. La tapa y la temperatura son causas distintas aunque en la RED-E803 prendan las mismas
      luces: la impresora las informa por separado, y lo que hay que hacer es distinto.
    - La causa es del **último intento**, no de cada trabajo: es un estado de la impresora. No se guarda en la base;
      el trabajo sigue con `PENDIENTE`, `IMPRESO` o `ERROR`.
    - `comprobantesEnEspera` cuenta los `PENDIENTE` y `ERROR` de los últimos 15 minutos: los que el servidor todavía
      reintenta solo. Los más viejos quedan en `ERROR` y se reimprimen como copia si hace falta (CU-22). Los detalles
      (intentos, esperas) están en `apps/server/README.md`, "Impresión".
    - `problemaConfiguracion` y `problemaLogo`: un error en `IMPRESORA_DISPOSITIVO` o en `IMPRESORA_LOGO` no detiene
      el servidor (sin servidor no hay cobros), pero tampoco puede quedar solo en el registro: el Dashboard lo
      muestra en la Vista general, y el POS avisa al cajero si la impresora quedó sin configurar. Son textos para la
      persona que instala, no causas para el cajero: no llevan código.
27. **La vista previa del comprobante muestra el logotipo del servidor** (`LogoComprobante`, `GET /impresora/logo`).
    El logotipo no lo compone el dominio: lo agrega el servidor al armar los bytes ESC/POS, y depende de
    `IMPRESORA_LOGO` en cada servidor (el del negocio, otro PNG o ninguno). Para que la vista previa de la
    Configuración sea fiel al papel, el Dashboard le pide al servidor el logotipo que tiene cargado, en vez de llevar
    una copia propia que podría no coincidir. Cambio **aditivo**: un tipo y una ruta nuevos, con el permiso de la
    Configuración (`CONFIGURAR_PARAMETROS`). El Dashboard lo dibuja centrado y a la escala del texto (un carácter de
    la fuente A = 12 puntos), y lo omite en un papel más angosto que el logotipo, igual que el servidor.
28. **Las categorías se renombran y se eliminan; una con productos, solo moviéndolos a otra**
    (`PUT` y `DELETE /categorias-producto/:id`, `EliminarCategoriaConsulta.moverA`). El SRS solo pide crear productos
    y asignarles categoría (CU-29). Solo `Producto` referencia a la categoría, y los tickets y reportes no guardan su
    nombre, así que eliminarla no altera ninguna venta: no hace falta un estado "inactiva". Los productos inactivos
    también cuentan, porque usan la categoría igual. Se audita con `CATEGORIA_RENOMBRADA` y `CATEGORIA_ELIMINADA`
    (cuántos productos se movieron y a dónde). Cambio **aditivo**, con el permiso de `GESTIONAR_PRODUCTOS`.
29. **Corregir el stock y vender sin stock** (`SALIDA` y `CONTEO` en el kardex, `POST /productos/:id/salida` y
    `/conteo`, `GET /movimientos-inventario`, `confirmarSinStock`). El SRS solo prevé venta, anulación y reposición, y
    sin más no hay forma de registrar una merma ni de corregir un stock desfasado. La propietaria decidió además que
    se pueda vender sin stock, con aviso y control:
    - **Venta sin stock:** RN-26 la permite con una configuración, así que `permitirStockNegativo` sigue siendo el
      interruptor, pero en una instalación nueva viene activado. Con él, además, el cajero tiene que confirmar el aviso
      (`confirmarSinStock`); sin confirmar se rechaza con `INSUFFICIENT_STOCK`. No pide código de autorización, para
      que nadie quede trabado de noche: el control es `VENTA_SIN_STOCK` en la auditoría y el stock negativo a la vista.
    - **Salida:** resta con motivo obligatorio (fijo desde la decisión 31) y no puede sacar más de lo que hay
      (`INSUFFICIENT_STOCK`): si lo físico no cuadra con el sistema, corresponde un conteo.
    - **Conteo:** deja el stock en lo contado y guarda la diferencia en el kardex, también si es 0, para que quede la
      constancia de que se contó.
    - **`stockVisto`:** si el stock cambió desde que la pantalla lo leyó, se rechaza (`INVALID_STATE_TRANSITION`).
    - **Historial:** los últimos `LIMITE_MOVIMIENTOS_INVENTARIO`, sin paginar, con el saldo calculado desde el stock
      actual. Los movimientos siguen sin editarse ni borrarse (RN-36): un error se corrige con otro movimiento.

    Todo exige `inventory.manage`, salvo vender. Cambio **aditivo** para los clientes viejos, porque
    `confirmarSinStock` vale `false` si no llega. `MovimientoInventario.motivo` es un campo nuevo de la respuesta.
30. **Aviso de versiones nuevas, con firma** (`actualizacion.ts`, `GET /actualizacion`, permiso `system.update`). Pedido
    para que el local reciba las versiones sin depender de una orden por SSH. Quien entra a la cuenta de GitHub no debe
    poder ofrecerle al local una versión falsa, así que cada publicación lleva un `ManifiestoVersion` firmado con Ed25519.
    La clave privada solo está en el equipo de quien publica; el servidor tiene la pública en
    `ACTUALIZACION_CLAVE_PUBLICA`. Sin ella, no se revisa nada (`SIN_CONFIGURAR`), igual que la instancia de capacitación.
    - **Qué no se ofrece:** nada con la firma mala o sin firma, ni una etiqueta que no coincida con la versión firmada
      (`FIRMA_INVALIDA`, alerta en el Dashboard). Tampoco lo que no sea posterior a la instalada.
    - **Sin internet:** se conserva la última revisión, sin alerta. Solo sale hacia GitHub; no abre ningún puerto.
    - **Versión instalada:** la de `apps/native/src-tauri/tauri.conf.json` del checkout, que solo avanza a etiquetas.
    - **Rápida o completa:** es lo que se le anticipa al personal. `ManifiestoVersion.ultimaCompleta` guarda la última
      versión que exigió detener los servicios, y por eso acierta aunque el local se salte versiones. El actualizador
      sigue decidiendo por su cuenta con `git diff`.
    - **Permiso nuevo:** se separa de `settings.manage` para poder dárselo a alguien sin darle la configuración. Una
      migración lo agrega al rango Administrador en las bases que ya existen.

    - **Instalar desde el Dashboard** (`POST /actualizacion/instalacion`): solo la versión disponible, y solo si no hay
      otra instalación en curso. Queda `ACTUALIZACION_INICIADA` en la auditoría, antes de lanzar la tarea, porque el
      servidor se va a reiniciar. El actualizador comprueba otra vez la firma con el código ya instalado, así que lo que
      el servidor haya creído no alcanza para instalar nada. Quien pulsa cierra el POS: un POS abierto bloquearía la
      actualización. No se bloquea con un turno abierto, porque ni los turnos ni las ventas se pierden.
    - **`GET /health` trae las versiones** (`SaludRespuesta`). Es público en la red del local y no lleva nada más: el POS
      y Limpieza necesitan saber de la versión nueva aunque quien esté adentro no tenga `system.update`.

    `ManifiestoVersion` no es `.strict()`: un servidor sin actualizar tiene que poder leer el manifiesto de una versión
    que agregue campos. Por lo mismo, tampoco lo son las respuestas de `GET /actualizacion` (`EstadoActualizacion`,
    `VersionDisponible`, `UltimaInstalacion`) ni `SaludRespuesta`: justo después de actualizar las lee una página
    compilada con la versión anterior, que tiene que poder mostrar el resultado y "Recargar" aunque la nueva agregue
    campos. Cambio **aditivo**.
31. **Ficha de producto y cantidades en milésimas: la base para la papelería y la ferretería.** El SRS (§9, RES-02)
    deja fuera los otros dos negocios de la propietaria. El 08/11/2026 ella decidió prepararlos en nueve etapas, en una
    sola base con los tres negocios: traslados de bebidas y consumibles, cada mostrador con su PC e impresora, y sin
    ventas al por mayor ni a crédito. Esta es la etapa 1.
    - **Cantidades en milésimas enteras** (`MilesimasSchema`, `MILESIMAS_POR_UNIDAD`): el stock, el kardex, las entradas
      de salida, conteo y reposición, y `LineaTicket.cantidad`. 2,5 m = 2500; una habitación o una hora = 1000. Enteros
      y no decimales, por la misma razón que el dinero va en céntimos (RN-37).
    - **Importe de una línea** (`importeDeLinea`): cantidad × precio por unidad / 1000, al céntimo más cercano, con las
      mitades hacia afuera del cero. Con unidades enteras no redondea nada, y el compensatorio da exactamente el
      opuesto del original.
    - **Unidad del producto** (`UnidadMedida`): unidad, metro, kilo o litro. Solo UNIDAD exige cantidades enteras;
      si no, `INVALID_QUANTITY`. La línea del ticket no guarda la unidad: va en su descripción ("Cable mellizo (m)"). La
      unidad solo cambia mientras el producto no tenga movimientos ni ventas, para no reinterpretar el pasado. Caja,
      docena y paquete no son unidades: son presentaciones (etapa 8).
    - **Ficha:** `sku` (código interno único, para volver a importar sin duplicar), `costo` por unidad, y `stockMinimo`
      y `stockOptimo`. El costo solo lo ve quien tiene `inventory.manage`: para quien solo vende, llega `null`.
    - **Salidas con motivo fijo** (`MotivoSalida`): vencido, dañado, pérdida, consumo interno, traslado a otro negocio u
      otro, para poder sumar las mermas. `motivo` pasa a ser el detalle, obligatorio solo con OTRO. Mientras los otros
      negocios no estén en el sistema, lo que se lleva a ellos se registra como salida por TRASLADO.
    - **Un POS viejo no cobra mal:** la venta pasa a enviar `cantidadMilesimas` en vez de `cantidad`. Un POS anterior,
      que envía unidades enteras, es rechazado por el contrato en vez de vender 0,002 de cada producto.

    Cambio **incompatible** con los clientes anteriores, a propósito: el POS, el Dashboard y el servidor se actualizan
    juntos. Una migración multiplica por 1000 las cantidades guardadas y deja las salidas anteriores con el motivo OTRO;
    lo que ya quedó en la auditoría conserva sus cantidades en unidades.

## Decisiones pendientes que afectan el contrato

| ID | Tema | Estado en el contrato |
|---|---|---|
| — | Vigencia por defecto del código de autorización (RF-65: "algunos minutos") | Configurable (`minutosVigenciaCodigoAutorizacion`), sin valor inicial definido |
