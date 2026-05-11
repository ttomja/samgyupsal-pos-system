export const ROLE_ADMIN = 'admin'
export const ROLE_EMPLOYEE = 'employee'
export const ROLE_UNKNOWN = 'unknown'

const ROLE_LABELS = {
  [ROLE_ADMIN]: 'Administrator',
  [ROLE_EMPLOYEE]: 'Employee',
  [ROLE_UNKNOWN]: 'Unassigned Role',
}

export const APP_NAV_ITEMS = [
  {
    key: 'dashboard',
    to: '/app/dashboard',
    label: 'Dashboard',
    shortLabel: 'DB',
    allowedRoles: [ROLE_ADMIN, ROLE_EMPLOYEE],
  },
  {
    key: 'pos',
    to: '/app/pos',
    label: 'Sales',
    shortLabel: 'SLS',
    allowedRoles: [ROLE_ADMIN, ROLE_EMPLOYEE],
  },
  {
    key: 'inventory',
    to: '/app/inventory',
    label: 'Inventory',
    shortLabel: 'INV',
    allowedRoles: [ROLE_ADMIN, ROLE_EMPLOYEE],
  },
  {
    key: 'reports',
    to: '/app/reports',
    label: 'Reports',
    shortLabel: 'RPT',
    allowedRoles: [ROLE_ADMIN, ROLE_EMPLOYEE],
  },
  {
    key: 'products',
    to: '/app/products',
    label: 'Products',
    shortLabel: 'PRD',
    allowedRoles: [ROLE_ADMIN],
  },
  {
    key: 'users',
    to: '/app/users',
    label: 'Users',
    shortLabel: 'USR',
    allowedRoles: [ROLE_ADMIN],
  },
]

export function normalizeRoleKey(value) {
  const rawValue =
    typeof value === 'object' && value !== null
      ? value.roleKey || value.role
      : value

  const normalizedValue = String(rawValue || '')
    .trim()
    .toLowerCase()

  if (
    normalizedValue === ROLE_ADMIN ||
    normalizedValue === 'administrator'
  ) {
    return ROLE_ADMIN
  }

  if (
    normalizedValue === ROLE_EMPLOYEE ||
    normalizedValue === 'employee' ||
    normalizedValue === 'cashier'
  ) {
    return ROLE_EMPLOYEE
  }

  return ROLE_UNKNOWN
}

export function getRoleLabel(role) {
  return ROLE_LABELS[normalizeRoleKey(role)] || ROLE_LABELS[ROLE_UNKNOWN]
}

export function isKnownRoleKey(role) {
  const roleKey = normalizeRoleKey(role)
  return roleKey === ROLE_ADMIN || roleKey === ROLE_EMPLOYEE
}

export function isAdminUser(user) {
  return normalizeRoleKey(user) === ROLE_ADMIN
}

export function isEmployeeUser(user) {
  return normalizeRoleKey(user) === ROLE_EMPLOYEE
}

export function canManageInventoryCatalog(user) {
  return isAdminUser(user)
}

export function canStockInInventory(user) {
  return isAdminUser(user) || isEmployeeUser(user)
}

export function canAdjustInventoryStock(user) {
  return isAdminUser(user)
}

export function canAccessAppSection(user, sectionKey) {
  const section = APP_NAV_ITEMS.find((item) => item.key === sectionKey)

  if (!section || !user) {
    return false
  }

  return section.allowedRoles.includes(normalizeRoleKey(user))
}

export function getVisibleNavItems(user) {
  return APP_NAV_ITEMS.filter((item) => canAccessAppSection(user, item.key))
}

export function getDefaultAppPath(user) {
  const firstAccessibleItem = getVisibleNavItems(user)[0]
  return firstAccessibleItem?.to || '/'
}
