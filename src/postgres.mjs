import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { createTablesSql, tableRef } from './dialects.mjs'
import { tableCsv } from './prepare.mjs'

/**
 * Loads the dataset into `namespace` (a Postgres schema) in one transaction, so
 * a failed load leaves nothing behind. Refuses to overwrite existing tables
 * unless `replace` is set.
 */
export async function loadPostgres({ url, namespace, schema, tables, replace }) {
  const client = new pg.Client({ connectionString: url })
  // A server-side FATAL arrives as an 'error' event as well as a rejected query.
  // The rejection is what reports it; without a listener the event kills the process.
  client.on('error', () => {})
  await client.connect()

  try {
    const names = Object.keys(schema)
    const { rows } = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2)',
      [namespace, names]
    )
    if (rows.length > 0 && !replace) {
      throw new Error(
        `${namespace} already has ${rows.map((row) => row.table_name).join(', ')}. ` +
          'Pass --replace to drop and reload them, or --schema to load somewhere else.'
      )
    }

    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${namespace}"`)
    for (const table of names) {
      await client.query(`DROP TABLE IF EXISTS ${tableRef({ dialect: 'postgres', namespace, table })}`)
    }
    await client.query(createTablesSql({ dialect: 'postgres', schema, namespace }))

    for (const [table, { columns }] of Object.entries(schema)) {
      const ref = tableRef({ dialect: 'postgres', namespace, table })
      const stream = client.query(copyFrom(`COPY ${ref} FROM STDIN WITH (FORMAT csv, HEADER true)`))
      await pipeline(Readable.from([tableCsv({ dialect: 'postgres', columns, rows: tables[table] })]), stream)
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}
