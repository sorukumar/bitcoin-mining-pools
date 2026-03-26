"""
merge_myrp.py
Reads bitcoin_miners_myrp.parquet, transforms columns, and appends to blocks_post_2020.parquet
Updates blocks.parquet with the merged data
"""

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
DASHBOARD_DATA = ROOT / "dashboard" / "data"



def main():
    print("Loading existing blocks_post_2020.parquet ...")
    df_post = pd.read_parquet(DASHBOARD_DATA / "blocks_post_2020.parquet")
    print(f"  Existing post-2020 blocks: {len(df_post)} (heights {df_post['height'].min()} – {df_post['height'].max()})")

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

    print("Appending MYRP to post-2020 ...")
    df_post_merged = pd.concat([df_post, df_myrp], ignore_index=True)
    df_post_merged = df_post_merged.sort_values('height').reset_index(drop=True)
    print(f"  Merged post-2020 blocks: {len(df_post_merged)} (heights {df_post_merged['height'].min()} – {df_post_merged['height'].max()})")

    print("Writing updated blocks_post_2020.parquet ...")
    table_post = pa.Table.from_pandas(df_post_merged, preserve_index=False)
    pq.write_table(
        table_post,
        DASHBOARD_DATA / "blocks_post_2020.parquet",
        compression="snappy",
        use_dictionary=["pool_slug"],
        write_statistics=True,
    )

    print("Updating blocks.parquet ...")
    df_pre = pd.read_parquet(DASHBOARD_DATA / "blocks_pre_2020.parquet")
    df_full = pd.concat([df_pre, df_post_merged], ignore_index=True)
    table_full = pa.Table.from_pandas(df_full, preserve_index=False)
    pq.write_table(
        table_full,
        DASHBOARD_DATA / "blocks.parquet",
        compression="snappy",
        use_dictionary=["pool_slug"],
        write_statistics=True,
    )
    print(f"  Full blocks: {len(df_full)}")



if __name__ == "__main__":
    main()