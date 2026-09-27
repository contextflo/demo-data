import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { computeAnswers } from '../src/duckdb.mjs'
import { loadPostgres } from '../src/postgres.mjs'
import { prepare } from '../src/prepare.mjs'

// Needs a real Postgres. CI provides one; locally, set TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL

if (!url && process.env.CI) {
  throw new Error('TEST_DATABASE_URL is required in CI so the Postgres load test cannot silently skip.')
}

describe('loading into Postgres', { skip: !url && 'set TEST_DATABASE_URL to run' }, () => {
  const namespace = `demo_data_test_${process.pid}`
  const prepared = prepare({ anchor: '2026-10-01' })
  let client

  before(async () => {
    client = new pg.Client({ connectionString: url })
    await client.connect()
  })

  after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`)
    await client.end()
  })

  it('loads every row of every table', async () => {
    await loadPostgres({ url, namespace, schema: prepared.schema, tables: prepared.tables, replace: false })
    for (const [table, rows] of Object.entries(prepared.tables)) {
      const { rows: [{ count }] } = await client.query(`SELECT count(*)::int AS count FROM "${namespace}"."${table}"`)
      assert.equal(count, rows.length, table)
    }
  })

  it('agrees with the computed answer for yesterday, summed by Postgres itself', async () => {
    const answers = await computeAnswers(prepared)
    const expected = answers.find((answer) => answer.id === 'revenue_yesterday').answer[0]
    const { rows: [actual] } = await client.query(
      `SELECT sum(total_amount)::float8 AS revenue, count(*)::int AS orders
       FROM "${namespace}".orders
       WHERE created_at >= timestamptz '2026-09-30 00:00:00+00' AND created_at < timestamptz '2026-10-01 00:00:00+00'`
    )
    assert.deepEqual(actual, expected)
  })

  it('describes each table with a comment', async () => {
    const { rows: [{ description }] } = await client.query(
      `SELECT obj_description('"${namespace}".orders'::regclass, 'pg_class') AS description`
    )
    assert.match(description, /total_amount = subtotal_amount - discount_amount/)
  })

  it('refuses to overwrite existing tables without replace', async () => {
    await assert.rejects(
      loadPostgres({ url, namespace, schema: prepared.schema, tables: prepared.tables, replace: false }),
      /Pass --replace/
    )
  })

  it('reloads cleanly with replace', async () => {
    await loadPostgres({ url, namespace, schema: prepared.schema, tables: prepared.tables, replace: true })
    const { rows: [{ count }] } = await client.query(`SELECT count(*)::int AS count FROM "${namespace}".orders`)
    assert.equal(count, prepared.tables.orders.length)
  })
})
