(function () {
  "use strict";

  const STORAGE = {
    ic: "exam_ic", nama: "exam_nama", daerah: "exam_daerah",
    attempt: "exam_attempt_id", batas: "exam_batas_ms", peringkat: "exam_peringkat",
    p1idx: "exam_p1_index", p1ans: "exam_p1_answers", ics: "exam_ics",
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
    ics: [],
  };
  let loginPasukan = false;
  let gunaPeserta = false;      // mod senarai putih: log masuk hanya dengan IC
  let pendingPeserta = null;    // maklumat peserta menunggu pengesahan

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
    if (state.ics && state.ics.length) sessionStorage.setItem(STORAGE.ics, JSON.stringify(state.ics));
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
    try { state.ics = JSON.parse(sessionStorage.getItem(STORAGE.ics) || "[]"); }
    catch (e) { state.ics = []; }
    if (!Array.isArray(state.ics)) state.ics = [];
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

  function normIcInput(v) {
    return String(v || "").replace(/[\s-]/g, "").trim();
  }
  function collectTeamIcs() {
    return ["#ic1", "#ic2", "#ic3"].map((s) => normIcInput($(s) && $(s).value));
  }
  function teamFormReady() {
    const daerah = ($("#daerah") && $("#daerah").value) || "";
    const ics = collectTeamIcs();
    return !!daerah && ics.every((ic) => ic.length >= 6) && new Set(ics).size === 3;
  }
  function syncStartButton() {
    const btn = $("#btn-start");
    if (!btn) return;
    if (loginPasukan) {
      btn.disabled = !teamFormReady();
      btn.title = btn.disabled ? "Sila pilih daerah dan isi tiga IC dahulu." : "";
    } else {
      btn.disabled = false;
      btn.title = "";
    }
  }
  function applyLoginMode(peringkat) {
    loginPasukan = peringkat === "S3P1";
    const whitelistInd = gunaPeserta && !loginPasukan; // S1 dengan senarai putih: IC sahaja
    const ind = $("#login-individu");
    const pas = $("#login-pasukan");
    const tajuk = $("#login-tajuk");
    const nota = $("#login-nota");
    const btn = $("#btn-start");
    if (ind) ind.hidden = loginPasukan;
    if (pas) pas.hidden = !loginPasukan;
    const icEl = $("#ic"), namaEl = $("#nama");
    const namaLabel = document.querySelector('label[for="nama"]');
    const daerahLabel = document.querySelector('label[for="daerah"]');
    const daerahSel = $("#daerah");
    // Daerah & nama disembunyikan dalam mod senarai putih (diambil dari IC).
    [daerahLabel, daerahSel, namaLabel, namaEl].forEach((el) => { if (el) el.hidden = whitelistInd; });
    if (daerahSel) daerahSel.required = !whitelistInd && !loginPasukan;
    if (icEl) icEl.required = !loginPasukan;
    if (namaEl) namaEl.required = !loginPasukan && !whitelistInd;
    ["#ic1", "#ic2", "#ic3"].forEach((s) => { const el = $(s); if (el) el.required = loginPasukan; });
    if (tajuk) tajuk.textContent = loginPasukan ? "Log Masuk Pasukan" : "Log Masuk Kuiz";
    if (nota) {
      const teks = loginPasukan
        ? "Pusingan ini dijawab sebagai pasukan. Pilih daerah, isi IC ketiga-tiga ahli, kemudian cabut satu set soalan."
        : whitelistInd
          ? "Masukkan No. Kad Pengenalan anda. Sistem akan memaparkan nama, daerah dan sekolah anda untuk pengesahan."
          : "";
      nota.hidden = !teks;
      nota.textContent = teks;
    }
    if (btn) btn.textContent = loginPasukan ? "Cabut Set Soalan" : whitelistInd ? "Semak" : "Mula Kuiz";
    // Pastikan kad pengesahan tertutup apabila borang dipaparkan semula.
    const confirmBox = $("#login-confirm"), formLogin = $("#form-login");
    if (confirmBox) confirmBox.hidden = true;
    if (formLogin) formLogin.hidden = false;
    syncStartButton();
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
    $("#pantas-pasukan").textContent = state.nama || state.daerahNama || "";
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
  async function handleStart(payload, ui) {
    ui = ui || { wait: "#login-wait", err: "#login-error", btn: "#btn-start" };
    const btn = $(ui.btn);
    if (btn) btn.disabled = true;
    showError($(ui.err), "");
    showWait($(ui.wait), true,
      loginPasukan
        ? "Sedang mencabut set soalan. Sila tunggu…"
        : "Sistem sedang menyediakan soalan. Sila tunggu 10–30 saat.");
    try {
      const data = await apiCall("startExam", payload, undefined,
        function () { showWait($(ui.wait), true, "Menyediakan soalan… sila tunggu."); });
      if (!data.ok) {
        if (data.sudah_hantar) { showThanks(data.mesej_terima_kasih); return; }
        showError($(ui.err), data.ralat || "Gagal memulakan peperiksaan.");
        return;
      }
      state.peringkat = data.peringkat || "";
      state.ic = data.ic || payload.ic || (payload.ics ? payload.ics.slice().sort().join(",") : "");
      state.nama = data.nama || payload.nama || (pendingPeserta && pendingPeserta.nama) || "";
      state.daerah = data.daerah || payload.daerah || (pendingPeserta && pendingPeserta.daerah) || "";
      state.daerahNama = daerahNamaFromSelect(state.daerah) || (pendingPeserta && pendingPeserta.nama_daerah) || "";
      state.ics = payload.ics || state.ics || [];
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
      showError($(ui.err), err.message || MSJ_GAGAL);
    } finally {
      syncStartButton();
      if (!loginPasukan) { if (btn) btn.disabled = false; }
      showWait($(ui.wait), false);
    }
  }

  // Mod senarai putih: semak IC -> papar kad pengesahan.
  async function semakPeserta(ic) {
    const btn = $("#btn-start"); if (btn) btn.disabled = true;
    showError($("#login-error"), "");
    showWait($("#login-wait"), true, "Menyemak No. Kad Pengenalan…");
    try {
      const data = await apiCall("pesertaInfo", { ic });
      if (!data.ok) { showError($("#login-error"), data.ralat || "IC tidak dijumpai."); return; }
      pendingPeserta = data;
      $("#cf-nama").textContent = data.nama || "—";
      $("#cf-daerah").textContent = data.nama_daerah || data.daerah || "—";
      $("#cf-sekolah").textContent = data.sekolah || "—";
      $("#cf-ic").textContent = data.ic || ic;
      showError($("#confirm-error"), "");
      $("#form-login").hidden = true;
      $("#login-confirm").hidden = false;
    } catch (e) {
      showError($("#login-error"), e.message || MSJ_GAGAL);
    } finally {
      if (btn) btn.disabled = false;
      showWait($("#login-wait"), false);
    }
  }
  function backToLogin() {
    pendingPeserta = null;
    showError($("#confirm-error"), "");
    showWait($("#confirm-wait"), false);
    const cb = $("#login-confirm"); if (cb) cb.hidden = true;
    const fl = $("#form-login"); if (fl) fl.hidden = false;
    const icEl = $("#ic"); if (icEl) { icEl.value = ""; icEl.focus(); }
  }
  function confirmStart() {
    if (!pendingPeserta) { backToLogin(); return; }
    handleStart({ ic: pendingPeserta.ic }, { wait: "#confirm-wait", err: "#confirm-error", btn: "#btn-confirm-start" });
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
      showError($("#login-error"), "");
      if (loginPasukan) {
        const daerah = ($("#daerah") && $("#daerah").value) || "";
        if (!daerah) { showError($("#login-error"), "Sila pilih daerah."); return; }
        const ics = collectTeamIcs();
        if (ics.some((ic) => ic.length < 6)) {
          showError($("#login-error"), "Sila isi tiga nombor kad pengenalan ahli pasukan.");
          return;
        }
        if (new Set(ics).size !== 3) {
          showError($("#login-error"), "Tiga IC mesti berbeza.");
          return;
        }
        handleStart({ daerah: daerah, ics: ics });
        return;
      }
      if (gunaPeserta) {
        const ic = normIcInput($("#ic") && $("#ic").value);
        if (ic.length < 6) { showError($("#login-error"), "Sila masukkan No. Kad Pengenalan yang sah."); return; }
        semakPeserta(ic);
        return;
      }
      const daerah = ($("#daerah") && $("#daerah").value) || "";
      if (!daerah) { showError($("#login-error"), "Sila pilih daerah."); return; }
      const ic = $("#ic").value.trim();
      const nama = $("#nama").value.trim();
      if (!ic || !nama) { showError($("#login-error"), "Sila isi IC dan nama penuh."); return; }
      handleStart({ ic: ic, nama: nama, daerah: daerah });
    });
    const btnConfirmStart = $("#btn-confirm-start");
    if (btnConfirmStart) btnConfirmStart.addEventListener("click", confirmStart);
    const btnConfirmCancel = $("#btn-confirm-cancel");
    if (btnConfirmCancel) btnConfirmCancel.addEventListener("click", backToLogin);
    ["#daerah", "#ic1", "#ic2", "#ic3"].forEach((s) => {
      const el = $(s);
      if (el) el.addEventListener("input", syncStartButton);
      if (el) el.addEventListener("change", syncStartButton);
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

    gunaPeserta = !!init.guna_peserta;
    populateDaerah(init.daerah);
    applyLoginMode(init.peringkat_aktif);

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
    if (!state.daerah || state.peringkat !== peringkatAktif) return false;
    if (peringkatAktif === "S3P1") {
      if (!state.ics || state.ics.length !== 3) return false;
    } else if (!state.ic) {
      return false;
    }
    try {
      const r = await apiCall("getResult", { ic: state.ic, daerah: state.daerah });
      if (r.ok && r.sudah_hantar) { showThanks(r.mesej_terima_kasih); return true; }
    } catch (e) { /* teruskan */ }
    if (!state.attemptId) return false;
    try {
      const payload = peringkatAktif === "S3P1"
        ? { daerah: state.daerah, ics: state.ics }
        : { ic: state.ic, nama: state.nama || "Peserta", daerah: state.daerah };
      const data = await apiCall("startExam", payload);
      if (!data.ok) return false;
      state.peringkat = data.peringkat;
      state.attemptId = data.attempt_id;
      state.soalan = data.soalan || [];
      state.nama = data.nama || state.nama;
      state.ic = data.ic || state.ic;
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
