import fs from 'node:fs'
import path from 'node:path'
import { stringify } from 'csv-stringify/sync'
import { readAllTables, readManifest, readSchema } from './dataset.mjs'
import { formatValue } from './dialects.mjs'
import { parseDateOnly, shiftDays, shiftTables, todayUtc } from './shift.mjs'

/**
 * The snapshot, moved so its last day is the day before `anchor` (default:
 * today, UTC).
 */
export function prepare({ anchor = todayUtc() } = {}) {
  parseDateOnly(anchor)
  const schema = readSchema()
  const manifest = readManifest()
  const days = shiftDays({ anchor, windowEnd: manifest.window_end })
  const tables = shiftTables({ schema, tables: readAllTables(), days })
  return { schema, manifest, anchor, days, tables }
}

/** A table as CSV text with a header row, formatted for `dialect`'s loader. */
export function tableCsv({ dialect, columns, rows }) {
  const names = Object.keys(columns)
  const values = rows.map((row) => names.map((name) => formatValue({ dialect, type: columns[name], value: row[name] })))
  return stringify([names, ...values])
}

/** One CSV file per table. */
export function writeCsvs({ dir, dialect, schema, tables }) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [table, { columns }] of Object.entries(schema)) {
    fs.writeFileSync(path.join(dir, `${table}.csv`), tableCsv({ dialect, columns, rows: tables[table] }))
  }
}
