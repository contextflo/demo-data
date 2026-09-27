import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { parse } from 'yaml'
import { DATA_DIR } from './dataset.mjs'
import { createTablesSql } from './dialects.mjs'
import { writeCsvs } from './prepare.mjs'

/** Opens `file` (or an in-memory database) with a UTC session, runs `work`, and closes it. */
async function withDuckDb(file, work) {
  const instance = await DuckDBInstance.create(file)
  const connection = await instance.connect()
  try {
    // Answers are defined on UTC days. DuckDB's default is the machine's zone.
    await connection.run("SET TimeZone = 'UTC'")
    return await work(connection)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

/** Creates the tables and loads prepared data into an open connection. */
async function loadTables({ connection, schema, tables }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-data-'))
  try {
    writeCsvs({ dir, dialect: 'duckdb', schema, tables })
    for (const statement of createTablesSql({ dialect: 'duckdb', schema }).split('\n\n')) {
      await connection.run(statement)
    }
    for (const table of Object.keys(schema)) {
      const file = path.join(dir, `${table}.csv`).replaceAll("'", "''")
      await connection.run(`COPY ${table} FROM '${file}' (HEADER)`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Writes a DuckDB database file. Refuses to touch an existing file. */
export async function loadDuckDbFile({ file, schema, tables }) {
  if (fs.existsSync(file)) throw new Error(`${file} already exists. Delete it or choose another path.`)
  await withDuckDb(file, (connection) => loadTables({ connection, schema, tables }))
}

/** DuckDB returns BIGINT and DECIMAL as strings to avoid precision loss; answers are small, so use numbers. */
function numbersAsNumbers(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value,
    ])
  )
}

export function readQuestions() {
  return parse(fs.readFileSync(path.join(DATA_DIR, 'questions.yaml'), 'utf8'))
}

/**
 * Each canonical question with its answer for this load. A question with no
 * SQL is one the data cannot answer; its answer is null.
 */
export async function computeAnswers({ schema, tables, anchor }) {
  const questions = readQuestions()
  return withDuckDb(':memory:', async (connection) => {
    await loadTables({ connection, schema, tables })
    const answers = []
    for (const { id, question, definition, sql } of questions) {
      let answer = null
      if (sql !== null) {
        const reader = await connection.runAndReadAll(sql.replaceAll('{{anchor}}', `DATE '${anchor}'`))
        answer = reader.getRowObjectsJson().map(numbersAsNumbers)
      }
      answers.push({ id, question, definition, answerable: sql !== null, answer })
    }
    return answers
  })
}
