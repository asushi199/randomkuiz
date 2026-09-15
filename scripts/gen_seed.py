#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Jana web/supabase/seed.sql daripada CSV dalam data/.

Guna: python scripts/gen_seed.py
"""
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "supabase", "seed.sql")


def q(v):
    """Petik nilai SQL (escape apostrof)."""
    if v is None:
        return "null"
    s = str(v).strip()
    if s == "":
        return "null"
    return "'" + s.replace("'", "''") + "'"


def rows(name):
    with open(os.path.join(DATA, name), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    out = []
    out.append("-- Dijana automatik oleh scripts/gen_seed.py — JANGAN edit tangan.")
    out.append("-- Jalankan selepas schema.sql dalam Supabase SQL Editor.\n")

    # soalan (S1/S2)
    out.append("truncate soalan;")
    for r in rows("questions.csv"):
        out.append(
            "insert into soalan (id,topik,aras,soalan,a,b,c,d,jawapan) values ("
            + ",".join([
                q(r["id"]), q(r["topik"].upper()), q(r["aras"].lower()),
                q(r["soalan"]), q(r["A"]), q(r["B"]), q(r["C"]), q(r["D"]),
                q(r["jawapan"].upper()),
            ]) + ");"
        )

    # soalan_s3p1
    out.append("\ntruncate soalan_s3p1;")
    for r in rows("soalan-s3p1.csv"):
        out.append(
            "insert into soalan_s3p1 (set_no,no,aras,soalan,a,b,c,d,jawapan) values ("
            + ",".join([
                r["set"], r["no"], q(r["aras"].lower()), q(r["soalan"]),
                q(r["A"]), q(r["B"]), q(r["C"]), q(r["D"]), q(r["jawapan"].upper()),
            ]) + ");"
        )

    # soalan_rebutan (12 soalan, dengan pilihan A-D)
    out.append("\ntruncate soalan_rebutan;")
    for r in rows("soalan-rebutan.csv"):
        out.append(
            "insert into soalan_rebutan (no,topik,aras,soalan,a,b,c,d,jawapan) values ("
            + ",".join([
                r["no"], q(r["topik"]), q(r.get("aras", "")), q(r["soalan"]),
                q(r["A"]), q(r["B"]), q(r["C"]), q(r["D"]), q(r["jawapan"].upper()),
            ]) + ");"
        )

    # daerah
    out.append("\ntruncate daerah;")
    for i, r in enumerate(rows("daerah-perak.csv"), start=1):
        out.append(
            "insert into daerah (kod,nama,urutan) values ("
            + ",".join([q(r["kod"]), q(r["nama"]), str(i)]) + ");"
        )

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    print("Ditulis:", os.path.relpath(OUT, ROOT), "(", len(out), "baris )")


if __name__ == "__main__":
    main()
