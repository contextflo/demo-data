#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { assertDialect, createTablesSql, loadInstructions } from '../src/dialects.mjs'
import { computeAnswers, loadDuckDbFile } from '../src/duckdb.mjs'
import { loadPostgres } from '../src/postgres.mjs'
import { prepare, writeCsvs } from '../src/prepare.mjs'

const USAGE = `demo-data: the RunGear demo dataset, with dates that end yesterday.

Usage:
  demo-data load --target postgres --url <connection-string> [--schema rungear] [--replace]
  demo-data load --target duckdb --file rungear.duckdb
  demo-data export --target <bigquery|snowflake|mysql|postgres|duckdb> --out <dir> [--schema rungear]
  demo-data answers [--out answers.json]

Options:
  --anchor YYYY-MM-DD   Treat this as today: the data ends the day before. Default: today (UTC).
  --answers <file>      Where load writes the computed answers. Default: answers.json

DATABASE_URL is used when --url is not given.`

const FLAGS = new Set(['target', 'url', 'schema', 'file', 'out', 'anchor', 'answers'])

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, replace: false }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--replace') {
      options.replace = true
      continue
    }
    const key = arg.replace(/^--/, '')
    if (!arg.startsWith('--') || !FLAGS.has(key)) throw new UsageError(`Unknown argument: ${arg}`)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`)
    options[key] = value
    index += 1
  }
  return options
}

class UsageError extends Error {}

function schemaName(options) {
  const name = options.schema ?? 'rungear'
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new UsageError(`--schema must be a lowercase identifier, got "${name}"`)
  return name
}

function writeAnswers({ file, anchor, answers }) {
  fs.writeFileSync(file, `${JSON.stringify({ anchor, answers }, null, 2)}\n`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.command || options.command === '--help' || options.command === 'help') {
    console.log(USAGE)
    return
  }

  const prepared = prepare(options.anchor ? { anchor: options.anchor } : {})
  const { schema, tables, anchor } = prepared
  const period = `data runs to ${new Date(Date.parse(`${anchor}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)}`

  if (options.command === 'answers') {
    const answers = await computeAnswers(prepared)
    const file = options.out ?? 'answers.json'
    writeAnswers({ file, anchor, answers })
    console.log(`Wrote ${answers.length} answers for anchor ${anchor} (${period}) to ${file}`)
    return
  }

  if (options.command === 'load') {
    if (options.target === 'postgres') {
      const url = options.url ?? process.env.DATABASE_URL
      if (!url) throw new UsageError('load --target postgres needs --url or DATABASE_URL')
      const namespace = schemaName(options)
      await loadPostgres({ url, namespace, schema, tables, replace: options.replace })
      console.log(`Loaded ${Object.keys(schema).length} tables into schema "${namespace}" (${period})`)
    } else if (options.target === 'duckdb') {
      if (!options.file) throw new UsageError('load --target duckdb needs --file')
      await loadDuckDbFile({ file: options.file, schema, tables })
      console.log(`Wrote ${options.file} with ${Object.keys(schema).length} tables (${period})`)
    } else {
      throw new UsageError(
        'load supports --target postgres or duckdb. For bigquery, snowflake, or mysql use export, which writes the files and load commands.'
      )
    }
    const file = options.answers ?? 'answers.json'
    writeAnswers({ file, anchor, answers: await computeAnswers(prepared) })
    console.log(`Answers for the canonical questions: ${file}`)
    return
  }

  if (options.command === 'export') {
    if (!options.target) throw new UsageError('export needs --target')
    assertDialect(options.target)
    if (!options.out) throw new UsageError('export needs --out <dir>')
    const namespace = schemaName(options)
    writeCsvs({ dir: options.out, dialect: options.target, schema, tables })
    fs.writeFileSync(path.join(options.out, 'create_tables.sql'), createTablesSql({ dialect: options.target, schema }))
    const loadFile = options.target === 'bigquery' ? 'load.sh' : 'load.sql'
    fs.writeFileSync(
      path.join(options.out, loadFile),
      `${loadInstructions({ dialect: options.target, schema, namespace })}\n`
    )
    writeAnswers({ file: path.join(options.out, 'answers.json'), anchor, answers: await computeAnswers(prepared) })
    console.log(`Exported ${Object.keys(schema).length} tables for ${options.target} to ${options.out} (${period})`)
    console.log(`Next: see ${path.join(options.out, loadFile)}`)
    return
  }

  throw new UsageError(`Unknown command: ${options.command}`)
}

main().catch((error) => {
  console.error(error instanceof UsageError ? `${error.message}\n\n${USAGE}` : error.message)
  process.exit(1)
})
