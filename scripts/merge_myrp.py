"""
merge_myrp.py
Reads bitcoin_miners_myrp.parquet, transforms columns, and appends to blocks_post_2021.parquet
Also regenerates lookup/lookup_slug_to_name.json from pools.json so it never needs to be hardcoded.
"""

import json
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
DASHBOARD_DATA = ROOT / "dashboard" / "data"


def to_slug(s):
    if pd.isna(s) or s == "":
        return "unknown"
    s = str(s).lower()
    if s == "unknown":
        return "unknown"
    # Project-wide canonical normalization: lowercase, remove spaces/dashes/dots/underscores
    for char in [" ", "-", "_", "."]:
        s = s.replace(char, "")
    return s


# Pools that exist in blocks data but are not (yet) in pools.json.
# Add entries here when a new pool appears that lacks a coinbase tag in pools.json.
_MANUAL_OVERRIDES = {
    "carbonnegative":     "Carbon Negative",
    "futurebitapollosolo": "FutureBit Apollo Solo",
    "ocean":              "Ocean.xyz",
    "phoenix":            "Phoenix",
    "slushpool":          "Slush Pool",
    "unknown":            "Unknown",
    "zulupool":           "Zulu Pool",
    # legacy / low-volume
    "1m1x":               "1M1X",
    "btcpoolparty":       "BTCPool Party",
    "exxbw":              "EXX&BW",
    "miningkings":        "Mining Kings",
    "tiger":              "Tiger",
    "tigerpoolnet":       "TigerPool.net",
    "trickysbtcpool":     "Tricky's BTC Pool",
    "wk057":              "Wk057",
}


def generate_lookup():
    """Build lookup/lookup_slug_to_name.json from pools.json + manual overrides."""
    with open(RAW / "pools.json") as f:
        pools_raw = json.load(f)

    slug_to_name = {}
    # coinbase_tags is the primary source of pool identity
    for _tag, info in pools_raw.get("coinbase_tags", {}).items():
        name = info["name"]
        slug = to_slug(name)
        if slug and slug != "unknown":
            slug_to_name[slug] = name
    # payout_addresses provides additional pools
    for _addr, info in pools_raw.get("payout_addresses", {}).items():
        name = info["name"]
        slug = to_slug(name)
        if slug and slug != "unknown":
            slug_to_name[slug] = name

    # Manual overrides for pools not yet in pools.json
    slug_to_name.update(_MANUAL_OVERRIDES)

    # Sort alphabetically by slug for stable diffs
    slug_to_name = dict(sorted(slug_to_name.items()))

    out_path = DASHBOARD_DATA / "lookup" / "lookup_slug_to_name.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(slug_to_name, f, indent=2, ensure_ascii=False)

    print(f"  lookup_slug_to_name.json written: {len(slug_to_name)} entries → {out_path}")
    return slug_to_name


def main():
    print("Loading existing blocks_post_2021.parquet ...")
    df_post = pd.read_parquet(DASHBOARD_DATA / "blocks_post_2021.parquet")
    print(f"  Existing post-2021 blocks: {len(df_post)} (heights {df_post['height'].min()} – {df_post['height'].max()})")

    print("Loading bitcoin_miners_myrp.parquet ...")
    df_myrp = pd.read_parquet(RAW / "bitcoin_miners_myrp.parquet")
    print(f"  MYRP blocks: {len(df_myrp)} (heights {df_myrp['block_height'].min()} – {df_myrp['block_height'].max()})")

    print("Transforming MYRP data ...")
    df_myrp = df_myrp.rename(columns={
        'block_height': 'height',
        'mining_pool': 'pool_slug',
        'timestamp': 'date'
    })
    # Keep only necessary columns: height, pool_slug, date
    df_myrp = df_myrp[['height', 'pool_slug', 'date']]

    print("Normalizing slugs ...")
    df_post['pool_slug'] = df_post['pool_slug'].apply(to_slug)
    df_myrp['pool_slug'] = df_myrp['pool_slug'].apply(to_slug)

    print("Appending MYRP to post-2021 ...")
    df_post_merged = pd.concat([df_post, df_myrp], ignore_index=True)
    # Ensure newly identified miners replace old entries for the same height
    df_post_merged = df_post_merged.drop_duplicates(subset=['height'], keep='last')
    df_post_merged = df_post_merged.sort_values('height').reset_index(drop=True)
    print(f"  Merged post-2021 blocks: {len(df_post_merged)} (heights {df_post_merged['height'].min()} – {df_post_merged['height'].max()})")

    print("Writing updated blocks_post_2021.parquet ...")
    table_post = pa.Table.from_pandas(df_post_merged, preserve_index=False)
    pq.write_table(
        table_post,
        DASHBOARD_DATA / "blocks_post_2021.parquet",
        compression="snappy",
        use_dictionary=["pool_slug"],
        write_statistics=True,
    )

    print(f"  Merged post-2021 blocks: {len(df_post_merged)}")

    print("Regenerating lookup_slug_to_name.json ...")
    generate_lookup()


if __name__ == "__main__":
    main()