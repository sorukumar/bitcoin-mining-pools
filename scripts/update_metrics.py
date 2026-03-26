"""
update_metrics.py
Recreates ecosystem.json and updates pool_meta.json with accurate metrics
after merging new data. Reads from dashboard/data/blocks.parquet
"""

import json
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent.parent
DASHBOARD_DATA = ROOT / "dashboard" / "data"


def main():
    print("Loading blocks_pre_2020.parquet and blocks_post_2020.parquet ...")
    df_pre = pd.read_parquet(DASHBOARD_DATA / "blocks_pre_2020.parquet")
    df_post = pd.read_parquet(DASHBOARD_DATA / "blocks_post_2020.parquet")
    df = pd.concat([df_pre, df_post], ignore_index=True)
    print(f"  {len(df):,} blocks loaded")

    # Load existing pool_meta.json
    with open(DASHBOARD_DATA / "pool_meta.json") as f:
        pool_meta = json.load(f)

    print("Calculating pool metrics ...")
    # Calculate metrics
    known = df[df["pool_slug"] != "unknown"]
    
    grouped = known.groupby("pool_slug").agg(
        first_block_mined=('height', 'min'),
        first_seen_date=('date', 'min'),
        last_block_mined=('height', 'max'),
        last_seen_date=('date', 'max'),
        lifetime_blocks=('height', 'count')
    )
    
    # Last 30 days share
    max_date = df["date"].max()
    last_month_start = max_date - pd.DateOffset(days=30)
    last_month_blocks = df[df["date"] >= last_month_start]
    last_month_total = len(last_month_blocks)
    
    last_month_counts = last_month_blocks[last_month_blocks["pool_slug"] != "unknown"].groupby("pool_slug").size()
    last_month_share = (last_month_counts / last_month_total * 100).round(2)
    
    # Format dates
    grouped['first_seen_date'] = grouped['first_seen_date'].dt.strftime('%Y-%m-%d')
    grouped['last_seen_date'] = grouped['last_seen_date'].dt.strftime('%Y-%m-%d')
    
    # Load lookup to map slug to name
    with open(DASHBOARD_DATA / "lookup" / "lookup_slug_to_name.json") as f:
        slug_to_name = json.load(f)
    
    # Update pool_meta.json
    for slug, row in grouped.iterrows():
        name = slug_to_name.get(slug, slug)
        if name not in pool_meta:
            pool_meta[name] = {}
            
        pool_meta[name]["first_block_mined"] = int(row["first_block_mined"])
        pool_meta[name]["first_seen_date"] = row["first_seen_date"]
        pool_meta[name]["last_block_mined"] = int(row["last_block_mined"])
        pool_meta[name]["last_seen_date"] = row["last_seen_date"]
        pool_meta[name]["lifetime_blocks"] = int(row["lifetime_blocks"])
        
        share = last_month_share.get(slug, 0.0)
        pool_meta[name]["last_month_share_pct"] = float(share)

    with open(DASHBOARD_DATA / "pool_meta.json", "w") as f:
        json.dump(pool_meta, f, separators=(",", ":"))
    print(f"  Updated pool_meta.json with metrics for {len(grouped)} pools")

    # Ecosystem Growth
    print("Calculating global ecosystem growth ...")
    # Get YYYY-MM
    df["month_key"] = df["date"].dt.strftime('%Y-%m')
    months = sorted(df["month_key"].unique())
    
    cumulative_counts = []
    seen = set()
    month_to_pools = df.groupby('month_key')['pool_slug'].unique()
    
    for m in months:
        if m in month_to_pools:
            for p in month_to_pools[m]:
                if p != "unknown":
                    seen.add(p)
        cumulative_counts.append(len(seen))
        
    ecosystem = {
        "months": months,
        "cumulativePools": cumulative_counts
    }
    with open(DASHBOARD_DATA / "ecosystem.json", "w") as f:
        json.dump(ecosystem, f, separators=(",", ":"))
    print(f"  Wrote ecosystem.json with {len(months)} months")

    print("Metrics update completed!")


if __name__ == "__main__":
    main()