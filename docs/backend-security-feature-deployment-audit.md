# Backend, Security, Feature, and Deployment Audit

Audited on: 2026-05-10, Asia/Manila  
Local branch: `main`  
Local latest commit: `8626750 Implement FEFO reporting and exports`  
Repository remote: `https://github.com/ttomja/samgyupsal-pos-system.git`

This audit is based on the actual project files, Supabase SQL, frontend service code, environment configuration shape, and available Vercel project data. The local repository does not contain `.vercel/project.json` because `.vercel/` is ignored, but the Vercel API shows a connected project named `samgyupsal-pos-system`.

## A. Executive Summary

- Overall backend status: The system is not "no backend." It uses a Backend-as-a-Service setup with Supabase Auth, Supabase PostgreSQL, RLS policies, database triggers, security-definer RPC functions, and one Supabase Edge Function. It is a partial backend layer, not a traditional custom Express/Next/API backend.
- Overall security status: The security model is acceptable for a student capstone if the latest SQL scripts are actually applied in Supabase, especially `09_auth_role_policies.sql`, `18_auth_inventory_hardening.sql`, and `20_fefo_batch_inventory.sql`. The main risks are direct frontend-to-Supabase access depending on RLS, employee stock adjustment power, a mismatch between frontend branch-wide sales filtering and SQL cashier-only sales policies, no sale void/cancel status, and no full audit trail.
- Overall feature completeness: Core title features are now substantially implemented: multi-branch views, POS checkout, FEFO batch deduction, inventory movements, sale-to-batch allocations, reports, low-stock alerts, near-expiry alerts, and simple predictive stockout alerts. Remaining weak areas are audit logging, sale status/voiding, production RLS verification, and keeping `products.stock_quantity` consistent as an aggregate.
- Overall deployment status: Vercel project `samgyupsal-pos-system` exists under team `IDOLOST`. Latest production deployment `dpl_BewE1vQ7fcQqYJJTAiSh7Pkz9KaJ` is `READY`, built from GitHub repo `ttomja/samgyupsal-pos-system`, branch `main`, commit `8626750c0c3304837e943f9f4956d8787ca25ffa`. The public URL `https://samgyupsal.vercel.app` returned HTTP `200`. Build-log access through the available Vercel tool returned `401`, so detailed build logs should still be checked in the Vercel dashboard when debugging.

## B. Backend Assessment

### What Backend Exists

The current backend is Supabase-centered:

- Supabase Auth is used in `apps/web/src/features/auth/services/authService.js` via `supabase.auth.signInWithPassword`, `supabase.auth.getSession`, `supabase.auth.onAuthStateChange`, and `supabase.auth.signOut`.
- The frontend Supabase client is configured in `apps/web/src/shared/supabase/client.js`.
- PostgreSQL schema is defined in `apps/web/supabase/sql/*.sql`.
- RLS is defined across `02_authenticated_bootstrap_policies.sql`, `04_auth_profiles_rollout.sql`, `09_auth_role_policies.sql`, and `20_fefo_batch_inventory.sql`.
- Checkout, stock-in, stock adjustment, session locking, and FEFO logic are implemented as RPC/database functions:
  - `public.create_checkout_sale` and `private.create_checkout_sale` in `20_fefo_batch_inventory.sql`
  - `public.stock_in_inventory_batch` and `private.stock_in_inventory_batch` in `20_fefo_batch_inventory.sql`
  - `public.adjust_inventory_stock_count` and `private.adjust_inventory_stock_count` in `20_fefo_batch_inventory.sql`
  - `public.claim_session_lock`, `public.validate_session_lock`, and `public.release_session_lock` in `10_auth_session_locking.sql`
- A Supabase Edge Function exists at `apps/web/supabase/functions/admin-create-user/index.ts` for admin-controlled employee Auth user creation using the service role key inside Supabase, not in the browser.
- Business logic outside the frontend exists in database RPCs and triggers. The strongest example is `private.create_checkout_sale`, which validates the authenticated cashier, validates branch scope, inserts the sale and sale items, deducts FEFO batches, records allocations, records movements, and recalculates product stock.

### What Is Missing

- There is no traditional custom backend server such as Express, Fastify, Nest, Next API routes, or Vercel serverless API routes for normal app operations.
- Reporting/export generation is client-side in `apps/web/src/features/reports/services/reportService.js`, `apps/web/src/features/reports/pages/ReportsPage.jsx`, `apps/web/src/features/pos/components/SalesHistoryPanel.jsx`, and `apps/web/src/shared/utils/exportData.js`.
- No dedicated immutable `activity_logs` or `audit_logs` table was found for tracking profile edits, branch changes, role changes, product edits, and admin actions.
- No automated migration runner or deployment gate was found that proves the SQL files are applied to the live Supabase project on each deploy.
- No sale `status` field exists for completed/cancelled/voided/draft/failed states. Current report logic treats saved sales as completed sales.

### Is It Acceptable For Capstone?

Yes, this is acceptable for a web-based cloud-integrated capstone if described accurately. The system should be described as using Supabase as the backend/data layer, not as having a separate custom backend server. Supabase provides authentication, database storage, RLS security, database functions, triggers, and Edge Functions. For a student capstone, this is a valid backend architecture as long as security and business-critical logic are enforced in Supabase and not only in the UI.

### Recommended Backend Improvements

- Verify that the live Supabase project has all required SQL scripts applied through `21_reset_capstone_demo_data.sql`.
- Add a simple `activity_logs` table with trigger/RPC inserts for admin profile changes, product changes, stock adjustments, and branch changes.
- Add a `sales.status` column with values such as `completed`, `voided`, and `cancelled`.
- Decide whether employees should see all branch sales or only their own cashier sales, then align the SQL RLS policies with that decision.
- Prefer RPC-only inventory writes for employees. Avoid direct `products.stock_quantity` updates from the browser except through controlled functions.

## C. Security Findings

| Issue | Location/File | Risk Level | Explanation | Recommended Fix |
|---|---|---:|---|---|
| Security depends heavily on RLS because the browser calls Supabase directly | `apps/web/src/shared/supabase/client.js` | Medium | Public Supabase keys are normal for frontend apps, but every table and RPC must be protected correctly because users can call Supabase outside the UI. | Keep service role keys out of frontend, keep RLS enabled, test policies using admin and employee accounts, and move high-risk actions to RPC/Edge Functions. |
| Bootstrap policies are broad if later hardening scripts are not applied | `apps/web/supabase/sql/02_authenticated_bootstrap_policies.sql` | High | This file grants broad authenticated access and creates `using (true)` / `with check (true)` policies for early setup. Later scripts remove or replace these. | Confirm `09_auth_role_policies.sql`, `18_auth_inventory_hardening.sql`, and `20_fefo_batch_inventory.sql` are applied in production. Do not stop at script 02. |
| Employees can update assigned product stock under final policies | `09_auth_role_policies.sql`, `18_auth_inventory_hardening.sql`, `permissions.js` | Medium | `products_update_assigned` allows assigned users to update products; `18_auth_inventory_hardening.sql` limits non-admin changes to `stock_quantity`, and frontend `canAdjustInventoryStock` allows employees. This may be intentional, but it is still sensitive. | If employees should not perform stock adjustments, restrict stock-in/adjustment RPCs to admin. If they should, document it and require movements/audit logs for every change. |
| Employee sales visibility differs between frontend and RLS | `salesService.js`, `09_auth_role_policies.sql` | Medium | Frontend filters employees by `branch_id`, but SQL policy `sales_select_cashier` only allows rows where `cashier_id = auth.uid()::text`. Employee reports may show only their own sales, not full branch sales. | Choose the intended rule. Add branch-wide employee sales select policies if employees should see all assigned-branch sales, or update UI/docs to say employees see their own completed sales. |
| Sale item visibility follows cashier-only policy | `09_auth_role_policies.sql` | Medium | `sale_items_select_cashier` only returns items for sales made by the authenticated cashier. This can limit branch-level employee reports. | Align `sale_items` RLS with the chosen sales visibility policy. |
| No sale status for void/cancel/draft/failed | `01_core_tables.sql`, `salesService.js`, `reportService.js` | Medium | Reports are based on saved `sales` rows. Because no status exists, the system cannot exclude cancelled, voided, draft, or failed transactions beyond not creating those rows. | Add `sales.status` default `completed`; filter reports on `status = 'completed'`; add admin-only void flow if needed. |
| Inventory adjustment is not fully separated from product aggregate stock | `20_fefo_batch_inventory.sql`, `inventoryService.js` | Medium | `inventory_batches` is the real batch source, but `private.recalculate_product_stock` updates `products.stock_quantity`. A denormalized aggregate can drift if any future path bypasses batch functions. | Make batch tables the source of truth. Keep `products.stock_quantity` only as a derived/cache field maintained by triggers/RPC. Remove direct stock edits where possible. |
| Alerts are generated in UI/service code, not stored | `reportService.js`, `DashboardPage.jsx`, `ReportsPage.jsx` | Low | Low-stock, near-expiry, and predictive stockout alerts are computed when loading reports/dashboard and are not persisted in an alerts table. This is acceptable for display but weaker for audit. | Optional: add `inventory_alerts` snapshots or scheduled alert generation if the defense requires stored alerts. |
| Admin employee creation is safely moved out of frontend, but function deployment is required | `apps/web/supabase/functions/admin-create-user/index.ts` | Medium | The Edge Function correctly checks caller auth/profile and uses the service role inside Supabase, but the app depends on this function being deployed with correct environment variables. | Verify the function is deployed and has `SUPABASE_SERVICE_ROLE_KEY` only in Supabase function secrets. |
| Local fallback auth/data mode is risky if enabled in production | `client.js`, `authService.js`, `userService.js` | High | If `VITE_SUPABASE_AUTH_ENABLED=false`, login/data can fall back to local browser storage. Local storage accounts are not production security. | Keep `VITE_SUPABASE_AUTH_ENABLED=true` in Vercel Production. Consider removing local fallback from production builds. |
| No full audit trail for admin/user/branch/product edits | `profileService.js`, `branchService.js`, `inventoryService.js` | Medium | Inventory movements exist, but profile, branch, product catalog, and role/status changes do not have a dedicated immutable audit log. | Add `activity_logs` table and write logs from RPCs/triggers/Edge Functions. |
| Branch creation appears admin-only at RLS level, but profile update relies on RLS | `branchService.js`, `profileService.js`, `04_auth_profiles_rollout.sql`, `09_auth_role_policies.sql` | Medium | Branch creation and profile updates are called from frontend services and rely on policies such as `branches_insert_admin` and `profiles_update_admin`. | Keep these RLS policies verified; add UI and policy tests for employee denial. |
| `.env` exists locally but is gitignored | `apps/web/.env`, `.gitignore` | Low | Local env file exists and is ignored. Scan showed Supabase URL/key variables set and auth enabled; no frontend service-role key reference was found. | Keep `.env` uncommitted. Ensure Vercel env vars match local keys. |
| Vercel build logs were not accessible through the available tool | Vercel API tool result | Low | Latest deployment is `READY`, but build logs returned `401` through the current tool. | Use Vercel dashboard deployment logs for detailed failure/debug history. |

## D. Feature Completeness Matrix

| Feature | Status | Evidence from Code | Problem | Recommended Fix |
|---|---|---|---|---|
| Multi-branch management | Implemented but risky/weak | `branches` table in `01_core_tables.sql`; `branchService.js`; branch filters in `InventoryPage.jsx`, `PosPage.jsx`, `ReportsPage.jsx`; seed branches `Sta. Lucia` and `Dollar` in `21_reset_capstone_demo_data.sql` | Frontend supports branch filtering; sales RLS for employees is cashier-only, not branch-wide. | Align employee sales/report visibility between RLS, UI, and documentation. |
| Product catalog | Implemented | `products` table; `product_catalog_view`; `productService.js`; `ProductsPage.jsx`; admin-only route in `AppRouter.jsx` | Product identity and branch inventory are improved but still include aggregate stock fields. | Keep catalog admin-only; make batch inventory the source of truth. |
| Inventory batch records | Implemented | `inventory_batches` table in `20_fefo_batch_inventory.sql`; `inventoryService.js` fetches and sorts batches | Batch records are present and branch/product linked. | Keep smoke-testing batch creation and FEFO deductions. |
| Expiration dates | Implemented | `inventory_batches.expiration_date`; stock-in RPC requires expiration date; `InventoryPage.jsx` stock-in dialog asks for batch expiry date; `reportService.js` near-expiry logic | Product-level legacy/fallback expiration still exists. | Use batch expiration for all FEFO and alerts; keep product expiration only as fallback/migration support. |
| FEFO deduction or batch selection logic | Implemented | `private.create_checkout_sale` in `20_fefo_batch_inventory.sql` orders batches by `expiration_date asc nulls last, stock_in_date asc, id asc`, updates `quantity_on_hand`, and records allocations | Cashier does not manually pick batches, which matches intended FEFO automation. | Continue using RPC for checkout; add UI sale detail for allocations if needed. |
| Stock-in / stock-out tracking | Implemented but risky/weak | `stock_in_inventory_batch`, `adjust_inventory_stock_count`, `inventory_movements`, `inventoryService.js` | Inventory movements exist, but no full audit page and employees may adjust stock if permitted. | Add movement/audit review page; decide admin-only vs employee stock adjustment. |
| POS checkout | Implemented | `PosPage.jsx`, `PaymentPanel.jsx`, `salesService.createSale`, `salesService.createSupabaseSale`, `public.create_checkout_sale` RPC | Checkout relies on RPC when Supabase data is enabled; local fallback exists if auth disabled. | Keep production auth/data enabled; test checkout through Supabase. |
| Sales records | Implemented | `sales` table in `01_core_tables.sql`; `salesService.js`; `SalesHistoryPanel.jsx` | No sale status/voiding. | Add `sales.status` and void/cancel handling if required by panel questions. |
| Sale item records | Implemented | `sale_items` table; `getSupabaseSaleItemsBySaleIds`; sale item insert in checkout RPC | Add-ons are stored as sale item rows with `product_id = null`, which is fine. | Keep service fee rows excluded from inventory deduction and analytics where appropriate. |
| Sale-to-batch allocation records | Implemented | `sale_item_batch_allocations` table and insert logic in `private.create_checkout_sale`; RPC returns `allocations` | Allocations are recorded but not prominently displayed in sale history UI. | Add a batch allocation view in transaction details for stronger defense evidence. |
| Low-stock alerts | Implemented | `inventoryService.isLowStock`, `getInventoryStatus`, `reportService.buildLowStockRows`, `DashboardPage.jsx`, `ReportsPage.jsx` | Alerts are display-computed, not stored. | Accept for capstone, or add stored alert snapshots if needed. |
| Near-expiry alerts | Implemented | `reportService.buildNearExpiryAlerts`, `NEAR_EXPIRY_ALERT_DAYS = 30`, batch data from inventory service | Generated from loaded inventory/batches, not stored. | Keep demo data with near-expiry batches; consider alert persistence later. |
| Predictive stockout alerts | Implemented but simple | `reportService.js`: `SALES_VELOCITY_WINDOW_DAYS = 30`, `STOCKOUT_ALERT_DAYS = 14`, `buildSalesVelocityMap`, `buildPredictiveStockoutAlerts` | This is formula-based prediction, not machine learning. | Describe it as sales-velocity-based prediction. Use more demo sales data for reliable alerts. |
| Reports / analytics dashboard | Implemented | `ReportsPage.jsx`, `DashboardPage.jsx`, `SummaryCards.jsx`, `TopItemsTable.jsx`, `reportService.getReportSnapshot` | Reports are client-side calculations from Supabase data; no server-side report snapshot. | Accept for capstone; add database views/RPCs if stronger auditability is needed. |
| User roles and permissions | Implemented but limited | `permissions.js` defines only `admin` and `employee`; `profiles.role_key` check allows only `admin`, `employee`; route guards in `AppRouter.jsx`; RLS in SQL | No manager, branch manager, or inventory-staff roles. | Document two-role model or add more roles only if truly needed. |
| Audit trail / activity logs | Partially implemented | `inventory_movements` records stock-in, sale, adjustment; no separate profile/branch/product activity log found | Inventory has movement trail, but admin actions and profile changes are not fully audited. | Add `activity_logs` and log admin/user/branch/product changes. |
| Branch-specific data filtering | Implemented but risky/weak | `InventoryPage.jsx`, `ReportsPage.jsx`, `SalesHistoryPanel.jsx`, `salesService.applySupabaseSalesFilters`, RLS branch policies for products/batches/movements | Sales SQL policies are cashier-only for employees, creating possible mismatch. | Align employee branch reporting with RLS. |
| Cloud deployment readiness | Implemented | `vercel.json`; root `package.json`; Vercel project/deployment data; Supabase env shape in `.env.example` and `.env` | Live deploy is ready, but local `.vercel/project.json` is absent and build logs were not accessible through the tool. | Use Vercel dashboard for production branch/env/log checks; keep env variables synchronized. |
| Barcode scan/search | Partially implemented | Product fields include `barcode`; `productService.js` normalizes `barcode`; POS product search includes product text fields | No dedicated hardware scanner integration was found; barcode is searchable as product metadata. | Present as barcode/search support, not a specialized scanner subsystem, unless scanner-specific UI is added. |
| Role-specific dashboards | Partially implemented | `DashboardPage.jsx` renders admin and employee scopes; `AppRouter.jsx` route restrictions | Both roles share major pages; role behavior is mostly filtering and route access. | This is acceptable; document admin vs employee access clearly. |

## E. Vercel Deployment Diagnosis

Actual deployment evidence found:

- Vercel team: `IDOLOST` / `team_vZuaIfSw29r1Lbep6wa9e7qM`
- Vercel project: `samgyupsal-pos-system` / `prj_0PBGUedHgbhm1cODfJKgz4TgtuOm`
- Latest production deployment: `dpl_BewE1vQ7fcQqYJJTAiSh7Pkz9KaJ`
- Latest deployment state: `READY`
- Latest deployment source: GitHub, repo `ttomja/samgyupsal-pos-system`, branch `main`, commit `8626750c0c3304837e943f9f4956d8787ca25ffa`
- Aliases include `samgyupsal.vercel.app`
- Live HTTP check: `https://samgyupsal.vercel.app` returned `200`
- Build logs: not retrievable by the current tool due to `401 unauthorized`; use the Vercel dashboard for detailed logs.

| Possible Cause | How to Check | How to Fix |
|---|---|---|
| Push went to the wrong branch | Run `git branch --show-current`, `git log -1 --oneline`, and compare with Vercel deployment metadata. Current branch is `main`. | Push to the branch configured as Vercel Production Branch, currently deployment metadata shows `main`. |
| Code was committed locally but not pushed | Run `git status --short`; check GitHub latest commit. Current local worktree was clean during audit. | Commit and push, then confirm GitHub shows the commit. |
| Vercel connected to wrong repo | Check Vercel project Git settings. Current deployment metadata shows `ttomja/samgyupsal-pos-system`. | Reconnect the correct GitHub repo in Vercel if it differs. |
| Vercel production branch is wrong | Check Vercel Dashboard > Project > Settings > Git > Production Branch. | Set it to `main` if your team pushes production work to `main`. |
| Deployment failed | Check Vercel Deployments tab. The latest audited deployment is `READY`, but dashboard logs should still be checked when there is a problem. | Open the failed deployment and fix build errors, then redeploy. |
| Build command/output directory mismatch | Check `vercel.json`: `installCommand` is `npm run install:web`, `buildCommand` is `npm run build:web`, `outputDirectory` is `apps/web/dist`. | Make sure Vercel project root is repository root. If Vercel root is set to `apps/web`, update settings or config accordingly. |
| Environment variable mismatch | Compare local `.env` keys with Vercel Production env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`, auth/table/RPC vars. | Add/update Vercel env vars and redeploy. Vite env changes require a new build. |
| Supabase production project differs from local | Login and inspect the browser network/config or Vercel env vars. | Point Vercel env vars to the intended Supabase project and redeploy. |
| Browser cache | Hard refresh, use incognito, or try another browser/device. | Clear browser cache. |
| Service worker or PWA cache | Search found no `serviceWorker`, `navigator.serviceWorker`, `workbox`, or `vite-plugin-pwa` references in `apps/web`, so this is unlikely. | If a service worker is added later, unregister it during debugging. |
| Vercel build cache is stale | In Vercel deployment menu, use redeploy without build cache. | Redeploy without cache after dependency or env changes. |
| Preview URL used instead of production URL | Compare URL with aliases. Production alias includes `samgyupsal.vercel.app`; preview deployments have unique generated URLs. | Use production URL or promote the correct preview deployment. |
| Wrong Vercel project linked locally | `.vercel/project.json` is not present locally because `.vercel/` is ignored. | Run `vercel link` locally only if you need CLI project linking; do not commit `.vercel`. |
| Build logs unavailable through tool | Current tool got `401` for build logs. | Use Vercel dashboard or CLI with the correct authenticated account/team. |
| GitHub integration permissions changed | Check Vercel Project > Settings > Git and GitHub app permissions. | Reconnect GitHub integration or reauthorize repository access. |
| Database migrations not applied | Frontend deploy may be updated while Supabase schema is old. | Apply SQL migrations in order, especially `20_fefo_batch_inventory.sql`, then run the FEFO smoke test. |

## F. Priority Action Plan

### 1. Must Fix Before Defense

1. Verify the live Supabase database has the final schema: `inventory_batches`, `inventory_movements`, `sale_item_batch_allocations`, final RLS, and final RPCs from `20_fefo_batch_inventory.sql`.
2. Run and record a FEFO smoke test showing one checkout deducting from earliest-expiring batches and writing `sale_item_batch_allocations`.
3. Decide and document employee sales visibility: assigned-branch sales or own-cashier sales only. Update RLS/UI/docs if they do not match.
4. Confirm Vercel Production env vars match local env names and `VITE_SUPABASE_AUTH_ENABLED=true`.
5. Prepare a defense explanation that the backend is Supabase BaaS plus database functions/RLS/Edge Function.
6. Keep service-role keys out of frontend and only in Supabase Edge Function secrets.
7. Ensure the demo database contains predictable Sta. Lucia and Dollar data for reports, FEFO, near-expiry, and stockout alerts.

### 2. Should Fix If Time Allows

1. Add `sales.status` and filter reports by `completed`.
2. Add an `activity_logs` table for admin actions, product changes, branch changes, role/status changes, and manual inventory adjustments.
3. Restrict employee stock adjustments if the business process says only admin/owner should adjust inventory.
4. Add sale detail display for FEFO batch allocations so panelists can see which batch was deducted.
5. Add an inventory movement log page/table for audit review.
6. Add RLS test scripts for admin vs employee branch access.

### 3. Optional Improvements

1. Add stored alert snapshots or scheduled alert generation.
2. Add richer forecasting beyond the current 30-day average daily sales formula.
3. Add supplier/purchase-order workflow.
4. Add automated Supabase migration deployment in CI.
5. Add Vercel monitoring/log drains or error tracking.
6. Add a scanner-specific barcode input mode if actual barcode hardware will be demonstrated.

## G. Simple Explanation For Documentation

The system has a backend, but it is not a traditional custom backend server. It uses Supabase as the cloud backend/data layer. Supabase provides user authentication, PostgreSQL database tables, Row Level Security policies, database functions, triggers, and an Edge Function for secure admin user creation. The React frontend connects to Supabase using a public frontend key, while sensitive rules are enforced by Supabase policies and RPC functions. This setup is acceptable for a web-based cloud-integrated capstone because the important data, authentication, access control, FEFO checkout logic, and inventory records are handled in the cloud backend instead of only inside the browser.

