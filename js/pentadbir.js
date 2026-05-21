(function () {
  "use strict";

  const API_RETRIES = 2;
  const $ = (sel) => document.querySelector(sel);

  function getApiUrl() {
    const cfg = window.EXAM_CONFIG || {};
    return (cfg.API_URL || "").trim();
  }

  function showError(message) {
    const el = $("#admin-error");
    el.textContent = message;
    el.hidden = !message;
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

  function renderAdminResult(data) {
    $("#admin-nama").textContent = data.nama || "-";
    $("#admin-ic").textContent = data.ic || "-";
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
      const topikLabel = item.topik ? " [" + item.topik + "]" : "";
      li.appendChild(
        document.createTextNode(
          " Soalan " +
            item.nombor +
            topikLabel +
            ": " +
            (item.soalan || "").slice(0, 100) +
            (item.soalan && item.soalan.length > 100 ? "…" : "") +
            " — Jawapan: " +
            item.jawapan_pelajar +
            " (Betul: " +
            item.jawapan_betul +
            ")"
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

    try {
      const data = await apiCall("adminReview", { pin: pin, ic: ic });
      if (!data.ok) {
        showError(data.ralat || "Gagal mendapatkan rekod.");
        $("#view-admin-result").hidden = true;
        return;
      }
      renderAdminResult(data);
    } catch (err) {
      showError(err.message || "Ralat rangkaian.");
      $("#view-admin-result").hidden = true;
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
      if (!pin || !ic) {
        showError("Sila isi PIN dan nombor kad pengenalan.");
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
