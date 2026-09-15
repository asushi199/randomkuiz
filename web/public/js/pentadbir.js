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
  async function login(inputPin) {
    showErr($("#pin-error"), "");
    const btn = $("#btn-pin"); btn.disabled = true;
    try {
      const data = await apiCall("adminState", { pin: inputPin });
      if (!data.ok) { showErr($("#pin-error"), data.ralat || "PIN tidak sah."); return; }
      pin = inputPin;
      daerahList = data.daerah || [];
      renderPanel(data);
      $("#view-pin").hidden = true;
      $("#view-panel").hidden = false;
    } catch (e) {
      showErr($("#pin-error"), e.message || "Ralat sambungan.");
    } finally { btn.disabled = false; }
  }

  function renderPanel(state) {
    // Peringkat semasa + butang
    setPeringkatSemasa(state.peringkat_aktif);
    const wrap = $("#peringkat-buttons"); wrap.innerHTML = "";
    STAGES.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm stage-btn" + (s === state.peringkat_aktif ? " stage-active" : "");
      b.textContent = PERINGKAT_LABEL[s];
      b.addEventListener("click", () => setPeringkat(s));
      wrap.appendChild(b);
    });

    // Dropdowns
    const rankSel = $("#rank-peringkat"), revSel = $("#review-peringkat");
    if (!rankSel.options.length) RANK_STAGES.forEach((s) => opt(rankSel, s, PERINGKAT_LABEL[s]));
    if (!revSel.options.length) RANK_STAGES.forEach((s) => opt(revSel, s, PERINGKAT_LABEL[s]));

    // Markah manual rows (guna finalis S3P1 jika ada, jika tidak semua daerah)
    renderManualRows(state.kelayakan && state.kelayakan.S3P1 && state.kelayakan.S3P1.length
      ? state.kelayakan.S3P1 : daerahList.map((d) => d.kod));
  }

  function setPeringkatSemasa(p) {
    const el = $("#peringkat-semasa");
    el.textContent = PERINGKAT_LABEL[p] || p;
    el.dataset.p = p;
  }

  async function setPeringkat(s) {
    const data = await apiCall("adminSetPeringkat", { pin, peringkat: s });
    if (!data.ok) { showOk($("#peringkat-msg"), data.ralat || "Gagal."); return; }
    setPeringkatSemasa(s);
    document.querySelectorAll(".stage-btn").forEach((b) => {
      b.classList.toggle("stage-active", b.textContent === PERINGKAT_LABEL[s]);
    });
    showOk($("#peringkat-msg"), data.mesej || ("Peringkat: " + PERINGKAT_LABEL[s]));
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
      const tag = document.createElement("span");
      tag.className = "tag " + (it.betul ? "tag-betul" : "tag-salah");
      tag.textContent = it.betul ? "Betul" : "Salah";
      li.appendChild(tag);
      li.appendChild(document.createTextNode(
        " Soalan " + it.nombor + ": " + (it.soalan || "") +
        " — Jawapan peserta: " + it.jawapan_pelajar + " | Betul: " + it.jawapan_betul));
      ul.appendChild(li);
    });
    $("#review-result").hidden = false;
  }

  // ---------- Markah manual S3P3 ----------
  function renderManualRows(kods) {
    const wrap = $("#manual-rows"); wrap.innerHTML = "";
    const val = (kod, c) => Number((wrap.querySelector("." + c + '[data-daerah="' + kod + '"]') || {}).value || 0);
    const refreshTotal = (kod) => {
      const el = wrap.querySelector('.manual-total[data-daerah="' + kod + '"]');
      if (el) el.textContent = "Jumlah: " + (val(kod, "m1") + val(kod, "m2") + val(kod, "m3"));
    };
    kods.forEach((kod) => {
      const row = document.createElement("div");
      row.className = "manual-row";
      row.innerHTML =
        '<span class="manual-daerah">' + daerahNama(kod) + "</span>" +
        '<input type="number" class="manual-input m1" data-daerah="' + kod + '" placeholder="Soalan 1" min="0" step="1">' +
        '<input type="number" class="manual-input m2" data-daerah="' + kod + '" placeholder="Soalan 2" min="0" step="1">' +
        '<input type="number" class="manual-input m3" data-daerah="' + kod + '" placeholder="Soalan 3" min="0" step="1">' +
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
    $("#view-pin").hidden = false;
    $("#form-pin").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#pin").value.trim(); if (v) login(v); });
    $("#btn-rank").addEventListener("click", loadRanking);
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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
