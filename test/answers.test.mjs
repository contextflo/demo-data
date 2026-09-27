import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import { computeAnswers, readQuestions } from '../src/duckdb.mjs'
import { createTablesSql, DIALECTS, formatValue } from '../src/dialects.mjs'
import { readSchema } from '../src/dataset.mjs'
import { prepare } from '../src/prepare.mjs'

describe('canonical answers', () => {
  it('match the recorded answers at the snapshot anchor', async () => {
    // Any change to the snapshot or to a question's SQL shows up here. If the
    // change is intended, regenerate test/fixtures/answers-2026-07-01.json.
    const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/answers-2026-07-01.json', import.meta.url)))
    const answers = await computeAnswers(prepare({ anchor: '2026-07-01' }))
    assert.deepEqual(
      answers.map(({ id, answer }) => ({ id, answer })),
      expected
    )
  })

  it('answer every answerable question with at least one row on any anchor', async () => {
    const answers = await computeAnswers(prepare({ anchor: '2027-01-20' }))
    for (const { id, answerable, answer } of answers) {
      if (answerable) assert.ok(answer.length > 0, id)
      else assert.equal(answer, null, id)
    }
  })

  it('give yesterday the same revenue on every anchor, since the last snapshot day always becomes yesterday', async () => {
    const first = await computeAnswers(prepare({ anchor: '2026-11-03' }))
    const second = await computeAnswers(prepare({ anchor: '2027-05-09' }))
    const revenue = (answers) => answers.find((answer) => answer.id === 'revenue_yesterday').answer
    assert.deepEqual(revenue(first), revenue(second))
  })

  it('have unique ids and a definition for every question', () => {
    const questions = readQuestions()
    assert.equal(new Set(questions.map((question) => question.id)).size, questions.length)
    for (const question of questions) assert.ok(question.definition?.length > 20, question.id)
  })
})

describe('dialects', () => {
  const schema = readSchema()

  for (const dialect of DIALECTS) {
    it(`${dialect} DDL creates every table and column`, () => {
      const sql = createTablesSql({ dialect, schema })
      for (const [table, { columns }] of Object.entries(schema)) {
        assert.match(sql, new RegExp(`CREATE TABLE \\W?${table}\\W? \\(`))
        for (const column of Object.keys(columns)) assert.match(sql, new RegExp(`\\n  ${column} `))
      }
    })
  }

  it('writes MySQL nulls and timestamps in the form LOAD DATA accepts', () => {
    assert.equal(formatValue({ dialect: 'mysql', type: 'string', value: null }), '\\N')
    assert.equal(
      formatValue({ dialect: 'mysql', type: 'timestamp', value: '2026-01-03T14:22:01.000Z' }),
      '2026-01-03 14:22:01.000'
    )
    assert.equal(formatValue({ dialect: 'postgres', type: 'string', value: null }), '')
  })
})
