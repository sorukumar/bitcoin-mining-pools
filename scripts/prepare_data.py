"""
prepare_data.py
Reads data/raw/blocks.csv + data/raw/pools.json + forref/bitcoin_blocks_metadata.parquet
Enriches blocks with real timestamp from metadata
Writes lean data/geo/processed/blocks.parquet with only height, pool_slug, date
Creates lookup_slug_to_name.json for pool names
"""

import json
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "dashboard" / "data"
PROCESSED.mkdir(parents=True, exist_ok=True)


def main():
    print("Loading blocks.csv ...")
    blocks = pd.read_csv(
        RAW / "blocks.csv",
        dtype={"height": "int32", "hash": "str", "pool_slug": "str"},
    )
    print(f"  {len(blocks):,} blocks loaded (heights {blocks['height'].min()} – {blocks['height'].max()})")

    print("Loading bitcoin_blocks_metadata.parquet ...")
    metadata = pd.read_parquet(ROOT / "forref" / "bitcoin_blocks_metadata.parquet", columns=["block_height", "timestamp"])
    metadata.rename(columns={"block_height": "height"}, inplace=True)

    print("Merging real timestamps ...")
    blocks = blocks.merge(metadata, on="height", how="left")
    blocks.rename(columns={"timestamp": "date"}, inplace=True)

    # Keep only necessary columns
    blocks = blocks[["height", "pool_slug", "date"]]

    print("Loading pools.json for name lookup ...")
    with open(RAW / "pools.json") as f:
        pools_raw = json.load(f)

    # Build slug -> name lookup
    slug_to_name = {}
    for section in ("payout_addresses", "coinbase_tags"):
        for entry in pools_raw.get(section, {}).values():
            name = entry.get("name", "")
            if name:
                slug = name.lower().replace(" ", "").replace("-", "").replace("_", "").replace(".", "")
                slug_to_name[slug] = name

    # Add unknown
    slug_to_name["unknown"] = "Unknown"

    # Write lookup
    lookup_path = PROCESSED / "lookup" / "lookup_slug_to_name.json"
    with open(lookup_path, "w") as f:
        json.dump(slug_to_name, f, separators=(",", ":"))
    print(f"  lookup_slug_to_name.json written ({lookup_path.stat().st_size / 1024:.1f} KB)")

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
        use_dictionary=["pool_slug"],
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
        use_dictionary=["pool_slug"],
        write_statistics=True,
    )
    size_mb_post = post_path.stat().st_size / 1_048_576
    print(f"  Done — {size_mb_post:.2f} MB")

    print(f"\nTotal blocks processed: {len(blocks)}")


if __name__ == "__main__":
    main()