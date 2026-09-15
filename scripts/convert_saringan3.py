#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tukar bank soalan Saringan 3 (DOCX) kepada CSV untuk import Google Sheet.

- S3 Pusingan 1: 4 set x 10 soalan objektif (A-D) -> data/soalan-s3p1.csv
- S3 Pusingan 2: soalan rebutan (tanpa pilihan)   -> data/soalan-rebutan.csv

Tidak perlu python-docx: DOCX ialah zip, teks ada dalam word/document.xml.

Guna:
    python scripts/convert_saringan3.py
"""
import csv
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "Bank Soalan Saringan 3")
DATA = os.path.join(ROOT, "data")

S3P1_DOCX = os.path.join(BANK, "S3P1 - Al-Quran dan Hadis 40 Soalan.docx")
S3P2_DOCX = os.path.join(BANK, "S3P2 - Soalan Rebutan.docx")


def read_paragraphs(path):
    """Pulangkan senarai perenggan (baris) teks daripada fail DOCX."""
    z = zipfile.ZipFile(path)
    xml = z.read("word/document.xml").decode("utf-8", "ignore")
    lines = []
    for para in re.split(r"</w:p>", xml):
        texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, re.S)
        line = "".join(texts)
        line = (
            line.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&apos;", "'")
        )
        # Normalisasi petik pintar / apostrof supaya CSV konsisten
        line = line.replace("’", "'").replace("‘", "'")
        line = line.replace("“", '"').replace("”", '"')
        line = line.strip()
        if line:
            lines.append(line)
    return lines


def parse_s3p1(lines):
    """Parse 4 set x 10 soalan objektif + skema jawapan."""
    set_no = 0
    soalan = {}  # no -> dict
    order = []
    cur = None
    answers = {}  # no -> huruf

    re_set = re.compile(r"^SET\s+(\d+)\s*$", re.I)
    re_q = re.compile(r"^(\d+)\.\s*\[([^\]]+)\]\s*(.*)$")
    re_opt = re.compile(r"^([ABCD])\.\s*(.*)$")
    re_ans_line = re.compile(r"^SET\s+\d+\s*:\s*(.*)$", re.I)
    re_ans_pair = re.compile(r"(\d+)\.\s*([ABCD])")

    for line in lines:
        m = re_ans_line.match(line)
        if m:
            for no, huruf in re_ans_pair.findall(m.group(1)):
                answers[int(no)] = huruf
            continue
        m = re_set.match(line)
        if m:
            set_no = int(m.group(1))
            continue
        m = re_q.match(line)
        if m:
            no = int(m.group(1))
            cur = {
                "set": set_no,
                "no": no,
                "aras": m.group(2).strip().lower(),
                "soalan": m.group(3).strip(),
                "A": "",
                "B": "",
                "C": "",
                "D": "",
            }
            soalan[no] = cur
            order.append(no)
            continue
        m = re_opt.match(line)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2).strip()
            continue

    rows = []
    for no in order:
        q = soalan[no]
        q["jawapan"] = answers.get(no, "")
        rows.append(q)
    return rows


def parse_rebutan(lines):
    """Parse soalan rebutan: tajuk topik, soalan, dan 'Jawapan: ...'.

    Pulangkan (utama, cadangan): 8 soalan bernombor sebagai utama,
    selebihnya sebagai cadangan/simpanan.
    """
    topik_set = {"AKIDAH", "ADAB", "SIRAH", "ALQURAN", "AL-QURAN", "HADIS",
                 "IBADAH", "JAWI"}
    cur_topik = ""
    rows = []
    cur = None

    re_num = re.compile(r"^(\d+)\.\s*(.*)$")
    re_ans = re.compile(r"^Jawapan\s*:\s*(.*)$", re.I)

    for line in lines:
        # Tajuk topik (satu perkataan, mungkin berpangkalan nombor "4. Sirah")
        bare = re.sub(r"^\d+\.\s*", "", line).strip()
        if bare.upper() in topik_set:
            cur_topik = bare.upper().replace("AL-QURAN", "ALQURAN")
            continue
        m = re_ans.match(line)
        if m and cur is not None:
            cur["jawapan"] = m.group(1).strip()
            rows.append(cur)
            cur = None
            continue
        # Baris soalan (bernombor atau berakhir dengan '?')
        m = re_num.match(line)
        if m:
            cur = {"no": int(m.group(1)), "topik": cur_topik,
                   "soalan": m.group(2).strip(), "jawapan": ""}
            continue
        if line.endswith("?"):
            cur = {"no": None, "topik": cur_topik, "soalan": line, "jawapan": ""}
            continue

    utama = [r for r in rows if r["no"] is not None][:8]
    cadangan = [r for r in rows if r not in utama]
    # Nomborkan semula cadangan supaya CSV kemas
    for i, r in enumerate(cadangan, start=1):
        r["no"] = "C" + str(i)
    return utama, cadangan


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow([r.get(h, "") for h in header])
    print("  ->", os.path.relpath(path, ROOT), "(", len(rows), "baris )")


def main():
    if not os.path.exists(S3P1_DOCX) or not os.path.exists(S3P2_DOCX):
        print("Fail DOCX tidak dijumpai dalam", BANK, file=sys.stderr)
        return 1
    os.makedirs(DATA, exist_ok=True)

    print("S3 Pusingan 1 (objektif):")
    s3p1 = parse_s3p1(read_paragraphs(S3P1_DOCX))
    write_csv(
        os.path.join(DATA, "soalan-s3p1.csv"),
        ["set", "no", "aras", "soalan", "A", "B", "C", "D", "jawapan"],
        s3p1,
    )
    missing = [q["no"] for q in s3p1 if not q["jawapan"]]
    if missing:
        print("  AMARAN: soalan tanpa jawapan:", missing, file=sys.stderr)

    print("S3 Pusingan 2 (rebutan):")
    utama, cadangan = parse_rebutan(read_paragraphs(S3P2_DOCX))
    write_csv(
        os.path.join(DATA, "soalan-rebutan.csv"),
        ["no", "topik", "soalan", "jawapan"],
        utama,
    )
    if cadangan:
        write_csv(
            os.path.join(DATA, "soalan-rebutan-cadangan.csv"),
            ["no", "topik", "soalan", "jawapan"],
            cadangan,
        )

    # Templat peserta (36 = 12 daerah x 3)
    peserta = os.path.join(DATA, "peserta-template.csv")
    if not os.path.exists(peserta):
        with open(peserta, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["daerah", "ic", "nama"])
        print("Templat peserta:")
        print("  ->", os.path.relpath(peserta, ROOT), "( isi 36 baris )")
    return 0


if __name__ == "__main__":
    sys.exit(main())
