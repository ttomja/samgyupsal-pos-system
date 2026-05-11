import { useMemo, useState } from 'react'
import NoticeBanner from '../../../shared/components/common/NoticeBanner'
import Modal from '../../../shared/components/ui/Modal'
import SelectMenu from '../../../shared/components/ui/SelectMenu'
import ReceiptPreview from './ReceiptPreview'
import useAuth from '../../auth/hooks/useAuth'
import {
  buildServiceFeeLineItems,
  normalizeServiceFeeQuantities,
  serviceFeeOptions,
} from '../utils/serviceFees'
import {
  calculateDiscountAmount,
  DEFAULT_DISCOUNT_TYPE,
  discountOptions,
  getDiscountConfig,
} from '../utils/discounts'
import {
  buildSaleLineItems,
  createSale,
  paymentMethods,
} from '../services/salesService'
import { peso } from '../../../shared/utils/formatters'
import {
  getFirstValidationError,
  validateCheckout,
} from '../../../shared/utils/validation'

function PaymentPanel({
  cart,
  setCart,
  onOrderComplete,
  transactionNumber,
  branchId = null,
  branchName = '',
}) {
  const { user } = useAuth()
  const [discountType, setDiscountType] = useState(DEFAULT_DISCOUNT_TYPE)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [selectedServiceFees, setSelectedServiceFees] = useState({})
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState('info')
  const [submitting, setSubmitting] = useState(false)
  const [lastReceipt, setLastReceipt] = useState(null)
  const [isReceiptOpen, setIsReceiptOpen] = useState(false)
  const [heldOrder, setHeldOrder] = useState(null)

  const getUnitPrice = (item) => {
    const unitPrice = Number(item?.price ?? item?.unit_price ?? item?.unitPrice ?? 0)
    return Number.isFinite(unitPrice) ? unitPrice : 0
  }

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + getUnitPrice(item) * Number(item.quantity || 0),
        0,
      ),
    [cart],
  )
  const selectedFeeLineItems = useMemo(
    () => buildServiceFeeLineItems(selectedServiceFees),
    [selectedServiceFees],
  )
  const serviceFeeTotal = useMemo(
    () =>
      selectedFeeLineItems.reduce(
        (sum, item) => sum + Number(item.line_total || 0),
        0,
      ),
    [selectedFeeLineItems],
  )
  const saleLineItems = useMemo(
    () => buildSaleLineItems(cart, selectedFeeLineItems),
    [cart, selectedFeeLineItems],
  )

  const numericDiscount = useMemo(
    () => calculateDiscountAmount(subtotal, discountType),
    [subtotal, discountType],
  )
  const total = Math.max(0, subtotal + serviceFeeTotal - numericDiscount)
  const change = Number(cashReceived || 0) - total

  const resetPanel = () => {
    setDiscountType(DEFAULT_DISCOUNT_TYPE)
    setPaymentMethod('cash')
    setCashReceived('')
    setSelectedServiceFees({})
  }

  const clearStatusMessage = () => {
    if (!message) {
      return
    }

    setMessage('')
    setMessageTone('info')
  }

  const handleClear = () => {
    if (!cart.length) {
      setMessage('Cart is already empty.')
      setMessageTone('warning')
      return
    }

    setCart([])
    resetPanel()
    setMessage('Cart cleared.')
    setMessageTone('info')
  }

  const handleHold = () => {
    if (!cart.length) {
      setMessage('Cart is empty.')
      setMessageTone('warning')
      return
    }

    if (heldOrder) {
      setMessage('Restore or clear the current held order before placing another one on hold.')
      setMessageTone('warning')
      return
    }

    const heldOrderSnapshot = {
      branchId,
      branchName: branchName || user?.branchName || 'All Branches',
      cashReceived,
      cart: cart.map((item) => ({ ...item })),
      discountType,
      heldAt: new Date().toISOString(),
      paymentMethod,
      selectedServiceFees: { ...selectedServiceFees },
    }

    setHeldOrder(heldOrderSnapshot)
    setCart([])
    resetPanel()
    setMessage(
      `Order placed on hold for ${heldOrderSnapshot.branchName}. Restore it when the guest is ready.`,
    )
    setMessageTone('info')
  }

  const handleRestoreHeldOrder = () => {
    if (!heldOrder) {
      return
    }

    if (cart.length > 0) {
      setMessage('Clear or checkout the current cart before restoring the held order.')
      setMessageTone('warning')
      return
    }

    if (
      heldOrder.branchId != null &&
      branchId != null &&
      Number(heldOrder.branchId) !== Number(branchId)
    ) {
      setMessage(`Switch back to ${heldOrder.branchName} before restoring this held order.`)
      setMessageTone('warning')
      return
    }

    setCart(heldOrder.cart.map((item) => ({ ...item })))
    setDiscountType(heldOrder.discountType || DEFAULT_DISCOUNT_TYPE)
    setPaymentMethod(heldOrder.paymentMethod)
    setCashReceived(heldOrder.cashReceived)
    setSelectedServiceFees(normalizeServiceFeeQuantities(heldOrder.selectedServiceFees))
    setHeldOrder(null)
    setMessage('Held order restored.')
    setMessageTone('success')
  }

  const handleDiscardHeldOrder = () => {
    if (!heldOrder) {
      return
    }

    setHeldOrder(null)
    setMessage('Held order cleared.')
    setMessageTone('info')
  }

  const handleAdjustServiceFee = (feeValue, delta) => {
    clearStatusMessage()
    setSelectedServiceFees((currentValue) => {
      const currentQuantity = Number(currentValue?.[feeValue] || 0)
      const nextQuantity = Math.max(0, currentQuantity + Number(delta || 0))

      if (nextQuantity <= 0) {
        const nextValue = { ...(currentValue || {}) }
        delete nextValue[feeValue]
        return nextValue
      }

      return {
        ...(currentValue || {}),
        [feeValue]: nextQuantity,
      }
    })
  }

  const handleCheckout = async () => {
    if (!user?.id) {
      setMessage('Logged-in cashier id is missing.')
      setMessageTone('error')
      return
    }

    const unavailableCartItem = cart.find((item) => item.isSellable === false)

    if (unavailableCartItem) {
      setMessage(
        `${unavailableCartItem.name || 'This item'} cannot be sold${
          unavailableCartItem.availabilityReason
            ? ` because it is ${String(unavailableCartItem.availabilityReason).toLowerCase()}`
            : ''
        }. Remove it from the cart to continue.`,
      )
      setMessageTone('error')
      return
    }

    const validation = validateCheckout({
      paymentMethod,
      amountReceived: cashReceived,
      totalAmount: total,
      subtotalAmount: subtotal,
      discount: numericDiscount,
      cartItems: cart,
    })

    if (!validation.isValid) {
      setMessage(getFirstValidationError(validation.errors))
      setMessageTone('error')
      return
    }

    const payload = {
      cashier_id: user?.id,
      payment_method: paymentMethod,
      subtotal,
      discount: numericDiscount,
      total_amount: total,
      cash_received: Number(cashReceived || 0),
      change_amount: paymentMethod === 'cash' ? change : 0,
      items: saleLineItems.map((item) => ({
        product_id: item.product_id,
        inventory_item_id: item.inventory_item_id ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    }

    const receiptSnapshot = {
      transactionNumber,
      cashierName: user?.name || 'Admin User',
      branchName: branchName || user?.branchName || 'All Branches',
      issuedAt: new Date().toISOString(),
      paymentMethodLabel:
        paymentMethods.find((method) => method.value === paymentMethod)?.label ||
        'Cash',
      subtotal,
      serviceFeeTotal,
      discount: numericDiscount,
      discountTypeLabel: getDiscountConfig(discountType).label,
      total,
      cashReceived: Number(cashReceived || 0),
      change: paymentMethod === 'cash' ? Math.max(0, change) : 0,
      items: saleLineItems.map((item, index) => ({
        id: item.product_id ?? `service-fee-${index + 1}`,
        name: item.item_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        isServiceFee: item.is_service_fee === true,
      })),
    }

    try {
      setSubmitting(true)
      const result = await createSale(payload, {
        cashierName: user?.name,
        branchId: branchId ?? user?.branchId,
        branchName: branchName || user?.branchName,
        transactionNumber,
        discountType,
        items: saleLineItems,
      })
      setCart([])
      resetPanel()
      setLastReceipt(receiptSnapshot)
      setMessage(
        result.inventorySynced === false
          ? 'Sale recorded successfully. Reports were updated, but inventory was not adjusted automatically.'
          : 'Sale recorded successfully. Reports and inventory have been updated.',
      )
      setMessageTone(result.inventorySynced === false ? 'warning' : 'success')
      onOrderComplete?.('checkout', {
        inventorySynced: result.inventorySynced,
        soldItems: cart.map((item) => ({
          product_id: item.product_id ?? item.productId ?? item.id ?? null,
          inventory_item_id:
            item.inventory_item_id ?? item.inventoryItemId ?? item.id ?? null,
          quantity: item.quantity,
          unit_price: getUnitPrice(item),
        })),
      })
    } catch (error) {
      setMessage(error.response?.data?.message || 'Checkout failed.')
      setMessageTone('error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="cart-summary">
      <div className="form-row">
        <label className="summary-field">
          <span>Discount Type</span>
          <SelectMenu
            className="summary-select-menu"
            value={discountType}
            onChange={(event) => {
              clearStatusMessage()
              setDiscountType(event.target.value)
            }}
            placeholder="Select discount type"
            aria-invalid={Boolean(message)}
            options={discountOptions}
          />
        </label>

        <label className="summary-field">
          <span>Payment Method</span>
          <SelectMenu
            className="summary-select-menu"
            value={paymentMethod}
            onChange={(event) => {
              clearStatusMessage()
              setPaymentMethod(event.target.value)
            }}
            aria-invalid={Boolean(message)}
            options={paymentMethods}
          />
        </label>
      </div>

      <label className="summary-field">
        <span>Cash Received</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={cashReceived}
          onChange={(event) => {
            clearStatusMessage()
            setCashReceived(event.target.value)
          }}
          placeholder="Enter amount received"
          aria-invalid={Boolean(message)}
        />
      </label>

      <div className="summary-field service-fee-fieldset">
        <span>Checkout Add-ons</span>
        <div className="service-fee-list">
          {serviceFeeOptions.map((feeOption) => {
            const selectedQuantity = Number(selectedServiceFees?.[feeOption.value] || 0)
            const isSelected = selectedQuantity > 0

            return (
              <div
                key={feeOption.value}
                className={
                  isSelected
                    ? 'service-fee-option service-fee-option-selected'
                    : 'service-fee-option'
                }
              >
                <div className="service-fee-copy">
                  <strong>{feeOption.label}</strong>
                  <span>{feeOption.note}</span>
                </div>
                <strong className="service-fee-amount">
                  {peso(feeOption.amount)}
                </strong>
                <div
                  className="service-fee-stepper"
                  aria-label={`${feeOption.label} quantity`}
                >
                  <button
                    type="button"
                    className="quantity-button"
                    onClick={() => handleAdjustServiceFee(feeOption.value, -1)}
                    disabled={selectedQuantity <= 0}
                    aria-label={`Decrease ${feeOption.label}`}
                  >
                    -
                  </button>
                  <span className="quantity-value">{selectedQuantity}</span>
                  <button
                    type="button"
                    className="quantity-button"
                    onClick={() => handleAdjustServiceFee(feeOption.value, 1)}
                    aria-label={`Increase ${feeOption.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="summary-row">
        <span>Subtotal</span>
        <strong>{peso(subtotal)}</strong>
      </div>
      <div className="summary-row">
        <span>Service Fees</span>
        <strong>{peso(serviceFeeTotal)}</strong>
      </div>
      <div className="summary-row">
        <span>Discount</span>
        <strong>{peso(numericDiscount)}</strong>
      </div>
      <div className="summary-row total-row">
        <span>Total</span>
        <strong>{peso(total)}</strong>
      </div>
      <div className="summary-row">
        <span>Change</span>
        <strong>{peso(paymentMethod === 'cash' ? Math.max(0, change) : 0)}</strong>
      </div>

      <div className="summary-actions">
        <button
          type="button"
          className="ghost-action"
          onClick={handleHold}
          disabled={submitting || cart.length === 0}
        >
          Hold
        </button>
        <button
          type="button"
          className="ghost-action"
          onClick={handleClear}
          disabled={submitting || cart.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="checkout-action"
          onClick={handleCheckout}
          disabled={submitting || cart.length === 0}
        >
          {submitting ? 'Submitting...' : 'Checkout'}
        </button>
      </div>

      <p className="supporting-text">
        {cart.length} item{cart.length === 1 ? '' : 's'} ready for checkout.
      </p>

      {message ? (
        <NoticeBanner
          variant={messageTone}
          title="Checkout"
          message={message}
        />
      ) : null}

      {heldOrder ? (
        <div className="receipt-launcher">
          <button
            type="button"
            className="ghost-action"
            onClick={handleRestoreHeldOrder}
          >
            Restore Held Order
          </button>
          <button
            type="button"
            className="ghost-action"
            onClick={handleDiscardHeldOrder}
          >
            Clear Held Order
          </button>
        </div>
      ) : null}

      {lastReceipt ? (
        <div className="receipt-launcher">
          <button
            type="button"
            className="ghost-action"
            onClick={() => setIsReceiptOpen(true)}
          >
            View Last Receipt
          </button>
        </div>
      ) : null}

      <Modal
        isOpen={isReceiptOpen}
        title="Receipt Preview"
        eyebrow="Sales Receipt"
        description="Preview the latest completed sale without changing the current checkout flow."
        onClose={() => setIsReceiptOpen(false)}
        width="520px"
      >
        <ReceiptPreview
          receipt={lastReceipt}
          onClose={() => setIsReceiptOpen(false)}
        />
      </Modal>
    </div>
  )
}

export default PaymentPanel
