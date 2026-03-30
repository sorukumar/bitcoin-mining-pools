# Adding Features — Patterns & Recipes

This document gives concrete step-by-step patterns for the most common
extension tasks. Read `01-architecture.md` and `02-data-flow.md` first.

---

## Pattern 0 — Add a New Column to the Top Miners Table

The Top Miners table (Ecosystem & History tab) already receives `forensics` and
`slugToName` and renders **Empty Block %** and **Avg Txs / Blk** columns.
Use this pattern to add another per-pool metric (e.g. avg fee rate, block size).

### Step 1: Add the metric to `process_forensics.py`

Compute it in the KPI 5 or KPI 6 loop (or add a new KPI loop) using
`extended_pools` — **not** `top_pools` — so all active pools are covered:

```python
for pool in extended_pools:
    p_df = df[df['pool_name'] == pool]
    if len(p_df) < 50: continue

    your_stat = round(float(p_df['your_column'].mean()), 2)
    your_stats.append({ "pool": pool, "your_stat": your_stat })
```

Add the list to the `output` dict at the bottom of `main()`:
```python
output = {
    ...
    "kpi_your_stat": your_stats,
}
```

Re-run: `python3 scripts/process_forensics.py`

### Step 2: Build the lookup map in `charts.js → renderTopMinersTable`

The forensics keys are raw pool slugs. Resolve to display names via `slugToName`:

```js
const yourStatByName = {};
(forensics.kpi_your_stat || []).forEach(e => {
  const displayName = slugToName[e.pool] || e.pool;
  yourStatByName[displayName] = e;
});
```

### Step 3: Look up per-row and render the cell

```js
const yourData = yourStatByName[p.name];
let yourCell = '<span style="color:var(--text-secondary);opacity:0.4;">—</span>';
if (yourData) {
  yourCell = yourData.your_stat.toFixed(2);
}
```

### Step 4: Add the column header and cell to the table HTML

```js
// In the <thead> row:
<th style="text-align: right; padding-right: 20px;" title="Your tooltip">Your Label</th>

// In each <tr>:
<td style="text-align: right; font-size: 0.85rem; padding-right: 20px;">${yourCell}</td>
```

**Key invariant:** Always resolve forensics slugs through `slugToName` before
building display-name-keyed maps. Never re-slugify the display name — dots and
other characters in names like `Ocean.xyz` will produce wrong keys.

---

## Pattern 1 — Add a New Chart

**Example:** Add a "Difficulty Over Time" line chart.

### Step 1: Add the HTML shell in `index.html`
```html
<!-- inside .charts-grid -->
<div class="chart-card chart-card--wide">
  <div class="chart-header">
    <h2>Difficulty Over Time</h2>
    <span class="chart-sub">Per block · scroll to zoom</span>
  </div>
  <div id="chart-difficulty" class="chart-el chart-el--tall"></div>
</div>
```
Use existing CSS classes — no new CSS needed for standard sizing:
- `chart-el--tall` → 400px height, full width
- `chart-el--medium` → 340px height, full width
- `chart-card--wide` → spans both grid columns

### Step 2: Add an aggregation function in `data-loader.js`
```js
// Returns [{ month: "2023-04", avgDifficulty: 12345678 }]
export function aggregateDifficulty(blocks) {
  const monthMap = new Map();
  for (const b of blocks) {
    const d = b.date;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!monthMap.has(key)) monthMap.set(key, { sum: 0, count: 0 });
    const m = monthMap.get(key);
    m.sum += b.difficulty;   // requires difficulty column in parquet (V1+)
    m.count++;
  }
  return Array.from(monthMap.entries())
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([month, {sum, count}]) => ({ month, avgDifficulty: sum / count }));
}
```
> **Note:** `difficulty` is not in the current parquet schema (V0). Add it in
> `prepare_data.py` and regenerate. See `02-data-flow.md § Future Schema Changes`.

### Step 3: Add a render function in `charts.js`
```js
let difficultyChart = null;

export function renderDifficultyChart(data) {
  const el = document.getElementById('chart-difficulty');
  if (!difficultyChart) {
    difficultyChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => difficultyChart.resize());
  }
  difficultyChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { ...baseTooltip(), trigger: 'axis' },
    xAxis: { type: 'category', data: data.map(d => d.month), ... },
    yAxis: { type: 'value', ... },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series: [{ type: 'line', data: data.map(d => d.avgDifficulty), ... }],
  }, true);  // ← always pass true (notMerge)
}
```
Follow the existing chart patterns in `charts.js` — use `THEME` constants,
`baseTooltip()`, and always `setOption(..., true)`.

Also add to `resizeAll()`:
```js
export function resizeAll() {
  // ...existing code...
  difficultyChart?.resize();
}
```

### Step 4: Wire it in `main.js`

Import it:
```js
import { ..., renderDifficultyChart } from './charts.js';
import { ..., aggregateDifficulty }   from './data-loader.js';
```

Call it in `renderAll()`:
```js
function renderAll() {
  // ...existing code...
  const diffData = aggregateDifficulty(filtered);
  renderDifficultyChart(diffData);
}
```

---

## Pattern 2 — Add a New Column to the Parquet

**Example:** Add real `timestamp` (unix seconds) from mempool API data.

### Step 1: Update `prepare_data.py`

In the section after `blocks["epoch"] = ...`:
```python
# Real timestamp (unix seconds) — from mempool/node fetch
# blocks_new.csv must have a 'timestamp' column
blocks["timestamp"] = blocks["timestamp"].astype("int64")
```

If merging with a new CSV that has timestamps:
```python
new_blocks = pd.read_csv("data/raw/blocks_new.csv",
    dtype={"height":"int32","hash":"str","pool_slug":"str","timestamp":"int64"})
blocks = pd.concat([blocks, new_blocks]).drop_duplicates("height").sort_values("height")
```

Update the parquet write to include it:
```python
pq.write_table(table, out_path,
    compression="snappy",
    use_dictionary=["pool_slug", "pool_name"],
    write_statistics=True)
# No change needed — all columns in `table` are written automatically
```

### Step 2: Update `data-loader.js`

Once `timestamp` is in the parquet, rows will have `b.timestamp` automatically.
Replace the `date` usage in time-sensitive functions:

```js
// In loadData(), after parquetRead:
for (const b of blocks) {
  // Use real timestamp if present, fall back to date
  b.date = b.timestamp
    ? new Date(b.timestamp * 1000)   // unix seconds → ms
    : b.date;
}
```

Update `filterBlocks` to use `b.date` instead of `b.date`.

### Step 3: Update `aggregateMonthly` and `updateHeader`

Replace all `b.date` references with `b.date`.

> **Rule:** Never remove `date` from the parquet for old blocks — it is
> the fallback for heights that predate the mempool API fetch. New blocks from
> V1 onwards will have real timestamps.

---

## Pattern 3 — Add a New Filter

**Example:** Add a "Pool" dropdown to filter all charts to a single pool.

### Step 1: Add HTML in `index.html`
```html
<!-- inside .filter-bar -->
<div class="filter-label">Pool</div>
<select id="pool-select" class="pool-select">
  <option value="">All Pools</option>
</select>
```

Add CSS in `style.css`:
```css
.pool-select {
  background: var(--bg2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: .3rem .6rem;
  font-size: .8rem;
}
```

### Step 2: Add state in `main.js`
```js
let activePool = '';   // '' = all pools; 'AntPool' = single pool filter
```

### Step 3: Populate the dropdown after data loads (in `initApp`)
```js
// After allBlocks is set:
const select = document.getElementById('pool-select');
const names = [...new Set(allBlocks.map(b => b.pool_name))]
  .filter(n => n !== 'Unknown')
  .sort();
for (const name of names) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  select.appendChild(opt);
}
```

### Step 4: Wire the listener in `wireFilters()`
```js
document.getElementById('pool-select').addEventListener('change', (e) => {
  activePool = e.target.value;
  renderAll();
});
```

### Step 5: Apply in `filterBlocks` or in `renderAll`
The cleanest approach is to apply it as a second filter in `renderAll()`:
```js
function renderAll() {
  let filtered = filterBlocks(allBlocks, { range: activeRange });
  if (activePool) {
    filtered = filtered.filter(b => b.pool_name === activePool);
  }
  // ...rest unchanged...
}
```

---

## Pattern 4 — Add a New Data Source (V1: mempool gap fill)

The gap between jlopp's CSV (height 869,305) and the current tip (~942,000)
needs to be fetched. This is the V1 task.

### Create `scripts/fetch_blocks.py`
```python
"""Fetches missing blocks from mempool.space API and appends to blocks_new.csv"""
import requests, csv, time
from pathlib import Path

RAW = Path("data/raw")

def get_tip():
    return requests.get("https://mempool.space/api/blocks/tip/height").json()

def fetch_batch(height):
    """Returns up to 15 blocks starting at height"""
    r = requests.get(f"https://mempool.space/api/v1/blocks/{height}", timeout=30)
    r.raise_for_status()
    return r.json()

def main():
    # Read last height in existing CSV
    with open(RAW / "blocks.csv") as f:
        last_height = int(list(csv.reader(f))[-1][0])

    tip = get_tip()
    print(f"Fetching heights {last_height+1} to {tip}")

    with open(RAW / "blocks_new.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["height", "hash", "pool_slug", "timestamp"])
        current = last_height + 1
        while current <= tip:
            blocks = fetch_batch(current)
            for b in sorted(blocks, key=lambda x: x["height"]):
                writer.writerow([
                    b["height"],
                    b["id"],
                    b["extras"]["pool"]["slug"],
                    b["timestamp"],
                ])
            current += 15
            time.sleep(0.1)  # be polite to mempool.space
```

### Update `prepare_data.py` to merge both CSVs
```python
# After loading blocks.csv:
new_path = RAW / "blocks_new.csv"
if new_path.exists():
    new_blocks = pd.read_csv(new_path, dtype={"height":"int32",...})
    blocks = pd.concat([blocks, new_blocks]).drop_duplicates("height")
    blocks = blocks.sort_values("height").reset_index(drop=True)
    print(f"  After merge: {len(blocks):,} blocks")
```

---

## Pattern 5 — Add Geolocation Data (V3)

The `data/geo/` folder is reserved for this. The pattern will be:

```
data/geo/
├── pool_countries.json    ← { "AntPool": "CN", "Foundry USA": "US", ... }
└── country_meta.json      ← { "CN": { "name": "China", "flag": "🇨🇳" }, ... }
```

### In `prepare_data.py`
```python
import json
geo = json.load(open("data/geo/pool_countries.json"))
blocks["country"] = blocks["pool_name"].map(geo).fillna("Unknown")
# Add to parquet with dictionary encoding:
pq.write_table(table, ..., use_dictionary=["pool_slug","pool_name","country"])
```

### New aggregation in `data-loader.js`
```js
export function aggregateByCountry(blocks) {
  const counts = new Map();
  for (const b of blocks) {
    counts.set(b.country, (counts.get(b.country) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([country, count]) => ({ country, count, pct: count/blocks.length*100 }))
    .sort((a,b) => b.count - a.count);
}
```

### New chart in `charts.js`
Use ECharts' built-in `map` series or a `treemap` to show country distribution.
ECharts map requires registering a GeoJSON — see the ECharts docs for
`echarts.registerMap('world', geoJson)`.

## Pattern 6 — Adding Forensic Metrics

The `scripts/process_forensics.py` pipeline handles advanced network analysis by exporting a structured JSON (`dashboard/data/forensics_data.json`) dedicated entirely to reorg risks and mathematical profiling.

### Key Metrics Calculated:
1. **Consecutive Strikes**: Detecting pools mining 6+ blocks sequentially.
2. **Luck Funnel (Z-Score)**: Comparing observed block counts vs expected based on market share. $Z > 3$ indicates statistically improbable luck (hidden hashrate).
3. **Entropy Heatmap**: Coefficient of Variation (CV) on block arrival times.
4. **Latency Histogram**: Distribution of time deltas during consecutive blocks. `< 30s` is highlighted as the Reorg Risk Danger Zone based on network propagation metrics from forks/reorgs.

### To add a new forensics metric:
1. Calculate the new metric in `process_forensics.py`.
2. Append it to the `output` dictionary compiled at the end of the script.
3. Fetch it dynamically on load in `dashboard/js/data-loader.js` under the `loadForensics()` function.
4. Render using an ECharts function in `dashboard/js/charts.js`.

---

## Checklist for Any Change

Before submitting a change, verify:

- [ ] `compression="snappy"` is unchanged in `prepare_data.py`
- [ ] No `Math.min(...array)` or `Math.max(...array)` on large arrays
- [ ] New chart instances are created with `notMerge: true` in `setOption`
- [ ] New chart instances register a `window.resize` listener
- [ ] If parquet schema changed: `prepare_data.py` regenerated + both
      `dashboard/data/` files updated
- [ ] No npm packages, bundlers, or build steps introduced
- [ ] New DOM element IDs added to the DOM Element Map in `03-logic-flow.md`