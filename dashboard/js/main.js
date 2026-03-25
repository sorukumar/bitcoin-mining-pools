/**
 * main.js
 * App bootstrap — wires data loading, filters, and chart rendering.
 */

import { loadData, filterBlocks, aggregateByPool, aggregateMonthly, aggregatePoolEntry } from './data-loader.js';
import { renderDonut, renderPoolTable, renderAreaChart, renderLineChart } from './charts.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allBlocks   = [];
let poolMeta    = {};
let poolsInfo   = [];
let timelines   = [];
let activeRange = 'ALL';
let activePeriod = 'post'; // 'pre' or 'post'
let barMetric   = 'blocks';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n)    { return n.toLocaleString(); }
function fmtPct(n) { return n.toFixed(1) + '%'; }
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function hideOverlay() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 500);
}

function showError(msg) {
  const el = document.getElementById('loading-overlay');
  el.innerHTML = `<p style="color:#f85149;font-size:.95rem;">⚠ ${msg}</p>`;
}

// ── Summary cards ─────────────────────────────────────────────────────────────
function updateCards(filtered) {
  const total   = filtered.length;
  let unknown = 0;
  const poolNames = new Set();
  for (const b of filtered) {
    if (b.pool_slug === 'unknown') unknown++;
    poolNames.add(b.pool_name);
  }
  const poolAgg = aggregateByPool(filtered.filter(b => b.pool_slug !== 'unknown'));
  const top     = poolAgg[0];

  // Calculate pool concentration: top 3 pools' share
  const top3Pct = poolAgg.slice(0, 3).reduce((s, p) => s + p.pct, 0);

  // Calculate HHI: sum of (share)^2 * 10000
  const hhi = poolAgg.reduce((sum, p) => sum + (p.pct / 100) ** 2, 0) * 10000;

  // Determine HHI level for intuitiveness
  let hhiLevel = 'Low';
  if (hhi > 2500) hhiLevel = 'High';
  else if (hhi > 1500) hhiLevel = 'Moderate';

  document.getElementById('val-unique-pools').textContent  = poolNames.size - 1; // -1 for Unknown
  document.getElementById('val-top-pool').textContent      = top?.name ?? '—';
  document.getElementById('val-top-pool-pct').textContent  = top ? fmtPct(top.pct) + ' of blocks' : '';
  document.getElementById('val-concentration').textContent = fmtPct(top3Pct);
  document.getElementById('val-hhi').textContent          = hhi.toFixed(0);
  document.getElementById('val-hhi-sub').innerHTML      = `${hhiLevel} Concentration <a href="https://en.wikipedia.org/wiki/Herfindahl%E2%80%93Hirschman_index" target="_blank">(read about HHI)</a>`;
}

// ── Header date range ────────────────────────────────────────────────────────
// function updateHeader(filtered) {
//   // blocks are sorted ascending by height, so first/last = min/max date
//   const minD = filtered[0].approx_date;
//   const maxD = filtered[filtered.length - 1].approx_date;
//   document.getElementById('data-range-label').textContent =
//     `${fmtDate(minD)} – ${fmtDate(maxD)} · ${fmt(filtered.length)} blocks`;
// }

// ── Full render pass ──────────────────────────────────────────────────────────
function renderAll() {
  const filtered = filterBlocks(allBlocks, { range: activeRange });

  // updateHeader(filtered);
  updateCards(filtered);

  const poolAgg = aggregateByPool(filtered);
  renderDonut(poolAgg, poolMeta, poolsInfo);
  renderPoolTable(poolAgg, poolMeta);

  const monthly = aggregateMonthly(filtered, 12);
  renderAreaChart({ ...monthly, timelines });

  const poolEntry = aggregatePoolEntry(filtered);
  renderLineChart(poolEntry);

  // Update donut subtitle
  const label = activePeriod === 'pre' 
    ? 'Pre-2020 · Top 15 pools' 
    : (activeRange === 'ALL' ? 'All-time · Top 15 pools' : `Last ${activeRange} · Top 15 pools`);
  document.getElementById('donut-subtitle').textContent = label;
}

// ── Filter button wiring ──────────────────────────────────────────────────────
function wireFilters() {
  // Period buttons
  document.getElementById('period-buttons').addEventListener('click', async (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    const period = btn.dataset.period;
    if (period === activePeriod) return; // No change
    activePeriod = period;
    document.querySelectorAll('#period-buttons .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Reset filters
    activeRange = 'ALL';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-range="ALL"]').classList.add('active');
    // Toggle time range visibility
    document.getElementById('time-range-section').style.display = period === 'post' ? 'flex' : 'none';
    // Reload data
    await loadAndRender(period);
  });

  // Time range buttons
  document.getElementById('range-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    activeRange = btn.dataset.range;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAll();
  });

  // Removed bar-toggle listener because Top Pools chart has been removed
}

// ── Load and render ───────────────────────────────────────────────────────────
async function loadAndRender(period) {
  try {
    // Show loading
    document.getElementById('loading-overlay').classList.remove('hidden');
    document.getElementById('loading-overlay').innerHTML = `
      <div class="spinner"></div>
      <p>Loading ${period === 'pre' ? 'pre-2020' : 'post-2020'} data…</p>
    `;

    const dataset = await loadData(period);
    allBlocks = dataset.blocks;
    poolMeta  = dataset.poolMeta;
    poolsInfo = dataset.poolsInfo;
    timelines = dataset.timelines;

    renderAll();
    hideOverlay();
  } catch (err) {
    console.error(err);
    showError(`Failed to load data: ${err.message}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function initApp() {
  await loadAndRender('post');
  wireFilters();
}
