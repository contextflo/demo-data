import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readAllTables, readManifest, readSchema } from '../src/dataset.mjs'
import { prepare } from '../src/prepare.mjs'
import { parseDateOnly, shiftDays } from '../src/shift.mjs'

const manifest = readManifest()
const SNAPSHOT_ANCHOR = '2026-07-01'

describe('shiftDays', () => {
  it('is zero at the snapshot anchor, the day after window_end', () => {
    assert.equal(manifest.window_end, '2026-06-30')
    assert.equal(shiftDays({ anchor: SNAPSHOT_ANCHOR, windowEnd: manifest.window_end }), 0)
  })

  it('counts whole days across months and leap years', () => {
    assert.equal(shiftDays({ anchor: '2026-07-02', windowEnd: '2026-06-30' }), 1)
    assert.equal(shiftDays({ anchor: '2028-03-01', windowEnd: '2028-02-28' }), 1)
    assert.equal(shiftDays({ anchor: '2026-06-01', windowEnd: '2026-06-30' }), -30)
  })

  it('rejects dates that are not real', () => {
    assert.throws(() => parseDateOnly('2026-02-30'), /Not a real date/)
    assert.throws(() => parseDateOnly('26-01-01'), /Expected YYYY-MM-DD/)
  })
})

describe('shifting the snapshot', () => {
  const anchor = '2027-03-15'
  const { tables, schema } = prepare({ anchor })

  it('leaves the snapshot untouched at its own anchor', () => {
    const original = readAllTables()
    const same = prepare({ anchor: SNAPSHOT_ANCHOR }).tables
    for (const table of Object.keys(readSchema())) {
      assert.deepEqual(same[table], original[table], table)
    }
  })

  it('ends the data on the day before the anchor', () => {
    const lastOrder = tables.orders.map((order) => order.created_at).sort().at(-1)
    assert.equal(lastOrder.slice(0, 10), '2027-03-14')
  })

  it('puts nothing after the anchor except code expiry dates, which are forward-looking by design', () => {
    const limit = new Date(`${anchor}T00:00:00.000Z`)
    for (const [table, { columns }] of Object.entries(schema)) {
      for (const [column, type] of Object.entries(columns)) {
        if (type !== 'timestamp' && type !== 'date') continue
        if (table === 'discount_codes' && column === 'ended_at') continue
        for (const row of tables[table]) {
          if (row[column] === null) continue
          assert.ok(new Date(row[column]) < limit, `${table}.${column} = ${row[column]}`)
        }
      }
    }
  })

  it('keeps order numbers on the order date', () => {
    for (const order of tables.orders) {
      assert.equal(order.order_number.slice(3, 11), order.created_at.slice(0, 10).replaceAll('-', ''))
    }
  })

  it('relabels campaigns and derives unique discount codes from the new names', () => {
    const names = new Map(tables.marketing_campaigns.map((campaign) => [campaign.id, campaign.name]))
    for (const campaign of tables.marketing_campaigns) {
      assert.match(campaign.name, new RegExp(`${new Date(campaign.started_at).getUTCFullYear()}$`))
    }
    for (const code of tables.discount_codes) {
      assert.equal(code.code, names.get(code.campaign_id).toUpperCase().replaceAll(/[^A-Z0-9]/g, ''))
    }
    const codes = tables.discount_codes.map((code) => code.code)
    assert.equal(new Set(codes).size, codes.length)
  })

  it('relabels email campaign names to their send month', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (const campaign of tables.klaviyo_campaigns) {
      const sent = new Date(campaign.send_time)
      assert.ok(campaign.name.endsWith(`(${months[sent.getUTCMonth()]} ${sent.getUTCFullYear()})`), campaign.name)
    }
  })
})
