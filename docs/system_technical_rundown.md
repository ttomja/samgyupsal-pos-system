# Samgyupsal POS System: Technical Rundown

This document provides a comprehensive, beginner-friendly technical overview of the Samgyupsal POS system, designed for Capstone documentation and architectural understanding.

---

## 1. System Architecture Overview

To understand how the system works, it is essential to distinguish between the three main layers: the **Frontend**, the **Backend**, and the **Database**.

### The Frontend (User Interface)
*   **What it is:** The visual part of the application that users interact with in their web browser.
*   **Technologies:** Built using **React** (logic and components) and **Vite** (build tool and development server). Styling is handled with **Vanilla CSS**.
*   **Routing:** **React Router** is used to manage navigation between different pages (e.g., from Login to POS).

### The Backend & Database (Data & Security)
*   **Architecture:** Unlike traditional apps that require a custom Node.js or Python backend server, this project uses **Supabase**.
*   **Supabase (Backend-as-a-Service):** It provides a managed **PostgreSQL Database**, Authentication services, and auto-generated APIs.
*   **Connection:** The frontend communicates directly with Supabase via the `@supabase/supabase-js` library. This "direct-to-database" approach is secured by Supabase's internal logic and session tokens.

---

## 2. Core Functionalities

### Authentication & Role-Based Access Control (RBAC)
*   **Function:** Manages user logins and restricts access based on roles.
*   **Roles:**
    *   **Administrator:** Full access to all modules, including product management, user creation, and advanced reporting.
    *   **Employee (Cashier):** Restricted access to the Dashboard, POS, and basic Inventory features.
*   **Implementation:** Securely handled by Supabase Auth; frontend routes are protected using a `ProtectedRoute` component.

### POS (Point of Sale) Checkout
*   **Function:** Allows cashiers to process customer orders.
*   **Workflow:** Items are added to a cart, discounts/fees are applied, and the transaction is finalized.
*   **Behind the Scenes:** Uses a database "Stored Procedure" (RPC) to ensure that the sale record is created and inventory is deducted at the exact same time (atomic transaction).

### Inventory Management
*   **Function:** Tracks stock levels across different branches.
*   **Features:** Supporting "Stock In" (deliveries) and "Stock Adjustments" (manual fixes).
*   **Data Integrity:** Every change is logged in an `inventory_movements` table to provide a full audit trail.

### Product & Branch Management
*   **Product Catalog:** Admins can manage the master list of items, prices, and categories.
*   **Multi-Branch Support:** Data is automatically filtered based on the user's assigned `branch_id`, ensuring employees only see data relevant to their location.

---

## 3. Data Flow Analysis: Example (POS Transaction)

1.  **User Action:** A cashier adds items to the cart and clicks "Checkout".
2.  **Component Layer:** The `PosPage` component collects the cart state and validates the inputs.
3.  **Service Layer:** The data is passed to `salesService.js`, which prepares the payload for the database.
4.  **Database Request:** The service calls the `create_checkout_sale` RPC in Supabase.
5.  **Database Execution:** PostgreSQL runs a script that:
    *   Inserts the receipt into the `sales` table.
    *   Inserts individual items into `sale_items`.
    *   Reduces stock in `inventory_batches`.
    *   Logs the change in `inventory_movements`.
6.  **Response:** The database returns a success/failure message.
7.  **UI Update:** The frontend clears the cart and refreshes the inventory display to show the new stock levels.

---

## 4. Endpoint & Data Access Mapping

The system uses Supabase's "PostgREST" API and RPCs instead of traditional REST endpoints:

*   **Tables (Direct Access):**
    *   `sales` / `sale_items`: Standard select/insert for transaction history.
    *   `products`: Managed by admins for catalog updates.
    *   `profiles`: Stores user roles and branch assignments.
*   **Views (Aggregated Data):**
    *   `inventory_catalog_view`: Combines product details with real-time stock levels for easier display.
*   **RPCs (Stored Procedures):**
    *   `create_checkout_sale`: Handles the complex logic of finalizing a sale.
    *   `stock_in_inventory_batch`: Processes new inventory arrivals.
*   **Edge Functions:**
    *   `admin-create-user`: A secure server-side script used by admins to create new employee accounts.

---

## 5. Component Hierarchy

The React application is structured modularly:

*   **App Level:** `AppRouter` (Navigation) and `MainLayout` (The sidebar and header "shell").
*   **Feature Modules:** Located in `src/features/`. Each folder (e.g., `pos`, `inventory`) contains its own pages, components, and services.
*   **Shared Components:** Located in `src/shared/components/`. Includes reusable UI elements like:
    *   `Modal.jsx`: For popups and dialogs.
    *   `Loader.jsx`: For showing loading states.
    *   `PaginationControls.jsx`: For navigating long lists.

---

## 6. Technical Constraints & Business Logic

*   **Role Restrictions:** Enforced at both the UI level (hiding buttons/pages) and the database level (using Row-Level Security).
*   **Caching:** The system uses a local memory cache (`resourceCache.js`) to store data like sales history for 30 seconds, reducing unnecessary database load.
*   **Branch Scoping:** Most queries include a `.eq('branch_id', user.branchId)` filter to ensure data isolation between stores.
*   **Atomic Transactions:** Crucial logic (like checkout) is handled inside the database to prevent "partial saves" if the internet connection is interrupted.

---

## 7. Database Table Summary

| Table Name | Purpose | Data Type |
| :--- | :--- | :--- |
| `profiles` | User accounts, roles, and branch links | Auth & Permissions |
| `products` | Master list of items and prices | Catalog |
| `inventory_batches` | Current stock quantities per branch | Real-time Inventory |
| `inventory_movements` | History of all stock changes | Audit Log |
| `sales` | Receipt headers (Total, Date, Cashier) | Transactions |
| `sale_items` | Specific items sold in each receipt | Transaction Details |
| `branches` | List of store locations | Organization |

---

## 8. How the Whole System Works in Simple Terms

Think of the system as a **Digital Filing Clerk**.

The **Frontend** (the screen) is the clerk's desk where they fill out forms. When they finish a form (like a sale), they don't put it in a box; they send it to **Supabase** (the filing cabinet). 

Supabase doesn't just store the paper; it has its own "intelligent guards" (**Security Rules & RPCs**) that check if the worker is allowed to file that paper and then automatically updates all the other related folders (like the Inventory folder) for them. 

Because the cabinet and the guards are "in the cloud," the manager can look at the files from any computer and see the exact same, up-to-date information at any time.
