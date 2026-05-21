(function () {
  "use strict";

  const STORAGE_IC = "exam_ic";
  const STORAGE_NAMA = "exam_nama";
  const STORAGE_ATTEMPT = "exam_attempt_id";

  const $ = (sel) => document.querySelector(sel);

  const viewLogin = $("#view-login");
  const viewExam = $("#view-exam");
  const viewResult = $("#view-result");
  const loginError = $("#login-error");
  const examError = $("#exam-error");
  const configWarning = $("#config-warning");

  let state = {
    ic: "",
    nama: "",
    attemptId: "",
    soalan: [],
  };

  function getApiUrl() {
    const cfg = window.EXAM_CONFIG || {};
    return (cfg.API_URL || "").trim();
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  function setView(name) {
    viewLogin.hidden = name !== "login";
    viewExam.hidden = name !== "exam";
    viewResult.hidden = name !== "result";
  }

  async function apiCall(action, payload) {
    const url = getApiUrl();
    if (!url) {
      throw new Error(
        "Perkhidmatan peperiksaan tidak tersedia. Sila hubungi pentadbir."
      );
    }

    const body = JSON.stringify(Object.assign({ action: action }, payload));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Ralat sambungan. Sila cuba lagi sebentar.");
    }
    return data;
  }

  function renderQuestions(soalan) {
    const list = $("#questions-list");
    list.innerHTML = "";
    soalan.forEach((q, index) => {
      const card = document.createElement("div");
      card.className = "question-card";
      card.dataset.questionId = q.id;

      const title = document.createElement("h3");
      title.textContent = "Soalan " + (index + 1) + " daripada " + soalan.length;
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

  function renderResult(data) {
    $("#result-nama").textContent = data.nama || state.nama;
    $("#result-skor").textContent = data.skor;
    $("#result-betul").textContent = data.betul;
    $("#result-jumlah").textContent = data.jumlah;
    $("#result-salah").textContent =
      data.salah != null ? data.salah : data.jumlah - data.betul;

    const ul = $("#result-details");
    ul.innerHTML = "";
    (data.butiran || []).forEach((item) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "tag " + (item.betul ? "tag-betul" : "tag-salah");
      tag.textContent = item.betul ? "Betul" : "Salah";
      li.appendChild(tag);
      li.appendChild(
        document.createTextNode(
          " Soalan " +
            item.nombor +
            ": " +
            (item.soalan || "").slice(0, 80) +
            (item.soalan && item.soalan.length > 80 ? "…" : "") +
            " — Anda: " +
            item.jawapan_pelajar +
            ", Betul: " +
            item.jawapan_betul
        )
      );
      ul.appendChild(li);
    });
  }

  function saveSession() {
    sessionStorage.setItem(STORAGE_IC, state.ic);
    sessionStorage.setItem(STORAGE_NAMA, state.nama);
    sessionStorage.setItem(STORAGE_ATTEMPT, state.attemptId);
  }

  function loadSession() {
    state.ic = sessionStorage.getItem(STORAGE_IC) || "";
    state.nama = sessionStorage.getItem(STORAGE_NAMA) || "";
    state.attemptId = sessionStorage.getItem(STORAGE_ATTEMPT) || "";
  }

  async function handleStart(ic, nama) {
    const btn = $("#btn-start");
    btn.disabled = true;
    showError(loginError, "");

    try {
      const data = await apiCall("startExam", { ic: ic, nama: nama });
      if (!data.ok) {
        if (data.sudah_hantar && data.keputusan && data.keputusan.ok) {
          state.ic = ic;
          state.nama = nama;
          renderResult(data.keputusan);
          setView("result");
          return;
        }
        showError(loginError, data.ralat || "Gagal memulakan peperiksaan.");
        return;
      }

      state.ic = ic;
      state.nama = data.nama || nama;
      state.attemptId = data.attempt_id;
      state.soalan = data.soalan || [];
      saveSession();

      $("#meta-nama").textContent = state.nama;
      renderQuestions(state.soalan);
      setView("exam");
    } catch (err) {
      showError(loginError, err.message || "Ralat rangkaian.");
    } finally {
      btn.disabled = false;
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

    try {
      const jawapan = collectAnswers();
      const data = await apiCall("submitExam", {
        ic: state.ic,
        attempt_id: state.attemptId,
        jawapan: jawapan,
      });
      if (!data.ok) {
        showError(examError, data.ralat || "Gagal menghantar jawapan.");
        return;
      }
      renderResult(data);
      setView("result");
    } catch (err) {
      showError(examError, err.message || "Ralat rangkaian.");
    } finally {
      btn.disabled = false;
    }
  }

  async function tryResumeResult() {
    loadSession();
    if (!state.ic || !getApiUrl()) return;
    try {
      const data = await apiCall("getResult", { ic: state.ic });
      if (data.ok) {
        state.nama = data.nama;
        renderResult(data);
        setView("result");
      }
    } catch {
      return;
    }
  }

  function init() {
    if (!getApiUrl()) {
      configWarning.hidden = false;
    }

    $("#form-login").addEventListener("submit", (e) => {
      e.preventDefault();
      const ic = $("#ic").value.trim();
      const nama = $("#nama").value.trim();
      if (!ic || !nama) {
        showError(loginError, "Sila isi IC dan nama penuh.");
        return;
      }
      handleStart(ic, nama);
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

    $("#btn-back").addEventListener("click", () => {
      sessionStorage.clear();
      state = { ic: "", nama: "", attemptId: "", soalan: [] };
      $("#form-login").reset();
      setView("login");
    });

    setView("login");
    tryResumeResult();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
