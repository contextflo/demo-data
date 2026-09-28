#!/usr/bin/env node
// Rebuilds data/rungear/*.csv from the RunGear generator's NDJSON output.
//
//   node demo/rungear/generate-data.mjs --seed rungear-v1 --start 2026-01-01 --days 181 --out /tmp/rungear
//   node scripts/build-snapshot.mjs /tmp/rungear --seed rungear-v1 --start 2026-01-01 --days 181
//
// The generator lives in the Contextflo monorepo. With the same seed, start and
// days it produces byte-identical output, so the snapshot can always be rebuilt.

import fs from 'node:fs'
import path from 'node:path'
import { stringify } from 'csv-stringify/sync'
import { DATA_DIR, readSchema } from '../src/dataset.mjs'

function parseArgs(argv) {
  const [inputDir, ...rest] = argv
  const options = { inputDir, seed: null, start: null, days: null }
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '')
    if (!(key in options)) throw new Error(`Unknown argument: ${rest[index]}`)
    options[key] = rest[index + 1]
  }
  if (!options.inputDir || !options.seed || !options.start || !options.days) {
    throw new Error('Usage: build-snapshot.mjs <generator-output-dir> --seed S --start YYYY-MM-DD --days N')
  }
  return options
}

function readNdjson(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const schema = readSchema()
  const [run] = readNdjson(path.join(options.inputDir, 'demo_generation_runs.ndjson'))
  const rowCounts = {}

  for (const [table, { columns }] of Object.entries(schema)) {
    const names = Object.keys(columns)
    const rows = readNdjson(path.join(options.inputDir, `${table}.ndjson`)).map((row) =>
      names.map((name) => row[name] ?? '')
    )
    fs.writeFileSync(path.join(DATA_DIR, `${table}.csv`), stringify([names, ...rows]))
    rowCounts[table] = rows.length
  }

  const manifest = {
    dataset: 'rungear',
    generator: 'demo/rungear/generate-data.mjs in the Contextflo monorepo',
    seed: options.seed,
    start: options.start,
    days: Number(options.days),
    window_start: run.period_start,
    window_end: run.period_end,
    row_counts: rowCounts,
  }
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(rowCounts).length} tables for ${run.period_start} to ${run.period_end}`)
}

main()
