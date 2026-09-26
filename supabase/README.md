# supabase: espejo en la nube

Base de datos del espejo en la nube (ADR-06): el resumen que el servidor del local publica y que la propietaria
lee desde fuera. Qué contiene: decisión 22 de `packages/contracts/README.md`. Cómo se sincroniza: sección
"Espejo en la nube" de `apps/server/README.md`.

```
migrations/20260926063000_espejo.sql                 tablas, row-level security y funciones de acceso
migrations/20260926090000_lector_requiere_aal2.sql   las lectoras solo leen con verificación en dos pasos (aal2)
```

Las migraciones se aplican **en orden** y todas; cada una se puede volver a ejecutar sin error.

## Quién puede qué

| Cuenta | Rol en `privado.acceso_espejo` | Puede |
|---|---|---|
| Servidor del local | `sincronizador` | Insertar y actualizar `resumen_dia`, `resumen_turno` y `estado_espejo` (y leerlas, porque un upsert lo necesita). Nada más. |
| Propietaria, hija | `lector` | Leer esas tres tablas, **solo con la verificación en dos pasos hecha** (sesión `aal2`). Con solo la contraseña no ven nada. |
| Cualquier otra cuenta, o sin sesión | — | Nada. |

- Nadie tiene `DELETE`. `privado.acceso_espejo` no se expone por la API: solo se administra desde el editor SQL.
- Las políticas consultan `privado.espejo_es_lector()` y `privado.espejo_es_sincronizador()` (`security
  definer`), que leen `acceso_espejo` sin que las cuentas tengan acceso a esa tabla.
- Desactivar una cuenta (`activo = false`) corta su acceso en la siguiente consulta, sin esperar a que venza
  su sesión.
- La clave **secreta** del proyecto no se usa en ninguna parte: ignora estas políticas. El servidor rechaza
  arrancar el espejo con ella.

## Instalación en un proyecto nuevo

Se hace una vez por proyecto (prueba y producción), desde el panel de Supabase.

### 1. Aplicar el SQL

**SQL Editor → New query**: pegar el contenido completo de `migrations/20260926063000_espejo.sql` y pulsar
**Run**. Luego, en una consulta nueva, lo mismo con `migrations/20260926090000_lector_requiere_aal2.sql`.

- Resultado esperado: `Success. No rows returned`.
- Se puede volver a ejecutar sin error: crea lo que falta y rehace las políticas.
- Si el editor avisa de "operaciones destructivas" (por los `drop policy if exists`), confirmar: solo
  reemplazan las políticas de estas tablas.

### 2. Comprobar

En el mismo editor, una consulta a la vez:

```sql
select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (('public', 'resumen_dia'), ('public', 'resumen_turno'),
                                 ('public', 'estado_espejo'), ('privado', 'acceso_espejo'))
order by 1, 2;
```

Esperado: 4 filas, todas con `rls` = `true`.

```sql
select tablename as tabla, count(*) as politicas
from pg_policies
where schemaname = 'public' and tablename in ('resumen_dia', 'resumen_turno', 'estado_espejo')
group by tablename order by 1;
```

Esperado: 3 filas (`estado_espejo`, `resumen_dia`, `resumen_turno`), cada una con `politicas` = `3`.

```sql
select grantee, table_name as tabla, string_agg(privilege_type, ', ' order by privilege_type) as permisos
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('resumen_dia', 'resumen_turno', 'estado_espejo')
group by 1, 2 order by 2;
```

Esperado: 3 filas, todas de `authenticated` con `INSERT, SELECT, UPDATE`. Ninguna de `anon`.

```sql
select p.proname as funcion, pg_get_functiondef(p.oid) like '%aal2%' as exige_aal2
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('privado', 'espejo_es_lector'), ('public', 'espejo_mi_rol'))
order by 1;
```

Esperado: 2 filas: `espejo_es_lector` con `exige_aal2` = `true` y `espejo_mi_rol` con `false` (esa no lo exige a
propósito: se consulta antes de pedir el código).

### 1b. Verificación en dos pasos (TOTP)

**Authentication → Multi-Factor** (o **Sign In / Providers → Multi-Factor Authentication**, según la versión del
panel): **TOTP** debe estar habilitado (*Enabled*). Viene así por defecto en los proyectos nuevos. Si estuviera
deshabilitado, la vista de la propietaria no puede dar de alta el autenticador y lo dice.

### 3. Cerrar el registro público

**Authentication → Sign In / Providers**: desactivar **Allow new users to sign up** y guardar.

Las cuentas se crean a mano (pasos siguientes). Aunque alguien se registrara, no vería nada, porque no
estaría en `acceso_espejo`; pero sin registro público ni siquiera puede crear la cuenta.

### 4. Cuenta del servidor (`sincronizador`)

1. **Authentication → Users → Add user → Create new user.**
   - Email: una dirección que controle, p. ej. un alias de su correo (`sucorreo+apurimeno-sync@gmail.com`).
     No se usa para recibir correos.
   - Password: una contraseña larga y generada (20 caracteres o más). Es la que va en el `.env` del
     servidor.
   - Marcar **Auto Confirm User**.
2. En el **SQL Editor**, con el email que usó:

   ```sql
   insert into privado.acceso_espejo (user_id, rol, nota)
   select id, 'sincronizador', 'servidor del local' from auth.users where email = 'EMAIL-DE-LA-CUENTA'
   returning user_id, rol, activo;
   ```

   Esperado: 1 fila con `rol` = `sincronizador` y `activo` = `true`. Si sale vacío, el email no coincide
   con el de la cuenta creada.
3. En el equipo del local, en `apps/server/.env`:

   ```
   ESPEJO_SUPABASE_URL="https://<proyecto>.supabase.co"
   ESPEJO_SUPABASE_ANON_KEY="sb_publishable_..."
   ESPEJO_SYNC_EMAIL="EMAIL-DE-LA-CUENTA"
   ESPEJO_SYNC_PASSWORD="..."
   ```

   La URL y la clave publicable están en **Project Settings → API Keys** (la publicable, nunca la
   secreta). Reiniciar el servidor: en el registro debe aparecer `Espejo en la nube` y, a los pocos
   segundos, `Espejo sincronizado`.

### 5. Cuentas de lectura (propietaria e hija)

Cada lectora da de alta su autenticador (Google Authenticator, Microsoft Authenticator…) la primera vez que
entra a la vista de la propietaria: la app muestra el código QR. Si pierde el celular, se le quita el
autenticador desde **Authentication → Users → (la cuenta) → Factors** (o borrando su fila de
`auth.mfa_factors`) y lo vuelve a dar de alta al entrar.

Igual que la del servidor, con el email real de cada una y `rol` = `lector`:

1. **Authentication → Users → Add user → Create new user**, con su email y una contraseña inicial;
   marcar **Auto Confirm User**.
2. En el **SQL Editor**:

   ```sql
   insert into privado.acceso_espejo (user_id, rol, nota)
   select id, 'lector', 'propietaria' from auth.users where email = 'EMAIL-DE-LA-PROPIETARIA'
   returning user_id, rol, activo;
   ```

   Esperado: 1 fila. Repetir con el email de la hija y `'hija'` en la nota.

## Administración

```sql
-- Quién tiene acceso
select u.email, a.rol, a.activo, a.nota, a.creado_en
from privado.acceso_espejo a join auth.users u on u.id = a.user_id order by a.rol, u.email;

-- Cortar el acceso de una cuenta de inmediato (se puede reactivar con true)
update privado.acceso_espejo set activo = false
where user_id = (select id from auth.users where email = 'EMAIL')
returning user_id, rol, activo;
```

Para cambiar la contraseña de la cuenta del servidor: **Authentication → Users → (la cuenta) → Reset
password** o eliminarla y crearla de nuevo (repitiendo el `insert`), y actualizar `ESPEJO_SYNC_PASSWORD`.

## Un solo servidor por proyecto

Cada sincronización **reemplaza** los días que publica con lo que hay en la base del servidor que sincroniza.
Si se apunta a este proyecto un servidor con otra base (una de prueba, una recién instalada), sus días vacíos
reemplazan a los reales. Por eso el proyecto de producción solo debe tener en su `.env` el servidor del local,
y las pruebas usan un proyecto aparte. Si pasara, basta con una sincronización completa desde el servidor del
local ("Re-sincronizar todo") para volver a publicar los datos correctos.

## Plan gratuito de Supabase

- **Pausa por inactividad:** el proyecto se pausa tras unos 7 días sin actividad. Mientras el servidor del
  local esté encendido sincroniza cada 30 minutos y no llega a pausarse; si el local estuvo apagado más de
  una semana, hay que reanudarlo desde el panel.
- **Sin copias de seguridad automáticas:** el espejo es reconstruible. Una sincronización completa
  (`POST /espejo/sincronizacion` con `{ "completo": true }`, el botón "Re-sincronizar todo" del Dashboard)
  vuelve a publicar todo el historial desde la base del local.
