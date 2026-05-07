import { useMemo, useState } from 'react'
import EmptyState from '../../../shared/components/common/EmptyState'
import Loader from '../../../shared/components/common/Loader'
import NoticeBanner from '../../../shared/components/common/NoticeBanner'
import StatusBadge from '../../../shared/components/common/StatusBadge'
import Modal from '../../../shared/components/ui/Modal'
import { peso, shortDateTime } from '../../../shared/utils/formatters'
import ReceiptPreview from './ReceiptPreview'
import {
  copyTextToClipboard,
  downloadReceipt,
  printReceipt,
} from '../utils/receiptActions'
import {
  buildReceiptPreviewData,
  getSaleDiscountTypeLabel,
  getSaleItemCount,
  getSalePaymentMethodLabel,
  getSaleReference,
} from '../services/salesService'

function SalesHistoryDetailsModal({ sale, isOpen, onClose }) {
  const [actionNotice, setActionNotice] = useState(null)

  const detailState = useMemo(() => {
    if (!sale) {
      return {
        receipt: null,
        detailError: '',
        soldItemCount: 0,
        soldItems: [],
        serviceFeeItems: [],
      }
    }

    try {
      const receipt = buildReceiptPreviewData(sale)
      const soldItems = receipt.items.filter((item) => !item.isServiceFee)
      const serviceFeeItems = receipt.items.filter((item) => item.isServiceFee)

      return {
        receipt,
        detailError: '',
        soldItemCount: getSaleItemCount(sale),
        soldItems,
        serviceFeeItems,
      }
    } catch (error) {
      console.error('Failed to prepare transaction details:', error)

      return {
        receipt: null,
        detailError:
          'Transaction details could not be prepared right now. Please close this panel and try again.',
        soldItemCount: 0,
        soldItems: [],
        serviceFeeItems: [],
      }
    }
  }, [sale])

  if (!isOpen) {
    return null
  }

  if (!sale) {
    return (
      <Modal
        isOpen={isOpen}
        title="Transaction Details"
        eyebrow="Sales History"
        description="Preparing the selected transaction for review."
        onClose={onClose}
        width="1180px"
        panelClassName="sales-history-detail-modal"
        bodyClassName="sales-history-detail-modal-body"
      >
        <Loader message="Preparing transaction details..." />
      </Modal>
    )
  }

  const { receipt, detailError, soldItemCount, soldItems, serviceFeeItems } = detailState
  const receiptItems = Array.isArray(receipt?.items) ? receipt.items : []
  const totalLineItems = receiptItems.length
  const summaryCards = [
    {
      label: 'Recorded At',
      value: shortDateTime(sale.submitted_at || sale.created_at),
      helper: 'Saved transaction timestamp',
    },
    {
      label: 'Cashier',
      value: sale.cashier_name || 'Unknown Cashier',
      helper: 'Account that completed the sale',
    },
    {
      label: 'Branch',
      value: sale.branch_name || 'All Branches',
      helper: 'Visible within current scope',
    },
    {
      label: 'Payment Method',
      value: getSalePaymentMethodLabel(sale.payment_method),
      helper: 'Recorded during checkout',
    },
    {
      label: 'Discount Type',
      value: getSaleDiscountTypeLabel(sale),
      helper:
        Number(sale.discount || 0) > 0
          ? `${peso(sale.discount)} applied`
          : 'No discount was applied',
    },
    {
      label: 'Items Sold',
      value: `${soldItemCount} item${soldItemCount === 1 ? '' : 's'}`,
      helper: `${totalLineItems} receipt line${totalLineItems === 1 ? '' : 's'}`,
    },
  ]

  const totalsRows = [
    { label: 'Subtotal', value: peso(receipt?.subtotal || 0) },
    { label: 'Service Fees', value: peso(receipt?.serviceFeeTotal || 0) },
    { label: 'Discount', value: peso(receipt?.discount || 0) },
    {
      label: 'Total',
      value: peso(receipt?.total || 0),
      isTotal: true,
    },
    { label: 'Cash Received', value: peso(receipt?.cashReceived || 0) },
    { label: 'Change', value: peso(receipt?.change || 0) },
  ]

  const handleActionFeedback = (variant, title, message) => {
    setActionNotice({
      variant,
      title,
      message,
    })
  }

  const handleCopyTransactionId = async () => {
    try {
      await copyTextToClipboard(receipt?.transactionNumber)
      handleActionFeedback(
        'success',
        'Transaction ID copied',
        `${receipt?.transactionNumber || 'Transaction ID'} is ready to paste.`,
      )
    } catch (error) {
      handleActionFeedback(
        'error',
        'Copy failed',
        error.message || 'The transaction ID could not be copied right now.',
      )
    }
  }

  const handleDownloadReceipt = () => {
    try {
      downloadReceipt(receipt, {
        headerTitle: 'Sales Receipt',
        documentTitle: 'Sales Receipt',
        supportingCopy:
          'This export was generated from the Sales History review panel for audit and cashier reference.',
      })
      handleActionFeedback(
        'success',
        'Receipt downloaded',
        'A receipt file was generated from this recorded transaction.',
      )
    } catch (error) {
      handleActionFeedback(
        'error',
        'Download failed',
        error.message || 'The receipt could not be downloaded right now.',
      )
    }
  }

  const handlePrintReceipt = () => {
    try {
      printReceipt(receipt, {
        headerTitle: 'Sales Receipt',
        documentTitle: 'Sales Receipt',
        supportingCopy:
          'This printable copy was generated from the Sales History review panel for audit and cashier reference.',
      })
      handleActionFeedback(
        'info',
        'Print window opened',
        'Use the browser print dialog to complete the receipt print.',
      )
    } catch (error) {
      handleActionFeedback(
        'error',
        'Print failed',
        error.message || 'The receipt could not be prepared for printing.',
      )
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Transaction Details"
      eyebrow="Sales History"
      description="Review the full transaction, receipt, and tender breakdown without changing any recorded sales data."
      onClose={onClose}
      width="1180px"
      panelClassName="sales-history-detail-modal"
      bodyClassName="sales-history-detail-modal-body"
    >
      <div className="sales-history-detail-shell">
        <div className="sales-history-detail-topbar">
          <div className="sales-history-detail-identity">
            <p className="card-label">Transaction Review</p>
            <div className="sales-history-detail-title-row">
              <h3 className="sales-history-detail-reference">
                {receipt?.transactionNumber || getSaleReference(sale)}
              </h3>
              <StatusBadge text="Completed" tone="normal" />
            </div>
            <p className="sales-history-detail-copy">
              Verify recorded line items, cashier activity, and payment totals from a single operational review surface.
            </p>
          </div>

          <div className="sales-history-detail-actions">
            <div className="sales-history-detail-total-chip">
              <span>Total Amount</span>
              <strong>{peso(receipt?.total || 0)}</strong>
            </div>

            <div className="sales-history-detail-toolbar">
              <button
                type="button"
                className="ghost-action"
                onClick={handleCopyTransactionId}
              >
                Copy Transaction ID
              </button>
              <button
                type="button"
                className="ghost-action"
                onClick={handleDownloadReceipt}
              >
                Download Receipt
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handlePrintReceipt}
              >
                Print Receipt
              </button>
            </div>
          </div>
        </div>

        {detailError ? (
          <NoticeBanner
            variant="error"
            title="Transaction details unavailable"
            message={detailError}
          />
        ) : null}

        {actionNotice ? (
          <NoticeBanner
            variant={actionNotice.variant}
            title={actionNotice.title}
            message={actionNotice.message}
          />
        ) : null}

        {receipt ? (
          <div className="sales-history-detail-layout">
            <div className="sales-history-detail-main">
              <section className="sales-history-detail-section">
                <div className="sales-history-detail-section-header">
                  <div>
                    <p className="card-label">Overview</p>
                    <h4>Transaction metadata</h4>
                  </div>
                  <p className="supporting-text">
                    Key identifiers and accountability fields for this completed sale.
                  </p>
                </div>

                <div className="sales-history-detail-grid">
                  {summaryCards.map((card) => (
                    <article key={card.label} className="sales-history-detail-card">
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                      <small>{card.helper}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="sales-history-detail-section">
                <div className="sales-history-detail-section-header">
                  <div>
                    <p className="card-label">Purchased Items</p>
                    <h4>Recorded receipt lines</h4>
                  </div>
                  <p className="supporting-text">
                    {soldItems.length} sold line{soldItems.length === 1 ? '' : 's'}
                    {serviceFeeItems.length > 0
                      ? ` plus ${serviceFeeItems.length} service fee line${serviceFeeItems.length === 1 ? '' : 's'}`
                      : ''}
                    .
                  </p>
                </div>

                {receiptItems.length > 0 ? (
                  <div className="sales-history-items-shell">
                    <table className="sales-history-items-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Type</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receiptItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="sales-history-item-name">
                                <strong>{item.name}</strong>
                                <span>
                                  {item.isServiceFee
                                    ? 'Additional checkout charge'
                                    : 'Recorded product sale'}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span
                                className={
                                  item.isServiceFee
                                    ? 'sales-history-item-type sales-history-item-type--service'
                                    : 'sales-history-item-type'
                                }
                              >
                                {item.isServiceFee ? 'Service Fee' : 'Sale Item'}
                              </span>
                            </td>
                            <td>{item.quantity}</td>
                            <td>{peso(item.unitPrice)}</td>
                            <td className="sales-history-item-total">{peso(item.lineTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    title="No receipt lines were saved"
                    description="This transaction is missing line-item details, so there is nothing to review in the itemized table."
                  />
                )}
              </section>

              <section className="sales-history-detail-section">
                <div className="sales-history-detail-section-header">
                  <div>
                    <p className="card-label">Payment Summary</p>
                    <h4>Totals and tender review</h4>
                  </div>
                  <p className="supporting-text">
                    Review the pricing, discount, tender amount, and final change returned.
                  </p>
                </div>

                <div className="sales-history-summary-grid">
                  <div className="sales-history-summary-stack">
                    <article className="sales-history-summary-card">
                      <span className="card-label">Payment Method</span>
                      <strong>{getSalePaymentMethodLabel(sale.payment_method)}</strong>
                      <p className="supporting-text">
                        Recorded under {sale.cashier_name || 'Unknown Cashier'} for {sale.branch_name || 'All Branches'}.
                      </p>
                    </article>

                    <article className="sales-history-summary-card">
                      <span className="card-label">Discount Handling</span>
                      <strong>{getSaleDiscountTypeLabel(sale)}</strong>
                      <p className="supporting-text">
                        {Number(receipt.discount || 0) > 0
                          ? `${peso(receipt.discount)} was deducted from the sale.`
                          : 'No discount amount was applied to this transaction.'}
                      </p>
                    </article>

                    {sale.notes ? (
                      <article className="sales-history-summary-card">
                        <span className="card-label">Notes</span>
                        <strong>Recorded remarks</strong>
                        <p className="supporting-text">{sale.notes}</p>
                      </article>
                    ) : null}
                  </div>

                  <article className="sales-history-summary-card sales-history-summary-card--totals">
                    <span className="card-label">Transaction Totals</span>
                    <div className="sales-history-summary-list">
                      {totalsRows.map((row) => (
                        <div
                          key={row.label}
                          className={
                            row.isTotal
                              ? 'sales-history-summary-row sales-history-summary-row--total'
                              : 'sales-history-summary-row'
                          }
                        >
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            </div>

            <aside className="sales-history-receipt-panel">
              <div className="sales-history-receipt-copy">
                <p className="card-label">Receipt View</p>
                <p className="supporting-text">
                  This printable receipt stays aligned with the transaction data shown on the left.
                </p>
              </div>

              <ReceiptPreview receipt={receipt} showActions={false} />
            </aside>
          </div>
        ) : (
          <EmptyState
            title="Transaction details unavailable"
            description="The receipt preview could not be generated for this transaction."
          />
        )}
      </div>
    </Modal>
  )
}

export default SalesHistoryDetailsModal
