-- =====================================================================
-- Fase 3: recibos, entregas, clientes y pagos
-- =====================================================================
-- Reglas de cálculo (de la especificación):
--   Rendimiento (%)   = kg de oro ÷ kg de pergamino × 100
--   Cobro de recibo   = kg de pergamino × tarifa aplicada
--   Saldo del cliente = total cobrado − total pagado
--   Café en proceso   = recibos sin entrega registrada
-- Los registros anulados no cuentan en ningún cálculo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Validaciones adicionales
-- ---------------------------------------------------------------------

-- Sin fechas futuras. Se admite un día de margen por la diferencia entre
-- la hora local y la del servidor (UTC).
create function public.validar_fecha()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fecha > current_date + 1 then
    raise exception 'La fecha no puede ser futura' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger validar_fecha before insert or update of fecha on public.recibos
  for each row execute function public.validar_fecha();
create trigger validar_fecha before insert or update of fecha on public.entregas
  for each row execute function public.validar_fecha();
create trigger validar_fecha before insert or update of fecha on public.pagos
  for each row execute function public.validar_fecha();

-- Un recibo con entrega vigente no se anula: primero se anula la entrega.
create function public.validar_anulacion_recibo()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.anulado and not old.anulado and exists (
    select 1 from public.entregas where recibo_id = new.id and not anulado
  ) then
    raise exception 'Este recibo ya tiene una entrega. Anula primero la entrega.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger validar_anulacion_recibo before update of anulado on public.recibos
  for each row execute function public.validar_anulacion_recibo();

-- ---------------------------------------------------------------------
-- Vistas de recibos con su entrega
-- ---------------------------------------------------------------------

-- Sin precios: para todos los roles (el operador la usa en lugar de la tabla).
drop view public.recibos_operacion;
create view public.recibos_operacion
with (security_barrier = true)
as
select r.id, r.fecha, r.cliente_id, c.nombre as cliente_nombre, r.kg_pergamino,
       r.registrado_por, r.anulado, r.motivo_anulacion, r.creado_en,
       e.id as entrega_id, e.fecha as fecha_entrega, e.kg_oro,
       round(e.kg_oro / r.kg_pergamino * 100, 2) as rendimiento
from public.recibos r
join public.clientes c on c.id = r.cliente_id
left join public.entregas e on e.recibo_id = r.id and not e.anulado
where public.rol_actual() is not null;

revoke all on public.recibos_operacion from public, anon;
grant select on public.recibos_operacion to authenticated;

-- Con precios: respeta las reglas por fila de recibos (admin y consulta).
create view public.recibos_detalle
with (security_invoker = true)
as
select r.id, r.fecha, r.cliente_id, c.nombre as cliente_nombre, r.kg_pergamino,
       r.tarifa_aplicada, round(r.kg_pergamino * r.tarifa_aplicada, 2) as cobro,
       r.registrado_por, r.anulado, r.motivo_anulacion, r.creado_en,
       e.id as entrega_id, e.fecha as fecha_entrega, e.kg_oro,
       round(e.kg_oro / r.kg_pergamino * 100, 2) as rendimiento,
       case when e.kg_oro > 0 then round(r.kg_pergamino * r.tarifa_aplicada / e.kg_oro, 2) end as costo_kg_oro
from public.recibos r
join public.clientes c on c.id = r.cliente_id
left join public.entregas e on e.recibo_id = r.id and not e.anulado;

revoke all on public.recibos_detalle from public, anon;
grant select on public.recibos_detalle to authenticated;

-- ---------------------------------------------------------------------
-- Saldos por cliente (admin y consulta)
-- ---------------------------------------------------------------------

create view public.saldos_clientes
with (security_invoker = true)
as
select c.id as cliente_id, c.nombre, c.telefono, c.activo,
       coalesce(r.kg_recibido, 0) as kg_recibido,
       coalesce(r.cobrado, 0) as cobrado,
       coalesce(p.pagado, 0) as pagado,
       coalesce(r.cobrado, 0) - coalesce(p.pagado, 0) as saldo
from public.clientes c
left join lateral (
  select sum(x.kg_pergamino) as kg_recibido, round(sum(x.kg_pergamino * x.tarifa_aplicada), 2) as cobrado
  from public.recibos x where x.cliente_id = c.id and not x.anulado
) r on true
left join lateral (
  select sum(y.monto) as pagado from public.pagos y where y.cliente_id = c.id and not y.anulado
) p on true
-- Sin esto el operador vería saldos en cero (no puede leer recibos ni pagos).
where public.tiene_rol('admin', 'consulta');

revoke all on public.saldos_clientes from public, anon;
grant select on public.saldos_clientes to authenticated;

-- ---------------------------------------------------------------------
-- Resumen general
-- ---------------------------------------------------------------------

-- Cifras de la pantalla Resumen. Los kg los ven todos los roles; los montos
-- solo admin y consulta (para el operador llegan en null).
create function public.resumen()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  ve_dinero boolean := public.tiene_rol('admin', 'consulta');
  resultado jsonb;
  pagado numeric;
begin
  if public.rol_actual() is null then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;

  with r as (
    select r.kg_pergamino, r.tarifa_aplicada, e.kg_oro
    from public.recibos r
    left join public.entregas e on e.recibo_id = r.id and not e.anulado
    where not r.anulado
  )
  select jsonb_build_object(
    'kg_recibido', coalesce(sum(kg_pergamino), 0),
    'kg_en_proceso', coalesce(sum(kg_pergamino) filter (where kg_oro is null), 0),
    'kg_pergamino_trillado', coalesce(sum(kg_pergamino) filter (where kg_oro is not null), 0),
    'kg_oro', coalesce(sum(kg_oro), 0),
    'rendimiento', round(sum(kg_oro) / nullif(sum(kg_pergamino) filter (where kg_oro is not null), 0) * 100, 2),
    'lotes_pendientes', count(*) filter (where kg_oro is null),
    'cobrado', case when ve_dinero then coalesce(round(sum(kg_pergamino * tarifa_aplicada), 2), 0) end
  )
  into resultado
  from r;

  if ve_dinero then
    select coalesce(sum(monto), 0) into pagado from public.pagos where not anulado;
    resultado := resultado || jsonb_build_object(
      'pagado', pagado,
      'por_cobrar', (resultado ->> 'cobrado')::numeric - pagado
    );
  end if;
  return resultado;
end;
$$;

revoke execute on function public.resumen() from public, anon;
grant execute on function public.resumen() to authenticated;
