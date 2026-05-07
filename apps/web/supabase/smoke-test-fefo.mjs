import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function parseEnv(filePath) {
  const values = {}

  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) {
      continue
    }

    const [key, ...rest] = trimmedLine.split('=')
    values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
  }

  return values
}

function toQueryString(params = {}) {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    query.set(key, value)
  })

  return query.toString()
}

async function request({ supabaseUrl, supabaseKey, method = 'GET', pathName, token, body, prefer, params }) {
  const url = `${supabaseUrl}${pathName}${params ? `?${toQueryString(params)}` : ''}`
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${token}`,
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (prefer) {
    headers.Prefer = prefer
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(`${method} ${pathName} failed (${response.status}): ${JSON.stringify(data)}`)
  }

  return data
}

async function rpc(context, name, body) {
  return request({
    ...context,
    method: 'POST',
    pathName: `/rest/v1/rpc/${name}`,
    body,
  })
}

async function signIn({ supabaseUrl, supabaseKey, email, password }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(`Auth failed (${response.status}): ${JSON.stringify(data)}`)
  }

  return data
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const env = parseEnv(path.join(appRoot, '.env'))
const supabaseUrl = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
const email = process.env.FEFO_SMOKE_EMAIL
const password = process.env.FEFO_SMOKE_PASSWORD
const branchId = Number(process.env.FEFO_SMOKE_BRANCH_ID || env.VITE_SUPABASE_DEFAULT_BRANCH_ID || 1)
const unitPrice = 99
const productName = `FEFO Smoke Test Product ${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL/key missing from apps/web/.env')
}

if (!email || !password) {
  throw new Error('Set FEFO_SMOKE_EMAIL and FEFO_SMOKE_PASSWORD before running this smoke test.')
}

const authData = await signIn({ supabaseUrl, supabaseKey, email, password })
const token = authData.access_token
const userId = authData.user?.id

if (!token || !userId) {
  throw new Error('No token/user id returned from auth.')
}

const context = {
  supabaseUrl,
  supabaseKey,
  token,
}

const [profile] = await request({
  ...context,
  pathName: '/rest/v1/profiles',
  params: {
    select: 'id,full_name,username,role_key,branch_id,status',
    id: `eq.${userId}`,
    limit: '1',
  },
})

if (!profile || profile.status !== 'active') {
  throw new Error('The smoke-test account profile is missing or inactive.')
}

const [branch] = await request({
  ...context,
  pathName: '/rest/v1/branches',
  params: {
    select: 'id,name',
    id: `eq.${branchId}`,
    limit: '1',
  },
})

if (!branch) {
  throw new Error(`Branch ${branchId} does not exist.`)
}

const [product] = await request({
  ...context,
  method: 'POST',
  pathName: '/rest/v1/products',
  prefer: 'return=representation',
  params: { select: '*' },
  body: {
    branch_id: branch.id,
    branch: branch.name,
    category: 'Uncategorized',
    product_name: productName,
    net_weight: 'test pack',
    price: unitPrice,
    stock_quantity: 0,
    expiration_date: '2026-05-15',
    reorder_level: 1,
    is_active: true,
  },
})

if (!product?.id) {
  throw new Error('Product insert did not return an id.')
}

const stockInRows = [
  { quantity: 3, expirationDate: '2026-05-15', note: 'FEFO smoke test earliest batch' },
  { quantity: 5, expirationDate: '2026-06-15', note: 'FEFO smoke test second batch' },
]

for (const row of stockInRows) {
  await rpc(context, 'stock_in_inventory_batch', {
    p_product_id: product.id,
    p_branch_id: branch.id,
    p_quantity: row.quantity,
    p_expiration_date: row.expirationDate,
    p_stock_in_date: '2026-05-04',
    p_notes: row.note,
  })
}

const beforeBatches = await request({
  ...context,
  pathName: '/rest/v1/inventory_batches',
  params: {
    select: 'id,product_id,branch_id,batch_code,quantity_received,quantity_on_hand,expiration_date,stock_in_date,source,notes,created_at',
    product_id: `eq.${product.id}`,
    order: 'expiration_date.asc,id.asc',
  },
})

const checkoutSale = {
  cashier_id: userId,
  cashier_name: profile.full_name || profile.username || email,
  branch_id: branch.id,
  branch_name: branch.name,
  payment_method: 'cash',
  subtotal: 5 * unitPrice,
  discount: 0,
  total_amount: 5 * unitPrice,
  cash_received: 500,
  change_amount: 500 - 5 * unitPrice,
  submitted_at: new Date().toISOString(),
  notes: 'FEFO smoke test checkout',
}
const checkoutItems = [
  {
    product_id: product.id,
    inventory_item_id: product.id,
    item_name: product.product_name,
    quantity: 5,
    unit_price: unitPrice,
    line_total: 5 * unitPrice,
  },
]
const checkoutResult = await rpc(context, 'create_checkout_sale', {
  p_sale: checkoutSale,
  p_items: checkoutItems,
})
const saleId = checkoutResult?.sale?.id
const saleItemId = checkoutResult?.items?.[0]?.id

const afterBatches = await request({
  ...context,
  pathName: '/rest/v1/inventory_batches',
  params: {
    select: 'id,product_id,branch_id,batch_code,quantity_received,quantity_on_hand,expiration_date,stock_in_date,source,notes,created_at',
    product_id: `eq.${product.id}`,
    order: 'expiration_date.asc,id.asc',
  },
})
const allocations = await request({
  ...context,
  pathName: '/rest/v1/sale_item_batch_allocations',
  params: {
    select: '*',
    sale_id: `eq.${saleId}`,
    order: 'id.asc',
  },
})
const movements = await request({
  ...context,
  pathName: '/rest/v1/inventory_movements',
  params: {
    select: 'id,product_id,batch_id,branch_id,movement_type,quantity_delta,quantity_after,sale_id,sale_item_id,reference,notes,created_at',
    product_id: `eq.${product.id}`,
    order: 'created_at.asc,id.asc',
  },
})
const [syncedProduct] = await request({
  ...context,
  pathName: '/rest/v1/products',
  params: {
    select: 'id,product_name,branch_id,branch,stock_quantity',
    id: `eq.${product.id}`,
    limit: '1',
  },
})

const expectedFefo =
  beforeBatches?.[0]?.quantity_on_hand === 3 &&
  beforeBatches?.[1]?.quantity_on_hand === 5 &&
  afterBatches?.[0]?.quantity_on_hand === 0 &&
  afterBatches?.[1]?.quantity_on_hand === 3
const expectedAllocations =
  allocations?.length === 2 &&
  allocations?.[0]?.quantity === 3 &&
  allocations?.[1]?.quantity === 2

console.log(JSON.stringify({
  ok: Boolean(expectedFefo && expectedAllocations),
  repoRoot,
  branch,
  profile: {
    id: profile.id,
    role_key: profile.role_key,
    branch_id: profile.branch_id,
    status: profile.status,
  },
  product: syncedProduct,
  sale: {
    id: saleId,
    sale_item_id: saleItemId,
    total_amount: checkoutResult?.sale?.total_amount,
  },
  beforeBatches,
  afterBatches,
  allocations,
  movements,
  checks: {
    expectedFefo,
    expectedAllocations,
    firstBatchConsumed: afterBatches?.[0]?.quantity_on_hand === 0,
    secondBatchRemainder: afterBatches?.[1]?.quantity_on_hand,
    aggregateProductStock: syncedProduct?.stock_quantity,
  },
}, null, 2))
