-- Prevent POS checkout from allocating expired inventory batches.
-- Run after:
--   - 20_fefo_batch_inventory.sql

begin;

do $$
begin
  if to_regclass('public.inventory_batches') is null
     or to_regclass('public.sale_item_batch_allocations') is null then
    raise exception 'Run 20_fefo_batch_inventory.sql before 24_block_expired_batch_checkout.sql.';
  end if;
end
$$;

create or replace function public.prevent_expired_batch_sale_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_expiration_date date;
  batch_code_value text;
  product_name_value text;
begin
  select
    batch.expiration_date,
    batch.batch_code,
    product.product_name
  into
    batch_expiration_date,
    batch_code_value,
    product_name_value
  from public.inventory_batches batch
  left join public.products product
    on product.id = batch.product_id
  where batch.id = new.batch_id
  limit 1;

  if batch_expiration_date is not null
     and batch_expiration_date < current_date then
    raise exception '% has expired batch stock (% expired on %) and cannot be sold. Remove or adjust expired stock first.',
      coalesce(product_name_value, 'This item'),
      coalesce(batch_code_value, 'selected batch'),
      batch_expiration_date
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_expired_batch_sale_allocation
  on public.sale_item_batch_allocations;

create trigger prevent_expired_batch_sale_allocation
  before insert on public.sale_item_batch_allocations
  for each row
  execute function public.prevent_expired_batch_sale_allocation();

revoke all on function public.prevent_expired_batch_sale_allocation() from public;
grant execute on function public.prevent_expired_batch_sale_allocation() to authenticated;

commit;
