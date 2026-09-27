import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readAllTables, readManifest, readSchema } from '../src/dataset.mjs'

const schema = readSchema()
const tables = readAllTables()

describe('the snapshot', () => {
  it('matches the manifest row counts', () => {
    for (const [table, count] of Object.entries(readManifest().row_counts)) {
      assert.equal(tables[table].length, count, table)
    }
  })

  it('has exactly the columns the schema declares, in order', () => {
    for (const [table, { columns }] of Object.entries(schema)) {
      assert.deepEqual(Object.keys(tables[table][0]), Object.keys(columns), table)
    }
  })

  it('has unique ids in every table', () => {
    for (const [table, rows] of Object.entries(tables)) {
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, table)
    }
  })

  // [table, column, referenced table]. Nullable references are skipped when null.
  const references = [
    ['product_variants', 'product_id', 'products'],
    ['membership_subscriptions', 'customer_id', 'customers'],
    ['discount_codes', 'campaign_id', 'marketing_campaigns'],
    ['orders', 'customer_id', 'customers'],
    ['orders', 'discount_code_id', 'discount_codes'],
    ['order_items', 'order_id', 'orders'],
    ['order_items', 'product_variant_id', 'product_variants'],
    ['returns', 'order_item_id', 'order_items'],
    ['inventory_snapshots', 'product_variant_id', 'product_variants'],
    ['product_reviews', 'customer_id', 'customers'],
    ['daily_ad_spend', 'campaign_id', 'marketing_campaigns'],
    ['site_events', 'customer_id', 'customers'],
    ['shipments', 'order_id', 'orders'],
    ['klaviyo_profiles', 'customer_id', 'customers'],
    ['klaviyo_events', 'person_id', 'klaviyo_profiles'],
    ['klaviyo_events', 'campaign_id', 'klaviyo_campaigns'],
    ['klaviyo_events', 'flow_id', 'klaviyo_flows'],
  ]

  for (const [table, column, target] of references) {
    it(`${table}.${column} always points at a row in ${target}`, () => {
      const ids = new Set(tables[target].map((row) => row.id))
      const dangling = tables[table].filter((row) => row[column] !== null && !ids.has(row[column]))
      assert.equal(dangling.length, 0, `${dangling.length} dangling, e.g. ${dangling[0]?.[column]}`)
    })
  }

  it('keeps order totals consistent: total = subtotal - discount', () => {
    for (const order of tables.orders) {
      const expected = (Number(order.subtotal_amount) - Number(order.discount_amount)).toFixed(2)
      assert.equal(Number(order.total_amount).toFixed(2), expected, order.id)
    }
  })
})
