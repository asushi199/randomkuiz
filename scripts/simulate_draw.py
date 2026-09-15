#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Simulasi + ujian enjin cabutan soalan (rujukan untuk port ke Code.gs).

Sahkan:
- Saringan 1 & 2 pakai peraturan cabutan asal (1 topik 8 soalan, lain 7).
- Saringan 2: soalan individu TIDAK berulang dengan Saringan 1 (per IC).
- Tiada soalan berulang dalam satu kertas.
- Cabutan sentiasa 50 soalan.
Jalankan: python scripts/simulate_draw.py
"""
import csv
import random
import sys
from collections import defaultdict

TOPIK_LIST = ["AKIDAH", "ALQURAN", "JAWI", "SIRAH", "HADIS", "IBADAH", "ADAB"]
JUMLAH = 50


def load_bank(path="data/questions.csv"):
    bank = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            qid = (row.get("id") or "").strip()
            if not qid:
                continue
            bank[qid] = {
                "id": qid,
                "topik": row["topik"].strip().upper(),
                "aras": row["aras"].strip().lower(),
            }
    return bank


def draw_paper(bank, exclude=None):
    """Cabut 50 soalan ikut peraturan; kecualikan id dalam `exclude`."""
    exclude = exclude or set()
    topik_lapan = random.choice(TOPIK_LIST)
    ids = []
    for topik in TOPIK_LIST:
        n_ting = 4 if topik == topik_lapan else 3
        sed = [i for i, q in bank.items()
               if q["topik"] == topik and q["aras"] == "sederhana"
               and i not in exclude]
        ting = [i for i, q in bank.items()
                if q["topik"] == topik and q["aras"] == "tinggi"
                and i not in exclude]
        if len(sed) < 4 or len(ting) < n_ting:
            raise ValueError(f"Soalan tidak cukup untuk {topik}")
        random.shuffle(sed)
        random.shuffle(ting)
        ids += sed[:4] + ting[:n_ting]
    if len(ids) != JUMLAH:
        raise ValueError(f"Dijangka {JUMLAH}, dapat {len(ids)}")
    random.shuffle(ids)
    return ids, topik_lapan


def check_rule(bank, ids):
    assert len(ids) == JUMLAH, f"bukan {JUMLAH} soalan"
    assert len(set(ids)) == JUMLAH, "ada soalan berulang dalam kertas"
    by_topik_aras = defaultdict(lambda: defaultdict(int))
    for i in ids:
        by_topik_aras[bank[i]["topik"]][bank[i]["aras"]] += 1
    lapan = [t for t in TOPIK_LIST
             if by_topik_aras[t]["sederhana"] + by_topik_aras[t]["tinggi"] == 8]
    assert len(lapan) == 1, f"sepatutnya 1 topik 8-soalan, dapat {len(lapan)}"
    for t in TOPIK_LIST:
        sed, ting = by_topik_aras[t]["sederhana"], by_topik_aras[t]["tinggi"]
        assert sed == 4, f"{t}: sederhana {sed} != 4"
        assert ting == (4 if t in lapan else 3), f"{t}: tinggi {ting} salah"


def main():
    random.seed()
    bank = load_bank()
    print(f"Bank: {len(bank)} soalan\n")

    # Saringan 1: 36 individu
    served = defaultdict(set)  # ic -> set(id)
    print("Saringan 1 — 36 individu...")
    for p in range(36):
        ic = f"IC{p:02d}"
        ids, _ = draw_paper(bank)
        check_rule(bank, ids)
        served[ic] |= set(ids)
    print("  OK: 36 kertas, semua ikut peraturan\n")

    # Saringan 2: 18 individu (6 pasukan layak x 3), TANPA ulang soalan S1
    print("Saringan 2 — 18 individu, kecuali soalan S1 mereka...")
    for p in range(18):
        ic = f"IC{p:02d}"
        ids, _ = draw_paper(bank, exclude=served[ic])
        check_rule(bank, ids)
        overlap = set(ids) & served[ic]
        assert not overlap, f"{ic}: {len(overlap)} soalan berulang!"
        served[ic] |= set(ids)
    print("  OK: 18 kertas, SIFAR pertindihan dengan Saringan 1\n")

    # Ujian tekanan: bolehkah seorang buat 2 pusingan berturut tanpa ulang?
    worst = max(len(v) for v in served.values())
    print(f"Maksimum soalan unik diterima seorang peserta: {worst} / 100 (2x50)")
    print("SEMUA UJIAN LULUS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
