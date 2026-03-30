import pandas as pd
import numpy as np
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
DASHBOARD_DATA = ROOT / "dashboard" / "data"

def load_pool_mapping():
    with open(RAW / "pools.json") as f:
        pools_raw = json.load(f)
    
    tags = pools_raw.get("coinbase_tags", {})
    # Sort tags by length desc to match longest tag first
    # Also include payout addresses as fallback if needed, but for forensics tag is primary
    sorted_tags = sorted(tags.items(), key=lambda x: len(x[0]), reverse=True)
    return sorted_tags

def resolve_pool(coinbase_tag, sorted_tags):
    if not coinbase_tag or pd.isna(coinbase_tag):
        return "Unknown"
    
    # handle bytes if they arrive as such, or hex strings
    try:
        if isinstance(coinbase_tag, bytes):
            tag_str = coinbase_tag.decode('utf-8', errors='ignore')
        else:
            tag_str = str(coinbase_tag)
    except:
        tag_str = str(coinbase_tag)
    
    for tag_key, info in sorted_tags:
        if tag_key in tag_str:
            return info["name"]
    return "Unknown"

def main():
    print("Loading datasets for synchronization...")
    # 1. Load Main Dashboard Data (The "Identity" Source)
    df_main = pd.read_parquet(DASHBOARD_DATA / "blocks_post_2021.parquet")
    
    # 2. Load Raw Forensics Data (The "Metric" Source)
    df_raw = pd.read_parquet(RAW / "bitcoin_blocks_pool.parquet")
    
    # 3. Join on Height to ensure 100% consistency with main dashboard
    print("Joining datasets on block height ...")
    df = pd.merge(
        df_main, 
        df_raw[['block_height', 'bytes_total', 'block_weight', 'tx_count', 'block_time', 'protocol_version', 'bytes_stripped']], 
        left_on='height', 
        right_on='block_height', 
        how='inner'
    )
    
    # Use pool_slug as the primary pool identifier
    df['pool_name'] = df['pool_slug']
    
    # 2. Add Datetime
    df['timestamp'] = pd.to_datetime(df['block_time'], unit='s')
    
    # Filter to start from January 2021 as requested
    df = df[df['timestamp'] >= '2021-01-01'].copy()
    
    # KPI 1: Consecutive Strikes
    print("KPI 1: Consecutive Strikes Analysis...")
    df['prev_pool'] = df['pool_name'].shift(1)
    df['strike_id'] = (df['pool_name'] != df['prev_pool']).cumsum()
    
    # Calculate Pool Shares for the entire period baseline
    pool_counts = df['pool_name'].value_counts()
    total_blocks = len(df)
    pool_shares = (pool_counts / total_blocks).to_dict()

    strikes = df.groupby('strike_id').agg({
        'pool_name': 'first',
        'block_height': ['min', 'max', 'count'],
        'timestamp': ['min', 'max']
    })
    strikes.columns = ['pool', 'start_height', 'end_height', 'count', 'start_time', 'end_time']
    strikes['duration_sec'] = (strikes['end_time'] - strikes['start_time']).dt.total_seconds()
    
    # Filter for streaks >= 7
    strikes_filtered = strikes[strikes['count'] >= 7].sort_values(['count', 'start_time'], ascending=[False, False])
    
    def get_propensity_score(pool, length):
        p = pool_shares.get(pool, 0)
        if p <= 0 or p >= 1: return 0
        expected_n = total_blocks * (p**length) * (1-p)
        actual_n = strikes[(strikes['pool'] == pool) & (strikes['count'] >= length)].shape[0]
        return round(actual_n / expected_n, 2) if expected_n > 0 else 0

    # Group by Pool to get Pool-Level metrics
    pool_summaries = []
    top_pools_by_hashrate = list(pool_shares.keys())[:15] # Analyze top 15 pools

    for pool in top_pools_by_hashrate:
        p_strikes = strikes_filtered[strikes_filtered['pool'] == pool]
        if len(p_strikes) == 0: continue
        
        counts_dist = {str(k): int(v) for k, v in p_strikes['count'].value_counts().sort_index(ascending=False).to_dict().items()}
        max_n = int(p_strikes['count'].max())
        
        # Streak events for this pool, converted for JSON
        # Sort by count (longest first) then time (recent first) to ensure top ones are visible
        events = p_strikes.sort_values(['count', 'start_time'], ascending=[False, False]).to_dict(orient='records')
        for ev in events:
            ev['pool'] = str(ev['pool'])
            ev['start_time'] = ev['start_time'].isoformat()
            ev['end_time'] = ev['end_time'].isoformat()
            ev['start_height'] = int(ev['start_height'])
            ev['end_height'] = int(ev['end_height'])
            ev['count'] = int(ev['count'])
            ev['duration_sec'] = float(ev['duration_sec']) if not pd.isna(ev['duration_sec']) else 0
        p_val = float(pool_shares.get(pool, 0))
        expected_7plus = total_blocks * (p_val**7) * (1-p_val)
        actual_7plus = len(p_strikes) # Already filtered for >= 7
        propensity_base = round(actual_7plus / expected_7plus, 2) if expected_7plus > 0 else 1.0

        # Streak events for this pool, converted for JSON
        events = p_strikes.sort_values(['count', 'start_time'], ascending=[False, False]).to_dict(orient='records')
        for ev in events:
            ev['pool'] = str(ev['pool'])
            ev['start_time'] = ev['start_time'].isoformat()
            ev['end_time'] = ev['end_time'].isoformat()
            ev['start_height'] = int(ev['start_height'])
            ev['end_height'] = int(ev['end_height'])
            ev['count'] = int(ev['count'])
            ev['duration_sec'] = float(ev['duration_sec']) if not pd.isna(ev['duration_sec']) else 0
            
            p = float(pool_shares.get(pool, 0))
            n = int(ev['count'])
            ev['pool_share'] = round(p * 100, 2)
            if p > 0 and p < 1:
                prob_start = (p**n) * (1-p)
                expected_blocks = 1 / prob_start if prob_start > 0 else 10**10 
                years = round(expected_blocks / (144 * 365.25), 2)
                ev['expected_1_in_years'] = min(years, 999.0)
                # Specific propensity for THIS length
                expected_this_n = total_blocks * prob_start
                actual_this_n = strikes[(strikes['pool'] == pool) & (strikes['count'] >= n)].shape[0]
                ev['propensity_score'] = round(actual_this_n / expected_this_n, 2) if expected_this_n > 0 else 1.0
            else:
                ev['expected_1_in_years'] = 0
                ev['propensity_score'] = 1.0

        pool_summaries.append({
            "pool": str(pool),
            "total_events": int(len(p_strikes)),
            "max_streak": max_n,
            "pool_share": round(float(pool_shares.get(pool, 0)) * 100, 2),
            "propensity": propensity_base, # Stable base for 7+ streaks
            "distribution": counts_dist,
            "events": events
        })

    # Sort pools by total events
    pool_summaries = sorted(pool_summaries, key=lambda x: x['total_events'], reverse=True)
    leaderboard_json = pool_summaries

    # KPI 2: Z-Score Funnel (Hidden Hashrate)
    # Observed: counts in last 144 blocks
    # Expected: share in last 2016 blocks
    print("KPI 2: Z-Score Funnel Analysis...")
    
    # We'll slide every 144 blocks to get a series of snapshots
    funnel_data = []
    
    # Only analyze pools with significant share in the last 2016 blocks (> 1%)
    # Let's take the most recent 20,000 blocks and slide markers
    window_baseline = 2016
    window_observed = 144
    
    # We calculate state at the tip and a few historical points for the dashboard
    # Let's just do it for the most recent 10 checkpoints (every 144 blocks)
    for i in range(0, 144 * 10, 144):
        tip_idx = len(df) - 1 - i
        # Need room for both the observed window AND the non-overlapping baseline before it
        if tip_idx < window_baseline + window_observed: break
        
        obs_start = tip_idx - window_observed + 1
        base_start = obs_start - window_baseline  # baseline ends where observed begins
        
        obs_df = df.iloc[obs_start:tip_idx+1]
        base_df = df.iloc[base_start:obs_start]  # non-overlapping with observed window
        
        base_counts = base_df['pool_name'].value_counts()
        base_shares = base_counts / len(base_df)  # use actual length, not hardcoded constant
        
        obs_counts = obs_df['pool_name'].value_counts()
        
        timestamp = df.iloc[tip_idx]['timestamp'].isoformat()
        
        for pool, share in base_shares.items():
            if pool == "Unknown" or share < 0.01: continue
            
            O = obs_counts.get(pool, 0)
            E = window_observed * share
            Z = (O - E) / np.sqrt(E) if E > 0 else 0
            
            # Luck % = (Observed / Expected) * 100
            luck = (O / E * 100) if E > 0 else 0
            
            funnel_data.append({
                "pool": pool,
                "share": round(share * 100, 2),
                "luck": round(luck, 2),
                "z": round(Z, 2),
                "blocks": int(O),
                "timestamp": timestamp
            })

    # KPI 3: Hashrate Entropy Heatmap (CV)
    print("KPI 3: Hashrate Entropy Heatmap...")
    df['time_delta'] = df['timestamp'].diff().dt.total_seconds()
    
    # Group by Pool and Week (7-day windows)
    # We use resample on timestamp
    entropy_data = []
    
    # Filter for pools with > 1% hashrate OVERALL to keep heatmap/charts clean
    top_pools = df['pool_name'].value_counts(normalize=True)
    top_pools = top_pools[top_pools > 0.01].index.tolist()
    if "Unknown" in top_pools: top_pools.remove("Unknown")

    # For lookup-table metrics (kpi5 empty blocks & kpi6 density) we include every
    # identified pool — no hashrate threshold. The table already controls which pools
    # are visible based on the active time range, and the loop's own `< 50 blocks`
    # guard filters out truly tiny/noisy pools. "Unknown" is excluded as it doesn't
    # map to a real entity.
    extended_pools = [p for p in df['pool_name'].unique().tolist() if p != "Unknown"]
    
    weekly_stats = df[df['pool_name'].isin(top_pools)].copy()
    weekly_stats.set_index('timestamp', inplace=True)
    
    for pool in top_pools:
        p_df = weekly_stats[weekly_stats['pool_name'] == pool]['time_delta']
        # 7-day rolling statistics
        resampled = p_df.resample('7D').agg(['std', 'mean', 'count'])
        resampled['cv'] = resampled['std'] / resampled['mean']
        
        for date, row in resampled.iterrows():
            if pd.isna(row['cv']) or row['count'] < 10: continue
            entropy_data.append({
                "date": date.strftime('%Y-%m-%d'),
                "pool": pool,
                "cv": round(row['cv'], 3),
                "blocks": int(row['count'])
            })

    # KPI 4: Mempool Synchronization Index
    print("KPI 4: Mempool Synchronization Analysis...")
    
    # Define Empty Blocks: Primary forensic indicator of Header-First mining
    df['is_empty'] = df['tx_count'] == 1
    
    # Blocks where prev_pool == pool (Consecutive blocks)
    df['is_strike'] = df['pool_name'] == df['prev_pool']
    sync_df = df[df['is_strike']].copy()
    
    sync_stats = []
    for pool in top_pools:
        p_df_full = df[df['pool_name'] == pool]
        # Exclude negative time_delta values: Bitcoin timestamps allow slight backward drift
        # which produces spurious sub-30s hits unrelated to spy-mining behaviour
        p_sync_pool = sync_df[(sync_df['pool_name'] == pool) & (sync_df['time_delta'] >= 0)]
        p_deltas = p_sync_pool['time_delta']
        if len(p_deltas) < 50: continue
        
        buckets = {
            "sub_30s": int((p_deltas < 30).sum()),
            "sub_60s": int(((p_deltas >= 30) & (p_deltas < 60)).sum()),
            "sub_2m": int(((p_deltas >= 60) & (p_deltas < 120)).sum()),
            "sub_5m": int(((p_deltas >= 120) & (p_deltas < 300)).sum()),
            "slow": int((p_deltas >= 300).sum())
        }

        # Count empty consecutive blocks in those same time-frames
        buckets_empty = {
            "sub_30s": int(((p_deltas < 30) & p_sync_pool['is_empty']).sum()),
            "sub_60s": int(((p_deltas >= 30) & (p_deltas < 60) & p_sync_pool['is_empty']).sum()),
            "sub_2m": int(((p_deltas >= 60) & (p_deltas < 120) & p_sync_pool['is_empty']).sum()),
            "sub_5m": int(((p_deltas >= 120) & (p_deltas < 300) & p_sync_pool['is_empty']).sum()),
            "slow": int(((p_deltas >= 300) & p_sync_pool['is_empty']).sum())
        }
        
        sync_stats.append({
            "pool": pool,
            "avg_strike_delta": round(p_deltas.mean(), 2),
            "median_strike_delta": round(p_deltas.median(), 2),
            "buckets": buckets,
            "buckets_empty": buckets_empty,
            "total_consecutive": len(p_deltas),
            "total_blocks": len(p_df_full)
        })

    # KPI 5: Empty Block Auditor (Multi-Horizon)
    print("KPI 5: Empty Block Auditor Analysis...")
    
    # 1. Snapshots (All-time vs 30-day)
    thirty_days_ago = df['timestamp'].max() - pd.Timedelta(days=30)
    df_30d = df[df['timestamp'] >= thirty_days_ago]
    
    empty_stats = []
    for pool in extended_pools:
        # All-time
        p_df = df[df['pool_name'] == pool]
        if len(p_df) < 50: continue
        
        total_all = len(p_df)
        empty_all = int(p_df['is_empty'].sum())
        
        # 30-day
        p_df_30 = df_30d[df_30d['pool_name'] == pool]
        total_30 = len(p_df_30)
        empty_30 = int(p_df_30['is_empty'].sum()) if total_30 > 0 else 0
        
        empty_stats.append({
            "pool": pool,
            "total_all": total_all,
            "empty_all": empty_all,
            "ratio_all": round(empty_all / total_all * 100, 2),
            "total_30d": total_30,
            "empty_30d": empty_30,
            "ratio_30d": round(empty_30 / total_30 * 100, 2) if total_30 > 0 else 0
        })
    
    empty_stats = sorted(empty_stats, key=lambda x: x['ratio_all'], reverse=True)

    # 2. Monthly Trend (for the Top 10 pools by empty ratio)
    print("  Calculating monthly empty block trends...")
    df['month'] = df['timestamp'].dt.to_period('M').astype(str)
    
    # We only take pools that actually have a significant presence
    top_empty_offenders = [s['pool'] for s in empty_stats[:10]]
    trend_df = df[df['pool_name'].isin(top_empty_offenders)].groupby(['month', 'pool_name']).agg(
        total=('is_empty', 'count'),
        empty=('is_empty', 'sum')
    ).reset_index()
    trend_df['ratio'] = (trend_df['empty'] / trend_df['total'] * 100).round(2)
    
    monthly_empty_trend = trend_df.to_dict(orient='records')

    # KPI 6: Block Density Index
    print("KPI 6: Block Density Index...")
    # Space efficiency = bytes_total / block_weight
    # Max block_weight is 4,000,000
    df['density'] = df['bytes_total'] / df['block_weight']
    
    density_stats = []
    for pool in extended_pools:
        p_df = df[df['pool_name'] == pool]
        if len(p_df) < 100: continue
        
        density_stats.append({
            "pool": pool,
            "avg_density": round(float(p_df['density'].mean()), 4),
            "avg_tx_count": round(float(p_df['tx_count'].mean()), 2),
            "avg_bytes": round(float(p_df['bytes_total'].mean()), 2)
        })
    
    density_stats = sorted(density_stats, key=lambda x: x['avg_density'], reverse=True)

    # KPI 7: BIP 110 Battleground
    print("KPI 7: BIP 110 Battleground Analysis...")
    # 1. Signaling Logic
    df['is_bip110'] = (df['protocol_version'] & 16) != 0
    
    # Get 2016-block rolling average of signaling
    # We'll do this globally and also per-pool if we want the stacked area
    # For a stacked area chart, we need the contribution of each pool to the total signaling
    # Or rather, the share of signaling blocks mined by each pool in the window.
    df['signaling_val'] = df['is_bip110'].astype(int)
    
    # Calculate global signaling % over last 2016 blocks
    df['global_signaling_2016'] = df['signaling_val'].rolling(window=2016, min_periods=1).mean() * 100
    
    # For the stacked area chart: we group by Day and Pool
    df['day'] = df['timestamp'].dt.to_period('D').astype(str)
    
    # 2. Signaling Trend (Daily)
    # We want: Day, Pool, SignalingBlocksCount
    # And also TotalBlocksCount in that day to get the % context
    bip110_daily = df.groupby(['day', 'pool_name']).agg(
        total_blocks=('block_height', 'count'),
        signaling_blocks=('is_bip110', 'sum')
    ).reset_index()
    
    # 3. Efficiency Ratio (Scatter Sample)
    # Take last 30 days for the efficiency scatter plot
    efficiency_sample = df_30d[['block_height', 'tx_count', 'bytes_total', 'pool_name']].to_dict(orient='records')
    
    # 4. "Over-Limit" Blocks (83-Byte Rule Proxy)
    # Calculation: (bytes_total - bytes_stripped) / tx_count
    df['data_overhead'] = (df['bytes_total'] - df['bytes_stripped']) / df['tx_count'].replace(0, 1) # Avoid div by zero
    
    # Re-filter 30d to pick up the new column
    df_30d_new = df[df['timestamp'] >= thirty_days_ago]
    
    overhead_stats = []
    for pool in top_pools:
        # Last 30 days only for overhead
        p_df_30 = df_30d_new[df_30d_new['pool_name'] == pool]
        if len(p_df_30) < 50: continue
        
        overhead_stats.append({
            "pool": pool,
            "avg_overhead": round(float(p_df_30['data_overhead'].mean()), 2),
            "max_overhead": round(float(p_df_30['data_overhead'].max()), 2)
        })
    overhead_stats = sorted(overhead_stats, key=lambda x: x['avg_overhead'], reverse=True)

    # Final Signaling Trend Data Formatting
    days = sorted(bip110_daily['day'].unique())
    # Pre-calculate global rolling at the end of each day efficiently
    daily_rolling = df.groupby('day')['global_signaling_2016'].last().to_dict()
    
    signaling_trend = []
    for d in days:
        day_data = bip110_daily[bip110_daily['day'] == d]
        pool_signaling = {}
        pool_total = {}
        day_total_blocks = 0
        
        for _, row in day_data.iterrows():
            pname = row['pool_name']
            sig_count = int(row['signaling_blocks'])
            tot_count = int(row['total_blocks'])
            day_total_blocks += tot_count
            
            if sig_count > 0:
                pool_signaling[pname] = sig_count
            pool_total[pname] = tot_count
        
        signaling_trend.append({
            "day": str(d),
            "total_blocks": day_total_blocks,
            "pools_signaling": pool_signaling,
            "pools_total": pool_total,
            "global_rolling": round(float(daily_rolling.get(d, 0)), 2)
        })

    # Combine all into one JSON
    output = {
        "kpi1_strikes": leaderboard_json,
        "kpi2_funnel": funnel_data,
        "kpi3_entropy": entropy_data,
        "kpi4_sync": sync_stats,
        "kpi5_empty_blocks": {
            "leaderboard": empty_stats,
            "monthly_trend": monthly_empty_trend
        },
        "kpi6_density": density_stats,
        "kpi7_bip110": {
            "signaling_trend": signaling_trend[-180:], # Last 180 days
            "efficiency_scatter": efficiency_sample,
            "overhead_bar": overhead_stats
        },
        "last_updated": pd.Timestamp.now().isoformat()
    }
    
    out_path = DASHBOARD_DATA / "forensics_data.json"
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Forensics data written to {out_path}")

if __name__ == "__main__":
    main()
