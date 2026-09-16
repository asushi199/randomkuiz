(function () {
  "use strict";

  const API_RETRIES = 2;
  const $ = (s) => document.querySelector(s);
  const PERINGKAT_LABEL = {
    S1: "Saringan 1", S2: "Saringan 2", S3P1: "Saringan 3 — Pusingan 1",
    S3P2: "Saringan 3 — Pusingan 2", S3P3: "Saringan 3 — Pusingan 3",
    TUTUP: "Ditutup",
  };
  const STAGES = ["S1", "S2", "S3P1", "S3P2", "S3P3", "TUTUP"];
  const RANK_STAGES = ["S1", "S2", "S3P1"];

  let pin = "";
  let daerahList = [];
  let curRankPeringkat = "";
  let lastReview = null;   // data semakan individu terakhir (untuk cetak)
  let lastRanking = null;  // { pasukan, individu, peringkat } terakhir (cetak / CSV)
  let individuFilter = ""; // kod daerah untuk tapisan kedudukan individu
  let lastFinal = null;    // senarai kedudukan akhir terakhir (cetak / CSV)

  function getApiUrl() { return ((window.EXAM_CONFIG || {}).API_URL || "").trim(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  async function apiCall(action, payload, left) {
    const url = getApiUrl();
    if (!url) throw new Error("Perkhidmatan tidak tersedia.");
    const n = left != null ? left : API_RETRIES;
    const body = JSON.stringify(Object.assign({ action }, payload));
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body,
      });
      return JSON.parse(await res.text());
    } catch (err) {
      if (n > 0) { await new Promise((r) => setTimeout(r, 800)); return apiCall(action, payload, n - 1); }
      throw new Error("Ralat sambungan. Sila cuba lagi.");
    }
  }

  function showErr(el, msg) { if (el) { el.textContent = msg; el.hidden = !msg; } }
  function showOk(el, msg) { if (el) { el.textContent = msg; el.hidden = !msg; setTimeout(() => { if (el) el.hidden = true; }, 4000); } }
  function opt(sel, value, label) {
    const o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o);
  }
  function daerahNama(kod) {
    const d = daerahList.find((x) => x.kod === kod); return d ? d.nama : kod;
  }

  // ---------- Login ----------
  function savePin(p) { try { localStorage.setItem("admin_pin", p); } catch (e) {} }
  function clearPin() { try { localStorage.removeItem("admin_pin"); } catch (e) {} }
  function loadPin() { try { return localStorage.getItem("admin_pin") || ""; } catch (e) { return ""; } }

  async function login(inputPin, isAuto) {
    showErr($("#pin-error"), "");
    const btn = $("#btn-pin"); if (btn) btn.disabled = true;
    try {
      const data = await apiCall("adminState", { pin: inputPin });
      if (!data.ok) {
        if (isAuto) { clearPin(); $("#view-pin").hidden = false; }
        else showErr($("#pin-error"), data.ralat || "PIN tidak sah.");
        return;
      }
      pin = inputPin;
      savePin(inputPin); // ingat log masuk supaya muat semula / buka semula tidak perlu log masuk lagi
      daerahList = data.daerah || [];
      renderPanel(data);
      $("#view-pin").hidden = true;
      $("#view-panel").hidden = false;
    } catch (e) {
      if (isAuto) $("#view-pin").hidden = false;
      else showErr($("#pin-error"), e.message || "Ralat sambungan.");
    } finally { if (btn) btn.disabled = false; }
  }

  function logout() { clearPin(); pin = ""; location.reload(); }

  function renderPanel(state) {
    const revSel = $("#review-peringkat");
    if (revSel && !revSel.options.length) RANK_STAGES.forEach((s) => opt(revSel, s, PERINGKAT_LABEL[s]));
    setPeringkatSemasa(state.peringkat_aktif);
    renderManualTeams(state.kelayakan && state.kelayakan.S3P1);
  }

  // Rel progres peringkat (stage rail)
  const STAGE_SHORT = {
    S1: "Saringan 1", S2: "Saringan 2", S3P1: "S3 · Pusingan 1",
    S3P2: "S3 · Pusingan 2", S3P3: "S3 · Pusingan 3", TUTUP: "Ditutup",
  };
  let liveStage = "";
  let pendingStage = "";

  function showStageConfirm(open) {
    const box = $("#stage-confirm");
    if (!box) return;
    box.hidden = !open;
    box.classList.toggle("is-open", !!open);
  }

  function buildStageRail() {
    const rail = $("#stage-rail"); if (!rail) return;
    const curIdx = STAGES.indexOf(liveStage);
    rail.innerHTML = "";
    STAGES.forEach((s, i) => {
      const node = document.createElement("button");
      node.type = "button";
      const isLive = s === liveStage;
      const isArmed = s === pendingStage;
      node.className = "stage-node " + (isLive ? "live" : i < curIdx ? "done" : "upcoming") +
        (isArmed ? " armed" : "");
      let inner = '<span class="dot"></span><span>' + STAGE_SHORT[s] + "</span>";
      if (isLive) inner += '<span class="live-badge">LANGSUNG</span>';
      node.innerHTML = inner;
      node.addEventListener("click", () => {
        if (isLive) { if (pendingStage) cancelStageConfirm(); return; }
        if (isArmed) { cancelStageConfirm(); return; }
        askOpen(s);
      });
      rail.appendChild(node);
    });
  }
  function cancelStageConfirm() {
    pendingStage = "";
    showStageConfirm(false);
    buildStageRail();
  }
  function askOpen(s) {
    if (s === liveStage) return;
    pendingStage = s;
    const yes = $("#stage-confirm-yes");
    if (s === "TUTUP") {
      $("#stage-confirm-text").textContent = "Tutup dewan — tiada peringkat dibuka untuk peserta?";
      if (yes) yes.textContent = "Tutup";
    } else {
      $("#stage-confirm-text").textContent = "Buka " + (STAGE_SHORT[s] || s) + " untuk peserta?";
      if (yes) yes.textContent = "Buka";
    }
    showStageConfirm(true);
    buildStageRail();
  }

  function setPeringkatSemasa(p) {
    liveStage = p;
    pendingStage = "";
    showStageConfirm(false);
    const el = $("#peringkat-semasa");
    el.textContent = PERINGKAT_LABEL[p] || p;
    el.dataset.p = p;
    buildStageRail();
    syncRankTabToLive();
  }

  async function setPeringkat(s) {
    const data = await apiCall("adminSetPeringkat", { pin, peringkat: s });
    if (!data.ok) { showOk($("#peringkat-msg"), data.ralat || "Gagal."); return; }
    setPeringkatSemasa(s);
    showOk($("#peringkat-msg"), data.mesej || ("Peringkat: " + PERINGKAT_LABEL[s]));
  }

  // ---------- Tab setiap saringan ----------
  const TAB_PERINGKAT = { s1: "S1", s2: "S2", s3: "S3P1" };
  let s3Round = "S3P1";

  function tabForLiveStage(p) {
    if (p === "S1") return "s1";
    if (p === "S2") return "s2";
    if (p === "S3P1" || p === "S3P2" || p === "S3P3") return "s3";
    return "";
  }

  function syncRankTabToLive() {
    const tab = tabForLiveStage(liveStage) || "s1";
    if (tab === "s3") s3Round = liveStage;
    activateTab(tab);
  }

  function setS3Round(round) {
    s3Round = round;
    document.querySelectorAll(".round-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.round === round));
    const p1 = round === "S3P1", p2 = round === "S3P2", p3 = round === "S3P3";
    const ked = $("#sec-kedudukan"), pan2 = $("#sec-s3p2"), extra = $("#sec-s3extra"), semak = $("#sec-semakan");
    if (ked) ked.hidden = !p1;
    if (pan2) pan2.hidden = !p2;
    if (extra) extra.hidden = !p3;
    if (semak) semak.hidden = !p1;
    if (p1) {
      curRankPeringkat = "S3P1";
      const title = $("#rank-title");
      if (title) title.textContent = "Kedudukan Pusingan 1";
      loadRanking();
    }
  }

  function activateTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("tab-active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-sec").forEach((s) => {
      s.hidden = (s.dataset.show || "").split(" ").indexOf(tab) < 0;
    });
    const rounds = $("#s3-rounds");
    if (rounds) rounds.hidden = tab !== "s3";
    const p = TAB_PERINGKAT[tab];
    if (p) {
      const revSel = $("#review-peringkat"); if (revSel) revSel.value = p;
      $("#review-result").hidden = true; showErr($("#review-error"), "");
      const ic = $("#review-ic"); if (ic) ic.value = "";
    }
    if (tab === "s1" || tab === "s2") {
      curRankPeringkat = TAB_PERINGKAT[tab];
      const title = $("#rank-title");
      if (title) title.textContent = "Kedudukan";
      loadRanking();
    } else if (tab === "s3") {
      setS3Round(s3Round || "S3P1");
      refreshManualTeams();
    }
  }

  // ---------- Kedudukan ----------
  function updateLockCount() {
    const n = document.querySelectorAll(".lock-cb:checked").length;
    const el = $("#lock-count");
    if (el) el.textContent = String(n);
    const lockBtn = $("#btn-lock");
    if (lockBtn) lockBtn.disabled = n === 0;
  }

  async function loadRanking() {
    const p = curRankPeringkat;
    if (!p) return;
    $("#rank-wait").hidden = false;
    ["#rank-pasukan-wrap", "#rank-individu-wrap", "#rank-empty"].forEach((s) => ($(s).hidden = true));
    try {
      const data = await apiCall("adminRanking", { pin, peringkat: p });
      if (!data.ok) { $("#rank-empty").textContent = data.ralat || "Ralat."; $("#rank-empty").hidden = false; return; }
      const pasukan = data.pasukan || [], individu = data.individu || [];
      if (!pasukan.length && !individu.length) { $("#rank-empty").hidden = false; return; }
      lastRanking = { pasukan: pasukan, individu: individu, peringkat: p };
      renderPasukan(pasukan, p);
      renderIndividu(individu);
    } catch (e) {
      $("#rank-empty").textContent = e.message; $("#rank-empty").hidden = false;
    } finally { $("#rank-wait").hidden = true; }
  }

  function renderPasukan(list, peringkat) {
    const lockTarget = peringkat === "S1" ? "S2" : peringkat === "S2" ? "S3P1" : "";
    const lockN = peringkat === "S1" ? 6 : peringkat === "S2" ? 4 : 0;
    const showLock = !!lockTarget;

    document.querySelectorAll(".col-lock").forEach((el) => (el.hidden = !showLock));
    $("#lock-controls").hidden = !showLock;

    const tb = $("#table-pasukan").querySelector("tbody"); tb.innerHTML = "";
    list.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.kedudukan <= lockN) tr.className = "rank-top";
      let cells = "";
      if (showLock) {
        cells += '<td class="col-lock"><input type="checkbox" class="lock-cb" value="' +
          r.daerah + '"' + (r.kedudukan <= lockN ? " checked" : "") + "></td>";
      }
      cells += "<td>" + r.kedudukan + "</td><td>" + (r.nama_daerah || r.daerah) + "</td>" +
        "<td>" + r.bil_ahli + "</td><td>" + r.jumlah_skor + "</td>" +
        "<td>" + r.jumlah_mata + "</td><td>" + (r.tempoh_label || "-") + "</td>";
      tr.innerHTML = cells;
      tb.appendChild(tr);
    });

    if (showLock) {
      const dest = peringkat === "S1" ? "Saringan 2" : "Saringan 3";
      const sel = $("#lock-target"); sel.innerHTML = "";
      opt(sel, lockTarget, PERINGKAT_LABEL[lockTarget]);
      const title = $("#lock-title");
      if (title) title.textContent = "Layak ke " + dest;
      const hint = $("#lock-hint");
      if (hint) hint.textContent = lockN + " pasukan teratas disyorkan. Ubah tanda di jadual jika susunan berbeza.";
      $("#btn-lock-auto").textContent = "Tanda semula " + lockN + " teratas";
      $("#btn-lock-auto").dataset.n = String(lockN);
      const auto = $("#btn-auto-advance");
      auto.textContent = "Kunci " + lockN + " teratas ke " + dest;
      auto.dataset.target = lockTarget;
      auto.dataset.n = String(lockN);
      updateLockCount();
    }
    $("#rank-pasukan-wrap").hidden = false;
  }

  function visibleIndividu() {
    const all = (lastRanking && lastRanking.individu) || [];
    if (!individuFilter) return all;
    return all.filter((r) => r.daerah === individuFilter);
  }

  function fillIndividuFilter(list) {
    const sel = $("#individu-daerah");
    if (!sel) return;
    const prev = sel.value || individuFilter;
    const seen = {};
    const opts = [];
    (list || []).forEach((r) => {
      const kod = r.daerah || "";
      if (!kod || seen[kod]) return;
      seen[kod] = true;
      opts.push({ kod: kod, nama: r.nama_daerah || daerahNama(kod) || kod });
    });
    opts.sort((a, b) => a.nama.localeCompare(b.nama, "ms"));
    sel.innerHTML = "";
    opt(sel, "", "Semua daerah");
    opts.forEach((o) => opt(sel, o.kod, o.nama));
    if (prev && seen[prev]) {
      sel.value = prev;
      individuFilter = prev;
    } else {
      sel.value = "";
      individuFilter = "";
    }
  }

  function paintIndividuRows(list) {
    const shown = individuFilter
      ? (list || []).filter((r) => r.daerah === individuFilter)
      : (list || []);
    const tb = $("#table-individu").querySelector("tbody"); tb.innerHTML = "";
    if (!shown.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="7" class="hint">Tiada peserta untuk daerah ini.</td>';
      tb.appendChild(tr);
    } else {
      shown.forEach((r) => {
        const tr = document.createElement("tr");
        if (r.kedudukan <= 3) tr.className = "rank-top";
        tr.innerHTML = "<td>" + r.kedudukan + "</td><td>" + (r.nama || "-") + "</td>" +
          "<td>" + r.ic + "</td><td>" + (r.nama_daerah || r.daerah || "-") + "</td>" +
          "<td>" + r.betul + "/" + r.jumlah + "</td><td>" + r.skor + "%</td><td>" + (r.tempoh_label || "-") + "</td>";
        tb.appendChild(tr);
      });
    }
  }

  function renderIndividu(list) {
    fillIndividuFilter(list);
    paintIndividuRows(list);
    $("#rank-individu-wrap").hidden = false;
  }

  async function autoAdvance() {
    const btn = $("#btn-auto-advance");
    const target = btn.dataset.target;
    if (!target) return;
    const data = await apiCall("adminAutoLock", { pin, peringkat: target });
    if (!data.ok) { showOk($("#lock-msg"), data.ralat || "Gagal."); return; }
    showOk($("#lock-msg"), (data.mesej || "Dikunci.") + " — " + (data.nama_daerah || []).join(", "));
    const n = Number(btn.dataset.n || 0);
    document.querySelectorAll(".lock-cb").forEach((c, i) => { c.checked = i < n; });
    updateLockCount();
  }

  async function lockKelayakan() {
    const target = $("#lock-target").value;
    const checked = Array.from(document.querySelectorAll(".lock-cb:checked")).map((c) => c.value);
    if (!checked.length) { showOk($("#lock-msg"), "Tiada pasukan ditanda."); return; }
    const data = await apiCall("adminLock", { pin, peringkat: target, daerah_list: checked.join(",") });
    showOk($("#lock-msg"), data.ok ? data.mesej : (data.ralat || "Gagal."));
  }

  // ---------- Semakan individu ----------
  async function review() {
    const ic = $("#review-ic").value.trim();
    const p = $("#review-peringkat").value;
    showErr($("#review-error"), "");
    $("#review-result").hidden = true;
    if (!ic) { showErr($("#review-error"), "Masukkan No. KP."); return; }
    const data = await apiCall("adminReview", { pin, peringkat: p, ic });
    if (!data.ok) { showErr($("#review-error"), data.ralat || "Tiada rekod."); return; }
    lastReview = Object.assign({ peringkat: p }, data);
    $("#review-summary").innerHTML =
      "<strong>" + (data.nama || "-") + "</strong> (" + data.ic + ") — " + (data.nama_daerah || data.daerah) +
      "<br>Betul: " + data.betul + "/" + data.jumlah + " · Skor: " + data.skor + "% · Markah: " + data.mata +
      " · Masa hantar: " + (data.masa_hantar || "-") + " · Tempoh: " + (data.tempoh_label || "-");
    const ul = $("#review-details"); ul.innerHTML = "";
    (data.butiran || []).forEach((it) => {
      const li = document.createElement("li");
      li.className = "review-q";
      let opts = "";
      ["A", "B", "C", "D"].forEach((L) => {
        const isBetul = it.jawapan_betul === L;
        const isPilih = it.jawapan_pelajar === L;
        let cls = "rq-opt";
        if (isBetul) cls += " rq-correct";
        if (isPilih && !isBetul) cls += " rq-wrong";
        let mark = "";
        if (isBetul) mark = ' <span class="rq-mark ok">✓ betul</span>';
        else if (isPilih) mark = ' <span class="rq-mark no">✗ pilihan peserta</span>';
        opts += '<div class="' + cls + '"><b>' + L + ".</b> " + esc(it[L] || "") + mark + "</div>";
      });
      li.innerHTML =
        '<div class="rq-head"><span class="tag ' + (it.betul ? "tag-betul" : "tag-salah") + '">' +
        (it.betul ? "Betul" : "Salah") + "</span> <strong>Soalan " + it.nombor + "</strong>" +
        '<span class="rq-ref">' + esc(it.topik || "") + (it.aras ? " · " + esc(it.aras) : "") + "</span></div>" +
        '<div class="rq-stem">' + esc(it.soalan || "") + "</div>" +
        '<div class="rq-opts">' + opts + "</div>";
      ul.appendChild(li);
    });
    $("#review-result").hidden = false;
  }

  // ---------- Markah manual S3P3 ----------
  // Papar hanya pasukan LAYAK S3P1 (finalis). Muat semula kelayakan terkini.
  async function refreshManualTeams() {
    try {
      const d = await apiCall("adminState", { pin });
      if (d && d.ok) renderManualTeams(d.kelayakan && d.kelayakan.S3P1);
    } catch (e) { /* biar kekal */ }
  }

  function renderManualTeams(list) {
    const kods = list || [];
    const wrap = $("#manual-rows"); wrap.innerHTML = "";
    const note = $("#manual-note");
    if (!kods.length) { if (note) note.hidden = false; return; }
    if (note) note.hidden = true;
    const val = (kod, c) => Number((wrap.querySelector("." + c + '[data-daerah="' + kod + '"]') || {}).value || 0);
    const refreshTotal = (kod) => {
      const el = wrap.querySelector('.manual-total[data-daerah="' + kod + '"]');
      if (el) el.textContent = "Jumlah: " + (val(kod, "m1") + val(kod, "m2") + val(kod, "m3"));
    };
    const field = (kod, c, n) =>
      '<label class="ml-field"><span class="ml-lbl">Soalan ' + n + '</span>' +
      '<input type="number" class="manual-input ' + c + '" data-daerah="' + kod + '" placeholder="markah" min="0" step="1"></label>';
    kods.forEach((kod) => {
      const row = document.createElement("div");
      row.className = "manual-row";
      row.innerHTML =
        '<span class="manual-daerah">' + daerahNama(kod) + "</span>" +
        '<div class="ml-fields">' + field(kod, "m1", 1) + field(kod, "m2", 2) + field(kod, "m3", 3) + "</div>" +
        '<span class="manual-total" data-daerah="' + kod + '">Jumlah: 0</span>' +
        '<button type="button" class="btn btn-secondary btn-sm manual-save" data-daerah="' + kod + '">Simpan</button>';
      wrap.appendChild(row);
    });
    wrap.querySelectorAll(".manual-input").forEach((inp) => {
      inp.addEventListener("input", () => refreshTotal(inp.dataset.daerah));
    });
    wrap.querySelectorAll(".manual-save").forEach((b) => {
      b.addEventListener("click", async () => {
        const kod = b.dataset.daerah;
        const data = await apiCall("adminSetManual", {
          pin, peringkat: "S3P3", daerah: kod,
          mata1: val(kod, "m1"), mata2: val(kod, "m2"), mata3: val(kod, "m3"),
        });
        showOk($("#manual-msg"), data.ok ? data.mesej : (data.ralat || "Gagal."));
      });
    });
  }

  async function final() {
    const data = await apiCall("adminFinal", { pin });
    if (!data.ok) { showOk($("#manual-msg"), data.ralat || "Gagal."); return; }
    lastFinal = data.kedudukan || [];
    const tb = $("#table-final").querySelector("tbody"); tb.innerHTML = "";
    (data.kedudukan || []).forEach((r) => {
      const tr = document.createElement("tr");
      if (r.kedudukan <= 3) tr.className = "rank-top";
      tr.innerHTML = "<td>" + r.kedudukan + "</td><td>" + (r.nama_daerah || r.daerah) + "</td>" +
        "<td>" + r.s3p1 + "</td><td>" + r.s3p2 + "</td><td>" + r.s3p3 + "</td><td><strong>" + r.jumlah + "</strong></td>";
      tb.appendChild(tr);
    });
    $("#final-wrap").hidden = false;
  }

  async function reset() {
    if (!confirm("Kosongkan SEMUA rekod peperiksaan (percubaan, keputusan, rebutan, markah, kelayakan)? Tindakan ini tidak boleh dibatalkan.")) return;
    const data = await apiCall("adminReset", { pin, skop: "semua" });
    showOk($("#reset-msg"), data.ok ? data.mesej : (data.ralat || "Gagal."));
  }

  // ---------- Cetak & Muat turun CSV ----------
  const COMP_NAME = "Kuiz Ilmuan Cilik";

  function tarikhKini() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function masaKini() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return tarikhKini() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // --- CSV ---
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(filename, rows) {
    // BOM supaya Excel baca UTF-8 (nama Melayu/Arab) dengan betul
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // --- Cetak (buka tetingkap bersih) ---
  const PRINT_CSS =
    '*{box-sizing:border-box}' +
    'body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1a1a1a;margin:24px;font-size:13px;line-height:1.5}' +
    '.p-head{border-bottom:3px solid #1565c0;padding-bottom:10px;margin-bottom:14px}' +
    '.p-title{font-size:20px;font-weight:800;margin:0}' +
    '.p-sub{font-size:13px;color:#5c6670;margin:3px 0 0}' +
    '.p-meta{display:flex;flex-wrap:wrap;gap:5px 22px;margin:12px 0 16px;font-size:12.5px}' +
    '.p-meta b{font-weight:700}' +
    '.p-summary{background:#f4f6f8;border:1px solid #dde3ea;border-radius:8px;padding:10px 12px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:6px 22px;font-size:12.5px}' +
    '.p-q{border:1px solid #dde3ea;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}' +
    '.p-qhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
    '.p-tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px}' +
    '.p-tag.ok{background:#c8e6c9;color:#2e7d32}.p-tag.no{background:#ffcdd2;color:#c62828}' +
    '.p-ref{margin-left:auto;color:#5c6670;font-size:11px;text-transform:capitalize}' +
    '.p-stem{font-weight:700;margin-bottom:6px}' +
    '.p-opts{display:grid;gap:4px}' +
    '.p-opt{border:1px solid #dde3ea;border-radius:6px;padding:5px 8px;font-size:12.5px}' +
    '.p-opt.p-correct{background:#e8f5e9;border-color:#a5d6a7}.p-opt.p-wrong{background:#ffebee;border-color:#ef9a9a}' +
    '.p-mark{font-size:11px;font-weight:700;margin-left:4px}.p-mark.ok{color:#2e7d32}.p-mark.no{color:#c62828}' +
    '.p-table{width:100%;border-collapse:collapse;font-size:12.5px}' +
    '.p-table th,.p-table td{border:1px solid #cfd6de;padding:6px 9px;text-align:left}' +
    '.p-table th{background:#eef2f6;font-weight:700}.p-table tr:nth-child(even) td{background:#fafbfc}' +
    '.p-foot{margin-top:20px;padding-top:12px;border-top:1px solid #dde3ea;color:#5c6670;font-size:11.5px}' +
    '.p-sign{margin-top:26px;display:flex;gap:40px;flex-wrap:wrap}' +
    '.p-sign>div{flex:1;min-width:180px}' +
    '.p-sign .line{border-top:1px solid #1a1a1a;margin-top:34px;padding-top:4px;font-size:11.5px}' +
    '@media print{body{margin:0}@page{margin:16mm}}';

  // Cetak melalui iframe tersembunyi — tidak bergantung pada pop-up (elak disekat)
  function printHtml(title, bodyHtml) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);
    let cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; setTimeout(() => frame.remove(), 500); };
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html lang="ms"><head><meta charset="utf-8">' +
      "<title>" + esc(title) + "</title><style>" + PRINT_CSS + "</style></head><body>" +
      bodyHtml + "</body></html>"
    );
    doc.close();
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.onafterprint = cleanup;
        frame.contentWindow.print();
      } catch (e) { /* teruskan pembersihan */ }
      setTimeout(cleanup, 60000); // sandaran jika onafterprint tidak dipanggil
    }, 300);
  }

  function printHead(title, sub) {
    return '<div class="p-head"><p class="p-title">' + esc(COMP_NAME) + "</p>" +
      '<p class="p-sub">' + esc(title) + (sub ? " — " + esc(sub) : "") + "</p></div>";
  }
  function printFoot() {
    return '<div class="p-foot">Dicetak: ' + esc(masaKini()) + " · Panel Pentadbir " + esc(COMP_NAME) + "</div>";
  }

  function printReview() {
    if (!lastReview) return;
    const d = lastReview;
    const sum = '<div class="p-summary">' +
      "<span><b>Nama:</b> " + esc(d.nama || "-") + "</span>" +
      "<span><b>No. KP:</b> " + esc(d.ic || "-") + "</span>" +
      "<span><b>Daerah:</b> " + esc(d.nama_daerah || d.daerah || "-") + "</span>" +
      "<span><b>Betul:</b> " + esc(d.betul) + "/" + esc(d.jumlah) + "</span>" +
      "<span><b>Skor:</b> " + esc(d.skor) + "%</span>" +
      "<span><b>Markah:</b> " + esc(d.mata) + "</span>" +
      "<span><b>Masa hantar:</b> " + esc(d.masa_hantar || "-") + "</span>" +
      "<span><b>Tempoh:</b> " + esc(d.tempoh_label || "-") + "</span></div>";
    const qs = (d.butiran || []).map((it) => {
      const opts = ["A", "B", "C", "D"].map((L) => {
        const isB = it.jawapan_betul === L, isP = it.jawapan_pelajar === L;
        let cls = "p-opt";
        if (isB) cls += " p-correct";
        if (isP && !isB) cls += " p-wrong";
        let mark = "";
        if (isB) mark = ' <span class="p-mark ok">&#10003; jawapan betul</span>';
        else if (isP) mark = ' <span class="p-mark no">&#10007; pilihan peserta</span>';
        return '<div class="' + cls + '"><b>' + L + ".</b> " + esc(it[L] || "") + mark + "</div>";
      }).join("");
      return '<div class="p-q"><div class="p-qhead"><span class="p-tag ' + (it.betul ? "ok" : "no") + '">' +
        (it.betul ? "Betul" : "Salah") + '</span><b>Soalan ' + esc(it.nombor) + "</b>" +
        '<span class="p-ref">' + esc(it.topik || "") + (it.aras ? " &middot; " + esc(it.aras) : "") + "</span></div>" +
        '<div class="p-stem">' + esc(it.soalan || "") + "</div>" +
        '<div class="p-opts">' + opts + "</div></div>";
    }).join("");
    const sign = '<div class="p-sign">' +
      '<div><div class="line">Disemak oleh (Pentadbir)</div></div>' +
      '<div><div class="line">Pengesahan peserta / penjaga</div></div></div>';
    printHtml(
      "Semakan Jawapan — " + (d.nama || d.ic || ""),
      printHead("Semakan Jawapan Individu", PERINGKAT_LABEL[d.peringkat] || d.peringkat) +
      sum + qs + sign + printFoot()
    );
  }

  function printTable(title, sub, headers, rows) {
    const thead = "<tr>" + headers.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr>";
    const tbody = rows.map((r) => "<tr>" + r.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("");
    printHtml(title + (sub ? " — " + sub : ""),
      printHead(title, sub) +
      '<table class="p-table"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table>" +
      printFoot());
  }

  const CSV_SPEC = {
    pasukan: {
      title: "Kedudukan Pasukan (Daerah)",
      headers: ["Kedudukan", "Daerah", "Ahli", "Jumlah Skor", "Jumlah Markah", "Masa"],
      rows: () => (lastRanking && lastRanking.pasukan || []).map((r) =>
        [r.kedudukan, r.nama_daerah || r.daerah, r.bil_ahli, r.jumlah_skor, r.jumlah_mata, r.tempoh_label || "-"]),
      stage: () => lastRanking && lastRanking.peringkat,
    },
    individu: {
      title: "Kedudukan Individu",
      headers: ["Kedudukan", "Nama", "No. KP", "Daerah", "Betul", "Jumlah", "Skor (%)", "Masa"],
      rows: () => visibleIndividu().map((r) =>
        [r.kedudukan, r.nama || "-", r.ic, r.nama_daerah || r.daerah || "-", r.betul, r.jumlah, r.skor, r.tempoh_label || "-"]),
      stage: () => lastRanking && lastRanking.peringkat,
      filterLabel: () => individuFilter ? (daerahNama(individuFilter) || individuFilter) : "",
      filterSlug: () => individuFilter ? String(individuFilter).toLowerCase().replace(/[^a-z0-9]+/g, "-") : "",
    },
    final: {
      title: "Kedudukan Akhir",
      headers: ["Kedudukan", "Daerah", "S3P1", "S3P2 Rebutan", "S3P3", "Jumlah"],
      rows: () => (lastFinal || []).map((r) =>
        [r.kedudukan, r.nama_daerah || r.daerah, r.s3p1, r.s3p2, r.s3p3, r.jumlah]),
      stage: () => "S3-AKHIR",
    },
  };

  function handleExport(kind, mode) {
    const spec = CSV_SPEC[kind]; if (!spec) return;
    const rows = spec.rows();
    if (!rows.length) { alert("Tiada data untuk " + spec.title.toLowerCase() + "."); return; }
    const stage = spec.stage() || "";
    const filter = (spec.filterLabel && spec.filterLabel()) || "";
    const sub = [PERINGKAT_LABEL[stage] || stage, filter].filter(Boolean).join(" / ");
    if (mode === "print") {
      printTable(spec.title, sub, spec.headers, rows);
    } else {
      const slug = (spec.filterSlug && spec.filterSlug()) || "";
      downloadCsv(
        spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
        (stage ? "-" + stage : "") + (slug ? "-" + slug : "") + "-" + tarikhKini() + ".csv",
        [spec.headers].concat(rows)
      );
    }
  }

  // ---------- Init ----------
  function init() {
    if (!getApiUrl()) { $("#config-warning").hidden = false; return; }
    $("#form-pin").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#pin").value.trim(); if (v) login(v); });
    const btnLogout = $("#btn-logout"); if (btnLogout) btnLogout.addEventListener("click", logout);
    $("#stage-confirm-yes").addEventListener("click", async () => {
      if (!pendingStage) return;
      const s = pendingStage;
      const yes = $("#stage-confirm-yes");
      const no = $("#stage-confirm-no");
      if (yes) yes.disabled = true;
      if (no) no.disabled = true;
      try { await setPeringkat(s); } finally {
        if (yes) yes.disabled = false;
        if (no) no.disabled = false;
      }
    });
    $("#stage-confirm-no").addEventListener("click", cancelStageConfirm);
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.tab)));
    document.querySelectorAll(".round-btn").forEach((b) => b.addEventListener("click", () => setS3Round(b.dataset.round)));
    const tblPasukan = $("#table-pasukan");
    if (tblPasukan) tblPasukan.addEventListener("change", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("lock-cb")) updateLockCount();
    });
    $("#btn-auto-advance").addEventListener("click", autoAdvance);
    $("#btn-lock").addEventListener("click", lockKelayakan);
    $("#btn-lock-auto").addEventListener("click", () => {
      const n = Number($("#btn-lock-auto").dataset.n || 0);
      const cbs = Array.from(document.querySelectorAll(".lock-cb"));
      cbs.forEach((c, i) => { c.checked = i < n; });
      updateLockCount();
    });
    const selDaerah = $("#individu-daerah");
    if (selDaerah) selDaerah.addEventListener("change", () => {
      individuFilter = selDaerah.value;
      if (lastRanking) paintIndividuRows(lastRanking.individu || []);
    });
    $("#btn-review").addEventListener("click", review);
    $("#btn-final").addEventListener("click", final);

    // Cetak semakan individu (untuk tunjuk kepada peserta)
    const btnRevPrint = $("#btn-review-print");
    if (btnRevPrint) btnRevPrint.addEventListener("click", printReview);
    // Cetak / muat turun CSV untuk jadual kedudukan (delegasi)
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-print],[data-csv]");
      if (!b) return;
      if (b.dataset.print) handleExport(b.dataset.print, "print");
      else if (b.dataset.csv) handleExport(b.dataset.csv, "csv");
    });
    $("#btn-reset").addEventListener("click", reset);
    $("#btn-open-skrin").addEventListener("click", () => window.open("skrin.html?v=2", "_blank"));

    // Auto log masuk jika PIN diingati (elak log masuk semula selepas muat semula / buka semula)
    const saved = loadPin();
    if (saved) login(saved, true);
    else $("#view-pin").hidden = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
