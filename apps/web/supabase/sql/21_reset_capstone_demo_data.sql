-- Reset operational data and seed clean capstone demo data.
--
-- Destructive scope:
--   Deletes and replaces products, inventory batches, movements, sales,
--   sale items, and sale-item batch allocations.
--
-- Preserved scope:
--   Keeps public.branches, public.profiles, and auth.users.
--
-- Run after:
--   - 20_fefo_batch_inventory.sql
--
-- Intended use:
--   Main capstone/demo database reset before testing and documentation.

begin;

do $$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.inventory_batches') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.sale_item_batch_allocations') is null
     or to_regclass('public.sales') is null
     or to_regclass('public.sale_items') is null then
    raise exception
      'Run 20_fefo_batch_inventory.sql before resetting demo operational data.';
  end if;
end
$$;

alter table public.branches
  add column if not exists manager_name text,
  add column if not exists contact_number text,
  add column if not exists address text,
  add column if not exists opening_date date,
  add column if not exists notes text,
  add column if not exists status text not null default 'active';

alter table public.products
  add column if not exists branch_id integer references public.branches (id) on update cascade on delete restrict,
  add column if not exists barcode text,
  add column if not exists reorder_level integer not null default 10,
  add column if not exists is_active boolean not null default true;

-- Keep branch and auth/profile identities stable for the capstone app.
insert into public.branches (
  id,
  code,
  name,
  manager_name,
  contact_number,
  address,
  opening_date,
  notes,
  status
)
values
  (
    1,
    'MAIN',
    'Sta. Lucia',
    'Demo Operations Lead',
    '09170000001',
    'Sta. Lucia demo branch',
    current_date - 730,
    'Primary capstone demo branch.',
    'active'
  ),
  (
    2,
    'DOLLAR',
    'Dollar',
    'Demo Branch Lead',
    '09170000002',
    'Dollar demo branch',
    current_date - 540,
    'Secondary capstone demo branch.',
    'active'
  )
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name,
  manager_name = excluded.manager_name,
  contact_number = excluded.contact_number,
  address = excluded.address,
  opening_date = excluded.opening_date,
  notes = excluded.notes,
  status = excluded.status;

truncate table
  public.sale_item_batch_allocations,
  public.inventory_movements,
  public.sale_items,
  public.sales,
  public.inventory_batches,
  public.products
restart identity cascade;

create temporary table demo_products (
  product_id bigint primary key,
  branch_id integer not null,
  branch text not null,
  barcode text not null,
  category text not null,
  product_name text not null,
  net_weight text not null,
  price numeric(12, 2) not null,
  reorder_level integer not null,
  daily_quantity integer not null,
  batch1_current integer not null,
  batch1_expiry date not null,
  batch2_current integer not null,
  batch2_expiry date not null,
  batch3_current integer not null,
  batch3_expiry date not null
) on commit drop;

insert into demo_products (
  product_id,
  branch_id,
  branch,
  barcode,
  category,
  product_name,
  net_weight,
  price,
  reorder_level,
  daily_quantity,
  batch1_current,
  batch1_expiry,
  batch2_current,
  batch2_expiry,
  batch3_current,
  batch3_expiry
)
values
  (1001, 1, 'Sta. Lucia', 'SL-MEAT-PORK500', 'Meat', 'Premium Pork Belly 500g', '500g pack', 299.00, 12, 1, 8, current_date + 7, 15, current_date + 35, 10, current_date + 70),
  (1002, 1, 'Sta. Lucia', 'SL-MEAT-BEEF500', 'Meat', 'Beef Samgyup 500g', '500g pack', 329.00, 15, 2, 2, current_date + 6, 4, current_date + 32, 0, current_date + 80),
  (1003, 1, 'Sta. Lucia', 'SL-SIDE-KIMCHI500', 'Rice / Sides', 'Kimchi 500g', '500g tub', 149.00, 15, 1, 4, current_date + 9, 8, current_date + 24, 0, current_date + 65),
  (1004, 1, 'Sta. Lucia', 'SL-VEG-LETTUCE', 'Vegetables', 'Fresh Lettuce Bundle', 'bundle', 89.00, 18, 3, 5, current_date + 4, 5, current_date + 11, 0, current_date + 18),
  (1005, 1, 'Sta. Lucia', 'SL-COND-GOCHUJANG', 'Condiments', 'Gochujang Sauce 250g', '250g jar', 119.00, 8, 1, 6, current_date + 21, 12, current_date + 90, 7, current_date + 140),
  (1006, 1, 'Sta. Lucia', 'SL-NOOD-SHIN', 'Noodles', 'Shin Ramyun Pack', 'single pack', 65.00, 20, 1, 10, current_date + 40, 12, current_date + 95, 8, current_date + 150),
  (1007, 1, 'Sta. Lucia', 'SL-DRINK-SODA', 'Drinks', 'Korean Soda Can', '250ml can', 49.00, 18, 1, 9, current_date + 75, 12, current_date + 130, 0, current_date + 180),
  (1008, 1, 'Sta. Lucia', 'SL-PACK-BOX', 'Packaging', 'Takeout Grill Box', '10 pcs', 55.00, 25, 1, 14, current_date + 180, 20, current_date + 260, 0, current_date + 320),
  (2001, 2, 'Dollar', 'DL-MEAT-PORK500', 'Meat', 'Premium Pork Belly 500g', '500g pack', 299.00, 12, 1, 4, current_date + 8, 9, current_date + 36, 4, current_date + 74),
  (2002, 2, 'Dollar', 'DL-MEAT-BEEF500', 'Meat', 'Beef Samgyup 500g', '500g pack', 329.00, 16, 1, 6, current_date + 12, 8, current_date + 42, 2, current_date + 85),
  (2003, 2, 'Dollar', 'DL-SIDE-KIMCHI500', 'Rice / Sides', 'Kimchi 500g', '500g tub', 149.00, 14, 1, 2, current_date + 5, 3, current_date + 28, 0, current_date + 65),
  (2004, 2, 'Dollar', 'DL-VEG-LETTUCE', 'Vegetables', 'Fresh Lettuce Bundle', 'bundle', 89.00, 15, 2, 2, current_date + 3, 2, current_date + 10, 0, current_date + 18),
  (2005, 2, 'Dollar', 'DL-DAIRY-CHEESE', 'Dairy', 'Mozzarella Cheese Cup', '100g cup', 79.00, 12, 1, 5, current_date + 13, 6, current_date + 48, 0, current_date + 90),
  (2006, 2, 'Dollar', 'DL-NOOD-JJAPAGETTI', 'Noodles', 'Jjapagetti Pack', 'single pack', 69.00, 18, 1, 11, current_date + 44, 16, current_date + 100, 0, current_date + 150),
  (2007, 2, 'Dollar', 'DL-DRINK-TEA', 'Coffee / Tea', 'Barley Tea Bottle', '500ml bottle', 59.00, 16, 1, 8, current_date + 70, 12, current_date + 130, 0, current_date + 180),
  (2008, 2, 'Dollar', 'DL-SUP-CLEANER', 'Supplies', 'Table Sanitizer Spray', '500ml bottle', 135.00, 10, 0, 7, current_date + 120, 10, current_date + 220, 0, current_date + 300);

insert into public.products (
  id,
  branch_id,
  branch,
  barcode,
  category,
  product_name,
  net_weight,
  price,
  stock_quantity,
  expiration_date,
  reorder_level,
  is_active
)
select
  product_id,
  branch_id,
  branch,
  barcode,
  category,
  product_name,
  net_weight,
  price,
  batch1_current + batch2_current + batch3_current,
  least(batch1_expiry, batch2_expiry, batch3_expiry),
  reorder_level,
  true
from demo_products;

create temporary table demo_batches (
  batch_id bigint generated by default as identity primary key,
  product_id bigint not null,
  branch_id integer not null,
  batch_code text not null,
  quantity_received integer not null,
  quantity_on_hand integer not null,
  expiration_date date not null,
  stock_in_date date not null,
  source text not null,
  notes text
) on commit drop;

insert into demo_batches (
  product_id,
  branch_id,
  batch_code,
  quantity_received,
  quantity_on_hand,
  expiration_date,
  stock_in_date,
  source,
  notes
)
select
  product_id,
  branch_id,
  'DEMO-' || product_id::text || '-A',
  batch1_current + (daily_quantity * 30),
  batch1_current + (daily_quantity * 30),
  batch1_expiry,
  current_date - 45,
  'stock-in',
  'Demo opening batch plus 30-day sales history allocation source.'
from demo_products
union all
select
  product_id,
  branch_id,
  'DEMO-' || product_id::text || '-B',
  batch2_current,
  batch2_current,
  batch2_expiry,
  current_date - 20,
  'stock-in',
  'Demo second FEFO batch.'
from demo_products
where batch2_current > 0
union all
select
  product_id,
  branch_id,
  'DEMO-' || product_id::text || '-C',
  batch3_current,
  batch3_current,
  batch3_expiry,
  current_date - 5,
  'stock-in',
  'Demo reserve FEFO batch.'
from demo_products
where batch3_current > 0;

insert into public.inventory_batches (
  product_id,
  branch_id,
  batch_code,
  quantity_received,
  quantity_on_hand,
  expiration_date,
  stock_in_date,
  source,
  notes
)
select
  product_id,
  branch_id,
  batch_code,
  quantity_received,
  quantity_on_hand,
  expiration_date,
  stock_in_date,
  source,
  notes
from demo_batches
order by product_id, expiration_date;

insert into public.inventory_movements (
  product_id,
  batch_id,
  branch_id,
  movement_type,
  quantity_delta,
  quantity_after,
  reference,
  notes,
  created_at
)
select
  batch.product_id,
  batch.id,
  batch.branch_id,
  'stock-in',
  batch.quantity_received,
  batch.quantity_on_hand,
  batch.batch_code,
  batch.notes,
  (batch.stock_in_date + time '09:00')::timestamptz
from public.inventory_batches batch
where batch.batch_code like 'DEMO-%';

do $$
declare
  day_offset integer;
  branch_row record;
  product_row record;
  batch_row record;
  sale_row public.sales%rowtype;
  sale_item_row public.sale_items%rowtype;
  remaining_quantity integer;
  allocated_quantity integer;
  batch_quantity_after integer;
  submitted_at_value timestamptz;
  subtotal_value numeric(12, 2);
begin
  for day_offset in reverse 29..0 loop
    for branch_row in
      select distinct branch_id, branch
      from demo_products
      order by branch_id
    loop
      select coalesce(sum(daily_quantity * price), 0)
      into subtotal_value
      from demo_products
      where branch_id = branch_row.branch_id
        and daily_quantity > 0;

      submitted_at_value :=
        (current_date - day_offset + time '13:00')::timestamptz
        + make_interval(mins => branch_row.branch_id * 7);

      insert into public.sales (
        cashier_id,
        cashier_name,
        branch_id,
        branch_name,
        payment_method,
        subtotal,
        discount,
        total_amount,
        cash_received,
        change_amount,
        submitted_at,
        notes
      )
      values (
        'demo-seed',
        'Demo Cashier',
        branch_row.branch_id,
        branch_row.branch,
        'cash',
        subtotal_value,
        0,
        subtotal_value,
        subtotal_value,
        0,
        submitted_at_value,
        'Seeded 30-day sales velocity transaction.'
      )
      returning *
      into sale_row;

      for product_row in
        select *
        from demo_products
        where branch_id = branch_row.branch_id
          and daily_quantity > 0
        order by product_id
      loop
        insert into public.sale_items (
          sale_id,
          product_id,
          inventory_item_id,
          item_name,
          quantity,
          unit_price,
          line_total
        )
        values (
          sale_row.id,
          product_row.product_id,
          product_row.product_id,
          product_row.product_name,
          product_row.daily_quantity,
          product_row.price,
          product_row.daily_quantity * product_row.price
        )
        returning *
        into sale_item_row;

        remaining_quantity := product_row.daily_quantity;

        for batch_row in
          select *
          from public.inventory_batches
          where product_id = product_row.product_id
            and branch_id = product_row.branch_id
            and quantity_on_hand > 0
          order by expiration_date asc nulls last, stock_in_date asc, id asc
          for update
        loop
          exit when remaining_quantity <= 0;

          allocated_quantity := least(remaining_quantity, batch_row.quantity_on_hand);

          update public.inventory_batches
          set quantity_on_hand = quantity_on_hand - allocated_quantity
          where id = batch_row.id
          returning quantity_on_hand
          into batch_quantity_after;

          insert into public.sale_item_batch_allocations (
            sale_id,
            sale_item_id,
            product_id,
            batch_id,
            branch_id,
            quantity,
            expiration_date,
            created_at
          )
          values (
            sale_row.id,
            sale_item_row.id,
            product_row.product_id,
            batch_row.id,
            product_row.branch_id,
            allocated_quantity,
            batch_row.expiration_date,
            submitted_at_value
          );

          insert into public.inventory_movements (
            product_id,
            batch_id,
            branch_id,
            movement_type,
            quantity_delta,
            quantity_after,
            sale_id,
            sale_item_id,
            reference,
            notes,
            created_at
          )
          values (
            product_row.product_id,
            batch_row.id,
            product_row.branch_id,
            'sale',
            -allocated_quantity,
            batch_quantity_after,
            sale_row.id,
            sale_item_row.id,
            sale_row.id::text,
            'Seeded FEFO sale movement for 30-day sales velocity.',
            submitted_at_value
          );

          remaining_quantity := remaining_quantity - allocated_quantity;
        end loop;

        if remaining_quantity > 0 then
          raise exception 'Demo seed could not allocate product % on day offset %.',
            product_row.product_id,
            day_offset;
        end if;
      end loop;
    end loop;
  end loop;
end
$$;

update public.products product
set stock_quantity = coalesce(batch_totals.stock_quantity, 0)
from (
  select
    product_id,
    sum(quantity_on_hand)::integer as stock_quantity
  from public.inventory_batches
  group by product_id
) batch_totals
where product.id = batch_totals.product_id;

select setval(pg_get_serial_sequence('public.products', 'id'), coalesce((select max(id) from public.products), 1), true);
select setval(pg_get_serial_sequence('public.inventory_batches', 'id'), coalesce((select max(id) from public.inventory_batches), 1), true);
select setval(pg_get_serial_sequence('public.inventory_movements', 'id'), coalesce((select max(id) from public.inventory_movements), 1), true);
select setval(pg_get_serial_sequence('public.sales', 'id'), coalesce((select max(id) from public.sales), 1), true);
select setval(pg_get_serial_sequence('public.sale_items', 'id'), coalesce((select max(id) from public.sale_items), 1), true);
select setval(pg_get_serial_sequence('public.sale_item_batch_allocations', 'id'), coalesce((select max(id) from public.sale_item_batch_allocations), 1), true);

commit;

-- Quick review queries.
select
  (select count(*) from public.products) as products_count,
  (select count(*) from public.inventory_batches) as batches_count,
  (select count(*) from public.sales) as sales_count,
  (select count(*) from public.sale_items) as sale_items_count,
  (select count(*) from public.sale_item_batch_allocations) as allocations_count,
  (select count(*) from public.inventory_movements) as movements_count;

select
  branch_id,
  count(*) as products,
  sum(stock_quantity) as aggregate_stock
from public.products
group by branch_id
order by branch_id;

select
  product.product_name,
  product.branch,
  batch.batch_code,
  batch.quantity_received,
  batch.quantity_on_hand,
  batch.expiration_date
from public.inventory_batches batch
join public.products product
  on product.id = batch.product_id
order by product.branch_id, product.product_name, batch.expiration_date;
