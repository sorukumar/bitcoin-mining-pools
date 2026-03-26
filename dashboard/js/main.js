/**
 * main.js
 * App bootstrap — wires data loading, filters, and chart rendering.
 */

import { loadData, filterBlocks, aggregateByPool, aggregateByCountry, aggregateMonthly } from './data-loader.js?v=13';
import { renderDonut, renderPoolTable, renderCountryShareChart, renderAreaChart, renderEcosystemGrowthChart, renderHhiChart, renderConcentrationChart, donutChart, growthChart } from './charts.js?v=13';

// ── State ─────────────────────────────────────────────────────────────────────
let allBlocks   = [];
let poolMeta    = {};
let poolsInfo   = [];
let timelines   = [];
let ecosystem   = null;
let activeRange = '1Y';
let activeCountryRange = '1Y';
let activePeriod = 'post'; // 'pre' or 'post'
let barMetric   = 'blocks';

const profileHandler = (e) => showProfileCard(e.detail);

function showProfileCard(poolName) {
  if (!poolName || poolName === 'Other' || poolName === 'Unknown') return;
  const meta = poolMeta[poolName] || {};
  const info = poolsInfo.find(i => i.name === poolName) || {};
  
  const input = document.getElementById('pool-search-input');
  if (input) input.value = poolName; // Sync search input text
  
  const linkEl = document.getElementById('profile-link');
  if (meta.link) {
    linkEl.href = meta.link;
    linkEl.innerHTML = `${meta.link.replace(/^https?:\/\//, '')} <i class="fa-solid fa-external-link-alt" style="font-size: 0.75rem; margin-left: 2px;"></i>`;
    linkEl.style.display = 'inline-block';
  } else {
    linkEl.style.display = 'none';
    linkEl.href = '#';
  }
  
  document.getElementById('profile-scoop').textContent = info.the_scoop || 'No description available for this pool.';
  
  // Use the static metadata generated from all blocks
  if (meta.first_block_mined) {
    document.getElementById('profile-first-block').innerHTML = `${meta.first_block_mined.toLocaleString()}<br><span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: normal;">${meta.first_seen_date}</span>`;
    document.getElementById('profile-blocks').textContent = meta.lifetime_blocks.toLocaleString();
    document.getElementById('profile-share').textContent = meta.last_month_share_pct.toFixed(2) + '%';
  } else {
    document.getElementById('profile-first-block').textContent = 'Unknown';
    document.getElementById('profile-blocks').textContent = '-';
    document.getElementById('profile-share').textContent = '-';
  }
  
  document.getElementById('pool-profile-card').style.display = 'block';
}

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

// ── Summary cards (Locked to Latest Month) ───────────────────────────────────
function updateCardsLatestMonth() {
  if (!allBlocks || allBlocks.length === 0) return;
  const lastDate = new Date(allBlocks[allBlocks.length - 1].approx_date);
  const targetYear = lastDate.getUTCFullYear();
  const targetMonth = lastDate.getUTCMonth();
  
  const lastMonthBlocks = allBlocks.filter(b => {
    const d = new Date(b.approx_date);
    return d.getUTCFullYear() === targetYear && d.getUTCMonth() === targetMonth;
  });

  const poolNames = new Set();
  let unknown = 0;
  for (const b of lastMonthBlocks) {
    if (b.pool_slug === 'unknown') unknown++;
    poolNames.add(b.pool_name);
  }
  const poolAgg = aggregateByPool(lastMonthBlocks.filter(b => b.pool_slug !== 'unknown'));
  const top     = poolAgg[0];

  const top3Pct = poolAgg.slice(0, 3).reduce((s, p) => s + p.pct, 0);
  const hhi = poolAgg.reduce((sum, p) => sum + (p.pct / 100) ** 2, 0) * 10000;

  let hhiLevel = 'Healthy';
  if (hhi > 2500) hhiLevel = 'At Risk';
  else if (hhi > 1500) hhiLevel = 'Moderate';

  document.getElementById('val-latest-month').textContent = fmtDate(lastDate);
  document.getElementById('val-unique-pools').textContent  = poolNames.size - (poolNames.has('Unknown') ? 1 : 0);
  document.getElementById('val-top-pool').textContent      = top?.name ?? '—';
  document.getElementById('val-top-pool-pct').textContent  = top ? fmtPct(top.pct) + ' of blocks' : '';
  document.getElementById('val-concentration').textContent = fmtPct(top3Pct);
  document.getElementById('val-hhi').textContent          = hhi.toFixed(0);
  document.getElementById('val-hhi-sub').innerHTML      = `${hhiLevel} Centralization Index <a href="https://en.wikipedia.org/wiki/Herfindahl%E2%80%93Hirschman_index" target="_blank">(About HHI)</a>`;
}

// ── Static Macro Charts (Unfiltered) ──────────────────────────────────────────
function initStaticMacroCharts() {
  const monthly = aggregateMonthly(allBlocks, 12);
  const { months, series, poolNames } = monthly;
  
  const top3 = [];
  const top5 = [];
  
  for (let i = 0; i < months.length; i++) {
    let total = 0;
    let counts = [];
    for (const name of poolNames) {
      const v = series[name][i] || 0;
      total += v;
      if (name !== 'Unknown') counts.push(v);
    }
    counts.sort((a,b) => b - a);
    const t3Sum = counts.slice(0, 3).reduce((a,b) => a + b, 0);
    const t5Sum = counts.slice(0, 5).reduce((a,b) => a + b, 0);
    
    top3.push(total > 0 ? (t3Sum / total * 100) : 0);
    top5.push(total > 0 ? (t5Sum / total * 100) : 0);
  }
  renderAreaChart({ ...monthly, timelines });
  renderHhiChart({ months, hhi: monthly.hhi });
  renderConcentrationChart({ months, top3, top5 });
}

// ── Profile Dropdown / Search setup ──────────────────────────────────────────
let profileRegistry = { detailed: [], standard: [] };

function initProfileSelector() {
  const poolNamesSet = new Set();
  allBlocks.forEach(b => {
      if (b.pool_name !== 'Unknown' && b.pool_name !== 'Other') poolNamesSet.add(b.pool_name);
  });
  
  const infoNames = new Set(poolsInfo.map(i => i.name));
  const detailed = [];
  const standard = [];
  
  poolNamesSet.forEach(name => {
    if (infoNames.has(name)) detailed.push(name);
    else standard.push(name);
  });

  detailed.sort((a,b) => a.localeCompare(b));
  standard.sort((a,b) => a.localeCompare(b));
  profileRegistry = { detailed, standard };

  renderProfileSearchList(''); // Init with empty filter
  
  const input = document.getElementById('pool-search-input');
  const list = document.getElementById('pool-results-list');

  input.addEventListener('focus', () => {
    renderProfileSearchList(input.value);
    list.classList.add('show');
  });

  input.addEventListener('input', (e) => {
    renderProfileSearchList(e.target.value);
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pool-search-container')) {
      list.classList.remove('show');
    }
  });
}

function renderProfileSearchList(query = '') {
  const list = document.getElementById('pool-results-list');
  const q = query.toLowerCase();
  
  const matchesDetailed = profileRegistry.detailed.filter(n => n.toLowerCase().includes(q));
  const matchesStandard = profileRegistry.standard.filter(n => n.toLowerCase().includes(q));
  
  if (matchesDetailed.length === 0 && matchesStandard.length === 0) {
    list.innerHTML = '<li class="pool-result-no-match">No results found</li>';
    return;
  }

  let html = '';
  if (matchesDetailed.length > 0) {
    html += '<li class="pool-result-group">Detailed Profiles</li>';
    html += matchesDetailed.map(n => `<li class="pool-result-item" data-value="${n}">${n}</li>`).join('');
  }
  if (matchesStandard.length > 0) {
    html += '<li class="pool-result-group">Other Pools</li>';
    html += matchesStandard.map(n => `<li class="pool-result-item" data-value="${n}">${n}</li>`).join('');
  }
  
  list.innerHTML = html;
  
  // Attach listeners to new items
  list.querySelectorAll('.pool-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.getAttribute('data-value');
      document.dispatchEvent(new CustomEvent('request-profile', { detail: val }));
      list.classList.remove('show');
    });
  });
}

// ── Header date range ────────────────────────────────────────────────────────
// function updateHeader(filtered) {
//   // blocks are sorted ascending by height, so first/last = min/max date
//   const minD = filtered[0].approx_date;
//   const maxD = filtered[filtered.length - 1].approx_date;
//   document.getElementById('data-range-label').textContent =
//     `${fmtDate(minD)} – ${fmtDate(maxD)} · ${fmt(filtered.length)} blocks`;
// }

function renderAll() {
  // 1. Snapshot charts (Donut, Table) respect the active timeframe scope (1M, 3M, etc.)
  const filtered = filterBlocks(allBlocks, { range: activeRange });
  
  const poolAgg = aggregateByPool(filtered);
  renderDonut(poolAgg, poolMeta, poolsInfo);
  renderPoolTable(poolAgg, poolMeta);

  // Snapshot for Country Share independently respects its active timeframe
  const filteredCountry = filterBlocks(allBlocks, { range: activeCountryRange });
  const countryPoolAgg = aggregateByPool(filteredCountry);
  const countryAgg = aggregateByCountry(countryPoolAgg, poolsInfo);
  renderCountryShareChart(countryAgg);

  // 2. Ecosystem chart uses entirely global data (spanning from genesis to present)
  renderEcosystemGrowthChart(ecosystem, poolMeta);

  // Handle custom request-profile events from the new search UI
  document.removeEventListener('request-profile', profileHandler);
  document.addEventListener('request-profile', profileHandler);

  if (growthChart) {
    growthChart.off('click');
    growthChart.on('click', (params) => {
      if (params.seriesType === 'scatter') {
        showProfileCard(params.name);
        // Safely scroll to the manually positioned profile card container smoothly
        document.getElementById('pool-profile-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Update donut subtitle
  const label = activeRange === 'ALL' ? 'All-time · Market share (blocks)' : `Last ${activeRange} · Market share (blocks)`;
  document.getElementById('donut-subtitle').textContent = label;

  const countryLabel = activeCountryRange === 'ALL' ? 'All-time · Geographic footprint' : `Last ${activeCountryRange} · Geographic footprint`;
  document.getElementById('country-subtitle').textContent = countryLabel;
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
    
    // Update range filters based on period selection
    activeRange = (period === 'pre') ? 'ALL' : '1Y';
    activeCountryRange = (period === 'pre') ? 'ALL' : '1Y';
    
    document.querySelectorAll('#range-buttons .filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`#range-buttons .filter-btn[data-range="${activeRange}"]`).classList.add('active');
    
    document.querySelectorAll('#country-range-buttons .filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`#country-range-buttons .filter-btn[data-range="${activeCountryRange}"]`).classList.add('active');
    
    // Reload data
    await loadAndRender(period);
  });

  // Time range buttons (Pool Share)
  document.getElementById('range-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    activeRange = btn.dataset.range;
    document.querySelectorAll('#range-buttons .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAll();
  });

  // Time range buttons (Country Share)
  document.getElementById('country-range-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    activeCountryRange = btn.dataset.range;
    document.querySelectorAll('#country-range-buttons .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAll();
  });
}

// ── Load and render ───────────────────────────────────────────────────────────
async function loadAndRender(period) {
  try {
    // Show loading
    document.getElementById('loading-overlay').classList.remove('hidden');
    document.getElementById('loading-overlay').innerHTML = `
      <div class="spinner"></div>
      <p>Loading ${period === 'pre' ? 'full historical' : 'post-2020'} data…</p>
    `;

    const dataset = await loadData(period);
    allBlocks = dataset.blocks;
    poolMeta  = dataset.poolMeta;
    poolsInfo = dataset.poolsInfo;
    timelines = dataset.timelines;
    ecosystem = dataset.ecosystem;

    updateCardsLatestMonth();
    initStaticMacroCharts();
    initProfileSelector();

    renderAll();
    
    // Default the profile card to the top pool
    const topPool = Object.keys(poolMeta).sort((a,b) => poolMeta[b].lifetime_blocks - poolMeta[a].lifetime_blocks)[0];
    if (topPool) showProfileCard(topPool);

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
