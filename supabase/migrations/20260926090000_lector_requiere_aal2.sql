-- Las cuentas de lectura (propietaria e hija) solo leen el resumen con la verificación en dos pasos hecha: su
-- sesión debe estar en el nivel aal2 (contraseña + código TOTP). Con solo la contraseña (aal1) no ven nada, ni
-- siquiera llamando a la API directamente. La cuenta del servidor (sincronizador) no usa TOTP y no cambia.
--
-- Además, espejo_mi_rol(): la vista de la propietaria pregunta con qué rol entró la cuenta, para rechazar a la
-- cuenta del servidor o a una sin acceso antes de pedir el código.
--
-- Se puede ejecutar más de una vez.

create or replace function privado.espejo_es_lector()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from privado.acceso_espejo a
    where a.user_id = (select auth.uid()) and a.rol = 'lector' and a.activo
  )
  and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

-- Rol de la cuenta que consulta ('lector' o 'sincronizador'), o null si no tiene acceso o está desactivada.
-- No exige aal2: se consulta justo después de la contraseña, para saber si hay que pedir el código.
create or replace function public.espejo_mi_rol()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.rol from privado.acceso_espejo a
  where a.user_id = (select auth.uid()) and a.activo;
$$;

revoke all on function public.espejo_mi_rol() from public, anon;
grant execute on function public.espejo_mi_rol() to authenticated;
