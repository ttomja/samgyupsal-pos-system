import { useCallback, useEffect, useMemo, useState } from 'react'
import EmptyState from '../../../shared/components/common/EmptyState'
import Loader from '../../../shared/components/common/Loader'
import NoticeBanner from '../../../shared/components/common/NoticeBanner'
import StatusBadge from '../../../shared/components/common/StatusBadge'
import SelectMenu from '../../../shared/components/ui/SelectMenu'
import SummaryCards from '../components/SummaryCards'
import TopItemsTable from '../components/TopItemsTable'
import useAuth from '../../auth/hooks/useAuth'
import useSessionStorageState from '../../../shared/hooks/useSessionStorageState'
import {
  getBranches,
  getCachedBranches,
} from '../../branches/services/branchService'
import {
  REPORT_PERIOD_DAILY,
  getCachedReportSnapshot,
  getReportPeriodDateRange,
  getReportSnapshot,
  reportPeriodOptions,
} from '../services/reportService'
import {
  getFirstValidationError,
  validateReportDateRange,
} from '../../../shared/utils/validation'
import { shortDate } from '../../../shared/utils/formatters'
import {
  downloadRowsAsCsv,
  downloadRowsAsXlsx,
} from '../../../shared/utils/exportData'
import { isAdminUser } from '../../../shared/utils/permissions'
import '../styles/reports.css'

const REPORT_BRANCH_ALL = 'all'
const INITIAL_PERIOD_TYPE = REPORT_PERIOD_DAILY
const INITIAL_REPORT_RANGE = getReportPeriodDateRange(INITIAL_PERIOD_TYPE)
const REPORTS_PAGE_STATE_KEY = 'page-state:reports'

const EMPTY_REPORT = {
  summary: {},
  metricsRows: [],
  topItems: [],
  lowStock: [],
  predictiveStockout: [],
  nearExpiry: [],
  cashierPerformance: [],
}

const reportExportColumns = [
  { key: 'productName', header: 'Product Name' },
  { key: 'branch', header: 'Branch' },
  { key: 'openingStock', header: 'Starting Stock' },
  { key: 'currentStock', header: 'Current Stock' },
  { key: 'quantityDeducted', header: 'Quantity Deducted' },
  { key: 'totalSalesAmount', header: 'Total Sales Amount' },
  { key: 'periodType', header: 'Period Type' },
  { key: 'dateRange', header: 'Date Range' },
]

function getInitialReportFilters() {
  return {
    ...INITIAL_REPORT_RANGE,
    branchId: REPORT_BRANCH_ALL,
    periodType: INITIAL_PERIOD_TYPE,
  }
}

function resolveReportRequest(filters = {}, user, isAdmin) {
  const periodType = filters.periodType || INITIAL_PERIOD_TYPE
  const periodRange = getReportPeriodDateRange(periodType)
  const branchFilterValue = isAdmin
    ? filters.branchId || REPORT_BRANCH_ALL
    : user?.branchId || REPORT_BRANCH_ALL

  return {
    branchId:
      isAdmin && branchFilterValue === REPORT_BRANCH_ALL
        ? null
        : branchFilterValue,
    dateFrom: filters.dateFrom || periodRange.dateFrom,
    dateTo: filters.dateTo || periodRange.dateTo,
    periodType,
    user,
  }
}

function ReportsPage() {
  const { user } = useAuth()
  const isAdmin = isAdminUser(user)
  const [branchOptions, setBranchOptions] = useState(() => getCachedBranches() || [])
  const [isBranchLoading, setIsBranchLoading] = useState(
    () => (getCachedBranches() || []).length === 0,
  )
  const [branchLoadError, setBranchLoadError] = useState('')
  const [reportFilters, setReportFilters] = useSessionStorageState(
    REPORTS_PAGE_STATE_KEY,
    getInitialReportFilters,
  )
  const [appliedReportFilters, setAppliedReportFilters] = useState(
    () => reportFilters || getInitialReportFilters(),
  )
  const dateFrom = reportFilters?.dateFrom || INITIAL_REPORT_RANGE.dateFrom
  const dateTo = reportFilters?.dateTo || INITIAL_REPORT_RANGE.dateTo
  const periodType = reportFilters?.periodType || INITIAL_PERIOD_TYPE
  const branchFilterValue = isAdmin
    ? reportFilters?.branchId || REPORT_BRANCH_ALL
    : user?.branchId || REPORT_BRANCH_ALL
  const initialRequest = resolveReportRequest(appliedReportFilters, user, isAdmin)
  const cachedInitialReport = getCachedReportSnapshot(initialRequest) || EMPTY_REPORT
  const [reportData, setReportData] = useState(cachedInitialReport)
  const [isLoading, setIsLoading] = useState(
    () => !getCachedReportSnapshot(initialRequest),
  )
  const [filterError, setFilterError] = useState('')
  const [filterMessage, setFilterMessage] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadBranches = async () => {
      try {
        setIsBranchLoading(true)
        const branches = await getBranches()

        if (!isMounted) {
          return
        }

        setBranchOptions(branches)
        setBranchLoadError('')
      } catch (error) {
        console.error('Failed to load report branch options:', error)

        if (!isMounted) {
          return
        }

        setBranchOptions([])
        setBranchLoadError(
          error.response?.data?.message || 'Unable to load branch options.',
        )
      } finally {
        if (isMounted) {
          setIsBranchLoading(false)
        }
      }
    }

    void loadBranches()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const expectedBranchId = isAdmin
      ? reportFilters?.branchId || REPORT_BRANCH_ALL
      : user?.branchId || REPORT_BRANCH_ALL

    setReportFilters((currentFilters) => {
      const currentState = currentFilters || getInitialReportFilters()

      if (String(currentState.branchId || '') === String(expectedBranchId)) {
        return currentState
      }

      return {
        ...currentState,
        branchId: expectedBranchId,
      }
    })

    setAppliedReportFilters((currentFilters) => {
      const currentState = currentFilters || getInitialReportFilters()

      if (String(currentState.branchId || '') === String(expectedBranchId)) {
        return currentState
      }

      return {
        ...currentState,
        branchId: expectedBranchId,
      }
    })
  }, [isAdmin, reportFilters?.branchId, setReportFilters, user?.branchId])

  const selectedBranchLabel = useMemo(() => {
    if (isAdmin && branchFilterValue === REPORT_BRANCH_ALL) {
      return 'All Branches'
    }

    return (
      branchOptions.find((branch) => Number(branch.id) === Number(branchFilterValue))?.name ||
      user?.branchName ||
      'Assigned Branch'
    )
  }, [branchFilterValue, branchOptions, isAdmin, user?.branchName])

  const reviewWindowLabel = useMemo(() => {
    const startDate = new Date(`${dateFrom}T00:00:00`)
    const endDate = new Date(`${dateTo}T00:00:00`)

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return 'Custom'
    }

    const daySpan = Math.max(
      1,
      Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1,
    )

    return `${daySpan} day${daySpan === 1 ? '' : 's'}`
  }, [dateFrom, dateTo])

  const loadReportsForFilters = useCallback(async (filters, announceRange = true) => {
    const request = resolveReportRequest(filters, user, isAdmin)

    try {
      if (announceRange) {
        setFilterMessage('')
      }

      setIsLoading((currentValue) => currentValue || !getCachedReportSnapshot(request))
      const snapshot = await getReportSnapshot(request)
      setReportData(snapshot)
      setLoadError('')

      if (announceRange) {
        setFilterMessage(
          `Showing ${snapshot.selectedPeriod?.periodLabel || 'selected'} results for ${selectedBranchLabel} from ${shortDate(request.dateFrom)} to ${shortDate(request.dateTo)}.`,
        )
      }
    } catch (error) {
      console.error('Failed to load report snapshot:', error)
      setFilterMessage('')
      setReportData(EMPTY_REPORT)
      setLoadError(
        error.response?.data?.message ||
          'Reports could not be loaded right now.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [isAdmin, selectedBranchLabel, user])

  useEffect(() => {
    void loadReportsForFilters(appliedReportFilters, false)
  }, [appliedReportFilters, loadReportsForFilters])

  const handleApplyFilter = () => {
    const validation = validateReportDateRange({ dateFrom, dateTo })

    if (!validation.isValid) {
      setFilterMessage('')
      setFilterError(getFirstValidationError(validation.errors))
      return
    }

    setFilterError('')
    const nextFilters = {
      ...(reportFilters || getInitialReportFilters()),
      dateFrom,
      dateTo,
    }

    setReportFilters(nextFilters)
    setAppliedReportFilters(nextFilters)
  }

  const handlePeriodChange = (event) => {
    const nextPeriodType = event.target.value
    const nextRange = getReportPeriodDateRange(nextPeriodType)
    const nextFilters = {
      ...(reportFilters || getInitialReportFilters()),
      ...nextRange,
      periodType: nextPeriodType,
    }

    setFilterError('')
    setReportFilters(nextFilters)
    setAppliedReportFilters(nextFilters)
  }

  const handleBranchChange = (event) => {
    const nextFilters = {
      ...(reportFilters || getInitialReportFilters()),
      branchId: event.target.value,
    }

    setFilterError('')
    setReportFilters(nextFilters)
    setAppliedReportFilters(nextFilters)
  }

  const handleExportReports = (format) => {
    const rows = reportData.metricsRows || []
    const filename = [
      'inventory-movement-report',
      periodType,
      selectedBranchLabel,
      dateFrom,
      dateTo,
    ].join('-')

    if (format === 'xlsx') {
      downloadRowsAsXlsx(filename, reportExportColumns, rows, {
        sheetName: 'Inventory Report',
      })
      return
    }

    downloadRowsAsCsv(filename, reportExportColumns, rows)
  }

  const branchFilterOptions = useMemo(
    () => [
      { value: REPORT_BRANCH_ALL, label: 'All Branches' },
      ...branchOptions.map((branch) => ({
        value: branch.id,
        label: branch.name,
      })),
    ],
    [branchOptions],
  )

  const metricsColumns = [
    { key: 'productName', label: 'Product Name' },
    { key: 'branch', label: 'Branch' },
    { key: 'openingStock', label: 'Starting Stock' },
    { key: 'currentStock', label: 'Current Stock' },
    { key: 'quantityDeducted', label: 'Qty Deducted / Sold' },
    { key: 'totalSalesAmountLabel', label: 'Total Sales Amount' },
    { key: 'periodType', label: 'Period Type' },
    { key: 'dateRange', label: 'Date Range' },
  ]
  const topItemsColumns = [
    { key: 'item', label: 'Item' },
    { key: 'sold', label: 'Units Sold' },
    { key: 'revenue', label: 'Revenue' },
  ]
  const lowStockColumns = [
    { key: 'item', label: 'Item' },
    { key: 'stock', label: 'Stock' },
    { key: 'reorderLevel', label: 'Reorder Level' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge text={row.status} variant="warning" />,
    },
  ]
  const cashierColumns = [
    { key: 'cashier', label: 'Cashier' },
    { key: 'sales', label: 'Sales Total' },
    { key: 'transactions', label: 'Transactions' },
  ]
  const predictiveStockoutColumns = [
    { key: 'item', label: 'Item' },
    { key: 'stock', label: 'Stock' },
    { key: 'averageDailySales', label: 'Avg Daily Sales' },
    { key: 'estimatedDaysBeforeStockout', label: 'Days Left' },
    { key: 'estimatedStockoutDate', label: 'Stockout Date' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <StatusBadge
          text={row.status}
          variant={row.status === 'Critical' || row.status === 'Out of Stock' ? 'critical' : 'warning'}
        />
      ),
    },
  ]
  const nearExpiryColumns = [
    { key: 'item', label: 'Product Name' },
    { key: 'batch', label: 'Batch' },
    { key: 'stock', label: 'Current Stock' },
    { key: 'expiryDate', label: 'Expiry Date' },
    { key: 'daysToExpiry', label: 'Days Left' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <StatusBadge
          text={row.status}
          variant={String(row.status || '').toLowerCase().includes('expired') ? 'critical' : 'warning'}
        />
      ),
    },
  ]
  return (
    <section className="reports-page">
      <div className="reports-topbar">
        <div className="reports-title-block">
          <p className="eyebrow">Business Reporting</p>
          <h1>Reports</h1>
          <p className="supporting-text">
            Review sales, inventory movement, stock risk, and branch-scoped performance in one workspace.
          </p>
        </div>

        <div className="reports-meta-grid">
          <article className="reports-meta-card">
            <span className="meta-label">Branch Scope</span>
            <strong className="meta-primary">{selectedBranchLabel}</strong>
            <span className="meta-secondary">
              {isAdmin ? 'Administrator report scope' : 'Assigned branch only'}
            </span>
          </article>

          <article className="reports-meta-card">
            <span className="meta-label">From</span>
            <strong className="meta-primary">{shortDate(dateFrom)}</strong>
            <span className="meta-secondary">
              Start of selected reporting period.
            </span>
          </article>

          <article className="reports-meta-card">
            <span className="meta-label">To</span>
            <strong className="meta-primary">{shortDate(dateTo)}</strong>
            <span className="meta-secondary">
              End of selected reporting period.
            </span>
          </article>

          <article className="reports-meta-card">
            <span className="meta-label">Review Window</span>
            <strong className="meta-primary">{reviewWindowLabel}</strong>
            <span className="meta-secondary">
              Duration covered by this report.
            </span>
          </article>
        </div>
      </div>

      <div className="panel reports-filter-panel">
        <div className="reports-filter-copy">
          <p className="card-label">Reporting Controls</p>
          <h2>Set Scope And Period</h2>
          <p className="supporting-text">
            Admins can review all branches or a selected branch. Employees are locked to their assigned branch.
          </p>
        </div>

        <div className="reports-date-filter">
          {isAdmin ? (
            <label className="reports-date-field">
              <span>Branch</span>
              <SelectMenu
                className="reports-filter-select"
                value={branchFilterValue}
                onChange={handleBranchChange}
                disabled={isBranchLoading}
                options={branchFilterOptions}
              />
            </label>
          ) : null}

          <label className="reports-date-field">
            <span>Period</span>
            <SelectMenu
              className="reports-filter-select"
              value={periodType}
              onChange={handlePeriodChange}
              options={reportPeriodOptions}
            />
          </label>

          <label className="reports-date-field">
            <span>From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setFilterError('')
                setFilterMessage('')
                setReportFilters((currentFilters) => ({
                  ...(currentFilters || getInitialReportFilters()),
                  dateFrom: event.target.value,
                }))
              }}
              aria-invalid={Boolean(filterError)}
            />
          </label>
          <label className="reports-date-field">
            <span>To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setFilterError('')
                setFilterMessage('')
                setReportFilters((currentFilters) => ({
                  ...(currentFilters || getInitialReportFilters()),
                  dateTo: event.target.value,
                }))
              }}
              aria-invalid={Boolean(filterError)}
            />
          </label>
          <button
            type="button"
            className="reports-filter-button"
            onClick={handleApplyFilter}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Apply Range'}
          </button>
        </div>
      </div>

      <div className="reports-export-bar">
        <div>
          <p className="card-label">Export</p>
          <p className="supporting-text">
            Downloads use the currently visible branch, period, and date filters.
          </p>
        </div>

        <div className="reports-export-actions">
          <button
            type="button"
            className="ghost-action"
            onClick={() => handleExportReports('csv')}
            disabled={isLoading || (reportData.metricsRows || []).length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="ghost-action"
            onClick={() => handleExportReports('xlsx')}
            disabled={isLoading || (reportData.metricsRows || []).length === 0}
          >
            Export Excel
          </button>
        </div>
      </div>

      {branchLoadError ? (
        <NoticeBanner
          variant="error"
          title="Branch scope unavailable"
          message={branchLoadError}
        />
      ) : null}

      {loadError ? (
        <NoticeBanner
          variant="error"
          title="Report unavailable"
          message={loadError}
        />
      ) : null}

      {filterError ? (
        <NoticeBanner
          variant="error"
          title="Invalid date range"
          message={filterError}
        />
      ) : null}

      {!filterError && filterMessage ? (
        <NoticeBanner
          variant="success"
          title="Filter applied"
          message={filterMessage}
        />
      ) : null}

      {isLoading ? (
        <Loader message="Loading report snapshot..." />
      ) : loadError ? (
        <EmptyState
          title="Reports are currently unavailable"
          description="The report snapshot could not be loaded. Check the data source and try again."
        />
      ) : (
        <>
          <SummaryCards summary={reportData.summary} />

          <TopItemsTable
            columns={metricsColumns}
            rows={reportData.metricsRows || []}
            eyebrow="Sales And Inventory Movement"
            title="Product-level deduction report"
            pageSize={10}
            summaryLabel="product rows"
          />

          <div className="reports-table-grid">
            <TopItemsTable
              columns={topItemsColumns}
              rows={reportData.topItems}
              eyebrow="Top-Selling Items"
              title="Best performers"
            />

            <TopItemsTable
              columns={lowStockColumns}
              rows={reportData.lowStock}
              eyebrow="Low-Stock Items"
              title="Restock watchlist"
              pageSize={6}
              summaryLabel="watchlist items"
            />
          </div>

          <TopItemsTable
            columns={predictiveStockoutColumns}
            rows={reportData.predictiveStockout || []}
            eyebrow="Projected Stockout"
            title="Sales velocity alerts"
            pageSize={6}
            summaryLabel="stockout alerts"
          />

          <TopItemsTable
            columns={nearExpiryColumns}
            rows={reportData.nearExpiry || []}
            eyebrow="Near-Expiry Batches"
            title="Expiry-based batch table"
            pageSize={6}
            summaryLabel="batch rows"
          />

          <TopItemsTable
            columns={cashierColumns}
            rows={reportData.cashierPerformance}
            eyebrow="Sales by Cashier"
            title="Cashier performance"
          />
        </>
      )}
    </section>
  )
}

export default ReportsPage
