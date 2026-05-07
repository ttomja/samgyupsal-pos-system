# Capstone Defense Guide: FEFO-Based Predictive Inventory System

This guide is written for thesis/capstone defense. Use it to explain the system's purpose, innovativeness, uniqueness, implemented features, technical design, and expected panel questions.

## 1. Short Defense Position

The system is a web-based, cloud-integrated retail monitoring platform designed for multi-branch inventory and sales operations. Its main technical contribution is that inventory is no longer treated only as a single product stock number. Instead, inventory is handled through expiration-aware batches, allowing the checkout process to automatically deduct from the earliest-expiring available stock first.

In simple terms:

> The system helps the business sell the right stock first, monitor inventory per branch, track what batch was used in each sale, and warn users about near-expiry or possible stockout items before they become operational problems.

## 2. What Problem The System Solves

Many small retail or food-related businesses track product stock as a single quantity. This creates problems when products have expiration dates because the system may show that stock is available, but it does not know which units should be sold first.

The system addresses these problems:

- Products with expiration dates are difficult to manage using ordinary stock counts.
- Staff may accidentally sell newer stock while older stock remains unsold.
- Near-expiry items may be discovered too late.
- Managers may not easily know which branch has low stock or fast-moving items.
- Manual inventory monitoring can cause inaccurate stock, missed replenishment, and product waste.

The proposed solution improves inventory control by using FEFO, batch-level tracking, sales history, and cloud-based branch monitoring.

## 3. Main Innovation And Uniqueness

The innovation is not just having a product list or sales module. The unique value is the connection between inventory batches, checkout deduction, and predictive monitoring.

Key innovative points:

- FEFO is enforced during checkout, not only displayed as a reminder.
- Products and physical inventory batches are separated.
- Each stock-in can create a batch with quantity, expiration date, branch, and supplier information.
- Checkout can deduct from multiple batches if the first batch is not enough.
- The system records which batch contributed to each sale item.
- Inventory movement history records stock-in, sale deduction, and adjustment activity.
- Predictive alerts use sales history to estimate stockout risk.
- Branch-based data allows inventory and reports to be monitored separately per branch.
- Cloud integration allows authorized users to access updated inventory and sales data from the web application.

Suggested defense line:

> Our innovation is the operational use of FEFO. The system does not simply warn that an item is expiring; it connects expiration dates directly to checkout so the earliest-expiring batch is deducted first and the sale remains traceable to the batch level.

## 4. Title Defense

Proposed title:

> A Web-Based Cloud-Integrated Multi-Branch Retail Monitoring Platform with FEFO-Based Predictive Inventory Alerts

How to defend each part:

| Title Phrase | How To Explain It |
|---|---|
| Web-Based | The users access the system through a browser-based interface. |
| Cloud-Integrated | The system uses Supabase for hosted authentication, database storage, and remote access. |
| Multi-Branch | The system supports branch records and branch-related inventory/sales monitoring. |
| Retail Monitoring Platform | The system includes product, inventory, sales, dashboard, reports, users, and monitoring features. |
| FEFO-Based | Stock deduction is based on the earliest expiration date first. |
| Predictive Inventory Alerts | The system estimates stockout risk using sales velocity and current stock levels. |

Important clarification:

The predictive feature is formula-based forecasting, not machine learning. It estimates future stockout risk using recent sales behavior. This is still valid as predictive inventory monitoring because the system uses historical sales data to estimate a future inventory condition.

## 5. Core Features To Defend

### Product Catalog

The product catalog stores the product identity, such as product name, SKU/barcode, category, price, unit, and branch association where applicable. This lets the business manage what items are sold.

Defense explanation:

> The product record defines what the item is. It should not be confused with physical stock batches, because one product can have several batches with different expiration dates.

### Batch-Based Inventory

Inventory batches represent physical stock entries. Each batch has its own quantity and expiration date.

Defense explanation:

> Batch-level inventory allows the system to know not only how much stock exists, but also which stock expires first.

### Stock-In With Expiration Date

When new stock arrives, the user records the product, branch, quantity, expiration date, cost, supplier, and reference information. The system then creates or updates the appropriate inventory batch.

Defense explanation:

> Stock-in is the entry point of FEFO because the expiration date must be captured before the system can deduct inventory correctly during checkout.

### FEFO Checkout

During checkout, the cashier selects or scans a product. The system then deducts stock from available batches sorted by earliest expiration date.

Defense explanation:

> The cashier does not need to manually choose the batch. The system automatically applies FEFO to reduce human error.

### Multi-Batch Deduction

If the earliest batch does not have enough quantity, the system continues deducting from the next earliest batch until the sale quantity is completed.

Defense explanation:

> This is important because real inventory may be split across multiple deliveries or expiration dates. The system can fulfill one sale using several batches while preserving traceability.

### Sale-To-Batch Allocation

The system records which batch was used for each sale item.

Defense explanation:

> This creates accountability. If a product issue happens later, the business can trace which batch was sold.

### Inventory Movement History

Inventory movements record changes such as stock-in, sale deduction, and adjustments.

Defense explanation:

> The movement history acts as an audit trail for inventory. It helps explain why stock increased or decreased.

### Near-Expiry Alerts

Near-expiry alerts help users identify batches approaching expiration.

Defense explanation:

> Near-expiry alerts support waste reduction because staff can prioritize action before products expire.

### Predictive Stockout Alerts

Predictive alerts estimate whether current stock may run out based on sales velocity.

Typical formula:

```text
Average Daily Sales = Units Sold During Recent Period / Number of Days
Estimated Days Before Stockout = Current Stock / Average Daily Sales
Estimated Stockout Date = Current Date + Estimated Days Before Stockout
```

Defense explanation:

> The alert is predictive because it uses past sales movement to estimate a future stockout condition. It helps management decide when to restock.

### Multi-Branch Monitoring

The system supports branch-based organization of users, products, inventory, and sales.

Defense explanation:

> Multi-branch support allows management to compare and monitor stock and sales separately per location instead of mixing all inventory into one general count.

### Role-Based Access

The system separates access depending on user role, such as admin/owner and staff/cashier.

Defense explanation:

> Role-based access ensures that users only access the functions appropriate to their responsibility, such as checkout for staff and monitoring or management features for admin users.

## 6. Technical Architecture Explanation

Use this explanation when asked how the system works technically:

> The frontend is a web application used by cashiers, staff, and administrators. Authentication and database storage are handled by Supabase. The database stores branches, profiles, products, sales, sale items, inventory batches, inventory movements, and sale-item batch allocations. Important business logic, such as FEFO checkout deduction and stock-in batch creation, is handled through database RPC functions so that inventory updates are processed consistently and transactionally.

Suggested architecture flow:

```text
User Browser
  -> Web Application Interface
  -> Supabase Auth
  -> Supabase Database / RPC Functions
  -> Products, Branches, Sales, Batches, Movements, Allocations
  -> Dashboard, Reports, Alerts
```

Why RPC/database functions matter:

> FEFO deduction affects several tables at once: sales, sale items, batches, allocations, and movements. Putting this logic in a database function helps keep the operation consistent and avoids partial updates.

## 7. Data Flow Explanations

### Stock-In Data Flow

```text
User enters stock-in details
  -> System validates product, branch, quantity, and expiration date
  -> Inventory batch is created or updated
  -> Product aggregate stock is updated
  -> Inventory movement is recorded
  -> Dashboard and reports reflect the new stock
```

Defense line:

> Stock-in creates the batch records needed for FEFO. Without expiration-aware stock-in, checkout cannot know which inventory should be sold first.

### Checkout Data Flow

```text
Cashier selects/scans product
  -> Cart is submitted to checkout
  -> System creates sale record
  -> System creates sale item records
  -> System searches available batches by expiration date ascending
  -> System deducts from earliest batch first
  -> If needed, system continues to the next batch
  -> System records sale-to-batch allocation
  -> System records inventory movement
  -> Updated stock appears in inventory and reports
```

Defense line:

> Checkout is where FEFO becomes operational. The system automatically decides which batch to deduct from based on expiration date.

### Predictive Alert Data Flow

```text
System reads sales and sale item history
  -> Computes average daily sales
  -> Compares sales velocity against current stock
  -> Estimates days before stockout
  -> Displays stockout risk in dashboard or reports
```

Defense line:

> The predictive alert is intended to support restocking decisions before stock reaches zero.

## 8. Suggested Live Demo Flow

Use this sequence during defense:

1. Log in as an admin or authorized user.
2. Show the dashboard and branch-aware monitoring.
3. Open product or inventory list.
4. Show a product that has multiple batches with different expiration dates.
5. Perform a stock-in with quantity and expiration date.
6. Go to POS/checkout.
7. Sell a quantity that uses the earliest-expiring batch.
8. If possible, sell more than the first batch quantity to show multi-batch deduction.
9. Show that inventory batch quantities changed.
10. Show sale item batch allocation or movement history.
11. Show near-expiry and stockout/predictive alert view.

Best demonstration scenario:

```text
Product: Pork Belly
Batch A: 3 units, expires May 15, 2026
Batch B: 5 units, expires June 15, 2026
Sale quantity: 5 units
Expected result:
  Batch A becomes 0
  Batch B becomes 3
  Sale allocation records 3 units from Batch A and 2 units from Batch B
```

This clearly proves FEFO and multi-batch deduction.

## 9. Common Panel Questions And Suggested Answers

### Q1. What makes your system different from a normal POS?

Normal POS systems usually deduct from a general stock quantity. Our system deducts from inventory batches based on expiration date, records which batch was used, and supports near-expiry and predictive stockout monitoring.

### Q2. Why did you use FEFO instead of FIFO?

FIFO means first-in, first-out, based on arrival date. FEFO means first-expire, first-out, based on expiration date. Since the business handles products where expiration matters, FEFO is more appropriate because the priority is selling the batch that expires first.

### Q3. Is your predictive alert considered artificial intelligence?

No. The current predictive feature is formula-based forecasting. It uses sales history to compute average daily sales and estimate days before stockout. We do not claim it is machine learning. It is predictive because it estimates a future inventory condition based on historical data.

### Q4. How does the system prevent the wrong batch from being deducted?

The checkout logic searches available inventory batches ordered by expiration date from earliest to latest. The system automatically deducts from the earliest-expiring batch first, reducing reliance on manual selection.

### Q5. What happens if the first batch does not have enough stock?

The system deducts all available quantity from the earliest batch, then continues to the next earliest-expiring batch until the required sale quantity is completed.

### Q6. How do you know which batch was sold?

The system records sale-item batch allocations. This table links the sale item to the specific inventory batch and quantity deducted.

### Q7. Why do you still keep product stock quantity if you already have batches?

The batch table is the more detailed physical inventory record. The product stock quantity can be treated as an aggregate or compatibility value for faster display and existing product screens. For stricter future design, stock quantity should be derived directly from active batch quantities.

### Q8. How does the system support multiple branches?

The system stores branch records and connects operational data such as products, batches, sales, and users to branch information. This allows filtering and reporting by branch.

### Q9. What security controls are used?

The system uses authenticated access, user profiles, roles, and Supabase row-level security policies where configured. Important inventory actions are handled through database functions to centralize business logic.

### Q10. What are the limitations of the current system?

The current system uses deterministic forecasting, not machine learning. Alert records may be displayed from computed data rather than stored as a separate alert history. Hardware barcode scanner support depends on scanners acting as keyboard input unless dedicated scanner integration is added. Future improvement can include stronger analytics, automated reorder recommendations, supplier purchase orders, and historical alert logs.

### Q11. Why is cloud integration important?

Cloud integration allows authorized users to access updated data from different devices and locations. It also supports centralized monitoring for multiple branches.

### Q12. What is the most important feature to demonstrate?

The most important feature is FEFO checkout deduction because it proves that the system goes beyond ordinary inventory listing. It actively enforces expiration-aware inventory control during sales.

## 10. How To Explain The System To Non-Technical Panelists

Use this version if the panel is more business-oriented:

> Imagine the store has two stocks of the same product. One expires next week and another expires next month. A normal system may only say there are 20 items available. Our system knows that those 20 items are divided into batches with different expiration dates. When the cashier sells the product, the system automatically deducts from the batch that expires first. This helps reduce waste, improves stock accuracy, and gives management better alerts for restocking and near-expiry items.

## 11. How To Explain The System To Technical Panelists

Use this version if the panel asks about implementation:

> The system separates product identity from inventory batches. Products define what the item is, while inventory batches define physical stock with branch, quantity, and expiration date. During checkout, the application calls a database function that creates the sale, creates sale items, queries available batches ordered by expiration date ascending, deducts quantities across one or more batches, records the allocation per sale item, and writes inventory movement records. Predictive alerts are computed from sales and sale item history by estimating average daily sales and days before stockout.

## 12. Defense Strengths

Strong points to emphasize:

- The system solves a real inventory problem for expiry-sensitive products.
- FEFO is applied automatically during checkout.
- Batch-level inventory improves accuracy compared with single stock quantity.
- Sale-to-batch allocation improves traceability.
- Multi-batch deduction reflects real-world stock conditions.
- Predictive stockout estimates support better restocking decisions.
- Near-expiry alerts support waste reduction.
- Multi-branch monitoring supports centralized management.
- Cloud storage makes the system accessible and easier to maintain.

## 13. Risks And Honest Limitations To Acknowledge

It is better to acknowledge limitations clearly than overclaim.

Use these safe statements:

- The predictive logic is formula-based, not machine learning.
- The system depends on accurate stock-in encoding because FEFO requires correct expiration dates.
- Product aggregate stock should remain synchronized with batch quantities.
- Future versions can add purchase order automation, supplier lead-time prediction, and more advanced analytics.
- Future versions can store alert history in a dedicated alerts table if the business needs audit logs for alerts.

Suggested defense line:

> We intentionally started with transparent formulas for prediction because they are easier for users and evaluators to understand. The system can later be extended with more advanced forecasting once enough historical data is collected.

## 14. Best Closing Statement

Use this as your closing defense message:

> The main contribution of our system is expiration-aware inventory control connected directly to sales. It does not only monitor products; it helps enforce the correct selling order through FEFO, records inventory movement, supports branch-based monitoring, and provides predictive warnings for stockout and near-expiry risks. This makes the system useful not only as a POS, but as a decision-support tool for inventory management.

