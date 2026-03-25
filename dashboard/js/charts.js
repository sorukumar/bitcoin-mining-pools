/**
 * charts.js
 * All ECharts chart renderers.
 * Each function either initialises or updates a chart instance.
 */

const ec = () => window.__echarts;

// ── Shared palette (Bitcoin-themed, 15 distinct colours) ─────────────────────
export const POOL_COLORS = [
  '#f7931a', '#fbbf24', '#3fb950', '#58a6ff', '#d2a8ff',
  '#f85149', '#79c0ff', '#56d364', '#e3b341', '#ff7b72',
  '#b392f0', '#89d4ff', '#ffa657', '#7ee787', '#ff9492',
];

const THEME = {
  bg:        '#161b22',
  bg2:       '#21262d',
  border:    '#30363d',
  text:      '#e6edf3',
  muted:     '#8b949e',
  accent:    '#f7931a',
};

function baseTooltip(extra = {}) {
  return {
    backgroundColor: THEME.bg2,
    borderColor:     THEME.border,
    borderWidth:     1,
    textStyle: { color: THEME.text, fontSize: 12 },
    ...extra,
  };
}

// ── Donut chart ───────────────────────────────────────────────────────────────
let donutChart = null;

export function renderDonut(poolData, poolMeta, poolsInfo) {
  const el = document.getElementById('chart-donut');
  if (!donutChart) {
    donutChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => donutChart.resize());
  }

  // Top 15 + aggregate rest into "Other"
  const TOP = 15;
  const top   = poolData.slice(0, TOP);
  const other = poolData.slice(TOP).reduce((s, p) => s + p.count, 0);
  const total = poolData.reduce((s, p) => s + p.count, 0);

  const items = [
    ...top.map((p, i) => ({
      name:  p.name,
      value: p.count,
      itemStyle: { color: POOL_COLORS[i % POOL_COLORS.length] },
    })),
    ...(other > 0 ? [{ name: 'Other', value: other, itemStyle: { color: '#444c56' } }] : []),
  ];

  donutChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'item',
      formatter: (p) => {
        const pct = (p.value / total * 100).toFixed(2);
        const link = poolMeta[p.name]?.link;
        const nameStr = link
          ? `<a href="${link}" target="_blank" style="color:${THEME.accent}">${p.name}</a>`
          : p.name;
        const poolInfo = poolsInfo.find(info => info.name === p.name);
        let scoopLine = '';
        if (poolInfo?.the_scoop) {
          const short = poolInfo.the_scoop.length > 120
            ? poolInfo.the_scoop.slice(0, 117) + '…'
            : poolInfo.the_scoop;
          scoopLine = `<br/><span style="display:block;margin-top:4px;font-size:11px;color:${THEME.muted}">${short}</span>`;
        }
        return `${nameStr}<br/><b>${p.value.toLocaleString()}</b> blocks · <b>${pct}%</b>${scoopLine}`;
      },
    },
    series: [{
      type: 'pie',
      radius: ['42%', '72%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: THEME.bg, borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: {
          show: true,
          fontSize: 13,
          fontWeight: 'bold',
          color: THEME.text,
          formatter: (p) => `${p.name}\n${(p.value / total * 100).toFixed(1)}%`,
        },
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(247,147,26,0.4)' },
      },
      data: items,
    }],
  }, true);
}

// ── Pool table (companion to donut) ──────────────────────────────────────────
export function renderPoolTable(poolData, poolMeta) {
  const el = document.getElementById('pool-table');
  const total = poolData.reduce((s, p) => s + p.count, 0);
  const maxPct = poolData[0]?.pct ?? 1;

  const rows = poolData.slice(0, 20).map((p, i) => {
    const link = poolMeta[p.name]?.link;
    const nameCell = link
      ? `<a href="${link}" target="_blank">${p.name}</a>`
      : p.name;
    const barW = (p.pct / maxPct * 100).toFixed(1);
    const color = POOL_COLORS[i] ?? '#444c56';
    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-name">${nameCell}</td>
        <td class="td-pct">${p.pct.toFixed(2)}%</td>
        <td class="td-bar">
          <div class="bar-track">
            <div class="bar-fill" style="width:${barW}%;background:${color}"></div>
          </div>
        </td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="pool-table-inner">
      <table>
        <thead>
          <tr>
            <th class="td-rank">#</th>
            <th class="td-name">Pool</th>
            <th class="td-pct">Share</th>
            <th class="td-bar"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Stacked area chart ────────────────────────────────────────────────────────
let areaChart = null;

export function renderAreaChart({ months, series, poolNames, timelines = [], hhi = [] }) {
  const el = document.getElementById('chart-area');
  if (!areaChart) {
    areaChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => areaChart.resize());
  }

  const seriesList = poolNames.map((name, i) => ({
    name,
    type:  'line',
    stack: 'total',
    smooth: true,
    symbol: 'none',
    areaStyle: { opacity: 0.85 },
    lineStyle: { width: 0 },
    color: name === 'Other' ? '#444c56' : POOL_COLORS[i % POOL_COLORS.length],
    emphasis: { focus: 'series' },
    data: series[name],
  }));

  // Add HHI series if available
  if (hhi.length) {
    seriesList.push({
      name: 'HHI',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, color: '#ff7b72' },
      emphasis: { focus: 'series' },
      data: hhi,
    });
  }

  // Map timeline events to month keys
  const monthIndexByKey = new Map(months.map((m, idx) => [m, idx]));
  const parsedEvents = (timelines || []).map(t => {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const idx = monthIndexByKey.get(key);
    return idx != null ? { index: idx, key, ...t } : null;
  }).filter(Boolean);

  // Build markLine entries for visible milestone markers
  const markLineData = parsedEvents.map(ev => ({
    xAxis: ev.key,
    name: ev.event,
    lineStyle: {
      color: THEME.accent,
      type: 'dashed',
      width: 1,
      opacity: 0.7,
    },
    label: {
      show: true,
      formatter: ev.event,
      color: THEME.muted,
      rotate: 90,
      fontSize: 9,
      padding: [4, 0, 0, 0],
    },
  }));

  // Helper series only to host markLine (so it doesn't interfere with stacked area)
  if (markLineData.length) {
    seriesList.push({
      name: 'Milestones',
      type: 'line',
      data: [],
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { opacity: 0 },
      tooltip: { show: false },
      markLine: {
        symbol: 'none',
        data: markLineData,
      },
    });
  }

  areaChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: THEME.bg2 } },
      formatter: (params) => {
        const month = params[0].axisValue;
        const total = params.reduce((s, p) => s + (p.value || 0), 0);
        const lines = params
          .filter(p => p.seriesName !== 'Milestones' && p.seriesName !== 'HHI' && p.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 6)
          .map(p => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}: <b>${p.value}</b>`)
          .join('<br/>');
        const hhiVal = params.find(p => p.seriesName === 'HHI')?.value;
        const hhiLine = hhiVal != null ? `<br/>HHI: <b>${hhiVal.toFixed(0)}</b>` : '';
        const ev = parsedEvents.find(e => e.key === month);
        const evLine = ev
          ? `<br/><br/><span style="font-size:11px;color:${THEME.muted}"><b>${ev.event}</b><br/>${ev.description}</span>`
          : '';
        return `<b>${month}</b> · ${total} blocks<br/>${lines}${hhiLine}${evLine}`;
      },
    },
    legend: {
      type: 'scroll',
      bottom: 36,
      textStyle: { color: THEME.muted, fontSize: 11 },
      pageTextStyle: { color: THEME.muted },
      pageIconColor: THEME.accent,
      pageIconInactiveColor: THEME.border,
      data: poolNames.concat(hhi.length ? ['HHI'] : []),
    },
    grid: { top: 16, left: 56, right: 56, bottom: 90 }, // Adjusted right for secondary axis
    xAxis: {
      type: 'category',
      data: months,
      axisLine:  { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick:  { show: false },
    },
    yAxis: [
      {
        type: 'value',
        splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
        axisLabel: { color: THEME.muted, fontSize: 11 },
      },
      {
        type: 'value',
        position: 'right',
        splitLine: { show: false },
        axisLabel: { color: THEME.muted, fontSize: 11, formatter: '{value}' },
        min: 0,
        max: 10000,
      },
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        height: 22,
        bottom: 8,
        borderColor: THEME.border,
        backgroundColor: THEME.bg2,
        fillerColor: 'rgba(247,147,26,0.15)',
        handleStyle: { color: THEME.accent },
        textStyle: { color: THEME.muted, fontSize: 10 },
      },
    ],
    series: seriesList,
  }, true);
}

// ── Bar chart (top pools) ─────────────────────────────────────────────────────
let barChart = null;

export function renderBarChart(poolData, metric = 'blocks') {
  const el = document.getElementById('chart-bar');
  if (!barChart) {
    barChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => barChart.resize());
  }

  const TOP = 20;
  // exclude Unknown for the bar chart to keep it meaningful
  const data = poolData
    .filter(p => p.name !== 'Unknown')
    .slice(0, TOP)
    .reverse(); // ECharts bar goes bottom→top

  const values = data.map(p => metric === 'pct' ? +p.pct.toFixed(2) : p.count);
  const labels = data.map(p => p.name);
  const colors = data.map((_, i) => POOL_COLORS[(TOP - 1 - i) % POOL_COLORS.length]);

  barChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0];
        return metric === 'pct'
          ? `${p.name}: <b>${p.value}%</b>`
          : `${p.name}: <b>${p.value.toLocaleString()} blocks</b>`;
      },
    },
    grid: { top: 8, left: 100, right: 56, bottom: 8, containLabel: false },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: {
        color: THEME.muted, fontSize: 10,
        formatter: metric === 'pct' ? '{value}%' : (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v,
      },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLine:  { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.text, fontSize: 11 },
      axisTick:  { show: false },
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
      barMaxWidth: 18,
      label: {
        show: true,
        position: 'right',
        color: THEME.muted,
        fontSize: 10,
        formatter: metric === 'pct' ? '{c}%' : (p) => p.value >= 1000 ? `${(p.value/1000).toFixed(1)}k` : p.value,
      },
    }],
  }, true);
}

// ── Line chart (pool entry/exit) ──────────────────────────────────────────────
let lineChart = null;

export function renderLineChart({ months, cumulativePools }) {
  const el = document.getElementById('chart-line');
  if (!lineChart) {
    lineChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => lineChart.resize());
  }

  lineChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: THEME.bg2 } },
      formatter: (params) => {
        const month = params[0].axisValue;
        const pools = params[0].value;
        return `<b>${month}</b><br/>Cumulative unique pools: <b>${pools}</b>`;
      },
    },
    grid: { top: 16, left: 56, right: 16, bottom: 48 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine:  { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted, fontSize: 11 },
    },
    series: [{
      type: 'line',
      data: cumulativePools,
      smooth: true,
      symbol: 'none',
      lineStyle: { color: POOL_COLORS[0], width: 2 },
      areaStyle: { opacity: 0.3, color: POOL_COLORS[0] },
    }],
  }, true);
}

// ── Resize all ────────────────────────────────────────────────────────────────
export function resizeAll() {
  donutChart?.resize();
  areaChart?.resize();
  barChart?.resize();
  lineChart?.resize();
}
