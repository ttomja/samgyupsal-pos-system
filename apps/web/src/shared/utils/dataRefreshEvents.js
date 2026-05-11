export const DATA_REFRESH_EVENT_NAME = 'samgyupsal:data-refresh'

export function emitDataRefresh(detail = {}) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent(DATA_REFRESH_EVENT_NAME, {
      detail,
    }),
  )
}

export function subscribeToDataRefresh(callback) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleRefreshEvent = (event) => {
    callback(event.detail || {})
  }

  window.addEventListener(DATA_REFRESH_EVENT_NAME, handleRefreshEvent)

  return () => {
    window.removeEventListener(DATA_REFRESH_EVENT_NAME, handleRefreshEvent)
  }
}
