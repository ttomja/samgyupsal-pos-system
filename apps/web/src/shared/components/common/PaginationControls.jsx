function buildPaginationItems(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, 'end-ellipsis', totalPages]
  }

  if (currentPage >= totalPages - 2) {
    return [1, 'start-ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }

  return [
    1,
    'start-ellipsis',
    currentPage - 1,
    currentPage,
    currentPage + 1,
    'end-ellipsis',
    totalPages,
  ]
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  summaryLabel = 'results',
}) {
  if (totalItems <= 0) {
    return null
  }

  const pageStart = (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalItems)
  const visibleItems = buildPaginationItems(currentPage, totalPages)

  return (
    <div className="app-pagination">
      <p className="app-pagination-summary">
        Showing {pageStart}-{pageEnd} of {totalItems} {summaryLabel}
      </p>

      <div className="app-pagination-controls">
        <button
          type="button"
          className="app-pagination-button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          aria-label="Go to previous page"
        >
          Previous
        </button>

        {visibleItems.map((item) => {
          if (typeof item !== 'number') {
            return (
              <span
                key={item}
                className="app-pagination-ellipsis"
              >
                ...
              </span>
            )
          }

          return (
            <button
              key={item}
              type="button"
              className={
                item === currentPage
                  ? 'app-pagination-button active'
                  : 'app-pagination-button'
              }
              onClick={() => onPageChange(item)}
              aria-label={`Go to page ${item}`}
              aria-current={item === currentPage ? 'page' : undefined}
            >
              {item}
            </button>
          )
        })}

        <button
          type="button"
          className="app-pagination-button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          aria-label="Go to next page"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default PaginationControls
