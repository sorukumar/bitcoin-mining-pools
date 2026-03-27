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
    print("Loading bitcoin_blocks_pool.parquet ...")
    df = pd.read_parquet(RAW / "bitcoin_blocks_pool.parquet")
    
    # Filter for Jan 2020 onwards
    # Height ~610682
    df = df[df['block_height'] >= 610682].copy()
    df = df.sort_values('block_height').reset_index(drop=True)
    
    print(f"Processing {len(df):,} blocks (post-2020)...")
    
    # 1. Resolve Pools
    print("Mapping coinbase tags to pools ...")
    tags = load_pool_mapping()
    df['pool_name'] = df['coinbase_tag'].apply(lambda x: resolve_pool(x, tags))
    
    # 2. Add Datetime
    df['timestamp'] = pd.to_datetime(df['block_time'], unit='s')
    df['date_key'] = df['timestamp'].dt.date
    
    # KPI 1: Consecutive Strikes
    print("KPI 1: Consecutive Strikes Analysis...")
    df['prev_pool'] = df['pool_name'].shift(1)
    df['strike_id'] = (df['pool_name'] != df['prev_pool']).cumsum()
    
    strikes = df.groupby('strike_id').agg({
        'pool_name': 'first',
        'block_height': ['min', 'max', 'count'],
        'timestamp': ['min', 'max']
    })
    strikes.columns = ['pool', 'start_height', 'end_height', 'count', 'start_time', 'end_time']
    strikes['duration_sec'] = (strikes['end_time'] - strikes['start_time']).dt.total_seconds()
    
    leaderboard = strikes[strikes['count'] >= 6].sort_values(['count', 'start_time'], ascending=[False, False])
    leaderboard_json = leaderboard.head(50).to_dict(orient='records')
    # Convert timestamps for JSON
    for entry in leaderboard_json:
        entry['start_time'] = entry['start_time'].isoformat()
        entry['end_time'] = entry['end_time'].isoformat()

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
        if tip_idx < window_baseline: break
        
        obs_start = tip_idx - window_observed + 1
        base_start = tip_idx - window_baseline + 1
        
        obs_df = df.iloc[obs_start:tip_idx+1]
        base_df = df.iloc[base_start:tip_idx+1]
        
        base_counts = base_df['pool_name'].value_counts()
        base_shares = base_counts / window_baseline
        
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
    
    # Filter for pools with > 1% hashrate OVERALL to keep heatmap clean
    top_pools = df['pool_name'].value_counts(normalize=True)
    top_pools = top_pools[top_pools > 0.01].index.tolist()
    if "Unknown" in top_pools: top_pools.remove("Unknown")
    
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
    # Blocks where prev_pool == pool
    df['is_strike'] = df['pool_name'] == df['prev_pool']
    sync_df = df[df['is_strike']].copy()
    
    sync_stats = []
    for pool in top_pools:
        p_deltas = sync_df[sync_df['pool_name'] == pool]['time_delta']
        if len(p_deltas) < 50: continue
        
        # We want the distribution, so we'll bucket them
        # 0-30s, 30-60s, 60-120s, 120-300s, 300s+
        buckets = {
            "sub_30s": int((p_deltas < 30).sum()),
            "sub_60s": int(((p_deltas >= 30) & (p_deltas < 60)).sum()),
            "sub_2m": int(((p_deltas >= 60) & (p_deltas < 120)).sum()),
            "sub_5m": int(((p_deltas >= 120) & (p_deltas < 300)).sum()),
            "slow": int((p_deltas >= 300).sum())
        }
        
        sync_stats.append({
            "pool": pool,
            "avg_strike_delta": round(p_deltas.mean(), 2),
            "median_strike_delta": round(p_deltas.median(), 2),
            "buckets": buckets,
            "total_consecutive": len(p_deltas)
        })

    # Combine all into one JSON
    output = {
        "kpi1_strikes": leaderboard_json,
        "kpi2_funnel": funnel_data,
        "kpi3_entropy": entropy_data,
        "kpi4_sync": sync_stats,
        "last_updated": pd.Timestamp.now().isoformat()
    }
    
    out_path = DASHBOARD_DATA / "forensics_data.json"
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Forensics data written to {out_path}")

if __name__ == "__main__":
    main()
