# FEFO System Defense Presentation Guide

This guide is written for defending the system in front of a capstone panel. It focuses on how to explain the system's purpose, innovativeness, uniqueness, features, technical design, and limitations.

## 1. Core Defense Statement

Use this as your main explanation:

> Our system is a web-based, cloud-integrated retail monitoring platform that improves inventory control by combining POS sales, branch-based inventory tracking, FEFO batch deduction, near-expiry monitoring, and predictive stockout alerts. Unlike a simple POS that only records sales, our system helps the business decide which stock should be sold first and which products need restocking attention before problems happen.

## 2. Problem Being Solved

The system addresses common small retail problems:

- Products are often tracked only by total quantity.
- Expiration dates are not always monitored properly.
- Cashiers may sell newer stock before older stock.
- Managers may notice low stock only when it is already too late.
- Multi-branch businesses need separate inventory visibility per branch.
- Sales records are often not used for forecasting or inventory decisions.

Defense explanation:

> The main problem is not only recording sales, but managing perishable inventory intelligently. For food-related retail, the timing of stock movement matters because expired products create waste, loss, and possible customer safety issues.

## 3. Innovativeness

The innovative part is the combination of POS, FEFO, and predictive monitoring in one system.

### 3.1 FEFO-Based Checkout

Traditional inventory systems often deduct stock from a product total. Our system deducts from physical batches by expiration date.

Defense explanation:

> The innovative part is that checkout is not just subtracting from a product quantity. It checks the available inventory batches and automatically deducts from the earliest-expiring batch first.

### 3.2 Automatic Multi-Batch Deduction

If the first batch does not contain enough quantity, the system continues to the next earliest batch.

Defense explanation:

> This means the cashier does not need to manually calculate or choose batches. The system applies FEFO automatically and consistently.

### 3.3 Sale-To-Batch Traceability

The system records exactly which batch was used for each sale item.

Defense explanation:

> This improves auditability because the business can trace a sale back to the exact inventory batch that was deducted.

### 3.4 Predictive Stockout Alerts

The system uses recent sales history to estimate how soon a product may run out.

Defense explanation:

> The system does not only show current stock. It uses the last 30 days of sales to estimate future stock risk.

### 3.5 Near-Expiry Monitoring

The system checks available batches that are close to expiration.

Defense explanation:

> The system highlights products that should be prioritized for selling before they expire.

## 4. Uniqueness

The uniqueness is not just one feature. It is the integration of several features into a practical workflow.

| Ordinary POS | Our System |
|---|---|
| Records sales only | Records sales and deducts inventory by FEFO |
| Tracks product quantity only | Separates product identity from physical batches |
| No batch traceability | Records sale-to-batch allocation |
| Manual expiry monitoring | Automatic near-expiry alerts |
| Low stock is reactive | Predictive stockout estimate based on sales velocity |
| Single-store focus | Supports branch-based filtering and monitoring |

Defense explanation:

> The uniqueness of the system is that it connects the cashier workflow, inventory batch records, expiration dates, and sales-based prediction into one operational platform.

## 5. Main Features To Present

### 5.1 Product Catalog

Stores product details:

- product name
- barcode
- category
- price
- pack size
- branch
- reorder level

Defense point:

> Product catalog data identifies what the product is, while inventory batches identify the physical stock.

### 5.2 Batch-Based Inventory

Every stock-in creates a batch with:

- product id
- branch id
- quantity received
- quantity on hand
- expiration date
- stock-in date

Defense point:

> This design allows the system to know not only how many items exist, but also when each group of stock will expire.

### 5.3 FEFO Checkout

During checkout:

1. Cashier selects/scans product.
2. System validates branch and stock.
3. System orders batches by earliest expiration date.
4. System deducts from the earliest batch.
5. If needed, system deducts from multiple batches.
6. System records the allocation.

Defense point:

> FEFO is automated at the database transaction level, so the deduction is consistent and protected from partial checkout errors.

### 5.4 Inventory Movement History

The system records:

- stock-in movement
- sale deduction movement
- adjustment movement
- opening-balance movement

Defense point:

> This creates an audit trail for inventory changes.

### 5.5 Predictive Stockout Alerts

Formula:

```text
Average Daily Sales = Total Units Sold in Last 30 Days / 30
Estimated Days Before Stockout = Current Stock / Average Daily Sales
Estimated Stockout Date = Today + Estimated Days Before Stockout
```

Defense point:

> This helps administrators make restocking decisions earlier.

### 5.6 Near-Expiry Alerts

The system flags batches that are within 30 days of expiration.

Defense point:

> This helps the business reduce waste and prioritize soon-to-expire stock.

### 5.7 Multi-Branch Monitoring

The system supports:

- Sta. Lucia branch
- Dollar branch
- branch-specific products
- branch-specific inventory batches
- branch-specific sales
- branch filtering

Defense point:

> This is useful for businesses with more than one branch because inventory and sales can be monitored separately.

## 6. Technical Architecture Explanation

Simple architecture:

```text
User / Cashier / Admin
        |
        v
React Web Application
        |
        v
Supabase Auth + Supabase Database + RPC Functions
        |
        v
Products, Batches, Sales, Reports, Alerts
```

Defense explanation:

> The frontend is built as a web application. Supabase provides authentication, database storage, row-level security, and database functions. Critical inventory operations such as checkout deduction are handled through Supabase RPC functions to keep them transactional and reliable.

## 7. Why Supabase Is Used

Supabase provides:

- authentication
- PostgreSQL database
- role-based policies
- secure API access
- cloud-hosted data
- RPC/database functions

Defense explanation:

> Supabase was selected because it provides both database and authentication services in one cloud platform. It also allows us to use PostgreSQL functions for reliable checkout transactions.

## 8. Why FEFO Matters

FEFO means First Expired, First Out.

It is important for:

- food products
- perishable goods
- reducing waste
- reducing expired stock
- improving stock rotation
- protecting customers

Defense explanation:

> FEFO is more appropriate than FIFO for products with expiration dates because the oldest stock is not always the first to expire. The system prioritizes expiration date rather than arrival date.

## 9. How To Explain The Checkout Example

Use this example:

| Batch | Expiry | Quantity |
|---|---:|---:|
| Batch A | May 15, 2026 | 3 |
| Batch B | June 15, 2026 | 5 |

If a cashier sells 5 units:

- 3 units are deducted from Batch A.
- 2 units are deducted from Batch B.
- Batch A becomes 0.
- Batch B becomes 3.
- The system records both allocations.

Defense explanation:

> This proves that the system applies FEFO and supports multi-batch deduction.

## 10. How To Defend Predictive Alerts

Panel may ask: "Is this AI?"

Recommended answer:

> It is not artificial intelligence. It is rule-based prediction using sales velocity. The system uses recent sales history to estimate how many days are left before stockout. This is appropriate for the capstone because it is explainable, testable, and directly based on available transaction data.

Panel may ask: "Why 30 days?"

Recommended answer:

> A 30-day window gives enough recent sales history to estimate demand while still reflecting current selling behavior. It is also simple for business users to understand.

Panel may ask: "What if sales are irregular?"

Recommended answer:

> The prediction is an estimate, not a guarantee. It is designed as an early warning tool. Future improvements can include seasonal trends, moving averages, and configurable forecast windows.

## 11. How To Defend Database Design

Panel may ask: "Why not store everything in products?"

Recommended answer:

> The products table identifies the product, but inventory batches represent physical stock. A single product can have multiple batches with different expiration dates. Separating them is necessary for FEFO.

Panel may ask: "Why still keep stock_quantity in products?"

Recommended answer:

> `products.stock_quantity` is kept as a compatibility aggregate for fast display and existing views. The physical source of truth is the batch table, and the total is recalculated from remaining batch quantities.

Panel may ask: "How do you know which batch was sold?"

Recommended answer:

> The `sale_item_batch_allocations` table records the sale item, batch, product, branch, quantity deducted, and expiration date.

## 12. Security And Access Control Defense

The system has:

- Supabase Auth login
- profiles table for role and branch assignment
- admin and employee roles
- protected navigation
- Supabase RLS policies
- database RPC validation for checkout and stock operations

Defense explanation:

> The frontend controls what users see, while Supabase policies and RPC validations protect the database operations. Critical actions are not only trusted to the browser.

## 13. Limitations To Admit

A good defense includes honest limitations:

- Predictive alerts are currently rule-based, not AI-based.
- Alert rows are computed in the app/report layer and are not persisted as a separate alerts table.
- The system uses demo data for validation and presentation.
- Forecasting can be improved with seasonal patterns in future work.
- More roles can be added in the future, such as branch manager or inventory staff.

Defense framing:

> These limitations do not remove the value of the system. They define the next development stage.

## 14. Future Improvements

Possible future enhancements:

- dedicated alert table
- configurable alert thresholds
- email or SMS alert notifications
- supplier management
- purchase order generation
- barcode scanner hardware integration
- product return handling
- stock transfer between branches
- advanced forecasting models
- mobile cashier interface

## 15. Suggested Opening Statement

> Good day. Our project is a web-based cloud-integrated multi-branch retail monitoring platform with FEFO-based predictive inventory alerts. It is designed for retail businesses that handle products with expiration dates. The system supports product management, POS checkout, branch inventory monitoring, batch-based stock tracking, automatic FEFO deduction, near-expiry alerts, and predictive stockout monitoring based on recent sales. The main goal is to help the business reduce expired stock, improve inventory visibility, and support better restocking decisions.

## 16. Suggested Feature Demonstration Flow

1. Login as admin.
2. Show dashboard summary.
3. Show branches.
4. Show inventory products.
5. Explain batches and expiration dates.
6. Perform stock-in with expiration date.
7. Go to POS.
8. Sell a product.
9. Explain automatic FEFO deduction.
10. Show reports.
11. Explain near-expiry and predictive stockout alerts.
12. Mention audit trail through inventory movements and batch allocations.

## 17. Possible Panel Questions And Answers

### Q: What makes your system different from a normal POS?

A: A normal POS records sales. Our system records sales and uses those sales to manage inventory intelligently through FEFO deduction, batch tracking, near-expiry alerts, and stockout prediction.

### Q: Why is FEFO important?

A: FEFO reduces the risk of expired products by selling the stock with the earliest expiration date first.

### Q: Does the cashier need to choose the batch?

A: No. The cashier only sells the product. The system automatically chooses the correct batch based on expiration date.

### Q: What happens if one batch is not enough?

A: The system deducts from the earliest batch first, then continues to the next earliest batch until the sale quantity is fulfilled.

### Q: How do you compute predictive stockout?

A: The system computes average daily sales using the last 30 days of sale items, then divides current stock by average daily sales to estimate days before stockout.

### Q: Are predictions stored in the database?

A: Currently, predictions are computed dynamically in the report/dashboard layer. This keeps the alert values updated whenever sales or inventory changes.

### Q: How do you ensure inventory deduction is reliable?

A: Checkout deduction is handled by a database RPC function inside a transaction. The sale, sale items, batch deductions, allocations, and movements are written together.

### Q: Can this support more branches?

A: Yes. The branch design uses `branch_id`, so additional branches can be added without changing the main inventory logic.

### Q: What is your main technical contribution?

A: The main technical contribution is combining transactional FEFO batch deduction, sale-to-batch traceability, and sales-velocity-based inventory alerts in one web-based retail platform.

## 18. Best Closing Statement

> In conclusion, our system improves the traditional POS workflow by adding inventory intelligence. It does not only process transactions; it helps the business control perishable stock, reduce waste, monitor branches, and make earlier restocking decisions. The FEFO batch deduction and predictive inventory alerts directly support the needs of retail businesses that handle expiring products.

