"""Convert Excel question bank to CSV for Google Sheet import."""
from __future__ import annotations

import csv
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("Install openpyxl: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "100 Latihan Tatabahasa Bahasa Melayu.xlsx"
OUT = ROOT / "data" / "questions.csv"

COLUMNS = ["id", "soalan", "A", "B", "C", "D", "jawapan"]


def main() -> None:
    if not XLSX.exists():
        print(f"Missing: {XLSX}", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not rows:
        print("Empty workbook", file=sys.stderr)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with OUT.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(COLUMNS)
        for row in rows[1:]:
            if not row or row[0] is None:
                continue
            bil, soalan, a, b, c, d, jawapan = row[:7]
            writer.writerow(
                [
                    int(bil) if bil == int(bil) else bil,
                    (soalan or "").strip(),
                    (a or "").strip(),
                    (b or "").strip(),
                    (c or "").strip(),
                    (d or "").strip(),
                    str(jawapan or "").strip().upper(),
                ]
            )
            count += 1

    print(f"Wrote {count} questions to {OUT}")


if __name__ == "__main__":
    main()
