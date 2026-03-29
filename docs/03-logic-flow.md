# Logic Flow

## Browser Boot Sequence

```
index.html parsed by browser
        │
        ▼
<script type="module">
  1. import hyparquet from CDN  → window.__hyparquet
  2. import echarts  from CDN   → window.__echarts
  3. import { initApp } from ./js/main.js
  4. initApp()
</script>
        │
        ▼
initApp()  [main.js]
  │
  ├── loadData('post') [data-loader.js]
  │     ├── fetch('./data/blocks_post_2021.parquet') ─┐ parallel
  │     ├── fetch('./data/pool_metrics.json')        ─┘
  │     ├── parquetRead({ file, rowFormat:'object', onComplete })
  │     ├── normalise date → JS Date
  │     ├── sort blocks ascending by height
  │     └── return { blocks, poolMeta, ..., maxDate }
  │
  ├── lazyLoadHistory() [main.js] (Begins in background)
  │     └── fetch('./data/blocks_pre_2021.parquet')
  │
  ├── allBlocks  = dataset.blocks    ← stored in module-level state
  ├── poolMeta   = dataset.poolMeta  ← stored in module-level state
  │
  ├── wireFilters()   ← attach all button event listeners (runs once)
  │
  ├── renderAll()     ← first full render
  │
  └── hideOverlay()   ← fade out loading spinner
```

---

## Application State

All state lives as module-level `let` variables in `main.js`.
There is no state management library, no store, no reactive framework.

```js
let allBlocks    = [];       // full dataset, never mutated after load
let poolMeta     = {};       // { [poolName]: { link } }, never mutated
let post2020Blocks   = null;   // cached after first load
let fullHistoryBlocks = null;   // cached after background load finishes
let activeRange       = '1Y';     // time range button: '1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'
let activePeriod      = 'post';   // active dataset period: 'pre' or 'post'
```

**Invariants:**
- `activeRange` time filters are hidden when `activePeriod` is `'pre'`, as that dataset is historical and fixed.
- `allBlocks` is **never mutated**. Every filter creates a new array via `.filter()`.
- `poolMeta` is **never mutated**. It is read-only after load.

---

## State Transitions

```
Initial state: activePeriod='post', activeRange='ALL'

User clicks period button (e.g. "Pre-2020")
  → activePeriod = 'pre'
  → activeRange = 'ALL'          ← reset time range
  → hide range buttons section
  → update .active classes on period buttons
  → loadAndRender('pre')         ← fetches new parquet and re-renders entire app

User clicks time-range button (e.g. "1Y")
  → activeRange = '1Y'
  → update .active classes on range buttons
  → renderAll()

User clicks donut slice OR table row
  → lookup pool details in `poolsInfo` & `poolMeta`
  → update `#pool-profile-card` DOM elements
  → sync `#profile-selector` dropdown
  → `#pool-profile-card` display block (fade in)

User changes `#profile-selector` dropdown
  → re-triggers profile card lookup & update
```

---

## `renderAll()` — The Core Render Cycle

Called on every filter change and once on initial load.

```
initApp() / loadAndRender(period)
    │
    ├── loadData(period)  → { blocks, poolMeta, poolsInfo, timelines }
    │
    ├── updateKPICards()
    │       └── filters blocks to last 30 days, calculates KPI stats & HHI
    │
    ├── initStaticMacroCharts()
    │       ├── aggregateMonthly(allBlocks, 12)  → returns { months, series, hhi }
    │       ├── renderHhiChart({ months, hhi })
    │       └── renderConcentrationChart({ months, top3, top5 })
    │
    └── renderAll()
            │
            ├── filterBlocks(allBlocks, { range: activeRange })
            │       └── returns filtered[]   (subset of allBlocks)
            │
            ├── aggregateByPool(filtered)           → poolAgg[]
            │       ├── renderDonut(poolAgg, poolMeta, poolsInfo)
            │       └── renderPoolTable(poolAgg, poolMeta)
            │
            ├── aggregateByCountry(poolAgg, poolsInfo) → countryAgg[]
            │       └── renderCountryShareChart(countryAgg)
            │
            ├── wire profile card click events
            │       └── attaches showProfileCard() to donut clicks and table rows
            │
            ├── aggregateMonthly(filtered, 12)      → { months, series, poolNames }
            │       └── renderAreaChart(monthly)
            │
            ├── aggregatePoolEntry(filtered)        → { months, cumulativePools }
            │       └── renderLineChart(poolEntry)
            │
            └── update #donut-subtitle text based on activePeriod and activeRange
```

**Performance note:** `aggregateByPool` runs twice in `updateCards` + the main
pass. This is acceptable given 869k rows completes in <100ms on modern hardware.
If performance becomes an issue, hoist the `aggregateByPool` call and pass the
result to `updateCards`.

---

## Chart Lifecycle

Each chart in `charts.js` follows the same pattern:

```js
let xyzChart = null;   // module-level, persists across renderAll() calls

export function renderXyz(data) {
  const el = document.getElementById('chart-xyz');

  // INIT: create once on first call
  if (!xyzChart) {
    xyzChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => xyzChart.resize());
  }

  // UPDATE: replace full option on every call
  // The second arg `true` = notMerge → prevents stale series bleeding through
  xyzChart.setOption({ ... }, true);
}
```

**Why `notMerge: true`?** Without it, ECharts merges the new option into the
existing one. If the number of series changes (e.g. switching from 12 pools to
fewer pools in a short time range), old series linger. `true` does a full
replacement every time.

**Why module-level chart instances?** ECharts instances are expensive to
create (~50ms each). Creating them once and reusing avoids jank on filter changes.

---

## Function Reference

### `main.js`

| Function | Signature | Description |
|---|---|---|
| `initApp` | `async () → void` | Entry point. Calls loadAndRender('post'), wires UI. |
| `loadAndRender` | `async (period) → void` | Loads data, initializes charts/selectors, and calls renderAll(). |
| `renderAll` | `() → void` | Full re-render triggered by any filter change. |
| `wireFilters` | `() → void` | Attaches click listeners to all filter buttons. Called once. |
| `initStaticMacroCharts` | `() → void` | Renders HHI and Concentration macro charts. |
| `updateKPICards` | `() → void` | Updates KPI cards based on a rolling 30-day "Live" window. |
| `showProfileCard` | `(poolName) → void` | Dynamically updates the profile UI and synchronizes dropdown. |
| `hideOverlay` | `() → void` | Fades and removes the loading spinner. |
| `showError` | `(msg: string) → void` | Replaces loading spinner with an error message. |

### `data-loader.js`

| Function | Signature | Description |
|---|---|---|
| `loadData` | `async (period) → Dataset` | Fetches parquet and JSON files based on period. |
| `filterBlocks` | `(blocks[], {range}) → blocks[]` | Returns a time-filtered subset. Pure function. |
| `aggregateByPool` | `(blocks[]) → [{name, pct, ...}]` | Pool block counts, sorted desc. |
| `aggregateByCountry` | `(poolAgg, poolsInfo) → [{country, count}]` | Blocks by country. |
| `aggregateMonthly` | `(blocks[], topN) → {months, series, hhi}` | Monthly distribution and HHI index. |
| `aggregatePoolEntry` | `(blocks[]) → {months, cumulativePools}` | Ecosystem growth array. Pure. |

### `charts.js`

| Function | Signature | Description |
|---|---|---|
| `renderDonut` | `(poolData[], poolMeta, poolsInfo) → void` | Pie/donut chart, top 15 + Other. |
| `renderPoolTable` | `(poolData[], poolMeta) → void` | HTML table showing miner list. |
| `renderHhiChart` | `({months, hhi}) → void` | Line chart displaying HHI decentralization index over time. |
| `renderConcentrationChart` | `({months, top3, top5}) → void` | Line chart showing Top N pool market limits. |
| `renderAreaChart` | `({months, series, poolNames}) → void` | Stacked area with dataZoom. |
| `renderLineChart` | `({months, cumulativePools}) → void` | Line chart displaying cumulative pools. |
| `resizeAll` | `() → void` | Resizes all chart instances to handle window dimensions. |

---

## DOM Element Map

Every element `main.js` and `charts.js` reads or writes:

| Element ID | Type | Written by |
|---|---|---|
| `val-unique-pools` | `.kpi-value` | `updateCardsLatestMonth()` |
| `val-top-pool` | `.kpi-value` | `updateCardsLatestMonth()` |
| `val-concentration` | `.kpi-value` | `updateCardsLatestMonth()` |
| `val-hhi` | `.kpi-value` | `updateCardsLatestMonth()` |
| `donut-subtitle` | `<span>` | `renderAll()` |
| `period-buttons` | `<div>` container | `wireFilters()` |
| `range-buttons` | `<div>` container | `wireFilters()` |
| `chart-hhi` | `<div>` | `renderHhiChart()` — ECharts |
| `chart-concentration` | `<div>` | `renderConcentrationChart()` — ECharts |
| `chart-donut` | `<div>` | `renderDonut()` — ECharts |
| `pool-table` | `<div>` | `renderPoolTable()` — innerHTML |
| `chart-area` | `<div>` | `renderAreaChart()` — ECharts |
| `chart-line` | `<div>` | `renderLineChart()` — ECharts |
| `pool-profile-card` | `<div>` container | `showProfileCard()` dynamically reveals |
| `profile-selector` | `<select>` | User input / `showProfileCard()` |
| `loading-overlay` | `<div>` | `hideOverlay()` / `showError()` |

---

## Error Handling

All errors funnel to `initApp`'s `catch` block:
```js
} catch (err) {
  console.error(err);
  showError(`Failed to load data: ${err.message}`);
}
```
`showError()` replaces the loading spinner content with a red error message.
The spinner is never removed, so the user sees the error instead of a broken
empty dashboard.

Known past errors and their causes:
| Error message | Cause | Fix |
|---|---|---|
| `parquet unsupported compression codec: ZSTD` | parquet written with zstd | Use `compression="snappy"` in `prepare_data.py` |
| `Maximum call stack size exceeded` | `Math.min(...869k items)` | Use `filtered[0]` / `filtered[at(-1)]` |
| `Failed to fetch parquet: 404` | file not in `dashboard/data/` | Copy from `data/processed/` |
