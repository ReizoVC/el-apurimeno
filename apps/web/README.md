# web: Dashboard de El Apurimeño

Panel del Administrador (Next.js 15, App Router, solo componentes de cliente). Consulta y administra contra
`apps/server`: vista del día, reportes, habitaciones, clientes y precios especiales, usuarios y rangos,
configuración, métodos de pago, auditoría, turnos abiertos, códigos de anulación y reimpresión. No tiene reglas de negocio propias:
los tipos y esquemas vienen de `@apurimeno/contracts`, los componentes de `@apurimeno/ui`, y la vista previa
del comprobante usa `componerLineasComprobante` de `@apurimeno/domain`, la misma función que imprime el
servidor.

```bash
pnpm dev     # http://localhost:3000
pnpm build   # compila para producción; `pnpm start` la sirve
```

## Conexión con el servidor

Mismo patrón que `apps/native` y `apps/cleaning`:
- **URL:** `NEXT_PUBLIC_SERVIDOR_URL` (p. ej. `http://192.168.1.50:3001`). Por defecto, el mismo host desde
  el que se abrió el Dashboard, en el puerto 3001. Como es `NEXT_PUBLIC_`, se fija al compilar.
- **CORS:** en desarrollo el servidor ya acepta `http://localhost:3000`. En producción solo acepta el POS de
  escritorio, así que hay que agregar el origen del Dashboard: `CORS_ORIGINS=http://192.168.1.50:3000` (o la
  lista completa, separada por comas, si también se usa la app de limpieza).
- **Sesión:** usuario y contraseña contra `POST /auth/login`; solo entran cuentas con `dashboard.access`. El
  token queda en `localStorage` (`apurimeno.dashboard.sesion`). Un 401 vuelve al login.
- **Permisos:** el menú muestra solo las secciones que el usuario puede usar; el servidor vuelve a comprobar
  cada solicitud. Los mensajes de error del servidor (p. ej. `SELF_LOCKOUT_FORBIDDEN`) se muestran tal cual.

## Secciones

| Sección | Permiso | Qué hace |
|---|---|---|
| Vista general | `dashboard.access` | Ocupación de ahora, turnos abiertos e ingresos de hoy. Se refresca cada 30 s. |
| Reportes | `reports.view` | Ventas, arqueos y ocupación de un periodo. |
| Habitaciones | `rooms.manage` | Alta, edición, bloqueo con motivo (`rooms.maintenance`) y reactivación. |
| Clientes y precios | `client_pricing.manage` | Búsqueda, alta y edición de clientes; precios especiales por habitación. |
| Usuarios | `users.manage` | Alta, edición, desactivación, rangos y cambio de contraseña. |
| Rangos | `users.manage` | Alta y edición de la combinación de permisos. |
| Configuración | `settings.manage` | Parámetros de alquiler, comprobante, impresora y tienda. |
| Métodos de pago | `settings.manage` | Alta, edición y habilitación. |
| Auditoría | `audit.view` | Registros filtrables y paginados, con valor previo y nuevo. |
| Turnos abiertos | `shifts.force_close` | Turnos sin cerrar y cierre forzado. |
| Códigos de anulación | `tickets.void` | Generar un código de un solo uso para que un cajero anule un cobro (RF-65). |
| Reimpresión | `tickets.reprint` | Buscar un ticket y encolar su copia. |

## Decisiones de interfaz

- **Menú lateral fijo** agrupado en Administración, Sistema y Control. Cada página sigue el mismo patrón:
  la tabla a la izquierda y el formulario en un panel a la derecha, sin ventanas emergentes.
- **Días de Lima:** los periodos se eligen en días (desde y hasta, ambos incluidos) y se envían al servidor
  como `[desde, hasta)` en UTC. Lima es UTC−5 todo el año, así que un día empieza a las 05:00 UTC. Hay atajos:
  Hoy, Ayer, Últimos 7 días y Este mes.
- **Qué cuenta como venta:** Reportes lo explica arriba. Suma los cobros vigentes (ingresos, horas
  adicionales y tienda) emitidos en el periodo que siguen vigentes. Un cobro anulado queda fuera, y su
  compensatorio también. Los movimientos manuales de caja no son ventas. "Ingresos de hoy" en la vista
  general usa el mismo reporte.
- **Montos:** se escriben en soles (`25`, `25.5`, `25.50`) y viajan en céntimos enteros.
- **Formularios validados con el contrato:** la configuración se valida en el navegador con
  `ConfiguracionEntradaSchema`, así que un término fiscal en el comprobante se marca antes de enviar.
- **Leyenda del comprobante:** editable y obligatoria (decisión 21), con un enlace para restaurar la
  original. La vista previa muestra el comprobante exacto en 58 u 80 mm.
- **RN-43 visible:** junto a los parámetros de tiempo se aclara que solo rigen para los ingresos nuevos.
- **`afectaCaja`** se elige al crear el método de pago; al editar queda bloqueado con la razón a la vista
  (decisión 20).
- **Autobloqueo:** en la cuenta propia, "Cuenta activa" viene deshabilitado y un aviso explica que no puede
  quitarse el permiso de gestionar usuarios. Si lo intenta por los rangos, el servidor lo rechaza y se
  muestra su mensaje.
- **Rangos:** los permisos se agrupan por área (acceso, caja, alquileres, tienda, control), con la
  descripción en castellano y el código del catálogo al lado.
- **Auditoría:** los filtros se aplican con "Filtrar" y se paginan de 50 en 50 con el cursor del servidor
  ("Cargar más"). Cada fila se despliega y muestra los campos que cambiaron. El id de la entidad abre todo su
  historial.
- **Turnos abiertos:** muestran cuánto tiempo llevan abiertos, para detectar uno abandonado, pero no el
  esperado (RN-34). El esperado, el contado y la diferencia aparecen recién al cerrarlo. El propio turno no
  se fuerza: se cierra desde el POS.
- **Reimpresión:** se busca por número exacto o por periodo. Antes de reimprimir se ve el detalle del ticket;
  después, el contenido exacto de la copia (con COPIA) y el estado del trabajo en la cola. No hay una ruta
  para seguir el trabajo hasta "impreso", así que se informa el estado con el que quedó encolado.
- **Códigos de anulación:** un botón y nada más. El código se muestra grande, una sola vez, con su hora de
  vencimiento y la advertencia de que no se puede volver a ver: el servidor solo guarda su hash y el
  Dashboard no lo guarda en el navegador (recargar o salir lo borra de la pantalla).
- **Nombres de usuario:** listarlos exige `users.manage`. Sin ese permiso las pantallas muestran el id en vez
  de fallar enteras.
- **Colores de estado de habitación:** los mismos que el POS (libre verde, ocupada azul, por limpiar violeta,
  mantenimiento gris).
