-- =====================================================================
-- Fase 1: esquema base, roles, reglas de seguridad por fila y auditoría
-- Trilla de café
-- =====================================================================
-- Reglas de acceso (de la especificación):
--   Acción                                  admin  operador  consulta
--   Registrar recibos y entregas             sí     sí        no
--   Ver precios, cobros y pagos              sí     no        sí
--   Registrar pagos                          sí     no        no
--   Crear o editar clientes                  sí     sí        no
--   Cambiar tarifas                          sí     no        no
--   Crear usuarios y gestionar dispositivos  sí     no        no
--   Ver reportes                             sí     no        sí
--
-- Nadie borra registros: se anulan, y la auditoría guarda el rastro.
-- =====================================================================

create type public.rol_usuario as enum ('admin', 'operador', 'consulta');

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table public.perfiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  nombre         text not null default '',
  rol            public.rol_usuario not null default 'consulta',
  -- Una cuenta nueva nace inactiva; solo el administrador la activa.
  activo         boolean not null default false,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.clientes (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) > 0),
  telefono       text,
  notas          text,
  activo         boolean not null default true,
  creado_por     uuid references public.perfiles (id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.configuracion (
  id              smallint primary key default 1 check (id = 1),
  tarifa_kg       numeric(14, 2) not null check (tarifa_kg >= 0),
  moneda          text not null default '$',
  actualizado_por uuid references public.perfiles (id),
  actualizado_en  timestamptz not null default now()
);

create table public.recibos (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null default current_date,
  cliente_id       uuid not null references public.clientes (id),
  kg_pergamino     numeric(12, 2) not null check (kg_pergamino > 0),
  -- Se copia de configuracion al registrar, para que un cambio de tarifa
  -- no altere cobros pasados. La pone el servidor, no el navegador.
  tarifa_aplicada  numeric(14, 2) not null default 0 check (tarifa_aplicada >= 0),
  registrado_por   uuid references public.perfiles (id),
  anulado          boolean not null default false,
  motivo_anulacion text,
  creado_en        timestamptz not null default now()
);

create table public.entregas (
  id               uuid primary key default gen_random_uuid(),
  recibo_id        uuid not null references public.recibos (id),
  fecha            date not null default current_date,
  kg_oro           numeric(12, 2) not null check (kg_oro > 0),
  registrado_por   uuid references public.perfiles (id),
  anulado          boolean not null default false,
  motivo_anulacion text,
  creado_en        timestamptz not null default now()
);

-- Un recibo tiene como máximo una entrega vigente.
create unique index entregas_una_vigente_por_recibo
  on public.entregas (recibo_id) where not anulado;

create table public.pagos (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null default current_date,
  cliente_id       uuid not null references public.clientes (id),
  monto            numeric(14, 2) not null check (monto > 0),
  metodo           text not null default 'efectivo'
                   check (metodo in ('efectivo', 'transferencia', 'cheque', 'otro')),
  notas            text,
  registrado_por   uuid references public.perfiles (id),
  anulado          boolean not null default false,
  motivo_anulacion text,
  creado_en        timestamptz not null default now()
);

create table public.auditoria (
  id             bigint generated always as identity primary key,
  usuario_id     uuid,
  tabla          text not null,
  registro_id    text,
  accion         text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  valor_anterior jsonb,
  valor_nuevo    jsonb,
  creado_en      timestamptz not null default now()
);

create index recibos_cliente_fecha on public.recibos (cliente_id, fecha);
create index pagos_cliente_fecha on public.pagos (cliente_id, fecha);
create index auditoria_tabla_registro on public.auditoria (tabla, registro_id);
create index auditoria_creado_en on public.auditoria (creado_en desc);

-- Tarifa de ejemplo del prototipo. Se cambia desde la app (rol admin).
insert into public.configuracion (id, tarifa_kg, moneda) values (1, 400, '$');

-- ---------------------------------------------------------------------
-- Funciones de rol
-- ---------------------------------------------------------------------

-- Rol del usuario que hace la petición; null si no existe o está inactivo.
create function public.rol_actual()
returns public.rol_usuario
language sql stable security definer
set search_path = ''
as $$
  select p.rol from public.perfiles p
  where p.id = (select auth.uid()) and p.activo
$$;

create function public.tiene_rol(variadic roles public.rol_usuario[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.rol_actual() = any (roles), false)
$$;

-- Peticiones sin usuario final: la función del servidor (service_role) o la
-- consola SQL. Se basa en auth.uid() y no en current_user porque dentro de
-- una función security definer current_user es el dueño de la función.
-- El rol anon no tiene permisos sobre ninguna tabla, así que no llega aquí.
create function public.es_peticion_de_servidor()
returns boolean
language sql stable
set search_path = ''
as $$
  select (select auth.uid()) is null
$$;

revoke execute on function public.rol_actual() from public, anon;
revoke execute on function public.tiene_rol(public.rol_usuario[]) from public, anon;
grant execute on function public.rol_actual() to authenticated;
grant execute on function public.tiene_rol(public.rol_usuario[]) to authenticated;

-- ---------------------------------------------------------------------
-- Perfiles: alta automática, protección de rol y cupo de 15 usuarios
-- ---------------------------------------------------------------------

-- Cada usuario creado en Supabase Auth recibe un perfil inactivo con rol
-- de consulta. La función admin-usuarios lo activa con el rol elegido.
create function public.crear_perfil_de_usuario()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nombre', ''));
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_de_usuario();

create function public.proteger_perfil()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cupo constant int := 15;
  activos int;
begin
  -- Solo el administrador (o el servidor) cambia rol, estado o correo.
  if not public.es_peticion_de_servidor() and not public.tiene_rol('admin') then
    if new.rol is distinct from old.rol
       or new.activo is distinct from old.activo
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Solo el administrador puede cambiar el rol, el estado o el correo de un usuario'
        using errcode = '42501';
    end if;
  end if;

  -- Cupo de usuarios activos.
  if new.activo and not old.activo then
    perform pg_advisory_xact_lock(hashtext('perfiles_cupo'));
    select count(*) into activos from public.perfiles where activo and id <> new.id;
    if activos >= cupo then
      raise exception 'Se alcanzó el máximo de % usuarios activos', cupo using errcode = 'P0001';
    end if;
  end if;

  -- Siempre debe quedar al menos un administrador activo.
  if old.rol = 'admin' and old.activo and not (new.rol = 'admin' and new.activo) then
    perform pg_advisory_xact_lock(hashtext('perfiles_admin'));
    if not exists (
      select 1 from public.perfiles where rol = 'admin' and activo and id <> old.id
    ) then
      raise exception 'Debe quedar al menos un administrador activo' using errcode = 'P0001';
    end if;
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

create trigger proteger_perfil
  before update on public.perfiles
  for each row execute function public.proteger_perfil();

-- ---------------------------------------------------------------------
-- Registros: quién registró, tarifa del servidor y validaciones
-- ---------------------------------------------------------------------

create function public.marcar_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger marcar_actualizado
  before update on public.clientes
  for each row execute function public.marcar_actualizado();

create function public.al_crear_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.creado_por := coalesce((select auth.uid()), new.creado_por);
  return new;
end;
$$;

create trigger al_crear_cliente
  before insert on public.clientes
  for each row execute function public.al_crear_cliente();

create function public.al_actualizar_configuracion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_por := coalesce((select auth.uid()), new.actualizado_por);
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger al_actualizar_configuracion
  before update on public.configuracion
  for each row execute function public.al_actualizar_configuracion();

-- La tarifa la decide el servidor: se toma de configuracion al registrar.
-- security definer porque el operador no puede leer configuracion.
create function public.al_crear_recibo()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.es_peticion_de_servidor() then
    new.registrado_por := (select auth.uid());
    new.anulado := false;
    new.motivo_anulacion := null;
  end if;
  select c.tarifa_kg into new.tarifa_aplicada from public.configuracion c where c.id = 1;
  if not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.activo) then
    raise exception 'El cliente no existe o está inactivo' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger al_crear_recibo
  before insert on public.recibos
  for each row execute function public.al_crear_recibo();

create function public.al_crear_entrega()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.recibos;
begin
  if not public.es_peticion_de_servidor() then
    new.registrado_por := (select auth.uid());
    new.anulado := false;
    new.motivo_anulacion := null;
  end if;
  select * into r from public.recibos where id = new.recibo_id;
  if r.id is null or r.anulado then
    raise exception 'El recibo no existe o está anulado' using errcode = 'P0001';
  end if;
  if new.kg_oro > r.kg_pergamino then
    raise exception 'Los kg de oro no pueden superar los kg de pergamino recibidos'
      using errcode = 'P0001';
  end if;
  if new.fecha < r.fecha then
    raise exception 'La entrega no puede ser anterior al recibo' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger al_crear_entrega
  before insert on public.entregas
  for each row execute function public.al_crear_entrega();

create function public.al_crear_pago()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.es_peticion_de_servidor() then
    new.registrado_por := (select auth.uid());
    new.anulado := false;
    new.motivo_anulacion := null;
  end if;
  return new;
end;
$$;

create trigger al_crear_pago
  before insert on public.pagos
  for each row execute function public.al_crear_pago();

-- Al editar un recibo, entrega o pago no se reescribe quién lo registró.
create function public.conservar_autoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.registrado_por := old.registrado_por;
  new.creado_en := old.creado_en;
  if new.anulado and coalesce(btrim(new.motivo_anulacion), '') = '' then
    raise exception 'Indica el motivo de la anulación' using errcode = 'P0001';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un registro anulado no se puede reactivar' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger conservar_autoria before update on public.recibos
  for each row execute function public.conservar_autoria();
create trigger conservar_autoria before update on public.entregas
  for each row execute function public.conservar_autoria();
create trigger conservar_autoria before update on public.pagos
  for each row execute function public.conservar_autoria();

-- ---------------------------------------------------------------------
-- Auditoría de cada cambio
-- ---------------------------------------------------------------------

create function public.registrar_auditoria()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.auditoria (usuario_id, tabla, registro_id, accion, valor_anterior, valor_nuevo)
  values (
    (select auth.uid()),
    tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger auditar after insert or update or delete on public.perfiles
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.clientes
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.configuracion
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.recibos
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.entregas
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.pagos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------
-- Reglas de seguridad por fila
-- ---------------------------------------------------------------------

alter table public.perfiles      enable row level security;
alter table public.clientes      enable row level security;
alter table public.configuracion enable row level security;
alter table public.recibos       enable row level security;
alter table public.entregas      enable row level security;
alter table public.pagos         enable row level security;
alter table public.auditoria     enable row level security;

-- Sin acceso anónimo a nada.
revoke all on all tables in schema public from anon;

-- perfiles: cada quien ve el suyo; el administrador ve y edita todos.
-- El alta la hace el trigger de auth.users; nadie borra perfiles desde la app.
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.tiene_rol('admin')));
create policy perfiles_editar_propio on public.perfiles for update to authenticated
  using (id = (select auth.uid()) and (select public.rol_actual()) is not null)
  with check (id = (select auth.uid()));
create policy perfiles_editar_admin on public.perfiles for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- clientes: todos los roles activos los ven; admin y operador los crean y editan.
create policy clientes_ver on public.clientes for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy clientes_crear on public.clientes for insert to authenticated
  with check ((select public.tiene_rol('admin', 'operador')));
create policy clientes_editar on public.clientes for update to authenticated
  using ((select public.tiene_rol('admin', 'operador')))
  with check ((select public.tiene_rol('admin', 'operador')));

-- configuracion (tarifa): la ven admin y consulta; solo admin la cambia.
create policy configuracion_ver on public.configuracion for select to authenticated
  using ((select public.tiene_rol('admin', 'consulta')));
create policy configuracion_editar on public.configuracion for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- recibos: la tabla completa (con tarifa) la ven admin y consulta.
-- El operador registra recibos y los consulta sin precios en recibos_operacion.
-- Editar o anular queda para el administrador.
create policy recibos_ver on public.recibos for select to authenticated
  using ((select public.tiene_rol('admin', 'consulta')));
create policy recibos_crear on public.recibos for insert to authenticated
  with check ((select public.tiene_rol('admin', 'operador')));
create policy recibos_editar on public.recibos for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- entregas: no tienen precios; las ven todos, las registran admin y operador.
create policy entregas_ver on public.entregas for select to authenticated
  using ((select public.rol_actual()) is not null);
create policy entregas_crear on public.entregas for insert to authenticated
  with check ((select public.tiene_rol('admin', 'operador')));
create policy entregas_editar on public.entregas for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- pagos: los ven admin y consulta; solo admin los registra o anula.
create policy pagos_ver on public.pagos for select to authenticated
  using ((select public.tiene_rol('admin', 'consulta')));
create policy pagos_crear on public.pagos for insert to authenticated
  with check ((select public.tiene_rol('admin')));
create policy pagos_editar on public.pagos for update to authenticated
  using ((select public.tiene_rol('admin')))
  with check ((select public.tiene_rol('admin')));

-- auditoria: solo lectura para el administrador; la escriben los triggers.
create policy auditoria_ver on public.auditoria for select to authenticated
  using ((select public.tiene_rol('admin')));

-- Sin borrados desde la app: los registros se anulan.
revoke delete on public.perfiles, public.clientes, public.configuracion,
  public.recibos, public.entregas, public.pagos, public.auditoria from authenticated;
revoke insert, update on public.auditoria from authenticated;
revoke insert on public.configuracion, public.perfiles from authenticated;

-- ---------------------------------------------------------------------
-- Vista de recibos sin precios para el operador
-- ---------------------------------------------------------------------
-- Vista con permisos del dueño (no security_invoker) para poder ocultar la
-- columna de tarifa; el filtro por rol activo va en el WHERE.
create view public.recibos_operacion
with (security_barrier = true)
as
select r.id, r.fecha, r.cliente_id, r.kg_pergamino, r.registrado_por,
       r.anulado, r.motivo_anulacion, r.creado_en
from public.recibos r
where public.rol_actual() is not null;

revoke all on public.recibos_operacion from public, anon;
grant select on public.recibos_operacion to authenticated;
