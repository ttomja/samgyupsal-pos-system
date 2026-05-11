import { createClient } from '@supabase/supabase-js'

const runtimeEnv = import.meta.env || {}

const supabaseUrl = String(runtimeEnv.VITE_SUPABASE_URL || '').trim()
const supabasePublicKey = String(
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.VITE_SUPABASE_ANON_KEY ||
    '',
).trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublicKey)
export const isSupabaseAuthEnabled =
  String(runtimeEnv.VITE_SUPABASE_AUTH_ENABLED || 'true')
    .trim()
    .toLowerCase() === 'true'
export const isSupabaseDataEnabled = isSupabaseAuthEnabled

export const supabaseTables = {
  products: runtimeEnv.VITE_SUPABASE_PRODUCTS_TABLE || 'products',
  inventoryBatches:
    runtimeEnv.VITE_SUPABASE_INVENTORY_BATCHES_TABLE || 'inventory_batches',
  inventoryMovements:
    runtimeEnv.VITE_SUPABASE_INVENTORY_MOVEMENTS_TABLE || 'inventory_movements',
  sales: runtimeEnv.VITE_SUPABASE_SALES_TABLE || 'sales',
  saleItems: runtimeEnv.VITE_SUPABASE_SALE_ITEMS_TABLE || 'sale_items',
  saleItemBatchAllocations:
    runtimeEnv.VITE_SUPABASE_SALE_ITEM_BATCH_ALLOCATIONS_TABLE ||
    'sale_item_batch_allocations',
  branches: runtimeEnv.VITE_SUPABASE_BRANCHES_TABLE || 'branches',
  profiles: runtimeEnv.VITE_SUPABASE_PROFILES_TABLE || 'profiles',
}

export const supabaseViews = {
  productCatalog: runtimeEnv.VITE_SUPABASE_PRODUCTS_VIEW || 'product_catalog_view',
  inventoryCatalog: runtimeEnv.VITE_SUPABASE_INVENTORY_VIEW || 'inventory_catalog_view',
}

export const supabaseEdgeFunctions = {
  adminCreateUser:
    runtimeEnv.VITE_SUPABASE_ADMIN_CREATE_USER_FUNCTION || 'admin-create-user',
}

export const supabaseRpc = {
  claimSessionLock:
    runtimeEnv.VITE_SUPABASE_CLAIM_SESSION_LOCK_RPC || 'claim_session_lock',
  validateSessionLock:
    runtimeEnv.VITE_SUPABASE_VALIDATE_SESSION_LOCK_RPC || 'validate_session_lock',
  releaseSessionLock:
    runtimeEnv.VITE_SUPABASE_RELEASE_SESSION_LOCK_RPC || 'release_session_lock',
  createCheckoutSale:
    runtimeEnv.VITE_SUPABASE_CREATE_CHECKOUT_SALE_RPC || 'create_checkout_sale',
  stockInInventoryBatch:
    runtimeEnv.VITE_SUPABASE_STOCK_IN_INVENTORY_BATCH_RPC ||
    'stock_in_inventory_batch',
  adjustInventoryStockCount:
    runtimeEnv.VITE_SUPABASE_ADJUST_INVENTORY_STOCK_RPC ||
    'adjust_inventory_stock_count',
  updateInventoryBatchExpiration:
    runtimeEnv.VITE_SUPABASE_UPDATE_INVENTORY_BATCH_EXPIRATION_RPC ||
    'update_inventory_batch_expiration',
}

export const supabaseRuntime = {
  inventoryManagedOnSale:
    String(runtimeEnv.VITE_SUPABASE_SYNC_INVENTORY_ON_SALE || 'false')
      .trim()
      .toLowerCase() === 'true',
  defaultBranchId: Number(runtimeEnv.VITE_SUPABASE_DEFAULT_BRANCH_ID || 1),
}

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

function createStructuredServiceError(message, cause = null) {
  const error = new Error(message)
  error.response = {
    data: {
      message,
    },
  }

  if (cause) {
    error.cause = cause
  }

  return error
}

export function createSupabaseServiceError(error, fallbackMessage) {
  return createStructuredServiceError(error?.message || fallbackMessage, error)
}

export function createSupabaseConfigError(context = 'Supabase service') {
  return createStructuredServiceError(
    `${context} is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the frontend environment first.`,
  )
}

export function getSupabaseClient() {
  if (!supabase) {
    throw createSupabaseConfigError()
  }

  return supabase
}
