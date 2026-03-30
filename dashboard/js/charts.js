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

// ── KPI 1: Streaks Leaderboard ────────────────────────────────────────────────
export function renderStreaksLeaderboard(poolSummaries) {
  const el = document.getElementById('forensics-streaks-table');
  if (!el || !poolSummaries || poolSummaries.length === 0) return;

  // 1. Render Leaderboard Rows
  const rows = poolSummaries.map((p, i) => {
    // Determine propensity color
    let propColor = '#8ab4f8';
    let propLabel = 'Normal';
    if (p.propensity > 2.0) { propColor = '#ff4d4f'; propLabel = 'Extremely High'; }
    else if (p.propensity > 1.3) { propColor = '#ffe066'; propLabel = 'High'; }
    else if (p.propensity < 0.7) { propColor = '#98C379'; propLabel = 'Low'; }

    // Prepare Grouped View (By Length)
    // distribution: { "10": 2, "9": 5, ... }
    // events: [ {count: 10, start_time: ...}, ... ]
    const lengths = Object.keys(p.distribution).sort((a, b) => b - a);

    const drillDownRows = lengths.map(len => {
      const lenEvents = p.events.filter(e => e.count == len);
      const count = p.distribution[len];

      // Robust likelihood calculation (use event data or falls back to share-based math)
      let years;
      if (lenEvents.length > 0 && lenEvents[0].expected_1_in_years !== undefined) {
        years = lenEvents[0].expected_1_in_years;
      } else {
        const p_val = p.pool_share / 100;
        const prob_start = Math.pow(p_val, parseInt(len)) * (1 - p_val);
        const exp_blocks = prob_start > 0 ? 1 / prob_start : 10 ** 10;
        years = exp_blocks / (144 * 365.25);
      }

      let likelihoodStr = years > 50
        ? '> 50 Years'
        : (years < 0.1
          ? `${(years * 12).toFixed(1)} Mos`
          : `${years.toFixed(1)} Yrs`);

      const dates = lenEvents.length > 0
        ? lenEvents.map(e => new Date(e.start_time).toLocaleDateString()).join(', ')
        : '<span style="font-style: italic; opacity: 0.5;">Historical record (dates not in recent sample)</span>';

      return `
        <tr>
          <td style="font-weight: 700; color: var(--accent); white-space: nowrap; padding: 10px 0;">
            ${len} Blocks
            <span style="display:block; font-size: 0.65rem; color: var(--text-secondary); font-weight: 400; margin-top: 2px;">
              ${count} Occurrence${count > 1 ? 's' : ''}
            </span>
          </td>
          <td style="text-align: center; color: var(--text-primary); font-weight: 500;">1 in ${likelihoodStr}</td>
          <td style="color: var(--text-secondary); padding-left: 15px; font-size: 0.8rem; line-height: 1.4;">${dates}</td>
        </tr>
      `;
    }).join('');

    return `
    <tr class="pool-streak-row" data-pool="${p.pool}">
      <td style="width: 30px; opacity: 0.5;">${i + 1}</td>
      <td style="font-weight: 700; color: var(--text-primary)">
        <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem; margin-right: 8px; transition: transform 0.2s;"></i>
        ${p.pool}
        <span style="font-weight: normal; font-size: 0.75rem; color: var(--text-secondary); margin-left: 6px;">(${p.pool_share}% Share)</span>
      </td>
      <td style="text-align: center;">
         <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
           <span class="streak-badge" style="background: rgba(138, 180, 248, 0.1); color: #8ab4f8; border-color: rgba(138, 180, 248, 0.3); min-width:80px;">
             ${p.total_events} ${p.total_events === 1 ? 'Event' : 'Events'}
           </span>
           <span style="font-size: 0.65rem; color: ${propColor}; font-weight:bold; opacity:0.8;">${p.propensity}x propensity</span>
         </div>
      </td>
      <td style="text-align: right;"><span class="streak-badge" style="color: #fff; background: rgba(255,255,255,0.1);">${p.max_streak} Max</span></td>
    </tr>
    <tr class="pool-streak-detail" style="display: none;">
      <td colspan="4" style="padding: 0 15px 15px 40px; border-bottom: none;">
        <div style="background: rgba(22, 27, 34, 0.5); padding: 14px; border-radius: 8px; border-left: 3px solid ${propColor};">
          <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.05em; font-weight: 700;">Historical Streak Distribution</div>
            <div style="font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; background: ${propColor}22; color: ${propColor}; border: 1px solid ${propColor}44; font-weight: bold;">
               ${propLabel} Profile
            </div>
          </div>
          <table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <th style="text-align: left; padding: 5px 0; color: var(--text-secondary); font-size: 0.75rem; width: 120px;">Length (Count)</th>
                <th style="text-align: center; color: var(--text-secondary); font-size: 0.75rem; width: 120px;">Likelihood</th>
                <th style="text-align: left; color: var(--text-secondary); font-size: 0.75rem; padding-left: 15px;">Historical Occurrences (Dates)</th>
              </tr>
            </thead>
            <tbody>${drillDownRows}</tbody>
          </table>
          ${(() => {
        const name = p.pool.toLowerCase();
        if (name.includes('foundry')) {
          return `
                   <div style="margin-top: 15px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.75rem; color: var(--text-secondary); line-height:1.5;">
                     <strong style="color: var(--accent); text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.05em; display: block; margin-bottom: 5px;">Network Reconnaissance Brief</strong>
                     <strong>STATISTICAL ANOMALY:</strong> Foundry USA exhibits a 3.17x Propensity shift. Under standard Poisson distribution, a 10-block streak for 24% share is a "generational event" expected once in 35 years; Foundry has bypassed this hurdle in real-time. This suggests a <strong>Critical Network Topology Advantage</strong>. By utilizing low-latency propagation relays (FIBRE) and North American node clustering, Foundry is mining on its own headers with near-zero overhead, creating a "local consensus" that stacks blocks before the network can synchronize.
                   </div>
                 `;
        }
        return '';
      })()}
        </div>
      </td>
    </tr>
  `;
  }).join('');

  el.innerHTML = `
    <div class="forensic-table-wrapper">
      <table class="forensic-table streak-leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Pool Identity</th>
            <th style="text-align: center;">Frequency (≥7)</th>
            <th style="text-align: right;">Record</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // 4. Wire Toggle Interactivity
  el.querySelectorAll('.pool-streak-row').forEach(row => {
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      const chevron = row.querySelector('.fa-chevron-right');
      const isOpen = next.style.display !== 'none';

      next.style.display = isOpen ? 'none' : 'table-row';
      chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      row.classList.toggle('active', !isOpen);
    });
  });
}

// ── KPI 2: Z-Score Funnel (Scatter) ──────────────────────────────────────────
export let zscoreChart = null;
export function renderZScoreFunnel(funnelData) {
  const el = document.getElementById('chart-zscore-funnel');
  if (!el || !funnelData || funnelData.length === 0) return;
  if (!zscoreChart) {
    zscoreChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => zscoreChart.resize());
  }

  // Use only the most recent snapshot for the scatter plot
  const latestTs = funnelData[0].timestamp;
  const data = funnelData.filter(d => d.timestamp === latestTs);

  zscoreChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'item',
      formatter: (p) => {
        const d = p.data;
        const color = Math.abs(d[2]) > 3 ? '#ff4d4f' : '#6db874';
        return `<b style="color:${color}">${d[3]}</b><br/>Share: <b>${d[0]}%</b><br/>Luck: <b>${d[1]}%</b><br/>Z-Score: <b>${d[2]}</b>`;
      }
    },
    grid: { top: 40, left: 50, right: 30, bottom: 40 },
    xAxis: {
      name: 'Pool Share %',
      nameLocation: 'middle',
      nameGap: 30,
      splitLine: { show: false },
      axisLabel: { color: THEME.muted },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    yAxis: {
      name: 'Luck %',
      nameLocation: 'middle',
      nameGap: 35,
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    series: [{
      type: 'scatter',
      symbolSize: (val) => 10 + Math.sqrt(val[0]) * 3,
      data: data.map(d => [d.share, d.luck, d.z, d.pool]),
      itemStyle: {
        color: (p) => Math.abs(p.data[2]) > 3 ? '#ff4d4f' : '#6db874',
        opacity: 0.8,
        borderColor: THEME.bg,
        borderWidth: 1,
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.3)'
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: THEME.muted, type: 'dashed', opacity: 0.3 },
        data: [{ yAxis: 100 }]
      }
    }]
  }, true);
}

// ── KPI 3: Entropy Heatmap ────────────────────────────────────────────────────
export let entropyChart = null;
export function renderEntropyHeatmap(entropyData) {
  const el = document.getElementById('chart-entropy-heatmap');
  if (!el || !entropyData || entropyData.length === 0) return;
  if (!entropyChart) {
    entropyChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => entropyChart.resize());
  }

  const pools = [...new Set(entropyData.map(d => d.pool))];
  const dates = [...new Set(entropyData.map(d => d.date))].sort();

  const data = entropyData.map(d => [dates.indexOf(d.date), pools.indexOf(d.pool), d.cv]);

  entropyChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      position: 'top',
      formatter: (p) => {
        const val = p.data[2];
        const status = val < 0.7 ? 'Centralized/Industrial' : (val > 1.0 ? 'Decentralized/Retail' : 'Normal');
        return `<b>${pools[p.data[1]]}</b> (${dates[p.data[0]]})<br/>Entropy (CV): <b>${val.toFixed(3)}</b><br/><span style="font-size:10px; opacity:0.8">${status}</span>`;
      }
    },
    grid: { top: 10, left: 100, right: 20, bottom: 60 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: THEME.muted, rotate: 30, fontSize: 10 },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    yAxis: {
      type: 'category',
      data: pools,
      axisLabel: { color: THEME.text, fontSize: 11 },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    visualMap: {
      min: 0.5,
      max: 1.2,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      text: ['High Entropy', 'Low Entropy'],
      textStyle: { color: THEME.muted, fontSize: 10 },
      inRange: {
        color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
      }
    },
    series: [{
      type: 'heatmap',
      data: data,
      label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
    }]
  }, true);
}

// ── KPI 5: Empty Block Auditor (Scatter) ──────────────────────────────────────
export let emptyChart = null;
export function renderEmptyBlockChart(emptyData) {
  const el = document.getElementById('chart-empty-blocks');
  if (!el || !emptyData || !emptyData.leaderboard) return;
  if (!emptyChart) {
    emptyChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => emptyChart.resize());
  }

  // Calculate Market Share for X-axis (if not provided, we derive it from leaderboard)
  // Let's use the All-time ratio to start, or we could toggle to 30d
  const data = emptyData.leaderboard.map(d => {
    // We want: [X: Share %, Y: Empty %, R: Total Blocks, Name: Pool]
    // Since we don't have global share here, we'll use a placeholder or have caller provide it.
    // Actually, let's just use total_all as a proxy for share if needed, 
    // but better to calculate actual share.
    const totalGlobal = emptyData.leaderboard.reduce((s, x) => s + x.total_all, 0);
    const share = (d.total_all / totalGlobal) * 100;
    return [share, d.ratio_all, d.total_all, d.pool, d.ratio_30d];
  });

  emptyChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'item',
      formatter: (p) => {
        const d = p.data;
        const color = d[1] > 1.0 ? '#ff4d4f' : THEME.accent;
        return `<b style="color:${color}">${d[3]}</b><br/>All-Time Share: <b>${d[0].toFixed(2)}%</b><br/>Empty Ratio (All-time): <b>${d[1]}%</b><br/>Empty Ratio (Last 30d): <b>${d[4]}%</b><br/>Total Blocks: <b>${d[2].toLocaleString()}</b>`;
      }
    },
    grid: { top: 40, left: 50, right: 30, bottom: 40 },
    xAxis: {
      name: 'All-Time Market Share %',
      nameLocation: 'middle',
      nameGap: 30,
      splitLine: { show: false },
      axisLabel: { color: THEME.muted },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    yAxis: {
      name: 'Empty Block %',
      nameLocation: 'middle',
      nameGap: 35,
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } },
      axisLabel: { color: THEME.muted },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    series: [{
      type: 'scatter',
      symbolSize: (val) => 10 + Math.sqrt(val[2]) * 0.1,
      data: data,
      itemStyle: {
        color: (p) => p.data[1] > 1.0 ? '#ff4d4f' : THEME.accent,
        opacity: 0.8,
        borderColor: THEME.bg,
        borderWidth: 1,
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.3)'
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#ff4d4f', type: 'dashed', opacity: 0.5 },
        label: { show: true, formatter: 'Anomaly Threshold (1%)', position: 'end', color: '#ff4d4f', fontSize: 10 },
        data: [{ yAxis: 1.0 }]
      }
    }]
  }, true);
}

// ── KPI 4: Sync Histogram ─────────────────────────────────────────────────────
export let syncChart = null;
export function renderSyncHistogram(syncData) {
  const el = document.getElementById('chart-sync-histogram');
  if (!el || !syncData || syncData.length === 0) return;
  if (!syncChart) {
    syncChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => syncChart.resize());
  }

  // Sort by sub_30s to keep it intuitive
  const sortedData = [...syncData].sort((a, b) => {
    const a30 = (a.buckets.sub_30s / a.total_consecutive);
    const b30 = (b.buckets.sub_30s / b.total_consecutive);
    return b30 - a30;
  });

  const keys = ['sub_30s', 'sub_60s', 'sub_2m', 'sub_5m', 'slow'];
  const poolNames = sortedData.map(d => d.pool);

  // Highlight sub_30s in red/orange to indicate fork/reorg risk
  const colors = ['#ff4d4f', '#E2A34A', '#E5C07B', '#98C379', '#56B6C2'];

  const series = keys.map((key, i) => ({
    name: key.replace('sub_', '< ').replace('s', 's').replace('m', 'm').replace('slow', '> 5m'),
    type: 'bar',
    stack: 'total',
    itemStyle: { color: colors[i] },
    data: sortedData.map(d => {
      const totalConsec = d.total_consecutive;
      const val = d.buckets[key] || 0;
      const valEmpty = d.buckets_empty?.[key] || 0;
      const pct = totalConsec > 0 ? (val / totalConsec * 100) : 0;
      return {
        value: pct,
        count: val,
        count_empty: valEmpty,
        totalConsec: totalConsec,
        totalBlocks: d.total_blocks || 0
      };
    })
  }));

  syncChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const d = params[0].data;
        const consecRatio = d.totalBlocks > 0 ? (d.totalConsec / d.totalBlocks * 100).toFixed(1) : 0;

        let h = `<div style="margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                  <b style="color:${THEME.accent}">${params[0].name}</b>
                </div>
                Lifetime Blocks: <b>${d.totalBlocks.toLocaleString()}</b><br/>
                Consecutive Ratio: <b>${consecRatio}%</b> (${d.totalConsec.toLocaleString()} pairs)<br/><br/>`;

        params.forEach(p => {
          if (p.data.count > 0) {
            const emptyPct = p.data.count > 0 ? (p.data.count_empty / p.data.count * 100).toFixed(0) : 0;
            const signal = p.data.count_empty > 0
              ? `<span style="color:#ff4d4f; font-weight:bold; margin-left:8px;">(${emptyPct}% Empty)</span>`
              : '';

            // Header-First Mining Signal (Primary indicator if sub_30s and empty)
            const hfSignal = (p.seriesIndex === 0 && p.data.count_empty > 0)
              ? `<br/><span style="color:#ff4d4f; font-size:10px;">⚠️ Header-First Signal Detected</span>`
              : '';

            h += `<div style="margin-bottom:2px;">${p.marker} ${p.seriesName}: <b>${p.data.value.toFixed(1)}%</b> (${p.data.count})${signal}${hfSignal}</div>`;
          }
        });
        return h;
      }
    },
    legend: {
      bottom: 0,
      textStyle: { color: THEME.muted, fontSize: 10 },
      icon: 'circle',
      itemWidth: 10
    },
    grid: { top: 20, left: 100, right: 30, bottom: 60 },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { color: THEME.muted, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } }
    },
    yAxis: {
      type: 'category',
      data: poolNames,
      axisLabel: { color: THEME.text, fontSize: 11 },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    series: series
  }, true);
}

// ── KPI 7: BIP 110 Signaling Trend ──────────────────────────────────────────
export let bip110SignalingChart = null;
export function renderBip110Signaling(trendData) {
  const el = document.getElementById('chart-bip110-signaling');
  if (!el || !trendData || trendData.length === 0) return;
  if (!bip110SignalingChart) {
    bip110SignalingChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => bip110SignalingChart.resize());
  }

  const days = trendData.map(d => d.day);
  const globalRolling = trendData.map(d => d.global_rolling);

  // 1. Identify Top 5 Signaling and Top 5 Holdout pools overall (based on last 30 days)
  const recentTrend = trendData.slice(-30);
  const sigTotals = {};
  const holdTotals = {};

  recentTrend.forEach(d => {
    Object.entries(d.pools_total).forEach(([pool, total]) => {
      const sig = d.pools_signaling[pool] || 0;
      const hold = total - sig;
      sigTotals[pool] = (sigTotals[pool] || 0) + sig;
      holdTotals[pool] = (holdTotals[pool] || 0) + hold;
    });
  });

  const topSignalers = Object.entries(sigTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => p[0]);
  const topHoldouts = Object.entries(holdTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => p[0]);

  // Update the mini-leaderboard list
  const sigList = document.getElementById('list-top-signalers');
  const holdList = document.getElementById('list-top-holdouts');
  const latestDay = trendData[trendData.length - 1];

  if (sigList) {
    sigList.innerHTML = topSignalers.map((name, i) => {
      const share = latestDay.total_blocks > 0 ? (latestDay.pools_signaling[name] || 0) / latestDay.total_blocks * 100 : 0;
      return `<div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:var(--text-primary); font-weight:500;">${name}</span>
                <span style="color:#4ade80; font-weight:bold;">${share.toFixed(1)}%</span>
              </div>`;
    }).join('');
  }

  if (holdList) {
    holdList.innerHTML = topHoldouts.map((name, i) => {
      const total = latestDay.pools_total[name] || 0;
      const sig = latestDay.pools_signaling[name] || 0;
      const share = latestDay.total_blocks > 0 ? (total - sig) / latestDay.total_blocks * 100 : 0;
      return `<div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:var(--text-primary); font-weight:500;">${name}</span>
                <span style="color:#ef4444; font-weight:bold;">${share.toFixed(1)}%</span>
              </div>`;
    }).join('');
  }

  const signalerSet = new Set(topSignalers);
  const holdoutSet = new Set(topHoldouts);

  // 2. Build Series (Stacked)
  // We want Signaling at the bottom (Greens), then Holdouts at the top (Grays/Reds)
  const series = [];

  // SIGNALERS (Greenish)
  topSignalers.forEach((name, i) => {
    series.push({
      name: `Signal: ${name}`,
      type: 'line',
      stack: 'total',
      smooth: true,
      symbol: 'none',
      areaStyle: { opacity: 0.85 },
      lineStyle: { width: 0 },
      color: ['#4ade80', '#22c55e', '#16a34a', '#15803d', '#14532d'][i],
      emphasis: { focus: 'series' },
      data: trendData.map(d => d.total_blocks > 0 ? (d.pools_signaling[name] || 0) / d.total_blocks * 100 : 0)
    });
  });

  // OTHER SIGNALERS
  series.push({
    name: 'Other Signalers',
    type: 'line',
    stack: 'total',
    smooth: true,
    symbol: 'none',
    areaStyle: { opacity: 0.6 },
    lineStyle: { width: 0 },
    color: '#064e3b',
    data: trendData.map(d => {
      let sum = 0;
      Object.entries(d.pools_signaling).forEach(([p, c]) => { if (!signalerSet.has(p)) sum += c; });
      return d.total_blocks > 0 ? sum / d.total_blocks * 100 : 0;
    })
  });

  // HOLDOUTS (Reds/Grays)
  topHoldouts.forEach((name, i) => {
    series.push({
      name: `Holdout: ${name}`,
      type: 'line',
      stack: 'total',
      smooth: true,
      symbol: 'none',
      areaStyle: { opacity: 0.7 },
      lineStyle: { width: 0 },
      color: ['#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'][i],
      emphasis: { focus: 'series' },
      data: trendData.map(d => {
        const total = d.pools_total[name] || 0;
        const sig = d.pools_signaling[name] || 0;
        return d.total_blocks > 0 ? (total - sig) / d.total_blocks * 100 : 0;
      })
    });
  });

  // OTHER HOLDOUTS
  series.push({
    name: 'Other Holdouts',
    type: 'line',
    stack: 'total',
    smooth: true,
    symbol: 'none',
    areaStyle: { opacity: 0.5 },
    lineStyle: { width: 0 },
    color: '#334155',
    data: trendData.map(d => {
      let sum = 0;
      Object.entries(d.pools_total).forEach(([p, t]) => {
        if (!holdoutSet.has(p)) {
          const s = d.pools_signaling[p] || 0;
          sum += (t - s);
        }
      });
      return d.total_blocks > 0 ? sum / d.total_blocks * 100 : 0;
    })
  });

  // Activation Progress Rolling Line
  series.push({
    name: '2,016 Block Activation Progress',
    type: 'line',
    smooth: true,
    symbol: 'none',
    lineStyle: { color: '#E2A34A', width: 4, type: 'solid', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
    data: globalRolling,
    markLine: {
      silent: true,
      symbol: 'none',
      label: { formatter: 'Activation (55%)', position: 'end', color: '#E2A34A', fontWeight: 'bold' },
      lineStyle: { color: '#E2A34A', type: 'dashed', opacity: 0.9, width: 2 },
      data: [{ yAxis: 55 }]
    }
  });

  bip110SignalingChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params) => {
        let h = `<div style="margin-bottom:5px; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">${params[0].axisValue} Coverage</div>`;
        let sig = [];
        let hold = [];
        let rolling = null;
        params.forEach(p => {
          if (p.seriesName.includes('Activation')) rolling = p.value;
          else if (p.seriesName.includes('Signal')) sig.push(p);
          else hold.push(p);
        });

        h += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">`;
        h += `<div><span style="color:#4ade80; font-size:10px; font-weight:bold;">SIGNALERS</span><br/>`;
        sig.forEach(p => {
          if (p.value > 0.1) h += `<div style="font-size:11px;">${p.marker} ${p.seriesName.replace('Signaling: ', '').replace('Signal: ', '')}: ${p.value.toFixed(1)}%</div>`;
        });
        h += `</div>`;
        h += `<div><span style="color:#ef4444; font-size:10px; font-weight:bold;">HOLDOUTS</span><br/>`;
        hold.forEach(p => {
          if (p.value > 0.1) h += `<div style="font-size:11px;">${p.marker} ${p.seriesName.replace('Holdout: ', '')}: ${p.value.toFixed(1)}%</div>`;
        });
        h += `</div></div>`;
        if (rolling !== null) h += `<div style="margin-top:8px; padding-top:5px; border-top:1px solid rgba(255,255,255,0.1); color:#E2A34A; font-weight:bold;">Activation Progress: ${rolling}%</div>`;
        return h;
      }
    },
    legend: {
      show: false // Too many items, better to use tooltip
    },
    grid: { top: 40, left: 50, right: 50, bottom: 40 },
    xAxis: {
      type: 'category',
      data: days,
      axisLabel: { color: THEME.muted, fontSize: 10, rotate: 30, hideOverlap: true },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: THEME.muted, formatter: '{value}%' },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } }
    },
    series
  }, true);
}

// ── KPI 7: BIP 110 Efficiency (Scatter) ──────────────────────────────────────
export let bip110EfficiencyChart = null;
export function renderBip110Efficiency(efficiencyData) {
  const el = document.getElementById('chart-bip110-efficiency');
  if (!el || !efficiencyData || efficiencyData.length === 0) return;
  if (!bip110EfficiencyChart) {
    bip110EfficiencyChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => bip110EfficiencyChart.resize());
  }

  // Group by pool for coloring
  const poolGroups = {};
  efficiencyData.forEach(d => {
    if (!poolGroups[d.pool_name]) poolGroups[d.pool_name] = [];
    poolGroups[d.pool_name].push([d.tx_count, d.bytes_total, d.block_height]);
  });

  const series = Object.keys(poolGroups).map((name, i) => ({
    name,
    type: 'scatter',
    symbolSize: 6,
    data: poolGroups[name],
    itemStyle: {
      color: POOL_COLORS[i % POOL_COLORS.length],
      opacity: 0.6
    },
    emphasis: { focus: 'self' }
  }));

  bip110EfficiencyChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      ...baseTooltip({ confine: true }),
      trigger: 'item',
      formatter: (p) => `<b>${p.seriesName}</b><br/>TXs: ${p.data[0]}<br/>Size: ${(p.data[1] / 1024 / 1024).toFixed(2)} MB<br/>Height: ${p.data[2]}`
    },
    legend: {
      type: 'scroll',
      top: 0,
      textStyle: { color: THEME.muted, fontSize: 10 }
    },
    grid: { top: 40, left: 60, right: 30, bottom: 40 },
    xAxis: {
      name: 'Transaction Count',
      nameLocation: 'middle',
      nameGap: 25,
      type: 'value',
      axisLabel: { color: THEME.muted },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } }
    },
    yAxis: {
      name: 'Block Size (Bytes)',
      nameLocation: 'middle',
      nameGap: 45,
      type: 'value',
      axisLabel: { color: THEME.muted, formatter: (v) => (v / 1024 / 1024).toFixed(1) + ' MB' },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } }
    },
    series
  }, true);
}

// ── KPI 7: BIP 110 Over-Limit (Bar) ──────────────────────────────────────────
export let bip110OverheadChart = null;
export function renderBip110Overhead(overheadData) {
  const el = document.getElementById('chart-bip110-overhead');
  if (!el || !overheadData || overheadData.length === 0) return;
  if (!bip110OverheadChart) {
    bip110OverheadChart = ec().init(el, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => bip110OverheadChart.resize());
  }

  const data = [...overheadData].sort((a, b) => a.avg_overhead - b.avg_overhead);
  const labels = data.map(d => d.pool);
  const values = data.map(d => d.avg_overhead);

  bip110OverheadChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { ...baseTooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { top: 20, left: 100, right: 40, bottom: 40 },
    xAxis: {
      type: 'value',
      name: 'Bytes per TX',
      nameLocation: 'middle',
      nameGap: 25,
      axisLabel: { color: THEME.muted },
      splitLine: { lineStyle: { color: THEME.border, type: 'dashed' } }
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: THEME.text, fontSize: 11 },
      axisLine: { lineStyle: { color: THEME.border } }
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({
        value: v,
        itemStyle: { color: v > 200 ? '#ff4d4f' : '#6db874' }
      })),
      label: { show: true, position: 'right', color: THEME.muted, fontSize: 10, formatter: '{c} B' },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { formatter: 'Proposed Limit (256B)', position: 'end', color: '#ff4d4f', fontSize: 10 },
        lineStyle: { color: '#ff4d4f', type: 'dashed', opacity: 0.6 },
        data: [{ xAxis: 256 }]
      }
    }]
  }, true);
}

export function resizeAllCharts() {
  const charts = [
    donutChart, countryChart, growthChart, areaChart, hhiChart, concentrationChart,
    zscoreChart, entropyChart, syncChart, emptyChart,
    bip110SignalingChart, bip110EfficiencyChart, bip110OverheadChart
  ];
  charts.forEach(c => c && c.resize());
}
