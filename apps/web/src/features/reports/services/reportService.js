import { getInventoryItems, isLowStock } from '../../inventory/services/inventoryService'
import { isServiceFeeLineItem } from '../../pos/utils/serviceFees'
import { getSalesRecords } from '../../pos/services/salesService'
import { getDefaultReportDateRange } from '../../../shared/utils/reporting.js'
import { peso, shortDate } from '../../../shared/utils/formatters'
import {
  createSupabaseServiceError,
  getSupabaseClient,
  isSupabaseDataEnabled,
  supabaseTables,
} from '../../../shared/supabase/client.js'
import {
  getCachedResource,
  setCachedResource,
} from '../../../shared/utils/resourceCache'

const REPORTS_CACHE_PREFIX = 'reports:'
const REPORTS_CACHE_TTL_MS = 60 * 1000
const SALES_VELOCITY_WINDOW_DAYS = 30
const STOCKOUT_ALERT_DAYS = 14
const NEAR_EXPIRY_ALERT_DAYS = 30
export const REPORT_PERIOD_DAILY = 'daily'
export const REPORT_PERIOD_WEEKLY = 'weekly'
export const REPORT_PERIOD_MONTHLY = 'monthly'
export const reportPeriodOptions = [
  { value: REPORT_PERIOD_DAILY, label: 'Daily' },
  { value: REPORT_PERIOD_WEEKLY, label: 'Weekly' },
  { value: REPORT_PERIOD_MONTHLY, label: 'Monthly' },
]

export { getDefaultReportDateRange }

function getReportCacheKey(options = {}) {
  return `${REPORTS_CACHE_PREFIX}${JSON.stringify({
    branchId: options.branchId ?? null,
    cashierId: options.cashierId ?? null,
    dateFrom: options.dateFrom || '',
    dateTo: options.dateTo || '',
    periodType: options.periodType || '',
    userRole: options.user?.roleKey ?? options.user?.role ?? '',
    userBranchId: options.user?.branchId ?? null,
  })}`
}

export function getCachedReportSnapshot(options = {}) {
  return getCachedResource(getReportCacheKey(options), REPORTS_CACHE_TTL_MS)
}

function summarizeSales(sales) {
  return sales.reduce(
    (summary, sale) => {
      summary.totalSales += Number(sale.total_amount || 0)
      summary.transactionCount += 1
      summary.itemsSold += (sale.items || [])
        .filter((item) => !isServiceFeeLineItem(item))
        .reduce((count, item) => count + Number(item.quantity || 0), 0)
      return summary
    },
    {
      totalSales: 0,
      transactionCount: 0,
      itemsSold: 0,
    },
  )
}

function getPeriodLabel(periodType) {
  return reportPeriodOptions.find((option) => option.value === periodType)?.label || 'Daily'
}

function getDateRangeLabel(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) {
    return 'All available dates'
  }

  if (dateFrom === dateTo) {
    return shortDate(dateFrom)
  }

  return `${shortDate(dateFrom)} to ${shortDate(dateTo)}`
}

function getStartOfWeek(referenceDate) {
  const startDate = new Date(referenceDate)
  const dayOfWeek = startDate.getDay()
  const daysFromMonday = (dayOfWeek + 6) % 7
  startDate.setDate(startDate.getDate() - daysFromMonday)
  startDate.setHours(0, 0, 0, 0)
  return startDate
}

export function getReportPeriodDateRange(
  periodType = REPORT_PERIOD_DAILY,
  referenceDate = new Date(),
) {
  const normalizedReferenceDate = new Date(referenceDate)

  if (Number.isNaN(normalizedReferenceDate.getTime())) {
    return getReportPeriodDateRange(periodType, new Date())
  }

  normalizedReferenceDate.setHours(0, 0, 0, 0)

  if (periodType === REPORT_PERIOD_WEEKLY) {
    const startDate = getStartOfWeek(normalizedReferenceDate)
    const endDate = addDays(startDate, 6)

    return {
      dateFrom: formatDateInput(startDate),
      dateTo: formatDateInput(endDate),
    }
  }

  if (periodType === REPORT_PERIOD_MONTHLY) {
    const startDate = new Date(
      normalizedReferenceDate.getFullYear(),
      normalizedReferenceDate.getMonth(),
      1,
    )
    const endDate = new Date(
      normalizedReferenceDate.getFullYear(),
      normalizedReferenceDate.getMonth() + 1,
      0,
    )

    return {
      dateFrom: formatDateInput(startDate),
      dateTo: formatDateInput(endDate),
    }
  }

  return {
    dateFrom: formatDateInput(normalizedReferenceDate),
    dateTo: formatDateInput(normalizedReferenceDate),
  }
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

function isMissingSupabaseResourceError(error) {
  const normalizedMessage = String(
    [error?.code, error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()

  return (
    normalizedMessage.includes('42p01') ||
    normalizedMessage.includes('42703') ||
    normalizedMessage.includes('pgrst202') ||
    normalizedMessage.includes('could not find the table') ||
    normalizedMessage.includes('schema cache')
  )
}

async function getInventoryMovementsForRange(options = {}) {
  if (!isSupabaseDataEnabled) {
    return []
  }

  try {
    const rangeStart = toDateBoundary(options.dateFrom, 'start')
    const rangeEnd = toDateBoundary(options.dateTo, 'end')
    const supabase = getSupabaseClient()
    let query = supabase
      .from(supabaseTables.inventoryMovements)
      .select(
        'id, product_id, batch_id, branch_id, movement_type, quantity_delta, quantity_after, sale_id, sale_item_id, created_at',
      )
      .order('created_at', { ascending: true })

    if (
      options.branchId != null &&
      String(options.branchId).trim() !== '' &&
      String(options.branchId).trim() !== 'all'
    ) {
      query = query.eq('branch_id', Number(options.branchId))
    }

    if (rangeStart) {
      query = query.gte('created_at', rangeStart.toISOString())
    }

    if (rangeEnd) {
      query = query.lte('created_at', rangeEnd.toISOString())
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    return Array.isArray(data) ? data : []
  } catch (error) {
    if (isMissingSupabaseResourceError(error)) {
      return []
    }

    throw createSupabaseServiceError(
      error,
      'Inventory movement records could not be loaded from Supabase.',
    )
  }
}

function getProductBranchKey(productId, branchId, productName = '') {
  const normalizedBranchId =
    branchId != null && String(branchId).trim() !== ''
      ? String(branchId).trim()
      : 'unassigned'

  if (productId != null && String(productId).trim() !== '') {
    return `${normalizedBranchId}:product:${String(productId).trim()}`
  }

  return `${normalizedBranchId}:name:${String(productName || '').trim().toLowerCase()}`
}

function buildInventoryLookup(inventoryItems = []) {
  return inventoryItems.reduce((lookup, item) => {
    const key = getProductBranchKey(
      item.product_id ?? item.id,
      item.branch_id,
      item.product_name,
    )

    lookup.set(key, {
      branchId: item.branch_id ?? null,
      branchName: item.branch_name || item.branch || 'Unassigned Branch',
      currentStock: Number(item.stock_quantity || 0),
      productId: item.product_id ?? item.id ?? null,
      productName: item.product_name || 'Unknown Product',
    })

    return lookup
  }, new Map())
}

function ensureMetricRow(metricMap, rowIdentity, periodType, dateFrom, dateTo) {
  const key = getProductBranchKey(
    rowIdentity.productId,
    rowIdentity.branchId,
    rowIdentity.productName,
  )
  const existingRow = metricMap.get(key)

  if (existingRow) {
    return existingRow
  }

  const row = {
    id: key,
    productId: rowIdentity.productId ?? null,
    productName: rowIdentity.productName || 'Unknown Product',
    branchId: rowIdentity.branchId ?? null,
    branch: rowIdentity.branchName || 'Unassigned Branch',
    openingStock: 0,
    currentStock: 0,
    quantitySold: 0,
    quantityDeducted: 0,
    totalSalesAmount: 0,
    periodType: getPeriodLabel(periodType),
    dateRange: getDateRangeLabel(dateFrom, dateTo),
    netMovement: 0,
    movementDeducted: 0,
    hasMovementData: false,
  }

  metricMap.set(key, row)
  return row
}

function mergeInventoryIntoMetricRows(metricMap, inventoryLookup) {
  inventoryLookup.forEach((inventoryItem, key) => {
    const row = metricMap.get(key)

    if (!row) {
      return
    }

    row.productName = inventoryItem.productName || row.productName
    row.branch = inventoryItem.branchName || row.branch
    row.currentStock = inventoryItem.currentStock
  })
}

function applySalesToMetricRows(metricMap, sales, periodType, dateFrom, dateTo) {
  sales.forEach((sale) => {
    ;(sale.items || [])
      .filter((item) => !isServiceFeeLineItem(item))
      .forEach((item) => {
        const row = ensureMetricRow(
          metricMap,
          {
            branchId: sale.branch_id ?? null,
            branchName: sale.branch_name || 'Unassigned Branch',
            productId: item.product_id ?? null,
            productName: item.item_name || 'Unknown Product',
          },
          periodType,
          dateFrom,
          dateTo,
        )

        row.quantitySold += Number(item.quantity || 0)
        row.totalSalesAmount += Number(item.line_total || 0)
      })
  })
}

function applyMovementsToMetricRows(
  metricMap,
  movements,
  inventoryLookup,
  periodType,
  dateFrom,
  dateTo,
) {
  movements.forEach((movement) => {
    const movementKey = getProductBranchKey(
      movement.product_id,
      movement.branch_id,
    )
    const inventoryItem = inventoryLookup.get(movementKey)
    const row = ensureMetricRow(
      metricMap,
      {
        branchId: movement.branch_id ?? inventoryItem?.branchId ?? null,
        branchName: inventoryItem?.branchName || 'Unassigned Branch',
        productId: movement.product_id ?? inventoryItem?.productId ?? null,
        productName:
          inventoryItem?.productName ||
          (movement.product_id != null ? `Product #${movement.product_id}` : 'Unknown Product'),
      },
      periodType,
      dateFrom,
      dateTo,
    )
    const quantityDelta = Number(movement.quantity_delta || 0)

    row.hasMovementData = true
    row.netMovement += quantityDelta

    if (
      String(movement.movement_type || '').trim().toLowerCase() === 'sale' &&
      quantityDelta < 0
    ) {
      row.movementDeducted += Math.abs(quantityDelta)
    }
  })
}

function finalizeMetricRows(metricMap, inventoryLookup) {
  mergeInventoryIntoMetricRows(metricMap, inventoryLookup)

  return Array.from(metricMap.values())
    .filter((row) => row.quantitySold > 0 || row.movementDeducted > 0)
    .map((row) => {
      const quantityDeducted =
        row.movementDeducted > 0 ? row.movementDeducted : row.quantitySold
      const openingStock = row.hasMovementData
        ? row.currentStock - row.netMovement
        : row.currentStock + quantityDeducted

      return {
        id: row.id,
        productName: row.productName,
        branch: row.branch,
        openingStock: Math.max(0, Number(openingStock || 0)),
        currentStock: Math.max(0, Number(row.currentStock || 0)),
        quantityDeducted,
        quantitySold: row.quantitySold,
        totalSalesAmount: row.totalSalesAmount,
        totalSalesAmountLabel: peso(row.totalSalesAmount),
        periodType: row.periodType,
        dateRange: row.dateRange,
      }
    })
    .sort(
      (left, right) =>
        right.quantityDeducted - left.quantityDeducted ||
        right.totalSalesAmount - left.totalSalesAmount ||
        left.productName.localeCompare(right.productName, 'en', { sensitivity: 'base' }),
    )
}

async function buildSalesInventoryMetrics(options = {}, inventoryItems = []) {
  const dateFrom = options.dateFrom || ''
  const dateTo = options.dateTo || ''
  const periodType = options.periodType || REPORT_PERIOD_DAILY
  const [sales, movements] = await Promise.all([
    getSalesRecords(options),
    getInventoryMovementsForRange(options),
  ])
  const inventoryLookup = buildInventoryLookup(inventoryItems)
  const metricMap = new Map()

  applySalesToMetricRows(metricMap, sales, periodType, dateFrom, dateTo)
  applyMovementsToMetricRows(
    metricMap,
    movements,
    inventoryLookup,
    periodType,
    dateFrom,
    dateTo,
  )

  const rows = finalizeMetricRows(metricMap, inventoryLookup)
  const saleSummary = summarizeSales(sales)

  return {
    dateFrom,
    dateTo,
    periodType,
    periodLabel: getPeriodLabel(periodType),
    dateRangeLabel: getDateRangeLabel(dateFrom, dateTo),
    totalSales: saleSummary.totalSales,
    transactionCount: saleSummary.transactionCount,
    itemsSold: saleSummary.itemsSold,
    itemsDeducted: rows.reduce(
      (total, row) => total + Number(row.quantityDeducted || 0),
      0,
    ),
    rows,
  }
}

function buildTopItems(sales) {
  const itemMap = new Map()

  sales.forEach((sale) => {
    ;(sale.items || [])
      .filter((item) => !isServiceFeeLineItem(item))
      .forEach((item) => {
        const itemName = String(item.item_name || 'Unknown Item').trim() || 'Unknown Item'
        const itemKey = itemName.toLowerCase()
        const existingItem = itemMap.get(itemKey) || {
          id: `local-${itemKey}`,
          item: itemName,
          sold: 0,
          revenue: 0,
        }

        existingItem.sold += Number(item.quantity || 0)
        existingItem.revenue += Number(item.line_total || 0)
        itemMap.set(itemKey, existingItem)
      })
  })

  return Array.from(itemMap.values())
    .sort((left, right) => right.sold - left.sold)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      revenue: peso(item.revenue),
    }))
}

function buildCashierPerformance(sales) {
  const cashierMap = new Map()

  sales.forEach((sale) => {
    const cashierName =
      String(sale.cashier_name || '').trim() || 'Unknown Cashier'
    const cashierKey = cashierName.toLowerCase()
    const existingCashier = cashierMap.get(cashierKey) || {
      id: `cashier-${cashierKey}`,
      cashier: cashierName,
      sales: 0,
      transactions: 0,
    }

    existingCashier.sales += Number(sale.total_amount || 0)
    existingCashier.transactions += 1
    cashierMap.set(cashierKey, existingCashier)
  })

  return Array.from(cashierMap.values())
    .sort((left, right) => right.sales - left.sales)
    .map((cashier) => ({
      ...cashier,
      sales: peso(cashier.sales),
    }))
}

function buildLowStockRows(inventoryItems) {
  return inventoryItems
    .filter((item) => isLowStock(item))
    .sort(
      (left, right) =>
        Number(left.stock_quantity) - Number(right.stock_quantity),
    )
    .map((item) => {
      const shortage = Number(item.reorder_level) - Number(item.stock_quantity)
      const status =
        Number(item.stock_quantity) <= Math.max(1, Number(item.reorder_level) / 2)
          ? 'Critical'
          : shortage > 0
            ? 'Reorder Soon'
            : 'Low Stock'

      return {
        id: item.id,
        item: item.product_name,
        stock: item.stock_quantity,
        reorderLevel: item.reorder_level,
        status,
      }
    })
}

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + Number(days || 0))
  return nextDate
}

function getSalesVelocityDateRange(referenceDate = new Date()) {
  const endDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  const startDate = addDays(endDate, -(SALES_VELOCITY_WINDOW_DAYS - 1))

  return {
    dateFrom: formatDateInput(startDate),
    dateTo: formatDateInput(endDate),
  }
}

function getSaleItemProductKey(item = {}) {
  const productId = item.product_id ?? item.productId ?? null

  if (productId != null) {
    return `product:${productId}`
  }

  return `name:${String(item.item_name || item.name || '').trim().toLowerCase()}`
}

function getInventoryProductKey(item = {}) {
  const productId = item.product_id ?? item.productId ?? item.id ?? null

  if (productId != null) {
    return `product:${productId}`
  }

  return `name:${String(item.product_name || item.product || '').trim().toLowerCase()}`
}

function getInventoryProductNameKey(item = {}) {
  return `name:${String(item.product_name || item.product || '').trim().toLowerCase()}`
}

function buildSalesVelocityMap(sales, windowDays = SALES_VELOCITY_WINDOW_DAYS) {
  const velocityMap = new Map()

  sales.forEach((sale) => {
    ;(sale.items || [])
      .filter((item) => !isServiceFeeLineItem(item))
      .forEach((item) => {
        const itemKey = getSaleItemProductKey(item)

        if (!itemKey || itemKey === 'name:') {
          return
        }

        const existingItem = velocityMap.get(itemKey) || {
          id: itemKey,
          item: String(item.item_name || item.name || 'Unknown Item').trim() || 'Unknown Item',
          sold: 0,
          revenue: 0,
        }

        existingItem.sold += Number(item.quantity || 0)
        existingItem.revenue += Number(item.line_total || 0)
        velocityMap.set(itemKey, existingItem)
      })
  })

  velocityMap.forEach((item) => {
    item.averageDailySales = Number(item.sold || 0) / windowDays
  })

  return velocityMap
}

function buildSalesVelocityRows(velocityMap) {
  return Array.from(velocityMap.values())
    .sort((left, right) => right.sold - left.sold)
    .map((item) => ({
      ...item,
      averageDailySales: item.averageDailySales.toFixed(2),
      revenue: peso(item.revenue),
    }))
}

function formatDaysLeft(days) {
  if (days < 0) {
    const expiredDays = Math.abs(days)
    return `${expiredDays} day${expiredDays === 1 ? '' : 's'} expired`
  }

  if (days === 0) {
    return 'Today'
  }

  return `${days} day${days === 1 ? '' : 's'}`
}

function buildPredictiveStockoutAlerts(inventoryItems, velocityMap) {
  const today = new Date()

  return inventoryItems
    .map((item) => {
      const velocity =
        velocityMap.get(getInventoryProductKey(item)) ||
        velocityMap.get(getInventoryProductNameKey(item))
      const averageDailySales = Number(velocity?.averageDailySales || 0)

      if (averageDailySales <= 0) {
        return null
      }

      const currentStock = Math.max(0, Number(item.stock_quantity || 0))
      const estimatedDaysBeforeStockout = currentStock / averageDailySales
      const roundedDaysBeforeStockout = Math.ceil(estimatedDaysBeforeStockout)
      const estimatedStockoutDate = formatDateInput(
        addDays(today, roundedDaysBeforeStockout),
      )
      const isBelowReorderLevel =
        currentStock <= Number(item.reorder_level || 0)

      if (
        roundedDaysBeforeStockout > STOCKOUT_ALERT_DAYS &&
        !isBelowReorderLevel
      ) {
        return null
      }

      return {
        id: `stockout-${item.product_id ?? item.id}`,
        item: item.product_name,
        stock: currentStock,
        averageDailySales: averageDailySales.toFixed(2),
        estimatedDaysBeforeStockout: formatDaysLeft(roundedDaysBeforeStockout),
        estimatedStockoutDate: shortDate(estimatedStockoutDate),
        status:
          currentStock === 0
            ? 'Out of Stock'
            : roundedDaysBeforeStockout <= 7
              ? 'Critical'
              : isBelowReorderLevel
                ? 'Reorder'
                : 'Watch',
        days_before_stockout: roundedDaysBeforeStockout,
      }
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.days_before_stockout - right.days_before_stockout ||
        Number(left.stock) - Number(right.stock),
    )
}

function buildNearExpiryAlerts(inventoryItems) {
  const rows = []

  inventoryItems.forEach((item) => {
    const availableBatches = Array.isArray(item.batches)
      ? item.batches.filter(
          (batch) =>
            Number(batch.quantity_on_hand || 0) > 0 &&
            String(batch.expiration_date || '').trim() !== '',
        )
      : []

    if (availableBatches.length > 0) {
      availableBatches.forEach((batch) => {
        const daysToExpiry = Number(batch.days_to_expiry)

        if (
          !Number.isFinite(daysToExpiry) ||
          daysToExpiry > NEAR_EXPIRY_ALERT_DAYS
        ) {
          return
        }

        rows.push({
          id: `expiry-${item.product_id ?? item.id}-${batch.id}`,
          item: item.product_name,
          batch: batch.batch_code || `Batch ${batch.id}`,
          expiryDate: shortDate(batch.expiration_date),
          daysToExpiry: formatDaysLeft(daysToExpiry),
          stock: batch.quantity_on_hand,
          status:
            daysToExpiry < 0
              ? 'Expired'
              : daysToExpiry <= 7
                ? 'Critical'
                : 'Near Expiry',
          days_to_expiry: daysToExpiry,
        })
      })

      return
    }

    const fallbackDaysToExpiry = Number(item.days_to_expiry)

    if (
      Number.isFinite(fallbackDaysToExpiry) &&
      fallbackDaysToExpiry <= NEAR_EXPIRY_ALERT_DAYS &&
      Number(item.stock_quantity || 0) > 0
    ) {
      rows.push({
        id: `expiry-${item.product_id ?? item.id}`,
        item: item.product_name,
        batch: 'Product date',
        expiryDate: shortDate(item.expiration_date || item.expiry_date),
        daysToExpiry: formatDaysLeft(fallbackDaysToExpiry),
        stock: item.stock_quantity,
        status:
          fallbackDaysToExpiry < 0
            ? 'Expired'
            : fallbackDaysToExpiry <= 7
              ? 'Critical'
              : 'Near Expiry',
        days_to_expiry: fallbackDaysToExpiry,
      })
    }
  })

  return rows.sort(
    (left, right) =>
      left.days_to_expiry - right.days_to_expiry ||
      Number(left.stock) - Number(right.stock),
  )
}

export async function getReportSnapshot(options = {}) {
  const cachedSnapshot = getCachedReportSnapshot(options)

  if (cachedSnapshot) {
    return cachedSnapshot
  }

  const selectedPeriodType = options.periodType || REPORT_PERIOD_DAILY
  const inventoryResponse = await getInventoryItems({
    branchId: options.branchId,
  })
  const inventorySnapshot = inventoryResponse.items || inventoryResponse
  const lowStockRows = buildLowStockRows(inventorySnapshot)
  const selectedMetrics = await buildSalesInventoryMetrics(
    {
      ...options,
      periodType: selectedPeriodType,
    },
    inventorySnapshot,
  )
  const salesHistory = await getSalesRecords(options)
  const standardPeriodMetricsEntries = await Promise.all(
    reportPeriodOptions.map(async (periodOption) => {
      const periodRange = getReportPeriodDateRange(periodOption.value)
      const metrics = await buildSalesInventoryMetrics(
        {
          ...options,
          ...periodRange,
          periodType: periodOption.value,
        },
        inventorySnapshot,
      )

      return [periodOption.value, metrics]
    }),
  )
  const standardPeriodMetrics = Object.fromEntries(standardPeriodMetricsEntries)
  const velocityDateRange = getSalesVelocityDateRange()
  const salesVelocityHistory = await getSalesRecords({
    branchId: options.branchId,
    user: options.user,
    dateFrom: velocityDateRange.dateFrom,
    dateTo: velocityDateRange.dateTo,
  })
  const salesVelocityMap = buildSalesVelocityMap(salesVelocityHistory)
  const predictiveStockoutRows = buildPredictiveStockoutAlerts(
    inventorySnapshot,
    salesVelocityMap,
  )
  const nearExpiryRows = buildNearExpiryAlerts(inventorySnapshot)

  return setCachedResource(getReportCacheKey(options), {
    summary: {
      total_sales: selectedMetrics.totalSales,
      transaction_count: selectedMetrics.transactionCount,
      items_sold: selectedMetrics.itemsSold,
      items_deducted: selectedMetrics.itemsDeducted,
      daily_sales: standardPeriodMetrics.daily?.totalSales || 0,
      daily_items_sold: standardPeriodMetrics.daily?.itemsSold || 0,
      daily_items_deducted: standardPeriodMetrics.daily?.itemsDeducted || 0,
      weekly_sales: standardPeriodMetrics.weekly?.totalSales || 0,
      weekly_items_sold: standardPeriodMetrics.weekly?.itemsSold || 0,
      weekly_items_deducted: standardPeriodMetrics.weekly?.itemsDeducted || 0,
      monthly_sales: standardPeriodMetrics.monthly?.totalSales || 0,
      monthly_items_sold: standardPeriodMetrics.monthly?.itemsSold || 0,
      monthly_items_deducted: standardPeriodMetrics.monthly?.itemsDeducted || 0,
      low_stock_count: lowStockRows.length,
      predictive_stockout_count: predictiveStockoutRows.length,
      near_expiry_count: nearExpiryRows.length,
    },
    metricsRows: selectedMetrics.rows,
    periodMetrics: standardPeriodMetrics,
    selectedPeriod: selectedMetrics,
    topItems: buildTopItems(salesHistory),
    lowStock: lowStockRows,
    salesVelocity: buildSalesVelocityRows(salesVelocityMap),
    predictiveStockout: predictiveStockoutRows,
    nearExpiry: nearExpiryRows,
    salesVelocityWindowDays: SALES_VELOCITY_WINDOW_DAYS,
    cashierPerformance: buildCashierPerformance(salesHistory),
  })
}
