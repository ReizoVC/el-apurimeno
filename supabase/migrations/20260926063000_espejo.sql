-- Espejo en la nube de El Apurimeño (ADR-06, RN-45, RF-60, RF-61).
--
-- Resumen de solo lectura para la propietaria: ventas y ocupación por día de Lima, y arqueos de turnos cerrados.
-- Lo escribe solo el servidor del local (cuenta con rol "sincronizador"); lo leen solo las cuentas con rol
-- "lector". Nadie borra filas. Nada de aquí escribe hacia el sistema local (RNF-SYNC-01).
--
-- Se puede ejecutar más de una vez: crea lo que falta y rehace las políticas.

-- ---------------------------------------------------------------------------------------------------------
-- Quién puede entrar: un esquema privado que la API de datos no expone.
-- ---------------------------------------------------------------------------------------------------------

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
-- Las políticas de abajo llaman a funciones de este esquema: quien consulta necesita poder "ver" el esquema,
-- pero no sus tablas (revocadas más abajo).
grant usage on schema privado to authenticated;

create table if not exists privado.acceso_espejo (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  rol        text not null check (rol in ('lector', 'sincronizador')),
  -- Poner en false corta el acceso en la siguiente consulta, sin esperar a que venza la sesión.
  activo     boolean not null default true,
  -- Para quién es la cuenta: "propietaria", "hija", "servidor del local".
  nota       text,
  creado_en  timestamptz not null default now()
);
comment on table privado.acceso_espejo is
  'Cuentas de Supabase Auth autorizadas en el espejo y su rol. Una cuenta que no está aquí no ve ni escribe nada.';
alter table privado.acceso_espejo enable row level security;
revoke all on privado.acceso_espejo from public, anon, authenticated;

-- security definer: leen acceso_espejo con los permisos del dueño de la función, así las cuentas no necesitan
-- (ni tienen) acceso a esa tabla. search_path vacío: nombres siempre calificados, nada que suplantar.
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
  );
$$;

create or replace function privado.espejo_es_sincronizador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from privado.acceso_espejo a
    where a.user_id = (select auth.uid()) and a.rol = 'sincronizador' and a.activo
  );
$$;

revoke all on function privado.espejo_es_lector() from public, anon;
revoke all on function privado.espejo_es_sincronizador() from public, anon;
grant execute on function privado.espejo_es_lector() to authenticated;
grant execute on function privado.espejo_es_sincronizador() to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- El resumen (esquema public: lo sirve la API de datos, siempre filtrado por las políticas).
-- Montos en céntimos de sol, enteros (RN-37). Días en hora de Lima.
-- ---------------------------------------------------------------------------------------------------------

create table if not exists public.resumen_dia (
  dia                date primary key,
  total_ventas       integer not null check (total_ventas >= 0),
  cantidad_cobros    integer not null check (cantidad_cobros >= 0),
  anulados_cantidad  integer not null check (anulados_cantidad >= 0),
  anulados_total     integer not null check (anulados_total >= 0),
  alquileres         integer not null check (alquileres >= 0),
  horas_vendidas     integer not null check (horas_vendidas >= 0),
  -- Por origen, por método de pago (con su nombre) y ocupación por habitación: ResumenDia.detalle en contracts.
  detalle            jsonb not null check (jsonb_typeof(detalle) = 'object'),
  version            smallint not null,
  actualizado_en     timestamptz not null
);
comment on table public.resumen_dia is
  'Ventas vigentes, anulados y ocupación de cada día de Lima. Lo escribe el servidor del local; es un resumen, no el detalle.';

create table if not exists public.resumen_turno (
  turno_id           text primary key,
  dia_cierre         date not null,
  cajero             text not null,
  abierto_en         timestamptz not null,
  cerrado_en         timestamptz not null,
  cierre_forzado     boolean not null,
  efectivo_inicial   integer not null check (efectivo_inicial >= 0),
  efectivo_esperado  integer not null,
  efectivo_contado   integer check (efectivo_contado >= 0),
  diferencia         integer,
  ventas_turno       integer not null check (ventas_turno >= 0),
  comentario         text check (char_length(comentario) <= 200),
  version            smallint not null,
  actualizado_en     timestamptz not null
);
comment on table public.resumen_turno is
  'Arqueo de cada turno cerrado. Los turnos abiertos no se publican: su esperado es secreto hasta el cierre (RN-34).';
create index if not exists resumen_turno_dia_cierre on public.resumen_turno (dia_cierre);

create table if not exists public.estado_espejo (
  id                     boolean primary key default true check (id),
  ultima_sincronizacion  timestamptz not null,
  intervalo_minutos      integer not null check (intervalo_minutos > 0),
  version_servidor       text not null
);
comment on table public.estado_espejo is
  'Una sola fila: hora de los datos de la última sincronización correcta (CU-28 paso 3).';

-- ---------------------------------------------------------------------------------------------------------
-- Permisos: nada para anon; authenticated puede leer, insertar y actualizar, siempre sujeto a las políticas.
-- Nadie tiene DELETE ni TRUNCATE.
-- ---------------------------------------------------------------------------------------------------------

alter table public.resumen_dia enable row level security;
alter table public.resumen_turno enable row level security;
alter table public.estado_espejo enable row level security;

revoke all on public.resumen_dia, public.resumen_turno, public.estado_espejo from public, anon, authenticated;
grant select, insert, update on public.resumen_dia, public.resumen_turno, public.estado_espejo to authenticated;

-- Lectura: las lectoras, y el sincronizador (un upsert necesita ver la fila que reemplaza).
drop policy if exists "espejo: leer" on public.resumen_dia;
create policy "espejo: leer" on public.resumen_dia for select to authenticated
  using ((select privado.espejo_es_lector()) or (select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: insertar" on public.resumen_dia;
create policy "espejo: insertar" on public.resumen_dia for insert to authenticated
  with check ((select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: actualizar" on public.resumen_dia;
create policy "espejo: actualizar" on public.resumen_dia for update to authenticated
  using ((select privado.espejo_es_sincronizador()))
  with check ((select privado.espejo_es_sincronizador()));

drop policy if exists "espejo: leer" on public.resumen_turno;
create policy "espejo: leer" on public.resumen_turno for select to authenticated
  using ((select privado.espejo_es_lector()) or (select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: insertar" on public.resumen_turno;
create policy "espejo: insertar" on public.resumen_turno for insert to authenticated
  with check ((select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: actualizar" on public.resumen_turno;
create policy "espejo: actualizar" on public.resumen_turno for update to authenticated
  using ((select privado.espejo_es_sincronizador()))
  with check ((select privado.espejo_es_sincronizador()));

drop policy if exists "espejo: leer" on public.estado_espejo;
create policy "espejo: leer" on public.estado_espejo for select to authenticated
  using ((select privado.espejo_es_lector()) or (select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: insertar" on public.estado_espejo;
create policy "espejo: insertar" on public.estado_espejo for insert to authenticated
  with check ((select privado.espejo_es_sincronizador()));
drop policy if exists "espejo: actualizar" on public.estado_espejo;
create policy "espejo: actualizar" on public.estado_espejo for update to authenticated
  using ((select privado.espejo_es_sincronizador()))
  with check ((select privado.espejo_es_sincronizador()));
