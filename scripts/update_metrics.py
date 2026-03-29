import json
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent.parent
DASHBOARD_DATA = ROOT / "dashboard" / "data"

def to_slug_canonical(s):
    if pd.isna(s) or s == "": return "unknown"
    s = str(s).lower()
    if s == "unknown": return "unknown"
    for char in [" ", "-", "_", "."]:
        s = s.replace(char, "")
    return s

def generate_master_lookup(pools_raw, df_slugs):
    """
    Creates lookup_slug_to_name.json using:
    1. Official pool names from pools.json (Priority)
    2. Title-cased slugs found in the data as a fallback
    """
    slug_to_name = {}
    
    # 1. Official names from pools.json
    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools_raw.get(section, {}).values():
            name = entry.get("name", "")
            if name:
                slug = to_slug_canonical(name)
                slug_to_name[slug] = name
    
    # 2. Add fallback for any slugs found in data but not in pools.json
    for slug in df_slugs:
        if slug not in slug_to_name and slug != "unknown":
            # "mara-pool" -> "Mara Pool"
            fallback_name = slug.replace("-", " ").replace("_", " ").title()
            slug_to_name[slug] = fallback_name
            
    slug_to_name["unknown"] = "Unknown"
    
    lookup_path = DASHBOARD_DATA / "lookup" / "lookup_slug_to_name.json"
    with open(lookup_path, "w") as f:
        json.dump(slug_to_name, f, separators=(",", ":"), indent=2)
    print(f"  Master lookup written to {lookup_path} ({len(slug_to_name)} entries)")
    return slug_to_name

def main():
    RAW = ROOT / "data" / "raw"
    print("Loading blocks_pre_2021.parquet and blocks_post_2021.parquet ...")
    df_pre = pd.read_parquet(DASHBOARD_DATA / "blocks_pre_2021.parquet")
    df_post = pd.read_parquet(DASHBOARD_DATA / "blocks_post_2021.parquet")
    df = pd.concat([df_pre, df_post], ignore_index=True)
    print(f"  {len(df):,} blocks loaded")

    # Convert date column to datetime
    df["date"] = pd.to_datetime(df["date"])

    # Load pooled identity data
    print("Loading links from pools.json ...")
    with open(RAW / "pools.json") as f:
        pools_raw = json.load(f)
    
    # Generate the lookup JSON first, using unique slugs from data + official list
    unique_slugs = df["pool_slug"].unique()
    slug_to_name = generate_master_lookup(pools_raw, unique_slugs)
    
    name_to_link = {}
    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools_raw.get(section, {}).values():
            name = entry.get("name", "")
            link = entry.get("link", "")
            if name:
                name_to_link[name] = link
    
    pool_meta = {name: {"link": link} for name, link in name_to_link.items()}

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
    
    # Update pool_metrics.json
    for slug, row in grouped.iterrows():
        name = slug_to_name.get(slug, slug)
        if name not in pool_meta:
            pool_meta[name] = {"link": ""}
            
        pool_meta[name]["first_block_mined"] = int(row["first_block_mined"])
        pool_meta[name]["first_seen_date"] = row["first_seen_date"]
        pool_meta[name]["last_block_mined"] = int(row["last_block_mined"])
        pool_meta[name]["last_seen_date"] = row["last_seen_date"]
        pool_meta[name]["lifetime_blocks"] = int(row["lifetime_blocks"])
        
        share = last_month_share.get(slug, 0.0)
        pool_meta[name]["last_month_share_pct"] = float(share)

    with open(DASHBOARD_DATA / "pool_metrics.json", "w") as f:
        json.dump(pool_meta, f, separators=(",", ":"))
    print(f"  Wrote pool_metrics.json with metrics for {len(grouped)} pools")

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
    with open(DASHBOARD_DATA / "pool_growth.json", "w") as f:
        json.dump(ecosystem, f, separators=(",", ":"))
    print(f"  Wrote pool_growth.json with {len(months)} months")

    print("Metrics update completed!")

if __name__ == "__main__":
    main()