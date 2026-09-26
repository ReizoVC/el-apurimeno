# native: POS de El Apurimeño

Punto de venta del cajero (Tauri v2 + Vite + React). Trabaja todo el turno contra `apps/server`:
tablero de habitaciones, ingresos, horas adicionales, salidas, anulaciones, tienda y caja. No tiene reglas
de negocio propias: los tipos vienen de `@apurimeno/contracts`, los componentes de `@apurimeno/ui`, y lo
que se calcula en pantalla (estado temporal, total del carrito) usa las mismas funciones de
`@apurimeno/domain` que el servidor, que siempre vuelve a validar al cobrar.

```bash
pnpm dev          # solo la interfaz, en http://localhost:1420
pnpm tauri dev    # la aplicación de escritorio (requiere Rust)
```

## Conexión con el servidor

Mismo patrón que `apps/cleaning`:
- **URL:** `VITE_SERVIDOR_URL` (p. ej. `http://192.168.1.50:3001`). Por defecto `http://localhost:3001`,
  porque en el local el POS y el servidor corren en la misma máquina (Planos §4.3).
- **CORS:** el servidor acepta siempre los orígenes del POS de escritorio (`tauri://localhost` y
  `http://tauri.localhost`) y, en desarrollo, `http://localhost:1420`.
- **Sesión:** usuario y contraseña contra `POST /auth/login`; solo entran cuentas con `pos.access`. El
  token queda en `localStorage`. Un 401 (sesión vencida, cuenta desactivada) vuelve al login.
- **Cobros:** cada uno lleva su `idempotency-key`, generada al preparar el cobro y conservada si el envío
  falla: reintentar nunca cobra dos veces (RF-59).

## Pantallas

| Pestaña | Qué hace |
|---|---|
| (sin turno) | Abrir turno con el efectivo inicial. Sin turno no se cobra (RN-32). |
| Habitaciones | Tablero por piso. Libre → panel de ingreso; ocupada → estado en vivo, hora adicional, salida, anular, reimprimir. |
| Tienda | Lector de código de barras, búsqueda, carrito, huésped o público, cobro. |
| Caja | Movimientos manuales y cierre con arqueo ciego. |

## Decisiones de interfaz

- **Piso:** se toma del número de la habitación (205 → piso 2), solo para agrupar; pisos de abajo hacia
  arriba. El piso no es un dato del sistema (RN-13).
- **Colores de estado:** libre verde, a tiempo azul, por vencer ámbar, en cortesía naranja, sobretiempo
  rojo, por limpiar violeta, mantenimiento gris. El color siempre va con una etiqueta escrita.
- **Estado temporal en vivo:** el tablero se pide cada 15 s y trae la hora del servidor. Entre consultas, el
  POS recalcula el estado cada segundo con `calcularEstadoTemporal` del dominio sobre esa hora corregida
  (RF-07: nunca la hora del equipo).
- **Panel lateral** en vez de ventanas emergentes: el tablero sigue a la vista mientras se cobra.
- **Un método de pago por cobro.** El contrato admite varios, pero el caso normal es uno. En efectivo se
  pide lo recibido y se muestra el vuelto; vacío significa pago exacto.
- **Ajuste puntual** oculto tras "Ajustar precio…", y solo para quien tiene el permiso.
- **Anulación:** se elige el cobro en la lista del alquiler. El campo del código de autorización solo
  aparece si el usuario no tiene `tickets.void`.
- **Arqueo ciego:** el comentario se pide sin revelar el esperado ni la diferencia; ambos aparecen
  recién con el turno cerrado.
- **Movimientos de caja:** se listan los registrados en la sesión; el servidor no tiene todavía una ruta
  para listar los del turno.
- **Turno cerrado por un Administrador (CU-20):** el POS lo nota en la siguiente recarga (15 s) y vuelve a
  pedir la apertura.
- **Ventana:** 1280×800, mínimo 1024×700.

## Impresión

Cada cobro imprime su comprobante desde el servidor (ADR-05): el POS no habla con la impresora. Ver
"Impresión" en `apps/server/README.md`.
