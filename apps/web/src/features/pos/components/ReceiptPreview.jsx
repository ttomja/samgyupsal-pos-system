import { peso, shortDateTime } from '../../../shared/utils/formatters'
import '../styles/receipt.css'

function ReceiptPreview({ receipt, onClose, showActions = true }) {
  if (!receipt) {
    return null
  }

  const receiptItems = Array.isArray(receipt.items) ? receipt.items : []
  const recordedItemsLabel = `${receiptItems.length} line item${receiptItems.length === 1 ? '' : 's'}`
  const receiptNotes = [
    `Payment method: ${receipt.paymentMethodLabel || 'Cash'}`,
  ]

  if (receipt.discountTypeLabel && Number(receipt.discount || 0) > 0) {
    receiptNotes.push(`Discount type: ${receipt.discountTypeLabel}`)
  }

  if (receipt.notes) {
    receiptNotes.push(`Notes: ${receipt.notes}`)
  }

  return (
    <div className="receipt-preview">
      <article className="receipt-card">
        <div className="receipt-card-inner">
          <header className="receipt-card-header">
            <div className="receipt-card-copy">
              <p className="receipt-card-kicker">Sales Receipt</p>
              <h3>Completed Transaction Review</h3>
              <p className="receipt-card-description">
                Verify the recorded sale, line items, and totals from a receipt-first view.
              </p>
            </div>

            <div className="receipt-card-reference">
              <span>Transaction ID</span>
              <strong>{receipt.transactionNumber}</strong>
            </div>
          </header>

          <section className="receipt-meta-grid" aria-label="Receipt metadata">
            <article className="receipt-meta-card">
              <span>Cashier</span>
              <strong>{receipt.cashierName || 'Unknown Cashier'}</strong>
            </article>
            <article className="receipt-meta-card">
              <span>Branch</span>
              <strong>{receipt.branchName || 'All Branches'}</strong>
            </article>
            <article className="receipt-meta-card">
              <span>Recorded At</span>
              <strong>{shortDateTime(receipt.issuedAt)}</strong>
            </article>
            <article className="receipt-meta-card">
              <span>Receipt Lines</span>
              <strong>{recordedItemsLabel}</strong>
            </article>
          </section>

          <section className="receipt-section" aria-label="Purchased items">
            <div className="receipt-section-header">
              <h4>Purchased Items</h4>
              <span>{recordedItemsLabel}</span>
            </div>

            {receiptItems.length > 0 ? (
              <div className="receipt-item-list">
                {receiptItems.map((item) => (
                  <div key={item.id} className="receipt-item-row">
                    <div className="receipt-item-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {`${item.quantity} x ${peso(item.unitPrice)}`}
                        {item.isServiceFee ? ' service fee' : ''}
                      </span>
                    </div>
                    <div className="receipt-item-total">{peso(item.lineTotal)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="receipt-empty-copy">
                No line items were recorded for this transaction.
              </p>
            )}
          </section>

          <section className="receipt-summary-card" aria-label="Receipt totals">
            <div className="receipt-summary-row">
              <span>Subtotal</span>
              <strong>{peso(receipt.subtotal)}</strong>
            </div>
            <div className="receipt-summary-row">
              <span>Service Fees</span>
              <strong>{peso(receipt.serviceFeeTotal)}</strong>
            </div>
            <div className="receipt-summary-row">
              <span>Discount</span>
              <strong>{peso(receipt.discount)}</strong>
            </div>
            <div className="receipt-summary-row receipt-summary-row--total">
              <span>Total</span>
              <strong>{peso(receipt.total)}</strong>
            </div>
            <div className="receipt-summary-row">
              <span>Cash Received</span>
              <strong>{peso(receipt.cashReceived)}</strong>
            </div>
            <div className="receipt-summary-row">
              <span>Change</span>
              <strong>{peso(receipt.change)}</strong>
            </div>
          </section>

          <section className="receipt-notes" aria-label="Receipt notes">
            <strong>Transaction Notes</strong>
            <p>{receiptNotes.join(' | ')}</p>
          </section>
        </div>
      </article>

      {showActions ? (
        <div className="receipt-actions">
          <button
            type="button"
            className="ghost-action"
            onClick={onClose}
          >
            Close Receipt
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default ReceiptPreview
