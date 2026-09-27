# demo-data

A realistic ecommerce dataset you can load into Postgres, DuckDB, BigQuery, Snowflake, or MySQL in about a minute, with
dates that end yesterday and a set of questions whose correct answers are computed for your load.

It is RunGear, a fictional running gear brand: 18 tables and six months of orders, returns, shipments, memberships,
campaigns, reviews, site events, and synced Klaviyo email data. Useful for trying an AI data tool, an MCP server, or a
BI tool against something more real than a toy schema, and for checking whether it gets the answers right.

```bash
git clone https://github.com/contextflo/demo-data && cd demo-data && npm install
node bin/demo-data.mjs load --target postgres --url "postgresql://localhost/mydb"
```

That creates a `rungear` schema, loads every table, and writes `answers.json` with the expected answer to each canonical
question for today's data.

## Targets

```bash
# Loaded directly
node bin/demo-data.mjs load --target postgres --url "$DATABASE_URL" [--schema rungear] [--replace]
node bin/demo-data.mjs load --target duckdb --file rungear.duckdb

# Files plus the exact load commands, for databases that load from files
node bin/demo-data.mjs export --target bigquery  --out ./rungear-bq
node bin/demo-data.mjs export --target snowflake --out ./rungear-sf
node bin/demo-data.mjs export --target mysql     --out ./rungear-mysql
```

An export writes one CSV per table in the format that database expects, `create_tables.sql`, and `load.sh` or `load.sql`
with the commands to run. Postgres and DuckDB can be exported too.

Money columns are `DECIMAL(12,2)` everywhere, so totals are identical across databases. Timestamps are UTC.

## Dates

The data is a fixed snapshot, moved in time when you load it so the last day of data is yesterday. Every date moves by the
same number of days, so everything stays consistent: orders still ship 0 to 2 days after they are placed, and order
numbers, campaign names, and discount codes are relabeled to match their new dates.

Pass `--anchor YYYY-MM-DD` to choose "today" yourself. Use it for anything published: the same anchor always produces the
same data and the same answers. `--anchor 2026-07-01` gives the snapshot's original calendar, January to June 2026.

The one thing that does not follow the calendar is seasonality. The snapshot's spring marathon peak lands wherever the
shift puts it.

## Questions and answers

[`data/rungear/questions.yaml`](data/rungear/questions.yaml) has 18 questions a team would actually ask, written with
relative dates:

- How much revenue did RunGear make yesterday?
- What was net revenue last week after returns, by channel?
- Do members spend more than non-members per order?
- Which campaign had the best return on ad spend?
- What is our net promoter score? (The data cannot answer this. A good tool says so.)

Each has a `definition`, the business rule the answer depends on, and reference SQL. `load` and `export` write
`answers.json` with every answer for your anchor; `node bin/demo-data.mjs answers --anchor 2026-07-01` computes them on
their own. Answers are computed in DuckDB from the same data you loaded, so they hold for any target.

The definitions are the interesting part. Revenue here is after discounts and before returns. The site events table only
records sessions that ended in a purchase, so it shows no funnel drop-off at all. Tools that do not know rules like these
give confident, wrong answers, which is exactly what this dataset is for catching.

## Tables

| Table | What it holds |
| --- | --- |
| `customers` | Profiles, location, acquisition source |
| `products`, `product_variants` | Catalog, and size/color/gender variants |
| `orders`, `order_items` | Orders and line items. `total_amount = subtotal_amount - discount_amount` |
| `returns` | Returned items with reason and refund |
| `shipments` | Carrier, status, cost, delivery times |
| `membership_subscriptions` | $125/year membership, 10% off orders |
| `marketing_campaigns`, `discount_codes`, `daily_ad_spend` | Campaigns, their codes, and daily spend |
| `product_reviews` | Ratings, sentiment, fit feedback |
| `inventory_snapshots` | Monthly stock on hand by variant |
| `site_events` | Purchase-session funnel events |
| `klaviyo_profiles`, `klaviyo_flows`, `klaviyo_campaigns`, `klaviyo_events` | Email platform data, as synced into a warehouse |

The column list for every table is in [`data/rungear/schema.json`](data/rungear/schema.json). In Postgres each table
also carries a `COMMENT ON` description.

## Rebuilding the snapshot

The CSVs come from a seeded generator, so they can be rebuilt exactly. [`data/rungear/manifest.json`](data/rungear/manifest.json)
records the seed and window, and [`scripts/build-snapshot.mjs`](scripts/build-snapshot.mjs) turns the generator's output
into these files.

## Development

```bash
npm install
npm test                                             # Postgres load tests skip without a database
TEST_DATABASE_URL=postgres://localhost/test npm test
```

## License

MIT. The data is synthetic; any resemblance to real people or companies is coincidental.
