"""Enumerate every AWS eCourts metadata partition, so a full ingest can be sized
before it is started rather than discovered halfway through.

Lists both buckets and reports partition counts and bytes per year.

Run:  uv run python3 scripts/ingest/enumerate_partitions.py
"""

import re
import urllib.parse
import urllib.request
from collections import defaultdict

HC = "indian-high-court-judgments"
SC = "indian-supreme-court-judgments"


def list_bucket(bucket: str, prefix: str) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    token = None
    while True:
        url = f"https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={urllib.parse.quote(prefix)}"
        if token:
            url += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        body = urllib.request.urlopen(url).read().decode()
        for key, size in re.findall(r"<Key>(.*?)</Key>.*?<Size>(\d+)</Size>", body, re.S):
            if key.endswith(".parquet"):
                out.append((key, int(size)))
        if "<IsTruncated>true</IsTruncated>" not in body:
            break
        m = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", body)
        if not m:
            break
        token = m.group(1)
    return out


def main() -> None:
    for label, bucket in [("SUPREME COURT", SC), ("HIGH COURTS", HC)]:
        keys = list_bucket(bucket, "metadata/parquet/")
        by_year: dict[str, list[int]] = defaultdict(list)
        courts: set[str] = set()
        for k, s in keys:
            y = re.search(r"year=(\d+)", k)
            c = re.search(r"court=([^/]+)", k)
            if y:
                by_year[y.group(1)].append(s)
            if c:
                courts.add(c.group(1))
        total = sum(s for _, s in keys)
        print(f"\n=== {label} ({bucket}) ===")
        print(f"partitions: {len(keys):,}   distinct courts: {len(courts) or 1}")
        print(f"metadata parquet total: {total / 1e9:.2f} GB")
        years = sorted(by_year)
        if years:
            print(f"year range: {years[0]}..{years[-1]}")
            recent = [y for y in years if int(y) >= 2015]
            rb = sum(sum(by_year[y]) for y in recent)
            rn = sum(len(by_year[y]) for y in recent)
            print(f"  2015+: {rn:,} partitions, {rb / 1e9:.2f} GB")


if __name__ == "__main__":
    main()
