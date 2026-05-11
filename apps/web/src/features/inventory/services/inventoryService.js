import { resolveInventoryRecordIds } from '../../../shared/utils/inventoryRecords.js'
import {
  createSupabaseServiceError,
  getSupabaseClient,
  isSupabaseDataEnabled,
  supabaseRpc,
  supabaseRuntime,
  supabaseTables,
  supabaseViews,
} from '../../../shared/supabase/client.js'
import { shortDate } from '../../../shared/utils/formatters.js'
import {
  clearCachedResourceByPrefix,
  getCachedResource,
  setCachedResource,
} from '../../../shared/utils/resourceCache.js'
import {
  getStandardProductCategoryLabel,
  normalizeBarcodeValue,
  resolvePreferredCategoryLabel,
} from '../../../shared/utils/categoryUtils.js'
import {
  getStoredInventoryItems,
  saveStoredInventoryItems,
} from '../../../shared/utils/storage.js'
import { emitDataRefresh } from '../../../shared/utils/dataRefreshEvents.js'
import {
  canAdjustInventoryStock,
  canStockInInventory,
} from '../../../shared/utils/permissions.js'

const LOW_STOCK_THRESHOLD = 10
const NEAR_EXPIRY_DAYS = 30
const INVENTORY_CACHE_PREFIX = 'inventory:'
const INVENTORY_CACHE_TTL_MS = 60 * 1000

function getInventoryCacheKey(options = {}) {
  const branchId =
    options.branchId != null && String(options.branchId).trim() !== ''
      ? String(options.branchId).trim()
      : 'all'

  return `${INVENTORY_CACHE_PREFIX}${isSupabaseDataEnabled ? 'supabase' : 'local'}:${branchId}`
}

function invalidateInventoryQueryCaches() {
  clearCachedResourceByPrefix(INVENTORY_CACHE_PREFIX)
  clearCachedResourceByPrefix('products:')
  clearCachedResourceByPrefix('reports:')
  emitDataRefresh({
    source: 'inventory',
  })
}

function assertInventoryStockActionPermission(mode, user) {
  if (!user) {
    return
  }

  if (mode === 'adjust-stock' && !canAdjustInventoryStock(user)) {
    throw new Error('Only administrator accounts can adjust stock counts.')
  }

  if (mode === 'stock-in' && !canStockInInventory(user)) {
    throw new Error('Your account cannot record stock-in actions.')
  }
}

function isMissingSupabaseResourceError(error) {
  const normalizedMessage = String(
    [error?.code, error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()

  return (
    normalizedMessage.includes('42p01') ||
    normalizedMessage.includes('42883') ||
    normalizedMessage.includes('pgrst202') ||
    normalizedMessage.includes('could not find the table') ||
    normalizedMessage.includes('could not find the function') ||
    normalizedMessage.includes('schema cache')
  )
}

export function getCachedInventoryItems(options = {}) {
  return getCachedResource(
    getInventoryCacheKey(options),
    INVENTORY_CACHE_TTL_MS,
  )
}

function ensureLocalInventoryItems() {
  const storedInventoryItems = getStoredInventoryItems()

  return storedInventoryItems
}

function sanitizeInventoryText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function resolveSupabaseBranchId(values = {}, fallbackItem = {}) {
  const candidateBranchId =
    values.branch_id ?? values.branchId ?? fallbackItem.branch_id ?? fallbackItem.branchId

  if (candidateBranchId != null && String(candidateBranchId).trim() !== '') {
    return Number(candidateBranchId)
  }

  const candidateBranchName =
    values.branch ??
    values.branch_name ??
    values.branchName ??
    fallbackItem.branch ??
    fallbackItem.branch_name ??
    fallbackItem.branchName

  if (String(candidateBranchName || '').trim() === 'Dollar') {
    return 2
  }

  if (String(candidateBranchName || '').trim() === 'Sta. Lucia') {
    return 1
  }

  return Number(supabaseRuntime.defaultBranchId || 1)
}

function resolveSupabaseProductBranch(values = {}, fallbackItem = {}) {
  const candidateBranchName =
    values.branch ??
    values.branch_name ??
    values.branchName ??
    fallbackItem.branch ??
    fallbackItem.branch_name ??
    fallbackItem.branchName

  if (candidateBranchName != null && String(candidateBranchName).trim() !== '') {
    return sanitizeInventoryText(candidateBranchName)
  }

  return resolveSupabaseBranchId(values, fallbackItem) === 2
    ? 'Dollar'
    : 'Sta. Lucia'
}

function buildSupabaseProductPayload(values, fallbackItem = {}) {
  return {
    barcode: normalizeBarcodeValue(values.barcode ?? fallbackItem.barcode) || null,
    branch: resolveSupabaseProductBranch(values, fallbackItem),
    category:
      sanitizeInventoryText(
        getStandardProductCategoryLabel(
          resolvePreferredCategoryLabel(
            values.category_name ?? values.category,
            fallbackItem.category_name ?? fallbackItem.category,
          ),
        ),
      ) || 'Uncategorized',
    product_name: sanitizeInventoryText(
      values.product_name ?? values.product ?? fallbackItem.product_name ?? fallbackItem.product,
    ),
    net_weight: sanitizeInventoryText(
      values.unit ?? values.net_weight ?? fallbackItem.unit ?? fallbackItem.net_weight,
    ),
    price: Number(values.price ?? fallbackItem.price ?? 0),
    stock_quantity: Number(
      values.stock_quantity ?? values.stock ?? fallbackItem.stock_quantity ?? 0,
    ),
    expiration_date:
      sanitizeInventoryText(
        values.expiry_date ??
          values.expiration_date ??
          fallbackItem.expiry_date ??
          fallbackItem.expiration_date,
      ) || null,
  }
}

function getDateSortValue(value, fallbackValue = Number.MAX_SAFE_INTEGER) {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return fallbackValue
  }

  const parsedDate = new Date(`${normalizedValue}T00:00:00`)
  return Number.isNaN(parsedDate.getTime())
    ? fallbackValue
    : parsedDate.getTime()
}

function normalizeInventoryBatch(batch = {}) {
  const expirationDate = batch.expiration_date || batch.expiry_date || ''
  const quantityOnHand = Number(batch.quantity_on_hand ?? batch.stock_quantity ?? 0)

  return {
    ...batch,
    id: batch.id,
    product_id: batch.product_id ?? null,
    branch_id: batch.branch_id ?? null,
    batch_code: batch.batch_code || '',
    quantity_received: Number(batch.quantity_received ?? 0),
    quantity_on_hand: Number.isFinite(quantityOnHand) ? quantityOnHand : 0,
    expiration_date: expirationDate,
    expiry_date: expirationDate,
    stock_in_date: batch.stock_in_date || batch.created_at || '',
    source: batch.source || 'stock-in',
    days_to_expiry: expirationDate ? getDaysToExpiry(expirationDate) : null,
  }
}

function sortInventoryBatchesByFefo(left, right) {
  const leftExpiry = getDateSortValue(left.expiration_date)
  const rightExpiry = getDateSortValue(right.expiration_date)

  if (leftExpiry !== rightExpiry) {
    return leftExpiry - rightExpiry
  }

  const leftStockInDate = getDateSortValue(left.stock_in_date)
  const rightStockInDate = getDateSortValue(right.stock_in_date)

  if (leftStockInDate !== rightStockInDate) {
    return leftStockInDate - rightStockInDate
  }

  return Number(left.id || 0) - Number(right.id || 0)
}

function resolveSupabaseExpirationDate(values = {}, fallbackItem = {}) {
  return (
    sanitizeInventoryText(
      values.expirationDate ??
        values.expiration_date ??
        values.expiry_date ??
        values.expiryDate ??
        fallbackItem.expiration_date ??
        fallbackItem.expiry_date ??
        fallbackItem.expiryDate,
    ) || null
  )
}

function getTodayDateInputValue() {
  return new Date().toISOString().slice(0, 10)
}

async function fetchSupabaseInventoryBatchesForRows(rows = [], options = {}) {
  const productIds = Array.from(
    new Set(
      rows
        .map((item) => item.product_id ?? item.productId ?? item.id)
        .filter((productId) => productId != null)
        .map((productId) => Number(productId))
        .filter((productId) => Number.isFinite(productId)),
    ),
  )

  if (productIds.length === 0) {
    return new Map()
  }

  const supabase = getSupabaseClient()
  let query = supabase
    .from(supabaseTables.inventoryBatches)
    .select(
      'id, product_id, branch_id, batch_code, quantity_received, quantity_on_hand, expiration_date, stock_in_date, source, notes, created_at, updated_at',
    )
    .in('product_id', productIds)

  if (options.branchId != null && String(options.branchId).trim() !== '') {
    query = query.eq('branch_id', Number(options.branchId))
  }

  const { data, error } = await query

  if (error) {
    if (isMissingSupabaseResourceError(error)) {
      return new Map()
    }

    throw createSupabaseServiceError(
      error,
      'Inventory batch records could not be loaded from Supabase.',
    )
  }

  return (data || []).reduce((batchMap, batch) => {
    const normalizedBatch = normalizeInventoryBatch(batch)
    const productKey = String(normalizedBatch.product_id)
    const existingBatches = batchMap.get(productKey) || []
    existingBatches.push(normalizedBatch)
    existingBatches.sort(sortInventoryBatchesByFefo)
    batchMap.set(productKey, existingBatches)
    return batchMap
  }, new Map())
}

async function attachSupabaseBatchSummaries(rows = [], options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return []
  }

  const batchesByProductId = await fetchSupabaseInventoryBatchesForRows(
    rows,
    options,
  )

  return rows.map((item) => {
    const productId = item.product_id ?? item.productId ?? item.id
    const batches = batchesByProductId.get(String(productId)) || []
    const availableBatches = batches.filter(
      (batch) => Number(batch.quantity_on_hand || 0) > 0,
    )
    const batchStockQuantity = batches.reduce(
      (total, batch) => total + Number(batch.quantity_on_hand || 0),
      0,
    )
    const earliestExpiringBatch = availableBatches.find(
      (batch) => String(batch.expiration_date || '').trim() !== '',
    )
    const nearExpiryBatchCount = availableBatches.filter(
      (batch) =>
        batch.days_to_expiry != null &&
        Number(batch.days_to_expiry) <= NEAR_EXPIRY_DAYS,
    ).length

    return {
      ...item,
      batches,
      batch_count: batches.length,
      available_batch_count: availableBatches.length,
      batch_stock_quantity:
        batches.length > 0 ? batchStockQuantity : item.batch_stock_quantity,
      earliest_expiration_date:
        earliestExpiringBatch?.expiration_date ||
        item.earliest_expiration_date ||
        item.expiration_date ||
        '',
      near_expiry_batch_count: nearExpiryBatchCount,
    }
  })
}

async function fetchSupabaseInventoryItems(options = {}) {
  const supabase = getSupabaseClient()
  let query = supabase
    .from(supabaseViews.inventoryCatalog)
    .select('*')
    .eq('is_active', true)
    .order('product_name', { ascending: true })

  if (options.branchId != null && String(options.branchId).trim() !== '') {
    query = query.eq('branch_id', Number(options.branchId))
  }

  const { data, error } = await query

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Inventory records could not be loaded from Supabase.',
    )
  }

  return attachSupabaseBatchSummaries(Array.isArray(data) ? data : [], options)
}

async function fetchSupabaseInventoryItemById(itemId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseViews.inventoryCatalog)
    .select('*')
    .eq('inventory_item_id', itemId)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to load the selected inventory item from Supabase.',
    )
  }

  const rows = await attachSupabaseBatchSummaries(data ? [data] : [])

  return rows[0] || null
}

async function fetchSupabaseInventoryItemByProductId(productId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseViews.inventoryCatalog)
    .select('*')
    .eq('product_id', Number(productId))
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to load the selected inventory item from Supabase.',
    )
  }

  const rows = await attachSupabaseBatchSummaries(data ? [data] : [])

  return rows[0] || null
}

async function fetchSupabaseProductById(productId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseTables.products)
    .select('*')
    .eq('id', Number(productId))
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to load the selected product from Supabase.',
    )
  }

  return data || null
}

async function findSupabaseProductConflict(values, fallbackItem = {}, excludeProductId = null) {
  const supabase = getSupabaseClient()
  const payload = buildSupabaseProductPayload(values, fallbackItem)
  let barcodeQuery = payload.barcode
    ? supabase
        .from(supabaseTables.products)
        .select('*')
        .eq('branch', payload.branch)
        .eq('barcode', payload.barcode)
    : null

  if (barcodeQuery && excludeProductId != null) {
    barcodeQuery = barcodeQuery.neq('id', Number(excludeProductId))
  }

  if (barcodeQuery) {
    const { data: barcodeMatch, error: barcodeError } = await barcodeQuery.maybeSingle()

    if (barcodeError) {
      throw createSupabaseServiceError(
        barcodeError,
        'Unable to match the product barcode in Supabase.',
      )
    }

    if (barcodeMatch) {
      return barcodeMatch
    }
  }

  let query = supabase
    .from(supabaseTables.products)
    .select('*')
    .eq('branch', payload.branch)
    .eq('category', payload.category)
    .eq('product_name', payload.product_name)
    .eq('net_weight', payload.net_weight)

  if (excludeProductId != null) {
    query = query.neq('id', Number(excludeProductId))
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to match the product record in Supabase.',
    )
  }

  return data || null
}

async function getSupabaseInventoryContext(itemId) {
  const currentItem =
    (await fetchSupabaseInventoryItemById(itemId)) ||
    (await fetchSupabaseInventoryItemByProductId(itemId))

  if (!currentItem) {
    return null
  }

  return {
    currentItem,
    ...resolveInventoryRecordIds(currentItem),
  }
}

async function stockInSupabaseInventoryBatch(
  productId,
  branchId,
  quantity,
  values = {},
) {
  const expirationDate = resolveSupabaseExpirationDate(values)

  if (!expirationDate) {
    throw new Error('Select an expiration date before adding batch stock.')
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc(
    supabaseRpc.stockInInventoryBatch,
    {
      p_product_id: Number(productId),
      p_branch_id: Number(branchId),
      p_quantity: Number(quantity),
      p_expiration_date: expirationDate,
      p_stock_in_date:
        sanitizeInventoryText(values.stockInDate ?? values.stock_in_date) ||
        getTodayDateInputValue(),
      p_notes:
        sanitizeInventoryText(values.notes) || 'Stock-in recorded from inventory screen.',
    },
  )

  if (error) {
    if (isMissingSupabaseResourceError(error)) {
      const currentProduct = await fetchSupabaseProductById(productId)
      const nextStockQuantity = Math.max(
        0,
        Number(currentProduct?.stock_quantity || 0) + Number(quantity || 0),
      )
      const { error: updateError } = await supabase
        .from(supabaseTables.products)
        .update({
          stock_quantity: nextStockQuantity,
          expiration_date: expirationDate,
        })
        .eq('id', Number(productId))

      if (updateError) {
        throw createSupabaseServiceError(
          updateError,
          'Unable to update product stock in Supabase.',
        )
      }

      return { stock_quantity: nextStockQuantity }
    }

    throw createSupabaseServiceError(
      error,
      'Unable to create the inventory batch in Supabase.',
    )
  }

  return data
}

async function adjustSupabaseInventoryStockCount(
  productId,
  branchId,
  targetQuantity,
  values = {},
) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc(
    supabaseRpc.adjustInventoryStockCount,
    {
      p_product_id: Number(productId),
      p_branch_id: Number(branchId),
      p_target_quantity: Number(targetQuantity),
      p_expiration_date: resolveSupabaseExpirationDate(values),
      p_notes:
        sanitizeInventoryText(values.notes) || 'Stock adjustment recorded from inventory screen.',
    },
  )

  if (error) {
    if (isMissingSupabaseResourceError(error)) {
      const updatePayload = {
        stock_quantity: Math.max(0, Number(targetQuantity || 0)),
      }
      const expirationDate = resolveSupabaseExpirationDate(values)

      if (expirationDate) {
        updatePayload.expiration_date = expirationDate
      }

      const { error: updateError } = await supabase
        .from(supabaseTables.products)
        .update(updatePayload)
        .eq('id', Number(productId))

      if (updateError) {
        throw createSupabaseServiceError(
          updateError,
          'Unable to update product stock in Supabase.',
        )
      }

      return updatePayload
    }

    throw createSupabaseServiceError(
      error,
      'Unable to adjust inventory batches in Supabase.',
    )
  }

  return data
}

export async function getInventoryItems(options = {}) {
  const cachedInventoryResponse = getCachedInventoryItems(options)

  if (cachedInventoryResponse) {
    return cachedInventoryResponse
  }

  if (isSupabaseDataEnabled) {
    return setCachedResource(getInventoryCacheKey(options), {
      items: (await fetchSupabaseInventoryItems(options)).map((item) =>
        normalizeInventoryItem(item),
      ),
    })
  }

  return setCachedResource(getInventoryCacheKey(options), {
    items: ensureLocalInventoryItems().map((item) => normalizeInventoryItem(item)),
  })
}

export function normalizeInventoryItem(item) {
  const productName = item.product_name || item.product || ''
  const categoryName = resolvePreferredCategoryLabel(
    item.category_name,
    item.category,
    item.legacy_category_name,
    item.legacy_category,
  )
  const stockQuantity = Number(
    item.batch_stock_quantity ?? item.stock_quantity ?? item.stock ?? 0,
  )
  const reorderLevel = Number(item.reorder_level ?? LOW_STOCK_THRESHOLD)
  const expiryDate =
    item.earliest_expiration_date ||
    item.expiry_date ||
    item.expiration_date ||
    item.expiry ||
    ''
  const unitValue = item.unit || item.unit_label || item.net_weight || ''
  const priceValue = Number(
    item.price ?? item.selling_price ?? item.default_price ?? item.selling_price ?? 0,
  )

  return {
    id: item.inventory_item_id ?? item.id,
    inventory_item_id: item.inventory_item_id ?? item.id,
    product_id: item.product_id ?? item.productId ?? item.id ?? null,
    branch_id: item.branch_id ?? null,
    branch_name: item.branch_name || item.branch || 'Unassigned Branch',
    branch: item.branch || item.branch_name || 'Unassigned Branch',
    barcode: item.barcode ?? '',
    category_id: item.category_id ?? null,
    category_name: categoryName,
    category: categoryName,
    product_name: productName,
    stock_quantity: stockQuantity,
    unit: unitValue,
    net_weight: unitValue,
    price: Number.isFinite(priceValue) ? priceValue : 0,
    expiry_date: expiryDate,
    expiration_date: expiryDate,
    reorder_level: reorderLevel,
    days_to_expiry: expiryDate ? getDaysToExpiry(expiryDate) : null,
    batches: Array.isArray(item.batches)
      ? item.batches.map((batch) => normalizeInventoryBatch(batch))
      : [],
    batch_count: Number(item.batch_count ?? 0),
    available_batch_count: Number(item.available_batch_count ?? 0),
    near_expiry_batch_count: Number(item.near_expiry_batch_count ?? 0),
    legacy_stock_text: item.legacy_stock_text ?? null,
  }
}

export function createInventoryItemRecord(values, existingItems = []) {
  const nextId =
    existingItems.reduce(
      (maxId, item) => Math.max(maxId, Number(item.id) || 0),
      0,
    ) + 1

  return normalizeInventoryItem({
    id: nextId,
    product_id: nextId,
    branch_id: values.branch_id ?? null,
    branch_name: values.branch_name || 'Unassigned Branch',
    barcode: normalizeBarcodeValue(values.barcode),
    category_name: sanitizeInventoryText(
      resolvePreferredCategoryLabel(values.category_name, values.category),
    ),
    product_name: sanitizeInventoryText(values.product_name ?? values.product),
    stock_quantity: Number(values.stock_quantity ?? values.stock ?? 0),
    unit: sanitizeInventoryText(values.unit),
    price: Number(values.price || 0),
    expiry_date: sanitizeInventoryText(values.expiry_date ?? values.expiration_date),
    reorder_level: Number(values.reorder_level ?? LOW_STOCK_THRESHOLD),
  })
}

export async function createInventoryItem(values, existingItems = []) {
  if (isSupabaseDataEnabled) {
    const conflictingProduct = await findSupabaseProductConflict(values)

    if (conflictingProduct) {
      throw new Error(
        'This product already exists for the selected branch. Use Stock In or Edit instead.',
      )
    }

    const supabase = getSupabaseClient()
    const payload = buildSupabaseProductPayload(values)
    const initialStockQuantity = Math.max(0, Number(payload.stock_quantity || 0))
    const branchId = resolveSupabaseBranchId(values, payload)

    if (initialStockQuantity > 0 && !payload.expiration_date) {
      throw new Error(
        'Enter an expiration date before saving initial stock as an inventory batch.',
      )
    }

    const { data, error } = await supabase
      .from(supabaseTables.products)
      .insert({
        ...payload,
        stock_quantity: 0,
      })
      .select()
      .single()

    if (error) {
      throw createSupabaseServiceError(
        error,
        'Unable to create the product in Supabase.',
      )
    }

    if (initialStockQuantity > 0) {
      await stockInSupabaseInventoryBatch(data.id, branchId, initialStockQuantity, {
        expirationDate: payload.expiration_date,
        notes: 'Initial product stock recorded as an opening inventory batch.',
      })
    }

    const createdItem = await fetchSupabaseInventoryItemByProductId(data.id)
    invalidateInventoryQueryCaches()
    return normalizeInventoryItem(createdItem || data)
  }

  const createdItem = createInventoryItemRecord(values, existingItems)
  persistInventoryItems([createdItem, ...existingItems])
  invalidateInventoryQueryCaches()
  return createdItem
}

export async function updateInventoryItem(itemId, values) {
  if (isSupabaseDataEnabled) {
    const inventoryContext = await getSupabaseInventoryContext(itemId)
    const currentItem = inventoryContext?.currentItem
    const productId = inventoryContext?.productId

    if (!currentItem || productId == null) {
      throw new Error('The selected inventory item could not be found.')
    }

    const conflictingProduct = await findSupabaseProductConflict(
      values,
      currentItem,
      productId,
    )

    if (
      conflictingProduct &&
      Number(conflictingProduct.id) !== Number(productId)
    ) {
      throw new Error(
        'That product already exists in the selected branch. Use Stock In or Edit the existing record instead.',
      )
    }

    const supabase = getSupabaseClient()
    const payload = buildSupabaseProductPayload(values, currentItem)
    const targetStockQuantity = Math.max(0, Number(payload.stock_quantity || 0))
    const currentStockQuantity = Math.max(
      0,
      Number(currentItem.batch_stock_quantity ?? currentItem.stock_quantity ?? 0),
    )
    const productBranchId = resolveSupabaseBranchId(values, currentItem)
    const productPayload = {
      ...payload,
    }
    delete productPayload.stock_quantity

    const { error } = await supabase
      .from(supabaseTables.products)
      .update(productPayload)
      .eq('id', productId)

    if (error) {
      throw createSupabaseServiceError(
        error,
        'Unable to update this inventory item in Supabase.',
      )
    }

    if (targetStockQuantity !== currentStockQuantity) {
      await adjustSupabaseInventoryStockCount(
        productId,
        productBranchId,
        targetStockQuantity,
        {
          expirationDate: payload.expiration_date,
          notes: 'Product edit stock count adjustment.',
        },
      )
    }

    const updatedItem =
      (await fetchSupabaseInventoryItemByProductId(productId)) ||
      (await fetchSupabaseProductById(productId))
    invalidateInventoryQueryCaches()
    return normalizeInventoryItem(updatedItem)
  }

  const currentItems = ensureLocalInventoryItems().map((item) =>
    normalizeInventoryItem(item),
  )
  const selectedItem = currentItems.find(
    (item) => String(item.id) === String(itemId),
  )

  if (!selectedItem) {
    throw new Error('The selected inventory item could not be found.')
  }

  const updatedItem = normalizeInventoryItem({
    id: selectedItem.id,
    ...values,
  })

  persistInventoryItems(
    currentItems.map((item) =>
      String(item.id) === String(itemId) ? updatedItem : item,
    ),
  )

  invalidateInventoryQueryCaches()
  return updatedItem
}

export async function updateInventoryStock(itemId, quantityValue, options = {}) {
  const numericQuantity = Number(quantityValue || 0)
  const mode = options.mode === 'adjust-stock' ? 'adjust-stock' : 'stock-in'

  assertInventoryStockActionPermission(mode, options.user)

  if (!Number.isFinite(numericQuantity)) {
    throw new Error('Enter a valid stock quantity to continue.')
  }

  if (isSupabaseDataEnabled) {
    const inventoryContext = await getSupabaseInventoryContext(itemId)
    const productId = inventoryContext?.productId
    const currentInventoryItem = inventoryContext?.currentItem

    if (productId == null || !currentInventoryItem) {
      throw new Error('The selected inventory item could not be found.')
    }

    const currentProduct = await fetchSupabaseProductById(productId)

    if (!currentProduct) {
      throw new Error('The selected inventory item could not be found.')
    }

    const branchId = resolveSupabaseBranchId(options, currentInventoryItem)

    if (mode === 'stock-in') {
      await stockInSupabaseInventoryBatch(productId, branchId, numericQuantity, {
        expirationDate: resolveSupabaseExpirationDate(options, currentInventoryItem),
        notes: 'Stock-in recorded from inventory action.',
      })
    } else {
      await adjustSupabaseInventoryStockCount(
        productId,
        branchId,
        Math.max(0, numericQuantity),
        {
          expirationDate: resolveSupabaseExpirationDate(options, currentInventoryItem),
          notes: 'Manual stock count adjustment.',
        },
      )
    }

    const updatedItem =
      (await fetchSupabaseInventoryItemByProductId(productId)) ||
      (await fetchSupabaseProductById(productId))
    invalidateInventoryQueryCaches()
    return normalizeInventoryItem(updatedItem)
  }

  const currentItems = ensureLocalInventoryItems().map((item) =>
    normalizeInventoryItem(item),
  )
  const selectedItem = currentItems.find(
    (item) => String(item.id) === String(itemId),
  )

  if (!selectedItem) {
    throw new Error('The selected inventory item could not be found.')
  }

  const updatedItem = normalizeInventoryItem({
    ...selectedItem,
    stock_quantity:
      mode === 'adjust-stock'
        ? Math.max(0, numericQuantity)
        : Math.max(0, Number(selectedItem.stock_quantity) + numericQuantity),
  })

  persistInventoryItems(
    currentItems.map((item) =>
      String(item.id) === String(itemId) ? updatedItem : item,
    ),
  )

  invalidateInventoryQueryCaches()
  return updatedItem
}

export async function removeInventoryItem(itemId) {
  if (isSupabaseDataEnabled) {
    const inventoryContext = await getSupabaseInventoryContext(itemId)
    const productId = inventoryContext?.productId
    const supabase = getSupabaseClient()
    const currentProduct = await fetchSupabaseProductById(productId)

    if (!currentProduct || productId == null) {
      throw new Error('The selected inventory item could not be found.')
    }

    const deleteProduct = async () => supabase
      .from(supabaseTables.products)
      .delete()
      .eq('id', Number(productId))

    const { error } = await deleteProduct()

    if (error) {
      throw createSupabaseServiceError(
        error,
        'Unable to remove this inventory item from Supabase.',
      )
    }

    invalidateInventoryQueryCaches()
    return normalizeInventoryItem(currentProduct)
  }

  const currentItems = ensureLocalInventoryItems().map((item) =>
    normalizeInventoryItem(item),
  )
  const selectedItem = currentItems.find(
    (item) => String(item.id) === String(itemId),
  )

  if (!selectedItem) {
    throw new Error('The selected inventory item could not be found.')
  }

  persistInventoryItems(
    currentItems.filter((item) => String(item.id) !== String(itemId)),
  )

  invalidateInventoryQueryCaches()
  return selectedItem
}

export function normalizeInventoryProductName(value) {
  return sanitizeInventoryText(value).toLowerCase()
}

function normalizeInventoryMatchValue(value) {
  return sanitizeInventoryText(value).toLowerCase()
}

export function hasInventoryCatalogConflict(
  values = {},
  existingItems = [],
  currentItemId = null,
) {
  const normalizedProductName = normalizeInventoryMatchValue(
    values.product_name ?? values.product,
  )
  const normalizedCategoryName = normalizeInventoryMatchValue(
    values.category_name ?? values.category,
  )
  const normalizedUnit = normalizeInventoryMatchValue(
    values.unit ?? values.net_weight,
  )
  const normalizedBarcode = normalizeInventoryMatchValue(values.barcode)
  const normalizedBranchId = values.branch_id ?? values.branchId ?? null
  const normalizedBranchName = normalizeInventoryMatchValue(
    values.branch_name ?? values.branch ?? values.branchName,
  )

  if (!normalizedProductName || !normalizedCategoryName) {
    return false
  }

  return existingItems.some((item) => {
    const matchesBranch =
      (normalizedBranchId != null &&
        item.branch_id != null &&
        Number(item.branch_id) === Number(normalizedBranchId)) ||
      (normalizedBranchName &&
        normalizeInventoryMatchValue(item.branch_name ?? item.branch) === normalizedBranchName) ||
      (normalizedBranchId == null && !normalizedBranchName)

    if (Number(item.id) === Number(currentItemId) || !matchesBranch) {
      return false
    }

    if (
      normalizedBarcode &&
      normalizeInventoryMatchValue(item.barcode) === normalizedBarcode
    ) {
      return true
    }

    return (
      normalizeInventoryMatchValue(item.product_name) === normalizedProductName &&
      normalizeInventoryMatchValue(item.category_name) === normalizedCategoryName &&
      normalizeInventoryMatchValue(item.unit) === normalizedUnit
    )
  })
}

export function persistInventoryItems(items = []) {
  const normalizedItems = items.map((item) => normalizeInventoryItem(item))

  if (!isSupabaseDataEnabled) {
    saveStoredInventoryItems(normalizedItems)
  }

  invalidateInventoryQueryCaches()

  return normalizedItems
}

function findInventoryItemMatch(inventoryItem, soldItem) {
  const soldProductId =
    soldItem.product_id ?? soldItem.productId ?? soldItem.id ?? null

  if (soldProductId != null && inventoryItem.product_id != null) {
    return String(inventoryItem.product_id) === String(soldProductId)
  }

  const soldItemName = soldItem.item_name || soldItem.name || ''

  return (
    normalizeInventoryProductName(inventoryItem.product_name) ===
    normalizeInventoryProductName(soldItemName)
  )
}

export async function applySaleToInventory(soldItems = [], options = {}) {
  const inventoryTrackedItems = Array.isArray(soldItems)
    ? soldItems.filter((soldItem) => soldItem?.is_service_fee !== true)
    : []

  if (inventoryTrackedItems.length === 0) {
    const inventoryResponse = await getInventoryItems(options)
    return inventoryResponse.items || inventoryResponse
  }

  if (isSupabaseDataEnabled) {
    if (!supabaseRuntime.inventoryManagedOnSale) {
      const inventoryResponse = await getInventoryItems(options)
      return inventoryResponse.items || inventoryResponse
    }

    const branchId =
      options.branchId != null && String(options.branchId).trim() !== ''
        ? Number(options.branchId)
        : Number(supabaseRuntime.defaultBranchId || 1)

    const supabase = getSupabaseClient()

    await Promise.all(
      inventoryTrackedItems.map(async (soldItem) => {
        const productId =
          soldItem.product_id ?? soldItem.productId ?? soldItem.id ?? null

        if (productId == null) {
          return
        }

        const currentProduct = await fetchSupabaseProductById(productId)

        if (!currentProduct) {
          return
        }

        const productBranchId =
          resolveSupabaseBranchId({ branch: currentProduct.branch }, currentProduct)

        if (Number(productBranchId) !== Number(branchId)) {
          return
        }

        if (Number(soldItem.quantity || 0) > Number(currentProduct.stock_quantity || 0)) {
          throw new Error(
            `${soldItem.item_name || soldItem.name || 'This item'} only has ${
              Number(currentProduct.stock_quantity || 0)
            } item${
              Number(currentProduct.stock_quantity || 0) === 1 ? '' : 's'
            } in stock.`,
          )
        }

        const nextStockQuantity = Math.max(
          0,
          Number(currentProduct.stock_quantity || 0) - Number(soldItem.quantity || 0),
        )

        const { error: updateError } = await supabase
          .from(supabaseTables.products)
          .update({ stock_quantity: nextStockQuantity })
          .eq('id', productId)

        if (updateError) {
          throw createSupabaseServiceError(
            updateError,
            'Unable to sync branch inventory after checkout.',
          )
        }
      }),
    )

    invalidateInventoryQueryCaches()
    const inventoryResponse = await getInventoryItems({ branchId })
    return inventoryResponse.items || inventoryResponse
  }

  const inventoryResponse = await getInventoryItems(options)
  const currentInventoryItems = inventoryResponse.items || inventoryResponse
  const nextInventoryItems = currentInventoryItems.map((inventoryItem) => {
    const matchedSaleItem = inventoryTrackedItems.find((soldItem) =>
      findInventoryItemMatch(inventoryItem, soldItem),
    )

    if (!matchedSaleItem) {
      return inventoryItem
    }

    return normalizeInventoryItem({
      ...inventoryItem,
      stock_quantity: Math.max(
        0,
        Number(inventoryItem.stock_quantity) - Number(matchedSaleItem.quantity || 0),
      ),
    })
  })

  persistInventoryItems(nextInventoryItems)
  invalidateInventoryQueryCaches()
  return nextInventoryItems
}

function getDaysToExpiry(value) {
  const today = new Date()
  const expiryDate = new Date(value)
  const msUntilExpiry = expiryDate.getTime() - today.getTime()

  return Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24))
}

export function formatInventoryDate(value) {
  return shortDate(value)
}

export function isLowStock(item) {
  return Number(item.stock_quantity) <= Number(item.reorder_level)
}

export function isNearExpiry(item) {
  return item.days_to_expiry != null && Number(item.days_to_expiry) <= NEAR_EXPIRY_DAYS
}

export function getInventoryStatus(item) {
  if (isLowStock(item) && isNearExpiry(item)) {
    return { label: 'Low Stock & Near Expiry', tone: 'critical' }
  }

  if (isLowStock(item)) {
    return { label: 'Low Stock', tone: 'warning' }
  }

  if (isNearExpiry(item)) {
    return { label: 'Near Expiry', tone: 'attention' }
  }

  return { label: 'Normal', tone: 'normal' }
}
