(function () {
  "use strict";

  const API_RETRIES = 2;
  const $ = (s) => document.querySelector(s);
  const PERINGKAT_LABEL = {
    S1: "Saringan 1", S2: "Saringan 2", S3P1: "Saringan 3 — Pusingan 1",
    S3P2: "Saringan 3 — Pusingan 2 (Rebutan)", S3P3: "Saringan 3 — Pusingan 3",
    TUTUP: "Ditutup",
  };
  const STAGES = ["S1", "S2", "S3P1", "S3P2", "S3P3", "TUTUP"];
  const RANK_STAGES = ["S1", "S2", "S3P1"];

  let pin = "";
  let daerahList = [];
  let curRankPeringkat = "";

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
      activateTab("s1");
    } catch (e) {
      if (isAuto) $("#view-pin").hidden = false;
      else showErr($("#pin-error"), e.message || "Ralat sambungan.");
    } finally { if (btn) btn.disabled = false; }
  }

  function logout() { clearPin(); pin = ""; location.reload(); }

  function renderPanel(state) {
    // Peringkat: rel progres (stage rail)
    setPeringkatSemasa(state.peringkat_aktif);

    // Dropdowns
    const rankSel = $("#rank-peringkat"), revSel = $("#review-peringkat");
    if (!rankSel.options.length) RANK_STAGES.forEach((s) => opt(rankSel, s, PERINGKAT_LABEL[s]));
    if (!revSel.options.length) RANK_STAGES.forEach((s) => opt(revSel, s, PERINGKAT_LABEL[s]));

    // Markah manual: hanya pasukan layak S3P1 (finalis)
    renderManualTeams(state.kelayakan && state.kelayakan.S3P1);
  }

  // Rel progres peringkat (stage rail)
  const STAGE_SHORT = {
    S1: "Saringan 1", S2: "Saringan 2", S3P1: "S3 · Pusingan 1",
    S3P2: "S3 · Pusingan 2", S3P3: "S3 · Pusingan 3", TUTUP: "Ditutup",
  };
  let pendingStage = "";

  function buildStageRail(active) {
    const rail = $("#stage-rail"); if (!rail) return;
    const curIdx = STAGES.indexOf(active);
    rail.innerHTML = "";
    STAGES.forEach((s, i) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "stage-node " + (i < curIdx ? "done" : i === curIdx ? "live" : "upcoming");
      let inner = '<span class="dot"></span><span>' + STAGE_SHORT[s] + "</span>";
      if (i === curIdx) inner += '<span class="live-badge">LANGSUNG</span>';
      node.innerHTML = inner;
      node.addEventListener("click", () => { if (s !== active) askOpen(s); });
      rail.appendChild(node);
    });
  }
  function askOpen(s) {
    pendingStage = s;
    $("#stage-confirm-text").textContent = s === "TUTUP"
      ? "Tutup — tiada peringkat dibuka untuk peserta?"
      : "Buka " + (STAGE_SHORT[s] || s) + " untuk peserta?";
    $("#stage-confirm").hidden = false;
  }

  function setPeringkatSemasa(p) {
    const el = $("#peringkat-semasa");
    el.textContent = PERINGKAT_LABEL[p] || p;
    el.dataset.p = p;
    buildStageRail(p);
  }

  async function setPeringkat(s) {
    const data = await apiCall("adminSetPeringkat", { pin, peringkat: s });
    if (!data.ok) { showOk($("#peringkat-msg"), data.ralat || "Gagal."); return; }
    setPeringkatSemasa(s);
    showOk($("#peringkat-msg"), data.mesej || ("Peringkat: " + PERINGKAT_LABEL[s]));
  }

  // ---------- Tab setiap saringan ----------
  const TAB_PERINGKAT = { s1: "S1", s2: "S2", s3: "S3P1" };
  function activateTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("tab-active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-sec").forEach((s) => {
      s.hidden = (s.dataset.show || "").split(" ").indexOf(tab) < 0;
    });
    const p = TAB_PERINGKAT[tab];
    if (p) {
      const rankSel = $("#rank-peringkat"); if (rankSel) rankSel.value = p;
      const revSel = $("#review-peringkat"); if (revSel) revSel.value = p;
      const title = $("#rank-title"); if (title) title.textContent = "Kedudukan — " + (PERINGKAT_LABEL[p] || p);
      $("#review-result").hidden = true; showErr($("#review-error"), "");
      const ic = $("#review-ic"); if (ic) ic.value = "";
      loadRanking();
    }
    if (tab === "s3") refreshManualTeams();
  }

  // ---------- Kedudukan ----------
  async function loadRanking() {
    const p = $("#rank-peringkat").value;
    curRankPeringkat = p;
    $("#rank-wait").hidden = false;
    ["#rank-pasukan-wrap", "#rank-individu-wrap", "#rank-empty"].forEach((s) => ($(s).hidden = true));
    try {
      const data = await apiCall("adminRanking", { pin, peringkat: p });
      if (!data.ok) { $("#rank-empty").textContent = data.ralat || "Ralat."; $("#rank-empty").hidden = false; return; }
      const pasukan = data.pasukan || [], individu = data.individu || [];
      if (!pasukan.length && !individu.length) { $("#rank-empty").hidden = false; return; }
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
    $("#lock-hint").hidden = !showLock;
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
      const sel = $("#lock-target"); sel.innerHTML = "";
      opt(sel, lockTarget, PERINGKAT_LABEL[lockTarget]);
      $("#btn-lock-auto").textContent = "Tanda " + lockN + " teratas";
      $("#btn-lock-auto").dataset.n = String(lockN);
      const auto = $("#btn-auto-advance");
      auto.textContent = "Auto-kunci " + lockN + " teratas → " + PERINGKAT_LABEL[lockTarget];
      auto.dataset.target = lockTarget;
      auto.dataset.n = String(lockN);
    }
    $("#rank-pasukan-wrap").hidden = false;
  }

  function renderIndividu(list) {
    const tb = $("#table-individu").querySelector("tbody"); tb.innerHTML = "";
    list.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.kedudukan <= 3) tr.className = "rank-top";
      tr.innerHTML = "<td>" + r.kedudukan + "</td><td>" + (r.nama || "-") + "</td>" +
        "<td>" + r.ic + "</td><td>" + (r.nama_daerah || r.daerah || "-") + "</td>" +
        "<td>" + r.betul + "/" + r.jumlah + "</td><td>" + r.skor + "%</td><td>" + (r.tempoh_label || "-") + "</td>";
      tb.appendChild(tr);
    });
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

  // ---------- Init ----------
  function init() {
    if (!getApiUrl()) { $("#config-warning").hidden = false; return; }
    $("#form-pin").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#pin").value.trim(); if (v) login(v); });
    const btnLogout = $("#btn-logout"); if (btnLogout) btnLogout.addEventListener("click", logout);
    $("#stage-confirm-yes").addEventListener("click", async () => {
      if (!pendingStage) return;
      const s = pendingStage; pendingStage = ""; $("#stage-confirm").hidden = true;
      await setPeringkat(s);
    });
    $("#stage-confirm-no").addEventListener("click", () => { pendingStage = ""; $("#stage-confirm").hidden = true; });
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.tab)));
    $("#btn-rank").addEventListener("click", loadRanking);
    $("#btn-auto-advance").addEventListener("click", autoAdvance);
    $("#btn-lock").addEventListener("click", lockKelayakan);
    $("#btn-lock-auto").addEventListener("click", () => {
      const n = Number($("#btn-lock-auto").dataset.n || 0);
      const cbs = Array.from(document.querySelectorAll(".lock-cb"));
      cbs.forEach((c, i) => { c.checked = i < n; });
    });
    $("#btn-review").addEventListener("click", review);
    $("#btn-final").addEventListener("click", final);
    $("#btn-reset").addEventListener("click", reset);
    $("#btn-open-skrin").addEventListener("click", () => window.open("skrin.html", "_blank"));

    // Auto log masuk jika PIN diingati (elak log masuk semula selepas muat semula / buka semula)
    const saved = loadPin();
    if (saved) login(saved, true);
    else $("#view-pin").hidden = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
