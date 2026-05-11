import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Loader from '../../../shared/components/common/Loader'
import EmptyState from '../../../shared/components/common/EmptyState'
import InventoryTable from '../components/InventoryTable'
import NoticeBanner from '../../../shared/components/common/NoticeBanner'
import PaginationControls from '../../../shared/components/common/PaginationControls'
import Modal from '../../../shared/components/ui/Modal'
import SelectMenu from '../../../shared/components/ui/SelectMenu'
import {
  getBranches,
  getCachedBranches,
} from '../../branches/services/branchService'
import useAuth from '../../auth/hooks/useAuth'
import useSessionStorageState from '../../../shared/hooks/useSessionStorageState'
import {
  createInventoryItem,
  getCachedInventoryItems,
  getInventoryItems,
  hasInventoryCatalogConflict,
  removeInventoryItem,
  updateInventoryItem,
  updateInventoryStock,
} from '../services/inventoryService'
import {
  INVENTORY_FILTER_ALL,
  INVENTORY_FILTER_EXPIRY_DATE,
  INVENTORY_FILTER_LOW_STOCK,
  resolveInventoryFilterResults,
} from '../utils/inventoryFilters'
import {
  canAdjustInventoryStock,
  canManageInventoryCatalog,
  canStockInInventory,
  isAdminUser,
} from '../../../shared/utils/permissions'
import {
  getFirstValidationError,
  validateInventoryForm,
  validateInventoryQuantityAction,
} from '../../../shared/utils/validation'
import { STANDARD_PRODUCT_CATEGORIES } from '../../../shared/utils/categoryUtils'
import '../styles/inventory.css'

const INITIAL_PRODUCT_FORM = {
  product_name: '',
  barcode: '',
  category_name: '',
  price: '',
  stock_quantity: '',
  unit: '',
  expiry_date: '',
}

const INVENTORY_PAGE_SIZE = 10
const INVENTORY_PAGE_STATE_KEY = 'page-state:inventory'

function normalizeInventorySearchText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function inventoryItemMatchesSearch(item, searchQuery) {
  const normalizedQuery = normalizeInventorySearchText(searchQuery)

  if (!normalizedQuery) {
    return true
  }

  const searchableText = [
    item.product_name,
    item.name,
    item.product,
    item.barcode,
    item.sku,
    item.product_sku,
    item.category_name,
    item.category,
    item.branch_name,
    item.branch,
    item.unit,
    item.net_weight,
  ]
    .map(normalizeInventorySearchText)
    .filter(Boolean)
    .join(' ')

  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => searchableText.includes(token))
}

function InventoryPage() {
  const { user } = useAuth()
  const inventoryRequestRef = useRef(0)
  const inventoryLoadScopeRef = useRef('')
  const isAdminInventoryView = isAdminUser(user)
  const canEditCatalog = canManageInventoryCatalog(user)
  const canStockIn = canStockInInventory(user)
  const canAdjustStock = canAdjustInventoryStock(user)
  const [branchOptions, setBranchOptions] = useState(() => getCachedBranches() || [])
  const [isBranchLoading, setIsBranchLoading] = useState(
    () => (getCachedBranches() || []).length === 0,
  )
  const [branchLoadError, setBranchLoadError] = useState('')
  const [inventoryViewState, setInventoryViewState] = useSessionStorageState(
    INVENTORY_PAGE_STATE_KEY,
    () => ({
      activeBranchId: user?.branchId != null ? String(user.branchId) : '',
      activeFilter: INVENTORY_FILTER_ALL,
      activeCategory: INVENTORY_FILTER_ALL,
      searchQuery: '',
      currentPage: 1,
    }),
  )
  const initialInventoryResponse = getCachedInventoryItems(
    isAdminInventoryView ? {} : { branchId: user?.branchId ?? null },
  )
  const [inventoryItems, setInventoryItems] = useState(
    () => initialInventoryResponse?.items || initialInventoryResponse || [],
  )
  const [isLoading, setIsLoading] = useState(() => !initialInventoryResponse)
  const [productDialogMode, setProductDialogMode] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [formData, setFormData] = useState(INITIAL_PRODUCT_FORM)
  const [formError, setFormError] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackTone, setFeedbackTone] = useState('success')
  const [loadError, setLoadError] = useState('')
  const [quantityDialog, setQuantityDialog] = useState(null)
  const [quantityValue, setQuantityValue] = useState('')
  const [quantityExpiryDate, setQuantityExpiryDate] = useState('')
  const [quantityError, setQuantityError] = useState('')
  const [removeDialogItem, setRemoveDialogItem] = useState(null)
  const [removeError, setRemoveError] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)
  const activeBranchId =
    inventoryViewState?.activeBranchId ??
    (user?.branchId != null ? String(user.branchId) : '')
  const activeFilter = inventoryViewState?.activeFilter || INVENTORY_FILTER_ALL
  const activeCategory = inventoryViewState?.activeCategory || INVENTORY_FILTER_ALL
  const searchQuery = inventoryViewState?.searchQuery || ''
  const currentPage = Math.max(1, Number(inventoryViewState?.currentPage || 1))
  const updateInventoryViewState = useCallback((patch) => {
    setInventoryViewState((currentState) => ({
      ...(currentState || {}),
      ...(typeof patch === 'function' ? patch(currentState || {}) : patch),
    }))
  }, [setInventoryViewState])

  const activeBranch = useMemo(
    () =>
      branchOptions.find((branch) => String(branch.id) === String(activeBranchId)) ||
      null,
    [activeBranchId, branchOptions],
  )

  useEffect(() => {
    let isMounted = true

    const loadBranchOptions = async () => {
      try {
        setIsBranchLoading(true)
        const branches = await getBranches()

        if (!isMounted) {
          return
        }

        setBranchOptions(branches)
        setBranchLoadError('')
        updateInventoryViewState((currentState) => {
          const currentBranchId = currentState?.activeBranchId ?? ''

          if (user?.branchId) {
            return {
              ...currentState,
              activeBranchId: String(user.branchId),
            }
          }

          const hasCurrentBranch = branches.some(
            (branch) => String(branch.id) === String(currentBranchId),
          )

          if (hasCurrentBranch) {
            return currentState
          }

          return {
            ...currentState,
            activeBranchId: branches[0]?.id != null ? String(branches[0].id) : '',
          }
        })
      } catch (error) {
        console.error('Failed to load inventory branches:', error)

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

    loadBranchOptions()

    return () => {
      isMounted = false
    }
  }, [updateInventoryViewState, user?.branchId])

  useEffect(() => {
    if (!user?.branchId) {
      return
    }

    updateInventoryViewState((currentState) => (
      currentState?.activeBranchId === String(user.branchId)
        ? currentState
        : {
            ...currentState,
            activeBranchId: String(user.branchId),
          }
    ))
  }, [updateInventoryViewState, user?.branchId])

  const loadInventory = useCallback(async () => {
    const requestId = inventoryRequestRef.current + 1
    inventoryRequestRef.current = requestId

    try {
      const inventoryScope = isAdminInventoryView
        ? {}
        : { branchId: user?.branchId ?? null }
      const data = await getInventoryItems(inventoryScope)

      if (requestId !== inventoryRequestRef.current) {
        return
      }

      setInventoryItems(data.items || data)
      setLoadError('')
    } catch (error) {
      if (requestId !== inventoryRequestRef.current) {
        return
      }

      console.error('Failed to load inventory records:', error)
      setInventoryItems([])
      setLoadError(
        error.response?.data?.message ||
          'Inventory records could not be loaded right now.',
      )
    } finally {
      if (requestId === inventoryRequestRef.current) {
        setIsLoading(false)
      }
    }
  }, [isAdminInventoryView, user?.branchId])

  useEffect(() => {
    if (!activeBranchId) {
      return
    }

    const loadScopeKey = isAdminInventoryView
      ? 'admin'
      : `employee:${String(user?.branchId ?? '')}`

    if (inventoryLoadScopeRef.current === loadScopeKey) {
      return
    }

    inventoryLoadScopeRef.current = loadScopeKey
    if (!getCachedInventoryItems(isAdminInventoryView ? {} : { branchId: user?.branchId ?? null })) {
      setIsLoading(true)
    }
    void loadInventory()
  }, [activeBranchId, isAdminInventoryView, loadInventory, user?.branchId])

  const inventoryFilterResults = useMemo(
    () => resolveInventoryFilterResults({
      items: inventoryItems,
      branchId: isAdminInventoryView ? activeBranchId : '',
      status: activeFilter,
      category: activeCategory,
    }),
    [activeBranchId, activeCategory, activeFilter, inventoryItems, isAdminInventoryView],
  )

  useEffect(() => {
    if (activeCategory !== inventoryFilterResults.resolvedCategory) {
      updateInventoryViewState({
        activeCategory: inventoryFilterResults.resolvedCategory,
      })
    }
  }, [activeCategory, inventoryFilterResults.resolvedCategory, updateInventoryViewState])

  const effectiveActiveCategory = inventoryFilterResults.resolvedCategory
  const filteredItems = useMemo(
    () =>
      inventoryFilterResults.filteredItems.filter((item) =>
        inventoryItemMatchesSearch(item, searchQuery),
      ),
    [inventoryFilterResults.filteredItems, searchQuery],
  )

  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / INVENTORY_PAGE_SIZE),
  )

  useEffect(() => {
    updateInventoryViewState((currentState) => (
      Number(currentState?.currentPage || 1) === 1
        ? currentState
        : {
            ...currentState,
            currentPage: 1,
          }
    ))
  }, [activeBranchId, activeCategory, activeFilter, searchQuery, updateInventoryViewState])

  const totalBranchItems = inventoryFilterResults.branchItems.length
  const filterCategoryOptions = inventoryFilterResults.categoryOptions
  const lowStockItemCount = inventoryFilterResults.branchItems.filter(
    (item) => Number(item.stock_quantity || 0) <= Number(item.reorder_level || 0),
  ).length
  const expiringItemCount = inventoryFilterResults.branchItems.filter(
    (item) => String(item.expiry_date || item.expiration_date || '').trim() !== '',
  ).length
  const productCategoryOptions = useMemo(
    () => STANDARD_PRODUCT_CATEGORIES,
    [],
  )
  const selectedBranchId =
    activeBranchId === '' ? null : Number(activeBranchId)
  const selectedBranchName =
    activeBranch?.name ||
    (selectedBranchId === 2 ? 'Dollar' : selectedBranchId === 1 ? 'Sta. Lucia' : '')
  const activeFilterLabel =
    activeFilter === INVENTORY_FILTER_LOW_STOCK
      ? 'Low Stock'
      : activeFilter === INVENTORY_FILTER_EXPIRY_DATE
        ? 'Expiry Dates'
        : 'All Items'
  const activeCategoryLabel =
    effectiveActiveCategory === INVENTORY_FILTER_ALL
      ? 'All Categories'
      : effectiveActiveCategory

  useEffect(() => {
    if (currentPage > totalPages) {
      updateInventoryViewState({
        currentPage: totalPages,
      })
    }
  }, [currentPage, totalPages, updateInventoryViewState])

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * INVENTORY_PAGE_SIZE
    return filteredItems.slice(startIndex, startIndex + INVENTORY_PAGE_SIZE)
  }, [currentPage, filteredItems])

  const handleOpenAddProduct = () => {
    if (!canEditCatalog) {
      setFeedbackTone('warning')
      setFeedbackMessage(
        'Employee accounts can view assigned-branch inventory and record stock-in actions only.',
      )
      return
    }

    setFormError('')
    setFeedbackMessage('')
    setFormData(INITIAL_PRODUCT_FORM)
    setSelectedItem(null)
    setProductDialogMode('add')
  }

  const handleCloseProductDialog = () => {
    setFormError('')
    setSelectedItem(null)
    setProductDialogMode(null)
  }

  const handleOpenEditProduct = (item) => {
    if (!canEditCatalog) {
      setFeedbackTone('warning')
      setFeedbackMessage(
        'Employee accounts cannot edit product details. Use Stock In when inventory needs to be received.',
      )
      return
    }

    setFormError('')
    setFeedbackMessage('')
    setSelectedItem(item)
    setFormData({
      product_name: item.product_name || '',
      barcode: item.barcode || '',
      category_name: item.category_name || item.category || '',
      price: String(item.price ?? ''),
      stock_quantity: String(item.stock_quantity ?? ''),
      unit: item.unit || item.net_weight || '',
      expiry_date: item.expiry_date || item.expiration_date || '',
    })
    setProductDialogMode('edit')
  }

  const handleFieldChange = useCallback((event) => {
    const { name, value } = event.target

    if (formError) {
      setFormError('')
    }

    setFormData((previousForm) => ({
      ...previousForm,
      [name]: value,
    }))
  }, [formError])

  const handleSaveProduct = async (event) => {
    event.preventDefault()

    if (!canEditCatalog) {
      setFormError('Only administrator accounts can add or edit product records.')
      return
    }

    const validation = validateInventoryForm(formData)

    if (!validation.isValid) {
      setFormError(getFirstValidationError(validation.errors))
      return
    }

    if (
      hasInventoryCatalogConflict(
        {
          ...validation.sanitizedData,
          branch_id: selectedBranchId,
          branch_name: selectedBranchName,
        },
        inventoryItems,
        productDialogMode === 'edit' ? selectedItem?.id : null,
      )
      ) {
        setFormError(
        'A product with the same barcode or catalog details already exists in this branch. Use Stock In or Edit the existing record instead.',
        )
        return
      }

    try {
      if (productDialogMode === 'edit' && selectedItem) {
        const updatedItem = await updateInventoryItem(selectedItem.id, {
          ...validation.sanitizedData,
          branch_id: selectedBranchId,
          branch_name: selectedBranchName || selectedItem.branch_name || selectedItem.branch || '',
        })

        setInventoryItems((previousItems) =>
          previousItems.map((item) =>
            item.id === selectedItem.id ? updatedItem : item,
          ),
        )
        setFeedbackTone('success')
        setFeedbackMessage(`${updatedItem.product_name} was updated.`)
      } else {
        const createdItem = await createInventoryItem(
          {
            ...validation.sanitizedData,
            branch_id: selectedBranchId,
            branch_name: selectedBranchName,
          },
          inventoryItems,
        )

        setInventoryItems((previousItems) => [createdItem, ...previousItems])
        setFeedbackTone('success')
        setFeedbackMessage(
          `${createdItem.product_name} was added to ${selectedBranchName || 'the selected branch'}.`,
        )
      }
    } catch (error) {
      setFormError(
        error.response?.data?.message ||
          error.message ||
          'Unable to save this product.',
      )
      return
    }

    updateInventoryViewState({
      activeFilter: INVENTORY_FILTER_ALL,
    })
    setFormError('')
    setFormData(INITIAL_PRODUCT_FORM)
    setSelectedItem(null)
    setProductDialogMode(null)
  }

  const handleOpenQuantityDialog = (type, item) => {
    if (type === 'adjust-stock' && !canAdjustStock) {
      setFeedbackTone('warning')
      setFeedbackMessage('Only administrator accounts can adjust stock counts.')
      return
    }

    if (type === 'stock-in' && !canStockIn) {
      setFeedbackTone('warning')
      setFeedbackMessage('Your account cannot record stock-in actions.')
      return
    }

    setFeedbackMessage('')
    setQuantityError('')
    setSelectedItem(item)
    setQuantityValue('')
    setQuantityExpiryDate(item.expiry_date || item.expiration_date || '')
    setQuantityDialog(type)
  }

  const handleCloseQuantityDialog = () => {
    setQuantityDialog(null)
    setSelectedItem(null)
    setQuantityValue('')
    setQuantityExpiryDate('')
    setQuantityError('')
  }

  const handleOpenRemoveDialog = (item) => {
    if (!canEditCatalog) {
      setFeedbackTone('warning')
      setFeedbackMessage(
        'Employee accounts cannot remove products from inventory.',
      )
      return
    }

    setFeedbackMessage('')
    setRemoveError('')
    setSelectedItem(item)
    setRemoveDialogItem(item)
  }

  const handleCloseRemoveDialog = () => {
    setRemoveDialogItem(null)
    setSelectedItem(null)
    setRemoveError('')
    setIsRemoving(false)
  }

  const handleSubmitQuantityDialog = async (event) => {
    event.preventDefault()

    if (quantityDialog === 'adjust-stock' && !canAdjustStock) {
      setQuantityError('Only administrator accounts can adjust stock counts.')
      return
    }

    if (quantityDialog === 'stock-in' && !canStockIn) {
      setQuantityError('Your account cannot record stock-in actions.')
      return
    }

    const validation = validateInventoryQuantityAction({
      selectedItem,
      quantityValue,
      mode: quantityDialog,
    })

    if (!validation.isValid) {
      setQuantityError(getFirstValidationError(validation.errors))
      return
    }

    const parsedAmount = validation.sanitizedAmount
    const requiresBatchExpiry =
      quantityDialog === 'stock-in' ||
      (quantityDialog === 'adjust-stock' &&
        parsedAmount > Number(selectedItem?.stock_quantity || 0))

    if (requiresBatchExpiry && !quantityExpiryDate) {
      setQuantityError('Select an expiration date for the inventory batch.')
      return
    }

    try {
      const updatedItem = await updateInventoryStock(selectedItem.id, parsedAmount, {
        mode: quantityDialog,
        expirationDate: quantityExpiryDate,
        user,
      })

      setInventoryItems((previousItems) =>
        previousItems.map((item) =>
          item.id === selectedItem.id ? updatedItem : item,
        ),
      )

      if (quantityDialog === 'stock-in') {
        setFeedbackMessage(
          `${selectedItem.product_name} increased by ${parsedAmount} unit${
            parsedAmount === 1 ? '' : 's'
          }.`,
        )
      } else {
        setFeedbackMessage(
          `${selectedItem.product_name} stock is now ${updatedItem.stock_quantity}.`,
        )
      }

      setFeedbackTone('success')
      handleCloseQuantityDialog()
    } catch (error) {
      setQuantityError(
        error.response?.data?.message ||
          error.message ||
          'Unable to update this stock quantity.',
      )
    }
  }

  const handleConfirmRemove = async () => {
    if (!removeDialogItem) {
      return
    }

    if (!canEditCatalog) {
      setRemoveError('Only administrator accounts can remove product records.')
      return
    }

    try {
      setIsRemoving(true)
      const removedItem = await removeInventoryItem(removeDialogItem.id)

      setInventoryItems((previousItems) =>
        previousItems.filter((item) => item.id !== removeDialogItem.id),
      )
      setFeedbackTone('success')
      setFeedbackMessage(
        `${removedItem.product_name} was removed from ${
          activeBranch?.name || removeDialogItem.branch_name || 'the selected branch'
        } inventory.`,
      )
      handleCloseRemoveDialog()
    } catch (error) {
      setRemoveError(
        error.response?.data?.message ||
          error.message ||
          'Unable to remove this inventory item.',
      )
      setIsRemoving(false)
    }
  }

  if (isBranchLoading && branchOptions.length === 0) {
    return <Loader message="Loading branch scope..." />
  }

  if (!isBranchLoading && !activeBranchId) {
    return (
      <EmptyState
        title="No branch scope available"
        description="Add at least one branch before opening the inventory screen."
      />
    )
  }

  return (
    <section className="inventory-page">
      <div className="inventory-topbar">
        <div className="inventory-title-block">
          <p className="eyebrow">Inventory</p>
          <h1>Inventory</h1>
          <p className="supporting-text">
            {isAdminInventoryView
              ? 'Manage stock, expiry dates, and branch inventory.'
              : 'View assigned branch inventory and monitor low-stock items.'}
          </p>
        </div>

        <div className="inventory-meta-grid">
            <article className="inventory-meta-card">
              <span className="meta-label">Active Branch</span>
              <strong className="meta-primary">
                {activeBranch?.name || 'Branch pending'}
              </strong>
              <span className="meta-secondary">
                {user?.branchId
                  ? 'Assigned branch for your account.'
                  : 'Selected branch for stock management.'}
              </span>
            </article>

          <article className="inventory-meta-card">
            <span className="meta-label">Visible Products</span>
            <strong className="meta-primary">{filteredItems.length}</strong>
            <span className="meta-secondary">
              Based on filters and search.
            </span>
          </article>

            {isAdminInventoryView ? (
              <article className="inventory-meta-card inventory-meta-card--action">
                <span className="meta-label">Catalog Action</span>
                <strong className="meta-primary">Add Product</strong>
                <span className="meta-secondary">
                  Add a new product to this branch.
                </span>
                <button
                  type="button"
                  className="inventory-primary-action"
                  onClick={handleOpenAddProduct}
                  disabled={!activeBranchId}
                >
                  Add Product
                </button>
              </article>
            ) : (
              <article className="inventory-meta-card">
                <span className="meta-label">Stock Permission</span>
                <strong className="meta-primary">Stock In Only</strong>
                <span className="meta-secondary">
                  Manual stock adjustment is reserved for administrators.
                </span>
              </article>
            )}
          </div>
        </div>

      {loadError ? (
        <NoticeBanner
          variant="error"
          title="Inventory data unavailable"
          message={loadError}
        />
      ) : null}

      {branchLoadError ? (
        <NoticeBanner
          variant="error"
          title="Branch scope unavailable"
          message={branchLoadError}
        />
      ) : null}

      {feedbackMessage ? (
        <NoticeBanner
          variant={feedbackTone}
          title="Inventory update"
          message={feedbackMessage}
        />
      ) : null}

      <div className="panel inventory-toolbar-panel">
        <div className="inventory-toolbar-heading">
          <div>
            <p className="card-label">Inventory Controls</p>
            <h2>Stock Workspace</h2>
            <p className="supporting-text inventory-controls-copy">
              Current branch stock, status, and category scope.
            </p>
          </div>

          <div className="inventory-active-scope" aria-label="Active inventory filters">
            <span>{selectedBranchName || 'Branch pending'}</span>
            <strong>{activeFilterLabel}</strong>
            <span>{activeCategoryLabel}</span>
          </div>
        </div>

        <div className="inventory-overview-grid">
          <div className="inventory-overview-card">
            <span className="inventory-overview-label">Visible Products</span>
            <strong>{filteredItems.length}</strong>
            <span className="inventory-overview-meta">
              {totalBranchItems !== filteredItems.length
                ? `${totalBranchItems} in branch`
                : 'Current result'}
            </span>
          </div>

          <div className="inventory-overview-card">
            <span className="inventory-overview-label">Categories</span>
            <strong>{filterCategoryOptions.length}</strong>
            <span className="inventory-overview-meta">Available filters</span>
          </div>

          <div className="inventory-overview-card">
            <span className="inventory-overview-label">Low Stock</span>
            <strong>{lowStockItemCount}</strong>
            <span className="inventory-overview-meta">At reorder level</span>
          </div>

          <div className="inventory-overview-card">
            <span className="inventory-overview-label">With Expiry</span>
            <strong>{expiringItemCount}</strong>
            <span className="inventory-overview-meta">Date tracked</span>
          </div>
        </div>

        <div className="inventory-toolbar">
          <div className="inventory-control-sections">
            <section className="inventory-control-section inventory-control-section--search">
              <div className="inventory-control-section-header">
                <strong>Product Search</strong>
                <span>{searchQuery ? 'Filtered' : 'All products'}</span>
              </div>

              <label className="inventory-search-control" htmlFor="inventory-product-search">
                <span>Search</span>
                <input
                  id="inventory-product-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) =>
                    updateInventoryViewState({
                      searchQuery: event.target.value,
                    })
                  }
                  placeholder="Search product name, barcode, or category..."
                  disabled={isLoading}
                  autoComplete="off"
                />
              </label>

              {searchQuery ? (
                <button
                  type="button"
                  className="inventory-search-clear"
                  onClick={() =>
                    updateInventoryViewState({
                      searchQuery: '',
                    })
                  }
                  disabled={isLoading}
                >
                  Clear Search
                </button>
              ) : null}
            </section>

            <section className="inventory-control-section">
              <div className="inventory-control-section-header">
                <strong>Branch Scope</strong>
                <span>{user?.branchId ? 'Account branch' : selectedBranchName || 'Select branch'}</span>
              </div>

            {user?.branchId ? (
              <div className="inventory-category-control inventory-category-control--locked">
                <span>Branch</span>
                <strong>{activeBranch?.name || user?.branchName || 'Assigned branch'}</strong>
              </div>
            ) : (
              <label className="inventory-category-control">
                <span>Branch</span>
                <SelectMenu
                  name="activeBranch"
                  value={activeBranchId}
                  onChange={(event) =>
                    updateInventoryViewState({
                      activeBranchId: String(event.target.value),
                    })
                  }
                  disabled={isLoading}
                  options={branchOptions.map((branch) => ({
                    value: String(branch.id),
                    label: branch.name,
                  }))}
                />
              </label>
            )}
            </section>

            <section className="inventory-control-section inventory-control-section--status">
              <div className="inventory-control-section-header">
                <strong>Stock View</strong>
                <span>{activeFilterLabel}</span>
              </div>

              <div className="inventory-filter-group" role="group" aria-label="Stock status filters">
                <button
                  type="button"
                  className={
                    activeFilter === INVENTORY_FILTER_ALL
                      ? 'inventory-filter active'
                      : 'inventory-filter'
                  }
                  onClick={() =>
                    updateInventoryViewState({
                      activeFilter: INVENTORY_FILTER_ALL,
                    })
                  }
                  disabled={isLoading}
                >
                  All Items
                </button>
                <button
                  type="button"
                  className={
                    activeFilter === INVENTORY_FILTER_LOW_STOCK
                      ? 'inventory-filter active'
                      : 'inventory-filter'
                  }
                  onClick={() =>
                    updateInventoryViewState({
                      activeFilter: INVENTORY_FILTER_LOW_STOCK,
                    })
                  }
                  disabled={isLoading}
                >
                  Low Stock
                </button>
                <button
                  type="button"
                  className={
                    activeFilter === INVENTORY_FILTER_EXPIRY_DATE
                      ? 'inventory-filter active'
                      : 'inventory-filter'
                  }
                  onClick={() =>
                    updateInventoryViewState({
                      activeFilter: INVENTORY_FILTER_EXPIRY_DATE,
                    })
                  }
                  disabled={isLoading}
                >
                  Expiry Dates
                </button>
              </div>
            </section>

            <section className="inventory-control-section">
              <div className="inventory-control-section-header">
                <strong>Category Filter</strong>
                <span>{activeCategoryLabel}</span>
              </div>

              <label className="inventory-category-control inventory-category-control--category-filter">
                <span>Category</span>
                <SelectMenu
                  name="activeCategory"
                  value={effectiveActiveCategory}
                  onChange={(event) =>
                    updateInventoryViewState({
                      activeCategory: event.target.value,
                    })
                  }
                  disabled={isLoading || filterCategoryOptions.length === 0}
                  options={[
                    { value: INVENTORY_FILTER_ALL, label: 'All Categories' },
                    ...filterCategoryOptions.map((category) => ({
                      value: category,
                      label: category,
                    })),
                  ]}
                />
              </label>
            </section>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Loader message="Loading inventory..." />
      ) : loadError ? (
        <EmptyState
          title="Inventory records are unavailable"
          description="The current inventory list could not be loaded. Check the data source and try again."
        />
      ) : (
        <>
          <InventoryTable
            items={paginatedItems}
            canEditCatalog={canEditCatalog}
            canStockIn={canStockIn}
            canAdjustStock={canAdjustStock}
            onStockIn={(item) => handleOpenQuantityDialog('stock-in', item)}
            onEdit={handleOpenEditProduct}
            onAdjustStock={(item) => handleOpenQuantityDialog('adjust-stock', item)}
            onRemove={handleOpenRemoveDialog}
            emptyTitle={searchQuery ? 'No products match this search' : undefined}
            emptyDescription={
              searchQuery
                ? 'Try a different product name, barcode, category, or branch keyword.'
                : undefined
            }
          />

          {filteredItems.length > 0 ? (
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredItems.length}
              pageSize={INVENTORY_PAGE_SIZE}
              onPageChange={(page) =>
                updateInventoryViewState({
                  currentPage: page,
                })
              }
              summaryLabel="products"
            />
          ) : null}
        </>
      )}

      <Modal
        isOpen={Boolean(productDialogMode)}
        eyebrow="Product"
        title={productDialogMode === 'edit' ? 'Edit Product' : 'Add Product'}
        description={
          productDialogMode === 'edit'
            ? 'Update the product details for this branch.'
            : 'Add a product to the selected branch.'
        }
        onClose={handleCloseProductDialog}
      >
        <form className="inventory-form" onSubmit={handleSaveProduct}>
          <label className="inventory-field">
            <span>Product Name</span>
            <input
              type="text"
              name="product_name"
              value={formData.product_name}
              onChange={handleFieldChange}
              placeholder="Kimchi"
              aria-invalid={Boolean(formError)}
            />
          </label>

          <label className="inventory-field">
            <span>Barcode</span>
            <input
              type="text"
              name="barcode"
              value={formData.barcode}
              onChange={handleFieldChange}
              placeholder="Scan or enter barcode"
              aria-invalid={Boolean(formError)}
              inputMode="text"
              autoComplete="off"
            />
          </label>

          <label className="inventory-field">
            <span>Category</span>
            <SelectMenu
              name="category_name"
              value={formData.category_name}
              onChange={handleFieldChange}
              aria-invalid={Boolean(formError)}
              placeholder="Select a category"
              options={[
                { value: '', label: 'Select a category' },
                ...productCategoryOptions.map((category) => ({
                  value: category,
                  label: category
                }))
              ]}
            />
          </label>

          <label className="inventory-field">
            <span>Stock Quantity</span>
            <input
              type="number"
              min="0"
              name="stock_quantity"
              value={formData.stock_quantity}
              onChange={handleFieldChange}
              placeholder="25"
              aria-invalid={Boolean(formError)}
            />
          </label>

          <label className="inventory-field">
            <span>Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              name="price"
              value={formData.price}
              onChange={handleFieldChange}
              placeholder="109"
              aria-invalid={Boolean(formError)}
            />
          </label>

          <label className="inventory-field">
            <span>Unit / Pack Size</span>
            <input
              type="text"
              name="unit"
              value={formData.unit}
              onChange={handleFieldChange}
              placeholder="pack"
              aria-invalid={Boolean(formError)}
            />
          </label>

          <label className="inventory-field">
            <span>Expiry Date</span>
            <input
              type="date"
              name="expiry_date"
              value={formData.expiry_date}
              onChange={handleFieldChange}
              aria-invalid={Boolean(formError)}
            />
          </label>

          {formError ? (
            <p className="inventory-form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="inventory-form-actions">
            <button
              type="button"
              className="inventory-secondary-action"
              onClick={handleCloseProductDialog}
            >
              Cancel
            </button>
            <button type="submit" className="inventory-primary-action">
              {productDialogMode === 'edit' ? 'Save Changes' : 'Save Product'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(quantityDialog)}
        eyebrow="Inventory Action"
        title={quantityDialog === 'stock-in' ? 'Stock In Item' : 'Adjust Stock'}
        description={`${selectedItem?.product_name || 'Selected item'} currently has ${
          selectedItem?.stock_quantity ?? 0
        } in stock.`}
        onClose={handleCloseQuantityDialog}
        width="520px"
      >
        <form
          className="inventory-form inventory-action-form"
          onSubmit={handleSubmitQuantityDialog}
        >
          <label className="inventory-field">
              <span>
                {quantityDialog === 'stock-in'
                  ? 'Quantity to Add'
                  : 'New Stock Quantity'}
              </span>
            <input
              type="number"
              step="1"
              name="quantityValue"
              value={quantityValue}
              onChange={(event) => {
                if (quantityError) {
                  setQuantityError('')
                }

                setQuantityValue(event.target.value)
              }}
              placeholder={quantityDialog === 'stock-in' ? '5' : '12'}
              aria-invalid={Boolean(quantityError)}
            />
          </label>

          <label className="inventory-field">
            <span>
              {quantityDialog === 'stock-in'
                ? 'Batch Expiry Date'
                : 'Expiry Date for Added Stock'}
            </span>
            <input
              type="date"
              name="quantityExpiryDate"
              value={quantityExpiryDate}
              onChange={(event) => {
                if (quantityError) {
                  setQuantityError('')
                }

                setQuantityExpiryDate(event.target.value)
              }}
              aria-invalid={Boolean(quantityError)}
            />
          </label>

          {quantityError ? (
            <p className="inventory-form-error" role="alert">
              {quantityError}
            </p>
          ) : null}

          <div className="inventory-form-actions">
            <button
              type="button"
              className="inventory-secondary-action"
              onClick={handleCloseQuantityDialog}
            >
              Cancel
            </button>
            <button type="submit" className="inventory-primary-action">
              {quantityDialog === 'stock-in' ? 'Apply Stock In' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(removeDialogItem)}
        eyebrow="Inventory Action"
        title="Remove Product"
        description={`This will permanently remove ${
          removeDialogItem?.product_name || 'the selected product'
        } from the current branch inventory.`}
        onClose={handleCloseRemoveDialog}
        width="520px"
      >
        <div className="inventory-form inventory-action-form">
          <p className="inventory-remove-copy">
            This action removes the product record itself, including its current stock
            quantity, from the inventory list.
          </p>

          {removeError ? (
            <p className="inventory-form-error" role="alert">
              {removeError}
            </p>
          ) : null}

          <div className="inventory-form-actions">
            <button
              type="button"
              className="inventory-secondary-action"
              onClick={handleCloseRemoveDialog}
              disabled={isRemoving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inventory-danger-action"
              onClick={handleConfirmRemove}
              disabled={isRemoving}
            >
              {isRemoving ? 'Removing...' : 'Remove Product'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}

export default InventoryPage
