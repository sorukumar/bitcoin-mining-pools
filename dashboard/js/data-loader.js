/**
 * data-loader.js
 * Loads blocks.parquet via hyparquet and pool_meta.json
 * Returns a structured dataset ready for aggregation.
 */

const POOL_META_URL = './data/pool_meta.json';
const POOLS_INFO_URL = './data/lookup/pools_info.json';
const TIMELINES_URL = './data/lookup/timelines.json';

/**
 * @typedef {Object} Block
 * @property {number} height
 * @property {string} pool_slug
 * @property {string} pool_name
 * @property {number} epoch        – 0-4
 * @property {Date}   approx_date
 */

/**
 * @typedef {Object} Dataset
 * @property {Block[]}  blocks
 * @property {Object}   poolMeta   – { [poolName]: { link } }
 * @property {Object}   poolsInfo
 * @property {Object}   timelines
 * @property {Date}     minDate
 * @property {Date}     maxDate
 */

/** Fetch and parse the parquet file using hyparquet */
async function loadParquet(parquetUrl) {
  const { parquetRead } = window.__hyparquet;

  const res = await fetch(parquetUrl);
  if (!res.ok) throw new Error(`Failed to fetch parquet: ${res.status}`);
  const file = await res.arrayBuffer();

  return new Promise((resolve, reject) => {
    parquetRead({
      file,
      rowFormat: 'object',       // each row → plain JS object
      onComplete: (rows) => resolve(rows),
    }).catch(reject);
  });
}

/** Fetch pool metadata JSON */
async function loadPoolMeta() {
  const res = await fetch(POOL_META_URL);
  if (!res.ok) throw new Error(`Failed to fetch pool_meta: ${res.status}`);
  return res.json();
}

/** Fetch pools info JSON */
async function loadPoolsInfo() {
  const res = await fetch(POOLS_INFO_URL);
  if (!res.ok) throw new Error(`Failed to fetch pools_info: ${res.status}`);
  return res.json();
}

/** Fetch timelines JSON */
async function loadTimelines() {
  const res = await fetch(TIMELINES_URL);
  if (!res.ok) throw new Error(`Failed to fetch timelines: ${res.status}`);
  return res.json();
}

/** Main entry – returns a Dataset */
export async function loadData(period = 'post') {
  const parquetUrl = period === 'pre' ? './data/blocks_pre_2020.parquet' : './data/blocks_post_2020.parquet';
  const [blocks, poolMeta, poolsInfo, timelines] = await Promise.all([
    loadParquet(parquetUrl),
    loadPoolMeta(),
    loadPoolsInfo(),
    loadTimelines(),
  ]);

  // approx_date from hyparquet may be a timestamp number (ms) or a Date object
  // Normalise to JS Date
  for (const b of blocks) {
    if (!(b.approx_date instanceof Date)) {
      b.approx_date = new Date(
        typeof b.approx_date === 'bigint'
          ? Number(b.approx_date) / 1000   // parquet timestamps are in µs
          : b.approx_date
      );
    }
  }

  // Sort ascending by height (should already be, but guarantee it)
  blocks.sort((a, b) => a.height - b.height);

  const minDate = blocks[0].approx_date;
  const maxDate = blocks[blocks.length - 1].approx_date;

  return { blocks, poolMeta, poolsInfo, timelines, minDate, maxDate };
}

/**
 * Filter blocks by a time range string: '1M','3M','6M','1Y','2Y','ALL'
 * or by epoch number (0-4).
 */
export function filterBlocks(blocks, { range = 'ALL', epoch = null } = {}) {
  if (epoch !== null) {
    return blocks.filter(b => b.epoch === epoch);
  }
  if (range === 'ALL') return blocks;

  const now   = blocks[blocks.length - 1].approx_date;
  const units = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 };
  const months = units[range] ?? 0;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return blocks.filter(b => b.approx_date >= cutoff);
}

/**
 * Aggregate filtered blocks into pool counts.
 * Returns array sorted by count desc: [{ name, slug, count, pct }]
 */
export function aggregateByPool(blocks) {
  const total = blocks.length;
  const counts = new Map();
  for (const b of blocks) {
    const key = b.pool_name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, pct: count / total * 100 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate blocks into monthly time series per pool.
 * Returns { months: string[], pools: { [name]: number[] } }
 * Only includes top N pools by total blocks; rest merged into "Other".
 */
export function aggregateMonthly(blocks, topN = 12) {
  // First find top N pool names
  const totals = new Map();
  for (const b of blocks) {
    totals.set(b.pool_name, (totals.get(b.pool_name) ?? 0) + 1);
  }
  const topPools = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);
  const topSet = new Set(topPools);

  // Build month → pool → count
  const monthMap = new Map();
  for (const b of blocks) {
    const d = b.approx_date;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(key)) monthMap.set(key, new Map());
    const poolName = topSet.has(b.pool_name) ? b.pool_name : 'Other';
    const m = monthMap.get(key);
    m.set(poolName, (m.get(poolName) ?? 0) + 1);
  }

  const months = Array.from(monthMap.keys()).sort();
  const poolNames = [...topPools, 'Other'];
  const series = {};
  for (const p of poolNames) {
    series[p] = months.map(m => monthMap.get(m)?.get(p) ?? 0);
  }

  // Compute HHI per month
  const hhi = months.map(m => {
    const monthData = monthMap.get(m);
    const total = Array.from(monthData.values()).reduce((s, v) => s + v, 0);
    if (total === 0) return 0;
    const shares = Array.from(monthData.values()).map(v => v / total);
    return shares.reduce((sum, s) => sum + s * s, 0) * 10000; // Scaled HHI
  });

  return { months, series, poolNames, hhi };
}

/**
 * Aggregate cumulative unique pools over time.
 * Returns { months: string[], cumulativePools: number[] }
 */
export function aggregatePoolEntry(filtered) {
  const monthMap = new Map();
  const poolSet = new Set();

  for (const b of filtered) {
    const d = b.approx_date;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(key)) monthMap.set(key, []);
    monthMap.get(key).push(b.pool_name);
  }

  const months = Array.from(monthMap.keys()).sort();
  const cumulativePools = [];
  const seenPools = new Set();

  for (const m of months) {
    const poolsInMonth = monthMap.get(m);
    poolsInMonth.forEach(p => seenPools.add(p));
    cumulativePools.push(seenPools.size);
  }

  return { months, cumulativePools };
}
