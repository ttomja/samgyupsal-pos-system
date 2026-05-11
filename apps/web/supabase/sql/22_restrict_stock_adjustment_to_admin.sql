-- Restrict manual stock-count adjustment to administrator profiles.
-- Run after 20_fefo_batch_inventory.sql.

do $$
begin
  if to_regprocedure('private.current_user_is_admin()') is null then
    raise exception 'Run the auth role-policy scripts before restricting stock adjustments.';
  end if;

  if to_regprocedure('private.adjust_inventory_stock_count(bigint, integer, integer, date, text)') is null then
    raise exception 'Run 20_fefo_batch_inventory.sql before restricting stock adjustments.';
  end if;
end $$;

create or replace function public.adjust_inventory_stock_count(
  p_product_id bigint,
  p_branch_id integer,
  p_target_quantity integer,
  p_expiration_date date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.current_user_is_admin() then
    raise exception 'Only administrator accounts can adjust stock counts.'
      using errcode = '42501';
  end if;

  return private.adjust_inventory_stock_count(
    p_product_id,
    p_branch_id,
    p_target_quantity,
    p_expiration_date,
    p_notes
  );
end;
$$;

revoke all on function private.adjust_inventory_stock_count(bigint, integer, integer, date, text) from public;
revoke all on function private.adjust_inventory_stock_count(bigint, integer, integer, date, text) from authenticated;
revoke all on function public.adjust_inventory_stock_count(bigint, integer, integer, date, text) from public;
grant execute on function public.adjust_inventory_stock_count(bigint, integer, integer, date, text) to authenticated;
