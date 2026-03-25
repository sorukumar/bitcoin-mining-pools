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
  ├── loadData()  [data-loader.js]
  │     ├── fetch('./data/blocks.parquet')  ─┐ parallel
  │     ├── fetch('./data/pool_meta.json')  ─┘
  │     ├── parquetRead({ file, rowFormat:'object', onComplete })
  │     ├── normalise approx_date → JS Date
  │     ├── sort blocks ascending by height
  │     └── return { blocks, poolMeta, minDate, maxDate }
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
let allBlocks   = [];       // full dataset, never mutated after load
let poolMeta    = {};       // { [poolName]: { link } }, never mutated
let activeRange = 'ALL';    // current time range button: '1M'|'3M'|'6M'|'1Y'|'2Y'|'ALL'
let activeEpoch = null;     // current epoch filter: 0|1|2|3|4|null
let barMetric   = 'blocks'; // bar chart mode: 'blocks' | 'pct'
```

**Invariants:**
- `activeRange` and `activeEpoch` are **mutually exclusive**. When epoch is set,
  range is ignored by `filterBlocks()`. When range is set, epoch is `null`.
- `allBlocks` is **never mutated**. Every filter creates a new array via `.filter()`.
- `poolMeta` is **never mutated**. It is read-only after load.

---

## State Transitions

```
Initial state: activeRange='ALL', activeEpoch=null, barMetric='blocks'

User clicks time-range button (e.g. "1Y")
  → activeRange = '1Y'
  → activeEpoch = null          ← always clear epoch
  → remove .active from all .filter-btn and .epoch-btn
  → add .active to clicked button
  → renderAll()

User clicks epoch button (e.g. "E2")
  → if same epoch already active:
      activeEpoch = null
      activeRange = 'ALL'        ← toggle off → back to ALL
      remove .active from epoch button
      add .active to ALL button
  → else:
      activeEpoch = 2
      remove .active from all buttons
      add .active to E2 button
  → renderAll()

User clicks bar metric toggle ("Share %")
  → barMetric = 'pct'
  → remove .active from sibling toggle buttons
  → add .active to clicked button
  → renderBarChart only (does NOT call renderAll — optimisation)
```

---

## `renderAll()` — The Core Render Cycle

Called on every filter change and once on initial load.

```
renderAll()
    │
    ├── filterBlocks(allBlocks, { range: activeRange, epoch: activeEpoch })
    │       └── returns filtered[]   (subset of allBlocks)
    │
    ├── updateHeader(filtered)
    │       ├── minD = filtered[0].approx_date          ← safe: blocks are sorted
    │       └── maxD = filtered[filtered.length-1].approx_date
    │
    ├── updateCards(filtered)
    │       ├── loop once: count unknown, build Set of pool names
    │       └── aggregateByPool(filtered excluding unknown) → top pool name/pct
    │
    ├── aggregateByPool(filtered)           → poolAgg[]
    │       └── shared result passed to 3 renderers below:
    │
    ├── renderDonut(poolAgg, poolMeta)      [charts.js]
    ├── renderPoolTable(poolAgg, poolMeta)  [charts.js]
    ├── renderBarChart(poolAgg, barMetric)  [charts.js]
    │
    ├── aggregateMonthly(filtered, 12)      → { months, series, poolNames }
    │       └── renderAreaChart(monthly)   [charts.js]
    │
    ├── aggregateByEpoch(allBlocks)         → epochData[]  ← NOTE: uses allBlocks, NOT filtered
    │       └── renderEpochChart(epochData) [charts.js]
    │
    └── update #donut-subtitle text
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
| `initApp` | `async () → void` | Entry point. Loads data, wires UI, renders. |
| `renderAll` | `() → void` | Full re-render triggered by any filter change. |
| `wireFilters` | `() → void` | Attaches click listeners to all filter/toggle buttons. Called once. |
| `updateHeader` | `(filtered[]) → void` | Sets the date range + block count in the header. |
| `updateCards` | `(filtered[]) → void` | Updates the 4 summary stat cards. |
| `hideOverlay` | `() → void` | Fades and removes the loading spinner. |
| `showError` | `(msg: string) → void` | Replaces loading spinner with an error message. |

### `data-loader.js`

| Function | Signature | Description |
|---|---|---|
| `loadData` | `async () → Dataset` | Fetches and parses both data files. Called once. |
| `filterBlocks` | `(blocks[], {range, epoch}) → blocks[]` | Returns a filtered subset. Pure function. |
| `aggregateByPool` | `(blocks[]) → [{name, count, pct}]` | Pool block counts, sorted desc. Pure. |
| `aggregateMonthly` | `(blocks[], topN) → {months, series, poolNames}` | Monthly series for area chart. Pure. |
| `aggregateByEpoch` | `(blocks[]) → [{epoch, label, total, topPool}]` | Per-epoch summary. Pure. |

### `charts.js`

| Function | Signature | Description |
|---|---|---|
| `renderDonut` | `(poolData[], poolMeta) → void` | Pie/donut chart, top 15 + Other. |
| `renderPoolTable` | `(poolData[], poolMeta) → void` | HTML table, top 20. Not an ECharts chart. |
| `renderAreaChart` | `({months, series, poolNames}) → void` | Stacked area with dataZoom. |
| `renderBarChart` | `(poolData[], metric) → void` | Horizontal bar, top 20, excludes Unknown. |
| `renderEpochChart` | `(epochData[]) → void` | Vertical bar, one bar per epoch. |
| `resizeAll` | `() → void` | Resize all chart instances. Exported but not currently called (window resize listeners handle it). |

---

## DOM Element Map

Every element `main.js` and `charts.js` reads or writes:

| Element ID | Type | Written by |
|---|---|---|
| `data-range-label` | `<div>` in header | `updateHeader()` |
| `val-total-blocks` | `.card-value` | `updateCards()` |
| `val-unique-pools` | `.card-value` | `updateCards()` |
| `val-top-pool` | `.card-value` | `updateCards()` |
| `val-top-pool-pct` | `.card-sub` | `updateCards()` |
| `val-unknown` | `.card-value` | `updateCards()` |
| `donut-subtitle` | `<span>` | `renderAll()` |
| `range-buttons` | `<div>` container | `wireFilters()` listens; `renderAll()` updates `.active` |
| `epoch-buttons` | `<div>` container | `wireFilters()` listens; `renderAll()` updates `.active` |
| `bar-toggle` | `<div>` container | `wireFilters()` listens |
| `chart-donut` | `<div>` | `renderDonut()` — ECharts canvas |
| `pool-table` | `<div>` | `renderPoolTable()` — innerHTML |
| `chart-area` | `<div>` | `renderAreaChart()` — ECharts canvas |
| `chart-bar` | `<div>` | `renderBarChart()` — ECharts canvas |
| `chart-epoch` | `<div>` | `renderEpochChart()` — ECharts canvas |
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
