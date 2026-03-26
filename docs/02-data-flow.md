# Data Flow

## End-to-End Overview

```
blocks.csv (869k rows)          pools.json (payout_addresses + coinbase_tags)
      │                                      │
      └──────────── prepare_data.py ─────────┘
                          │
              ┌───────────┴────────────┐
              │                        │
     blocks_*.parquet            pool_meta.json
       (Snappy)                  (6.8 KB)
              │                        │
              └───────── browser ───────┘
                          │
                    data-loader.js
                    ├── loadParquet()       → raw rows[]
                    ├── normalise dates     → rows[] with JS Date
                    ├── sort by height      → sorted rows[]
                    └── loadData() returns  → { blocks, poolMeta, poolsInfo, timelines }
                          │
                    filterBlocks()          → filtered subset (by active range)
                          │
              ┌───────────┼────────────────────────┐
              │           │                        │
     aggregateByPool   aggregateMonthly      aggregatePoolEntry
              │           │                        │
          renderDonut  renderAreaChart  renderLineChart
        renderPoolTable  renderHhiChart
                       renderConcentrationChart
```

---

## Stage 1 — Python Pipeline (`scripts/prepare_data.py`)

### Inputs
| File | Location | Format |
|---|---|---|
| `blocks.csv` | `data/raw/blocks.csv` | CSV, 869,316 rows |
| `pools.json` | `data/raw/pools.json` | JSON |

### `blocks.csv` schema (raw)
```
height   : int     — block height (0 to 869305)
hash     : str     — 64-char hex block hash
pool_slug: str     — lowercase pool identifier e.g. "antpool", "unknown"
```

### `pools.json` schema (raw)
```json
{
  "payout_addresses": {
    "<bitcoin_address>": { "name": "AntPool", "link": "https://..." }
  },
  "coinbase_tags": {
    "<coinbase_string>": { "name": "AntPool", "link": "https://..." }
  }
}
```
Both sections map arbitrary keys → `{ name, link }`. The same pool name
can appear many times (different addresses/tags all pointing to the same pool).

### Transformations applied

**1. Build `name_link` dict**
Iterate both sections, collect every unique `name → link` pair.
Result: ~200 unique pool names with their websites.

**2. Build `key_to_name` dict for fuzzy slug resolution**
```python
def to_key(s):
    return s.lower().replace(" ","").replace("-","").replace("_","").replace(".","")

key_to_name = { to_key(name): name  for name in name_link }
```
This normalises both the CSV slug and the pools.json name to a
stripped-lowercase key, enabling matching like:
- `"foundryusa"` (slug) → `"Foundry USA"` (display name)
- `"braiinspool"` (slug) → `"Braiins Pool"`

**3. Add `pool_name` column**
```python
blocks["pool_name"] = blocks["pool_slug"].apply(resolve_name)
# "unknown" / "" → "Unknown"
# matched slug   → display name from pools.json
# unmatched slug → slug itself (fallback)
```

**4. Add `epoch` column**
```python
blocks["epoch"] = (blocks["height"] // 210_000).astype("int8")
```
| Epoch | Height range | Halving event |
|---|---|---|
| 0 | 0 – 209,999 | Genesis → 1st halving |
| 1 | 210,000 – 419,999 | 1st → 2nd halving |
| 2 | 420,000 – 629,999 | 2nd → 3rd halving |
| 3 | 630,000 – 839,999 | 3rd → 4th halving |
| 4 | 840,000 – 1,049,999 | 4th → 5th halving |

**5. Add `approx_date` column**
```python
GENESIS_TS = pd.Timestamp("2009-01-03")
blocks["approx_date"] = GENESIS_TS + pd.to_timedelta(blocks["height"] * 10, unit="min")
```
This is a **linear approximation** — 10 minutes per block from genesis.
Real timestamps will replace this in V1 when mempool/node data is added.
The approximation is accurate to within days over long time spans.

**6. Drop `hash` column**
The 64-char hex hash is ~60 MB of string data. It is not used in any
visualisation. Dropping it reduces parquet size from ~51 MB to ~9.6 MB.

**7. Write `blocks.parquet`**
```python
pq.write_table(table, out_path,
    compression="snappy",                        # ← MUST be snappy (hyparquet constraint)
    use_dictionary=["pool_slug", "pool_name"],   # dictionary-encode low-cardinality cols
    write_statistics=True)
```

### Outputs

**`data/processed/blocks.parquet`** — 9.6 MB
```
height      : int32      — block height
pool_slug   : str (dict) — e.g. "antpool"       ← dictionary encoded
pool_name   : str (dict) — e.g. "AntPool"       ← dictionary encoded
epoch       : int8       — 0-4
approx_date : timestamp  — microsecond precision UTC
```
Column sizes (compressed):
| Column | Size |
|---|---|
| approx_date | 5.1 MB |
| height | 3.3 MB |
| pool_name | 0.5 MB |
| pool_slug | 0.5 MB |
| epoch | 0.2 MB |

**`data/processed/pool_meta.json`** — 6.6 KB
```json
{
  "AntPool":     { "link": "https://www.antpool.com" },
  "F2Pool":      { "link": "https://www.f2pool.com" },
  ...
}
```
Keyed by display name (matches `pool_name` column in parquet).

---

## Stage 2 — Browser Loading (`data-loader.js`)

### Step 1: Parallel fetch
```js
const [blocks, poolMeta] = await Promise.all([loadParquet(), loadPoolMeta()]);
```
Both files are fetched simultaneously. The parquet (9.6 MB) dominates load time.

### Step 2: Parse parquet via hyparquet
```js
parquetRead({
  file,                    // raw ArrayBuffer
  rowFormat: 'object',     // deliver rows as [{ height, pool_slug, ... }, ...]
  onComplete: (rows) => resolve(rows),
})
```
hyparquet reads the file entirely in-memory. Each row becomes a plain JS object.
The `approx_date` column arrives as a JS `Date` object (hyparquet converts
parquet `TIMESTAMP` → `Date` automatically via its `timestampFromMicroseconds`
parser).

### Step 3: Normalise dates
```js
// Defensive: if hyparquet returns a number or BigInt instead of Date
if (!(b.approx_date instanceof Date)) {
  b.approx_date = new Date(
    typeof b.approx_date === 'bigint'
      ? Number(b.approx_date) / 1000   // µs → ms
      : b.approx_date
  );
}
```

### Step 4: Sort by height
```js
blocks.sort((a, b) => a.height - b.height);
```
After this sort, `blocks[0]` is the genesis block and `blocks[blocks.length-1]`
is the most recent block. **All downstream code depends on this ordering.**
Never break the sort invariant.

### `loadData()` return value
```js
{
  blocks:  Block[],     // objects, sorted ascending by height
  poolMeta: {           // { [poolName]: { link } }
    "AntPool": { link: "https://..." },
    ...
  },
  poolsInfo: [ ... ],   // array of expanded miner pool details
  timelines: [ ... ]    // timeline events array
}
```

---

## Stage 3 — Aggregation (`data-loader.js` exported functions)

All aggregation runs **client-side in the browser** on every filter change.
The input is always the full `blocks` array — filtering happens first, then
aggregation is run on the filtered subset.

### `filterBlocks(blocks, { range, epoch })`
**By time range:**
```
cutoff = maxDate - N months
return blocks where approx_date >= cutoff
```
| Button | Months back |
|---|---|
| 1M | 1 |
| 3M | 3 |
| 6M | 6 |
| 1Y | 12 |
| 2Y | 24 |
| ALL | no filter |

**By activePeriod=pre vs post:**
This filtering is handled implicitly by serving either `blocks_pre_2020.parquet` or `blocks_post_2020.parquet` depending on the user's selection, which leads to a full reload of `allBlocks` rather than client-side array filtering.

### `aggregateByPool(blocks)` → used by donut, bar, pool table
```
Map: pool_name → count
Output: [{ name, count, pct }]  sorted by count desc
```
- `pct` = `count / total * 100`
- "Unknown" is included (slug === "unknown")
- The bar chart filters out Unknown before rendering

### `aggregateMonthly(blocks, topN=12)` → used by stacked area chart
```
1. Find top N pools by total block count
2. All other pools → bucketed as "Other"
3. Build month-key ("2023-04") → pool → count map
4. Output: {
     months:    ["2009-01", "2009-02", ...],   // sorted strings
     poolNames: ["AntPool", "F2Pool", ..., "Other"],
     series: {
       "AntPool": [0, 0, 3, 12, ...],          // one value per month
       "Other":   [144, 139, ...]
     }
   }
```
Month key format: `YYYY-MM` (ISO, lexicographically sortable).

### `aggregateByEpoch(blocks)` → used by epoch bar chart
```
Output: [
  { epoch: 0, label: "E0 · Genesis–210k", total: 209999, topPool: "Unknown" },
  { epoch: 1, label: "E1 · 210k–420k",    total: 210001, topPool: "GHash.IO" },
  ...
]
```
Note: the epoch chart always uses **all blocks** regardless of the active
time range filter — it is a global overview and ignoring the filter is
intentional (see `renderAll()` in `main.js`).

---

## Stage 4 — Rendering (`charts.js`)

Each chart function is called with pre-aggregated data. Charts never touch
raw blocks. Every chart instance is created once (lazily on first call)
and updated via `chart.setOption(..., true)` — the `true` flag tells ECharts
to replace the entire option rather than merge, which prevents stale data.

| Function | Input | ECharts type |
|---|---|---|
| `renderDonut(poolData, poolMeta, poolsInfo)` | `aggregateByPool` result | `pie` with inner radius |
| `renderPoolTable(poolData, poolMeta)` | `aggregateByPool` result | HTML table (not ECharts) |
| `renderAreaChart({ months, series, poolNames })` | `aggregateMonthly` result | `line` stacked with `areaStyle` |
| `renderHhiChart({ months, hhi })` | `aggregateMonthly` result | `line` chart of decentralization limits |
| `renderConcentrationChart(...)` | Custom aggregate in `main.js` | `line` chart of top-level limits |
| `renderLineChart(poolEntry)` | `aggregatePoolEntry` result | `line` representing cumulative ecosystem |

---

## Data Freshness

Currently `blocks.parquet` covers **heights 0 – 869,305** (last updated when
jlopp's CSV was downloaded). The Bitcoin network tip as of March 2026 is ~942,000.

To update:
1. Run `scripts/fetch_blocks.py` (V1, not yet built) to fetch gap via mempool API
2. Re-run `scripts/prepare_data.py`
3. Copy outputs to `dashboard/data/`
4. Commit and push → GitHub Pages auto-deploys

---

## Future Schema Changes (V1+)

When real block data is added from mempool/node, the parquet will gain new columns.
The pipeline and dashboard must be updated together:

| New column | Type | Source | Used for |
|---|---|---|---|
| `timestamp` | `int64` (unix) | mempool API / node | Replace `approx_date`; exact time-series |
| `difficulty` | `float64` | mempool API / node | Difficulty adjustment chart |
| `total_fees` | `int64` (sats) | mempool API / node | Fee revenue per pool |
| `reward` | `int64` (sats) | mempool API / node | Total revenue per pool |
| `tx_count` | `int32` | mempool API / node | Network activity |
| `size` | `int32` | mempool API / node | Block fullness |
| `country_code` | `str` (dict) | `data/geo/` lookup | Hash rate by country (V3) |
