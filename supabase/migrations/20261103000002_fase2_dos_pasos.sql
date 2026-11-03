-- =====================================================================
-- Fase 2: verificación en dos pasos (TOTP) y dispositivos confiables
-- =====================================================================
-- Cómo funciona:
--   * Cada sesión de Supabase Auth tiene un session_id dentro del JWT.
--   * Una sesión solo da acceso a los datos si está registrada en
--     privado.sesiones_verificadas. rol_actual() lo exige, así que todas
--     las reglas por fila de la fase 1 lo heredan.
--   * Se verifica una sesión de tres maneras, siempre en el servidor:
--       - con el token de un dispositivo confiable (sin pedir código),
--       - con un código TOTP de la app autenticadora,
--       - con un código de recuperación de un solo uso.
--   * El token del dispositivo es aleatorio (256 bits), lo genera el
--     servidor, se entrega una sola vez y aquí solo se guarda su hash.
--   * 5 códigos fallidos bloquean la verificación 15 minutos.
--   * Los dispositivos confiables vencen a los 90 días.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Esquema fuera de la API: los roles de la app no tienen acceso directo.
create schema if not exists privado;
revoke all on schema privado from public;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table privado.factores_totp (
  usuario_id        uuid primary key references auth.users (id) on delete cascade,
  secreto           bytea,   -- confirmado y en uso
  secreto_pendiente bytea,   -- recién generado, a la espera del primer código
  ultimo_paso       bigint not null default 0,  -- evita reutilizar un código
  creado_en         timestamptz not null default now(),
  confirmado_en     timestamptz
);

create table privado.codigos_recuperacion (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  hash       text not null,
  usado_en   timestamptz
);
create index codigos_recuperacion_usuario on privado.codigos_recuperacion (usuario_id);

create table privado.intentos_verificacion (
  usuario_id      uuid primary key references auth.users (id) on delete cascade,
  fallos          int not null default 0,
  bloqueado_hasta timestamptz
);

create table public.dispositivos_confiables (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.perfiles (id) on delete cascade,
  huella_hash  text not null unique,
  nombre       text not null default 'Dispositivo',
  creado_en    timestamptz not null default now(),
  vence_en     timestamptz not null,
  ultimo_uso   timestamptz,
  revocado_en  timestamptz,
  revocado_por uuid references public.perfiles (id)
);
create index dispositivos_confiables_usuario on public.dispositivos_confiables (usuario_id);

create table privado.sesiones_verificadas (
  session_id     uuid primary key,
  usuario_id     uuid not null references auth.users (id) on delete cascade,
  dispositivo_id uuid references public.dispositivos_confiables (id) on delete cascade,
  metodo         text not null check (metodo in ('dispositivo', 'totp', 'recuperacion')),
  vence_en       timestamptz not null,
  creado_en      timestamptz not null default now()
);
create index sesiones_verificadas_usuario on privado.sesiones_verificadas (usuario_id);

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------

create function privado.sesion_actual()
returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;

create function privado.hash(texto text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(texto, 'sha256'), 'hex')
$$;

-- Base32 (RFC 4648, sin relleno), el formato que esperan las apps autenticadoras.
create function privado.base32(datos bytea)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  alfabeto constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  valor int := 0;
  bits int := 0;
  salida text := '';
begin
  for i in 0 .. length(datos) - 1 loop
    valor := (valor << 8) | get_byte(datos, i);
    bits := bits + 8;
    while bits >= 5 loop
      salida := salida || substr(alfabeto, ((valor >> (bits - 5)) & 31) + 1, 1);
      bits := bits - 5;
    end loop;
    valor := valor & ((1 << bits) - 1);
  end loop;
  if bits > 0 then
    salida := salida || substr(alfabeto, ((valor << (5 - bits)) & 31) + 1, 1);
  end if;
  return salida;
end;
$$;

-- Código TOTP de 6 dígitos (RFC 6238, HMAC-SHA1, pasos de 30 segundos).
create function privado.totp(secreto bytea, paso bigint)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  h bytea := extensions.hmac(int8send(paso), secreto, 'sha1');
  o int := get_byte(h, 19) & 15;
  numero bigint;
begin
  numero := ((get_byte(h, o) & 127)::bigint << 24)
          | (get_byte(h, o + 1)::bigint << 16)
          | (get_byte(h, o + 2)::bigint << 8)
          | get_byte(h, o + 3)::bigint;
  return lpad((numero % 1000000)::text, 6, '0');
end;
$$;

-- Devuelve el paso que coincide con el código (tolerando ±30 s de desfase
-- del reloj del celular), o null. Rechaza pasos ya usados.
create function privado.totp_valido(secreto bytea, codigo text, ultimo_paso bigint)
returns bigint
language plpgsql stable
set search_path = ''
as $$
declare
  ahora bigint := floor(extract(epoch from now()) / 30)::bigint;
  limpio text := regexp_replace(coalesce(codigo, ''), '\s', '', 'g');
begin
  if secreto is null or limpio !~ '^\d{6}$' then
    return null;
  end if;
  for p in ahora - 1 .. ahora + 1 loop
    if p > ultimo_paso and privado.totp(secreto, p) = limpio then
      return p;
    end if;
  end loop;
  return null;
end;
$$;

create function privado.bloqueado_hasta(uid uuid)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select i.bloqueado_hasta from privado.intentos_verificacion i
  where i.usuario_id = uid and i.bloqueado_hasta > now()
$$;

-- Suma un fallo; al quinto bloquea 15 minutos. No lanza excepción para que
-- el contador quede guardado.
create function privado.fallo(uid uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  max_fallos constant int := 5;
  n int;
  hasta timestamptz;
begin
  insert into privado.intentos_verificacion (usuario_id, fallos) values (uid, 1)
  on conflict (usuario_id) do update set fallos = privado.intentos_verificacion.fallos + 1
  returning fallos into n;
  if n >= max_fallos then
    hasta := now() + interval '15 minutes';
    update privado.intentos_verificacion set fallos = 0, bloqueado_hasta = hasta where usuario_id = uid;
    return jsonb_build_object('ok', false, 'bloqueado_hasta', hasta,
      'mensaje', 'Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.');
  end if;
  return jsonb_build_object('ok', false, 'bloqueado_hasta', null,
    'mensaje', format('Código incorrecto. Te quedan %s intentos.', max_fallos - n));
end;
$$;

create function privado.respuesta_bloqueo(hasta timestamptz)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'bloqueado_hasta', hasta,
    'mensaje', 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.')
$$;

-- Marca la sesión actual como verificada y, si se pide, registra el
-- dispositivo como confiable. Devuelve el token del dispositivo una sola vez.
create function privado.verificar_sesion(uid uuid, metodo text, recordar boolean, nombre text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  dias_confianza constant int := 90;
  sesion uuid := privado.sesion_actual();
  token text;
  disp uuid;
  vence timestamptz;
begin
  if sesion is null then
    raise exception 'La sesión no tiene identificador; vuelve a entrar' using errcode = 'P0001';
  end if;
  if coalesce(recordar, false) then
    token := encode(extensions.gen_random_bytes(32), 'hex');
    vence := now() + make_interval(days => dias_confianza);
    insert into public.dispositivos_confiables (usuario_id, huella_hash, nombre, vence_en, ultimo_uso)
    values (uid, privado.hash(token), left(coalesce(nullif(btrim(nombre), ''), 'Dispositivo'), 80), vence, now())
    returning id into disp;
  else
    -- Sin recordar el dispositivo, la verificación dura lo que una jornada.
    vence := now() + interval '12 hours';
  end if;

  insert into privado.sesiones_verificadas (session_id, usuario_id, dispositivo_id, metodo, vence_en)
  values (sesion, uid, disp, metodo, vence)
  on conflict (session_id) do update
    set dispositivo_id = excluded.dispositivo_id, metodo = excluded.metodo, vence_en = excluded.vence_en
    where privado.sesiones_verificadas.usuario_id = excluded.usuario_id;

  delete from privado.intentos_verificacion where usuario_id = uid;
  return jsonb_build_object('ok', true, 'dispositivo_id', disp, 'token_dispositivo', token);
end;
$$;

create function privado.nuevos_codigos(uid uuid)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  codigos text[] := '{}';
  c text;
begin
  delete from privado.codigos_recuperacion where usuario_id = uid;
  for i in 1 .. 10 loop
    c := left(privado.base32(extensions.gen_random_bytes(7)), 10);
    codigos := codigos || (left(c, 5) || '-' || right(c, 5));
    insert into privado.codigos_recuperacion (usuario_id, hash) values (uid, privado.hash(c));
  end loop;
  return codigos;
end;
$$;

create function privado.exigir_usuario_activo()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.perfiles where id = uid and activo) then
    raise exception 'Tu cuenta no está activa' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create function privado.auditar(uid uuid, accion text, detalle jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.auditoria (usuario_id, tabla, registro_id, accion, valor_nuevo)
  values (auth.uid(), 'dos_pasos', uid::text, accion, detalle)
$$;

-- ---------------------------------------------------------------------
-- ¿Está verificada la sesión actual? (la usan las reglas por fila)
-- ---------------------------------------------------------------------

create function public.sesion_verificada()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from privado.sesiones_verificadas s
    left join public.dispositivos_confiables d on d.id = s.dispositivo_id
    where s.session_id = privado.sesion_actual()
      and s.usuario_id = (select auth.uid())
      and s.vence_en > now()
      and (s.dispositivo_id is null or (d.revocado_en is null and d.vence_en > now()))
  )
$$;

-- A partir de ahora el rol solo cuenta si la sesión está verificada.
create or replace function public.rol_actual()
returns public.rol_usuario
language sql stable security definer
set search_path = ''
as $$
  select p.rol from public.perfiles p
  where p.id = (select auth.uid()) and p.activo and public.sesion_verificada()
$$;

-- ---------------------------------------------------------------------
-- Funciones que llama la app
-- ---------------------------------------------------------------------

create function public.estado_verificacion()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return null;
  end if;
  return jsonb_build_object(
    'verificada', public.sesion_verificada(),
    'tiene_factor', exists (select 1 from privado.factores_totp where usuario_id = uid and secreto is not null),
    'bloqueado_hasta', privado.bloqueado_hasta(uid),
    'codigos_restantes', (select count(*) from privado.codigos_recuperacion where usuario_id = uid and usado_en is null)
  );
end;
$$;

-- Entrar sin código desde un dispositivo confiable. Devuelve el id del
-- dispositivo, o null si el token no vale (revocado, vencido o ajeno).
create function public.usar_dispositivo(token text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d public.dispositivos_confiables;
begin
  if uid is null or token is null or token !~ '^[0-9a-f]{64}$' or privado.sesion_actual() is null then
    return null;
  end if;
  if not exists (select 1 from public.perfiles where id = uid and activo) then
    return null;
  end if;
  select * into d from public.dispositivos_confiables
  where huella_hash = privado.hash(token) and usuario_id = uid
    and revocado_en is null and vence_en > now();
  if d.id is null then
    return null;
  end if;

  update public.dispositivos_confiables set ultimo_uso = now() where id = d.id;
  insert into privado.sesiones_verificadas (session_id, usuario_id, dispositivo_id, metodo, vence_en)
  values (privado.sesion_actual(), uid, d.id, 'dispositivo', d.vence_en)
  on conflict (session_id) do update
    set dispositivo_id = excluded.dispositivo_id, metodo = excluded.metodo, vence_en = excluded.vence_en
    where privado.sesiones_verificadas.usuario_id = excluded.usuario_id;
  return d.id;
end;
$$;

-- Genera un secreto TOTP nuevo. Si ya hay una app configurada, cambiarla
-- exige una sesión verificada (para que una contraseña robada no baste).
create function public.iniciar_inscripcion_totp()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := privado.exigir_usuario_activo();
  s bytea := extensions.gen_random_bytes(20);
begin
  if exists (select 1 from privado.factores_totp where usuario_id = uid and secreto is not null)
     and not public.sesion_verificada() then
    raise exception 'Para cambiar la app autenticadora primero verifica tu identidad' using errcode = '42501';
  end if;
  insert into privado.factores_totp (usuario_id, secreto_pendiente) values (uid, s)
  on conflict (usuario_id) do update set secreto_pendiente = excluded.secreto_pendiente;
  return jsonb_build_object(
    'secreto', privado.base32(s),
    'email', (select email from public.perfiles where id = uid)
  );
end;
$$;

-- Confirma la app autenticadora con su primer código. Devuelve los códigos
-- de recuperación (una sola vez) y, si se pide, el token del dispositivo.
create function public.confirmar_inscripcion_totp(codigo text, recordar boolean, nombre_dispositivo text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := privado.exigir_usuario_activo();
  f privado.factores_totp;
  hasta timestamptz := privado.bloqueado_hasta(uid);
  paso bigint;
  resultado jsonb;
begin
  if hasta is not null then
    return privado.respuesta_bloqueo(hasta);
  end if;
  select * into f from privado.factores_totp where usuario_id = uid;
  if f.secreto_pendiente is null then
    raise exception 'Primero inicia la configuración de la app autenticadora' using errcode = 'P0001';
  end if;
  if f.secreto is not null and not public.sesion_verificada() then
    raise exception 'Para cambiar la app autenticadora primero verifica tu identidad' using errcode = '42501';
  end if;
  paso := privado.totp_valido(f.secreto_pendiente, codigo, 0);
  if paso is null then
    return privado.fallo(uid);
  end if;

  update privado.factores_totp
  set secreto = secreto_pendiente, secreto_pendiente = null, ultimo_paso = paso, confirmado_en = now()
  where usuario_id = uid;
  perform privado.auditar(uid, 'UPDATE', jsonb_build_object('evento', 'app autenticadora configurada'));
  resultado := privado.verificar_sesion(uid, 'totp', recordar, nombre_dispositivo);
  return resultado || jsonb_build_object('codigos_recuperacion', to_jsonb(privado.nuevos_codigos(uid)));
end;
$$;

create function public.verificar_totp(codigo text, recordar boolean, nombre_dispositivo text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := privado.exigir_usuario_activo();
  f privado.factores_totp;
  hasta timestamptz := privado.bloqueado_hasta(uid);
  paso bigint;
begin
  if hasta is not null then
    return privado.respuesta_bloqueo(hasta);
  end if;
  select * into f from privado.factores_totp where usuario_id = uid;
  if f.secreto is null then
    raise exception 'No tienes una app autenticadora configurada' using errcode = 'P0001';
  end if;
  paso := privado.totp_valido(f.secreto, codigo, f.ultimo_paso);
  if paso is null then
    return privado.fallo(uid);
  end if;
  update privado.factores_totp set ultimo_paso = paso where usuario_id = uid;
  return privado.verificar_sesion(uid, 'totp', recordar, nombre_dispositivo);
end;
$$;

create function public.usar_codigo_recuperacion(codigo text, recordar boolean, nombre_dispositivo text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := privado.exigir_usuario_activo();
  hasta timestamptz := privado.bloqueado_hasta(uid);
  limpio text := upper(regexp_replace(coalesce(codigo, ''), '[^A-Za-z2-7]', '', 'g'));
  usado bigint;
begin
  if hasta is not null then
    return privado.respuesta_bloqueo(hasta);
  end if;
  update privado.codigos_recuperacion set usado_en = now()
  where usuario_id = uid and hash = privado.hash(limpio) and usado_en is null
  returning id into usado;
  if usado is null then
    return privado.fallo(uid);
  end if;
  perform privado.auditar(uid, 'UPDATE', jsonb_build_object('evento', 'código de recuperación usado'));
  return privado.verificar_sesion(uid, 'recuperacion', recordar, nombre_dispositivo)
    || jsonb_build_object('codigos_restantes',
         (select count(*) from privado.codigos_recuperacion where usuario_id = uid and usado_en is null));
end;
$$;

create function public.regenerar_codigos_recuperacion()
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := privado.exigir_usuario_activo();
begin
  if not public.sesion_verificada() then
    raise exception 'Primero verifica tu identidad' using errcode = '42501';
  end if;
  perform privado.auditar(uid, 'UPDATE', jsonb_build_object('evento', 'códigos de recuperación regenerados'));
  return privado.nuevos_codigos(uid);
end;
$$;

-- Revocar un dispositivo: su dueño o el administrador.
create function public.revocar_dispositivo(dispositivo uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  dueno uuid;
begin
  select usuario_id into dueno from public.dispositivos_confiables where id = dispositivo;
  if dueno is null then
    raise exception 'Dispositivo no encontrado' using errcode = 'P0001';
  end if;
  if public.rol_actual() is null or (dueno <> uid and not public.tiene_rol('admin')) then
    raise exception 'No puedes revocar este dispositivo' using errcode = '42501';
  end if;
  update public.dispositivos_confiables set revocado_en = now(), revocado_por = uid
  where id = dispositivo and revocado_en is null;
  delete from privado.sesiones_verificadas where dispositivo_id = dispositivo;
end;
$$;

-- El administrador borra la app autenticadora de alguien que la perdió y no
-- tiene códigos de recuperación. La persona la configura de nuevo al entrar.
create function public.restablecer_dos_pasos(usuario uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tiene_rol('admin') then
    raise exception 'Solo el administrador puede restablecer la verificación' using errcode = '42501';
  end if;
  if usuario = auth.uid() then
    raise exception 'Para tu propia cuenta usa Mi cuenta > Cambiar app autenticadora' using errcode = 'P0001';
  end if;
  delete from privado.factores_totp where usuario_id = usuario;
  delete from privado.codigos_recuperacion where usuario_id = usuario;
  delete from privado.intentos_verificacion where usuario_id = usuario;
  delete from privado.sesiones_verificadas where usuario_id = usuario;
  update public.dispositivos_confiables set revocado_en = now(), revocado_por = auth.uid()
  where usuario_id = usuario and revocado_en is null;
  perform privado.auditar(usuario, 'DELETE', jsonb_build_object('evento', 'verificación en dos pasos restablecida'));
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------

revoke execute on all functions in schema privado from public;

revoke execute on function
  public.sesion_verificada(),
  public.estado_verificacion(),
  public.usar_dispositivo(text),
  public.iniciar_inscripcion_totp(),
  public.confirmar_inscripcion_totp(text, boolean, text),
  public.verificar_totp(text, boolean, text),
  public.usar_codigo_recuperacion(text, boolean, text),
  public.regenerar_codigos_recuperacion(),
  public.revocar_dispositivo(uuid),
  public.restablecer_dos_pasos(uuid)
from public, anon;

grant execute on function
  public.sesion_verificada(),
  public.estado_verificacion(),
  public.usar_dispositivo(text),
  public.iniciar_inscripcion_totp(),
  public.confirmar_inscripcion_totp(text, boolean, text),
  public.verificar_totp(text, boolean, text),
  public.usar_codigo_recuperacion(text, boolean, text),
  public.regenerar_codigos_recuperacion(),
  public.revocar_dispositivo(uuid),
  public.restablecer_dos_pasos(uuid)
to authenticated;

-- dispositivos_confiables: cada quien ve los suyos y el admin todos. Nadie
-- los escribe directamente; solo las funciones de arriba. El hash del token
-- no se expone.
alter table public.dispositivos_confiables enable row level security;
revoke all on public.dispositivos_confiables from anon, authenticated;
grant select (id, usuario_id, nombre, creado_en, vence_en, ultimo_uso, revocado_en, revocado_por)
  on public.dispositivos_confiables to authenticated;

create policy dispositivos_ver on public.dispositivos_confiables for select to authenticated
  using (
    (usuario_id = (select auth.uid()) and (select public.rol_actual()) is not null)
    or (select public.tiene_rol('admin'))
  );

create trigger auditar after insert or update of revocado_en on public.dispositivos_confiables
  for each row execute function public.registrar_auditoria();
