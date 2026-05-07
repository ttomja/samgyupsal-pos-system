# FEFO Inventory System Client Explanation Guide

This document explains how the implemented system works from the client/user point of view and what happens behind the scenes. It is written for capstone defense, client walkthroughs, and team handoff.

## 1. Simple Client Explanation

The system is a web-based retail monitoring and POS system for managing products, stock, sales, branches, users, and reports.

The most important inventory feature is FEFO, which means First Expired, First Out. When a cashier sells a product, the system automatically deducts stock from the batch that will expire first. The cashier does not need to choose the batch manually. This helps reduce expired inventory and supports better stock rotation.

The system also monitors inventory risks. It can show:

- Low-stock items.
- Near-expiry batches.
- Predicted stockout items based on recent sales.
- Sales and branch performance reports.

In simple terms: the system does not only record sales. It also helps the business know which products should be sold first, which items may expire soon, and which items may run out soon.

## 2. User Roles

The current app uses two role types:

| Role | What The User Can Do |
|---|---|
| Administrator | Access dashboard, POS/sales, inventory, reports, products, users, and branch-level monitoring. Admins can manage product catalog data and review all branches. |
| Employee / Cashier | Access dashboard, POS/sales, and inventory for assigned work. Employees can process sales and update stock quantities for inventory operations. |

Role behavior is defined in `apps/web/src/shared/utils/permissions.js`.

## 3. Main User Workflows

### 3.1 Login

Users sign in using Supabase Auth. After login, the system reads the user's profile to determine:

- Role.
- Branch assignment.
- Account status.

Inactive accounts are blocked from operational actions.

### 3.2 Product Catalog

The product catalog stores product identity details, such as:

- Product name.
- Barcode.
- Category.
- Pack size or net weight.
- Price.
- Branch.
- Reorder level.

The product catalog answers the question: "What item is this?"

Physical stock is handled separately by batches.

### 3.3 Stock-In With Expiration Date

When a user adds stock, they enter:

- Product.
- Quantity.
- Expiration date.

The system creates an inventory batch. A batch represents a physical arrival of stock with its own quantity and expiration date.

Behind the scenes, stock-in calls the Supabase RPC:

`stock_in_inventory_batch(...)`

That RPC:

- Creates a row in `inventory_batches`.
- Records a positive movement in `inventory_movements`.
- Recalculates `products.stock_quantity` as a compatibility total.

Client explanation:

"Every time new stock arrives, the system stores it as a separate batch with an expiration date. This allows the system to know which stock should be sold first."

### 3.4 POS Checkout

The cashier selects or scans products in the POS screen. The cashier only selects the product and quantity. The cashier does not choose the batch.

Behind the scenes, checkout calls:

`create_checkout_sale(p_sale jsonb, p_items jsonb)`

The checkout RPC:

1. Confirms the cashier is authenticated and active.
2. Confirms the cashier is allowed to sell for the selected branch.
3. Validates sale totals, cash received, and change.
4. Checks available batch stock.
5. Inserts the sale record.
6. Inserts sale item records.
7. Deducts stock from batches ordered by:
   - earliest `expiration_date`
   - then earliest `stock_in_date`
   - then lowest batch id
8. If one batch is not enough, it continues deducting from the next batch.
9. Records which batch was used in `sale_item_batch_allocations`.
10. Records stock movement history in `inventory_movements`.
11. Updates product aggregate stock.

Client explanation:

"The cashier only sells the product normally. The system automatically finds the earliest-expiring batch and deducts from it first. If that batch is not enough, it continues with the next earliest batch."

## 4. FEFO Example

Example product: Premium Pork Belly 500g

| Batch | Expiration Date | Available Quantity |
|---|---:|---:|
| Batch A | May 15, 2026 | 3 |
| Batch B | June 15, 2026 | 5 |

If the cashier sells 5 units:

| Batch | Quantity Deducted | Quantity Left |
|---|---:|---:|
| Batch A | 3 | 0 |
| Batch B | 2 | 3 |

This proves two things:

- The earliest-expiring batch was used first.
- Multi-batch deduction works when the first batch cannot cover the full sale quantity.

## 5. Database Tables Involved

| Table | Purpose |
|---|---|
| `branches` | Stores branch information such as Sta. Lucia and Dollar. |
| `profiles` | Stores user role, branch assignment, and account status. |
| `products` | Stores product identity and compatibility stock total. |
| `inventory_batches` | Stores physical stock batches with expiration dates. |
| `inventory_movements` | Stores stock movement audit history. |
| `sales` | Stores sale header records. |
| `sale_items` | Stores products sold in each sale. |
| `sale_item_batch_allocations` | Stores which batch was deducted for each sale item. |

Important distinction:

- `products` tells the system what the product is.
- `inventory_batches` tells the system where the physical stock is and when it expires.

## 6. Predictive Inventory Alerts

Predictive alerts are computed in the frontend report service:

`apps/web/src/features/reports/services/reportService.js`

The current settings are:

| Setting | Value |
|---|---:|
| Sales velocity window | 30 days |
| Stockout alert window | 14 days |
| Near-expiry alert window | 30 days |

### 6.1 Sales Velocity Formula

Average Daily Sales:

```text
Average Daily Sales = Total Units Sold in Last 30 Days / 30
```

Estimated Days Before Stockout:

```text
Estimated Days Before Stockout = Current Stock / Average Daily Sales
```

Estimated Stockout Date:

```text
Estimated Stockout Date = Today + Estimated Days Before Stockout
```

The system creates a stockout alert when:

- estimated days before stockout is within 14 days, or
- current stock is already at or below the reorder level.

Client explanation:

"The system looks at the last 30 days of sales and estimates how fast each product is selling. If the current stock may run out soon, it appears as a predictive stockout alert."

### 6.2 Near-Expiry Alerts

Near-expiry alerts come from available batches in `inventory_batches`.

The system checks:

- batch still has quantity on hand
- batch has an expiration date
- expiration date is within 30 days

Client explanation:

"The system checks batch expiration dates and highlights products that should be sold soon before they expire."

## 7. Branch Logic

The system supports multiple branches. The current demo branches are:

- Sta. Lucia
- Dollar

Branch data affects:

- Products.
- Inventory batches.
- Sales.
- User assignment.
- Dashboard and report filtering.

Client explanation:

"Each branch has its own inventory and sales. Admins can view overall operations, while employees are scoped to their assigned branch."

## 8. Dashboard And Reports

### Dashboard

The dashboard summarizes:

- Sales.
- Transactions.
- Items sold.
- Low-stock items.
- Predictive stockout alerts.
- Near-expiry alerts.
- Branch and employee counts for administrators.

### Reports

The reports page shows:

- Total sales.
- Transaction count.
- Items sold.
- Top-selling products.
- Low-stock items.
- Predictive stockout alerts.
- Near-expiry batch alerts.
- Cashier performance.

Client explanation:

"The dashboard gives a quick operational view, while reports provide more detailed sales and inventory risk information."

## 9. Clean Demo Data Reset

The project includes a reset and seed script:

`apps/web/supabase/sql/21_reset_capstone_demo_data.sql`

It keeps:

- `branches`
- `profiles`
- Auth users

It resets:

- `products`
- `inventory_batches`
- `inventory_movements`
- `sales`
- `sale_items`
- `sale_item_batch_allocations`

It seeds:

- Products for Sta. Lucia and Dollar.
- Multiple batches per product.
- Near-expiry batches.
- Low-stock products.
- 30 days of sales history.
- Sale-to-batch allocation records.
- Inventory movement records.

This script should be run in Supabase SQL Editor with the confirmed destructive approval.

## 10. FEFO Smoke Test

The project includes a reusable smoke test:

`apps/web/supabase/smoke-test-fefo.mjs`

Run it from PowerShell:

```powershell
$env:FEFO_SMOKE_EMAIL='your-test-admin@example.com'
$env:FEFO_SMOKE_PASSWORD='your-password'
$env:FEFO_SMOKE_BRANCH_ID='1'
npm run test:fefo-smoke
```

The smoke test:

1. Logs in with a test account.
2. Creates a test product.
3. Adds two batches with different expiration dates.
4. Runs a checkout sale.
5. Confirms the earliest batch was deducted first.
6. Confirms multi-batch allocation.
7. Confirms movement records and product stock total.

## 11. Suggested Client Demo Script

Use this flow during presentation:

1. Login as an administrator.
2. Open Dashboard and explain operational monitoring.
3. Open Inventory and show branch inventory.
4. Select a product and explain that stock is separated into batches.
5. Perform Stock-In with an expiration date.
6. Open POS and sell a product.
7. Explain that the cashier does not choose a batch manually.
8. Explain FEFO automatic deduction.
9. Open Reports and show:
   - top-selling products
   - low-stock items
   - near-expiry alerts
   - predictive stockout alerts
10. Explain that predictions are based on the last 30 days of sales history.

Short client explanation:

"This system helps the store sell the right stock first, monitor branch inventory, and predict which products need attention before they become a problem."

## 12. Important Limitations To Explain Honestly

The current implementation is strong enough for capstone demonstration, but these points should be explained clearly:

- Predictive alerts are computed in the app/report layer and are not stored as alert rows in a database table.
- The product table still keeps `stock_quantity` as a compatibility aggregate, but physical stock truth is now in `inventory_batches`.
- The reset script is destructive and should only be used for demo data preparation.
- Live deployment must use the updated frontend code after the FEFO SQL scripts are applied.

## 13. Evidence Of Implemented FEFO

The implementation is supported by:

- `inventory_batches` table for batch-level inventory.
- `inventory_movements` table for stock audit history.
- `sale_item_batch_allocations` table for sale-to-batch traceability.
- `create_checkout_sale(...)` RPC for transactional FEFO checkout.
- `stock_in_inventory_batch(...)` RPC for batch stock-in.
- `adjust_inventory_stock_count(...)` RPC for batch-aware stock adjustment.
- Reports logic for 30-day sales velocity and stockout prediction.
- Dashboard and reports UI for predictive and near-expiry alerts.

## 14. Best One-Sentence Explanation

"The system tracks every product by branch and expiration batch, automatically sells the earliest-expiring stock first during checkout, records exactly which batch was used, and uses recent sales history to warn users about products that may expire or run out soon."
