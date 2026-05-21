(function () {
  "use strict";

  const API_RETRIES = 2;
  const TOPIK_NAMA = {
    AKIDAH: "Aqidah",
    ALQURAN: "Al-Quran",
    JAWI: "Jawi",
    SIRAH: "Sirah",
    HADIS: "Hadis",
    IBADAH: "Ibadah",
    ADAB: "Adab",
  };

  const $ = (sel) => document.querySelector(sel);

  function labelTopik(kod) {
    return TOPIK_NAMA[kod] || kod || "-";
  }

  function labelAras(aras) {
    if (!aras) return "-";
    return aras.charAt(0).toUpperCase() + aras.slice(1);
  }

  function formatRujukanBank(item) {
    const id = item.id || "-";
    const topik = labelTopik(item.topik);
    const aras = labelAras(item.aras);
    return "Rujukan bank: " + id + " (" + topik + ", " + aras + ")";
  }

  function getApiUrl() {
    const cfg = window.EXAM_CONFIG || {};
    return (cfg.API_URL || "").trim();
  }

  function showError(message) {
    const el = $("#admin-error");
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  function hideViews() {
    const ranking = $("#view-admin-ranking");
    const result = $("#view-admin-result");
    if (ranking) ranking.hidden = true;
    if (result) result.hidden = true;
  }

  async function apiCall(action, payload, retriesLeft) {
    const url = getApiUrl();
    if (!url) {
      throw new Error("Perkhidmatan tidak tersedia.");
    }
    const left = retriesLeft != null ? retriesLeft : API_RETRIES;
    const body = JSON.stringify(Object.assign({ action: action }, payload));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Ralat sambungan. Sila cuba lagi.");
      }
    } catch (err) {
      if (left > 0) {
        await new Promise((r) => setTimeout(r, 800));
        return apiCall(action, payload, left - 1);
      }
      throw err;
    }
  }

  function renderRanking(data) {
    const tbody = $("#ranking-body");
    const countEl = $("#ranking-count");
    if (!tbody) return;

    tbody.innerHTML = "";
    const list = data.ranking || [];

    if (countEl) {
      countEl.textContent =
        list.length + " peserta telah menghantar jawapan";
    }

    if (!list.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "Tiada rekod keputusan lagi.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      list.forEach((row) => {
        const tr = document.createElement("tr");
        if (row.kedudukan <= 3) {
          tr.className = "rank-top";
        }
        const cells = [
          row.kedudukan,
          row.nama || "-",
          row.ic || "-",
          row.betul + " / " + row.jumlah,
          row.skor + "%",
          row.masa_hantar || "-",
        ];
        cells.forEach((text) => {
          const td = document.createElement("td");
          td.textContent = text;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    $("#view-admin-ranking").hidden = false;
  }

  function renderAdminResult(data) {
    $("#admin-nama").textContent = data.nama || "-";
    $("#admin-ic").textContent = data.ic || "-";
    const masaEl = $("#admin-masa");
    if (masaEl) masaEl.textContent = data.masa_hantar || "-";
    $("#admin-skor").textContent = data.skor;
    $("#admin-betul").textContent = data.betul;
    $("#admin-jumlah").textContent = data.jumlah;
    $("#admin-salah").textContent =
      data.salah != null ? data.salah : data.jumlah - data.betul;

    const ul = $("#admin-details");
    ul.innerHTML = "";
    (data.butiran || []).forEach((item) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "tag " + (item.betul ? "tag-betul" : "tag-salah");
      tag.textContent = item.betul ? "Betul" : "Salah";
      li.appendChild(tag);
      const ref = document.createElement("span");
      ref.className = "soalan-rujukan";
      ref.textContent = formatRujukanBank(item);
      li.appendChild(ref);
      li.appendChild(
        document.createTextNode(
          " — Paparan " +
            item.nombor +
            ": " +
            (item.soalan || "").slice(0, 120) +
            (item.soalan && item.soalan.length > 120 ? "…" : "") +
            " — Jawapan peserta: " +
            item.jawapan_pelajar +
            " | Jawapan betul: " +
            item.jawapan_betul
        )
      );
      ul.appendChild(li);
    });

    $("#view-admin-result").hidden = false;
  }

  async function handleAdminSearch(pin, ic) {
    const btn = $("#btn-admin");
    const wait = $("#admin-wait");
    btn.disabled = true;
    wait.hidden = false;
    showError("");
    hideViews();

    try {
      const payload = { pin: pin };
      if (ic) {
        payload.ic = ic;
      }
      const data = await apiCall("adminReview", payload);
      if (!data.ok) {
        showError(data.ralat || "Gagal mendapatkan rekod.");
        return;
      }
      if (data.mod === "ranking" || !ic) {
        renderRanking(data);
      } else {
        renderAdminResult(data);
      }
    } catch (err) {
      showError(err.message || "Ralat rangkaian.");
    } finally {
      btn.disabled = false;
      wait.hidden = true;
    }
  }

  function init() {
    if (!getApiUrl()) {
      $("#config-warning").hidden = false;
    }

    $("#form-admin").addEventListener("submit", (e) => {
      e.preventDefault();
      const pin = $("#pin").value.trim();
      const ic = $("#ic-admin").value.trim();
      if (!pin) {
        showError("Sila masukkan PIN pentadbir.");
        return;
      }
      handleAdminSearch(pin, ic);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
