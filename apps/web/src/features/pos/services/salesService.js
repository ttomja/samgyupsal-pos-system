import {
  createSupabaseServiceError,
  getSupabaseClient,
  isSupabaseDataEnabled,
  supabaseRpc,
  supabaseTables,
} from '../../../shared/supabase/client.js'
import { isAdminUser } from '../../../shared/utils/permissions.js'
import {
  getStoredSalesHistory,
  saveStoredSalesHistory,
} from '../../../shared/utils/storage.js'
import {
  clearCachedResourceByPrefix,
  getCachedResource,
  setCachedResource,
} from '../../../shared/utils/resourceCache.js'
import { normalizeSearchInput } from '../../../shared/utils/validation.js'
import { applySaleToInventory } from '../../inventory/services/inventoryService.js'
import { getDiscountConfig } from '../utils/discounts.js'
import {
  SERVICE_FEE_PREFIX,
  buildServiceFeeLineItems,
  isServiceFeeLineItem,
  serviceFeeOptions,
} from '../utils/serviceFees.js'

export const SALES_HISTORY_ALL_FILTER = 'all'
export const DEFAULT_SALES_HISTORY_PAGE_SIZE = 10
export const paymentMethods = [{ value: 'cash', label: 'Cash' }]
const SALES_CACHE_PREFIX = 'sales:'
const SALES_CACHE_TTL_MS = 30 * 1000
export const salesHistoryPaymentMethodOptions = [
  { value: SALES_HISTORY_ALL_FILTER, label: 'All Payment Methods' },
  ...paymentMethods,
]

export {
  SERVICE_FEE_PREFIX,
  buildServiceFeeLineItems,
  isServiceFeeLineItem,
  serviceFeeOptions,
}

function getNumericValue(value, fallbackValue = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallbackValue
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizePaymentMethod(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizePostgrestSearchValue(value) {
  return normalizeSearchInput(value)
    .replace(/[%*(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function invalidateSalesCaches() {
  clearCachedResourceByPrefix(SALES_CACHE_PREFIX)
  clearCachedResourceByPrefix('reports:')
}

function invalidateCheckoutCaches() {
  invalidateSalesCaches()
  clearCachedResourceByPrefix('inventory:')
  clearCachedResourceByPrefix('products:')
}

function buildSalesCacheKey(namespace, options = {}) {
  return `${SALES_CACHE_PREFIX}${namespace}:${JSON.stringify({
    userId: normalizeText(options.user?.id),
    userRole: normalizeText(options.user?.roleKey ?? options.user?.role),
    userBranchId: options.user?.branchId ?? null,
    transactionQuery: normalizeSearchInput(options.transactionQuery),
    cashierQuery: normalizeSearchInput(options.cashierQuery),
    cashierId: normalizeText(options.cashierId),
    cashierProfileIds: Array.isArray(options.cashierProfileIds)
      ? options.cashierProfileIds.map((cashierId) => normalizeText(cashierId)).sort()
      : [],
    dateFrom: String(options.dateFrom || '').trim(),
    dateTo: String(options.dateTo || '').trim(),
    paymentMethod: normalizePaymentMethod(options.paymentMethod),
    branchId: String(options.branchId || '').trim(),
    page: Number(options.page || 1),
    pageSize: Number(options.pageSize || DEFAULT_SALES_HISTORY_PAGE_SIZE),
  })}`
}

export function getCachedSalesHistoryPage(options = {}) {
  return getCachedResource(
    buildSalesCacheKey('page', options),
    SALES_CACHE_TTL_MS,
  )
}

function toDateBoundary(value, boundary = 'start') {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return null
  }

  const boundaryTime =
    boundary === 'end' ? 'T23:59:59.999' : 'T00:00:00.000'
  const parsedDate = new Date(`${normalizedValue}${boundaryTime}`)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function getSaleDateValue(sale = {}) {
  return String(sale.submitted_at || sale.created_at || '').trim()
}

function getSaleDate(sale = {}) {
  const saleDate = new Date(getSaleDateValue(sale))
  return Number.isNaN(saleDate.getTime()) ? null : saleDate
}

function normalizeSaleItem(item = {}, fallbackId) {
  const quantity = getNumericValue(item.quantity, 0)
  const unitPrice = getNumericValue(
    item.unit_price ?? item.unitPrice ?? item.price,
    0,
  )

  return {
    ...item,
    id:
      item.id ??
      item.sale_item_id ??
      fallbackId,
    product_id: item.product_id ?? null,
    inventory_item_id: item.inventory_item_id ?? item.inventoryItemId ?? null,
    item_name: normalizeText(item.item_name || item.itemName || item.name) || 'Unknown Item',
    quantity,
    unit_price: unitPrice,
    line_total: getNumericValue(
      item.line_total,
      quantity * unitPrice,
    ),
    is_service_fee:
      item.is_service_fee === true || isServiceFeeLineItem(item),
  }
}

export function buildSaleLineItems(cartItems = [], extraLineItems = []) {
  const normalizedCartItems = Array.isArray(cartItems) ? cartItems : []
  const normalizedExtraLineItems = Array.isArray(extraLineItems) ? extraLineItems : []

  return [
    ...normalizedCartItems.map((item) => {
      const quantity = getNumericValue(item.quantity, 0)
      const unitPrice = getNumericValue(
        item.price ?? item.unit_price ?? item.unitPrice,
        0,
      )

      return {
        product_id: item.product_id ?? item.productId ?? item.id ?? null,
        inventory_item_id:
          item.inventory_item_id ?? item.inventoryItemId ?? item.id ?? null,
        quantity,
        unit_price: unitPrice,
        item_name: normalizeText(item.name || item.item_name) || 'Unknown Item',
        line_total: quantity * unitPrice,
      }
    }),
    ...normalizedExtraLineItems.map((item) => ({
      ...item,
      inventory_item_id:
        item.inventory_item_id ?? item.inventoryItemId ?? null,
    })),
  ]
}

function normalizeSaleRecord(sale = {}) {
  const normalizedItems = Array.isArray(sale.items)
    ? sale.items.map((item, index) =>
        normalizeSaleItem(item, `${sale.id || sale.sale_id || 'sale'}-${index + 1}`),
      )
    : []

  return {
    ...sale,
    id: sale.id ?? sale.sale_id ?? null,
    transaction_number:
      normalizeText(
        sale.transaction_number ??
          sale.transactionNumber ??
          sale.receipt_number ??
          sale.receiptNumber,
      ) || '',
    discount_type:
      normalizeText(sale.discount_type ?? sale.discountType) || '',
    cashier_id: normalizeText(sale.cashier_id ?? sale.cashierId),
    cashier_name:
      normalizeText(sale.cashier_name ?? sale.cashierName) || 'Unknown Cashier',
    branch_id:
      sale.branch_id ?? sale.branchId ?? null,
    branch_name:
      normalizeText(sale.branch_name ?? sale.branchName) || 'All Branches',
    payment_method: normalizePaymentMethod(sale.payment_method || sale.paymentMethod || 'cash'),
    subtotal: getNumericValue(sale.subtotal, 0),
    discount: getNumericValue(sale.discount, 0),
    total_amount: getNumericValue(sale.total_amount ?? sale.total, 0),
    cash_received: getNumericValue(sale.cash_received ?? sale.cashReceived, 0),
    change_amount: getNumericValue(sale.change_amount ?? sale.change, 0),
    notes: normalizeText(sale.notes),
    submitted_at: getSaleDateValue(sale),
    items: normalizedItems,
  }
}

function sortSalesByNewest(left, right) {
  const leftDate = getSaleDate(left)?.getTime() || 0
  const rightDate = getSaleDate(right)?.getTime() || 0
  return rightDate - leftDate
}

function normalizeTransactionQuery(value) {
  return normalizeSearchInput(value).toLowerCase()
}

function parseTransactionReference(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return null
  }

  const digits = normalizedValue.match(/\d+/g)

  if (!digits || digits.length === 0) {
    return null
  }

  const parsedValue = Number(digits.join(''))
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function matchesDateRange(sale, options = {}) {
  const rangeStart = toDateBoundary(options.dateFrom, 'start')
  const rangeEnd = toDateBoundary(options.dateTo, 'end')

  if (!rangeStart && !rangeEnd) {
    return true
  }

  const saleDate = getSaleDate(sale)

  if (!saleDate) {
    return false
  }

  if (rangeStart && saleDate < rangeStart) {
    return false
  }

  if (rangeEnd && saleDate > rangeEnd) {
    return false
  }

  return true
}

function matchesUserScope(sale, user) {
  if (!user) {
    return true
  }

  if (isAdminUser(user)) {
    return true
  }

  if (user?.branchId != null && String(user.branchId).trim() !== '') {
    return Number(sale.branch_id) === Number(user.branchId)
  }

  const cashierId = normalizeText(user?.id)
  return cashierId.length > 0 && normalizeText(sale.cashier_id) === cashierId
}

function matchesTransactionQuery(sale, transactionQuery) {
  const normalizedQuery = normalizeTransactionQuery(transactionQuery)

  if (!normalizedQuery) {
    return true
  }

  return getSaleReference(sale).toLowerCase().includes(normalizedQuery)
}

function matchesCashierQuery(sale, cashierQuery, cashierProfileIds = []) {
  const normalizedQuery = normalizeSearchInput(cashierQuery).toLowerCase()
  const normalizedCashierId = normalizeText(sale.cashier_id)
  const normalizedProfileIds = Array.isArray(cashierProfileIds)
    ? cashierProfileIds.map((cashierId) => normalizeText(cashierId)).filter(Boolean)
    : []

  if (!normalizedQuery) {
    return true
  }

  if (
    normalizedCashierId &&
    normalizedProfileIds.some((cashierId) => cashierId === normalizedCashierId)
  ) {
    return true
  }

  return [
    sale.cashier_name,
    sale.cashierName,
    sale.cashier_id,
    sale.cashierId,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .some((value) => value.includes(normalizedQuery))
}

function matchesCashierId(sale, cashierId) {
  const normalizedCashierId = normalizeText(cashierId)

  if (!normalizedCashierId) {
    return true
  }

  return normalizeText(sale.cashier_id) === normalizedCashierId
}

function matchesBranchFilter(sale, branchId) {
  const normalizedBranchId = String(branchId || '').trim()

  if (!normalizedBranchId || normalizedBranchId === SALES_HISTORY_ALL_FILTER) {
    return true
  }

  return Number(sale.branch_id) === Number(normalizedBranchId)
}

function matchesPaymentFilter(sale, paymentMethod) {
  const normalizedValue = normalizePaymentMethod(paymentMethod)

  if (!normalizedValue || normalizedValue === SALES_HISTORY_ALL_FILTER) {
    return true
  }

  return normalizePaymentMethod(sale.payment_method) === normalizedValue
}

function paginateSalesHistory(records, page = 1, pageSize = DEFAULT_SALES_HISTORY_PAGE_SIZE) {
  const normalizedPageSize = Math.max(1, Number(pageSize || DEFAULT_SALES_HISTORY_PAGE_SIZE))
  const totalCount = records.length
  const totalPages = Math.max(1, Math.ceil(totalCount / normalizedPageSize))
  const currentPage = Math.min(Math.max(1, Number(page || 1)), totalPages)
  const startIndex = (currentPage - 1) * normalizedPageSize

  return {
    records: records.slice(startIndex, startIndex + normalizedPageSize),
    totalCount,
    totalPages,
    currentPage,
    pageSize: normalizedPageSize,
  }
}

async function getSupabaseSaleItemsBySaleIds(saleIds = []) {
  if (!Array.isArray(saleIds) || saleIds.length === 0) {
    return new Map()
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(supabaseTables.saleItems)
    .select('*')
    .in('sale_id', saleIds)
    .order('id', { ascending: true })

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Sale item records could not be loaded from Supabase.',
    )
  }

  return (data || []).reduce((saleItemMap, item) => {
    const saleKey = String(item.sale_id)
    const currentItems = saleItemMap.get(saleKey) || []
    currentItems.push(normalizeSaleItem(item, `${saleKey}-${currentItems.length + 1}`))
    saleItemMap.set(saleKey, currentItems)
    return saleItemMap
  }, new Map())
}

async function getSupabaseCashierIdsByQuery(cashierQuery) {
  const normalizedQuery = normalizePostgrestSearchValue(cashierQuery)

  if (!normalizedQuery) {
    return []
  }

  try {
    const supabase = getSupabaseClient()
    const profileQuery = `full_name.ilike.*${normalizedQuery}*,username.ilike.*${normalizedQuery}*`
    const { data, error } = await supabase
      .from(supabaseTables.profiles)
      .select('id')
      .or(profileQuery)
      .limit(50)

    if (error) {
      throw error
    }

    return (data || [])
      .map((profile) => normalizeText(profile.id))
      .filter(Boolean)
  } catch (error) {
    console.warn('Employee profile lookup for sales filtering failed:', error)
    return []
  }
}

function applySupabaseSalesFilters(query, options = {}, user) {
  let nextQuery = query

  if (!isAdminUser(user)) {
    if (user?.branchId != null && String(user.branchId).trim() !== '') {
      nextQuery = nextQuery.eq('branch_id', Number(user.branchId))
    } else if (normalizeText(user?.id)) {
      nextQuery = nextQuery.eq('cashier_id', normalizeText(user.id))
    }
  }

  const normalizedBranchId = String(options.branchId || '').trim()

  if (
    normalizedBranchId &&
    normalizedBranchId !== SALES_HISTORY_ALL_FILTER
  ) {
    nextQuery = nextQuery.eq('branch_id', Number(options.branchId))
  }

  const normalizedCashierId = normalizeText(options.cashierId)

  if (normalizedCashierId) {
    nextQuery = nextQuery.eq('cashier_id', normalizedCashierId)
  }

  if (
    normalizePaymentMethod(options.paymentMethod) &&
    normalizePaymentMethod(options.paymentMethod) !== SALES_HISTORY_ALL_FILTER
  ) {
    nextQuery = nextQuery.eq(
      'payment_method',
      normalizePaymentMethod(options.paymentMethod),
    )
  }

  const rangeStart = toDateBoundary(options.dateFrom, 'start')
  const rangeEnd = toDateBoundary(options.dateTo, 'end')

  if (rangeStart) {
    nextQuery = nextQuery.gte('submitted_at', rangeStart.toISOString())
  }

  if (rangeEnd) {
    nextQuery = nextQuery.lte('submitted_at', rangeEnd.toISOString())
  }

  const normalizedCashierQuery = normalizeSearchInput(options.cashierQuery)

  if (isAdminUser(user) && normalizedCashierQuery) {
    const normalizedPostgrestQuery = normalizePostgrestSearchValue(normalizedCashierQuery)
    const cashierProfileIds = Array.isArray(options.cashierProfileIds)
      ? options.cashierProfileIds
          .map((cashierId) => normalizeText(cashierId))
          .filter(Boolean)
      : []

    if (cashierProfileIds.length > 0) {
      nextQuery = nextQuery.or(
        [
          `cashier_name.ilike.*${normalizedPostgrestQuery}*`,
          `cashier_id.in.(${cashierProfileIds.join(',')})`,
        ].join(','),
      )
    } else {
      nextQuery = nextQuery.ilike('cashier_name', `%${normalizedCashierQuery}%`)
    }
  }

  const transactionReference = parseTransactionReference(options.transactionQuery)

  if (normalizeSearchInput(options.transactionQuery)) {
    if (transactionReference == null) {
      return null
    }

    nextQuery = nextQuery.eq('id', transactionReference)
  }

  return nextQuery
}

async function loadSupabaseSalesHistory(options = {}, paginationOptions = null) {
  const supabase = getSupabaseClient()
  const providedCashierProfileIds = Array.isArray(options.cashierProfileIds)
    ? options.cashierProfileIds
        .map((cashierId) => normalizeText(cashierId))
        .filter(Boolean)
    : []
  const cashierProfileIds =
    isAdminUser(options.user) && normalizeSearchInput(options.cashierQuery)
      ? Array.from(
          new Set([
            ...providedCashierProfileIds,
            ...(await getSupabaseCashierIdsByQuery(options.cashierQuery)),
          ]),
        )
      : providedCashierProfileIds
  const baseQuery = supabase
    .from(supabaseTables.sales)
    .select('*', { count: 'exact' })
    .order('submitted_at', { ascending: false })

  let filteredQuery = applySupabaseSalesFilters(
    baseQuery,
    {
      ...options,
      cashierProfileIds,
    },
    options.user,
  )

  if (filteredQuery == null) {
    const emptyPage = paginationOptions
      ? {
          records: [],
          totalCount: 0,
          totalPages: 1,
          currentPage: 1,
          pageSize: Math.max(
            1,
            Number(paginationOptions.pageSize || DEFAULT_SALES_HISTORY_PAGE_SIZE),
          ),
        }
      : []

    return emptyPage
  }

  let currentPage = 1
  let pageSize = DEFAULT_SALES_HISTORY_PAGE_SIZE

  if (paginationOptions) {
    pageSize = Math.max(1, Number(paginationOptions.pageSize || DEFAULT_SALES_HISTORY_PAGE_SIZE))
    currentPage = Math.max(1, Number(paginationOptions.page || 1))
    const from = (currentPage - 1) * pageSize
    const to = from + pageSize - 1
    filteredQuery = filteredQuery.range(from, to)
  }

  const { data: salesRows, error: salesError, count } = await filteredQuery

  if (salesError) {
    throw createSupabaseServiceError(
      salesError,
      'Sales records could not be loaded from Supabase.',
    )
  }

  const normalizedSalesRows = (salesRows || []).map((sale) =>
    normalizeSaleRecord(sale),
  )
  const saleIds = normalizedSalesRows
    .map((sale) => sale.id)
    .filter((saleId) => saleId != null)
  const saleItemsBySaleId = await getSupabaseSaleItemsBySaleIds(saleIds)
  const records = normalizedSalesRows.map((sale) => ({
    ...sale,
    items: saleItemsBySaleId.get(String(sale.id)) || [],
  }))

  if (!paginationOptions) {
    return records
  }

  const totalCount = Number(count || 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return {
    records,
    totalCount,
    totalPages,
    currentPage: Math.min(currentPage, totalPages),
    pageSize,
  }
}

function getLocalSalesHistoryRecords() {
  return getStoredSalesHistory().map((sale) => normalizeSaleRecord(sale))
}

function buildLocalSaleRecord(payload, meta = {}) {
  const submittedAt = new Date().toISOString()
  const normalizedItems = Array.isArray(meta.items)
    ? meta.items.map((item, index) => ({
        id: `${payload.cashier_id || 'cashier'}-${submittedAt}-${index + 1}`,
        product_id: item.product_id ?? null,
        inventory_item_id: item.inventory_item_id ?? item.inventoryItemId ?? null,
        item_name: item.item_name || 'Unknown Item',
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        line_total:
          Number(item.line_total || 0) ||
          Number(item.quantity || 0) * Number(item.unit_price || 0),
        is_service_fee: Boolean(item.is_service_fee),
      }))
    : []

  return normalizeSaleRecord({
    id: `sale-${submittedAt}-${payload.cashier_id || 'cashier'}`,
    transaction_number: meta.transactionNumber,
    discount_type: meta.discountType,
    cashier_id: payload.cashier_id,
    cashier_name: meta.cashierName || 'Unknown Cashier',
    branch_id: meta.branchId ?? null,
    branch_name: meta.branchName || 'All Branches',
    payment_method: payload.payment_method || 'cash',
    subtotal: Number(payload.subtotal || 0),
    discount: Number(payload.discount || 0),
    total_amount: Number(payload.total_amount || 0),
    cash_received: Number(payload.cash_received || 0),
    change_amount: Number(payload.change_amount || 0),
    notes: meta.notes || '',
    submitted_at: submittedAt,
    items: normalizedItems,
  })
}

function persistLocalSaleRecord(record) {
  const salesHistory = getStoredSalesHistory()
  saveStoredSalesHistory([record, ...salesHistory])
  invalidateSalesCaches()
}

async function syncSaleToInventory(record) {
  try {
    await applySaleToInventory(record.items, { branchId: record.branch_id })
    return true
  } catch (error) {
    console.error('Failed to sync the sale into inventory state:', error)
    return false
  }
}

async function createSupabaseSale(localRecord, payload) {
  const supabase = getSupabaseClient()
  const salePayload = {
    cashier_id: localRecord.cashier_id,
    cashier_name: localRecord.cashier_name,
    branch_id: localRecord.branch_id,
    branch_name: localRecord.branch_name,
    payment_method: localRecord.payment_method,
    subtotal: localRecord.subtotal,
    discount: localRecord.discount,
    total_amount: localRecord.total_amount,
    cash_received: localRecord.cash_received,
    change_amount: localRecord.change_amount,
    submitted_at: localRecord.submitted_at,
    notes: localRecord.notes || null,
  }
  const itemPayload = localRecord.items.map((item) => ({
    product_id: item.product_id,
    inventory_item_id: item.inventory_item_id,
    item_name: item.item_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
  }))
  const { data, error } = await supabase.rpc(supabaseRpc.createCheckoutSale, {
    p_sale: salePayload,
    p_items: itemPayload,
  })

  if (error) {
    throw createSupabaseServiceError(
      error,
      'Unable to complete checkout in Supabase.',
    )
  }

  const saleRow = data?.sale || null
  const saleItems = Array.isArray(data?.items) ? data.items : []
  const batchAllocations = Array.isArray(data?.allocations) ? data.allocations : []
  const savedRecord = normalizeSaleRecord({
    ...localRecord,
    ...saleRow,
    transaction_number: localRecord.transaction_number,
    discount_type: localRecord.discount_type,
    items: saleItems.length > 0 ? saleItems : localRecord.items,
  })

  invalidateCheckoutCaches()

  return {
    ok: true,
    source: 'supabase-rpc',
    paymentMethod: payload.payment_method || 'cash',
    total: payload.total_amount,
    submittedAt: savedRecord.submitted_at,
    localRecord: savedRecord,
    sale: saleRow,
    batchAllocations,
    inventorySynced: data?.inventory_synced !== false,
  }
}

export function getSaleReference(sale = {}) {
  const explicitReference = normalizeText(
    sale.transaction_number ??
      sale.transactionNumber ??
      sale.receipt_number ??
      sale.receiptNumber,
  )

  if (explicitReference) {
    return explicitReference
  }

  const numericId = Number(sale.id ?? sale.sale_id)

  if (Number.isFinite(numericId) && numericId > 0) {
    return `TRX-${String(numericId).padStart(6, '0')}`
  }

  const fallbackId = normalizeText(sale.id ?? sale.sale_id)
  return fallbackId || 'Pending transaction'
}

export function getSalePaymentMethodLabel(paymentMethod = 'cash') {
  return (
    paymentMethods.find(
      (method) => method.value === normalizePaymentMethod(paymentMethod),
    )?.label || 'Cash'
  )
}

export function getSaleItemCount(sale = {}) {
  return (Array.isArray(sale.items) ? sale.items : [])
    .filter((item) => !isServiceFeeLineItem(item))
    .reduce((count, item) => count + Number(item.quantity || 0), 0)
}

export function getSaleServiceFeeTotal(sale = {}) {
  return (Array.isArray(sale.items) ? sale.items : [])
    .filter((item) => isServiceFeeLineItem(item))
    .reduce((total, item) => total + getNumericValue(item.line_total, 0), 0)
}

export function getSaleDiscountTypeLabel(sale = {}) {
  const discountType = normalizeText(sale.discount_type ?? sale.discountType)

  if (!discountType) {
    return Number(sale.discount || 0) > 0 ? 'Discount applied' : 'No Discount'
  }

  return getDiscountConfig(discountType).label
}

export function buildReceiptPreviewData(sale = {}) {
  const normalizedSale = normalizeSaleRecord(sale)

  return {
    transactionNumber: getSaleReference(normalizedSale),
    cashierName: normalizedSale.cashier_name,
    branchName: normalizedSale.branch_name,
    issuedAt: normalizedSale.submitted_at || normalizedSale.created_at,
    paymentMethodLabel: getSalePaymentMethodLabel(normalizedSale.payment_method),
    subtotal: normalizedSale.subtotal,
    serviceFeeTotal: getSaleServiceFeeTotal(normalizedSale),
    discount: normalizedSale.discount,
    discountTypeLabel: getSaleDiscountTypeLabel(normalizedSale),
    total: normalizedSale.total_amount,
    cashReceived: normalizedSale.cash_received,
    change: normalizedSale.change_amount,
    notes: normalizedSale.notes,
    items: normalizedSale.items.map((item, index) => ({
      id: item.id ?? `${normalizedSale.id || 'sale'}-${index + 1}`,
      name: item.item_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
      isServiceFee: isServiceFeeLineItem(item),
    })),
  }
}

export function filterSalesRecords(records = [], options = {}) {
  return records
    .map((sale) => normalizeSaleRecord(sale))
    .filter((sale) => matchesUserScope(sale, options.user))
    .filter((sale) => matchesDateRange(sale, options))
    .filter((sale) => matchesCashierId(sale, options.cashierId))
    .filter((sale) => matchesBranchFilter(sale, options.branchId))
    .filter((sale) => matchesPaymentFilter(sale, options.paymentMethod))
    .filter((sale) => matchesTransactionQuery(sale, options.transactionQuery))
    .filter((sale) =>
      matchesCashierQuery(sale, options.cashierQuery, options.cashierProfileIds),
    )
    .sort(sortSalesByNewest)
}

export async function getSalesRecords(options = {}) {
  const cacheKey = buildSalesCacheKey('records', options)
  const cachedRecords = getCachedResource(cacheKey, SALES_CACHE_TTL_MS)

  if (cachedRecords) {
    return cachedRecords
  }

  if (isSupabaseDataEnabled) {
    return setCachedResource(cacheKey, await loadSupabaseSalesHistory(options))
  }

  return setCachedResource(
    cacheKey,
    filterSalesRecords(getLocalSalesHistoryRecords(), options),
  )
}

export async function getSalesHistoryPage(options = {}) {
  const cacheKey = buildSalesCacheKey('page', options)
  const cachedHistoryPage = getCachedResource(cacheKey, SALES_CACHE_TTL_MS)

  if (cachedHistoryPage) {
    return cachedHistoryPage
  }

  const normalizedPage = Math.max(1, Number(options.page || 1))
  const normalizedPageSize = Math.max(
    1,
    Number(options.pageSize || DEFAULT_SALES_HISTORY_PAGE_SIZE),
  )

  if (isSupabaseDataEnabled) {
    return setCachedResource(
      cacheKey,
      await loadSupabaseSalesHistory(options, {
        page: normalizedPage,
        pageSize: normalizedPageSize,
      }),
    )
  }

  const filteredRecords = filterSalesRecords(getLocalSalesHistoryRecords(), options)
  return setCachedResource(
    cacheKey,
    paginateSalesHistory(filteredRecords, normalizedPage, normalizedPageSize),
  )
}

export async function createSale(payload, meta = {}) {
  const localRecord = buildLocalSaleRecord(payload, meta)
  invalidateSalesCaches()

  if (isSupabaseDataEnabled) {
    return createSupabaseSale(localRecord, payload)
  }

  persistLocalSaleRecord(localRecord)
  const inventorySynced = await syncSaleToInventory(localRecord)

  return {
    ok: true,
    source: 'local-fallback',
    paymentMethod: 'cash',
    total: payload.total_amount,
    submittedAt: localRecord.submitted_at,
    localRecord,
    inventorySynced,
  }
}

export async function finalizeCashSale(payload) {
  return createSale(payload)
}
