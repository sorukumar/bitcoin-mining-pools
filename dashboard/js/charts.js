/**
 * charts.js
 * All ECharts chart renderers.
 * Each function either initialises or updates a chart instance.
 */

const ec = () => window.__echarts;

// ── Shared palette (Bitcoin-themed, 15 distinct colours) ─────────────────────
export const POOL_COLORS = [
  '#E5C07B', '#7BAE7F', '#8AB4F8', '#E06C75', '#C678DD',
  '#56B6C2', '#98C379', '#F29F67', '#D19A66', '#61AFEF',
  '#ABB2BF', '#BE835D', '#A0B89C', '#879BBF', '#D4A0A4'
];

const THEME = {
  bg: '#161b22',
  bg2: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#E2A34A',
};

function baseTooltip(extra = {}) {
  return {
    backgroundColor: THEME.bg2,
    borderColor: THEME.border,
    borderWidth: 1,
    textStyle: { color: THEME.text, fontSize: 12 },
    ...extra,
  };
}

// ── Donut chart ───────────────────────────────────────────────────────────────
export let donutChart = null;

export function renderDonut(poolData, poolMeta, poolsInfo) {
  const el = document.getElementById('chart-donut');
  if (!donutChart) {
    donutChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => donutChart.resize());
  }

  // Top 15 + aggregate rest into "Other"
  const TOP = 15;
  const top = poolData.slice(0, TOP);
  const other = poolData.slice(TOP).reduce((s, p) => s + p.count, 0);
  const total = poolData.reduce((s, p) => s + p.count, 0);

  const items = [
    ...top.map((p, i) => ({
      name: p.name,
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
          formatter: (p) => `${p.name}\n${Math.round(p.value / total * 100)}%`,
        },
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(226,163,74,0.4)' },
      },
      data: items,
    }],
  }, true);

  // Trigger profile lookup on slice click
  donutChart.off('click');
  donutChart.on('click', (p) => {
    document.dispatchEvent(new CustomEvent('request-profile', { detail: p.data.name || p.name }));
    document.getElementById('pool-profile-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// ── Pool table (companion to donut) ──────────────────────────────────────────
export function renderPoolTable(poolData, poolMeta) {
  const el = document.getElementById('pool-table');
  const total = poolData.reduce((s, p) => s + p.count, 0);
  const maxPct = poolData[0]?.pct ?? 1;

  const rows = poolData.slice(0, 10).map((p, i) => {
    const nameCell = p.name;
    const barW = (p.pct / maxPct * 100).toFixed(1);
    const color = POOL_COLORS[i] ?? '#444c56';
    return `
      <tr class="pool-row" data-pool="${p.name}">
        <td class="td-rank">${i + 1}</td>
        <td class="td-name">${nameCell}</td>
        <td class="td-pct">${Math.round(p.pct)}%</td>
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

  // Add click listeners to rows to trigger profile lookup
  el.querySelectorAll('.pool-row').forEach(row => {
    row.addEventListener('click', () => {
      const pool = row.getAttribute('data-pool');
      document.dispatchEvent(new CustomEvent('request-profile', { detail: pool }));
      
      // Optional: scroll to the profile card smoothly
      document.getElementById('pool-profile-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

// ── Country Share chart ──────────────────────────────────────────────────────
export let countryChart = null;

export function renderCountryShareChart(countryAgg) {
  const el = document.getElementById('chart-country');
  if (!countryChart) {
    countryChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => countryChart.resize());
  }

  const total = countryAgg.reduce((s, c) => s + c.count, 0);

  // Group top 10 countries and "Other"
  const TOP = 10;
  const top = countryAgg.slice(0, TOP);
  const other = countryAgg.slice(TOP).reduce((s, c) => s + c.count, 0);

  const items = [
    ...top.map((c, i) => ({
      name: c.country,
      value: c.count,
      itemStyle: { color: POOL_COLORS[(i + 3) % POOL_COLORS.length] },
    })),
    ...(other > 0 ? [{ name: 'Other', value: other, itemStyle: { color: '#444c56' } }] : []),
  ];

  countryChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'item',
      formatter: (p) => {
        const pct = (p.value / total * 100).toFixed(2);
        return `<b>${p.name}</b><br/>${p.value.toLocaleString()} blocks · <b>${pct}%</b>`;
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
        label: { show: false },
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(226,163,74,0.4)' },
      },
      data: items,
    }],
  }, true);
}

// ── Stacked area chart ────────────────────────────────────────────────────────
let areaChart = null;

export function renderAreaChart({ months, series, poolNames, timelines = [] }) {
  const el = document.getElementById('chart-area');
  if (!areaChart) {
    areaChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => areaChart.resize());
  }

  // Calculate totals to find Top 7 (excluding 'Other' bucket if present)
  const poolTotals = poolNames
    .filter(name => name !== 'Other')
    .map(name => ({
      name,
      total: series[name].reduce((sum, v) => sum + (v || 0), 0)
    })).sort((a, b) => b.total - a.total);

  const topNames = poolTotals.slice(0, 7).map(p => p.name);
  const topSet = new Set(topNames);

  const groupedSeries = {};
  topNames.forEach(name => groupedSeries[name] = [...series[name]]);
  groupedSeries['Other'] = new Array(months.length).fill(0);

  for (let i = 0; i < poolNames.length; i++) {
    const name = poolNames[i];
    if (!topSet.has(name)) { 
      // This catch-all includes both the 'Other' bucket and any pools not in top 7
      for (let j = 0; j < months.length; j++) {
        groupedSeries['Other'][j] += (series[name][j] || 0);
      }
    }
  }

  const finalNames = [...topNames];
  if (groupedSeries['Other'].some(v => v > 0)) {
    finalNames.push('Other');
  }

  const seriesList = finalNames.map((name, i) => ({
    name,
    type: 'line',
    stack: 'total',
    smooth: true,
    symbol: 'none',
    areaStyle: { opacity: 0.85 },
    lineStyle: { width: 0 },
    color: name === 'Other' ? '#444c56' : POOL_COLORS[i % POOL_COLORS.length],
    emphasis: { focus: 'series' },
    data: groupedSeries[name],
  }));

  // Map timeline events to month keys
  const monthIndexByKey = new Map(months.map((m, idx) => [m, idx]));
  const parsedEvents = (timelines || []).map(t => {
    const d = new Date(t.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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
      width: 2,
      opacity: 1,
    },
    label: {
      show: true,
      formatter: ev.event,
      color: THEME.text,
      rotate: 90,
      fontSize: 11,
      fontWeight: 'bold',
      padding: [4, 0, 0, 0],
    },
  }));

  // Helper series only to host markLine
  if (markLineData.length) {
    seriesList.push({
      name: 'Milestones',
      type: 'line',
      data: [],
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { opacity: 0 },
      markLine: {
        symbol: 'none',
        tooltip: {
          show: true,
          trigger: 'item',
          formatter: (params) => {
            const ev = parsedEvents.find(e => e.event === params.name);
            if (ev) {
              return `<b>${ev.event}</b><br/><span style="display:inline-block;max-width:250px;white-space:normal;font-size:11px;color:${THEME.muted};margin-top:4px;">${ev.description}</span>`;
            }
            return params.name;
          }
        },
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
          .filter(p => p.seriesName !== 'Milestones' && p.value > 0)
          .sort((a, b) => b.value - a.value)
          .map(p => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}: <b>${p.value}</b>`)
          .join('<br/>');
        const ev = parsedEvents.find(e => e.key === month);
        const evLine = ev
          ? `<br/><br/><span style="font-size:11px;color:${THEME.muted}"><b>${ev.event}</b><br/>${ev.description}</span>`
          : '';
        return `<b>${month}</b> · ${total} blocks<br/>${lines}${evLine}`;
      },
    },
    legend: {
      type: 'scroll',
      bottom: 36,
      textStyle: { color: THEME.muted, fontSize: 11 },
      pageTextStyle: { color: THEME.muted },
      pageIconColor: THEME.accent,
      pageIconInactiveColor: THEME.border,
      data: finalNames,
    },
    grid: { top: 16, left: 56, right: 16, bottom: 90 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted, fontSize: 11 },
    },
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
        formatter: metric === 'pct' ? '{value}%' : (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v,
      },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.text, fontSize: 11 },
      axisTick: { show: false },
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
        formatter: metric === 'pct' ? '{c}%' : (p) => p.value >= 1000 ? `${(p.value / 1000).toFixed(1)}k` : p.value,
      },
    }],
  }, true);
}

// ── Ecosystem Growth Chart (Line + Scatter) ──────────────────────────────────────────────
export let growthChart = null;

export function renderEcosystemGrowthChart({ months, cumulativePools }, poolMeta) {
  const el = document.getElementById('chart-line');
  if (!growthChart) {
    growthChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => growthChart.resize());
  }

  // Calculate the global max timestamp to act as "today" for bucket comparisons
  let maxTime = 0;
  Object.values(poolMeta).forEach(m => {
    if (m.last_seen_date) {
      const t = new Date(m.last_seen_date).getTime();
      if (t > maxTime) maxTime = t;
    }
  });

  const MS_IN_DAY = 86400 * 1000;
  const t3M = maxTime - 90 * MS_IN_DAY;
  const t1Y = maxTime - 365 * MS_IN_DAY;

  // Categories
  const CAT_3M = 'Active (Last 3 Months)';
  const CAT_1Y = 'Active (Last 1 Year)';
  const CAT_OLD = 'Inactive (>1 Year)';

  // Map month key to the Y value of the cumulative line at that month
  const monthToY = new Map(months.map((m, i) => [m, cumulativePools[i]]));

  const scatterBuckets = {
    [CAT_3M]: [],
    [CAT_1Y]: [],
    [CAT_OLD]: []
  };

  // Find Top 20 Active pools by lifetime blocks
  const activePoolList = Object.entries(poolMeta)
    .filter(([name, meta]) => meta.last_seen_date && new Date(meta.last_seen_date).getTime() >= t1Y && name !== 'Unknown' && name !== 'Other')
    .sort((a, b) => b[1].lifetime_blocks - a[1].lifetime_blocks)
    .slice(0, 20);
  const top20ActiveNames = new Set(activePoolList.map(entry => entry[0]));

  Object.entries(poolMeta).forEach(([name, meta]) => {
    if (meta.first_seen_date && name !== 'Unknown' && name !== 'Other') {
      const monthKey = meta.first_seen_date.substring(0, 7); // e.g. "2020-10"
      if (monthToY.has(monthKey)) {
        const yVal = monthToY.get(monthKey);

        const lastTime = new Date(meta.last_seen_date).getTime();
        let category = CAT_OLD;
        if (lastTime >= t3M) category = CAT_3M;
        else if (lastTime >= t1Y) category = CAT_1Y;

        const isTop20 = top20ActiveNames.has(name);

        const point = {
          name,
          isTop20,
          value: [
            monthKey,
            yVal,
            meta.first_seen_date,
            meta.first_block_mined,
            meta.last_block_mined,
            meta.lifetime_blocks,
            meta.last_seen_date
          ],
          itemStyle: {},
        };

        // Highlight Top 20
        if (isTop20) {
          point.label = {
            show: true,
            formatter: '{b}', // Name
            position: 'top',
            distance: 5,
            color: THEME.text,
            fontSize: 10,
            textBorderColor: THEME.bg,
            textBorderWidth: 2
          };
        }

        // Fade out inactive
        if (category === CAT_OLD) {
          point.itemStyle = { color: '#555', opacity: 0.3, borderColor: 'transparent' };
        }

        scatterBuckets[category].push(point);
      }
    }
  });

  // Common scatter series template
  const createScatterSeries = (name, color, data) => {
    // Sort so smallest bubbles are on top
    data.sort((a, b) => b.value[5] - a.value[5]);
    return {
      name: name,
      type: 'scatter',
      data: data,
      z: 10,
      labelLayout: {
        moveOverlap: 'shiftY' // "Ziggle" labels up/down to strictly prevent collisions
      },
      symbolSize: function (val, params) {
        const blocks = val[5];
        let size = 4 + (Math.log10(blocks || 1) * 3);
        if (params.data.isTop20) size += 6; // Boost size
        return Math.min(Math.max(size, 4), params.data.isTop20 ? 25 : 15);
      },
      itemStyle: {
        color: color,
        opacity: 0.9,
        shadowBlur: 4,
        shadowColor: 'rgba(0, 0, 0, 0.4)',
        borderColor: THEME.bg,
        borderWidth: 1
      },
      emphasis: {
        focus: 'self',
        itemStyle: { opacity: 1, borderColor: '#fff', borderWidth: 1 }
      }
    };
  };

  growthChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip(),
      trigger: 'item',
      formatter: (params) => {
        if (params.seriesName === 'Cumulative Pools (Line)') {
          return `<b>${params.name}</b><br/>Cumulative unique pools: <b>${params.value}</b>`;
        }
        const d = params.data.value; // [monthKey, yVal, date, first_block, last_block, lifetime, last_seen]
        return `<div style="margin-bottom: 4px; border-bottom: 1px solid ${THEME.border}; padding-bottom: 4px;">
                  <b style="color:${params.color}">${params.data.name}</b>
                  <span style="margin-left: 6px; font-size: 10px; color: ${THEME.muted};">(${params.seriesName})</span>
                </div>
                First Seen: <b>${d[2]}</b> (Block ${d[3].toLocaleString()})<br/>
                Last Block : <b>${d[6]}</b> (Block ${d[4].toLocaleString()})<br/>
                Total Mined: <b>${d[5].toLocaleString()}</b> blocks`;
      },
    },
    legend: {
      data: [CAT_3M, CAT_1Y, CAT_OLD],
      top: 0,
      textStyle: { color: THEME.muted, fontSize: 11 },
      icon: 'circle'
    },
    grid: { top: 32, left: 56, right: 30, bottom: 48 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Cumulative Unique Pools',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: THEME.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted, fontSize: 11 },
    },
    series: [
      {
        name: 'Cumulative Pools (Line)',
        type: 'line',
        data: cumulativePools,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: THEME.border, width: 2, type: 'dashed' },
        areaStyle: { opacity: 0.1, color: THEME.border },
        z: 2
      },
      createScatterSeries(CAT_3M, '#6db874', scatterBuckets[CAT_3M]), // Bright Green
      createScatterSeries(CAT_1Y, '#E5C07B', scatterBuckets[CAT_1Y]), // Yellowish
      createScatterSeries(CAT_OLD, '#6b7280', scatterBuckets[CAT_OLD]) // Handled by override, base color ignored 
    ],
  }, true);
}

// ── HHI Trend Chart ───────────────────────────────────────────────────────────
let hhiChart = null;

export function renderHhiChart({ months, hhi }) {
  const el = document.getElementById('chart-hhi');
  if (!hhiChart) {
    hhiChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => hhiChart.resize());
  }

  hhiChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: THEME.bg2 } },
      formatter: (params) => {
        const month = params[0].axisValue;
        const val = params[0].value;
        let hhiLevel = 'Healthy Pool Decentralization';
        if (val > 2500) hhiLevel = 'High Pool Centralization (At Risk)';
        else if (val > 1500) hhiLevel = 'Moderate Pool Centralization';
        return `<b>${month}</b><br/>HHI: <b>${val.toFixed(0)}</b><br/><span style="font-size:11px;color:${THEME.muted}">${hhiLevel}</span>`;
      },
    },
    grid: { top: 16, left: 56, right: 16, bottom: 48 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Mining Centralization Index (HHI)',
      nameLocation: 'middle',
      nameGap: 45,
      nameTextStyle: { color: THEME.muted, fontSize: 11 },
      min: 500,
      max: 3500,
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted, fontSize: 11 },
    },
    visualMap: {
      show: false,
      pieces: [
        { gt: 0, lte: 1500, color: THEME.accent },
        { gt: 1500, lte: 2500, color: POOL_COLORS[7] },
        { gt: 2500, color: POOL_COLORS[3] }
      ],
      outOfRange: { color: '#999' }
    },
    series: [{
      type: 'line',
      data: hhi,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.15 },
      markLine: {
        symbol: 'none',
        label: {
          formatter: '{b}',
          position: 'insideStartTop',
          fontSize: 10,
          color: THEME.muted
        },
        lineStyle: { opacity: 0.8 },
        data: [
          { yAxis: 1500, name: 'Moderate Threshold (1,500)', lineStyle: { color: POOL_COLORS[7], type: 'dashed' } },
          { yAxis: 2500, name: 'Concentration Risk (2,500)', lineStyle: { color: POOL_COLORS[3], type: 'dashed' } }
        ]
      }
    }],
  }, true);
}

// ── Concentration Chart ───────────────────────────────────────────────────────
let concentrationChart = null;

export function renderConcentrationChart({ months, top3, top5 }) {
  const el = document.getElementById('chart-concentration');
  if (!concentrationChart) {
    concentrationChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => concentrationChart.resize());
  }

  concentrationChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: THEME.bg2 } },
      formatter: (params) => {
        const month = params[0].axisValue;
        const lines = params
          .sort((a, b) => b.value - a.value)
          .map(p => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}: <b>${p.value.toFixed(1)}%</b>`)
          .join('<br/>');
        return `<b>${month}</b><br/>${lines}`;
      },
    },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: THEME.muted, fontSize: 11 },
      icon: 'circle'
    },
    grid: { top: 32, left: 56, right: 16, bottom: 48 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: THEME.border } },
      axisLabel: { color: THEME.muted, fontSize: 11, rotate: 30 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Combined Share of Blocks mined (%)',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { color: THEME.muted, fontSize: 11 },
      min: 20,
      max: 100,
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted, fontSize: 11, formatter: '{value}%' },
    },
    series: [
      {
        name: 'Top 5 Pools',
        type: 'line',
        data: top5,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 3, color: POOL_COLORS[2] },
        areaStyle: { opacity: 0.1, color: POOL_COLORS[2] },
      },
      {
        name: 'Top 3 Pools',
        type: 'line',
        data: top3,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 3, color: POOL_COLORS[0] },
        areaStyle: { opacity: 0.2, color: POOL_COLORS[0] },
      }
    ]
  }, true);
}

// ── Top 30 Mining Pools Table ────────────────────────────────────────────────
export function renderTopMinersTable(poolAgg, poolsInfo) {
  const el = document.getElementById('top-miners-table-container');
  if (!el) return;

  const rows = poolAgg.slice(0, 30).map((p, i) => {
    // Case-insensitive lookup for the pool metadata
    const info = poolsInfo.find(info => info.name.toLowerCase() === p.name.toLowerCase());
    
    // Determine country - handle "Unknown" specifically
    let country = info?.country;
    if (!country) {
      if (p.name === 'Unknown') country = 'Decentralized / Anonymous';
      else country = 'Unknown / Unmapped';
    }

    return `
      <tr class="pool-row" data-pool="${p.name}">
        <td style="width: 40px; color: var(--text-secondary); font-size: 0.8rem;">${i + 1}</td>
        <td style="font-weight: 600; color: var(--text-primary); min-width: 180px;">${p.name}</td>
        <td style="color: var(--text-secondary); font-size: 0.85rem; min-width: 150px;">
          <i class="fa-solid fa-earth-americas" style="font-size: 0.75rem; margin-right: 6px; opacity: 0.5;"></i>
          ${country}
        </td>
        <td style="text-align: right; font-weight: 600; color: var(--accent); padding-right: 20px;">${p.pct.toFixed(2)}%</td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="top-miners-scroll">
      <table class="top-miners-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Miner / Pool Identity</th>
            <th>Base of Operations</th>
            <th style="text-align: right; padding-right: 20px;">Block Share</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  
  // Attach listeners for profile lookup
  el.querySelectorAll('.pool-row').forEach(row => {
    row.addEventListener('click', () => {
      const pool = row.getAttribute('data-pool');
      document.dispatchEvent(new CustomEvent('request-profile', { detail: pool }));
      document.getElementById('pool-profile-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

// ── Resize all ────────────────────────────────────────────────────────────────
export function resizeAll() {
  donutChart?.resize();
  countryChart?.resize();
  areaChart?.resize();
  barChart?.resize();
  growthChart?.resize();
  hhiChart?.resize();
  concentrationChart?.resize();
}
