// Per-database DDL, CSV value formats, and load commands.
//
// Money is DECIMAL(12,2) everywhere, not floating point, so a sum is the same
// number in every database and the computed answers apply to all of them.
// Timestamps are UTC instants.

const TYPES = {
  postgres: { string: 'text', integer: 'integer', decimal: 'numeric(12,2)', timestamp: 'timestamptz', date: 'date' },
  duckdb: { string: 'VARCHAR', integer: 'INTEGER', decimal: 'DECIMAL(12,2)', timestamp: 'TIMESTAMPTZ', date: 'DATE' },
  bigquery: { string: 'STRING', integer: 'INT64', decimal: 'NUMERIC', timestamp: 'TIMESTAMP', date: 'DATE' },
  snowflake: { string: 'VARCHAR', integer: 'INTEGER', decimal: 'NUMBER(12,2)', timestamp: 'TIMESTAMP_TZ', date: 'DATE' },
  mysql: { string: 'VARCHAR(255)', integer: 'INT', decimal: 'DECIMAL(12,2)', timestamp: 'DATETIME(3)', date: 'DATE' },
}

export const DIALECTS = Object.keys(TYPES)

export function assertDialect(dialect) {
  if (!DIALECTS.includes(dialect)) {
    throw new Error(`Unknown target "${dialect}". Choose one of: ${DIALECTS.join(', ')}`)
  }
}

/** A table reference in the dialect's SQL, qualified by `namespace` when given. */
export function tableRef({ dialect, namespace, table }) {
  if (dialect === 'bigquery') return namespace ? `\`${namespace}.${table}\`` : `\`${table}\``
  if (dialect === 'mysql') return namespace ? `\`${namespace}\`.\`${table}\`` : `\`${table}\``
  return namespace ? `"${namespace}"."${table}"` : `"${table}"`
}

export function createTablesSql({ dialect, schema, namespace }) {
  const types = TYPES[dialect]
  const statements = Object.entries(schema).map(([table, { columns }]) => {
    const body = Object.entries(columns)
      .map(([column, type]) => `  ${column} ${types[type]}`)
      .join(',\n')
    return `CREATE TABLE ${tableRef({ dialect, namespace, table })} (\n${body}\n);`
  })

  if (dialect === 'postgres') {
    for (const [table, { description }] of Object.entries(schema)) {
      statements.push(`COMMENT ON TABLE ${tableRef({ dialect, namespace, table })} IS '${description.replaceAll("'", "''")}';`)
    }
  }

  return `${statements.join('\n\n')}\n`
}

/** A cell as the dialect's CSV loader wants it. */
export function formatValue({ dialect, type, value }) {
  if (value === null) return dialect === 'mysql' ? '\\N' : ''
  // MySQL rejects ISO-8601 with T and Z in DATETIME columns.
  if (dialect === 'mysql' && type === 'timestamp') return value.replace('T', ' ').replace('Z', '')
  return value
}

/** Shell/SQL to load exported CSVs, for targets this tool does not load directly. */
export function loadInstructions({ dialect, schema, namespace }) {
  const tables = Object.keys(schema)

  if (dialect === 'bigquery') {
    return [
      '# BigQuery. Set PROJECT, then run from this directory.',
      `bq mk --dataset "$PROJECT:${namespace}"`,
      `bq query --use_legacy_sql=false --dataset_id="$PROJECT:${namespace}" < create_tables.sql`,
      ...tables.map(
        (table) => `bq load --source_format=CSV --skip_leading_rows=1 "$PROJECT:${namespace}.${table}" ${table}.csv`
      ),
    ].join('\n')
  }

  if (dialect === 'snowflake') {
    return [
      `-- Snowflake. Run with SnowSQL from this directory, in the database you want ${namespace} created in.`,
      `CREATE SCHEMA IF NOT EXISTS ${namespace};`,
      `USE SCHEMA ${namespace};`,
      '!source create_tables.sql',
      'CREATE OR REPLACE TEMPORARY STAGE demo_data_stage;',
      'PUT file://./*.csv @demo_data_stage;',
      ...tables.map(
        (table) =>
          `COPY INTO ${table} FROM @demo_data_stage FILES = ('${table}.csv.gz') ` +
          `FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"' EMPTY_FIELD_AS_NULL = TRUE);`
      ),
    ].join('\n')
  }

  if (dialect === 'mysql') {
    return [
      `-- MySQL. Run with: mysql --local-infile=1 -e "CREATE DATABASE IF NOT EXISTS ${namespace}" && mysql --local-infile=1 ${namespace} < load.sql`,
      'SOURCE create_tables.sql;',
      ...tables.map(
        (table) =>
          `LOAD DATA LOCAL INFILE '${table}.csv' INTO TABLE ${table} ` +
          `FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\\n' IGNORE 1 LINES;`
      ),
    ].join('\n')
  }

  if (dialect === 'postgres') {
    return [
      `-- Postgres. Run with: psql "$DATABASE_URL" -f load.sql (from this directory)`,
      `CREATE SCHEMA IF NOT EXISTS ${namespace};`,
      `SET search_path TO ${namespace};`,
      '\\i create_tables.sql',
      ...tables.map((table) => `\\copy ${table} FROM '${table}.csv' WITH (FORMAT csv, HEADER true)`),
    ].join('\n')
  }

  return [
    `-- DuckDB. Run with: duckdb rungear.duckdb < load.sql (from this directory)`,
    '.read create_tables.sql',
    ...tables.map((table) => `COPY ${table} FROM '${table}.csv' (HEADER);`),
  ].join('\n')
}
