# cleaning

App de limpieza para el celular del personal (CU-15 a CU-17): lista de habitaciones pendientes de
limpieza, "Marcar lista" y "Reportar mantenimiento". Habla con `apps/server`.

```bash
pnpm dev   # http://localhost:3002
```

## Conexión con el servidor

- **URL del servidor:** `NEXT_PUBLIC_SERVIDOR_URL` (p. ej. `http://192.168.1.50:3001`). Sin ella, la
  app usa la misma máquina que la sirve, en el puerto 3001: si el celular abre
  `http://192.168.1.50:3002`, la API queda en `http://192.168.1.50:3001`. Next la incorpora al
  compilar, así que va en el entorno de `pnpm dev` o `pnpm build`.
- **CORS:** el servidor debe tener el origen de la app en `CORS_ORIGINS`. En desarrollo ya acepta
  `http://localhost:3002`; desde el celular hay que agregar `http://<ip-del-local>:3002`.
- **Sesión:** usuario y contraseña contra `POST /auth/login`. Solo entran cuentas con
  `cleaning.access`. El token (JWT, 12 h) queda en `localStorage`; si el servidor responde 401
  (sesión vencida o cuenta desactivada), la app vuelve al login.

## Comportamiento ante errores

Una tarjeta solo sale de la lista cuando el servidor confirma la acción. Si falla (422 porque otra
persona ya atendió la habitación, 403, 404 o el servidor no responde), se muestra un aviso y se
recarga la lista. La lista también se actualiza sola cada 30 segundos y con "Actualizar".
