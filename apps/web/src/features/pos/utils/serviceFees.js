export const SERVICE_FEE_PREFIX = 'Service Fee - '
export const serviceFeeOptions = [
  {
    value: 'self_service_cooking',
    label: 'Self-Service Cooking',
    amount: 10,
    note: 'Standard for ramen and noodles',
    itemName: `${SERVICE_FEE_PREFIX}Self-Service Cooking`,
  },
  {
    value: 'microwave_usage',
    label: 'Microwave Usage',
    amount: 5,
    note: 'Optional reheating fee',
    itemName: `${SERVICE_FEE_PREFIX}Microwave Usage`,
  },
]

export function isServiceFeeLineItem(item = {}) {
  const lineName = String(
    item.item_name || item.itemName || item.name || item.item || '',
  )
    .trim()
    .toLowerCase()

  return (
    item.is_service_fee === true ||
    lineName.startsWith(SERVICE_FEE_PREFIX.toLowerCase())
  )
}

export function normalizeServiceFeeQuantities(selectedFees = {}) {
  if (Array.isArray(selectedFees)) {
    return selectedFees.reduce((quantityMap, fee) => {
      if (typeof fee === 'string') {
        quantityMap[fee] = Math.max(1, Number(quantityMap[fee] || 0))
        return quantityMap
      }

      const feeKey = fee?.value ?? fee?.fee_key ?? fee?.key
      const quantity = Math.max(0, Number(fee?.quantity || 0))

      if (feeKey && quantity > 0) {
        quantityMap[feeKey] = quantity
      }

      return quantityMap
    }, {})
  }

  if (selectedFees && typeof selectedFees === 'object') {
    return Object.entries(selectedFees).reduce((quantityMap, [feeKey, quantity]) => {
      const normalizedQuantity = Math.max(0, Number(quantity || 0))

      if (normalizedQuantity > 0) {
        quantityMap[feeKey] = normalizedQuantity
      }

      return quantityMap
    }, {})
  }

  return {}
}

export function buildServiceFeeLineItems(selectedFees = []) {
  const selectedFeeQuantities = normalizeServiceFeeQuantities(selectedFees)

  return serviceFeeOptions
    .filter((option) => Number(selectedFeeQuantities[option.value] || 0) > 0)
    .map((option) => ({
      product_id: null,
      quantity: Number(selectedFeeQuantities[option.value] || 0),
      unit_price: Number(option.amount),
      line_total:
        Number(option.amount) * Number(selectedFeeQuantities[option.value] || 0),
      item_name: option.itemName,
      is_service_fee: true,
      fee_key: option.value,
    }))
}
