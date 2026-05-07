import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import EmptyState from '../../../shared/components/common/EmptyState'
import Loader from '../../../shared/components/common/Loader'
import NoticeBanner from '../../../shared/components/common/NoticeBanner'
import PaginationControls from '../../../shared/components/common/PaginationControls'
import StatusBadge from '../../../shared/components/common/StatusBadge'
import SelectMenu from '../../../shared/components/ui/SelectMenu'
import useSessionStorageState from '../../../shared/hooks/useSessionStorageState'
import { isSupabaseAuthEnabled } from '../../../shared/supabase/client'
import { peso, shortDateTime } from '../../../shared/utils/formatters'
import { isAdminUser } from '../../../shared/utils/permissions'
import {
  downloadRowsAsCsv,
  downloadRowsAsXlsx,
} from '../../../shared/utils/exportData'
import {
  getCachedProfilesDirectory,
  getProfilesDirectory,
} from '../../users/services/profileService'
import { getLocalUsers } from '../../users/services/userService'
import SalesHistoryDetailsModal from './SalesHistoryDetailsModal'
import {
  DEFAULT_SALES_HISTORY_PAGE_SIZE,
  SALES_HISTORY_ALL_FILTER,
  getCachedSalesHistoryPage,
  getSaleItemCount,
  getSalePaymentMethodLabel,
  getSaleReference,
  getSalesRecords,
  getSalesHistoryPage,
  isServiceFeeLineItem,
  salesHistoryPaymentMethodOptions,
} from '../services/salesService'

const EMPTY_HISTORY_PAGE = {
  records: [],
  totalCount: 0,
  totalPages: 1,
  currentPage: 1,
  pageSize: DEFAULT_SALES_HISTORY_PAGE_SIZE,
}
const SALES_HISTORY_PAGE_STATE_KEY = 'page-state:sales-history'
const salesHistoryExportColumns = [
  { key: 'saleReference', header: 'Sale ID / Receipt Number' },
  { key: 'dateTime', header: 'Date and Time' },
  { key: 'branch', header: 'Branch' },
  { key: 'cashier', header: 'Cashier / Employee' },
  { key: 'itemsSold', header: 'Items Sold' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'addOns', header: 'Add-ons' },
  { key: 'paymentMethod', header: 'Payment Method' },
  { key: 'totalAmount', header: 'Total Amount' },
]

function getEmployeeCashierLabel(employee = {}) {
  return [
    employee.name || 'Unnamed Employee',
    employee.username ? `@${employee.username}` : '@username-pending',
    employee.branchName || 'Unassigned Branch',
  ].join(' - ')
}

function formatSaleItemList(items = [], predicate) {
  const matchingItems = items.filter(predicate)

  if (matchingItems.length === 0) {
    return ''
  }

  return matchingItems
    .map((item) => `${item.item_name || 'Unknown Item'} x ${Number(item.quantity || 0)}`)
    .join('; ')
}

function buildSalesHistoryExportRows(records = []) {
  return records.map((sale) => {
    const saleItems = Array.isArray(sale.items) ? sale.items : []
    const productItems = saleItems.filter((item) => !isServiceFeeLineItem(item))
    const serviceFeeItems = saleItems.filter((item) => isServiceFeeLineItem(item))

    return {
      saleReference: getSaleReference(sale),
      dateTime: shortDateTime(sale.submitted_at || sale.created_at),
      branch: sale.branch_name || 'All Branches',
      cashier: sale.cashier_name || 'Unknown Cashier',
      itemsSold: formatSaleItemList(productItems, () => true),
      quantity: productItems.reduce(
        (total, item) => total + Number(item.quantity || 0),
        0,
      ),
      addOns: formatSaleItemList(serviceFeeItems, () => true),
      paymentMethod: getSalePaymentMethodLabel(sale.payment_method),
      totalAmount: Number(sale.total_amount || 0),
    }
  })
}

function buildInitialHistoryViewState(user, isAdmin) {
  return {
    transactionQuery: '',
    cashierQuery: '',
    dateFrom: '',
    dateTo: '',
    paymentMethod: SALES_HISTORY_ALL_FILTER,
    branchId: isAdmin ? SALES_HISTORY_ALL_FILTER : user?.branchId || SALES_HISTORY_ALL_FILTER,
    currentPage: 1,
  }
}

function SalesHistoryPanel({
  branchOptions = [],
  branchScopeId = null,
  onBranchScopeChange,
  refreshKey = 0,
  user,
}) {
  const isAdmin = isAdminUser(user)
  const cashierSuggestionsId = useId()
  const cashierComboboxRef = useRef(null)
  const [historyViewState, setHistoryViewState] = useSessionStorageState(
    SALES_HISTORY_PAGE_STATE_KEY,
    () => buildInitialHistoryViewState(user, isAdmin),
  )
  const transactionQuery = historyViewState?.transactionQuery || ''
  const cashierQuery = historyViewState?.cashierQuery || ''
  const dateFrom = historyViewState?.dateFrom || ''
  const dateTo = historyViewState?.dateTo || ''
  const paymentMethod = historyViewState?.paymentMethod || SALES_HISTORY_ALL_FILTER
  const controlledBranchScope =
    isAdmin && branchScopeId != null && String(branchScopeId).trim() !== ''
      ? branchScopeId
      : null
  const branchId =
    controlledBranchScope ??
    historyViewState?.branchId ??
    (isAdmin ? SALES_HISTORY_ALL_FILTER : user?.branchId || SALES_HISTORY_ALL_FILTER)
  const currentPage = Math.max(1, Number(historyViewState?.currentPage || 1))
  const updateHistoryViewState = useCallback((patch) => {
    setHistoryViewState((currentState) => ({
      ...(currentState || {}),
      ...(typeof patch === 'function' ? patch(currentState || {}) : patch),
    }))
  }, [setHistoryViewState])
  const initialCachedHistoryPage = getCachedSalesHistoryPage({
    user,
    page: currentPage,
    pageSize: DEFAULT_SALES_HISTORY_PAGE_SIZE,
    transactionQuery,
    cashierQuery: isAdmin ? cashierQuery : '',
    dateFrom,
    dateTo,
    paymentMethod,
    branchId: isAdmin ? branchId : user?.branchId ?? '',
  })
  const [historyPage, setHistoryPage] = useState(
    () => initialCachedHistoryPage || EMPTY_HISTORY_PAGE,
  )
  const [isLoading, setIsLoading] = useState(() => !initialCachedHistoryPage)
  const [loadError, setLoadError] = useState('')
  const [exportError, setExportError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [selectedSale, setSelectedSale] = useState(null)
  const [employeeDirectory, setEmployeeDirectory] = useState(() =>
    isAdmin
      ? isSupabaseAuthEnabled
        ? getCachedProfilesDirectory() || []
        : getLocalUsers()
      : [],
  )
  const [isCashierSuggestionsOpen, setIsCashierSuggestionsOpen] = useState(false)
  const [activeCashierSuggestionIndex, setActiveCashierSuggestionIndex] = useState(0)
  const deferredTransactionQuery = useDeferredValue(transactionQuery)
  const deferredCashierQuery = useDeferredValue(cashierQuery)

  const branchFilterOptions = useMemo(
    () => [
      { value: SALES_HISTORY_ALL_FILTER, label: 'All Branches' },
      ...branchOptions.map((branch) => ({
        value: branch.id,
        label: branch.name,
      })),
    ],
    [branchOptions],
  )

  useEffect(() => {
    if (!isAdmin) {
      setEmployeeDirectory([])
      return undefined
    }

    let isMounted = true

    const loadEmployeeDirectory = async () => {
      try {
        const directory = isSupabaseAuthEnabled
          ? await getProfilesDirectory()
          : getLocalUsers()

        if (isMounted) {
          setEmployeeDirectory(directory)
        }
      } catch (error) {
        console.warn('Unable to load employee directory for sales filtering:', error)
      }
    }

    void loadEmployeeDirectory()

    return () => {
      isMounted = false
    }
  }, [isAdmin])

  const cashierProfileIds = useMemo(() => {
    const normalizedQuery = deferredCashierQuery.trim().toLowerCase()

    if (!isAdmin || !normalizedQuery) {
      return []
    }

    return employeeDirectory
      .filter((employee) =>
        [
          employee.name,
          employee.username,
          employee.email,
          employee.branchName,
          getEmployeeCashierLabel(employee),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
      )
      .map((employee) => String(employee.id || '').trim())
      .filter(Boolean)
  }, [deferredCashierQuery, employeeDirectory, isAdmin])
  const cashierSuggestions = useMemo(() => {
    if (!isAdmin) {
      return []
    }

    const normalizedQuery = cashierQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return []
    }

    return employeeDirectory
      .map((employee) => {
        const label = getEmployeeCashierLabel(employee)

        return {
          id: String(employee.id || label),
          label,
          searchText: [
            employee.name,
            employee.username,
            employee.email,
            employee.branchName,
            label,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        }
      })
      .filter((suggestion) => suggestion.searchText.includes(normalizedQuery))
      .sort((left, right) =>
        left.label.localeCompare(right.label, 'en', { sensitivity: 'base' }),
      )
      .slice(0, 8)
      .map((suggestion) => suggestion.label)
  }, [cashierQuery, employeeDirectory, isAdmin])

  useEffect(() => {
    if (!isCashierSuggestionsOpen) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (cashierComboboxRef.current?.contains(event.target)) {
        return
      }

      setIsCashierSuggestionsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isCashierSuggestionsOpen])

  useEffect(() => {
    setActiveCashierSuggestionIndex(0)
  }, [employeeDirectory, isAdmin])

  useEffect(() => {
    setActiveCashierSuggestionIndex(0)
  }, [cashierSuggestions])

  const applyCashierSuggestion = (suggestion) => {
    updateHistoryViewState({
      cashierQuery: suggestion,
      currentPage: 1,
    })
    setIsCashierSuggestionsOpen(false)
  }

  const handleCashierInputKeyDown = (event) => {
    if (
      cashierQuery.trim() &&
      !isCashierSuggestionsOpen &&
      cashierSuggestions.length > 0 &&
      ['ArrowDown', 'ArrowUp'].includes(event.key)
    ) {
      setIsCashierSuggestionsOpen(true)
    }

    if (event.key === 'Escape') {
      setIsCashierSuggestionsOpen(false)
      return
    }

    if (!cashierSuggestions.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveCashierSuggestionIndex((currentIndex) =>
        Math.min(cashierSuggestions.length - 1, currentIndex + 1),
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveCashierSuggestionIndex((currentIndex) =>
        Math.max(0, currentIndex - 1),
      )
      return
    }

    if (event.key === 'Enter' && isCashierSuggestionsOpen) {
      event.preventDefault()
      applyCashierSuggestion(cashierSuggestions[activeCashierSuggestionIndex])
    }
  }

  useEffect(() => {
    updateHistoryViewState((currentState) => ({
      ...(currentState || {}),
      branchId:
        isAdmin
          ? controlledBranchScope || currentState?.branchId || SALES_HISTORY_ALL_FILTER
          : user?.branchId || SALES_HISTORY_ALL_FILTER,
    }))
  }, [controlledBranchScope, isAdmin, updateHistoryViewState, user?.branchId])

  useEffect(() => {
    updateHistoryViewState((currentState) => (
      Number(currentState?.currentPage || 1) === 1
        ? currentState
        : {
            ...currentState,
            currentPage: 1,
          }
    ))
  }, [
    branchId,
    dateFrom,
    dateTo,
    deferredCashierQuery,
    deferredTransactionQuery,
    paymentMethod,
    refreshKey,
    updateHistoryViewState,
  ])

  useEffect(() => {
    let isMounted = true

    const loadHistory = async () => {
      try {
        if (!getCachedSalesHistoryPage({
          user,
          page: currentPage,
          pageSize: DEFAULT_SALES_HISTORY_PAGE_SIZE,
          transactionQuery: deferredTransactionQuery,
          cashierQuery: isAdmin ? deferredCashierQuery : '',
          cashierProfileIds: isAdmin ? cashierProfileIds : [],
          dateFrom,
          dateTo,
          paymentMethod,
          branchId: isAdmin ? branchId : user?.branchId ?? '',
        })) {
          setIsLoading(true)
        }
        const nextHistoryPage = await getSalesHistoryPage({
          user,
          page: currentPage,
          pageSize: DEFAULT_SALES_HISTORY_PAGE_SIZE,
          transactionQuery: deferredTransactionQuery,
          cashierQuery: isAdmin ? deferredCashierQuery : '',
          cashierProfileIds: isAdmin ? cashierProfileIds : [],
          dateFrom,
          dateTo,
          paymentMethod,
          branchId: isAdmin ? branchId : user?.branchId ?? '',
        })

        if (!isMounted) {
          return
        }

        setHistoryPage(nextHistoryPage)
        setLoadError('')

        if (nextHistoryPage.currentPage !== currentPage) {
          updateHistoryViewState({
            currentPage: nextHistoryPage.currentPage,
          })
        }

      } catch (error) {
        console.error('Failed to load sales history:', error)

        if (!isMounted) {
          return
        }

        setHistoryPage(EMPTY_HISTORY_PAGE)
        setLoadError(
          error.response?.data?.message || 'Unable to load sales history right now.',
        )
        setSelectedSale(null)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadHistory()

    return () => {
      isMounted = false
    }
  }, [
    branchId,
    currentPage,
    dateFrom,
    dateTo,
    deferredCashierQuery,
    deferredTransactionQuery,
    cashierProfileIds,
    isAdmin,
    paymentMethod,
    refreshKey,
    updateHistoryViewState,
    user,
  ])

  useEffect(() => {
    if (!selectedSale) {
      return
    }

    const refreshedSale = historyPage.records.find(
      (record) => String(record.id) === String(selectedSale.id),
    )

    if (!refreshedSale) {
      setSelectedSale(null)
      return
    }

    if (refreshedSale !== selectedSale) {
      setSelectedSale(refreshedSale)
    }
  }, [historyPage.records, selectedSale])

  const hasActiveFilters = Boolean(
    transactionQuery ||
      cashierQuery ||
      dateFrom ||
      dateTo ||
      paymentMethod !== SALES_HISTORY_ALL_FILTER ||
      (isAdmin && branchId !== SALES_HISTORY_ALL_FILTER),
  )

  const recordsLabel =
    historyPage.totalCount === 1 ? 'transaction' : 'transactions'

  const scopeNote = isAdmin
    ? 'Review completed sales across visible branches and staff.'
    : 'Review your completed sales within your assigned account scope.'
  const emptyHistoryDescription =
    hasActiveFilters
      ? cashierQuery
        ? 'No completed transactions match that employee or cashier filter. Try the employee name, username, date, branch, or clear the filters.'
        : 'Try adjusting the transaction, date, branch, or payment filters.'
      : 'Completed sales will appear here once checkout records are saved.'

  const handleExportSalesHistory = async (format) => {
    try {
      setIsExporting(true)
      setExportError('')
      const records = await getSalesRecords({
        user,
        transactionQuery: deferredTransactionQuery,
        cashierQuery: isAdmin ? deferredCashierQuery : '',
        cashierProfileIds: isAdmin ? cashierProfileIds : [],
        dateFrom,
        dateTo,
        paymentMethod,
        branchId: isAdmin ? branchId : user?.branchId ?? '',
      })
      const exportRows = buildSalesHistoryExportRows(records)
      const branchLabel =
        branchId === SALES_HISTORY_ALL_FILTER
          ? 'all-branches'
          : branchOptions.find((branch) => Number(branch.id) === Number(branchId))?.name ||
            user?.branchName ||
            'assigned-branch'
      const filename = [
        'sales-history',
        branchLabel,
        dateFrom || 'all-dates',
        dateTo || 'all-dates',
      ].join('-')

      if (format === 'xlsx') {
        downloadRowsAsXlsx(filename, salesHistoryExportColumns, exportRows, {
          sheetName: 'Sales History',
        })
        return
      }

      downloadRowsAsCsv(filename, salesHistoryExportColumns, exportRows)
    } catch (error) {
      console.error('Failed to export sales history:', error)
      setExportError(
        error.response?.data?.message ||
          error.message ||
          'Unable to export sales history right now.',
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <section className="pos-panel sales-history-panel">
        <div className="panel-header sales-history-panel-header">
          <div>
            <p className="card-label">Sales History</p>
            <h2>Completed Transactions</h2>
            <p className="supporting-text">{scopeNote}</p>
          </div>

          <span className="panel-count">
            {historyPage.totalCount} {recordsLabel}
          </span>
        </div>

        <div className="sales-history-toolbar">
          <div className="sales-history-filter-grid">
            <label className="sales-history-field sales-history-field--wide">
              <span>Transaction</span>
              <input
                type="text"
                value={transactionQuery}
                onChange={(event) =>
                  updateHistoryViewState({
                    transactionQuery: event.target.value,
                  })
                }
                placeholder="Search transaction number"
              />
            </label>

            {isAdmin ? (
              <label className="sales-history-field sales-history-field--wide">
                <span>Employee / Cashier</span>
                <div
                  ref={cashierComboboxRef}
                  className="sales-history-combobox"
                >
                  <input
                    type="text"
                    value={cashierQuery}
                    onFocus={() =>
                      setIsCashierSuggestionsOpen(Boolean(cashierQuery.trim()))
                    }
                    onKeyDown={handleCashierInputKeyDown}
                    onChange={(event) => {
                      setIsCashierSuggestionsOpen(Boolean(event.target.value.trim()))
                      updateHistoryViewState({
                        cashierQuery: event.target.value,
                      })
                    }}
                    placeholder="Filter by employee name or username"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isCashierSuggestionsOpen && cashierSuggestions.length > 0}
                    aria-controls={cashierSuggestionsId}
                  />
                  <button
                    type="button"
                    className="sales-history-combobox-toggle"
                    onClick={() =>
                      setIsCashierSuggestionsOpen((currentValue) =>
                        cashierSuggestions.length > 0 ? !currentValue : false,
                      )
                    }
                    disabled={cashierSuggestions.length === 0}
                    aria-label="Show employee cashier suggestions"
                    aria-expanded={isCashierSuggestionsOpen && cashierSuggestions.length > 0}
                    aria-controls={cashierSuggestionsId}
                  >
                    <span aria-hidden="true">v</span>
                  </button>

                  {isCashierSuggestionsOpen && cashierSuggestions.length > 0 ? (
                    <div
                      id={cashierSuggestionsId}
                      className="sales-history-suggestion-list"
                      role="listbox"
                    >
                      {cashierSuggestions.map((suggestion, index) => (
                        <button
                          key={suggestion}
                          type="button"
                          className={
                            index === activeCashierSuggestionIndex
                              ? 'sales-history-suggestion active'
                              : 'sales-history-suggestion'
                          }
                          onMouseEnter={() => setActiveCashierSuggestionIndex(index)}
                          onClick={() => applyCashierSuggestion(suggestion)}
                          role="option"
                          aria-selected={index === activeCashierSuggestionIndex}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
            ) : null}

            <label className="sales-history-field">
              <span>Date From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) =>
                  updateHistoryViewState({
                    dateFrom: event.target.value,
                  })
                }
              />
            </label>

            <label className="sales-history-field">
              <span>Date To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) =>
                  updateHistoryViewState({
                    dateTo: event.target.value,
                  })
                }
              />
            </label>

            <label className="sales-history-field">
              <span>Payment</span>
              <SelectMenu
                className="sales-history-select"
                value={paymentMethod}
                onChange={(event) =>
                  updateHistoryViewState({
                    paymentMethod: event.target.value,
                  })
                }
                options={salesHistoryPaymentMethodOptions}
              />
            </label>

            {isAdmin ? (
              <label className="sales-history-field">
                <span>Branch</span>
                <SelectMenu
                  className="sales-history-select"
                  value={branchId}
                  onChange={(event) => {
                    onBranchScopeChange?.(event.target.value)
                    updateHistoryViewState({
                      branchId: event.target.value,
                    })
                  }}
                  options={branchFilterOptions}
                />
              </label>
            ) : null}
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              className="ghost-action sales-history-reset"
              onClick={() => {
                const resetBranchId =
                  isAdmin
                    ? SALES_HISTORY_ALL_FILTER
                    : user?.branchId || SALES_HISTORY_ALL_FILTER

                onBranchScopeChange?.(resetBranchId)
                updateHistoryViewState({
                  transactionQuery: '',
                  cashierQuery: '',
                  dateFrom: '',
                  dateTo: '',
                  paymentMethod: SALES_HISTORY_ALL_FILTER,
                  branchId: resetBranchId,
                  currentPage: 1,
                })
              }}
            >
              Clear Filters
            </button>
          ) : null}

          <div className="sales-history-export-actions">
            <button
              type="button"
              className="ghost-action"
              onClick={() => handleExportSalesHistory('csv')}
              disabled={isExporting || isLoading || historyPage.totalCount === 0}
            >
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              type="button"
              className="ghost-action"
              onClick={() => handleExportSalesHistory('xlsx')}
              disabled={isExporting || isLoading || historyPage.totalCount === 0}
            >
              Export Excel
            </button>
          </div>
        </div>

        {loadError ? (
          <NoticeBanner
            variant="error"
            title="Sales history unavailable"
            message={loadError}
          />
        ) : null}

        {exportError ? (
          <NoticeBanner
            variant="error"
            title="Export unavailable"
            message={exportError}
          />
        ) : null}

        {isLoading ? (
          <Loader message="Loading completed transactions..." />
        ) : historyPage.records.length === 0 ? (
          <div className="sales-history-empty">
            <EmptyState
              title="No completed transactions found"
              description={emptyHistoryDescription}
            />
          </div>
        ) : (
          <>
            <div className="sales-history-table-shell" tabIndex={0}>
              <table className="sales-history-table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Date &amp; Time</th>
                    <th>Employee / Cashier</th>
                    <th>Branch</th>
                    <th>Items</th>
                    <th>Subtotal</th>
                    <th>Discount</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyPage.records.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <div className="sales-history-cell-primary">
                          <strong>{getSaleReference(sale)}</strong>
                          <span>{sale.items.length} line item{sale.items.length === 1 ? '' : 's'}</span>
                        </div>
                      </td>
                      <td>{shortDateTime(sale.submitted_at || sale.created_at)}</td>
                      <td>{sale.cashier_name || 'Unknown Cashier'}</td>
                      <td>{sale.branch_name || 'All Branches'}</td>
                      <td>{getSaleItemCount(sale)}</td>
                      <td>{peso(sale.subtotal)}</td>
                      <td>{peso(sale.discount)}</td>
                      <td>{peso(sale.total_amount)}</td>
                      <td>{getSalePaymentMethodLabel(sale.payment_method)}</td>
                      <td>
                        <StatusBadge text="Completed" tone="normal" />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost-action sales-history-action"
                          onClick={() => setSelectedSale(sale)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={historyPage.currentPage}
              totalPages={historyPage.totalPages}
              totalItems={historyPage.totalCount}
              pageSize={historyPage.pageSize}
              onPageChange={(page) =>
                updateHistoryViewState({
                  currentPage: page,
                })
              }
              summaryLabel={recordsLabel}
            />
          </>
        )}
      </section>

      <SalesHistoryDetailsModal
        key={selectedSale?.id || 'sales-history-detail-closed'}
        sale={selectedSale}
        isOpen={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
      />
    </>
  )
}

export default SalesHistoryPanel
