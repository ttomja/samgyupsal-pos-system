import { peso } from '../../../shared/utils/formatters'

function SummaryCards({ summary }) {
  const cards = [
    {
      label: "Today's Sales",
      value: peso(summary?.daily_sales || 0),
      note: `${summary?.daily_items_sold || 0} sold / ${summary?.daily_items_deducted || 0} deducted today.`,
    },
    {
      label: "This Week's Sales",
      value: peso(summary?.weekly_sales || 0),
      note: `${summary?.weekly_items_sold || 0} sold / ${summary?.weekly_items_deducted || 0} deducted this week.`,
    },
    {
      label: "This Month's Sales",
      value: peso(summary?.monthly_sales || 0),
      note: `${summary?.monthly_items_sold || 0} sold / ${summary?.monthly_items_deducted || 0} deducted this month.`,
    },
    {
      label: 'Transactions',
      value: summary?.transaction_count || 0,
      note: 'Completed checkout records in the selected period.',
    },
    {
      label: 'Items Sold',
      value: summary?.items_sold || 0,
      note: `${summary?.items_deducted || 0} inventory unit${Number(summary?.items_deducted || 0) === 1 ? '' : 's'} deducted in the selected period.`,
    },
    {
      label: 'Low Stock Items',
      value: summary?.low_stock_count || 0,
      note: 'Catalog items currently sitting at or below risk level.',
    },
    {
      label: 'Stockout Alerts',
      value: summary?.predictive_stockout_count || 0,
      note: 'Items projected to run out soon based on recent sales velocity.',
    },
    {
      label: 'Near Expiry',
      value: summary?.near_expiry_count || 0,
      note: 'Available batches inside the expiry warning window.',
    },
  ]

  return (
    <div className="reports-summary-grid">
      {cards.map((card) => (
        <article key={card.label} className="summary-card info-card">
          <p className="card-label">{card.label}</p>
          <h3>{card.value}</h3>
          <p className="summary-card-note">{card.note}</p>
        </article>
      ))}
    </div>
  )
}

export default SummaryCards
