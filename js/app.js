(function () {
  "use strict";

  const STORAGE_IC = "exam_ic";
  const STORAGE_NAMA = "exam_nama";
  const STORAGE_DAERAH = "exam_daerah";
  const STORAGE_ATTEMPT = "exam_attempt_id";
  const STORAGE_BATAS_MS = "exam_batas_ms";
  const API_MAX_RETRIES = 6;

  const MSJ_TUNGGU_SOALAN =
    "Sistem sedang menyediakan soalan. Sila tunggu 10–30 saat. " +
    "Tempoh 1 jam bermula selepas soalan dijana.";
  const MSJ_GAGAL_SAMBUNGAN =
    "Gagal menyambung selepas beberapa cubaan. " +
    "Sila angkat tangan dan maklumkan pengawas.";

  const $ = (sel) => document.querySelector(sel);

  const viewLogin = $("#view-login");
  const viewExam = $("#view-exam");
  const viewThanks = $("#view-thanks");
  const loginError = $("#login-error");
  const loginWait = $("#login-wait");
  const examError = $("#exam-error");
  const examWait = $("#exam-wait");
  const configWarning = $("#config-warning");

  let countdownTimer = null;
  let state = {
    ic: "",
    nama: "",
    daerah: "",
    attemptId: "",
    soalan: [],
    batasMs: 0,
  };

  function getApiUrl() {
    const cfg = window.EXAM_CONFIG || {};
    return (cfg.API_URL || "").trim();
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  function showWait(el, on, message) {
    if (!el) return;
    if (message) el.textContent = message;
    el.hidden = !on;
  }

  function setView(name) {
    if (viewLogin) viewLogin.hidden = name !== "login";
    if (viewExam) viewExam.hidden = name !== "exam";
    if (viewThanks) viewThanks.hidden = name !== "thanks";
    if (name !== "exam" && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function showThanks(mesej) {
    const text =
      mesej ||
      "Terima kasih. Jawapan anda telah direkodkan. Keputusan akan diumumkan oleh pihak pengurusan.";
    const msgEl = $("#thanks-message");
    if (msgEl) {
      msgEl.textContent = text;
    }
    setView("thanks");
  }

  function goBackToLogin() {
    sessionStorage.clear();
    state = { ic: "", nama: "", daerah: "", attemptId: "", soalan: [], batasMs: 0 };
    const formLogin = $("#form-login");
    const selDaerah = $("#daerah");
    if (formLogin) formLogin.reset();
    populateDaerahOptions();
    if (selDaerah && getUrlDaerah()) {
      applyDaerahFromUrl();
    } else if (selDaerah) {
      selDaerah.disabled = false;
    }
    showError(loginError, "");
    showError(examError, "");
    setView("login");
  }

  function retryDelay(attemptIndex) {
    return 1500 + attemptIndex * 800 + Math.floor(Math.random() * 400);
  }

  async function apiCall(action, payload, retriesLeft, onStatus) {
    const url = getApiUrl();
    if (!url) {
      throw new Error(
        "Perkhidmatan peperiksaan tidak tersedia. Sila hubungi pentadbir."
      );
    }

    const left = retriesLeft != null ? retriesLeft : API_MAX_RETRIES;
    const attemptNum = API_MAX_RETRIES - left + 1;

    if (onStatus && attemptNum > 1) {
      onStatus(attemptNum, API_MAX_RETRIES);
    }

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
        if (!data.ok && data.cuba_lagi) {
          throw new Error("Sila tunggu");
        }
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
      throw new Error(MSJ_GAGAL_SAMBUNGAN);
    }
  }

  function formatCountdown(msLeft) {
    if (msLeft <= 0) return "Masa telah tamat.";
    const sec = Math.floor(msLeft / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (
      "Baki masa: " +
      m +
      " min " +
      (s < 10 ? "0" : "") +
      s +
      " saat"
    );
  }

  function startCountdown(batasMs) {
    const el = $("#meta-countdown");
    const batasLabel = $("#meta-batas");
    if (!el || !batasMs) return;

    if (countdownTimer) clearInterval(countdownTimer);

    function tick() {
      const left = batasMs - Date.now();
      el.textContent = formatCountdown(left);
      if (left <= 0) {
        el.classList.add("countdown-expired");
        clearInterval(countdownTimer);
        countdownTimer = null;
        showError(
          examError,
          "Masa kuiz 1 jam telah tamat. Sila hantar jawapan sekarang jika belum selesai, atau hubungi pengawas."
        );
      } else {
        el.classList.remove("countdown-expired");
      }
    }

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function applyExamTiming(data) {
    const batasLabel = data.batas_masa_label || "";
    const batasMs = data.batas_masa_ms || 0;
    state.batasMs = batasMs;

    const metaBatas = $("#meta-batas");
    if (metaBatas) {
      metaBatas.textContent = batasLabel || "-";
    }
    if (batasMs) {
      sessionStorage.setItem(STORAGE_BATAS_MS, String(batasMs));
      startCountdown(batasMs);
    }
  }

  function renderQuestions(soalan) {
    const list = $("#questions-list");
    list.innerHTML = "";
    soalan.forEach((q, index) => {
      const card = document.createElement("div");
      card.className = "question-card";
      card.dataset.questionId = q.id;

      const title = document.createElement("h3");
      title.textContent =
        "Soalan " + (index + 1) + " daripada " + soalan.length;
      card.appendChild(title);

      const stem = document.createElement("p");
      stem.textContent = q.soalan;
      card.appendChild(stem);

      ["A", "B", "C", "D"].forEach((letter) => {
        const label = document.createElement("label");
        label.className = "option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "q_" + q.id;
        input.value = letter;
        input.required = true;
        const text = document.createElement("span");
        text.textContent = letter + ". " + (q[letter] || "");
        label.appendChild(input);
        label.appendChild(text);
        card.appendChild(label);
      });

      list.appendChild(card);
    });
  }

  function collectAnswers() {
    const jawapan = {};
    state.soalan.forEach((q) => {
      const selected = document.querySelector(
        'input[name="q_' + q.id + '"]:checked'
      );
      if (selected) jawapan[q.id] = selected.value;
    });
    return jawapan;
  }

  function allAnswered() {
    return state.soalan.every((q) => {
      return document.querySelector('input[name="q_' + q.id + '"]:checked');
    });
  }

  function saveSession() {
    sessionStorage.setItem(STORAGE_IC, state.ic);
    sessionStorage.setItem(STORAGE_NAMA, state.nama);
    sessionStorage.setItem(STORAGE_DAERAH, state.daerah);
    sessionStorage.setItem(STORAGE_ATTEMPT, state.attemptId);
    if (state.batasMs) {
      sessionStorage.setItem(STORAGE_BATAS_MS, String(state.batasMs));
    }
  }

  function loadSession() {
    state.ic = sessionStorage.getItem(STORAGE_IC) || "";
    state.nama = sessionStorage.getItem(STORAGE_NAMA) || "";
    state.daerah = sessionStorage.getItem(STORAGE_DAERAH) || "";
    state.attemptId = sessionStorage.getItem(STORAGE_ATTEMPT) || "";
    const batas = sessionStorage.getItem(STORAGE_BATAS_MS);
    state.batasMs = batas ? parseInt(batas, 10) : 0;
  }

  function getUrlDaerah() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("daerah") || "").trim().toUpperCase();
  }

  function populateDaerahOptions() {
    const sel = $("#daerah");
    if (!sel || sel.options.length > 1) return;

    (window.DAERAH_LIST || []).forEach(function (d) {
      const opt = document.createElement("option");
      opt.value = d.kod;
      opt.textContent = d.nama;
      sel.appendChild(opt);
    });

    applyDaerahFromUrl();
  }

  function applyDaerahFromUrl() {
    const kod = getUrlDaerah();
    const sel = $("#daerah");
    if (!sel || !kod) return;

    let found = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === kod) {
        sel.value = kod;
        found = true;
        break;
      }
    }

    if (found) {
      sel.disabled = true;
    }
  }

  async function handleStart(ic, nama, daerah) {
    const btn = $("#btn-start");
    btn.disabled = true;
    showError(loginError, "");
    showWait(loginWait, true, MSJ_TUNGGU_SOALAN);

    try {
      const data = await apiCall(
        "startExam",
        { ic: ic, nama: nama, daerah: daerah },
        undefined,
        function () {
          showWait(loginWait, true, MSJ_TUNGGU_SOALAN);
        }
      );
      if (!data.ok) {
        if (data.sudah_hantar) {
          state.ic = ic;
          state.nama = nama;
          state.daerah = daerah;
          showThanks(data.mesej_terima_kasih);
          return;
        }
        showError(loginError, data.ralat || "Gagal memulakan peperiksaan.");
        return;
      }

      state.ic = ic;
      state.nama = data.nama || nama;
      state.daerah = data.daerah || daerah;
      state.attemptId = data.attempt_id;
      state.soalan = data.soalan || [];
      saveSession();

      $("#meta-nama").textContent = state.nama;
      applyExamTiming(data);
      renderQuestions(state.soalan);
      setView("exam");
    } catch (err) {
      showError(loginError, err.message || MSJ_GAGAL_SAMBUNGAN);
    } finally {
      btn.disabled = false;
      showWait(loginWait, false);
    }
  }

  async function handleSubmit() {
    const btn = $("#btn-submit");
    if (!allAnswered()) {
      showError(examError, "Sila jawab semua soalan sebelum menghantar.");
      return;
    }
    showError(examError, "");
    btn.disabled = true;
    showWait(examWait, true, "Sedang menghantar jawapan. Sila tunggu…");

    try {
      const jawapan = collectAnswers();
      const data = await apiCall(
        "submitExam",
        {
          ic: state.ic,
          attempt_id: state.attemptId,
          jawapan: jawapan,
        },
        undefined,
        function () {
          showWait(examWait, true, "Sedang menghantar jawapan. Sila tunggu 10–30 saat…");
        }
      );
      if (!data.ok) {
        if (data.sudah_hantar) {
          showThanks(data.mesej_terima_kasih);
          return;
        }
        showError(examError, data.ralat || "Gagal menghantar jawapan.");
        return;
      }
      sessionStorage.removeItem(STORAGE_ATTEMPT);
      sessionStorage.removeItem(STORAGE_BATAS_MS);
      showThanks(data.mesej_terima_kasih);
    } catch (err) {
      showError(examError, err.message || MSJ_GAGAL_SAMBUNGAN);
    } finally {
      btn.disabled = false;
      showWait(examWait, false);
    }
  }

  async function tryResumeExamOrThanks() {
    loadSession();
    if (!state.ic || !getApiUrl()) return;

    try {
      const result = await apiCall("getResult", {
        ic: state.ic,
        daerah: state.daerah,
      });
      if (result.ok && result.sudah_hantar) {
        showThanks(result.mesej_terima_kasih);
        return;
      }
    } catch {
      return;
    }

    if (!state.attemptId || !state.soalan.length) return;

    try {
      const data = await apiCall("startExam", {
        ic: state.ic,
        nama: state.nama || "Peserta",
        daerah: state.daerah,
      });
      if (data.ok && data.soalan && data.soalan.length) {
        state.soalan = data.soalan;
        state.attemptId = data.attempt_id;
        applyExamTiming(data);
        $("#meta-nama").textContent = state.nama;
        renderQuestions(state.soalan);
        setView("exam");
      }
    } catch {
      return;
    }
  }

  function init() {
    if (!getApiUrl()) {
      configWarning.hidden = false;
    }

    populateDaerahOptions();

    $("#form-login").addEventListener("submit", (e) => {
      e.preventDefault();
      const daerah = ($("#daerah") && $("#daerah").value) || "";
      const ic = $("#ic").value.trim();
      const nama = $("#nama").value.trim();
      if (!daerah) {
        showError(loginError, "Sila pilih daerah.");
        return;
      }
      if (!ic || !nama) {
        showError(loginError, "Sila isi IC dan nama penuh.");
        return;
      }
      handleStart(ic, nama, daerah);
    });

    $("#form-exam").addEventListener("submit", (e) => {
      e.preventDefault();
      if (
        !confirm(
          "Adakah anda pasti mahu menghantar jawapan? Anda tidak boleh mengubah jawapan selepas ini."
        )
      ) {
        return;
      }
      handleSubmit();
    });

    const btnBack = $("#btn-back-login");
    if (btnBack) {
      btnBack.addEventListener("click", goBackToLogin);
    }

    setView("login");
    tryResumeExamOrThanks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
