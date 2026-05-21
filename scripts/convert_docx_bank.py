"""Convert Bank Soalan DOCX files to questions.csv (350 rows)."""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

try:
    from docx import Document
except ImportError:
    print("Install: pip install python-docx", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
BANK_DIR = ROOT / "Bank Soalan"
OUT_CSV = ROOT / "data" / "questions.csv"
OUT_JSON = ROOT / "data" / "topik.json"

FILE_TOPIK = {
    "SOALAN TOPIK AKIDAH.docx": "AKIDAH",
    "SOALAN TOPIK AL-QURAN.docx": "ALQURAN",
    "SOALAN TOPIK JAWI.docx": "JAWI",
    "SOALAN TOPIK SIRAH.docx": "SIRAH",
    "50 SOALAN HADIS.docx": "HADIS",
    "50 SOALAN IBADAH.docx": "IBADAH",
    "50 SOALAN ADAB.docx": "ADAB",
}

COLUMNS = ["id", "topik", "aras", "soalan", "A", "B", "C", "D", "jawapan"]
JAWAPAN_RE = re.compile(r"Jawapan\s*:\s*([A-Da-d])", re.IGNORECASE)
OPTION_RE = re.compile(r"^([A-D])\.\s*(.+)$", re.IGNORECASE)
HEADER_RE = re.compile(r"^Bahagian\s", re.IGNORECASE)
LEADING_NUM_RE = re.compile(r"^\d+\.\s*")


def parse_question_block(text: str) -> dict | None:
    m = JAWAPAN_RE.search(text)
    if not m:
        return None
    jawapan = m.group(1).upper()
    body = text[: m.start()].strip()
    lines = [ln.strip() for ln in body.split("\n") if ln.strip()]
    options: dict[str, str] = {}
    stem_lines: list[str] = []
    for line in lines:
        om = OPTION_RE.match(line)
        if om:
            options[om.group(1).upper()] = om.group(2).strip()
        else:
            stem_lines.append(line)
    if len(options) < 4:
        return None
    soalan = " ".join(stem_lines).strip()
    soalan = LEADING_NUM_RE.sub("", soalan)
    if not soalan:
        return None
    return {
        "soalan": soalan,
        "A": options.get("A", ""),
        "B": options.get("B", ""),
        "C": options.get("C", ""),
        "D": options.get("D", ""),
        "jawapan": jawapan,
    }


def extract_questions(path: Path, topik: str) -> list[dict]:
    doc = Document(path)
    rows: list[dict] = []
    num = 0
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text or HEADER_RE.match(text):
            continue
        parsed = parse_question_block(text)
        if not parsed:
            continue
        num += 1
        aras = "sederhana" if num <= 25 else "tinggi"
        qid = f"{topik}-{num:02d}"
        rows.append(
            {
                "id": qid,
                "topik": topik,
                "aras": aras,
                **parsed,
            }
        )
    return rows


def main() -> None:
    if not BANK_DIR.is_dir():
        print(f"Missing folder: {BANK_DIR}", file=sys.stderr)
        sys.exit(1)

    all_rows: list[dict] = []
    meta: list[dict] = []

    for filename, topik in FILE_TOPIK.items():
        path = BANK_DIR / filename
        if not path.exists():
            print(f"Missing: {path}", file=sys.stderr)
            sys.exit(1)
        rows = extract_questions(path, topik)
        if len(rows) != 50:
            print(
                f"Warning: {topik} has {len(rows)} questions (expected 50)",
                file=sys.stderr,
            )
        all_rows.extend(rows)
        sed = sum(1 for r in rows if r["aras"] == "sederhana")
        ting = sum(1 for r in rows if r["aras"] == "tinggi")
        meta.append(
            {
                "topik": topik,
                "fail": filename,
                "jumlah": len(rows),
                "sederhana": sed,
                "tinggi": ting,
            }
        )

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)

    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump({"topik": meta, "jumlah_keseluruhan": len(all_rows)}, f, indent=2)

    print(f"Wrote {len(all_rows)} questions to {OUT_CSV}")
    print(f"Wrote metadata to {OUT_JSON}")


if __name__ == "__main__":
    main()
