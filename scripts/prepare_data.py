"""
prepare_data.py
Reads data/raw/blocks.csv + data/raw/pools.json
Enriches blocks with pool name & link
Writes data/processed/blocks.parquet
"""

import json
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
PROCESSED.mkdir(parents=True, exist_ok=True)


def build_slug_map(pools_path: Path) -> dict:
    """
    pools.json has payout_addresses and coinbase_tags, each mapping to {name, link}.
    We need a slug → {name, link} map.
    The slug is a lowercase-no-spaces version of the name, matching what jlopp uses.
    We build it by normalizing every unique pool name we find.
    """
    with open(pools_path) as f:
        pools = json.load(f)

    slug_map = {}

    def name_to_slug(name: str) -> str:
        return name.lower().replace(" ", "").replace(".", "").replace("-", "").replace("_", "")

    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools.get(section, {}).values():
            name = entry.get("name", "")
            link = entry.get("link", "")
            if name:
                slug = name_to_slug(name)
                slug_map[slug] = {"name": name, "link": link}

    return slug_map


def load_explicit_slug_map(pools_path: Path) -> dict:
    """
    Build a direct slug map by reading unique (name, link) pairs
    and creating common known slugs used by jlopp's dataset.
    This is a best-effort mapping for well-known pools.
    """
    with open(pools_path) as f:
        pools = json.load(f)

    # Collect all unique name→link pairs
    name_link = {}
    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools.get(section, {}).values():
            name = entry.get("name", "")
            link = entry.get("link", "")
            if name:
                name_link[name] = link

    return name_link


def main():
    print("Loading blocks.csv ...")
    blocks = pd.read_csv(
        RAW / "blocks.csv",
        dtype={"height": "int32", "hash": "str", "pool_slug": "str"},
    )
    print(f"  {len(blocks):,} blocks loaded (heights {blocks['height'].min()} – {blocks['height'].max()})")

    print("Loading pools.json ...")
    with open(RAW / "pools.json") as f:
        pools_raw = json.load(f)

    # Build name→link lookup from both sections
    name_link = {}
    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools_raw.get(section, {}).values():
            name = entry.get("name", "")
            link = entry.get("link", "")
            if name and name not in name_link:
                name_link[name] = link

    # Normalise both slug and pool names for fuzzy matching
    # jlopp slugs are lowercase, spaces→hyphens or stripped
    def to_key(s: str) -> str:
        return s.lower().replace(" ", "").replace("-", "").replace("_", "").replace(".", "")

    key_to_name = {to_key(n): n for n in name_link}

    def resolve_name(slug: str) -> str:
        if slug in ("unknown", ""):
            return "Unknown"
        name = key_to_name.get(to_key(slug), slug)  # fall back to slug itself
        return name

    print("Enriching blocks with pool metadata ...")
    blocks["pool_name"] = blocks["pool_slug"].apply(resolve_name)

    # Halving epoch from height: 0→209999=E0, 210000→419999=E1, etc.
    blocks["epoch"] = (blocks["height"] // 210_000).astype("int8")

    # Approximate date: 10 min/block from genesis (2009-01-03)
    # Real timestamps will replace this in Phase 2 when we pull from node/mempool
    GENESIS_TS = pd.Timestamp("2009-01-03")
    blocks["approx_date"] = GENESIS_TS + pd.to_timedelta(blocks["height"] * 10, unit="min")

    # Drop columns not needed for visualization
    # hash     — 64-char hex, ~60MB, not used in any chart
    # pool_link — derivable from pool_name at render time via a small lookup JSON
    blocks.drop(columns=["hash"], inplace=True)

    # Write pool metadata as a separate small lookup JSON for the dashboard
    pool_meta = {
        name: {"link": link}
        for name, link in name_link.items()
    }
    pool_meta_path = PROCESSED / "pool_meta.json"
    with open(pool_meta_path, "w") as f:
        json.dump(pool_meta, f, separators=(",", ":"))
    print(f"  pool_meta.json written ({pool_meta_path.stat().st_size / 1024:.1f} KB)")

    # Split blocks into pre and post 2020 based on block height
    pre_2020 = blocks[blocks['height'] < 610683]
    post_2020 = blocks[blocks['height'] >= 610683]

    # Write pre-2020 parquet
    pre_path = PROCESSED / "blocks_pre_2020.parquet"
    print(f"Writing {pre_path} ...")
    table_pre = pa.Table.from_pandas(pre_2020, preserve_index=False)
    pq.write_table(
        table_pre,
        pre_path,
        compression="snappy",
        use_dictionary=["pool_slug", "pool_name"],
        write_statistics=True,
    )
    size_mb_pre = pre_path.stat().st_size / 1_048_576
    print(f"  Done — {size_mb_pre:.2f} MB")

    # Write post-2020 parquet
    post_path = PROCESSED / "blocks_post_2020.parquet"
    print(f"Writing {post_path} ...")
    table_post = pa.Table.from_pandas(post_2020, preserve_index=False)
    pq.write_table(
        table_post,
        post_path,
        compression="snappy",
        use_dictionary=["pool_slug", "pool_name"],
        write_statistics=True,
    )
    size_mb_post = post_path.stat().st_size / 1_048_576
    print(f"  Done — {size_mb_post:.2f} MB")

    # Coverage stats
    print("\n=== Pool Coverage ===")
    total = len(blocks)
    unknown = (blocks["pool_slug"] == "unknown").sum()
    known = total - unknown
    print(f"  Total blocks   : {total:,}")
    print(f"  Known pool     : {known:,} ({known/total*100:.1f}%)")
    print(f"  Unknown        : {unknown:,} ({unknown/total*100:.1f}%)")
    print(f"  Unique slugs   : {blocks['pool_slug'].nunique()}")
    print(f"  Resolved names : {blocks['pool_name'].nunique()}")

    # Top 10
    print("\n=== Top 10 Pools (all-time) ===")
    top = (
        blocks[blocks["pool_slug"] != "unknown"]
        .groupby("pool_name").size()
        .sort_values(ascending=False)
        .head(10)
    )
    for name, count in top.items():
        print(f"  {name:<30} {count:>7,}  ({count/total*100:.2f}%)")

    # Column sizes breakdown
    print("\n=== Parquet Column Sizes ===")
    pf = pq.ParquetFile(post_path)
    meta = pq.read_metadata(post_path)
    for i in range(meta.row_group(0).num_columns):
        col = meta.row_group(0).column(i)
        print(f"  {col.path_in_schema:<20} {col.total_compressed_size / 1024:>8.1f} KB")


if __name__ == "__main__":
    main()
