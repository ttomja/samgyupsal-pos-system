import EmptyState from '../../../shared/components/common/EmptyState'
import { peso } from '../../../shared/utils/formatters'

function normalizeProductValue(value) {
  const normalizedValue = String(value ?? '').trim()
  return normalizedValue === '-' ? '' : normalizedValue
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

function ProductGrid({ products, cart = [], setCart, onProductAdded }) {
  const cartQuantityByProductId = new Map(
    cart.map((item) => [String(item.id), Number(item.quantity || 0)]),
  )

  const addToCart = (product) => {
    if (product.isSellable === false) {
      return
    }

    const availableStock = Number(product.stockQuantity)
    const quantityAlreadyInCart =
      cartQuantityByProductId.get(String(product.id)) || 0

    if (Number.isFinite(availableStock) && quantityAlreadyInCart >= availableStock) {
      return
    }

    setCart((previousCart) => {
      const existingItem = previousCart.find((item) => item.id === product.id)

      if (existingItem) {
        if (
          Number.isFinite(availableStock) &&
          Number(existingItem.quantity || 0) >= availableStock
        ) {
          return previousCart
        }

        return previousCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        )
      }

      return [...previousCart, { ...product, quantity: 1 }]
    })

    onProductAdded?.(product)
  }

  if (products.length === 0) {
    return (
      <EmptyState
        title="No products found"
        description="Try another keyword or switch to a different category."
      />
    )
  }

  return (
    <div className="product-grid">
      {products.map((product) => {
        const availableStock = Number(product.stockQuantity)
        const quantityInCart =
          cartQuantityByProductId.get(String(product.id)) || 0
        const remainingStock = Number.isFinite(availableStock)
          ? Math.max(0, availableStock - quantityInCart)
          : null
        const isOutOfStock = remainingStock === 0
        const isPriceNotSet = product.availabilityReason === 'Price not set'
        const isUnavailable = product.isSellable === false || isOutOfStock
        const unitValue = normalizeProductValue(product.unit)
        const categoryValue = normalizeProductValue(product.category) || 'Uncategorized'
        const qualityFlags = [
          unitValue ? null : 'Missing unit',
          isPriceNotSet ? 'Needs price' : null,
          product.hasExpiredBlockingBatch ? 'Expired' : null,
          isOutOfStock ? 'No stock' : null,
        ].filter(Boolean)
        const stockLabel = product.isSellable === false && !isPriceNotSet
          ? product.availabilityReason || 'Unavailable'
          : isPriceNotSet
            ? 'Price not set'
          : remainingStock == null
            ? 'Stock pending'
            : remainingStock === 0
              ? 'Out of stock'
              : `${remainingStock} left`
        const availabilityLabel = isPriceNotSet
          ? 'Needs price'
          : isUnavailable
          ? stockLabel
          : quantityInCart > 0
            ? `${quantityInCart} in cart`
            : 'Ready'
        const cardClassName = [
          'product-card',
          isUnavailable ? 'product-card-disabled' : '',
          isPriceNotSet ? 'product-card--needs-review' : '',
          quantityInCart > 0 ? 'product-card--in-cart' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={product.id}
            type="button"
            className={cardClassName}
            onClick={() => addToCart(product)}
            disabled={isUnavailable}
          >
            <span className="product-card-topline">
              <span className="product-card-mark" aria-hidden="true">
                {getProductInitials(product.name)}
              </span>
              <span
                className={
                  isUnavailable || isPriceNotSet
                    ? 'product-card-state product-card-state--attention'
                    : 'product-card-state'
                }
              >
                {availabilityLabel}
              </span>
            </span>

            <span className="product-category">{categoryValue}</span>
            <strong className="product-card-name" title={product.name || undefined}>
              {product.name}
            </strong>

            <span className="product-card-metrics">
              <span
                className={
                  isPriceNotSet
                    ? 'product-card-metric product-card-metric--attention'
                    : 'product-card-metric'
                }
              >
                <small>Price</small>
                <strong>{peso(product.price)}</strong>
              </span>
              <span
                className={
                  isOutOfStock
                    ? 'product-card-metric product-card-metric--attention'
                    : 'product-card-metric'
                }
              >
                <small>Stock</small>
                <strong>{remainingStock == null ? 'Pending' : remainingStock}</strong>
              </span>
            </span>

            <span className="product-card-support">
              <span title={unitValue ? `Unit: ${unitValue}` : 'Unit is not filled yet'}>
                {unitValue || 'Unit pending'}
              </span>
            </span>

            {qualityFlags.length > 0 ? (
              <span className="product-card-quality-flags">
                {qualityFlags.map((flag) => (
                  <span key={flag} className="product-card-quality-flag">
                    {flag}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export default ProductGrid
