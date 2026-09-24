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

La tienda y los reportes todavía no tienen ruta. El servicio de venta (`src/servicios/tienda.ts`) ya
existe y está probado.

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
4. **Huésped o público.** `RegistrarVentaEntrada.esHuesped` llega explícito desde el cajero; el
   servidor no lo infiere de los alquileres (RES-02).

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
