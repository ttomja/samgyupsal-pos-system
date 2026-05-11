import EmptyState from '../../../shared/components/common/EmptyState'
import StatusBadge from '../../../shared/components/common/StatusBadge'
import { getInventoryStatus } from '../services/inventoryService'
import { peso, shortDate } from '../../../shared/utils/formatters'
import {
  getInventoryCategoryLabel,
  getInventoryCategoryValue,
} from '../utils/inventoryFilters'

const INVENTORY_EMPTY_VALUE = '\u2014'

function normalizeTableCellValue(value) {
  const normalizedValue = String(value ?? '').trim()
  return normalizedValue === '-' ? '' : normalizedValue
}

function hasInventoryValue(value) {
  return normalizeTableCellValue(value) !== ''
}

function isWeakUnitValue(unitValue, priceValue) {
  const normalizedUnitValue = normalizeTableCellValue(unitValue)
  const numericUnitValue = Number(normalizedUnitValue)

  return (
    /^\d+(\.\d+)?$/.test(normalizedUnitValue) &&
    Number.isFinite(numericUnitValue) &&
    numericUnitValue === Number(priceValue)
  )
}

function renderTableCellText(
  value,
  className = '',
  fallbackLabel = INVENTORY_EMPTY_VALUE,
) {
  const normalizedValue = normalizeTableCellValue(value)
  const resolvedClassName = normalizedValue
    ? `inventory-table-text ${className}`.trim()
    : `inventory-table-text inventory-table-text--placeholder ${className}`.trim()

  return (
    <span
      className={resolvedClassName}
      title={normalizedValue || fallbackLabel || undefined}
    >
      {normalizedValue || fallbackLabel}
    </span>
  )
}

function getProductInitials(value) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) {
    return 'PR'
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

function getStockTone(item) {
  const stockQuantity = Number(item?.stock_quantity || 0)
  const reorderLevel = Number(item?.reorder_level || 0)

  if (stockQuantity <= 0) {
    return 'empty'
  }

  if (stockQuantity <= reorderLevel) {
    return 'low'
  }

  return 'good'
}

function InventoryTable({
  items,
  canEditCatalog = true,
  canStockIn = true,
  canAdjustStock = true,
  onStockIn,
  onEdit,
  onAdjustStock,
  onRemove,
  emptyTitle = 'No inventory records match this filter',
  emptyDescription = 'Try switching the filter to view more stocked or expiring items.',
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div
      className="inventory-management-list"
      role="list"
      aria-label="Inventory product records"
    >
      {items.map((item) => {
        const status = getInventoryStatus(item)
        const categoryLabel = getInventoryCategoryLabel(getInventoryCategoryValue(item))
        const stockTone = getStockTone(item)
        const expiryDate = shortDate(item.expiry_date)
        const stockQuantity = Number(item.stock_quantity || 0)
        const priceValue = Number(item.price || 0)
        const hasUnitValue = hasInventoryValue(item.unit)
        const hasExpiryValue = hasInventoryValue(expiryDate)
        const hasPriceValue = priceValue > 0
        const shouldReviewUnit = isWeakUnitValue(item.unit, item.price)
        const qualityFlags = [
          hasUnitValue && !shouldReviewUnit ? null : shouldReviewUnit ? 'Review unit' : 'Missing unit',
          hasPriceValue ? null : 'Missing price',
          hasExpiryValue ? null : 'Missing expiry',
          stockQuantity > 0 ? null : 'No stock',
        ].filter(Boolean)
        const actionButtons = [
          canStockIn
            ? {
                key: 'stock-in',
                label: 'Stock In',
                onClick: () => onStockIn?.(item),
                variant: '',
              }
            : null,
          canEditCatalog
            ? {
                key: 'edit',
                label: 'Edit',
                onClick: () => onEdit?.(item),
                variant: '',
              }
            : null,
          canAdjustStock
            ? {
                key: 'adjust-stock',
                label: 'Adjust Stock',
                onClick: () => onAdjustStock?.(item),
                variant: '',
              }
            : null,
          canEditCatalog
            ? {
                key: 'remove',
                label: 'Remove',
                onClick: () => onRemove?.(item),
                variant: 'table-action-button-danger',
              }
            : null,
        ].filter(Boolean)

        return (
          <article
            key={item.id}
            className="inventory-product-row-card"
            role="listitem"
          >
            <div className="inventory-product-identity">
              <div className="inventory-product-mark" aria-hidden="true">
                {getProductInitials(item.product_name)}
              </div>

              <div className="inventory-product-title-block">
                <h3 title={item.product_name || undefined}>
                  {item.product_name || INVENTORY_EMPTY_VALUE}
                </h3>
                <p title={categoryLabel || undefined}>
                  {categoryLabel || INVENTORY_EMPTY_VALUE}
                </p>
                {qualityFlags.length > 0 ? (
                  <div
                    className="inventory-product-quality-flags"
                    aria-label="Product data review"
                  >
                    {qualityFlags.map((flag) => (
                      <span key={flag} className="inventory-product-quality-flag">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="inventory-product-stock-review">
              <div className={`inventory-stock-chip inventory-stock-chip--${stockTone}`}>
                <span>Stock</span>
                <strong>{stockQuantity}</strong>
              </div>
            </div>

            <div className="inventory-product-facts">
              <div
                className={
                  hasUnitValue && !shouldReviewUnit
                    ? 'inventory-product-detail'
                    : 'inventory-product-detail inventory-product-detail--attention'
                }
              >
                <span>Unit</span>
                {renderTableCellText(
                  shouldReviewUnit ? '' : item.unit,
                  'inventory-table-text--unit',
                  shouldReviewUnit ? 'Review unit' : 'Unit pending',
                )}
              </div>

              <div
                className={
                  hasPriceValue
                    ? 'inventory-product-detail'
                    : 'inventory-product-detail inventory-product-detail--attention'
                }
              >
                <span>Price</span>
                <strong className="inventory-product-price">
                  {peso(priceValue)}
                </strong>
              </div>

              <div
                className={
                  hasExpiryValue
                    ? 'inventory-product-detail'
                    : 'inventory-product-detail inventory-product-detail--attention'
                }
              >
                <span>Expiry</span>
                {renderTableCellText(
                  expiryDate,
                  'inventory-table-text--numeric',
                  'Date pending',
                )}
              </div>
            </div>

            <div className="inventory-product-state">
              <StatusBadge text={status.label} variant={status.tone} />
            </div>

            <div className="inventory-actions inventory-product-row-actions">
              {actionButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  className={
                    button.variant
                      ? `table-action-button ${button.variant}`
                      : 'table-action-button'
                  }
                  onClick={button.onClick}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default InventoryTable
