(function () {
  "use strict";

  const STORAGE = {
    ic: "exam_ic", nama: "exam_nama", daerah: "exam_daerah",
    attempt: "exam_attempt_id", batas: "exam_batas_ms", peringkat: "exam_peringkat",
    p1idx: "exam_p1_index", p1ans: "exam_p1_answers",
  };
  const API_MAX_RETRIES = 6;
  const MSJ_GAGAL =
    "Gagal menyambung selepas beberapa cubaan. Sila angkat tangan dan maklumkan pengawas.";

  const $ = (s) => document.querySelector(s);

  let countdownTimer = null;
  let pantasTimer = null;
  let state = {
    peringkat: "", ic: "", nama: "", daerah: "",
    attemptId: "", soalan: [], batasMs: 0,
    // S3P1
    saatSesoalan: 20, mataSesoalan: 2, p1Index: 0, p1Answers: {},
  };

  function getApiUrl() {
    const cfg = window.EXAM_CONFIG || {};
    return (cfg.API_URL || "").trim();
  }
  function showError(el, msg) { if (el) { el.textContent = msg; el.hidden = !msg; } }
  function showWait(el, on, msg) { if (el) { if (msg) el.textContent = msg; el.hidden = !on; } }

  function clearTimers() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (pantasTimer) { clearInterval(pantasTimer); pantasTimer = null; }
  }

  function setView(name) {
    ["login", "exam", "pantas", "thanks", "tutup"].forEach((v) => {
      const el = $("#view-" + v);
      if (el) el.hidden = v !== name;
    });
    if (name !== "exam") { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
    if (name !== "pantas") { if (pantasTimer) { clearInterval(pantasTimer); pantasTimer = null; } }
  }

  function showThanks(mesej) {
    const msgEl = $("#thanks-message");
    if (msgEl) msgEl.textContent = mesej ||
      "Terima kasih. Jawapan anda telah direkodkan. Keputusan akan diumumkan oleh pihak pengurusan.";
    setView("thanks");
  }

  // ---------- API ----------
  function retryDelay(i) { return 1500 + i * 800 + Math.floor(Math.random() * 400); }
  async function apiCall(action, payload, retriesLeft, onStatus) {
    const url = getApiUrl();
    if (!url) throw new Error("Perkhidmatan tidak tersedia. Sila hubungi pentadbir.");
    const left = retriesLeft != null ? retriesLeft : API_MAX_RETRIES;
    const attemptNum = API_MAX_RETRIES - left + 1;
    if (onStatus && attemptNum > 1) onStatus(attemptNum, API_MAX_RETRIES);
    const body = JSON.stringify(Object.assign({ action: action }, payload));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
      });
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (!data.ok && data.cuba_lagi) throw new Error("Sila tunggu");
        return data;
      } catch (parseErr) {
        if (parseErr.message === "Sila tunggu") throw parseErr;
        throw new Error("Ralat sambungan. Sila cuba lagi sebentar.");
      }
    } catch (err) {
      if (left > 0) {
        await new Promise((r) => setTimeout(r, retryDelay(attemptNum)));
        return apiCall(action, payload, left - 1, onStatus);
      }
      throw new Error(MSJ_GAGAL);
    }
  }

  // ---------- Session ----------
  function saveSession() {
    sessionStorage.setItem(STORAGE.ic, state.ic);
    sessionStorage.setItem(STORAGE.nama, state.nama);
    sessionStorage.setItem(STORAGE.daerah, state.daerah);
    sessionStorage.setItem(STORAGE.attempt, state.attemptId);
    sessionStorage.setItem(STORAGE.peringkat, state.peringkat);
    if (state.batasMs) sessionStorage.setItem(STORAGE.batas, String(state.batasMs));
  }
  function loadSession() {
    state.ic = sessionStorage.getItem(STORAGE.ic) || "";
    state.nama = sessionStorage.getItem(STORAGE.nama) || "";
    state.daerah = sessionStorage.getItem(STORAGE.daerah) || "";
    state.attemptId = sessionStorage.getItem(STORAGE.attempt) || "";
    state.peringkat = sessionStorage.getItem(STORAGE.peringkat) || "";
    const b = sessionStorage.getItem(STORAGE.batas);
    state.batasMs = b ? parseInt(b, 10) : 0;
  }
  function clearSession() {
    Object.values(STORAGE).forEach((k) => sessionStorage.removeItem(k));
  }

  // ---------- Daerah ----------
  function getUrlDaerah() {
    const p = new URLSearchParams(window.location.search);
    return (p.get("daerah") || "").trim().toUpperCase();
  }
  function populateDaerah(list) {
    const sel = $("#daerah");
    if (!sel || sel.options.length > 1) return;
    (list || []).forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.kod; opt.textContent = d.nama;
      sel.appendChild(opt);
    });
    const kod = getUrlDaerah();
    if (kod) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === kod) { sel.value = kod; sel.disabled = true; break; }
      }
    }
  }

  // ---------- S1/S2 exam ----------
  function formatCountdown(ms) {
    if (ms <= 0) return "Masa telah tamat.";
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), sec = s % 60;
    return "Baki masa: " + m + " min " + (sec < 10 ? "0" : "") + sec + " saat";
  }
  function startCountdown(batasMs) {
    const el = $("#meta-countdown");
    if (!el || !batasMs) return;
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
      const left = batasMs - Date.now();
      el.textContent = formatCountdown(left);
      if (left <= 0) {
        el.classList.add("countdown-expired");
        clearInterval(countdownTimer); countdownTimer = null;
        showError($("#exam-error"),
          "Masa kuiz 1 jam telah tamat. Sila hantar jawapan sekarang, atau hubungi pengawas.");
      }
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
  function applyTiming(data) {
    state.batasMs = data.batas_masa_ms || 0;
    const mb = $("#meta-batas");
    if (mb) mb.textContent = data.batas_masa_label || "-";
    if (state.batasMs) { sessionStorage.setItem(STORAGE.batas, String(state.batasMs)); startCountdown(state.batasMs); }
  }
  function renderExam(soalan) {
    const list = $("#questions-list");
    list.innerHTML = "";
    soalan.forEach((q, index) => {
      const card = document.createElement("div");
      card.className = "question-card";
      const title = document.createElement("h3");
      title.textContent = "Soalan " + (index + 1) + " / " + soalan.length;
      card.appendChild(title);
      const stem = document.createElement("p");
      stem.className = "q-stem";
      stem.textContent = q.soalan;
      card.appendChild(stem);
      ["A", "B", "C", "D"].forEach((letter) => {
        const label = document.createElement("label");
        label.className = "option";
        const input = document.createElement("input");
        input.type = "radio"; input.name = "q_" + q.id; input.value = letter; input.required = true;
        const span = document.createElement("span");
        span.textContent = letter + ". " + (q[letter] || "");
        label.appendChild(input); label.appendChild(span);
        card.appendChild(label);
      });
      list.appendChild(card);
    });
  }
  function collectExamAnswers() {
    const jawapan = {};
    state.soalan.forEach((q) => {
      const sel = document.querySelector('input[name="q_' + q.id + '"]:checked');
      if (sel) jawapan[q.id] = sel.value;
    });
    return jawapan;
  }
  function allAnswered() {
    return state.soalan.every((q) => document.querySelector('input[name="q_' + q.id + '"]:checked'));
  }

  // ---------- S3P1 pantas (20 saat/soalan) ----------
  function saveP1Progress() {
    sessionStorage.setItem(STORAGE.p1idx, String(state.p1Index));
    sessionStorage.setItem(STORAGE.p1ans, JSON.stringify(state.p1Answers));
  }
  function startPantas(resume) {
    $("#pantas-pasukan").textContent =
      state.nama + (state.daerahNama ? " — " + state.daerahNama : "");
    if (resume) {
      const idx = parseInt(sessionStorage.getItem(STORAGE.p1idx) || "0", 10);
      try { state.p1Answers = JSON.parse(sessionStorage.getItem(STORAGE.p1ans) || "{}"); }
      catch (e) { state.p1Answers = {}; }
      state.p1Index = isNaN(idx) ? 0 : idx;
    } else {
      state.p1Index = 0; state.p1Answers = {};
    }
    setView("pantas");
    if (state.p1Index >= state.soalan.length) { submitPantas(); return; }
    renderPantasQuestion();
  }
  function renderPantasQuestion() {
    if (pantasTimer) { clearInterval(pantasTimer); pantasTimer = null; }
    const idx = state.p1Index;
    const q = state.soalan[idx];
    if (!q) { submitPantas(); return; }
    $("#pantas-progress").textContent = "Soalan " + (idx + 1) + " / " + state.soalan.length;
    $("#pantas-question").textContent = q.soalan;

    const optWrap = $("#pantas-options");
    optWrap.innerHTML = "";
    let locked = false;
    ["A", "B", "C", "D"].forEach((letter) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pantas-opt";
      btn.innerHTML = '<span class="opt-letter">' + letter + "</span> " +
        escapeHtml(q[letter] || "");
      btn.addEventListener("click", () => {
        if (locked) return;
        locked = true;
        state.p1Answers[q.id] = letter;
        btn.classList.add("chosen");
        advancePantas();
      });
      optWrap.appendChild(btn);
    });

    // Timer 20s
    let left = state.saatSesoalan;
    const bar = $("#timer-bar"), txt = $("#timer-text");
    txt.textContent = String(left);
    bar.style.transition = "none";
    bar.style.width = "100%";
    // force reflow then animate
    void bar.offsetWidth;
    bar.style.transition = "width " + left + "s linear";
    bar.style.width = "0%";
    bar.classList.remove("timer-low");
    pantasTimer = setInterval(() => {
      left -= 1;
      txt.textContent = String(Math.max(0, left));
      if (left <= 5) bar.classList.add("timer-low");
      if (left <= 0) {
        clearInterval(pantasTimer); pantasTimer = null;
        if (!locked) { locked = true; advancePantas(); } // tiada jawapan = salah
      }
    }, 1000);
  }
  function advancePantas() {
    if (pantasTimer) { clearInterval(pantasTimer); pantasTimer = null; }
    state.p1Index += 1;
    saveP1Progress();
    if (state.p1Index >= state.soalan.length) {
      setTimeout(submitPantas, 350);
    } else {
      setTimeout(renderPantasQuestion, 350);
    }
  }
  async function submitPantas() {
    if (pantasTimer) { clearInterval(pantasTimer); pantasTimer = null; }
    showWait($("#pantas-wait"), true, "Menghantar jawapan pasukan…");
    try {
      const data = await apiCall("submitExam", {
        ic: state.ic, attempt_id: state.attemptId, jawapan: state.p1Answers,
      }, undefined, function () { showWait($("#pantas-wait"), true, "Menghantar… sila tunggu."); });
      if (!data.ok && !data.sudah_hantar) {
        showWait($("#pantas-wait"), true, data.ralat || "Gagal menghantar. Sila maklumkan pengawas.");
        return;
      }
      sessionStorage.removeItem(STORAGE.p1idx);
      sessionStorage.removeItem(STORAGE.p1ans);
      showThanks(data.mesej_terima_kasih);
    } catch (err) {
      showWait($("#pantas-wait"), true, err.message || MSJ_GAGAL);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Mula & hantar ----------
  async function handleStart(ic, nama, daerah) {
    const btn = $("#btn-start");
    btn.disabled = true;
    showError($("#login-error"), "");
    showWait($("#login-wait"), true, "Sistem sedang menyediakan soalan. Sila tunggu 10–30 saat.");
    try {
      const data = await apiCall("startExam", { ic, nama, daerah }, undefined,
        function () { showWait($("#login-wait"), true, "Menyediakan soalan… sila tunggu."); });
      if (!data.ok) {
        if (data.sudah_hantar) { showThanks(data.mesej_terima_kasih); return; }
        showError($("#login-error"), data.ralat || "Gagal memulakan peperiksaan.");
        return;
      }
      state.peringkat = data.peringkat || "";
      state.ic = ic;
      state.nama = data.nama || nama;
      state.daerah = data.daerah || daerah;
      state.daerahNama = daerahNamaFromSelect(state.daerah);
      state.attemptId = data.attempt_id;
      state.soalan = data.soalan || [];
      saveSession();

      if (state.peringkat === "S3P1") {
        state.saatSesoalan = data.saat_sesoalan || 20;
        state.mataSesoalan = data.mata_sesoalan || 2;
        startPantas(!!data.sambungan && hasSavedProgress());
      } else {
        $("#meta-nama").textContent = state.nama;
        applyTiming(data);
        renderExam(state.soalan);
        setView("exam");
      }
    } catch (err) {
      showError($("#login-error"), err.message || MSJ_GAGAL);
    } finally {
      btn.disabled = false;
      showWait($("#login-wait"), false);
    }
  }
  function hasSavedProgress() {
    return sessionStorage.getItem(STORAGE.p1idx) != null;
  }
  function daerahNamaFromSelect(kod) {
    const sel = $("#daerah");
    if (!sel) return "";
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === kod) return sel.options[i].textContent;
    }
    return "";
  }

  async function handleSubmitExam() {
    const btn = $("#btn-submit");
    if (!allAnswered()) { showError($("#exam-error"), "Sila jawab semua soalan sebelum menghantar."); return; }
    showError($("#exam-error"), "");
    btn.disabled = true;
    showWait($("#exam-wait"), true, "Sedang menghantar jawapan. Sila tunggu…");
    try {
      const data = await apiCall("submitExam",
        { ic: state.ic, attempt_id: state.attemptId, jawapan: collectExamAnswers() },
        undefined, function () { showWait($("#exam-wait"), true, "Menghantar… sila tunggu 10–30 saat."); });
      if (!data.ok) {
        if (data.sudah_hantar) { showThanks(data.mesej_terima_kasih); return; }
        showError($("#exam-error"), data.ralat || "Gagal menghantar jawapan.");
        return;
      }
      clearSession();
      showThanks(data.mesej_terima_kasih);
    } catch (err) {
      showError($("#exam-error"), err.message || MSJ_GAGAL);
    } finally {
      btn.disabled = false;
      showWait($("#exam-wait"), false);
    }
  }

  // ---------- Init ----------
  async function init() {
    if (!getApiUrl()) { $("#config-warning").hidden = false; }

    // Borang
    const formLogin = $("#form-login");
    if (formLogin) formLogin.addEventListener("submit", (e) => {
      e.preventDefault();
      const daerah = ($("#daerah") && $("#daerah").value) || "";
      const ic = $("#ic").value.trim();
      const nama = $("#nama").value.trim();
      if (!daerah) { showError($("#login-error"), "Sila pilih daerah."); return; }
      if (!ic || !nama) { showError($("#login-error"), "Sila isi IC dan nama penuh."); return; }
      handleStart(ic, nama, daerah);
    });
    const formExam = $("#form-exam");
    if (formExam) formExam.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!confirm("Adakah anda pasti mahu menghantar jawapan? Tidak boleh diubah selepas ini.")) return;
      handleSubmitExam();
    });
    const btnBack = $("#btn-back-login");
    if (btnBack) btnBack.addEventListener("click", () => { clearSession(); location.reload(); });
    const btnReload = $("#btn-muat-semula");
    if (btnReload) btnReload.addEventListener("click", () => location.reload());

    if (!getApiUrl()) return;

    // Dapatkan peringkat aktif + senarai daerah
    let init;
    try { init = await apiCall("getInit", {}); }
    catch (e) { $("#config-warning").hidden = false; return; }
    if (!init || !init.ok) { $("#config-warning").hidden = false; return; }

    populateDaerah(init.daerah);

    const banner = $("#peringkat-banner");
    if (init.dibuka) {
      if (banner) { banner.textContent = init.peringkat_label; banner.hidden = false; }
      // Cuba sambung sesi sedia ada
      const resumed = await tryResume(init.peringkat_aktif);
      if (!resumed) setView("login");
    } else {
      if (banner) banner.hidden = true;
      $("#tutup-tajuk").textContent =
        init.peringkat_aktif === "TUTUP" ? "Peperiksaan Belum Dibuka" : "Peringkat ini dikendalikan di pentas";
      $("#tutup-mesej").textContent =
        init.peringkat_aktif === "TUTUP"
          ? "Sila tunggu arahan pengawas. Muat semula apabila diminta."
          : "Peringkat semasa (" + (init.peringkat_label || "") + ") tidak memerlukan jawapan dalam talian.";
      setView("tutup");
    }
  }

  async function tryResume(peringkatAktif) {
    loadSession();
    if (!state.ic || state.peringkat !== peringkatAktif) return false;
    try {
      const r = await apiCall("getResult", { ic: state.ic, daerah: state.daerah });
      if (r.ok && r.sudah_hantar) { showThanks(r.mesej_terima_kasih); return true; }
    } catch (e) { /* teruskan */ }
    if (!state.attemptId) return false;
    // Sambung dengan memanggil startExam semula
    try {
      const data = await apiCall("startExam",
        { ic: state.ic, nama: state.nama || "Peserta", daerah: state.daerah });
      if (!data.ok) return false;
      state.peringkat = data.peringkat;
      state.attemptId = data.attempt_id;
      state.soalan = data.soalan || [];
      state.daerahNama = daerahNamaFromSelect(state.daerah);
      if (data.peringkat === "S3P1") {
        state.saatSesoalan = data.saat_sesoalan || 20;
        startPantas(hasSavedProgress());
      } else {
        $("#meta-nama").textContent = state.nama;
        applyTiming(data);
        renderExam(state.soalan);
        setView("exam");
      }
      return true;
    } catch (e) { return false; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
