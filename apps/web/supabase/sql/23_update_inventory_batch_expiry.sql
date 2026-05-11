-- Allow administrator product edits to update the active inventory batch expiry.
-- Run after:
--   - 20_fefo_batch_inventory.sql
--   - 22_restrict_stock_adjustment_to_admin.sql

begin;

do $$
begin
  if to_regprocedure('private.current_user_is_admin()') is null
     or to_regprocedure('private.resolve_product_branch_id(integer, text)') is null then
    raise exception 'Run the auth and FEFO batch inventory scripts before 23_update_inventory_batch_expiry.sql.';
  end if;

  if to_regclass('public.products') is null
     or to_regclass('public.inventory_batches') is null
     or to_regclass('public.inventory_movements') is null then
    raise exception 'Run 20_fefo_batch_inventory.sql before 23_update_inventory_batch_expiry.sql.';
  end if;
end
$$;

create or replace function private.sync_product_expiration_from_batches(
  p_product_id bigint,
  p_fallback_expiration_date date default null
)
returns date
language plpgsql
security definer
set search_path = public, private
as $$
declare
  next_expiration_date date;
begin
  select min(batch.expiration_date)
  into next_expiration_date
  from public.inventory_batches batch
  where batch.product_id = p_product_id
    and batch.quantity_on_hand > 0
    and batch.expiration_date is not null;

  update public.products
  set expiration_date = coalesce(next_expiration_date, p_fallback_expiration_date)
  where id = p_product_id;

  return coalesce(next_expiration_date, p_fallback_expiration_date);
end;
$$;

create or replace function private.update_inventory_batch_expiration(
  p_product_id bigint,
  p_branch_id integer,
  p_expiration_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  product_row public.products%rowtype;
  resolved_branch_id integer;
  target_batch public.inventory_batches%rowtype;
  updated_batch public.inventory_batches%rowtype;
  old_expiration_date date;
  product_expiration_date date;
begin
  if not private.current_user_is_admin() then
    raise exception 'Only administrator accounts can edit batch expiry dates.'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'Product is required when updating a batch expiry date.'
      using errcode = '22023';
  end if;

  select *
  into product_row
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'The selected product is no longer available.'
      using errcode = '23503';
  end if;

  resolved_branch_id := private.resolve_product_branch_id(
    product_row.branch_id,
    product_row.branch
  );

  if resolved_branch_id is null then
    raise exception 'The selected product does not have a valid branch.'
      using errcode = '22023';
  end if;

  if p_branch_id is not null and p_branch_id is distinct from resolved_branch_id then
    raise exception 'The selected product belongs to a different branch.'
      using errcode = '42501';
  end if;

  select *
  into target_batch
  from public.inventory_batches batch
  where batch.product_id = p_product_id
    and batch.branch_id = resolved_branch_id
    and batch.quantity_on_hand > 0
  order by batch.expiration_date asc nulls last, batch.stock_in_date asc, batch.id asc
  limit 1
  for update;

  if not found then
    select *
    into target_batch
    from public.inventory_batches batch
    where batch.product_id = p_product_id
      and batch.branch_id = resolved_branch_id
    order by batch.expiration_date asc nulls last, batch.stock_in_date asc, batch.id asc
    limit 1
    for update;
  end if;

  if not found then
    product_expiration_date := private.sync_product_expiration_from_batches(
      p_product_id,
      p_expiration_date
    );

    return jsonb_build_object(
      'ok', true,
      'product_id', p_product_id,
      'batch_id', null,
      'expiration_date', p_expiration_date,
      'product_expiration_date', product_expiration_date
    );
  end if;

  old_expiration_date := target_batch.expiration_date;

  update public.inventory_batches
  set expiration_date = p_expiration_date
  where id = target_batch.id
  returning *
  into updated_batch;

  if old_expiration_date is distinct from p_expiration_date then
    insert into public.inventory_movements (
      product_id,
      batch_id,
      branch_id,
      movement_type,
      quantity_delta,
      quantity_after,
      reference,
      notes,
      created_by
    )
    values (
      p_product_id,
      updated_batch.id,
      resolved_branch_id,
      'correction',
      0,
      updated_batch.quantity_on_hand,
      coalesce(updated_batch.batch_code, 'BATCH-' || updated_batch.id::text),
      'Batch expiry changed from ' ||
        coalesce(old_expiration_date::text, 'none') ||
        ' to ' ||
        coalesce(p_expiration_date::text, 'none') ||
        ' from inventory edit.',
      auth.uid()
    );
  end if;

  product_expiration_date := private.sync_product_expiration_from_batches(
    p_product_id,
    p_expiration_date
  );

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'batch_id', updated_batch.id,
    'old_expiration_date', old_expiration_date,
    'expiration_date', updated_batch.expiration_date,
    'product_expiration_date', product_expiration_date
  );
end;
$$;

create or replace function public.update_inventory_batch_expiration(
  p_product_id bigint,
  p_branch_id integer,
  p_expiration_date date
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.update_inventory_batch_expiration(
    p_product_id,
    p_branch_id,
    p_expiration_date
  );
$$;

revoke all on function private.sync_product_expiration_from_batches(bigint, date) from public;
revoke all on function private.sync_product_expiration_from_batches(bigint, date) from authenticated;
revoke all on function private.update_inventory_batch_expiration(bigint, integer, date) from public;
revoke all on function private.update_inventory_batch_expiration(bigint, integer, date) from authenticated;
revoke all on function public.update_inventory_batch_expiration(bigint, integer, date) from public;
grant execute on function public.update_inventory_batch_expiration(bigint, integer, date) to authenticated;

commit;
