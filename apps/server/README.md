# server

Backend local de **El Apurimeño**: Fastify + Prisma 7 + SQLite (modo WAL). Envuelve las funciones puras
de `@apurimeno/domain` y valida entradas y salidas con `@apurimeno/contracts`. Aquí no se reescribe
lógica de negocio: el servidor solo lee datos, llama al dominio, persiste el resultado en una
transacción y expone HTTP.

## Puesta en marcha

```bash
pnpm install                        # también genera el cliente de Prisma (postinstall)
cd apps/server
pnpm migrate                        # prisma migrate deploy: crea ./datos/apurimeno.db
SEED_ADMIN_PASSWORD='...' pnpm seed # configuración, métodos de pago, rangos, 17 habitaciones, usuario admin
pnpm dev                            # migra y levanta el servidor en 0.0.0.0:3001 con recarga
```

Variables de entorno (ver `.env.example`):

| Variable | Por defecto | Nota |
|---|---|---|
| `DATABASE_URL` | `file:./datos/apurimeno.db` | |
| `JWT_SECRET` | aleatorio por arranque | **Obligatorio en producción** (`NODE_ENV=production`), al menos 32 caracteres. En desarrollo, las sesiones se invalidan al reiniciar. |
| `HOST` / `PORT` | `0.0.0.0` / `3001` | Escucha en la red local para el POS, el Dashboard y la app de limpieza (RES-04). |
| `CORS_ORIGINS` | en desarrollo, `http://localhost` y `http://127.0.0.1` en los puertos 3000, 3002 y 3003; en producción, ninguno | Orígenes de navegador que pueden llamar a la API, separados por comas y exactos (esquema, host y puerto). No admite `*`: el servidor no arranca con un comodín o un origen mal formado. Para el celular de limpieza en la red del local: `CORS_ORIGINS=http://192.168.1.50:3002` (la IP de la máquina que sirve la app). |
| `SEED_ADMIN_USER` / `SEED_ADMIN_PASSWORD` | `admin` / — | Solo para `pnpm seed`. |

## Endpoints

Los cuerpos de entrada y salida están en `@apurimeno/contracts` (`api.ts`, constante `RUTAS`). Todos
requieren `Authorization: Bearer <token>`, salvo `/auth/login` y `/health`.

| Método y ruta | Operación (`puede()`) | Idempotente |
|---|---|---|
| `POST /auth/login` | pública | — |
| `GET /health` | pública | — |
| `POST /turnos` | `ABRIR_TURNO` | — |
| `POST /turnos/actual/cierre` | `CERRAR_TURNO` | — |
| `POST /alquileres/cotizacion` | `REGISTRAR_INGRESO` | — |
| `POST /alquileres` | `REGISTRAR_INGRESO` | Sí |
| `GET /alquileres/:id/hora-adicional/cotizacion` | `COBRAR_HORA_ADICIONAL` | — |
| `POST /alquileres/:id/horas-adicionales` | `COBRAR_HORA_ADICIONAL` | Sí |
| `POST /alquileres/:id/salida` | `REGISTRAR_SALIDA` | — |
| `POST /alquileres/:id/salida-sin-pago` | `REGISTRAR_SALIDA_SIN_PAGO` | — |
| `GET /categorias-producto` | `VENDER` o `GESTIONAR_PRODUCTOS` | — |
| `POST /categorias-producto` | `GESTIONAR_PRODUCTOS` | — |
| `GET /productos?codigoBarras=` | `VENDER` o `GESTIONAR_PRODUCTOS` | — |
| `POST /productos`, `PUT /productos/:id` | `GESTIONAR_PRODUCTOS` | — |
| `POST /productos/:id/reposicion` | `REPONER_INVENTARIO` | — |
| `POST /ventas` | `VENDER` | Sí |
| `POST /codigos-autorizacion` | `GENERAR_CODIGO_AUTORIZACION` | — |
| `POST /tickets/:id/anulacion` | `ANULAR_TICKET` o `ANULAR_TICKET_CON_CODIGO` | Sí |
| `GET /reportes/ventas?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `GET /reportes/arqueos?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `GET /reportes/ocupacion?desde=&hasta=` | `CONSULTAR_REPORTES` | — |
| `POST /turnos/actual/movimientos` | `REGISTRAR_MOVIMIENTO_CAJA` | Sí |
| `GET /habitaciones/pendientes-limpieza` | `VER_PENDIENTES_LIMPIEZA` | — |
| `POST /habitaciones/:id/lista` | `MARCAR_HABITACION_LISTA` | — (decisión 18) |
| `POST /habitaciones/:id/reporte-mantenimiento` | `REPORTAR_MANTENIMIENTO` | — (decisión 18) |
| `GET /habitaciones` | `CONSULTAR_TABLERO`, `GESTIONAR_HABITACIONES` o `BLOQUEAR_O_REACTIVAR_HABITACION` | — |
| `POST /habitaciones`, `PUT /habitaciones/:id` | `GESTIONAR_HABITACIONES` | — |
| `POST /habitaciones/:id/bloqueo`, `POST /habitaciones/:id/reactivacion` | `BLOQUEAR_O_REACTIVAR_HABITACION` | — |
| `GET /clientes?q=` | `BUSCAR_CLIENTE` o `GESTIONAR_PRECIO_ESPECIAL` | — |
| `POST /clientes`, `PUT /clientes/:id` | `REGISTRAR_CLIENTE` o `GESTIONAR_PRECIO_ESPECIAL` | — |
| `GET`/`POST /clientes/:id/precios-especiales` | `GESTIONAR_PRECIO_ESPECIAL` | — |
| `PUT`/`DELETE /clientes/:id/precios-especiales/:habitacionId` | `GESTIONAR_PRECIO_ESPECIAL` | — |
| `GET /usuarios`, `POST /usuarios`, `PUT /usuarios/:id` | `GESTIONAR_USUARIOS` | — |
| `PUT /usuarios/:id/contrasena` | `GESTIONAR_USUARIOS` | — |
| `GET /rangos` | `GESTIONAR_USUARIOS` | — |

Todavía faltan: gestión de rangos (CU-24), cierre forzado de turno (CU-20), configuración (CU-27),
métodos de pago, auditoría (CU-25), reimpresión (CU-22) y el tablero con estado temporal (`/rooms/board`).

### Limpieza (CU-15 a CU-17)

Coinciden con lo que `apps/cleaning` espera (`src/api-mock.ts`): una lista y dos acciones que se envían
solo con el id.
- `GET /habitaciones/pendientes-limpieza` devuelve **solo** las habitaciones en `PENDIENTE_LIMPIEZA`
  (RF-40). El filtro lo aplica el servidor; el de `app/page.tsx` queda como redundante.
- `POST /habitaciones/:id/lista` (`PENDIENTE_LIMPIEZA → LIBRE`) y `POST /habitaciones/:id/reporte-mantenimiento`
  (`PENDIENTE_LIMPIEZA → MANTENIMIENTO`) no llevan cuerpo. El reporte admite `{ "motivo": "..." }`
  opcional (RF-41: recomendado), que queda en la auditoría. Ambas responden la habitación actualizada.
- Sin `idempotency-key`: repetir la acción sobre una habitación que ya cambió responde 422
  `INVALID_STATE_TRANSITION` y no cambia nada. Con la eliminación optimista de `apps/cleaning`, ese 422
  (o un 403, 404 o error de red) debe devolver la tarjeta a la lista o avisar; hoy el mock no falla nunca.
- Si dos personas actúan a la vez sobre la misma habitación, solo una cambia el estado: la actualización
  exige que el estado siga siendo el leído.

### Administración

- **Habitaciones (CU-13, CU-14):** el alta queda `LIBRE`; editar cambia número, descripción y precio de
  lista, nunca el estado, y los alquileres abiertos conservan su precio (RN-44). Bloquear exige motivo y
  una habitación `LIBRE` (sin alquiler abierto); reactivar devuelve de `MANTENIMIENTO` a `LIBRE`.
- **Clientes (CU-09):** búsqueda parcial por documento o nombre (hasta 20 resultados). El cajero los
  registra al tomar un ingreso (operación `REGISTRAR_CLIENTE`, con `rentals.checkin`). El documento es
  único cuando existe (decisión 17 de contracts).
- **Precios especiales (CU-08):** el alta de una combinación que ya existe responde
  `CLIENT_ROOM_PRICE_ALREADY_EXISTS` (RF-16); se edita o elimina por cliente + habitación. Todo se audita.
- **Usuarios (CU-23):** alta, edición, desactivación (nunca eliminación) y asignación de rangos. La
  desactivación y el cambio de rangos rigen en la siguiente solicitud del usuario, aunque su token siga
  vigente (RF-63). Nadie puede desactivar su propia cuenta ni quitarse `users.manage`: responde 422
  `SELF_LOCKOUT_FORBIDDEN` (decisión 19); otro administrador sí puede. La contraseña (mínimo 8
  caracteres) nunca vuelve en una respuesta ni se audita.
  Cambiarla no invalida los tokens ya emitidos; desactivar la cuenta sí corta el acceso de inmediato.

### Movimientos manuales de caja (CU-18, RF-42)

Ingreso o retiro de efectivo en el turno abierto propio, con motivo y monto positivo. Entra en el
efectivo esperado del arqueo (RN-33). Es idempotente como un cobro: la clave se guarda en
`MovimientoCaja.claveIdempotencia`, y la misma clave usada por otro usuario responde 409.

### Anulación y códigos de autorización (CU-21, RN-46)

- Quien tiene `tickets.void` anula directamente. Un Cajero entra con `pos.access` (operación
  `ANULAR_TICKET_CON_CODIGO`) y debe enviar un código generado por un Administrador; Limpieza no puede
  entrar ni con código.
- El compensatorio se emite en el **turno abierto de quien anula**: la devolución sale de ese cajón.
  Un Administrador que anula también necesita su turno abierto.
- Efectos: anular un ingreso deja el alquiler `ANULADO` y la habitación `LIBRE` (exige anular antes las
  horas vigentes); anular una hora adicional recalcula la salida; anular una venta restituye el stock.
  El ingreso de un alquiler ya **cerrado** no se puede anular (`RENTAL_NOT_OPEN`): el cierre es
  definitivo (§20.2).
- El código tiene 6 dígitos de una fuente criptográfica y vence a los minutos configurados. Se guarda
  **solo su HMAC-SHA256** (`codigoHash`), con un secreto derivado de `JWT_SECRET`; el código en claro
  se muestra una única vez, al generarlo, y nunca se audita. En desarrollo, sin `JWT_SECRET` fijo, los
  códigos dejan de servir al reiniciar.
- Contra la fuerza bruta: tras **5 códigos incorrectos en 15 minutos**, el usuario queda bloqueado
  para anular con código hasta que pase la ventana. Cada intento fallido queda auditado.

### Reportes (§25)

El periodo es `[desde, hasta)` en UTC. La agregación es de `@apurimeno/domain` (`resumirVentas`,
`resumirArqueos`, `resumirOcupacion`); los días se cuentan en hora de Lima.
- **Ventas:** tickets emitidos en el periodo que siguen vigentes (cobros no anulados), por origen,
  método de pago, día, turno y producto.
- **Arqueos:** turnos cerrados en el periodo, con la suma de diferencias.
- **Ocupación:** alquileres ingresados en el periodo que no fueron anulados; horas vendidas e ingresos
  por habitación.

### Respuestas de error

Siempre `{ codigo, mensaje }` (`RespuestaError` en contracts):

| HTTP | `codigo` |
|---|---|
| 422 | Regla de negocio: `CodigoErrorNegocio` (`ROOM_NOT_AVAILABLE`, `OVERTIME_UNRESOLVED`, `SHIFT_NOT_OPEN`, …) |
| 400 | `VALIDACION`: el cuerpo no cumple el contrato |
| 401 | `NO_AUTENTICADO` |
| 403 | `PERMISO_DENEGADO` (queda auditado) |
| 404 | `NO_ENCONTRADO` |
| 409 | `CLAVE_IDEMPOTENCIA_REUTILIZADA` |
| 500 | `ERROR_INTERNO`: un defecto; se registra en el log |

## Lo que el dominio delegó al backend

1. **Un alquiler abierto por habitación (RN-27, T-15).** La base lo garantiza con un índice único
   parcial: `UNIQUE(habitacionId) WHERE estado = 'ABIERTO'`. Está declarado en el esquema con el preview
   `partialIndexes` de Prisma 7, así que la migración lo genera y Prisma lo conoce. Si dos cajeros
   ingresan a la vez, uno recibe `ROOM_NOT_AVAILABLE`. Lo mismo aplica a un turno abierto por usuario.
2. **Idempotencia de cobros (RF-59).** Cada cobro exige la cabecera `idempotency-key`, que se guarda en
   `Ticket.claveIdempotencia` (única). Un reintento con la misma clave devuelve el resultado original
   (HTTP 200, cabecera `idempotent-replayed: true`) sin cobrar de nuevo, aunque las dos solicitudes
   lleguen a la vez. Reutilizar una clave en otra operación responde 409.
3. **Permisos antes de cada ruta.** Un hook `onRequest` verifica el JWT, carga el usuario y sus rangos
   de la base (un cambio de rango rige en la siguiente solicitud, RF-63) y comprueba
   `puede(permisos, operacion)` de `@apurimeno/domain`. Toda ruta declara `config.operacion` o
   `config.publica`; si falta, el servidor no arranca. Los permisos condicionales (el ajuste puntual)
   se comprueban dentro de la ruta con `exigir()`.
4. **Huésped o público.** `RegistrarVentaEntrada.esHuesped` llega explícito desde el cajero en
   `POST /ventas`; el servidor no lo infiere de los alquileres (RES-02).

Además:
- **Auditoría (RN-42):** cada operación escribe su `RegistroAuditoria` en la misma transacción.
- **Autenticación (RN-40):** contraseñas con bcrypt (costo 12) y JWT de 12 horas. Un usuario
  desactivado pierde el acceso aunque su token no haya vencido. El login responde igual para un usuario
  inexistente que para una contraseña incorrecta.

## Esquema de base de datos

`prisma/schema.prisma` replica los tipos de `@apurimeno/contracts`: mismos nombres de modelo, de campo
y de enum. Las diferencias inevitables están documentadas al inicio del esquema:
- Las fechas son `DateTime` en la base y texto ISO en el contrato.
- Los objetos anidados son columnas `Json`, y las listas son tablas relacionadas.
- `Permiso` se guarda como texto, porque sus valores llevan punto.
- Algunas columnas existen solo en la base: `contrasenaHash`, `claveIdempotencia` y `posicion`.

`src/mapeo.ts` convierte en ambos sentidos y valida cada salida con su esquema de contracts.

## Pruebas

```bash
pnpm test
```

Son pruebas de integración contra SQLite real: cada suite usa un archivo temporal, le aplica las
migraciones del repo y la semilla, y ejercita la app por HTTP. El reloj del servidor se controla para
simular el paso del tiempo.
- `flujo-ingreso`: el flujo de punta a punta (turno, ingreso, hora adicional en sobretiempo, salida y
  arqueo) y los rechazos sin rastro.
- `concurrencia`: T-15 con solicitudes simultáneas, idempotencia (incluido el doble clic simultáneo),
  los índices parciales probados directamente contra la base, y el modo WAL.
- `autorizacion`: login, bcrypt, 401 y 403 con auditoría, cambio de rango en caliente, y rutas sin
  operación declarada.
- `tienda`: el servicio de venta con `esHuesped` explícito.
- `tienda-y-reportes`: catálogo, reposición, venta por HTTP y los tres reportes.
- `anulacion`: anulación de ingreso, hora adicional y venta; códigos de autorización (un solo uso,
  vencimiento, hash, límite de intentos).
- `limpieza-y-habitaciones`: la lista de limpieza (solo pendientes), marcar lista y reportar
  mantenimiento tal como los envía `apps/cleaning`, la carrera entre dos personas, y la administración
  de habitaciones.
- `cors`: la lista blanca de `CORS_ORIGINS` (sin comodines) y el preflight contra la API.
- `administracion`: clientes, precios especiales aplicados en la cotización, usuarios (desactivación y
  rangos en caliente) y movimientos de caja (arqueo e idempotencia).
