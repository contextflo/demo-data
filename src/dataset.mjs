import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'rungear')

/** Table name -> { description, columns: { name: type } }, in load order. */
export function readSchema() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'schema.json'), 'utf8'))
}

export function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'))
}

/** Rows as objects keyed by column name. Empty fields are null. */
export function readTable(table) {
  const text = fs.readFileSync(path.join(DATA_DIR, `${table}.csv`), 'utf8')
  return parse(text, { columns: true, cast: (value) => (value === '' ? null : value) })
}

export function readAllTables() {
  return Object.fromEntries(Object.keys(readSchema()).map((table) => [table, readTable(table)]))
}
