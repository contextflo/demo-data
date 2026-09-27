// Moves the snapshot in time so it ends the day before `anchor`.
//
// Every date and timestamp moves by the same whole number of days, so ordering
// and gaps are exact: an order still ships 0-2 days after it is placed, a return
// still lands 4-21 days later. Text that spells out a date (order numbers,
// campaign names, discount codes) is relabeled to match.
//
// Seasonality moves with the data: the snapshot's April peak lands wherever the
// shift puts April. Load with the snapshot's own anchor (the day after
// window_end) to keep the original calendar.

const DAY_MS = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD, got "${value}"`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Not a real date: "${value}"`)
  }
  return date
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

/** Days to add so that `windowEnd` becomes the day before `anchor`. */
export function shiftDays({ anchor, windowEnd }) {
  return Math.round((parseDateOnly(anchor) - parseDateOnly(windowEnd)) / DAY_MS) - 1
}

function shiftTimestamp(value, days) {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString()
}

function shiftDate(value, days) {
  return new Date(parseDateOnly(value).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/** "Spring Marathon Push 2026" or "Race Week Popups Apr 2026", relabeled to the month `at` falls in. */
function relabelPeriod(name, at) {
  const date = new Date(at)
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()

  const withMonth = /^(.*) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/.exec(name)
  if (withMonth) return `${withMonth[1]} ${month} ${year}`

  const withYear = /^(.*) \d{4}$/.exec(name)
  if (withYear) return `${withYear[1]} ${year}`

  throw new Error(`Campaign name has no period to relabel: "${name}"`)
}

/** Same derivation the generator uses: the campaign label, uppercased, letters and digits only. */
function codeFromCampaignName(name) {
  return name.toUpperCase().replaceAll(/[^A-Z0-9]/g, '')
}

/**
 * Returns shifted copies of every table. `tables` maps table name to rows of
 * string values (null for empty), as read from the snapshot.
 */
export function shiftTables({ schema, tables, days }) {
  const shifted = {}

  for (const [table, { columns }] of Object.entries(schema)) {
    const temporal = Object.entries(columns).filter(([, type]) => type === 'timestamp' || type === 'date')
    shifted[table] = tables[table].map((row) => {
      const next = { ...row }
      for (const [column, type] of temporal) {
        if (next[column] === null) continue
        next[column] = type === 'date' ? shiftDate(next[column], days) : shiftTimestamp(next[column], days)
      }
      return next
    })
  }

  for (const order of shifted.orders) {
    const suffix = /^RG-\d{8}-(\d+)$/.exec(order.order_number)
    if (!suffix) throw new Error(`Unexpected order number: "${order.order_number}"`)
    order.order_number = `RG-${order.created_at.slice(0, 10).replaceAll('-', '')}-${suffix[1]}`
  }

  const campaignNames = new Map()
  for (const campaign of shifted.marketing_campaigns) {
    campaign.name = relabelPeriod(campaign.name, campaign.started_at)
    campaignNames.set(campaign.id, campaign.name)
  }

  for (const code of shifted.discount_codes) {
    const name = campaignNames.get(code.campaign_id)
    if (name === undefined) throw new Error(`Discount code ${code.id} has no campaign`)
    code.code = codeFromCampaignName(name)
  }

  for (const campaign of shifted.klaviyo_campaigns) {
    campaign.name = campaign.name.replace(
      /\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\)$/,
      () => {
        const date = new Date(campaign.send_time)
        return `(${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()})`
      }
    )
  }

  return shifted
}
