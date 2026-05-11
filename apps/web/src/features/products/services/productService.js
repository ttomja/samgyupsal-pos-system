import {
  createSupabaseServiceError,
  getSupabaseClient,
  isSupabaseDataEnabled,
  supabaseTables,
  supabaseViews,
} from '../../../shared/supabase/client'
import { getInventoryItems } from '../../inventory/services/inventoryService'
import { deriveProductSellability } from '../../../shared/utils/productAvailability'
import {
  clearCachedResourceByPrefix,
  getCachedResource,
  setCachedResource,
} from '../../../shared/utils/resourceCache'
import { resolvePreferredCategoryLabel } from '../../../shared/utils/categoryUtils.js'
import { emitDataRefresh } from '../../../shared/utils/dataRefreshEvents'

const PRODUCTS_CACHE_PREFIX = 'products:'
const PRODUCTS_CACHE_TTL_MS = 60 * 1000

function extractProductArray(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.products)) {
    return payload.products
  }

  if (Array.isArray(payload?.data)) {
    return payload.data
  }

  if (Array.isArray(payload?.data?.products)) {
    return payload.data.products
  }

  return []
}

function normalizeCatalogProduct(product, index) {
  const productId = product.product_id ?? product.id ?? product._id ?? product.productId
  const categoryName = resolvePreferredCategoryLabel(
    product.category_name,
    product.categories?.name,
    product.category,
  )
  const branchName = product.branch_name || product.branch || 'Unassigned Branch'
  const branchId =
    product.branch_id ??
    (branchName === 'Dollar' ? 2 : branchName === 'Sta. Lucia' ? 1 : null)

  const normalizedProduct = {
    id: productId ? String(productId) : null,
    branchId,
    branchName,
    name:
      product.name ||
      product.product_name ||
      product.productName ||
      product.itemName ||
      `Product ${index + 1}`,
    barcode: product.barcode || '',
    category: categoryName,
    price: Number(
      product.default_price ??
        product.price ??
        product.selling_price ??
        product.sellingPrice ??
        product.salePrice ??
        product.unitPrice ??
        0,
    ),
    unit: product.unit_label || product.net_weight || '',
    is_active: product.is_active ?? product.isActive ?? true,
  }
  const sellability = deriveProductSellability(normalizedProduct)

  return {
    ...normalizedProduct,
    ...sellability,
  }
}

function normalizeInventoryProduct(product, index) {
  const productId = product.product_id ?? product.id ?? product._id ?? product.productId
  const categoryName = resolvePreferredCategoryLabel(
    product.category_name,
    product.categories?.name,
    product.category,
  )
  const branchName = product.branch_name || product.branch || 'Unassigned Branch'
  const branchId =
    product.branch_id ??
    (branchName === 'Dollar' ? 2 : branchName === 'Sta. Lucia' ? 1 : null)

  const normalizedProduct = {
    id: productId ? String(productId) : null,
    inventoryItemId: product.inventory_item_id ?? product.inventoryItemId ?? null,
    branchId,
    branchName,
    name:
      product.name ||
      product.product_name ||
      product.productName ||
      product.itemName ||
      `Product ${index + 1}`,
    barcode: product.barcode || '',
    category: categoryName,
    price: Number(
      product.price ??
        product.selling_price ??
        product.default_price ??
        product.salePrice ??
        product.unitPrice ??
        0,
    ),
    unit: product.unit_label || product.net_weight || '',
    stockQuantity: Number(product.stock_quantity ?? 0),
    is_active: product.is_active ?? product.isActive ?? true,
  }
  const sellability = deriveProductSellability(normalizedProduct)

  return {
    ...normalizedProduct,
    ...sellability,
  }
}

function getProductsCacheKey(options = {}) {
  const branchId =
    options.branchId != null && String(options.branchId).trim() !== ''
      ? String(options.branchId).trim()
      : 'all'

  return `${PRODUCTS_CACHE_PREFIX}catalog:${isSupabaseDataEnabled ? 'supabase' : 'local'}:${branchId}`
}

function getProductCatalogCacheKey() {
  return `${PRODUCTS_CACHE_PREFIX}review:${isSupabaseDataEnabled ? 'supabase' : 'local'}`
}

function invalidateProductCaches() {
  clearCachedResourceByPrefix(PRODUCTS_CACHE_PREFIX)
  clearCachedResourceByPrefix('inventory:')
  clearCachedResourceByPrefix('reports:')
  emitDataRefresh({
    source: 'products',
  })
}

export function getCachedProducts(options = {}) {
  return getCachedResource(getProductsCacheKey(options), PRODUCTS_CACHE_TTL_MS)
}

export function getCachedProductCatalog() {
  return getCachedResource(getProductCatalogCacheKey(), PRODUCTS_CACHE_TTL_MS)
}

async function getLocalCatalogSource(options = {}) {
  try {
    const inventoryResponse = await getInventoryItems(options)
    const inventoryItems = inventoryResponse.items || inventoryResponse

    if (Array.isArray(inventoryItems) && inventoryItems.length > 0) {
      return inventoryItems
    }
  } catch {
    return []
  }

  return []
}

export async function getProducts(options = {}) {
  const cachedProducts = getCachedProducts(options)

  if (cachedProducts) {
    return cachedProducts
  }

  if (isSupabaseDataEnabled) {
    const supabase = getSupabaseClient()
    let query = supabase
      .from(supabaseViews.inventoryCatalog)
      .select('*')
      .order('product_name', { ascending: true })

    if (options.branchId != null && String(options.branchId).trim() !== '') {
      query = query.eq('branch_id', Number(options.branchId))
    }

    const { data, error } = await query

    if (error) {
      throw createSupabaseServiceError(
        error,
        'Unable to load products from Supabase.',
      )
    }

    return setCachedResource(
      getProductsCacheKey(options),
      extractProductArray(data)
      .map(normalizeInventoryProduct)
      .filter((product) => Boolean(product.id)),
    )
  }

  const localCatalog = await getLocalCatalogSource(options)
  return setCachedResource(
    getProductsCacheKey(options),
    extractProductArray(localCatalog)
    .map(normalizeInventoryProduct)
    .filter((product) => Boolean(product.id)),
  )
}

export async function getProductCatalog() {
  const cachedCatalog = getCachedProductCatalog()

  if (cachedCatalog) {
    return cachedCatalog
  }

  if (isSupabaseDataEnabled) {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from(supabaseViews.productCatalog)
      .select('*')
      .order('product_name', { ascending: true })

    if (error) {
      throw createSupabaseServiceError(
        error,
        'Unable to load the product catalog from Supabase.',
      )
    }

    return setCachedResource(
      getProductCatalogCacheKey(),
      extractProductArray(data)
      .map(normalizeCatalogProduct)
      .filter((product) => Boolean(product.id)),
    )
  }

  const localCatalog = await getLocalCatalogSource()
  return setCachedResource(
    getProductCatalogCacheKey(),
    extractProductArray(localCatalog)
    .map(normalizeCatalogProduct)
    .filter((product) => Boolean(product.id)),
  )
}

export async function renameProductCategory(currentCategoryName, nextCategoryName) {
  if (!isSupabaseDataEnabled) {
    throw new Error(
      'Renaming product-backed categories requires the active Supabase catalog.',
    )
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseTables.products)
    .update({ category: nextCategoryName })
    .eq('category', currentCategoryName)
    .select('id')

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to rename this product category in Supabase.',
    )
  }

  invalidateProductCaches()
  return Array.isArray(data) ? data.length : 0
}

export async function removeProductCategory(categoryName) {
  if (!isSupabaseDataEnabled) {
    throw new Error(
      'Removing product-backed categories requires the active Supabase catalog.',
    )
  }

  if (String(categoryName || '').trim() === 'Uncategorized') {
    throw new Error('The Uncategorized category cannot be removed.')
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseTables.products)
    .update({ category: 'Uncategorized' })
    .eq('category', categoryName)
    .select('id')

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to remove this product category from Supabase.',
    )
  }

  invalidateProductCaches()
  return Array.isArray(data) ? data.length : 0
}
