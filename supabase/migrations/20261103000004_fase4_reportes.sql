-- =====================================================================
-- Fase 4: reportes por cliente y estado de cuenta
-- =====================================================================
-- Ambas funciones usan los permisos de quien las llama (security invoker),
-- así que las reglas por fila siguen mandando; además exigen rol de
-- administrador o consulta para no devolver cifras en cero al operador.
-- =====================================================================

-- Nombre que encabeza los reportes y estados de cuenta impresos.
alter table public.configuracion
  add column nombre_negocio text not null default 'Trilla de café'
  check (length(btrim(nombre_negocio)) > 0);

-- Una fila por cliente con lo ocurrido en el periodo y el saldo al corte.
--   kg_recibido, cobrado          → recibos con fecha en el periodo
--   kg_entregado, kg_oro          → de esos recibos, los que ya tienen entrega
--   pagado                        → pagos con fecha en el periodo
--   saldo                         → todo lo cobrado − todo lo pagado hasta "hasta"
-- Sin fechas, el periodo es todo el historial.
create function public.reporte_clientes(desde date default null, hasta date default null)
returns table (
  cliente_id uuid,
  nombre text,
  activo boolean,
  kg_recibido numeric,
  kg_entregado numeric,
  kg_oro numeric,
  rendimiento numeric,
  cobrado numeric,
  pagado numeric,
  saldo numeric
)
language plpgsql stable security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.tiene_rol('admin', 'consulta') then
    raise exception 'Tu rol no puede ver reportes' using errcode = '42501';
  end if;

  return query
  select c.id, c.nombre, c.activo,
         coalesce(r.kg_recibido, 0),
         coalesce(r.kg_entregado, 0),
         coalesce(r.kg_oro, 0),
         round(r.kg_oro / nullif(r.kg_entregado, 0) * 100, 2),
         coalesce(r.cobrado, 0),
         coalesce(p.pagado, 0),
         coalesce(tc.total, 0) - coalesce(tp.total, 0)
  from public.clientes c
  left join lateral (
    select sum(x.kg_pergamino) as kg_recibido,
           sum(x.kg_pergamino) filter (where e.id is not null) as kg_entregado,
           sum(e.kg_oro) as kg_oro,
           round(sum(x.kg_pergamino * x.tarifa_aplicada), 2) as cobrado
    from public.recibos x
    left join public.entregas e on e.recibo_id = x.id and not e.anulado
    where x.cliente_id = c.id and not x.anulado
      and (desde is null or x.fecha >= desde) and (hasta is null or x.fecha <= hasta)
  ) r on true
  left join lateral (
    select sum(y.monto) as pagado
    from public.pagos y
    where y.cliente_id = c.id and not y.anulado
      and (desde is null or y.fecha >= desde) and (hasta is null or y.fecha <= hasta)
  ) p on true
  left join lateral (
    select round(sum(x.kg_pergamino * x.tarifa_aplicada), 2) as total
    from public.recibos x
    where x.cliente_id = c.id and not x.anulado and (hasta is null or x.fecha <= hasta)
  ) tc on true
  left join lateral (
    select sum(y.monto) as total
    from public.pagos y
    where y.cliente_id = c.id and not y.anulado and (hasta is null or y.fecha <= hasta)
  ) tp on true
  -- Los clientes inactivos solo aparecen si tienen movimientos o saldo.
  where c.activo or r.kg_recibido is not null or p.pagado is not null
     or coalesce(tc.total, 0) - coalesce(tp.total, 0) <> 0
  order by c.nombre;
end;
$$;

-- Estado de cuenta de un cliente: saldo anterior al periodo y movimientos
-- (recibos como cargos, pagos como abonos) en orden de fecha.
create function public.estado_cuenta(cliente uuid, desde date default null, hasta date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  cli record;
  saldo_inicial numeric := 0;
  movimientos jsonb;
begin
  if not public.tiene_rol('admin', 'consulta') then
    raise exception 'Tu rol no puede ver estados de cuenta' using errcode = '42501';
  end if;
  select c.id, c.nombre, c.telefono into cli from public.clientes c where c.id = cliente;
  if cli.id is null then
    raise exception 'Cliente no encontrado' using errcode = 'P0001';
  end if;

  if desde is not null then
    select coalesce((select round(sum(x.kg_pergamino * x.tarifa_aplicada), 2) from public.recibos x
                     where x.cliente_id = cliente and not x.anulado and x.fecha < desde), 0)
         - coalesce((select sum(y.monto) from public.pagos y
                     where y.cliente_id = cliente and not y.anulado and y.fecha < desde), 0)
    into saldo_inicial;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) - 'orden' order by m.fecha, m.orden, m.creado_en), '[]'::jsonb)
  into movimientos
  from (
    select x.fecha, 1 as orden, x.creado_en, 'recibo' as tipo,
           x.kg_pergamino, x.tarifa_aplicada, e.kg_oro,
           round(e.kg_oro / x.kg_pergamino * 100, 2) as rendimiento,
           round(x.kg_pergamino * x.tarifa_aplicada, 2) as cargo,
           null::numeric as abono, null::text as metodo, null::text as notas
    from public.recibos x
    left join public.entregas e on e.recibo_id = x.id and not e.anulado
    where x.cliente_id = cliente and not x.anulado
      and (desde is null or x.fecha >= desde) and (hasta is null or x.fecha <= hasta)
    union all
    select y.fecha, 2, y.creado_en, 'pago',
           null, null, null, null,
           null, y.monto, y.metodo, y.notas
    from public.pagos y
    where y.cliente_id = cliente and not y.anulado
      and (desde is null or y.fecha >= desde) and (hasta is null or y.fecha <= hasta)
  ) m;

  return jsonb_build_object(
    'cliente', jsonb_build_object('id', cli.id, 'nombre', cli.nombre, 'telefono', cli.telefono),
    'desde', desde,
    'hasta', hasta,
    'saldo_inicial', saldo_inicial,
    'movimientos', movimientos
  );
end;
$$;

revoke execute on function public.reporte_clientes(date, date) from public, anon;
revoke execute on function public.estado_cuenta(uuid, date, date) from public, anon;
grant execute on function public.reporte_clientes(date, date) to authenticated;
grant execute on function public.estado_cuenta(uuid, date, date) to authenticated;
