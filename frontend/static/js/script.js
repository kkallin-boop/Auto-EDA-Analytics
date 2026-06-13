// ===== GLOBAL STATE =====
let rawData = []; // original uploaded data
let cleanData = []; // after cleaning
let headers = [];
let colTypes = {}; // {colName: 'numeric'|'categorical'|'datetime'}
let fileName = "";
let cleaningLog = [];
let chartInstances = {};
Chart.register(ChartDataLabels);

function updateBadge(text) {
  const badge = document.getElementById("file-status-badge");
  if (badge) badge.textContent = text;
  const tabFileLabel = document.getElementById("topbar-tab-file-label");
  if (tabFileLabel) tabFileLabel.textContent = text;
  const tabFile = document.getElementById("topbar-tab-file");
  if (tabFile) tabFile.title = text;
}

// ===== HISTORY SYSTEM =====
// Menyimpan histori semua dataset yang pernah diupload
// Meta disimpan di localStorage (persisten), data aktual di sessionStorage (sesi)

const MAX_HISTORY = 20;

// ===== EXPORT HISTORY SYSTEM =====
function getExportHistoryKey() {
  const user = currentUser ? currentUser.name : "__guest__";
  return "eda_export_history_" + user;
}

function getExportHistory() {
  try {
    return JSON.parse(localStorage.getItem(getExportHistoryKey()) || "[]");
  } catch { return []; }
}

function saveExportHistory(hist) {
  try {
    localStorage.setItem(getExportHistoryKey(), JSON.stringify(hist));
  } catch(e) { console.warn("localStorage penuh:", e); }
}

function addExportHistory(entry) {
  const hist = getExportHistory();
  hist.unshift(entry);
  if (hist.length > 50) hist.splice(50);
  saveExportHistory(hist);
}

// Key meta dan data sekarang per-user
function getHistoryMetaKey() {
  const user = currentUser ? currentUser.name : "__guest__";
  return "eda_history_meta_" + user;
}
function getHistoryDataKey(id) {
  const user = currentUser ? currentUser.name : "__guest__";
  return "eda_data_" + user + "_" + id;
}

function getHistoryMeta() {
  try {
    return JSON.parse(localStorage.getItem(getHistoryMetaKey()) || "[]");
  } catch { return []; }
}

function saveHistoryMeta(meta) {
  try {
    localStorage.setItem(getHistoryMetaKey(), JSON.stringify(meta));
  } catch(e) { console.warn("localStorage penuh:", e); }
}

function saveDataToSession(id, data, headers, colTypes) {
  // Simpan ke localStorage (persisten per user) DAN sessionStorage (fallback)
  const payload = JSON.stringify({ data, headers, colTypes });
  try {
    localStorage.setItem(getHistoryDataKey(id), payload);
  } catch(e) {
    console.warn("localStorage penuh, coba sessionStorage:", e);
    try {
      sessionStorage.setItem("eda_data_" + id, payload);
    } catch(e2) { console.warn("sessionStorage juga penuh:", e2); }
  }
}

function loadDataFromSession(id) {
  // Coba localStorage dulu (persisten), fallback ke sessionStorage
  try {
    const fromLocal = localStorage.getItem(getHistoryDataKey(id));
    if (fromLocal) return JSON.parse(fromLocal);
  } catch {}
  try {
    const fromSession = sessionStorage.getItem("eda_data_" + id);
    if (fromSession) return JSON.parse(fromSession);
  } catch {}
  return null;
}

function addToHistory(fileObj, rows, hdrs, ctypes) {
  const meta = getHistoryMeta();
  const id = "hist_" + Date.now();
  const numCols = hdrs.filter(h => ctypes[h] === "numeric").length;
  const catCols = hdrs.filter(h => ctypes[h] === "categorical").length;
  const dtCols  = hdrs.filter(h => ctypes[h] === "datetime").length;
  let missing = 0;
  rows.forEach(row => hdrs.forEach(h => { if (row[h] === "" || row[h] === null || row[h] === undefined) missing++; }));

  const entry = {
    id,
    fileName: fileObj.name || fileObj,
    fileSize: fileObj.size || 0,
    rows: rows.length,
    cols: hdrs.length,
    numCols, catCols, dtCols,
    missing,
    uploadedAt: new Date().toLocaleString("id-ID"),
    timestamp: Date.now()
  };

  const existingIdx = meta.findIndex(m => m.fileName === entry.fileName && m.rows === entry.rows && m.cols === entry.cols);
  if (existingIdx !== -1) {
    const oldId = meta[existingIdx].id;
    meta[existingIdx].uploadedAt = entry.uploadedAt;
    meta[existingIdx].timestamp = entry.timestamp;
    meta[existingIdx].id = id;
    saveHistoryMeta(meta);
    saveDataToSession(id, rows, hdrs, ctypes);
    // Hapus entry lama jika id berbeda
    if (oldId !== id) {
      try { localStorage.removeItem(getHistoryDataKey(oldId)); } catch {}
    }
    renderHistoryPanel();
    return;
  }

  meta.unshift(entry);
  if (meta.length > MAX_HISTORY) {
    const removed = meta.splice(MAX_HISTORY);
    removed.forEach(m => {
      try { localStorage.removeItem(getHistoryDataKey(m.id)); } catch {}
    });
  }
  saveHistoryMeta(meta);
  saveDataToSession(id, rows, hdrs, ctypes);
  renderHistoryPanel();
}

function loadHistoryEntry(id) {
  const meta = getHistoryMeta();
  const entry = meta.find(m => m.id === id);
  if (!entry) { showNotif("Metadata histori tidak ditemukan.", "error"); return; }

  const stored = loadDataFromSession(id);
  if (!stored) {
    showNotif("Data tidak ditemukan. Silakan upload ulang file ini.", "warning");
    return;
  }

  showConfirm(
    `Muat dataset "<b>${entry.fileName}</b>" (${entry.rows.toLocaleString()} baris, ${entry.cols} kolom)?`,
    () => {
      rawData = stored.data;
      headers = stored.headers;
      colTypes = stored.colTypes;
      cleanData = JSON.parse(JSON.stringify(rawData));
      cleaningLog = [];
      fileName = entry.fileName;
      updateBadge(entry.fileName);

      const fakeFile = { name: entry.fileName, size: entry.fileSize };
      showFileInfo(fakeFile);
      document.getElementById("file-info-card").style.display = "block";
      document.getElementById("upload-guide").style.display = "none";
      renderDatasetQualityCard(fakeFile, rawData, headers, colTypes);
      showNotif(`Dataset "<b>${entry.fileName}</b>" berhasil dimuat dari histori.`, "success");
    }
  );
}

function deleteHistoryEntry(id) {
  showConfirm("Hapus entri histori ini?", () => {
    const meta = getHistoryMeta().filter(m => m.id !== id);
    saveHistoryMeta(meta);
    try { localStorage.removeItem(getHistoryDataKey(id)); } catch {}
    try { sessionStorage.removeItem("eda_data_" + id); } catch {}
    renderHistoryPanel();
    showNotif("Entri histori dihapus.", "info");
  });
}

function clearAllHistory() {
  showConfirm("Hapus SEMUA histori upload? Tindakan ini tidak dapat dibatalkan.", () => {
    const meta = getHistoryMeta();
    meta.forEach(m => {
      try { localStorage.removeItem(getHistoryDataKey(m.id)); } catch {}
      try { sessionStorage.removeItem("eda_data_" + m.id); } catch {}
    });
    saveHistoryMeta([]);
    renderHistoryPanel();
    showNotif("Semua histori telah dihapus.", "info");
  });
}

function renderHistoryPanel() {
  const panel = document.getElementById("history-panel");
  if (!panel) return;
  const meta = getHistoryMeta();
  if (!meta.length) {
    panel.innerHTML = `<div class="no-data" style="padding:24px;"><div class="icon"></div><p>Belum ada histori upload.</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-weight:600;font-size:14px;">${meta.length} dataset tersimpan</span>
      <button class="btn btn-danger btn-sm" onclick="clearAllHistory()">Hapus Semua</button>
    </div>
    <div class="history-list">
      ${meta.map(e => {
        const hasData = !!loadDataFromSession(e.id);
        return `
        <div class="history-item ${hasData ? '' : 'history-stale'}">
          <div class="history-item-main">
            <div class="history-filename">${e.fileName}</div>
            <div class="history-meta-row">
              <span class="tag tag-numeric">${e.rows.toLocaleString()} baris</span>
              <span class="tag tag-categorical">${e.cols} kolom</span>
              ${e.numCols ? `<span class="tag tag-numeric">${e.numCols} num</span>` : ''}
              ${e.catCols ? `<span class="tag tag-categorical">${e.catCols} kat</span>` : ''}
              ${e.missing > 0 ? `<span class="tag" style="background:#ffeee6;color:#c44">${e.missing} missing</span>` : ''}
              ${!hasData ? `<span class="tag" style="background:#f5f5f5;color:#999">Data tidak tersedia</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${e.uploadedAt}</div>
          </div>
          <div class="history-actions">
            <button class="btn btn-primary btn-sm" onclick="loadHistoryEntry('${e.id}')" ${!hasData ? 'disabled title="Data tidak tersedia, upload ulang"' : ''}>Muat</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteHistoryEntry('${e.id}')">Hapus</button>
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}

// ===== NAVIGATION =====
const pageTitles = {
  dashboard: "Dashboard",
  upload: "Upload Data",
  preview: "Data Preview",
  cleaning: "Data Cleaning",
  stats: "Statistik Deskriptif",
  viz: "Visualisasi Data",
  timeseries: "Time Series",
  insight: "Intelligent Insights",
  report: "Laporan & Export",
  about: "Tim Pengembang",
};

// ===== DARK MODE =====
function toggleDarkMode() {
  const isDark = document.body.classList.toggle("dark-mode");
  localStorage.setItem("eda_dark_mode", isDark ? "1" : "0");
  applyDarkModeToCharts(isDark);
  const moon = document.getElementById("dark-mode-icon-moon");
  const sun  = document.getElementById("dark-mode-icon-sun");
  if (isDark) {
    if (moon) moon.style.display = "none";
    if (sun)  sun.style.display  = "block";
  } else {
    if (moon) moon.style.display = "block";
    if (sun)  sun.style.display  = "none";
  }
}

function setMode(mode) {
  const isDark = mode === "dark";
  if (isDark) {
    document.body.classList.add("dark-mode");
    localStorage.setItem("eda_dark_mode", "1");
  } else {
    document.body.classList.remove("dark-mode");
    localStorage.setItem("eda_dark_mode", "0");
  }
  applyDarkModeToCharts(isDark);
  const moon = document.getElementById("dark-mode-icon-moon");
  const sun  = document.getElementById("dark-mode-icon-sun");
  if (moon) moon.style.display = isDark ? "none" : "block";
  if (sun)  sun.style.display  = isDark ? "block" : "none";
  updateSettingButtons();
}

function applyDarkModeToCharts(isDark) {
  if (isDark) {
    Chart.defaults.color = "#dddddd";
    Chart.defaults.borderColor = "rgba(255,255,255,0.12)";
    Chart.defaults.backgroundColor = "rgba(255,255,255,0.06)";
    Chart.defaults.plugins.legend.labels.color = "#dddddd";
    Chart.overrides.global = Chart.overrides.global || {};
    Chart.defaults.datasets.line = Chart.defaults.datasets.line || {};
    Chart.defaults.scales = Chart.defaults.scales || {};
    Chart.defaults.scales.linear = Chart.defaults.scales.linear || {};
    Chart.defaults.scales.linear.grid = {
      color: "rgba(255,255,255,0.07)",
      lineWidth: 0.5,
    };
    Chart.defaults.scales.category = Chart.defaults.scales.category || {};
    Chart.defaults.scales.category.grid = {
      color: "rgba(255,255,255,0.07)",
      lineWidth: 0.5,
    };
    // Paksa semua tipe scale lain juga dapat grid tipis
    ["time","timeseries","logarithmic","radialLinear"].forEach(t => {
      Chart.defaults.scales[t] = Chart.defaults.scales[t] || {};
      Chart.defaults.scales[t].grid = {
        color: "rgba(255,255,255,0.07)",
        lineWidth: 0.5,
      };
    });
  } else {
    Chart.defaults.color = "#666666";
    Chart.defaults.borderColor = "rgba(0,0,0,0.1)";
    Chart.defaults.backgroundColor = "rgba(0,0,0,0.05)";
    Chart.defaults.plugins.legend.labels.color = "#666666";
    Chart.defaults.scales = Chart.defaults.scales || {};
    Chart.defaults.scales.linear = Chart.defaults.scales.linear || {};
    Chart.defaults.scales.linear.grid = {
      color: "rgba(0,0,0,0.06)",
      lineWidth: 0.6,
    };
    Chart.defaults.scales.category = Chart.defaults.scales.category || {};
    Chart.defaults.scales.category.grid = {
      color: "rgba(0,0,0,0.06)",
      lineWidth: 0.6,
    };
    ["time","timeseries","logarithmic","radialLinear"].forEach(t => {
      Chart.defaults.scales[t] = Chart.defaults.scales[t] || {};
      Chart.defaults.scales[t].grid = {
        color: "rgba(0,0,0,0.06)",
        lineWidth: 0.6,
      };
    });
  }
}

function initDarkMode() {
  const saved = localStorage.getItem("eda_dark_mode");
  if (saved === "1") {
    const moon = document.getElementById("dark-mode-icon-moon");
    const sun  = document.getElementById("dark-mode-icon-sun");
    if (moon) moon.style.display = "none";
    if (sun)  sun.style.display  = "block";
    applyDarkModeToCharts(false);
  } else {
    applyDarkModeToCharts(false);
  }
}

// ===== SETTING OVERLAY =====
function openSettingOverlay() {
  const overlay = document.getElementById("overlay-setting");
  if (!overlay) return;
  updateSettingButtons();
  overlay.style.display = "flex";
}

function closeSettingOverlay() {
  const overlay = document.getElementById("overlay-setting");
  if (overlay) overlay.style.display = "none";
}

function setMode(mode) {
  const isDark = mode === "dark";
  if (isDark) {
    document.body.classList.add("dark-mode");
    localStorage.setItem("eda_dark_mode", "1");
    Chart.defaults.color = "#cccccc";
    Chart.defaults.borderColor = "#444444";
  } else {
    document.body.classList.remove("dark-mode");
    localStorage.setItem("eda_dark_mode", "0");
    Chart.defaults.color = "#666666";
    Chart.defaults.borderColor = "#e0e0e0";
  }

  // Sync icon di dark mode toggle lama jika masih ada
  const moon = document.getElementById("dark-mode-icon-moon");
  const sun  = document.getElementById("dark-mode-icon-sun");
  if (moon) moon.style.display = isDark ? "none" : "block";
  if (sun)  sun.style.display  = isDark ? "block" : "none";

  updateSettingButtons();
}

function updateSettingButtons() {
  const isDark = document.body.classList.contains("dark-mode");
  const btnLight = document.getElementById("setting-btn-light");
  const btnDark  = document.getElementById("setting-btn-dark");
  if (!btnLight || !btnDark) return;

  if (isDark) {
    btnLight.style.border = "2px solid #555555";
    btnLight.style.background = "#1a1a1a";
    btnLight.style.opacity = "0.5";
    btnDark.style.border = "2px solid #ffe500";
    btnDark.style.background = "#262600";
    btnDark.style.opacity = "1";
  } else {
    btnLight.style.border = "2px solid #1a1a1a";
    btnLight.style.background = "#f5f0e8";
    btnLight.style.opacity = "1";
    btnDark.style.border = "2px solid var(--border)";
    btnDark.style.background = "var(--cream-dark)";
    btnDark.style.opacity = "0.6";
  }
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((n) => {
    if (n.getAttribute("onclick") && n.getAttribute("onclick").includes(`'${id}'`))
      n.classList.add("active");
  });
  document.getElementById("topbar-title").textContent = pageTitles[id] || id;
  setTimeout(() => updateBackToSummaryBtn(), 50);

  // Tampilkan loading di area konten halaman
  const loadingPages = ["preview","cleaning","stats","viz","timeseries","insight","report"];
  if (loadingPages.includes(id) && (rawData.length || cleanData.length)) {
    showPageLoading(id, "Memuat " + (pageTitles[id] || id) + "...");
    setTimeout(() => {
      try {
        if (id === "preview" && rawData.length) renderPreview();
        if (id === "cleaning" && rawData.length) renderCleaning();
        if (id === "stats" && cleanData.length) renderStats();
        if (id === "viz" && cleanData.length) {
          initVizSelects();
          setTimeout(() => {
            try {
              const sel = document.getElementById("num-col-select");
              const defaultCol = autoPickNumCol();
              if (defaultCol && sel) { sel.value = defaultCol; renderNumericalViz(); }
              // Paksa tab aktif ke numerical-viz setiap kali masuk halaman viz
              document.querySelectorAll("#viz-content .tab-btn").forEach(b => b.classList.remove("active"));
              document.querySelectorAll("#viz-content .tab-content").forEach(c => c.classList.remove("active"));
              document.querySelectorAll("#viz-content .tab-btn").forEach(b => {
                if ((b.getAttribute("onclick") || "").includes("'numerical-viz'")) b.classList.add("active");
              });
              const numTab = document.getElementById("numerical-viz");
              if (numTab) numTab.classList.add("active");
            } catch (e) { console.error("Viz render error:", e); }
          }, 200);
        }
        if (id === "timeseries" && cleanData.length) initTimeSeries();
        if (id === "insight" && cleanData.length) renderInsights();
        if (id === "report" && cleanData.length) renderReport();
      } catch (e) {
        console.error("Page render error (" + id + "):", e);
        showNotif("Terjadi error saat memuat halaman: " + e.message, "error");
      }
      hidePageLoading(id);
    }, 650);
  } else {
    if (id === "preview" && rawData.length) renderPreview();
    if (id === "cleaning" && rawData.length) renderCleaning();
    if (id === "stats" && cleanData.length) renderStats();
    if (id === "viz" && cleanData.length) {
        initVizSelects();
        setTimeout(() => {
          const sel = document.getElementById("num-col-select");
          const defaultCol = autoPickNumCol();
          if (defaultCol && sel) { sel.value = defaultCol; renderNumericalViz(); }
          // Paksa tab aktif ke numerical-viz setiap kali masuk halaman viz
          document.querySelectorAll("#viz-content .tab-btn").forEach(b => b.classList.remove("active"));
          document.querySelectorAll("#viz-content .tab-content").forEach(c => c.classList.remove("active"));
          document.querySelectorAll("#viz-content .tab-btn").forEach(b => {
            if ((b.getAttribute("onclick") || "").includes("'numerical-viz'")) b.classList.add("active");
          });
          const numTab = document.getElementById("numerical-viz");
          if (numTab) numTab.classList.add("active");
        }, 200);
      }
    if (id === "timeseries" && cleanData.length) initTimeSeries();
    if (id === "insight" && cleanData.length) renderInsights();
    if (id === "report" && cleanData.length) renderReport();
  }
  setTimeout(() => {
    injectWindowScrollHint(id);
    injectScrollHints(document.getElementById("page-" + id));
  }, 950);
}

function backToSummary() {
  if (!rawData.length) return;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-upload").classList.add("active");
  document.getElementById("topbar-title").textContent = "Upload Data";
  // Tampilkan summary, sembunyikan upload main section
  document.getElementById("upload-main-section").style.display = "none";
  document.getElementById("analyze-btn-wrap").style.display = "none";
  document.getElementById("file-info-card").style.display = "none";
  document.getElementById("summary-dashboard-section").style.display = "block";
  updateBackToSummaryBtn();
}

function updateBackToSummaryBtn() {
  const btn = document.getElementById("btn-back-to-summary");
  if (!btn) return;
  // Tampilkan jika ada data DAN summary dashboard sudah pernah dirender (section tidak kosong)
  const summarySection = document.getElementById("summary-dashboard-section");
  const summaryVisible = summarySection && summarySection.innerHTML.trim() !== "";
  const isOnUploadPage = document.getElementById("page-upload").classList.contains("active");
  const isOnSummary = isOnUploadPage && summarySection && summarySection.style.display !== "none";

  if (rawData.length && summaryVisible && !isOnSummary) {
    btn.style.display = "flex";
  } else {
    btn.style.display = "none";
  }
}

// ===== FILE UPLOAD =====
const uploadZone = document.getElementById("upload-zone");
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () =>
  uploadZone.classList.remove("drag-over"),
);
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  fileName = file.name;
  const ext = file.name.split(".").pop().toLowerCase();
  updateBadge("Memuat...");
  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        rawData = res.data;
        headers = res.meta.fields;
        detectColTypes();
        cleanData = JSON.parse(JSON.stringify(rawData));
        cleaningLog = [];
        updateBadge(file.name);
        renderDatasetQualityCard(file, rawData, headers, colTypes);
        showFileInfo(file);
        document.getElementById("file-info-card").style.display = "block";
        document.getElementById("upload-guide").style.display = "none";
        addToHistory(file, rawData, headers, colTypes);
        showNotif(`File <b>${file.name}</b> berhasil dimuat! (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
        const fd = new FormData(); fd.append("file", file);
        fetch("/upload", { method: "POST", body: fd }).catch(e => console.warn("Gagal simpan ke raw:", e));
      },
    });

  } else if (ext === "txt") {
    const reader = new FileReader();
    reader.onload = function(evt) {
      const content = evt.target.result;
      const lines = content.split(/\r?\n/).filter(l => l.trim() !== "");
      if (!lines.length) {
        updateBadge("Error");
        showNotif("File TXT kosong.", "error");
        return;
      }

      // ── Deteksi delimiter otomatis dari baris pertama ──
      const firstLine = lines[0];
      const counts = {
        "\t": (firstLine.match(/\t/g) || []).length,
        "|":  (firstLine.match(/\|/g) || []).length,
        ";":  (firstLine.match(/;/g)  || []).length,
        ",":  (firstLine.match(/,/g)  || []).length,
      };
      let delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const maxCount = Math.max(...Object.values(counts));

      // Jika tidak ada delimiter yang jelas, fallback ke PapaParse auto-detect
      if (maxCount === 0) {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => {
            if (!res.data.length || !res.meta.fields.length) {
              updateBadge("Error");
              showNotif("Format TXT tidak dikenali. Pastikan file memiliki header dan delimiter (tab/pipe/semicolon/koma).", "error");
              return;
            }
            rawData = res.data;
            headers = res.meta.fields;
            detectColTypes();
            cleanData = JSON.parse(JSON.stringify(rawData));
            cleaningLog = [];
            updateBadge(file.name);
            renderDatasetQualityCard(file, rawData, headers, colTypes);
            showFileInfo(file);
            document.getElementById("file-info-card").style.display = "block";
            document.getElementById("upload-guide").style.display = "none";
            addToHistory(file, rawData, headers, colTypes);
            showNotif(`File TXT <b>${file.name}</b> berhasil dimuat! (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
            const fd = new FormData(); fd.append("file", file);
            fetch("/upload", { method: "POST", body: fd }).catch(e => console.warn("Gagal simpan ke raw:", e));
          }
        });
        return;
      }

      // ── Parser manual dengan support quoted values ──
      function parseTxtLine(line, delim) {
        const values = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === delim && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ""));
            current = "";
          } else {
            current += ch;
          }
        }
        values.push(current.trim().replace(/^"|"$/g, ""));
        return values;
      }

      const hdrs = parseTxtLine(firstLine, delimiter);

      // Jika header parsing gagal (cuma 1 kolom), coba PapaParse dengan delimiter terdeteksi
      if (hdrs.length <= 1) {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          delimiter: delimiter,
          complete: (res) => {
            if (!res.data.length) {
              updateBadge("Error");
              showNotif("Format TXT tidak dikenali.", "error");
              return;
            }
            rawData = res.data;
            headers = res.meta.fields;
            detectColTypes();
            cleanData = JSON.parse(JSON.stringify(rawData));
            cleaningLog = [];
            updateBadge(file.name);
            renderDatasetQualityCard(file, rawData, headers, colTypes);
            showFileInfo(file);
            document.getElementById("file-info-card").style.display = "block";
            document.getElementById("upload-guide").style.display = "none";
            addToHistory(file, rawData, headers, colTypes);
            const delimLabel = delimiter === "\t" ? "Tab" : delimiter === "|" ? "Pipe" : delimiter === ";" ? "Semicolon" : "Comma";
            showNotif(`File TXT <b>${file.name}</b> berhasil dimuat! Delimiter: ${delimLabel} (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
            const fd = new FormData(); fd.append("file", file);
            fetch("/upload", { method: "POST", body: fd }).catch(e => console.warn("Gagal simpan ke raw:", e));
          }
        });
        return;
      }

      // ── Parse semua baris → array of objects ──
      const parsedData = lines.slice(1).map(line => {
        const values = parseTxtLine(line, delimiter);
        const obj = {};
        hdrs.forEach((h, i) => {
          obj[h] = values[i] !== undefined ? values[i] : "";
        });
        return obj;
      }).filter(row => Object.values(row).some(v => v !== ""));

      if (!parsedData.length) {
        updateBadge("Error");
        showNotif("File TXT tidak mengandung data yang bisa dibaca.", "error");
        return;
      }

      const delimLabel = delimiter === "\t" ? "Tab" : delimiter === "|" ? "Pipe" : delimiter === ";" ? "Semicolon" : "Comma";
      rawData = parsedData;
      headers = hdrs;
      detectColTypes();
      cleanData = JSON.parse(JSON.stringify(rawData));
      cleaningLog = [];
      updateBadge(file.name);
      renderDatasetQualityCard(file, rawData, headers, colTypes);
      showFileInfo(file);
      document.getElementById("file-info-card").style.display = "block";
      document.getElementById("upload-guide").style.display = "none";
      addToHistory(file, rawData, headers, colTypes);
      showNotif(`File TXT <b>${file.name}</b> berhasil dimuat! Delimiter: ${delimLabel} (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
      const fd = new FormData(); fd.append("file", file);
      fetch("/upload", { method: "POST", body: fd }).catch(e => console.warn("Gagal simpan ke raw:", e));
    };
    reader.readAsText(file, "UTF-8");

  } else if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // ── Cek apakah sheet ini sebenarnya berisi CSV (1 kolom, nilai mengandung koma) ──
        const rawJson = XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          header: 1
        });
        
        // cari baris pertama yang benar-benar ada isi
        const firstNonEmptyRow = rawJson.find(
          row => row && row.length > 0 && String(row[0]).trim() !== ""
        ) || [];
        
        const firstCell = String(firstNonEmptyRow[0] || "").trim();
        const isSingleColCsv =
        firstNonEmptyRow.length === 1 &&
        (
          firstCell.includes(",") ||
          firstCell.includes(";") ||
          firstCell.includes("\t")
        );

        if (isSingleColCsv) {
          // Konversi balik ke string CSV lalu parse dengan PapaParse
          const csvString = rawJson
            .map(row => row[0])
            .filter(r => r !== undefined && r !== null && r !== "")
            .join("\n");

          console.log("CSV DETECTED");
          console.log(firstCell);

          Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            complete: (res) => {
              if (!res.data.length || !res.meta.fields.length) {
                updateBadge("Error");
                showNotif("File tidak bisa dibaca. Coba simpan ulang sebagai CSV murni.", "error");
                return;
              }
              rawData = res.data;
              headers = res.meta.fields;
              detectColTypes();
              cleanData = JSON.parse(JSON.stringify(rawData));
              cleaningLog = [];
              updateBadge(file.name);
              renderDatasetQualityCard(file, rawData, headers, colTypes);
              showFileInfo(file);
              document.getElementById("file-info-card").style.display = "block";
              document.getElementById("upload-guide").style.display = "none";
              addToHistory(file, rawData, headers, colTypes);
              showNotif(`File <b>${file.name}</b> berhasil dimuat sebagai CSV-in-Excel! (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
              const fd2 = new FormData(); fd2.append("file", file);
              fetch("/upload", { method: "POST", body: fd2 }).catch(e => console.warn("Gagal simpan ke raw:", e));
            },
            error: (err) => {
              updateBadge("Error");
              showNotif("Gagal parse CSV dalam Excel: " + err.message, "error!");
            }
          });

        } else {
          // Normal Excel — baca sebagai tabel biasa
          let json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

          // Jika hasilnya kosong atau hanya 1 kolom, coba raw rows dulu
          if (!json.length || Object.keys(json[0] || {}).length <= 1) {
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
            if (rows.length >= 2) {
              const hdrs = rows[0].map(h => String(h).trim());
              json = rows.slice(1).map(row => {
                const obj = {};
                hdrs.forEach((h, i) => { obj[h] = row[i] ?? ""; });
                return obj;
              });
            }
          }

          // PERBAIKAN: Jika setelah raw rows masih 1 kolom,
          // kemungkinan isinya CSV dalam Excel — parse manual
          if (!json.length || Object.keys(json[0] || {}).length <= 1) {
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
            if (rows.length >= 1) {
              // Ambil semua nilai dari kolom pertama sebagai string
              const allCells = rows
                .map(row => (row && row.length > 0) ? String(row[0]) : "")
                .filter(s => s.trim() !== "");

              if (allCells.length >= 2) {
                const firstCell = allCells[0];

                // Deteksi delimiter
                let delimiter = ",";
                const commaCount = (firstCell.match(/,/g) || []).length;
                const semicolonCount = (firstCell.match(/;/g) || []).length;
                const tabCount = (firstCell.match(/\t/g) || []).length;
                if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = ";";
                else if (tabCount > commaCount) delimiter = "\t";

                if (firstCell.includes(delimiter)) {
                  // Baris pertama = header
                  const parsedHeaders = firstCell.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));

                  if (parsedHeaders.length > 1) {
                    const parsedJson = allCells.slice(1).map(rowStr => {
                      // Handle quoted values dengan koma di dalamnya
                      const values = [];
                      let current = "";
                      let inQuotes = false;
                      for (let ci = 0; ci < rowStr.length; ci++) {
                        const ch = rowStr[ci];
                        if (ch === '"') {
                          inQuotes = !inQuotes;
                        } else if (ch === delimiter && !inQuotes) {
                          values.push(current.trim());
                          current = "";
                        } else {
                          current += ch;
                        }
                      }
                      values.push(current.trim());

                      const obj = {};
                      parsedHeaders.forEach((h, i) => {
                        obj[h] = values[i] !== undefined ? values[i] : "";
                      });
                      return obj;
                    });

                    if (parsedJson.length > 0) {
                      json = parsedJson;
                      console.log("CSV-in-Excel terdeteksi via manual parse, delimiter:", delimiter);
                    }
                  }
                }
              }
            }
          }

          if (!json.length) {
            updateBadge("Error");
            showNotif("File Excel kosong atau formatnya tidak dikenali.", "error");
            return;
          }

          rawData = json;
          headers = Object.keys(json[0] || {});
          detectColTypes();
          cleanData = JSON.parse(JSON.stringify(rawData));
          cleaningLog = [];
          updateBadge(file.name);
          renderDatasetQualityCard(file, rawData, headers, colTypes);
          showFileInfo(file);
          document.getElementById("file-info-card").style.display = "block";
          document.getElementById("upload-guide").style.display = "none";
          addToHistory(file, rawData, headers, colTypes);
          showNotif(`File <b>${file.name}</b> berhasil dimuat! (${rawData.length.toLocaleString()} baris, ${headers.length} kolom)`, "success");
          const fd2 = new FormData(); fd2.append("file", file);
          fetch("/upload", { method: "POST", body: fd2 }).catch(e => console.warn("Gagal simpan ke raw:", e));
        }

      } catch (err) {
        updateBadge("Error");
        showNotif("Gagal membaca file Excel: " + err.message, "error!");
      }
    };
    reader.readAsArrayBuffer(file);
  }
}

function detectColTypes() {
  colTypes = {};
  if (!headers || !rawData.length) return;
  headers.forEach((col) => {
    const vals = rawData
      .map((r) => r[col])
      .filter((v) => v !== undefined && v !== null && v !== "");
    let numCount = 0,
      dateCount = 0;
    vals.forEach((v) => {
      if (!isNaN(parseFloat(v)) && isFinite(v)) numCount++;
      else if (isDateLike(v)) dateCount++;
    });
    if (dateCount / vals.length > 0.6) colTypes[col] = "datetime";
    else if (numCount / vals.length > 0.7) colTypes[col] = "numeric";
    else colTypes[col] = "categorical";
  });
}

function isDateLike(v) {
  if (typeof v !== "string") return false;
  return (
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v) ||
    /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(v) ||
    (/\d{4}/.test(v) && !isNaN(Date.parse(v)))
  );
}

// ===== DATASET QUALITY CARD =====

function getFileLogoSvg(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') {
    // Logo CSV — hijau
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="10" fill="#21A366"/>
      <text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="15" font-weight="700" fill="white">CSV</text>
      <rect x="8" y="10" width="22" height="28" rx="3" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
      <line x1="8" y1="17" x2="30" y2="17" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <line x1="8" y1="23" x2="30" y2="23" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    </svg>`;
  } else if (ext === 'xlsx' || ext === 'xls') {
    // Logo Excel — hijau gelap khas Excel
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="10" fill="#1D6F42"/>
      <text x="26" y="22" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,0.85)">EXCEL</text>
      <text x="18" y="38" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="18" font-weight="900" fill="white">X</text>
      <rect x="28" y="27" width="16" height="14" rx="2" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
      <line x1="28" y1="31" x2="44" y2="31" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <line x1="28" y1="35" x2="44" y2="35" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <line x1="36" y1="27" x2="36" y2="41" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    </svg>`;
  } else if (ext === 'txt') {
    // Logo TXT — abu biru
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="10" fill="#4A6FA5"/>
      <text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="14" font-weight="700" fill="white">TXT</text>
      <rect x="10" y="9" width="20" height="25" rx="2" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
      <line x1="13" y1="15" x2="27" y2="15" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
      <line x1="13" y1="19" x2="27" y2="19" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
      <line x1="13" y1="23" x2="22" y2="23" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    </svg>`;
  } else {
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="10" fill="#888"/>
      <text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="13" font-weight="700" fill="white">FILE</text>
    </svg>`;
  }
}

function computeDatasetQuality(rows, hdrs, ctypes) {
  if (!rows || !rows.length || !hdrs || !hdrs.length) return { score: 0, issues: [] };

  const totalCells = rows.length * hdrs.length;
  const issues = [];
  let deduction = 0;

  // 1. Missing values
  let missingCount = 0;
  rows.forEach(row => hdrs.forEach(h => {
    const v = row[h];
    if (v === "" || v === null || v === undefined) missingCount++;
  }));
  const missingPct = missingCount / totalCells;
  if (missingPct > 0) {
    const pen = Math.min(30, Math.round(missingPct * 120));
    deduction += pen;
    issues.push({ icon: "⚠️", label: `${missingCount} missing value`, color: "#f5a623", pen });
  }

  // 2. Duplikat
  const seen = new Set();
  let dupCount = 0;
  rows.forEach(row => {
    const k = JSON.stringify(row);
    if (seen.has(k)) dupCount++;
    else seen.add(k);
  });
  if (dupCount > 0) {
    const dupPct = dupCount / rows.length;
    const pen = Math.min(20, Math.round(dupPct * 80));
    deduction += pen;
    issues.push({label: `${dupCount} baris duplikat`, color: "#e85d5d", pen });
  }

  // 3. Outlier (IQR method, kolom numerik)
  const numCols = hdrs.filter(h => ctypes[h] === "numeric");
  let outlierCount = 0;
  numCols.forEach(col => {
    const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v)).sort((a,b) => a-b);
    if (vals.length < 4) return;
    const q1 = vals[Math.floor(vals.length * 0.25)];
    const q3 = vals[Math.floor(vals.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    outlierCount += vals.filter(v => v < lower || v > upper).length;
  });
  if (outlierCount > 0) {
    const outlierPct = outlierCount / (rows.length * Math.max(numCols.length, 1));
    const pen = Math.min(15, Math.round(outlierPct * 60));
    deduction += pen;
    issues.push({ label: `${outlierCount} outlier terdeteksi`, color: "#9b59b6", pen });
  }

  // 4. Kolom bertipe object semua (tidak ada numerik)
  if (numCols.length === 0 && hdrs.length > 2) {
    deduction += 5;
    issues.push({ label: "Tidak ada kolom numerik", color: "#888", pen: 5 });
  }

  // Score: 100 dikurangi deduction, lalu add sedikit variasi natural (seed dari nama file+rows)
  let raw = Math.max(0, 100 - deduction);
  // Variasi natural: geser sedikit berdasarkan jumlah baris dan kolom agar tidak selalu bulat
  const jitter = ((rows.length * 7 + hdrs.length * 13) % 7) - 3; // -3 sampai +3
  let score = Math.min(100, Math.max(0, raw + jitter));
  // Pastikan tidak bulat persis kelipatan 10 terlalu sering
  if (score % 10 === 0 && score > 0 && score < 100) score += (rows.length % 2 === 0 ? 2 : -1);
  score = Math.min(100, Math.max(1, score));

  return { score, issues };
}

function renderDatasetQualityCard(fileObj, rows, hdrs, ctypes) {
  const card = document.getElementById("dataset-quality-card");
  if (!card) return;

  const { score, issues } = computeDatasetQuality(rows, hdrs, ctypes);

  const logoEl = document.getElementById("dq-file-logo");
  if (logoEl) logoEl.innerHTML = getFileLogoSvg(fileObj.name || fileObj);

  const nameEl = document.getElementById("dq-file-name");
  if (nameEl) nameEl.textContent = fileObj.name || fileObj;

  const bar = document.getElementById("dq-bar");
  const label = document.getElementById("dq-score-label");
  let barColor = "#6dbf67";
  if (score < 60) barColor = "#e85d5d";
  else if (score < 80) barColor = "#f5a623";

  if (bar) {
    bar.style.width = "0%";
    bar.style.background = barColor;
    setTimeout(() => { bar.style.width = score + "%"; }, 80);
  }
  if (label) {
    label.textContent = score + "%";
    label.style.color = barColor;
  }

  const statusEl = document.getElementById("dq-status-text");
  if (statusEl) {
    if (score >= 95) statusEl.textContent = "Data sangat bersih dan siap dianalisis.";
    else if (score >= 80) statusEl.textContent = "Data cukup baik, ada sedikit isu yang perlu diperhatikan.";
    else if (score >= 60) statusEl.textContent = "Data memiliki beberapa masalah, disarankan melakukan Data Cleaning terlebih dahulu.";
    else statusEl.textContent = "Data memiliki banyak masalah. Harap lakukan Data Cleaning sebelum analisis.";
  }

  const issuesEl = document.getElementById("dq-issues");
  if (issuesEl) {
    if (issues.length === 0) {
      issuesEl.innerHTML = `<span style="font-size:12px;color:#6dbf67;font-weight:600;">Tidak ada masalah terdeteksi</span>`;
    } else {
      issuesEl.innerHTML = issues.map(isu =>
        `<span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${isu.color}22;color:${isu.color};border:1px solid ${isu.color}44;">
          ${isu.label}
        </span>`
      ).join("");
    }
  }

  // ── BADGE TIPE DATASET ─────────────────────────────────────
  const numCols = hdrs.filter(h => ctypes[h] === "numeric").length;
  const catCols = hdrs.filter(h => ctypes[h] === "categorical").length;
  const dtCols  = hdrs.filter(h => ctypes[h] === "datetime").length;

  let datasetType = "";
  let datasetTypeColor = "";
  let datasetTypeBg = "";

  if (numCols > 0 && catCols > 0) {
    datasetType = "Dataset Campuran (Numerik + Kategorik)";
    datasetTypeColor = "#7a3a80";
    datasetTypeBg = "#f5f0ff";
  } else if (numCols > 0 && catCols === 0) {
    datasetType = "Dataset Numerik";
    datasetTypeColor = "#1a5276";
    datasetTypeBg = "#e8f4ff";
  } else if (catCols > 0 && numCols === 0) {
    datasetType = "Dataset Kategorik";
    datasetTypeColor = "#7a1560";
    datasetTypeBg = "#fff0f8";
  } else {
    datasetType = "Dataset Tidak Terdeteksi";
    datasetTypeColor = "#888";
    datasetTypeBg = "#f5f5f5";
  }

  const typeEl = document.getElementById("dq-dataset-type");
  if (typeEl) {
    typeEl.style.display = "flex";
    typeEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <span style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${datasetTypeBg};color:${datasetTypeColor};border:1px solid ${datasetTypeColor}33;">
          ${datasetType}
        </span>
        ${numCols > 0 ? `<span style="padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;background:#e8f4ff;color:#2270b8;border:1px solid #a8cdef55;">${numCols} Numerik</span>` : ''}
        ${catCols > 0 ? `<span style="padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;background:#fff0f8;color:#b84280;border:1px solid #f4aecf55;">${catCols} Kategorik</span>` : ''}
        ${dtCols > 0 ? `<span style="padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;background:#f0fff4;color:#4a8020;border:1px solid #b8d96e55;">${dtCols} Datetime</span>` : ''}
      </div>
    `;
  }

  card.style.display = "block";
  const placeholder = document.getElementById("dq-placeholder");
  if (placeholder) placeholder.style.display = "none";
}

function showFileInfo(file) {
  const numCols = headers.filter((h) => colTypes[h] === "numeric").length;
  const catCols = headers.filter(
    (h) => colTypes[h] === "categorical",
  ).length;
  const dtCols = headers.filter((h) => colTypes[h] === "datetime").length;
  let missing = 0;
  rawData.forEach((row) =>
    headers.forEach((h) => {
      if (row[h] === "" || row[h] === null || row[h] === undefined)
        missing++;
    }),
  );
  const missingPct = (
    (missing / (rawData.length * headers.length)) *
    100
  ).toFixed(2);

  const grid = document.getElementById("file-info-grid");
  grid.innerHTML = `
    <div class="stat-card card-colored yellow">
<div class="stat-label">Total Baris</div>
<div class="stat-value">${rawData.length.toLocaleString()}</div>
<div class="stat-sub">records</div>
    </div>
    <div class="stat-card card-colored pink">
<div class="stat-label">Total Kolom</div>
<div class="stat-value">${headers.length}</div>
<div class="stat-sub">${numCols} numerik · ${catCols} kategorik · ${dtCols} datetime</div>
    </div>
    <div class="stat-card card-colored green">
<div class="stat-label">Ukuran File</div>
<div class="stat-value">${(file.size / 1024).toFixed(1)}<span style="font-size:16px">KB</span></div>
<div class="stat-sub">${file.name}</div>
    </div>
    <div class="stat-card ${missing > 0 ? "card-colored peach" : "card-colored blue"}">
<div class="stat-label">Missing Cells</div>
<div class="stat-value">${missing.toLocaleString()}</div>
<div class="stat-sub">${missingPct}% dari total data</div>
    </div>
  `;

  // Tampilkan tombol analisis setelah file berhasil dimuat
  const analyzeBtn = document.getElementById("analyze-btn-wrap");
  if (analyzeBtn) {
    analyzeBtn.style.display = "block";
    const btnText = document.getElementById("analyze-btn-text");
    if (btnText) btnText.innerHTML = `Lakukan Analisis Dataset <span style="color:#fff;opacity:0.8;">(${fileName})</span>`;
  }
}

function clearData() {
  showConfirm("Hapus data aktif saat ini? Histori tidak akan dihapus.", () => {
    rawData = [];
    cleanData = [];
    headers = [];
    colTypes = {};
    cleaningLog = [];
    fileName = "";
    document.getElementById("file-info-card").style.display = "none";
    document.getElementById("upload-guide").style.display = "block";
    document.getElementById("file-input").value = "";
    document.getElementById("summary-dashboard-section").style.display = "none";
    document.getElementById("upload-main-section").style.display = "block";
    document.getElementById("analyze-btn-wrap").style.display = "none";
    updateBadge("Belum ada file");
    resetAllDashboardState();
    showNotif("Data aktif telah dihapus!", "info");
  });
}

function resetAllDashboardState() {
  // Reset semua chart instances
  Object.keys(chartInstances).forEach(id => {
    try {
      if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
      }
    } catch(e) {}
  });
  chartInstances = {};

  // Reset cleaning
  const cleaningLog = document.getElementById("cleaning-log");
  if (cleaningLog) cleaningLog.innerHTML = "";
  const cleanQualityContent = document.getElementById("clean-quality-content");
  if (cleanQualityContent) cleanQualityContent.innerHTML = "";
  const cleaningAlerts = document.getElementById("cleaning-alerts");
  if (cleaningAlerts) { cleaningAlerts.innerHTML = ""; delete cleaningAlerts.dataset.rendered; }
  const beforeStats = document.getElementById("before-stats");
  if (beforeStats) beforeStats.innerHTML = "";
  const afterStats = document.getElementById("after-stats");
  if (afterStats) afterStats.innerHTML = "";
  const cleanPreview = document.getElementById("clean-preview-container");
  if (cleanPreview) cleanPreview.innerHTML = "";
  const dupDetail = document.getElementById("dup-detail");
  if (dupDetail) dupDetail.innerHTML = "";

  // Reset preview
  const previewContainer = document.getElementById("preview-container");
  if (previewContainer) previewContainer.innerHTML = "";
  const previewPagination = document.getElementById("preview-pagination");
  if (previewPagination) previewPagination.innerHTML = "";
  const previewPageInfo = document.getElementById("preview-page-info");
  if (previewPageInfo) previewPageInfo.textContent = "";
  const colTypeList = document.getElementById("col-type-list");
  if (colTypeList) colTypeList.innerHTML = "";
  const previewNoData = document.getElementById("preview-no-data");
  if (previewNoData) previewNoData.style.display = "block";
  const previewWrap = document.getElementById("preview-table-wrap");
  if (previewWrap) previewWrap.style.display = "none";
  const previewColInfo = document.getElementById("preview-col-info");
  if (previewColInfo) previewColInfo.style.display = "none";
  const previewSearch = document.getElementById("preview-search");
  if (previewSearch) previewSearch.value = "";

  // Reset stats
  const numTbody = document.getElementById("num-stats-tbody");
  if (numTbody) numTbody.innerHTML = "";
  const catTbody = document.getElementById("cat-stats-tbody");
  if (catTbody) catTbody.innerHTML = "";
  const uniqueCatCards = document.getElementById("unique-category-cards");
  if (uniqueCatCards) uniqueCatCards.innerHTML = "";
  const statsNoData = document.getElementById("stats-no-data");
  if (statsNoData) statsNoData.style.display = "flex";
  const statsContent = document.getElementById("stats-content");
  if (statsContent) statsContent.style.display = "none";

  // Reset visualisasi
  const vizNoData = document.getElementById("viz-no-data");
  if (vizNoData) vizNoData.style.display = "flex";
  const vizContent = document.getElementById("viz-content");
  if (vizContent) vizContent.style.display = "none";
  const numVizInsight = document.getElementById("num-viz-insight");
  if (numVizInsight) numVizInsight.innerHTML = "";
  const catVizInsight = document.getElementById("cat-viz-insight");
  if (catVizInsight) catVizInsight.innerHTML = "";
  const bivVizInsight = document.getElementById("biv-viz-insight");
  if (bivVizInsight) bivVizInsight.innerHTML = "";
  const mvVizInsight = document.getElementById("mv-viz-insight");
  if (mvVizInsight) mvVizInsight.innerHTML = "";
  const cnVizInsight = document.getElementById("cn-viz-insight");
  if (cnVizInsight) cnVizInsight.innerHTML = "";
  const pairPlotContainer = document.getElementById("pair-plot-container");
  if (pairPlotContainer) pairPlotContainer.innerHTML = "";
  const mvColCheckboxes = document.getElementById("mv-col-checkboxes");
  if (mvColCheckboxes) mvColCheckboxes.innerHTML = "";
  ["num-col-select","cat-col-select","biv-x","biv-y","cn-cat","cn-num"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- Pilih --</option>';
  });

  // Reset time series
  const tsNoData = document.getElementById("ts-no-data");
  if (tsNoData) tsNoData.style.display = "flex";
  const tsNoDatetime = document.getElementById("ts-no-datetime");
  if (tsNoDatetime) tsNoDatetime.style.display = "none";
  const tsContent = document.getElementById("ts-content");
  if (tsContent) tsContent.style.display = "none";
  const tsSummary = document.getElementById("ts-summary-content");
  if (tsSummary) tsSummary.innerHTML = "";
  ["ts-line-chart","ts-ma-chart","ts-roll-chart","ts-trend-chart"].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  // Reset insight
  const insightNoData = document.getElementById("insight-no-data");
  if (insightNoData) insightNoData.style.display = "flex";
  const insightContent = document.getElementById("insight-content");
  if (insightContent) insightContent.style.display = "none";
  ["insight-interpretasi","num-insights","cat-insights","corr-insights","ts-insights","insight-rekomendasi"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });

  // Reset report
  const reportSummary = document.getElementById("report-summary-content");
  if (reportSummary) reportSummary.innerHTML = `<div class="no-data"><div class="icon"></div><h3>Belum ada data untuk dilaporkan</h3></div>`;

  // Reset summary dashboard
  const summarySection = document.getElementById("summary-dashboard-section");
  if (summarySection) { summarySection.style.display = "none"; summarySection.innerHTML = ""; }

  // Reset dataset quality card
  const card = document.getElementById("dataset-quality-card");
  if (card) card.style.display = "none";
  const placeholder = document.getElementById("dq-placeholder");
  if (placeholder) {
    placeholder.style.display = "block";
    placeholder.innerHTML = `<div style="margin-bottom:12px;display:flex;justify-content:center;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><div style="font-size:13px;color:#bbb;line-height:1.7;">Upload file untuk melihat kualitas dataset</div>`;
  }
  const dqType = document.getElementById("dq-dataset-type");
  if (dqType) { dqType.style.display = "none"; dqType.innerHTML = ""; }

  // Reset file info
  const fileInfoGrid = document.getElementById("file-info-grid");
  if (fileInfoGrid) fileInfoGrid.innerHTML = "";

  // Reset global state
  window.cleaningLogArr = [];
  previewPage = 1;
  filteredData = [];
}

// ===== SAMPLE DATA =====
async function loadSampleData() {
  showNotif("Memuat sample data...", "info");
  try {
    const res = await fetch("/sample-data");
    const json = await res.json();
    if (json.error) { showNotif(json.error, "error!"); return; }

    rawData = json.data;
    headers = json.columns;
    detectColTypes();
    cleanData = JSON.parse(JSON.stringify(rawData));
    cleaningLog = [];
    fileName = json.fileName;
    updateBadge(json.fileName);

    const fakeFile = { name: json.fileName, size: 0 };
    showFileInfo(fakeFile);
    document.getElementById("file-info-card").style.display = "block";
    document.getElementById("upload-guide").style.display = "none";
    renderDatasetQualityCard(fakeFile, rawData, headers, colTypes);
    addToHistory(fakeFile, rawData, headers, colTypes);
    showNotif(`Sample data <b>${json.fileName}</b> dimuat! (${rawData.length} baris)`, "success");
  } catch(e) {
    showNotif("Gagal memuat sample data: " + e.message, "error!");
  }
}

// ===== PREVIEW =====
let previewPage = 1;
let filteredData = [];
let cleanPreviewPage = 1;

function filterPreview() {
  const q = document.getElementById("preview-search").value.toLowerCase();
  filteredData = rawData.filter((row) =>
    headers.some((h) => String(row[h]).toLowerCase().includes(q)),
  );
  previewPage = 1;
  renderPreview();
}

function renderPreview() {
  const noData = document.getElementById("preview-no-data");
  const wrap = document.getElementById("preview-table-wrap");
  const colInfo = document.getElementById("preview-col-info");
  if (!rawData.length) {
    noData.style.display = "block";
    wrap.style.display = "none";
    colInfo.style.display = "none";
    return;
  }
  noData.style.display = "none";
  wrap.style.display = "block";
  colInfo.style.display = "block";

  const q = document.getElementById("preview-search").value.toLowerCase();
  filteredData = q
    ? rawData.filter((row) =>
        headers.some((h) => String(row[h]).toLowerCase().includes(q)),
      )
    : rawData;

  const sizeVal = document.getElementById("preview-page-size").value;
  const pageSize =
    sizeVal === "all" ? filteredData.length : parseInt(sizeVal);
  const totalPages = Math.ceil(filteredData.length / pageSize);
  if (previewPage > totalPages) previewPage = 1;

  const start = (previewPage - 1) * pageSize;
  const pageData = filteredData.slice(start, start + pageSize);

  // Build table
  const container = document.getElementById("preview-container");
  let html = `<table class="data-table"><thead><tr><th>#</th>`;
  headers.forEach((h) => {
    const t = colTypes[h];
    html += `<th>${h}</th>`;
  });
  html += "</tr></thead><tbody>";
  pageData.forEach((row, i) => {
    html += `<tr><td style="color:var(--text-muted);font-size:11px;">${start + i + 1}</td>`;
    headers.forEach((h) => {
      const v = row[h];
      const empty = v === "" || v === null || v === undefined;
      html += `<td style="${empty ? "color:var(--danger);font-style:italic;" : ""}">${empty ? "null" : v}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  container.innerHTML = html;

  // Pagination
  const info = document.getElementById("preview-page-info");
  info.textContent = `Menampilkan ${start + 1}–${Math.min(start + pageSize, filteredData.length)} dari ${filteredData.length} baris`;

  const pg = document.getElementById("preview-pagination");
  if (sizeVal === "all" || totalPages <= 1) {
    pg.innerHTML = "";
    return;
  }
  let pgHtml = "";
  const showPgs = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) showPgs.push(i);
  } else {
    showPgs.push(1);
    if (previewPage > 3) showPgs.push("...");
    for (
      let i = Math.max(2, previewPage - 1);
      i <= Math.min(totalPages - 1, previewPage + 1);
      i++
    )
      showPgs.push(i);
    if (previewPage < totalPages - 2) showPgs.push("...");
    showPgs.push(totalPages);
  }
  pgHtml += `<button class="page-btn" onclick="changePrevPg()" ${previewPage === 1 ? "disabled" : ""}>‹</button>`;
  showPgs.forEach((p) => {
    if (p === "...")
      pgHtml += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
    else
      pgHtml += `<button class="page-btn ${p === previewPage ? "active" : ""}" onclick="setPreviewPage(${p})">${p}</button>`;
  });
  pgHtml += `<button class="page-btn" onclick="changeNextPg(${totalPages})" ${previewPage === totalPages ? "disabled" : ""}>›</button>`;
  pg.innerHTML = pgHtml;

  // Col types
  const colList = document.getElementById("col-type-list");
  colList.innerHTML = headers
    .map((h) => {
      const t = colTypes[h];
      const cls =
        t === "numeric"
          ? "tag-numeric"
          : t === "datetime"
            ? "tag-datetime"
            : "tag-categorical";
      return `<span class="tag ${cls}">${h}</span>`;
    })
    .join("");
  document.getElementById("preview-subtitle").textContent =
    `Seluruh ${rawData.length} baris data · ${headers.length} kolom`;
}

function setPreviewPage(p) {
  previewPage = p;
  renderPreview();
}
function changePrevPg() {
  if (previewPage > 1) {
    previewPage--;
    renderPreview();
  }
}
function changeNextPg(total) {
  if (previewPage < total) {
    previewPage++;
    renderPreview();
  }
}

// ===== CLEANING =====
let dupCount = 0;
let missingBefore = {};
let missingAfter = {};

function renderCleaning() {
  if (!rawData.length) {
    document.getElementById("cleaning-no-data").style.display = "flex";
    document.getElementById("cleaning-content").style.display = "none";
    return;
  }
  document.getElementById("cleaning-no-data").style.display = "none";
  document.getElementById("cleaning-content").style.display = "block";
  analyzeCleaning();
}

function analyzeCleaning() {
  // Count duplicates in cleanData
  const seen = new Set();
  dupCount = 0;
  cleanData.forEach((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) dupCount++;
    else seen.add(key);
  });

  // Missing per col in raw
  missingBefore = {};
  headers.forEach((h) => {
    missingBefore[h] = rawData.filter(
      (r) => r[h] === "" || r[h] === null || r[h] === undefined,
    ).length;
  });
  missingAfter = {};
  headers.forEach((h) => {
    missingAfter[h] = cleanData.filter(
      (r) => r[h] === "" || r[h] === null || r[h] === undefined,
    ).length;
  });

  renderAlerts();
  renderBeforeAfter();
  //renderMissingTable();
  renderDupDetail();
  renderCleanPreview();
  renderCleanQualityCard();
}

function renderAlerts() {
  const container = document.getElementById("cleaning-alerts");
  // Hanya render sekali dari rawData (before cleaning), tidak diupdate ulang
  if (container.dataset.rendered === "1") return;
  let html = "";
  const totalMissing = Object.values(missingBefore).reduce((a, b) => a + b, 0);
  const totalCells = rawData.length * headers.length;
  const missingPct = ((totalMissing / totalCells) * 100).toFixed(1);

  const iconDanger = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  const iconWarning = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const iconInfo = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  const iconSuccess = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg>`;

  if (parseFloat(missingPct) > 20) {
    html += `<div class="alert alert-danger"><span class="alert-icon">${iconDanger}</span><div><strong>DANGER: Missing Values Tinggi (${missingPct}%)</strong>Dataset memiliki lebih dari 20% nilai kosong. Perlu penanganan serius sebelum analisis.</div></div>`;
  } else if (parseFloat(missingPct) > 5) {
    html += `<div class="alert alert-warning"><span class="alert-icon">${iconWarning}</span><div><strong>WARNING: Ada Missing Values (${missingPct}%)</strong>Terdapat ${totalMissing} nilai kosong. Disarankan untuk ditangani sebelum analisis.</div></div>`;
  } else if (totalMissing > 0) {
    html += `<div class="alert alert-info"><span class="alert-icon">${iconInfo}</span><div><strong>INFO: Missing Values Minor (${missingPct}%)</strong>Ada ${totalMissing} nilai kosong namun masih dalam batas aman.</div></div>`;
  } else {
    html += `<div class="alert alert-success"><span class="alert-icon">${iconSuccess}</span><div><strong>SAFE: Tidak Ada Missing Values</strong>Dataset bersih dari nilai kosong.</div></div>`;
  }

  if (dupCount > 0) {
    html += `<div class="alert alert-warning"><span class="alert-icon">${iconWarning}</span><div><strong>WARNING: Duplikat Terdeteksi</strong>Ditemukan ${dupCount} baris duplikat (${((dupCount / rawData.length) * 100).toFixed(1)}%). Disarankan untuk dihapus.</div></div>`;
  } else {
    html += `<div class="alert alert-success"><span class="alert-icon">${iconSuccess}</span><div><strong>SAFE: Tidak Ada Duplikat</strong>Setiap baris data adalah unik.</div></div>`;
  }

  headers.forEach((h) => {
    const pct = ((missingBefore[h] / rawData.length) * 100).toFixed(1);
    if (parseFloat(pct) > 30) {
      html += `<div class="alert alert-warning"><span class="alert-icon">${iconWarning}</span><div><strong>WARNING: Kolom "${h}" — ${pct}% missing</strong>Kolom ini sangat banyak nilai kosong. Pertimbangkan untuk menghapus kolom atau imputasi.</div></div>`;
    }
  });

  if (!html)
    html = `<div class="alert alert-success"><span class="alert-icon">${iconSuccess}</span><div><strong>SAFE: Dataset dalam kondisi baik</strong>Tidak ada masalah kritis yang terdeteksi.</div></div>`;
  container.innerHTML = html;
  container.dataset.rendered = "1";
}

function renderBeforeAfter() {
  const beforeMissing = Object.values(missingBefore).reduce((a, b) => a + b, 0);
  const afterMissing  = Object.values(missingAfter).reduce((a, b) => a + b, 0);
  const afterDupCheck = new Set();
  let afterDups = 0;
  cleanData.forEach((row) => {
    const k = JSON.stringify(row);
    if (afterDupCheck.has(k)) afterDups++;
    else afterDupCheck.add(k);
  });

  function statRow(label, value, valueColor) {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
        <span style="font-size:13px;color:#555;font-weight:500;">${label}</span>
        <span style="font-size:15px;font-weight:700;color:${valueColor};">${value}</span>
      </div>`;
  }

  document.getElementById("before-stats").innerHTML = `
    <div style="display:flex;flex-direction:column;">
      ${statRow("Total Baris", rawData.length.toLocaleString(), "#1a1a1a")}
      ${statRow("Missing Values", beforeMissing, beforeMissing > 0 ? "#c0392b" : "#1a7a2a")}
      ${statRow("Duplikat", dupCount, dupCount > 0 ? "#c0392b" : "#1a7a2a")}
      ${statRow("Total Kolom", headers.length, "#1a1a1a")}
    </div>
  `;
  document.getElementById("after-stats").innerHTML = `
    <div style="display:flex;flex-direction:column;">
      ${statRow("Total Baris", cleanData.length.toLocaleString(), "#1a1a1a")}
      ${statRow("Missing Values", afterMissing, afterMissing > 0 ? "#c0392b" : "#1a7a2a")}
      ${statRow("Duplikat", afterDups, afterDups > 0 ? "#c0392b" : "#1a7a2a")}
      ${statRow("Total Kolom", headers.length, "#1a1a1a")}
    </div>
  `;
  renderCleanPreview();
}

function renderCleanQualityCard() {
  const el = document.getElementById("clean-quality-content");
  if (!el) return;
  if (!cleanData.length) {
    el.innerHTML = "";
    return;
  }

  const { score, issues } = computeDatasetQuality(cleanData, headers, colTypes);
  const color = score >= 80 ? "#1a7a2a" : score >= 60 ? "#b8660a" : "#c0392b";
  const label = score >= 95 ? "Sangat Baik" : score >= 80 ? "Baik" : score >= 60 ? "Cukup" : "Perlu Perhatian";

  // Hitung duplikat setelah cleaning
  const cleanSeen = new Set(); let cleanDupCount = 0;
  cleanData.forEach(row => {
    const k = JSON.stringify(row);
    if (cleanSeen.has(k)) cleanDupCount++;
    else cleanSeen.add(k);
  });

  // Missing setelah cleaning
  const cleanMissing = headers.reduce((acc, h) =>
    acc + cleanData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length, 0);

  el.innerHTML = `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:12px;color:#666;">Skor Kualitas</span>
        <span style="font-size:18px;font-weight:800;color:${color};">${score}%</span>
      </div>
      <div style="background:#e0e8f0;border-radius:10px;height:10px;overflow:hidden;margin-bottom:6px;">
        <div style="background:${color};height:100%;border-radius:10px;width:0%;transition:width 0.8s ease;" id="clean-quality-bar"></div>
      </div>
      <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:10px;">${label}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${cleanMissing > 0 ? '#c0392b' : '#1a7a2a'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${cleanMissing > 0 ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' : '<rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/>'}</svg>
        <span style="color:${cleanMissing > 0 ? '#c0392b' : '#1a7a2a'};font-weight:600;">${cleanMissing > 0 ? cleanMissing + ' missing values' : 'Tidak ada missing values'}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${cleanDupCount > 0 ? '#c0392b' : '#1a7a2a'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${cleanDupCount > 0 ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' : '<rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/>'}</svg>
        <span style="color:${cleanDupCount > 0 ? '#c0392b' : '#1a7a2a'};font-weight:600;">${cleanDupCount > 0 ? cleanDupCount + ' baris duplikat' : 'Tidak ada duplikat'}</span>
      </div>
      ${issues.length === 0 ? `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:4px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg>
        <span style="color:#1a7a2a;font-weight:600;">Semua baris unik</span>
      </div>
      <div style="margin-top:8px;padding:8px 10px;background:#e8f8e8;border-radius:8px;font-size:11px;color:#1a7a2a;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg>
        Dataset siap dianalisis
      </div>
      ` : issues.map(i => `<span style="font-size:11px;color:${i.color};background:${i.color}22;padding:3px 8px;border-radius:12px;border:1px solid ${i.color}44;">${i.label}</span>`).join("")}
    </div>
  `;

  // Animasi bar
  setTimeout(() => {
    const bar = document.getElementById("clean-quality-bar");
    if (bar) bar.style.width = score + "%";
  }, 80);
}

function renderMissingTable() {
  const tbody = document.getElementById("missing-tbody");
  tbody.innerHTML = headers
    .map((h) => {
      const cnt = missingBefore[h];
      const pct = ((cnt / rawData.length) * 100).toFixed(1);
      const t = colTypes[h];
      let status, badgeClass;
      if (parseFloat(pct) === 0) {
        status = " Bersih";
        badgeClass = "tag-success";
      } else if (parseFloat(pct) <= 5) {
        status = " Minor";
        badgeClass = "tag-warning";
      } else if (parseFloat(pct) <= 20) {
        status = " Perlu Perhatian";
        badgeClass = "tag-warning";
      } else {
        status = " Kritis";
        badgeClass = "tag-danger";
      }
      const typeBadge =
        t === "numeric"
          ? "tag-numeric"
          : t === "datetime"
            ? "tag-datetime"
            : "tag-categorical";
      return `<tr>
<td><strong>${h}</strong></td>
<td><span class="tag ${typeBadge}">${t}</span></td>
<td>${cnt}</td>
<td>
  <div style="display:flex;align-items:center;gap:8px;">
    <div class="progress-bar" style="width:80px;">
      <div class="progress-fill" style="width:${Math.min(parseFloat(pct), 100)}%;background:${parseFloat(pct) > 20 ? "var(--danger)" : parseFloat(pct) > 5 ? "var(--warning)" : "var(--success)"}"></div>
    </div>
    ${pct}%
  </div>
</td>
<td><span class="tag ${badgeClass}">${status}</span></td>
    </tr>`;
    })
    .join("");
}

function renderDupDetail() {
  const el = document.getElementById("dup-detail");
  if (!el) return;
  if (dupCount === 0) {
    el.innerHTML = `<div class="alert alert-success">
      <span class="alert-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a7a2a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="20" x="2" y="2" rx="5"/>
          <polyline points="7 13 10 16 17 9"/>
        </svg>
      </span>
      <div><strong>Tidak ada duplikat ditemukan</strong>Semua baris unik.</div>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div class="alert alert-warning"><span class="alert-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </span><div><strong>${dupCount} baris duplikat ditemukan</strong> (${((dupCount / rawData.length) * 100).toFixed(1)}% dari data). Klik "Hapus Duplikat" untuk membersihkan.</div></div>
  `;
}

function removeDuplicates() {
  showConfirm("Hapus semua baris duplikat dari data?", () => {
    showLoadingBar("Menghapus duplikat...", 700, () => {
      const before = cleanData.length;
      const seen = new Set();
      cleanData = cleanData.filter((row) => {
        const k = JSON.stringify(row);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const removed = before - cleanData.length;
      if (removed === 0) {
        addCleaningLog(`Tidak ada duplikat ditemukan. Data sudah bersih.`);
        showNotif("Tidak ada duplikat ditemukan.", "success");
      } else {
        addCleaningLog(`Hapus Duplikat: ${removed} baris dihapus. Sisa: ${cleanData.length} baris.`);
        showNotif(`<b>${removed}</b> baris duplikat berhasil dihapus.`, "success");
      }
      analyzeCleaning();
      renderBeforeAfter();
      renderCleanPreview();
    });
  });
}

function handleMissingValues() {
  showConfirm(
    "Anda yakin ingin mengganti semua missing value numerik dengan mean, kategorik dengan modus?",
    () => {
      showLoadingBar("Menangani missing values...", 800, () => {
        let filled = 0;
        headers.forEach((h) => {
          if (colTypes[h] === "numeric") {
            const vals = cleanData.map((r) => parseFloat(r[h])).filter((v) => !isNaN(v));
            if (!vals.length) return;
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            cleanData.forEach((r) => {
              if (r[h] === "" || r[h] === null || r[h] === undefined) { r[h] = mean.toFixed(2); filled++; }
            });
          } else {
            const vals = cleanData.map((r) => r[h]).filter((v) => v !== "" && v !== null && v !== undefined);
            if (!vals.length) return;
            const freq = {};
            vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
            const mode = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
            cleanData.forEach((r) => {
              if (r[h] === "" || r[h] === null || r[h] === undefined) { r[h] = mode; filled++; }
            });
          }
        });
        addCleaningLog(`Handle Missing: ${filled} nilai diisi (numerik → mean, kategorik → modus).`);
        showNotif(`<b>${filled}</b> nilai missing telah diisi.`, "success");
        analyzeCleaning();
        renderBeforeAfter();
        renderCleanPreview();
      });
    }
  );
}

function standardizeCategories() {
  showConfirm(
    "Anda yakin ingin menstandarisasi semua variabel kategori pada dataset anda?",
    () => {
      showLoadingBar("Menstandarisasi kategori...", 800, () => {
        if (!cleanData.length) return;
        const invalidPatterns = new Set(["???","---","--","-","999","unknown","na","n/a","null","","undefined","nan"]);
        const aliasMap = {"m":"Male","f":"Female","bachelor degree":"Bachelor","s1":"Bachelor","magister":"Master","s2":"Master","doctor":"Doctoral","s3":"Doctoral","snr manager":"Senior Manager","sr manager":"Senior Manager","lakilaki":"Male","perempuan":"Female",
          "laki-laki":"Male","perempuan":"Female","laki laki":"Male","ya":"Yes","tidak":"No","true":"Yes","false":"No","x dept":"Unknown","xdept":"Unknown","x department":"Unknown","x departement":"Unknown","unknown dept":"Unknown","unknown department":"Unknown","other":"Unknown","others":"Unknown","lainnya":"Unknown","lain lain":"Unknown","lain-lain":"Unknown","tidak diketahui":"Unknown"};
        const identifierKeywords = ["id","name","nama","ticket","code","kode","number","no","passport","cabin"];
        const rareThreshold = 0.03;
        const catCols = headers.filter(h => colTypes[h] === "categorical");
        let totalStandardized = 0;
        catCols.forEach(col => {
          if (identifierKeywords.some(k => col.toLowerCase().includes(k))) return;
          const allVals = cleanData.map(r => { let v = String(r[col] ?? "").trim().toLowerCase(); v = v.replace(/[^a-zA-Z0-9\s]/g,""); return v; });
          const total = allVals.length;
          const freq = {}; allVals.forEach(v => { freq[v]=(freq[v]||0)+1; });
          const rareSet = new Set(Object.entries(freq).filter(([,count])=>count/total<rareThreshold).map(([v])=>v));
          cleanData.forEach(r => {
            let v = String(r[col] ?? "").trim().toLowerCase(); v = v.replace(/[^a-zA-Z0-9\s]/g,"");
            if (invalidPatterns.has(v)) { r[col]="Unknown"; totalStandardized++; return; }
            if (aliasMap[v]) { r[col]=aliasMap[v]; totalStandardized++; return; }
            if (rareSet.has(v)) { r[col]="Unknown"; totalStandardized++; return; }
            const titled = v.replace(/\b\w/g, c=>c.toUpperCase());
            if (titled !== r[col]) totalStandardized++;
            r[col] = titled;
          });
        });
        addCleaningLog(`Standarisasi Kategori: ${totalStandardized} nilai distandarisasi pada ${catCols.length} kolom.`);
        showNotif(`<b>${totalStandardized}</b> nilai kategori distandarisasi.`, "success");
        analyzeCleaning();
        renderBeforeAfter();
        renderCleanPreview();
      });
    }
  );
}

function applyAllCleaning() {
  showConfirm(
    "Terapkan semua proses cleaning sekaligus? (Hapus duplikat + Handle missing values + Standardisasi kategori)",
    () => {
      showLoadingBar("Menerapkan semua cleaning...", 1200, () => {
        let totalLog = [];

        // 1. Hapus duplikat
        const before = cleanData.length;
        const seen = new Set();
        cleanData = cleanData.filter((row) => {
          const k = JSON.stringify(row);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const removed = before - cleanData.length;
        if (removed > 0) {
          totalLog.push(`Hapus Duplikat: ${removed} baris dihapus.`);
        }

        // 2. Handle missing values
        let filled = 0;
        headers.forEach((h) => {
          if (colTypes[h] === "numeric") {
            const vals = cleanData.map((r) => parseFloat(r[h])).filter((v) => !isNaN(v));
            if (!vals.length) return;
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            cleanData.forEach((r) => {
              if (r[h] === "" || r[h] === null || r[h] === undefined) {
                r[h] = mean.toFixed(2);
                filled++;
              }
            });
          } else {
            const vals = cleanData.map((r) => r[h]).filter((v) => v !== "" && v !== null && v !== undefined);
            if (!vals.length) return;
            const freq = {};
            vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
            const mode = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
            cleanData.forEach((r) => {
              if (r[h] === "" || r[h] === null || r[h] === undefined) {
                r[h] = mode;
                filled++;
              }
            });
          }
        });
        if (filled > 0) {
          totalLog.push(`Handle Missing: ${filled} nilai diisi (numerik → mean, kategorik → modus).`);
        }

        // 3. Standardisasi kategori
        const invalidPatterns = new Set(["???","---","--","-","999","unknown","na","n/a","null","","undefined","nan"]);
        const aliasMap = {"m":"Male","f":"Female","bachelor degree":"Bachelor","s1":"Bachelor","magister":"Master","s2":"Master","doctor":"Doctoral","s3":"Doctoral","snr manager":"Senior Manager","sr manager":"Senior Manager","lakilaki":"Male","perempuan":"Female","laki-laki":"Male","perempuan":"Female","laki laki":"Male","ya":"Yes","tidak":"No","true":"Yes","false":"No","x dept":"Unknown","xdept":"Unknown","x department":"Unknown","x departement":"Unknown","unknown dept":"Unknown","unknown department":"Unknown","other":"Unknown","others":"Unknown","lainnya":"Unknown","lain lain":"Unknown","lain-lain":"Unknown","tidak diketahui":"Unknown"};
        const identifierKeywords = ["id","name","nama","ticket","code","kode","number","no","passport","cabin"];
        const rareThreshold = 0.03;
        const catCols = headers.filter(h => colTypes[h] === "categorical");
        let totalStandardized = 0;
        catCols.forEach(col => {
          if (identifierKeywords.some(k => col.toLowerCase().includes(k))) return;
          const allVals = cleanData.map(r => { let v = String(r[col] ?? "").trim().toLowerCase(); v = v.replace(/[^a-zA-Z0-9\s]/g,""); return v; });
          const total = allVals.length;
          const freq = {}; allVals.forEach(v => { freq[v]=(freq[v]||0)+1; });
          const rareSet = new Set(Object.entries(freq).filter(([,count])=>count/total<rareThreshold).map(([v])=>v));
          cleanData.forEach(r => {
            let v = String(r[col] ?? "").trim().toLowerCase(); v = v.replace(/[^a-zA-Z0-9\s]/g,"");
            if (invalidPatterns.has(v)) { r[col]="Unknown"; totalStandardized++; return; }
            if (aliasMap[v]) { r[col]=aliasMap[v]; totalStandardized++; return; }
            if (rareSet.has(v)) { r[col]="Unknown"; totalStandardized++; return; }
            const titled = v.replace(/\b\w/g, c=>c.toUpperCase());
            if (titled !== r[col]) totalStandardized++;
            r[col] = titled;
          });
        });
        if (totalStandardized > 0) {
          totalLog.push(`Standarisasi Kategori: ${totalStandardized} nilai distandarisasi.`);
        }

        // Log & refresh
        totalLog.forEach(msg => addCleaningLog(msg));
        showNotif(`Semua cleaning selesai! ${totalLog.join(" | ")}`, "success");
        analyzeCleaning();
        renderBeforeAfter();
        renderCleanPreview();
      });
    }
  );
}

function resetCleaning() {
  showConfirm("Reset semua perubahan cleaning? Data akan kembali ke kondisi awal.", () => {
    showLoadingBar("Mereset data cleaning...", 600, () => {
      cleanData = JSON.parse(JSON.stringify(rawData));
      cleaningLog = [];
      document.getElementById("cleaning-log").innerHTML = "";
      const alertsContainer = document.getElementById("cleaning-alerts");
      if (alertsContainer) delete alertsContainer.dataset.rendered;
      analyzeCleaning();
      renderCleanPreview();
      showNotif("Data cleaning direset ke kondisi awal.", "info");
    });
  });
}

function addCleaningLog(msg) {
  cleaningLog.push(msg);
  const el = document.getElementById("cleaning-log");
  el.innerHTML = cleaningLog
    .map(
      (m) =>
        `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">${m}</div>`,
    )
    .join("");
}

// ===== STATS =====
function renderStats() {
  const noData = document.getElementById("stats-no-data");
  const content = document.getElementById("stats-content");
  if (!cleanData.length) {
    noData.style.display = "flex";
    content.style.display = "none";
    return;
  }
  noData.style.display = "none";
  content.style.display = "block";

  const numCols = headers.filter((h) => colTypes[h] === "numeric" && !isUniqueCol(h, "numeric"));
const catCols = headers.filter((h) => colTypes[h] === "categorical" && !isUniqueCol(h, "categorical"));
  document.getElementById("num-col-count").textContent =
    `${numCols.length} variabel`;
  document.getElementById("cat-col-count").textContent =
    `${catCols.length} variabel`;

  // Numerical
  const numTbody = document.getElementById("num-stats-tbody");
  numTbody.innerHTML = numCols
    .map((col) => {
      const vals = cleanData
        .map((r) => parseFloat(r[col]))
        .filter((v) => !isNaN(v));
      if (!vals.length) return "";
      const s = calcNumStats(vals);
      const missing = cleanData.filter(
        (r) => r[col] === "" || r[col] === null || r[col] === undefined,
      ).length;
      const missingPct = ((missing / cleanData.length) * 100).toFixed(1);
      const distBadge = getDistBadge(s.skewness, s.kurtosis);
      const outliers = countOutliers(vals);
      const sorted2 = [...vals].sort((a,b)=>a-b);
      const rq1 = sorted2[Math.floor(sorted2.length*0.25)];
      const rq3 = sorted2[Math.floor(sorted2.length*0.75)];
      const rRange = s.max - s.min;
      const swPval = Math.abs(s.skewness) < 0.5 && Math.abs(s.kurtosis) < 1 ? "> 0.05 (Normal)" : "< 0.05 (Tidak Normal)";
      return `<tr>
<td><strong>${col}</strong></td>
<td>${fmt(s.mean)}</td>
<td>${fmt(s.median)}</td>
<td>${fmt(s.min)}</td>
<td>${fmt(s.max)}</td>
<td>${fmt(rRange)}</td>
<td>${fmt(rq1)}</td>
<td>${fmt(rq3)}</td>
<td>${fmt(s.std)}</td>
<td>${fmt(s.variance)}</td>
<td>${fmt(s.mode)}</td>
<td>${fmt(s.skewness)}</td>
<td>${fmt(s.kurtosis)}</td>
<td>${missing}</td>
<td>${missingPct}%</td>
<td>${distBadge}</td>
<td><span class="tag ${outliers > 0 ? "tag-warning" : "tag-success"}">${outliers}</span></td>
<td style="font-size:11px;">
  ${Math.abs(s.skewness) < 0.5 && Math.abs(s.kurtosis) < 1
    ? `<span style="color:#1a7a2a;font-weight:700;background:#e8f8e8;padding:2px 8px;border-radius:6px;font-size:11px;">Normal</span>`
    : `<span style="color:#c0392b;font-weight:700;background:#fde8e8;padding:2px 8px;border-radius:6px;font-size:11px;">Tidak Normal</span>`
  }
</td>
    </tr>`;
    })
    .join("");

  // Categorical
  const catTbody = document.getElementById("cat-stats-tbody");
  catTbody.innerHTML = catCols
    .map((col) => {
      const vals = cleanData
        .map((r) => r[col])
        .filter((v) => v !== "" && v !== null && v !== undefined);
      const freq = {};
      vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const mode = sorted[0]?.[0] || "-";
      const modeFreq = sorted[0]?.[1] || 0;
      const modePct = vals.length
        ? ((modeFreq / vals.length) * 100).toFixed(1)
        : 0;
      const missing = cleanData.length - vals.length;
      const missingPct = ((missing / cleanData.length) * 100).toFixed(1);
      const uniqueCount = Object.keys(freq).length;
      const topCats = sorted
        .slice(0, 3)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ");
      return `<tr>
<td><strong>${col}</strong></td>
<td>${uniqueCount}</td>
<td>${mode}</td>
<td>${modeFreq}</td>
<td>${modePct}%</td>
<td>${missing}</td>
<td>${missingPct}%</td>
<td style="font-size:11px;color:var(--text-muted);">${topCats}</td>
    </tr>`;
    })
    .join("");

  // Unique per category section
  renderUniqueCategories(catCols);
}

function renderUniqueCategories(catCols) {
  const container = document.getElementById("unique-category-cards");
  if (!catCols.length) {
    container.innerHTML = "";
    return;
  }
  let html = `<div class="section-title" style="font-size:16px;margin-bottom:14px;"> Detail Unique per Kolom Kategorik</div><div class="grid-3">`;
  catCols.forEach((col) => {
    const vals = cleanData
      .map((r) => r[col])
      .filter((v) => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const colors = [
      "var(--card-yellow)",
      "var(--card-pink)",
      "var(--card-green)",
      "var(--card-blue)",
      "var(--card-peach)",
    ];
    html += `<div class="card">
<div style="font-weight:700;margin-bottom:12px;font-size:14px;"> ${col}</div>
<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${sorted.length} kategori unik</div>
${sorted
  .slice(0, 8)
  .map(
    ([k, v], i) => `
  <div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
      <span>${k}</span><span style="color:var(--text-muted);">${v} (${((v / vals.length) * 100).toFixed(1)}%)</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${((v / vals.length) * 100).toFixed(1)}%;background:${colors[i % colors.length]};"></div>
    </div>
  </div>
`,
  )
  .join("")}
${sorted.length > 8 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">+${sorted.length - 8} kategori lainnya</div>` : ""}
    </div>`;
  });
  html += "</div>";
  container.innerHTML = html;
}

function switchStatsTab(tab) {
  document
    .querySelectorAll("#stats-tabs .tab-btn")
    .forEach((b, i) =>
      b.classList.toggle(
        "active",
        ["numerical", "categorical"][i] === tab,
      ),
    );
  document
    .getElementById("stats-numerical")
    .classList.toggle("active", tab === "numerical");
  document
    .getElementById("stats-categorical")
    .classList.toggle("active", tab === "categorical");
}

// ===== MATH HELPERS =====
function fmt(v) {
  if (v === undefined || v === null || isNaN(v)) return "-";
  return parseFloat(v).toLocaleString("id-ID", {
    maximumFractionDigits: 3,
  });
}

function calcNumStats(vals) {
  const n = vals.length;
  if (!n) return {};
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const variance =
    vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);
  const freq = {};
  vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
  const mode = parseFloat(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0],
  );
  const skewness =
    vals.reduce((a, b) => a + Math.pow((b - mean) / std, 3), 0) / n;
  const kurtosis =
    vals.reduce((a, b) => a + Math.pow((b - mean) / std, 4), 0) / n - 3;
  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[n - 1],
    std,
    variance,
    mode,
    skewness,
    kurtosis,
  };
}

function countOutliers(vals) {
  if (vals.length < 4) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  return vals.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr)
    .length;
}

function getDistBadge(skewness, kurtosis) {
  const sk = parseFloat(skewness);
  const kt = parseFloat(kurtosis);
  if (isNaN(sk)) return '<span class="dist-badge dist-normal">-</span>';
  if (Math.abs(sk) < 0.5 && Math.abs(kt) < 1)
    return '<span class="dist-badge dist-normal"> Relative Normal</span>';
  if (sk > 1)
    return '<span class="dist-badge dist-right-skewed">➡ Right Skewed</span>';
  if (sk < -1)
    return '<span class="dist-badge dist-left-skewed">⬅ Left Skewed</span>';
  if (Math.abs(kt) > 3)
    return '<span class="dist-badge dist-heavy-tailed">⬆ Heavy Tailed</span>';
  if (sk > 0.5)
    return '<span class="dist-badge dist-right-skewed">↗ Mild Right Skew</span>';
  if (sk < -0.5)
    return '<span class="dist-badge dist-left-skewed">↖ Mild Left Skew</span>';
  return '<span class="dist-badge dist-normal">≈ Approx Normal</span>';
}

// ===== VISUALIZATION =====
function destroyChart(id) {
  if (chartInstances[id]) {
    try {
      chartInstances[id].destroy();
    } catch(e) {}
    delete chartInstances[id];
  }
  // Juga destroy via Chart.js registry jika masih terdaftar
  const canvas = document.getElementById(id);
  if (canvas) {
    const existing = Chart.getChart(canvas);
    if (existing) {
      try { existing.destroy(); } catch(e) {}
    }
  }
}

// ===== KONSTANTA PENGECUALIAN VARIABEL UNIK =====
const NUM_EXCLUDE_PATTERNS = /^id$|^ID$|[\s_]id$|[\s_]ID$|_id$|^no$|^No$|^NO$|^no\.?$|^nomor$|^kode$|^index$|^idx$/i;
const CAT_EXCLUDE_PATTERNS = /^id$|^ID$|[\s_]id$|[\s_]ID$|_id$|^no$|^No$|^NO$|^no\.?$|^nomor$|^kode$|^kode[\s_]/i;

function isUniqueCol(col, type) {
  if (!cleanData.length) return false;
  const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
  const uniqueRatio = new Set(vals).size / vals.length;
  if (type === "categorical") {
    // Exclude jika nama cocok pattern, atau jika hampir setiap baris unik (uniqueRatio > 0.85) dan jumlah unique > 20
    if (CAT_EXCLUDE_PATTERNS.test(col)) return true;
    if (uniqueRatio > 0.85 && new Set(vals).size > 20) return true;
  }
  if (type === "numeric") {
    // Exclude jika nama cocok pattern ID
    if (NUM_EXCLUDE_PATTERNS.test(col)) return true;
    // Exclude jika semua nilai unik (persis seperti auto-increment ID)
    if (uniqueRatio === 1 && new Set(vals).size === cleanData.length) return true;
  }
  return false;
}

function initVizSelects() {
  const noData = document.getElementById("viz-no-data");
  const content = document.getElementById("viz-content");
  if (!cleanData.length) {
    noData.style.display = "flex";
    content.style.display = "none";
    return;
  }
  noData.style.display = "none";
  content.style.display = "block";

  const allNumCols = headers.filter((h) => colTypes[h] === "numeric");
  const allCatCols = headers.filter((h) => colTypes[h] === "categorical");

  const numCols = allNumCols.filter(h => !isUniqueCol(h, "numeric"));
  const catCols = allCatCols.filter(h => !isUniqueCol(h, "categorical"));

  // Pesan tidak ada kolom di tab numerik
  const numNoColMsg = document.getElementById("viz-num-no-col-msg");
  const numChartArea = document.getElementById("numerical-charts");
  const numSelectWrap = document.getElementById("num-select-wrap");
  if (numNoColMsg && numChartArea && numSelectWrap) {
    if (numCols.length === 0) {
      numNoColMsg.style.display = "flex";
      numChartArea.style.display = "none";
      numSelectWrap.style.display = "none";
    } else {
      numNoColMsg.style.display = "none";
      numChartArea.style.display = "grid";
      numSelectWrap.style.display = "flex";
    }
  }

  // Pesan tidak ada kolom di tab kategorik
  const catNoColMsg = document.getElementById("viz-cat-no-col-msg");
  const catChartArea = document.getElementById("categorical-charts");
  const catSelectWrap = document.getElementById("cat-select-wrap");
  if (catNoColMsg && catChartArea && catSelectWrap) {
    if (catCols.length === 0) {
      catNoColMsg.style.display = "flex";
      catChartArea.style.display = "none";
      catSelectWrap.style.display = "none";
    } else {
      catNoColMsg.style.display = "none";
      catChartArea.style.display = "grid";
      catSelectWrap.style.display = "flex";
    }
  }

  // Pesan tidak ada kolom untuk Bivariate (Num vs Num)
  const bivNoColMsg = document.getElementById("viz-biv-no-col-msg");
  const bivHasCol = document.getElementById("viz-biv-has-col");
  if (bivNoColMsg && bivHasCol) {
    if (numCols.length < 2) {
      bivNoColMsg.style.display = "flex";
      bivHasCol.style.display = "none";
    } else {
      bivNoColMsg.style.display = "none";
      bivHasCol.style.display = "block";
    }
  }

  // Pesan tidak ada kolom untuk Multivariat
  const mvNoColMsg = document.getElementById("viz-mv-no-col-msg");
  const mvHasCol = document.getElementById("viz-mv-has-col");
  if (mvNoColMsg && mvHasCol) {
    if (numCols.length < 2) {
      mvNoColMsg.style.display = "flex";
      mvHasCol.style.display = "none";
    } else {
      mvNoColMsg.style.display = "none";
      mvHasCol.style.display = "block";
    }
  }

  // Pesan tidak ada kolom untuk Kat vs Num
  const cnNoColMsg = document.getElementById("viz-cn-no-col-msg");
  const cnHasCol = document.getElementById("viz-cn-has-col");
  const cnNoColText = document.getElementById("viz-cn-no-col-text");
  const cnNoColSub = document.getElementById("viz-cn-no-col-sub");
  if (cnNoColMsg && cnHasCol) {
    if (catCols.length === 0 || numCols.length === 0) {
      cnNoColMsg.style.display = "flex";
      cnHasCol.style.display = "none";
      if (cnNoColText && cnNoColSub) {
        if (catCols.length === 0 && numCols.length === 0) {
          cnNoColText.textContent = "Dataset tidak memiliki kolom kategorik";
          cnNoColSub.textContent = "Visualisasi Kat vs Num tidak tersedia untuk dataset ini.";
        } else if (catCols.length === 0) {
          cnNoColText.textContent = "Dataset tidak memiliki kolom kategorik";
          cnNoColSub.textContent = "Visualisasi Kat vs Num tidak tersedia untuk dataset ini.";
        } else {
          cnNoColText.textContent = "Dataset tidak memiliki kolom numerik";
          cnNoColSub.textContent = "Visualisasi Kat vs Num tidak tersedia untuk dataset ini.";
        }
      }
    } else {
      cnNoColMsg.style.display = "none";
      cnHasCol.style.display = "block";
    }
  }

  ["num-col-select", "biv-x", "cn-num"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = numCols.map((c) => `<option value="${c}">${c}</option>`).join("");
  });
  ["cat-col-select", "cn-cat"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = catCols.map((c) => `<option value="${c}">${c}</option>`).join("");
  });
  document.getElementById("biv-y").innerHTML =
    numCols.map((c) => `<option value="${c}">${c}</option>`).join("");

  const mvBox = document.getElementById("mv-col-checkboxes");
  if (mvBox) {
    mvBox.innerHTML = numCols.map((c, i) => {
      const vals = cleanData.map(r => parseFloat(r[c])).filter(v => !isNaN(v));
      const mean = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : "-";
      const checked = i < Math.min(5, numCols.length) ? "checked" : "";
      return `
        <label id="mv-card-${i}" style="
          display:flex;align-items:flex-start;gap:10px;padding:10px 14px;
          border-radius:10px;cursor:pointer;transition:all 0.15s;border:2px solid var(--border);
          background:var(--white);user-select:none;
        "
        onmouseover="this.style.borderColor='var(--card-yellow)'"
        onmouseout="this.style.borderColor=this.querySelector('input').checked?'var(--card-yellow)':'var(--border)'"
        >
          <input type="checkbox" value="${c}" ${checked}
            style="margin-top:2px;cursor:pointer;accent-color:#f5e642;"
            onchange="updateMvCardStyle(this);updateMvSelectedCount()">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-dark);">${c}</div>
          </div>
        </label>`;
    }).join("");
    mvBox.querySelectorAll("input[type=checkbox]").forEach(cb => {
      if (cb.checked) cb.closest("label").style.borderColor = "var(--card-yellow)";
    });
    updateMvSelectedCount();
  }
}

function updateMvCardStyle(cb) {
  const label = cb.closest("label");
  if (label) label.style.borderColor = cb.checked ? "var(--card-yellow)" : "var(--border)";
}

function updateMvSelectedCount() {
  const count = document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]:checked").length;
  const el = document.getElementById("mv-selected-count");
  if (el) el.textContent = count + " variabel dipilih";
}

function mvSelectAll() {
  document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]").forEach(cb => {
    cb.checked = true;
    updateMvCardStyle(cb);
  });
  updateMvSelectedCount();
}

function mvSelectNone() {
  document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]").forEach(cb => {
    cb.checked = false;
    updateMvCardStyle(cb);
  });
  updateMvSelectedCount();
}

function updateMvCount() {
  updateMvSelectedCount();
}

function switchVizTab(tab) {
  document.querySelectorAll("#viz-content .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("#viz-content .tab-content")
    .forEach((c) => c.classList.remove("active"));

  document.querySelectorAll("#viz-content .tab-btn").forEach((b) => {
    const onclickAttr = b.getAttribute("onclick") || "";
    if (onclickAttr.includes(`'${tab}'`)) {
      b.classList.add("active");
    }
  });

  const tabEl = document.getElementById(tab);
  if (tabEl) tabEl.classList.add("active");

  if (cleanData.length) {
    initVizSelects();
    setTimeout(() => {
      if (tab === "numerical-viz") {
        const sel = document.getElementById("num-col-select");
        const defaultCol = autoPickNumCol();
        if (defaultCol) {
          sel.value = defaultCol;
          renderNumericalViz();
        } else if (sel && sel.value) {
          renderNumericalViz();
        }
      } else if (tab === "categorical-viz") {
        const sel = document.getElementById("cat-col-select");
        const defaultCol = autoPickCatCol();
        if (defaultCol) {
          sel.value = defaultCol;
          renderCategoricalViz();
        } else if (sel && sel.value) {
          renderCategoricalViz();
        }
      } else if (tab === "bivariate-viz") {
        const selX = document.getElementById("biv-x");
        const selY = document.getElementById("biv-y");
        const pair = autoPickNumPair();
        if (pair) {
          selX.value = pair[0];
          selY.value = pair[1];
          renderBivariateViz();
        } else if (selX && selY && selX.value && selY.value) {
          renderBivariateViz();
        }
      } else if (tab === "multivariate-viz") {
        const checked = document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]:checked");
        if (checked.length >= 2) renderMultivariateViz();
      } else if (tab === "catnum-viz") {
        const selCat = document.getElementById("cn-cat");
        const selNum = document.getElementById("cn-num");
        const pair = autoPickCatNumPair();
        if (pair) {
          selCat.value = pair[0];
          selNum.value = pair[1];
          renderCatNumViz();
        } else if (selCat && selNum && selCat.value && selNum.value) {
          renderCatNumViz();
        }
      }
    }, 100);
  }
}

function showLoading(canvas) {
  const wrap = canvas.closest(".chart-wrapper");
  if (!wrap) return;
  const ld = document.createElement("div");
  ld.className = "chart-loading";
  ld.id = "loading-" + canvas.id;
  ld.innerHTML =
    '<div class="spinner"></div><span>Generating chart...</span>';
  wrap.appendChild(ld);
}
function hideLoading(canvasId) {
  const ld = document.getElementById("loading-" + canvasId);
  if (ld) ld.remove();
}

const CHART_COLORS = [
  "#F5E642",
  "#F4AECF",
  "#B8D96E",
  "#A8CDEF",
  "#F4C4A0",
  "#E88B42",
  "#9BD4C8",
  "#D4A8E0",
  "#7EC8A4",
  "#F4887A",
];

// Helper: warna grid sesuai mode
function gridColor() {
  return document.body.classList.contains("dark-mode")
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.06)";
}
function gridLineWidth() {
  return document.body.classList.contains("dark-mode") ? 0.5 : 0.7;
}

function renderNumericalViz() {
  const col = document.getElementById("num-col-select").value;
  if (!col) return;
  const vals = cleanData
    .map((r) => parseFloat(r[col]))
    .filter((v) => !isNaN(v));
  if (!vals.length) return;

  setTimeout(() => {

    // ── HISTOGRAM ──────────────────────────────────────────────
    showLoading(document.getElementById("hist-chart"));
    const bins = makeBins(vals, 15);
    destroyChart("hist-chart");
    const bStatsH = getBoxStats(vals);
    const iqrLow  = bStatsH.q1 - 1.5 * (bStatsH.q3 - bStatsH.q1);
    const iqrHigh = bStatsH.q3 + 1.5 * (bStatsH.q3 - bStatsH.q1);
    const barColors  = bins.centers.map(m => (m < iqrLow || m > iqrHigh) ? "rgba(232,93,93,0.8)" : "rgba(245,230,66,0.75)");
    const barBorders = bins.centers.map(m => (m < iqrLow || m > iqrHigh) ? "#e85d5d" : "#d4c800");
    chartInstances["hist-chart"] = new Chart(document.getElementById("hist-chart"), {
  type: "bar",
  data: {
    datasets: [{
      label: col,
      data: bins.centers.map((c, i) => ({ x: c, y: bins.counts[i] })),
      backgroundColor: bins.centers.map(m => (m < iqrLow || m > iqrHigh) ? "rgba(232,93,93,0.8)" : "rgba(245,230,66,0.75)"),
      borderColor: bins.centers.map(m => (m < iqrLow || m > iqrHigh) ? "#e85d5d" : "#d4c800"),
      borderWidth: 1.5, borderRadius: 2,
      barPercentage: 1.0, categoryPercentage: 1.0,
    }],
  },
  options: {
    responsive: true,
    plugins: {
      legend: { display: false },
      datalabels: { display: false },
      title: { display: true, text: "Histogram — " + col, font: { family: "DM Sans", size: 14, weight: "bold" }, color: "#1a1a1a" },
      tooltip: { callbacks: { label: ctx => `Count: ${ctx.parsed.y}` } },
    },
    scales: {
      x: {
        type: "linear",
        ticks: {
          maxRotation: 30,
          maxTicksLimit: 8,
          font: { family: "DM Sans", size: 10 },
          callback: v => {
            if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+"B";
            if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+"M";
            if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+"K";
            return v;
          }
        },
        grid: { color: "#ede8df" }
      },
      y: { ticks: { font: { family: "DM Sans", size: 10 } }, grid: { color: "#ede8df" } },
    },
    animation: { duration: 600, easing: "easeOutQuart" },
  },
});
    hideLoading("hist-chart");

    // ── BOXPLOT (Chart.js chartjs-chart-boxplot) ───────────────
    showLoading(document.getElementById("box-chart"));
    destroyChart("box-chart");
    const bSorted = vals.slice().sort((a,b) => a-b);
    const bq1   = bSorted[Math.floor(bSorted.length * 0.25)];
    const bq3   = bSorted[Math.floor(bSorted.length * 0.75)];
    const biqr  = bq3 - bq1;
    const bWLow  = Math.min(...bSorted.filter(v => v >= bq1 - 1.5 * biqr));
    const bWHigh = Math.max(...bSorted.filter(v => v <= bq3 + 1.5 * biqr));
    const bMed  = bSorted[Math.floor(bSorted.length * 0.5)];
    const bOut  = bSorted.filter(v => v < bWLow || v > bWHigh);
    chartInstances["box-chart"] = new Chart(document.getElementById("box-chart"), {
      type: "boxplot",
      data: {
        labels: [col],
        datasets: [{
          label: col,
          data: [{
            min: bWLow, q1: bq1, median: bMed, q3: bq3, max: bWHigh,
            outliers: bOut,
          }],
          backgroundColor: "rgba(184,217,110,0.45)",
          borderColor: "#7aaa2a",
          borderWidth: 2,
          outlierBackgroundColor: "#e85d5d",
          outlierRadius: 5,
          medianColor: "#e85d5d",
          itemRadius: 0,
        }],
      },
      options: {
  responsive: true, indexAxis: "y",
  layout: { padding: { left: 20, right: 50, top: 10, bottom: 10 } },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    title: { display: true, text: "Boxplot — " + col, font: { family: "DM Sans", size: 14, weight: "bold" }, color: "#1a1a1a" },
    tooltip: {
      callbacks: {
        label: ctx => {
          const d = ctx.dataset.data[ctx.dataIndex];
          return [`Min: ${d.min?.toFixed(2)}`, `Q1: ${d.q1?.toFixed(2)}`, `Median: ${d.median?.toFixed(2)}`, `Q3: ${d.q3?.toFixed(2)}`, `Max: ${d.max?.toFixed(2)}`, `Outliers: ${d.outliers?.length ?? 0}`];
        }
      }
    },
  },
  scales: {
    x: {
      ticks: {
        font: { family: "DM Sans", size: 10 },
        callback: v => {
          if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+"B";
          if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+"M";
          if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+"K";
          return v;
        }
      },
      grid: { color: "#ede8df" },
    },
    y: { ticks: { font: { family: "DM Sans", size: 11 } }, grid: { color: "#ede8df" } },
  },
  animation: { duration: 600, easing: "easeOutQuart" },
},
    });
    hideLoading("box-chart");

    // ── DENSITY PLOT ────────────────────────────────────────────
    showLoading(document.getElementById("density-chart"));
    const densityData = makeDensity(vals, 80);
    destroyChart("density-chart");
    chartInstances["density-chart"] = new Chart(document.getElementById("density-chart"), {
      type: "line",
      data: {
        labels: densityData.xs.map(x =>
          Math.abs(x) >= 1e6 ? (x/1e6).toFixed(1)+"M" :
          Math.abs(x) >= 1e3 ? (x/1e3).toFixed(1)+"K" :
          x.toFixed(1)
        ),
        datasets: [{
          label: "Density", data: densityData.ys,
          borderColor: "#f4aecf", backgroundColor: "rgba(244,174,207,0.25)",
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          title: { display: true, text: "Density Plot — " + col, font: { family: "DM Sans", size: 14, weight: "bold" }, color: "#1a1a1a" },
          tooltip: {
            mode: "index", intersect: false,
            callbacks: {
              title: ctxArr => ctxArr[0].label,
              label: ctx => `Density: ${ctx.parsed.y.toExponential(3)}`,
            },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 30, maxTicksLimit: 8, font: { family: "DM Sans", size: 10 } }, grid: { color: "#ede8df" } },
          y: {
            ticks: { font: { family: "DM Sans", size: 10 }, callback: v => v.toExponential(1) },
            grid: { color: "#ede8df" },
          },
        },
        animation: { duration: 700, easing: "easeOutQuart" },
      },
    });
    hideLoading("density-chart");

    // ── QQ PLOT ─────────────────────────────────────────────────
    showLoading(document.getElementById("qq-chart"));
    const qqData = makeQQ(vals);
    destroyChart("qq-chart");
    chartInstances["qq-chart"] = new Chart(document.getElementById("qq-chart"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Sample",
            data: qqData.points,
            backgroundColor: "rgba(168,205,239,0.75)",
            pointRadius: 3.5, pointHoverRadius: 5,
          },
          {
            label: "Reference",
            data: qqData.refLine,
            type: "line",
            borderColor: "#e85d5d", borderWidth: 2,
            pointRadius: 0, borderDash: [6, 4],
            backgroundColor: "transparent",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          datalabels: { display: false },
          legend: { display: true, position: "bottom", labels: { font: { family: "DM Sans", size: 10 }, boxWidth: 12 } },
          title: { display: true, text: "QQ Plot — " + col, font: { family: "DM Sans", size: 14, weight: "bold" }, color: "#1a1a1a" },
          tooltip: { callbacks: { label: ctx => `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})` } },
        },
        scales: {
  x: {
    title: { display: true, text: "Theoretical Quantiles", font: { family: "DM Sans", size: 10 } },
    grid: { color: "#ede8df" },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+"B";
        if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+"M";
        if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+"K";
        return v.toFixed(1);
      }
    }
  },
  y: {
    title: { display: true, text: "Sample Quantiles", font: { family: "DM Sans", size: 10 } },
    grid: { color: "#ede8df" },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+"B";
        if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+"M";
        if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+"K";
        return v.toFixed(1);
      }
    }
  },
},
        animation: { duration: 600 },
      },
    });
    hideLoading("qq-chart");

    // ── VIOLIN PLOT (Chart.js violin) ────────────────────────────
    showLoading(document.getElementById("violin-chart"));
    destroyChart("violin-chart");
    chartInstances["violin-chart"] = new Chart(document.getElementById("violin-chart"), {
      type: "violin",
      data: {
        labels: [col],
        datasets: [{
          label: col,
          data: [vals],
          backgroundColor: "rgba(184,217,110,0.45)",
          borderColor: "#7aaa2a",
          borderWidth: 2,
          medianColor: "#e85d5d",
          meanColor: "#f5e642",
          itemRadius: 0,
        }],
      },
      options: {
  responsive: true, indexAxis: "y",
  layout: { padding: { left: 20, right: 50, top: 10, bottom: 10 } },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    title: { display: true, text: "Violin Plot — " + col, font: { family: "DM Sans", size: 14, weight: "bold" }, color: "#1a1a1a" },
    tooltip: {
      callbacks: {
        label: ctx => {
          const d = ctx.dataset.data[ctx.dataIndex];
          const sorted = [...d].sort((a,b)=>a-b);
          const q1 = sorted[Math.floor(sorted.length*0.25)];
          const q3 = sorted[Math.floor(sorted.length*0.75)];
          const med = sorted[Math.floor(sorted.length*0.5)];
          return [`Median: ${med.toFixed(2)}`, `Q1: ${q1.toFixed(2)}`, `Q3: ${q3.toFixed(2)}`, `Min: ${sorted[0].toFixed(2)}`, `Max: ${sorted[sorted.length-1].toFixed(2)}`];
        }
      }
    },
  },
  scales: {
    x: {
      ticks: {
        font: { family: "DM Sans", size: 10 },
        callback: v => {
          if (Math.abs(v) >= 1e9) return (v/1e9).toFixed(1)+"B";
          if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(1)+"M";
          if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+"K";
          return v;
        }
      },
      grid: { color: "#ede8df" },
    },
    y: { ticks: { font: { family: "DM Sans", size: 11 } }, grid: { color: "#ede8df" } },
  },
  animation: { duration: 700, easing: "easeOutQuart" },
},
    });
    hideLoading("violin-chart");

    // ── AUTO INSIGHT ────────────────────────────────────────────
    const bStats = getBoxStats(vals);
    const mean   = vals.reduce((a,b)=>a+b,0)/vals.length;
    const std    = Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length);
    const skew   = vals.reduce((a,b)=>a+((b-mean)/std)**3,0)/vals.length;
    const outlierCount = vals.filter(v=>v<bStats.q1-1.5*(bStats.q3-bStats.q1)||v>bStats.q3+1.5*(bStats.q3-bStats.q1)).length;
    const outlierPct   = ((outlierCount/vals.length)*100).toFixed(1);
    const skewLabel    = Math.abs(skew)<0.5?"distribusi mendekati normal":skew>1?"right skewed (ekor kanan)":skew<-1?"left skewed (ekor kiri)":skew>0?"sedikit right skewed":"sedikit left skewed";
    const spread       = Math.abs(mean) > 0 ? std/Math.abs(mean)*100 : 0;

    const insightContainer = document.getElementById("num-viz-insight");
    if (insightContainer) insightContainer.innerHTML = `
      <div style="margin-top:20px;padding:16px;background:#f5f0e8;border-radius:12px;border:1px solid #ddd8ce;">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">Insight — ${col}</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #B8D96E;">
            <strong>Statistik Dasar:</strong> Mean = ${mean.toFixed(2)}, Median = ${bStats.median.toFixed(2)}, Std Dev = ${std.toFixed(2)}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #A8CDEF;">
            <strong>Rentang:</strong> Min = ${bStats.min.toFixed(2)}, Max = ${bStats.max.toFixed(2)}, IQR = ${(bStats.q3-bStats.q1).toFixed(2)}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${Math.abs(skew)>1?'#F4AECF':'#B8D96E'};">
            <strong>Distribusi:</strong> Skewness = ${skew.toFixed(3)} — ${skewLabel}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${outlierCount>0?'#E85D5D':'#B8D96E'};">
            <strong>Outlier:</strong> ${outlierCount} titik (${outlierPct}%) di luar batas IQR ${outlierCount>0?'— perlu investigasi lebih lanjut':'— data bersih dari outlier'}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F5E642;">
            <strong>Koefisien Variasi:</strong> ${spread.toFixed(1)}% — ${spread>30?'variabilitas tinggi, data sangat tersebar':spread>15?'variabilitas sedang':'variabilitas rendah, data konsisten'}
          </div>
        </div>
      </div>`;

  }, 50);
}

function renderCategoricalViz() {
  const col = document.getElementById("cat-col-select").value;
  if (!col) return;
  const vals = cleanData
    .map((r) => r[col])
    .filter((v) => v !== "" && v !== null && v !== undefined);
  const freq = {};
  vals.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const data = sorted.map(([, v]) => v);

  setTimeout(() => {

    // ── BAR CHART — TOP 5, warna berbeda, ada label angka ──────
    showLoading(document.getElementById("bar-chart"));
    destroyChart("bar-chart");
    const top5Labels = labels.slice(0, 5);
    const top5Data = data.slice(0, 5);
    chartInstances["bar-chart"] = new Chart(
      document.getElementById("bar-chart"), {
        type: "bar",
        data: {
          labels: top5Labels,
          datasets: [{
            label: col,
            data: top5Data,
            backgroundColor: CHART_COLORS.slice(0, 5),
            borderRadius: 6,
            borderWidth: 0,
          }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: `Bar Chart — Top 5 ${col}`,
              font: { family: "DM Sans", size: 13, weight: "bold" },
              color: "#1a1a1a",
            },
            tooltip: {
              callbacks: {
                label: ctx => `Count: ${ctx.parsed.x} (${((ctx.parsed.x / vals.length) * 100).toFixed(1)}%)`,
              },
            },
            datalabels: {
              display: true,
              anchor: "end",
              align: "end",
              formatter: v => v,
              font: { family: "DM Sans", size: 11, weight: "bold" },
              color: "#1a1a1a",
            },
          },
          layout: { padding: { right: 30 } },
          scales: {
            x: { ticks: { font: { family: "DM Sans", size: 10 } }, grid: { color: "#ede8df" } },
            y: { ticks: { font: { family: "DM Sans", size: 11 } }, grid: { display: false } },
          },
          animation: { duration: 600, easing: "easeOutQuart" },
        },
      }
    );
    hideLoading("bar-chart");

    // ── PIE CHART (maks 4) atau TREEMAP (>4 kategori) ──────────
showLoading(document.getElementById("pie-chart"));
destroyChart("pie-chart");

if (labels.length <= 4) {
  // PIE CHART — max 4 kategori
  chartInstances["pie-chart"] = new Chart(
    document.getElementById("pie-chart"), {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: CHART_COLORS.slice(0, labels.length),
          borderWidth: 2,
          borderColor: "#FFF",
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { family: "DM Sans", size: 11 }, padding: 10 },
          },
          title: {
            display: true,
            text: `Pie Chart — ${col}`,
            font: { family: "DM Sans", size: 13, weight: "bold" },
            color: "#1a1a1a",
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                const pct = ((ctx.parsed / total)*100).toFixed(1);
                return `${ctx.label}: ${ctx.parsed} data (${pct}%)`;
              },
            },
          },
          datalabels: {
            display: true,
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ((value / total) * 100).toFixed(1) + "%";
            },
            color: "#1a1a1a",
            font: { family: "DM Sans", size: 11, weight: "bold" },
          },
        },
      },
    }
  );
} else {
  // TREEMAP — kalau kategori > 4
  chartInstances["pie-chart"] = new Chart(
    document.getElementById("pie-chart"), {
      type: "treemap",
      data: {
        datasets: [{
          label: col,
          tree: sorted.map(([k, v]) => ({ name: k, value: v })),
          key: "value",
          labels: {
            display: true,
            formatter: (ctx) => {
              const total = data.reduce((a,b)=>a+b,0);
              const pct = ((ctx.raw.v / total)*100).toFixed(1);
              return [`${ctx.raw._data.name}`, `${ctx.raw.v} (${pct}%)`];
            },
            color: "#1a1a1a",
            font: [
              { family: "DM Sans", size: 12, weight: "bold" },
              { family: "DM Sans", size: 10 },
            ],
          },
          backgroundColor: (ctx) => {
            if (!ctx.raw) return "#A8CDEF";
            return CHART_COLORS[ctx.dataIndex % CHART_COLORS.length];
          },
          borderColor: "#fff",
          borderWidth: 1,
          spacing: 0.5,
          borderWidth: 1,
          spacing: 0.5,
          minElementWidth: 60,
          minElementHeight: 40,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: `Treemap — ${col} (${labels.length} kategori)`,
            font: { family: "DM Sans", size: 13, weight: "bold" },
            color: "#1a1a1a",
          },
          tooltip: {
            callbacks: {
              title: () => "",
              label: ctx => {
                const total = data.reduce((a,b)=>a+b,0);
                const pct = ((ctx.raw.v / total)*100).toFixed(1);
                return `${ctx.raw._data.name}: ${ctx.raw.v} data (${pct}%)`;
              },
            },
          },
          datalabels: { display: false },
        },
      },
    }
  );
}
hideLoading("pie-chart");

    // ── COUNT PLOT — semua kategori, satu warna, "counting" feel ─
    showLoading(document.getElementById("count-chart"));
    destroyChart("count-chart");
    chartInstances["count-chart"] = new Chart(
      document.getElementById("count-chart"), {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Count",
            data,
            backgroundColor: "#A8CDEF",
            borderColor: "#7aafd4",
            borderWidth: 1.5,
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: `Count Plot — ${col} (semua kategori)`,
              font: { family: "DM Sans", size: 13, weight: "bold" },
              color: "#1a1a1a",
            },
            tooltip: {
              callbacks: {
                label: ctx => `Count: ${ctx.parsed.x} (${((ctx.parsed.x / vals.length) * 100).toFixed(1)}%)`,
              },
            },
            datalabels: {
              display: true,
              anchor: "end",
              align: "end",
              formatter: v => v,
              font: { family: "DM Sans", size: 10 },
              color: "#555",
            },
          },
          layout: { padding: { right: 30 } },
          scales: {
            x: { ticks: { font: { family: "DM Sans", size: 10 } }, grid: { color: "#ede8df" } },
            y: { ticks: { font: { family: "DM Sans", size: 10 } }, grid: { display: false } },
          },
          animation: { duration: 600, easing: "easeOutQuart" },
        },
      }
    );
    hideLoading("count-chart");

    // ── PARETO CHART — bar + garis kumulatif ────────────────────
    showLoading(document.getElementById("pareto-chart"));
    const cumulative = [];
    let cum = 0;
    data.forEach((d) => {
      cum += d;
      cumulative.push(parseFloat(((cum / vals.length) * 100).toFixed(1)));
    });
    destroyChart("pareto-chart");
    const paretoLineColor = document.body.classList.contains("dark-mode") ? "#ffffff" : "#e85d5d";
    chartInstances["pareto-chart"] = new Chart(
      document.getElementById("pareto-chart"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              type: "bar",
              label: "Count",
              data,
              backgroundColor: CHART_COLORS.slice(0, labels.length),
              borderWidth: 0,
              borderRadius: 4,
              yAxisID: "y",
              order: 2,
              datalabels: { display: false },
            },
            {
              type: "line",
              label: "Cumulative %",
              data: cumulative,
              borderColor: paretoLineColor,
              borderWidth: 2.5,
              pointRadius: 4,
              pointBackgroundColor: paretoLineColor,
              pointBorderColor: paretoLineColor,
              backgroundColor: "transparent",
              yAxisID: "y1",
              tension: 0.1,
              order: 1,
              datalabels: { display: false },
              z: 10,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                font: { family: "DM Sans", size: 11 },
                color: document.body.classList.contains("dark-mode") ? "#dddddd" : "#444444",
              },
            },
            title: {
              display: true,
              text: `Pareto Chart — ${col}`,
              font: { family: "DM Sans", size: 13, weight: "bold" },
              color: document.body.classList.contains("dark-mode") ? "#ffffff" : "#1a1a1a",
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.label === "Count")
                    return `Count: ${ctx.parsed.y} (${((ctx.parsed.y / vals.length) * 100).toFixed(1)}%)`;
                  return `Kumulatif: ${ctx.parsed.y}%`;
                },
              },
            },
            datalabels: { display: false },
          },
          scales: {
            x: {
              ticks: { maxRotation: 30, font: { family: "DM Sans", size: 10 } },
              grid: { display: false },
            },
            y: {
              ticks: { font: { family: "DM Sans", size: 10 } },
              grid: { color: gridColor(), lineWidth: gridLineWidth() },
            },
            y1: {
              position: "right",
              min: 0,
              max: 100,
              ticks: {
                callback: (v) => v + "%",
                font: { family: "DM Sans", size: 10 },
              },
              grid: { drawOnChartArea: false },
            },
          },
        },
      }
    );
    hideLoading("pareto-chart");

    // ── AUTO INSIGHT KATEGORIK ──────────────────────────────────
    const total = vals.length;
    const uniqueCount = sorted.length;
    const topCat = sorted[0];
    const topPct = ((topCat[1]/total)*100).toFixed(1);
    const bottomCat = sorted[sorted.length-1];
    const bottomPct = ((bottomCat[1]/total)*100).toFixed(1);
    const isImbalanced = parseFloat(topPct) > 70;
    const entropy = -sorted.reduce((acc,[,v])=>{const p=v/total;return acc+p*Math.log2(p)},0);

    const catInsightEl = document.getElementById("cat-viz-insight");
    if (catInsightEl) catInsightEl.innerHTML = `
      <div style="margin-top:20px;padding:16px;background:var(--bg-card,#f5f0e8);border-radius:12px;border:1px solid var(--border,#e0ddd5);">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">Insight — ${col}</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #B8D96E;">
            <strong>Jumlah Kategori:</strong> ${uniqueCount} kategori unik dari ${total} data
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${isImbalanced?'#E85D5D':'#A8CDEF'};">
            <strong>Kategori Dominan:</strong> "${topCat[0]}" — ${topPct}% ${isImbalanced?'⚠ Data tidak seimbang (imbalanced)':'— distribusi relatif seimbang'}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F4AECF;">
            <strong>Kategori Terkecil:</strong> "${bottomCat[0]}" — ${bottomPct}% (${bottomCat[1]} data)
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F5E642;">
            <strong>Entropy:</strong> ${entropy.toFixed(3)} — ${entropy>2?'distribusi sangat beragam':entropy>1?'distribusi cukup beragam':'distribusi terkonsentrasi'}
          </div>
        </div>
      </div>
    `;

  }, 50);
}

function renderBivariateViz() {
  const x = document.getElementById("biv-x").value;
  const y = document.getElementById("biv-y").value;
  const numCols = headers.filter((h) => colTypes[h] === "numeric");

  // ── SCATTER + BUBBLE ─────────────────────────────────────────
  if (x && y) {
    const points = cleanData
      .map((r) => ({ x: parseFloat(r[x]), y: parseFloat(r[y]) }))
      .filter((p) => !isNaN(p.x) && !isNaN(p.y));
    const sample = points.length > 300
      ? points.sort(() => Math.random() - 0.5).slice(0, 300)
      : points;

    showLoading(document.getElementById("scatter-chart"));
    destroyChart("scatter-chart");
    chartInstances["scatter-chart"] = new Chart(document.getElementById("scatter-chart"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: `${x} vs ${y}`,
            data: sample,
            backgroundColor: "#A8CDEF88",
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Regression Line",
            data: (() => {
              const n = sample.length;
              const mx = sample.reduce((a,b)=>a+b.x,0)/n;
              const my = sample.reduce((a,b)=>a+b.y,0)/n;
              const slope = sample.reduce((a,b)=>a+(b.x-mx)*(b.y-my),0) / sample.reduce((a,b)=>a+(b.x-mx)**2,0);
              const intercept = my - slope * mx;
              const minX = Math.min(...sample.map(p=>p.x));
              const maxX = Math.max(...sample.map(p=>p.x));
              return [{ x: minX, y: intercept+slope*minX }, { x: maxX, y: intercept+slope*maxX }];
            })(),
            type: "line",
            borderColor: "#E85D5D",
            borderWidth: 2,
            borderDash: [6,4],
            pointRadius: 0,
            backgroundColor: "transparent",
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: { callbacks: { label: ctx => `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})` } },
        },
        scales: {
  x: {
    title: { display: true, text: x, font: { family: "DM Sans", size: 11 } },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        const rounded = parseFloat(v.toPrecision(6));
        if (Math.abs(rounded)>=1e9) return (rounded/1e9).toFixed(1)+"B";
        if (Math.abs(rounded)>=1e6) return (rounded/1e6).toFixed(1)+"M";
        if (Math.abs(rounded)>=1e3) return (rounded/1e3).toFixed(1)+"K";
        return parseFloat(rounded.toFixed(1));
      }
    },
    grid: { color: "#ede8df" }
  },
  y: {
    title: { display: true, text: y, font: { family: "DM Sans", size: 11 } },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        const rounded = parseFloat(v.toPrecision(6));
        if (Math.abs(rounded)>=1e9) return (rounded/1e9).toFixed(1)+"B";
        if (Math.abs(rounded)>=1e6) return (rounded/1e6).toFixed(1)+"M";
        if (Math.abs(rounded)>=1e3) return (rounded/1e3).toFixed(1)+"K";
        return parseFloat(rounded.toFixed(1));
      }
    },
    grid: { color: "#ede8df" }
  },
},
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });
    hideLoading("scatter-chart");

    showLoading(document.getElementById("bubble-chart"));
    const thirdCols = numCols.filter((c) => c !== x && c !== y);
    const bubbleSample = points.slice(0, 80);
    const bubbleData = bubbleSample.map((p, i) => {
      const rBase = thirdCols.length ? parseFloat(cleanData[i]?.[thirdCols[0]]) : 5;
      const r = isNaN(rBase) ? 5 : Math.min(Math.max(rBase / (Math.max(...bubbleSample.map((_,j) => parseFloat(cleanData[j]?.[thirdCols[0]]) || 1)) / 20), 3), 20);
      return { x: p.x, y: p.y, r };
    });
    destroyChart("bubble-chart");
    chartInstances["bubble-chart"] = new Chart(document.getElementById("bubble-chart"), {
      type: "bubble",
      data: {
        datasets: [{
          label: thirdCols[0] ? `${x} vs ${y} (size: ${thirdCols[0]})` : `${x} vs ${y}`,
          data: bubbleData,
          backgroundColor: "#F4AECF55",
          borderColor: "#F4AECF",
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: { callbacks: { label: ctx => `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})` } },
        },
        scales: {
  x: {
    title: { display: true, text: x, font: { family: "DM Sans", size: 11 } },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        const rounded = parseFloat(v.toPrecision(6));
        if (Math.abs(rounded)>=1e9) return (rounded/1e9).toFixed(1)+"B";
        if (Math.abs(rounded)>=1e6) return (rounded/1e6).toFixed(1)+"M";
        if (Math.abs(rounded)>=1e3) return (rounded/1e3).toFixed(1)+"K";
        return parseFloat(rounded.toFixed(1));
      }
    },
    grid: { color: "#ede8df" }
  },
  y: {
    title: { display: true, text: y, font: { family: "DM Sans", size: 11 } },
    ticks: {
      font: { family: "DM Sans", size: 10 },
      callback: v => {
        const rounded = parseFloat(v.toPrecision(6));
        if (Math.abs(rounded)>=1e9) return (rounded/1e9).toFixed(1)+"B";
        if (Math.abs(rounded)>=1e6) return (rounded/1e6).toFixed(1)+"M";
        if (Math.abs(rounded)>=1e3) return (rounded/1e3).toFixed(1)+"K";
        return parseFloat(rounded.toFixed(1));
      }
    },
    grid: { color: "#ede8df" }
  },
},
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });
    hideLoading("bubble-chart");
  }
// ── CORRELATION HEATMAP — navy(+1) → putih(0) → maroon(-1), full frame ───────
const filteredNumCols = numCols.filter(h => !isUniqueCol(h, "numeric"));
if (filteredNumCols.length >= 2) {
  const maxCols = filteredNumCols.slice(0, 8);
  const corrs = [];
  maxCols.forEach((cx) => {
    const row = [];
    maxCols.forEach((cy) => { row.push(calcCorr(cleanData, cx, cy)); });
    corrs.push(row);
  });

  showLoading(document.getElementById("corr-chart"));
  destroyChart("corr-chart");

  const corrCanvas = document.getElementById("corr-chart");
  const n2 = maxCols.length;

  // ── PERUBAHAN 1: navy(+1) → putih(0) → maroon(-1) ──
  function corrToRGB(r) {
    const t = Math.max(-1, Math.min(1, r));
    if (t >= 0) {
      const s = t;
      return `rgb(${Math.round(255 - s * (255 - 26))},${Math.round(255 - s * (255 - 58))},${Math.round(255 - s * (255 - 110))})`;
    } else {
      const s = -t;
      return `rgb(${Math.round(255 - s * (255 - 92))},${Math.round(255 - s * (255 - 15))},${Math.round(255 - s * (255 - 15))})`;
    }
  }
  function corrToRGBA(r, a = 1) {
    const t = Math.max(-1, Math.min(1, r));
    let R, G, B;
    if (t >= 0) {
      const s = t;
      R = Math.round(255 - s * (255 - 26));
      G = Math.round(255 - s * (255 - 58));
      B = Math.round(255 - s * (255 - 110));
    } else {
      const s = -t;
      R = Math.round(255 - s * (255 - 92));
      G = Math.round(255 - s * (255 - 15));
      B = Math.round(255 - s * (255 - 15));
    }
    return `rgba(${R},${G},${B},${a})`;
  }

  function buildHeatmap() {
    const parentW = corrCanvas.parentElement.offsetWidth || 600;

    // ── PERUBAHAN 2: pisah labelPadLeft & topPad, kurangi colorBarGap biar bar tidak kepotong ──
    const labelPadLeft = 120;
    const topPad = 44;
    const colorBarW = 18;
    const colorBarGap = 24;
    const colorBarLabelW = 40;
    const cw = Math.max(Math.floor((parentW - labelPadLeft - colorBarW - colorBarGap - colorBarLabelW) / n2), 44);
    const ch = Math.max(cw, 44);
    const canvasW = parentW;
    const canvasH = ch * n2 + topPad + 16;

    corrCanvas.width = canvasW;
    corrCanvas.height = canvasH;
    corrCanvas.style.width = "100%";
    corrCanvas.style.height = canvasH + "px";

    const ctx = corrCanvas.getContext("2d");

    const barX = labelPadLeft + n2 * cw + colorBarGap / 2;
    const barY = topPad;
    const barH = n2 * ch;

    function draw(hovXi, hovYi) {
      ctx.clearRect(0, 0, canvasW, canvasH);

      // background
      ctx.fillStyle = "#ffffffff";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Label atas (X) — pakai topPad bukan labelPad
      maxCols.forEach((col, xi) => {
        const short = col.length > 12 ? col.substring(0, 11) + "…" : col;
        const isHov = xi === hovXi;
        ctx.font = isHov ? "bold 11px DM Sans" : "bold 10px DM Sans";
        ctx.fillStyle = isHov ? "#1a1a1a" : "#555";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(short, labelPadLeft + xi * cw + cw / 2, topPad - 6);
      });

      // Label kiri (Y) — pakai topPad bukan labelPad
      maxCols.forEach((col, yi) => {
        const short = col.length > 12 ? col.substring(0, 11) + "…" : col;
        const isHov = yi === hovYi;
        ctx.font = isHov ? "bold 11px DM Sans" : "bold 10px DM Sans";
        ctx.fillStyle = isHov ? "#1a1a1a" : "#555";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(short, labelPadLeft - 8, topPad + yi * ch + ch / 2);
      });

      // Sel heatmap — pakai topPad & labelPadLeft
      maxCols.forEach((_, xi) => {
        maxCols.forEach((__, yi) => {
          const r = corrs[yi][xi];
          const px = labelPadLeft + xi * cw;
          const py = topPad + yi * ch;
          const isHov = xi === hovXi && yi === hovYi;

          ctx.fillStyle = corrToRGBA(r, isHov ? 1 : 0.88);
          ctx.fillRect(px, py, cw, ch);

          ctx.strokeStyle = isHov ? "#1a1a1a" : "#fff";
          ctx.lineWidth = isHov ? 2.5 : 1.5;
          ctx.strokeRect(px, py, cw, ch);

          // ── PERUBAHAN 3: angka 3 desimal ──
          const textColor = Math.abs(r) > 0.55 ? "#fff" : "#1a1a1a";
          ctx.fillStyle = textColor;
          ctx.font = `bold ${Math.min(cw / 4.5, 12)}px DM Sans`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(r.toFixed(3), px + cw / 2, py + ch / 2);
        });
      });

      // Color bar — gradient navy→putih→maroon (vertikal: navy di atas, maroon di bawah)
      const grad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
      grad.addColorStop(0, corrToRGB(1));
      grad.addColorStop(0.5, corrToRGB(0));
      grad.addColorStop(1, corrToRGB(-1));
      ctx.fillStyle = grad;
      ctx.fillRect(barX, barY, colorBarW, barH);
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, colorBarW, barH);

      // Tick labels color bar
      const barLabels = [
        { val: 1,    label: "+1.0" },
        { val: 0.5,  label: "+0.5" },
        { val: 0,    label: "0"    },
        { val: -0.5, label: "-0.5" },
        { val: -1,   label: "-1.0" },
      ];
      ctx.fillStyle = "#555";
      ctx.font = "10px DM Sans";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      barLabels.forEach(({ val, label }) => {
        const ly = barY + ((1 - (val + 1) / 2)) * barH;
        ctx.beginPath();
        ctx.moveTo(barX + colorBarW, ly);
        ctx.lineTo(barX + colorBarW + 4, ly);
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#555";
        ctx.fillText(label, barX + colorBarW + 7, ly);
      });

      // Tooltip saat hover
      if (hovXi !== null && hovYi !== null) {
        const r = corrs[hovYi][hovXi];
        const px = labelPadLeft + hovXi * cw;
        const py = topPad + hovYi * ch;
        const strength = Math.abs(r) > 0.7 ? "Kuat" : Math.abs(r) > 0.4 ? "Sedang" : "Lemah";
        const dir = r > 0.01 ? "Positif" : r < -0.01 ? "Negatif" : "Tidak Ada";
        const lines = [
          `${maxCols[hovXi]} × ${maxCols[hovYi]}`,
          `r = ${r.toFixed(3)}`,
          `${dir} ${strength}`,
        ];
        const tipW = 210, tipH = 64, tipPad = 10;
        let tipX = px + cw + 6;
        let tipY = py;
        if (tipX + tipW > canvasW - 10) tipX = px - tipW - 6;
        if (tipY + tipH > canvasH - 10) tipY = canvasH - tipH - 10;

        ctx.fillStyle = "rgba(26,26,26,0.93)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tipX, tipY, tipW, tipH, 7);
        else ctx.rect(tipX, tipY, tipW, tipH);
        ctx.fill();

        lines.forEach((line, i) => {
          ctx.font = i === 0 ? "bold 11px DM Sans" : "10px DM Sans";
          ctx.fillStyle = i === 2 ? corrToRGB(r) : "#fff";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(line, tipX + tipPad, tipY + tipPad + i * 18);
        });
      }
    }

    draw(null, null);

    // Mouse events
    corrCanvas.onmousemove = (e) => {
      const rect = corrCanvas.getBoundingClientRect();
      const scaleX = canvasW / rect.width;
      const scaleY = canvasH / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      const xi = Math.floor((mx - labelPadLeft) / cw);
      const yi = Math.floor((my - topPad) / ch);

      const inBar = mx >= barX && mx <= barX + colorBarW && my >= barY && my <= barY + barH;

      if (inBar) {
        const hovR = 1 - 2 * ((my - barY) / barH);
        const strength = Math.abs(hovR) > 0.7 ? "Kuat" : Math.abs(hovR) > 0.4 ? "Sedang" : "Lemah";
        const dir = hovR > 0.01 ? "Positif" : hovR < -0.01 ? "Negatif" : "Tidak Ada";
        draw(null, null);
        const ctx2 = corrCanvas.getContext("2d");
        const ly = barY + ((1 - (hovR + 1) / 2)) * barH;
        ctx2.strokeStyle = "#1a1a1a";
        ctx2.lineWidth = 1.5;
        ctx2.beginPath();
        ctx2.moveTo(barX - 4, ly);
        ctx2.lineTo(barX + colorBarW + 4, ly);
        ctx2.stroke();
        const tipW = 130, tipH = 44, tipPad = 8;
        let tipX = barX - tipW - 8;
        let tipY = ly - tipH / 2;
        if (tipY < barY) tipY = barY;
        if (tipY + tipH > barY + barH) tipY = barY + barH - tipH;
        ctx2.fillStyle = "rgba(26,26,26,0.93)";
        if (ctx2.roundRect) ctx2.roundRect(tipX, tipY, tipW, tipH, 6);
        else ctx2.rect(tipX, tipY, tipW, tipH);
        ctx2.fill();
        ctx2.font = "bold 11px DM Sans";
        ctx2.fillStyle = corrToRGB(hovR);
        ctx2.textAlign = "left";
        ctx2.textBaseline = "top";
        ctx2.fillText(`r = ${hovR.toFixed(2)}`, tipX + tipPad, tipY + tipPad);
        ctx2.font = "10px DM Sans";
        ctx2.fillStyle = "#ccc";
        ctx2.fillText(`${dir} ${strength}`, tipX + tipPad, tipY + tipPad + 18);
        corrCanvas.style.cursor = "crosshair";
      } else if (xi >= 0 && xi < n2 && yi >= 0 && yi < n2) {
        draw(xi, yi);
        corrCanvas.style.cursor = "crosshair";
      } else {
        draw(null, null);
        corrCanvas.style.cursor = "default";
      }
    };

    corrCanvas.onmouseleave = () => {
      draw(null, null);
      corrCanvas.style.cursor = "default";
    };
  }

  buildHeatmap();

  if (corrCanvas._resizeObserver) corrCanvas._resizeObserver.disconnect();
  corrCanvas._resizeObserver = new ResizeObserver(() => buildHeatmap());
  corrCanvas._resizeObserver.observe(corrCanvas.parentElement);

  hideLoading("corr-chart");
}

  // ── PAIR PLOT — diagonal density, off-diagonal scatter ───────
const pairCols = numCols.filter(h => !isUniqueCol(h, "numeric")).slice(0, 5);
const pairContainer = document.getElementById("pair-plot-container");
if (pairCols.length < 2) {
  pairContainer.innerHTML = '<div class="no-data" style="height:120px;"><span>Perlu minimal 2 kolom numerik</span></div>';
  return;
}

const n = pairCols.length;
const pairSample = cleanData.length > 300
  ? cleanData.sort(() => Math.random() - 0.5).slice(0, 300)
  : cleanData;

const labelColW = 72;
const isDarkPair = document.body.classList.contains("dark-mode");
const pairLabelColor = isDarkPair ? "#cccccc" : "#555555";
const pairCellBg = isDarkPair ? "#1e1e1e" : "#ffffff";
const pairCellBorder = isDarkPair ? "#333333" : "#e8e8e8";
const pairTickColor = isDarkPair ? "#666666" : "#999999";

let pairHtml = `<div style="display:flex;flex-direction:column;width:100%;gap:0;">`;

// Label atas (sumbu X)
pairHtml += `<div style="display:flex;margin-left:${labelColW}px;gap:3px;margin-bottom:4px;">`;
pairCols.forEach((col) => {
  const short = col.length > 11 ? col.substring(0, 10) + "…" : col;
  pairHtml += `<div style="flex:1;text-align:center;font-size:10px;font-weight:600;color:${pairLabelColor};font-family:'DM Sans',sans-serif;overflow:hidden;white-space:nowrap;padding:0 2px;" title="${col}">${short}</div>`;
});
pairHtml += `</div>`;

// Body: label kiri + grid
pairHtml += `<div style="display:flex;gap:0;">`;

// Label kiri (sumbu Y)
pairHtml += `<div style="display:flex;flex-direction:column;gap:3px;width:${labelColW}px;flex-shrink:0;">`;
pairCols.forEach((col) => {
  const short = col.length > 11 ? col.substring(0, 10) + "…" : col;
  pairHtml += `<div style="flex:1;aspect-ratio:1;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;">
    <span style="font-size:10px;font-weight:600;color:${pairLabelColor};font-family:'DM Sans',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68px;display:block;text-align:right;" title="${col}">${short}</span>
  </div>`;
});
pairHtml += `</div>`;

// Grid sel
pairHtml += `<div style="flex:1;min-width:0;display:grid;grid-template-columns:repeat(${n},1fr);gap:3px;">`;
pairCols.forEach((cy, row) => {
  pairCols.forEach((cx, col) => {
    const cid = `pair-${row}-${col}`;
    pairHtml += `<div style="width:100%;aspect-ratio:1;position:relative;background:${pairCellBg};border-radius:5px;overflow:hidden;border:1px solid ${pairCellBorder};">
      <canvas id="${cid}" style="width:100%;height:100%;display:block;"></canvas>
    </div>`;
  });
});
pairHtml += `</div>`; // grid sel
pairHtml += `</div>`; // flex row

// Label bawah tick min/max
pairHtml += `<div style="display:flex;margin-left:${labelColW}px;gap:3px;margin-top:3px;">`;
pairCols.forEach((col) => {
  const vals = pairSample.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
  const mn = vals.length ? Math.min(...vals).toFixed(1) : "";
  const mx = vals.length ? Math.max(...vals).toFixed(1) : "";
  pairHtml += `<div style="flex:1;display:flex;justify-content:space-between;padding:0 2px;">
    <span style="font-size:9px;color:${pairTickColor};font-family:'DM Sans',sans-serif;">${mn}</span>
    <span style="font-size:9px;color:${pairTickColor};font-family:'DM Sans',sans-serif;">${mx}</span>
  </div>`;
});
pairHtml += `</div>`;

pairHtml += `</div>`; // wrapper
pairContainer.innerHTML = pairHtml;

// Setelah HTML ter-render, isi canvas
setTimeout(() => {
  pairCols.forEach((cy, row) => {
    pairCols.forEach((cx, col) => {
      const cid = `pair-${row}-${col}`;
      const canvas = document.getElementById(cid);
      if (!canvas) return;
      const actualW = canvas.parentElement.offsetWidth || cellSize;
      canvas.width = actualW;
      canvas.height = actualW;

      if (row === col) {
        // ── DIAGONAL: Density plot ────────────────────────────
        const dVals = pairSample
          .map(r => parseFloat(r[cx]))
          .filter(v => !isNaN(v));
        const density = makeDensity(dVals, 40);

        destroyChart(cid);
        chartInstances[cid] = new Chart(canvas, {
          type: "line",
          data: {
            labels: density.xs.map(x => x.toFixed(1)),
            datasets: [{
              data: density.ys,
              borderColor: "#A8CDEF",
              backgroundColor: "rgba(168,205,239,0.3)",
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              borderWidth: 1.5,
            }],
          },
          options: {
            responsive: false,
            animation: false,
            plugins: {
              legend: { display: false },
              datalabels: { display: false },
              tooltip: {
                enabled: true,
                callbacks: {
                  title: () => cx,
                  label: ctx => `Density: ${ctx.parsed.y.toExponential(2)}`,
                },
              },
            },
            scales: {
              x: {
                display: true,
                ticks: {
                  maxTicksLimit: 3,
                  font: { size: 8, family: "'DM Sans', sans-serif" },
                  color: "#bbb",
                  maxRotation: 0,
                },
                grid: { display: false },
                border: { display: false },
              },
              y: {
                display: true,
                ticks: {
                  maxTicksLimit: 3,
                  font: { size: 8, family: "'DM Sans', sans-serif" },
                  color: "#bbb",
                  callback: v => v.toExponential(0),
                },
                grid: {
                  color: "rgba(0,0,0,0.05)",
                  lineWidth: 0.5,
                },
                border: { display: false },
              },
            },
          },
        });

      } else {
        // ── OFF-DIAGONAL: Scatter ─────────────────────────────
        const pts = pairSample
          .map(r => ({ x: parseFloat(r[cx]), y: parseFloat(r[cy]) }))
          .filter(p => !isNaN(p.x) && !isNaN(p.y));

        const r = calcCorr(pairSample, cx, cy);
        const isDark = document.body.classList.contains("dark-mode");
        const dotColor = r > 0.4
          ? (isDark ? "rgba(255,220,0,0.85)" : "rgba(100,180,100,0.55)")
          : r < -0.4
          ? (isDark ? "rgba(255,120,120,0.85)" : "rgba(220,80,80,0.55)")
          : (isDark ? "rgba(100,210,255,0.9)" : "rgba(168,205,239,0.55)");

        destroyChart(cid);
        chartInstances[cid] = new Chart(canvas, {
          type: "scatter",
          data: {
            datasets: [{
              data: pts,
              backgroundColor: dotColor,
              pointRadius: Math.max(1.5, Math.floor(actualW / 60)),
              pointHoverRadius: Math.max(3, Math.floor(actualW / 40)),
            }],
          },
          options: {
            responsive: false,
            animation: false,
            plugins: {
              legend: { display: false },
              datalabels: { display: false },
              tooltip: {
                enabled: true,
                callbacks: {
                  title: () => `${cx} vs ${cy}`,
                  label: ctx => `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})`,
                },
              },
            },
            scales: {
              x: {
                display: true,
                ticks: {
                  maxTicksLimit: 3,
                  font: { size: 8, family: "'DM Sans', sans-serif" },
                  color: "#bbb",
                  maxRotation: 0,
                },
                grid: {
                  color: "rgba(0,0,0,0.05)",
                  lineWidth: 0.5,
                },
                border: { display: false },
              },
              y: {
                display: true,
                ticks: {
                  maxTicksLimit: 3,
                  font: { size: 8, family: "'DM Sans', sans-serif" },
                  color: "#bbb",
                },
                grid: {
                  color: "rgba(0,0,0,0.05)",
                  lineWidth: 0.5,
                },
                border: { display: false },
              },
            },
          },
        });
      }
    });
  });
}, 80);

  // ── AUTO INSIGHT BIVARIAT ────────────────────────────────────
  if (x && y) {
    const pairs = cleanData
      .map(r => ({ x: parseFloat(r[x]), y: parseFloat(r[y]) }))
      .filter(p => !isNaN(p.x) && !isNaN(p.y));
    const r = calcCorr(cleanData, x, y);
    const rAbs = Math.abs(r);
    const corrStrength = rAbs > 0.7 ? "kuat" : rAbs > 0.4 ? "sedang" : "lemah";
    const corrDir = r > 0 ? "positif" : "negatif";
    const nn = pairs.length;
    const mx = pairs.reduce((a,b)=>a+b.x,0)/nn;
    const my = pairs.reduce((a,b)=>a+b.y,0)/nn;
    const slope = pairs.reduce((a,b)=>a+(b.x-mx)*(b.y-my),0) / pairs.reduce((a,b)=>a+(b.x-mx)**2,0);
    const intercept = my - slope * mx;

    const bivInsightEl = document.getElementById("biv-viz-insight");
    if (bivInsightEl) bivInsightEl.innerHTML = `
      <div style="margin-top:20px;padding:16px;background:#f5f0e8;border-radius:12px;border:1px solid #ddd8ce;">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">Insight — ${x} vs ${y}</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${rAbs>0.7?'#B8D96E':rAbs>0.4?'#F5E642':'#F4AECF'};">
            <strong>Korelasi:</strong> r = ${r.toFixed(3)} — korelasi ${corrDir} ${corrStrength}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #A8CDEF;">
            <strong>Regresi Linear:</strong> ${y} = ${slope.toFixed(3)} × ${x} + ${intercept.toFixed(3)}
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F5E642;">
            <strong>Jumlah Data:</strong> ${nn} pasangan data valid
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${rAbs>0.7?'#B8D96E':'#E85D5D'};">
            <strong>Interpretasi:</strong> ${rAbs>0.7?`${x} dan ${y} memiliki hubungan linear yang kuat`:rAbs>0.4?`Ada hubungan moderat antara ${x} dan ${y}`:`Hubungan antara ${x} dan ${y} sangat lemah atau tidak linear`}
          </div>
        </div>
      </div>`;
  }
}

function renderMultivariateViz() {
  const checkboxes = document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]:checked");
  const selectedCols = Array.from(checkboxes).map(c => c.value);
  if (selectedCols.length < 3) {
    showNotif("Pilih minimal 3 variabel.", "warning");
    return;
  }

  // ── HITUNG MATRIKS KORELASI ───────────────────────────────────
  const corrs = [];
  selectedCols.forEach((cx) => {
    const row = [];
    selectedCols.forEach((cy) => { row.push(calcCorr(cleanData, cx, cy)); });
    corrs.push(row);
  });

  const corrCanvas = document.getElementById("corr-chart");
  if (corrCanvas._resizeObserver) corrCanvas._resizeObserver.disconnect();
  destroyChart("corr-chart");

  const n2 = selectedCols.length;

  // ── PALET WARNA MATANG: merah tua → putih → biru tua ─────────
  // Negatif kuat  : #C0392B (merah tua)
  // Nol           : #F5F5F0 (putih gading)
  // Positif kuat  : #1A5276 (biru tua)
  function corrToRGB(r) {
    const t = Math.max(-1, Math.min(1, r));
    if (t >= 0) {
      // putih gading → biru tua
      const s = t;
      const R = Math.round(245 - s * (245 - 26));
      const G = Math.round(245 - s * (245 - 82));
      const B = Math.round(240 - s * (240 - 118));
      return `rgb(${R},${G},${B})`;
    } else {
      // putih gading → merah tua
      const s = -t;
      const R = Math.round(245 - s * (245 - 192));
      const G = Math.round(245 - s * (245 - 57));
      const B = Math.round(240 - s * (240 - 43));
      return `rgb(${R},${G},${B})`;
    }
  }

  // Warna teks: putih untuk warna gelap, hitam untuk warna terang
  function textColorFor(r) {
    return Math.abs(r) > 0.45 ? "#ffffff" : "#1a1a1a";
  }

  function buildHeatmap() {
    const parentW = corrCanvas.parentElement.offsetWidth || 600;
    const labelPadLeft = 140;
    const topPad = 56;
    const colorBarW = 22;
    const colorBarGap = 36;
    const colorBarLabelW = 50;
    const cw = Math.max(Math.floor((parentW - labelPadLeft - colorBarW - colorBarGap - colorBarLabelW) / n2), 50);
    const ch = Math.max(cw, 50);
    const canvasW = parentW;
    const canvasH = ch * n2 + topPad + 24;

    corrCanvas.width  = canvasW;
    corrCanvas.height = canvasH;
    corrCanvas.style.width  = "100%";
    corrCanvas.style.height = canvasH + "px";

    const ctx = corrCanvas.getContext("2d");
    const barX = labelPadLeft + n2 * cw + colorBarGap / 2;
    const barY = topPad;
    const barH = n2 * ch;

    function draw(hovXi, hovYi, hovBarFrac) {
      ctx.clearRect(0, 0, canvasW, canvasH);
      // background
      ctx.fillStyle = "#fafaf8";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // ── Label atas ──
      selectedCols.forEach((col, xi) => {
        const short = col.length > 13 ? col.substring(0, 12) + "…" : col;
        ctx.save();
        ctx.font = `${xi === hovXi ? "bold" : "600"} 10px DM Sans, sans-serif`;
        ctx.fillStyle = xi === hovXi ? "#1a1a1a" : "#444";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(short, labelPadLeft + xi * cw + cw / 2, topPad - 8);
        ctx.restore();
      });

      // ── Label kiri ──
      selectedCols.forEach((col, yi) => {
        const short = col.length > 13 ? col.substring(0, 12) + "…" : col;
        ctx.save();
        ctx.font = `${yi === hovYi ? "bold" : "600"} 10px DM Sans, sans-serif`;
        ctx.fillStyle = yi === hovYi ? "#1a1a1a" : "#444";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(short, labelPadLeft - 10, topPad + yi * ch + ch / 2);
        ctx.restore();
      });

      // ── Sel heatmap ──
      selectedCols.forEach((_, xi) => {
        selectedCols.forEach((__, yi) => {
          const r = corrs[yi][xi];
          const px = labelPadLeft + xi * cw;
          const py = topPad + yi * ch;
          const isHov = xi === hovXi && yi === hovYi;

          // Warna sel — pakai rgba langsung, bukan hex+alpha
          const baseColor = corrToRGB(r);
          ctx.fillStyle = baseColor;
          ctx.fillRect(px, py, cw, ch);

          // Border: putih normal, hitam tipis saat hover
          ctx.strokeStyle = isHov ? "#1a1a1a" : "rgba(255,255,255,0.7)";
          ctx.lineWidth = isHov ? 2.5 : 1.2;
          ctx.strokeRect(px, py, cw, ch);

          // Highlight overlay saat hover
          if (isHov) {
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(px, py, cw, ch);
          }

          // Nilai korelasi
          ctx.fillStyle = textColorFor(r);
          ctx.font = `bold ${Math.min(cw / 4.2, 13)}px DM Sans, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(r.toFixed(3), px + cw / 2, py + ch / 2);
        });
      });

      // ── Color bar gradient (matang) ──
      const grad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
      grad.addColorStop(0,    corrToRGB(1));    // biru tua
      grad.addColorStop(0.5,  corrToRGB(0));    // putih gading
      grad.addColorStop(1,    corrToRGB(-1));   // merah tua
      ctx.fillStyle = grad;
      ctx.fillRect(barX, barY, colorBarW, barH);
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, colorBarW, barH);

      // Tick & label color bar
      [{ val: 1, label: "+1.0" }, { val: 0.5, label: "+0.5" }, { val: 0, label: "0.0" }, { val: -0.5, label: "-0.5" }, { val: -1, label: "-1.0" }]
        .forEach(({ val, label }) => {
          const ly = barY + ((1 - (val + 1) / 2)) * barH;
          ctx.beginPath();
          ctx.moveTo(barX + colorBarW, ly);
          ctx.lineTo(barX + colorBarW + 5, ly);
          ctx.strokeStyle = "#888";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#444";
          ctx.font = "10px DM Sans, sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(label, barX + colorBarW + 8, ly);
        });

      // ── Color bar hover: garis + tooltip nilai ──
      if (hovBarFrac !== null) {
        const hoverVal = 1 - hovBarFrac * 2; // +1 (atas) → -1 (bawah)
        const iy = barY + hovBarFrac * barH;

        // Garis penunjuk
        ctx.beginPath();
        ctx.moveTo(barX - 5, iy);
        ctx.lineTo(barX + colorBarW + 5, iy);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Tooltip nilai
        const tipW = 110, tipH = 50;
        const tipX = barX + colorBarW + 10;
        const tipY = Math.min(Math.max(iy - tipH / 2, barY), barY + barH - tipH);
        ctx.fillStyle = "rgba(26,26,26,0.92)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tipX, tipY, tipW, tipH, 7);
        else ctx.rect(tipX, tipY, tipW, tipH);
        ctx.fill();

        ctx.fillStyle = corrToRGB(hoverVal);
        ctx.font = "bold 14px DM Sans, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(hoverVal.toFixed(3), tipX + 10, tipY + 8);

        const interp = hoverVal > 0.6 ? "Positif Kuat"
          : hoverVal > 0.2 ? "Positif Sedang"
          : hoverVal > -0.2 ? "Hampir Nol"
          : hoverVal > -0.6 ? "Negatif Sedang"
          : "Negatif Kuat";
        ctx.fillStyle = "#aaa";
        ctx.font = "10px DM Sans, sans-serif";
        ctx.fillText(interp, tipX + 10, tipY + 28);
      }

      // ── Tooltip sel ──
      if (hovXi !== null && hovYi !== null) {
        const r = corrs[hovYi][hovXi];
        const px = labelPadLeft + hovXi * cw;
        const py = topPad + hovYi * ch;
        const strength = Math.abs(r) > 0.7 ? "Kuat" : Math.abs(r) > 0.4 ? "Sedang" : "Lemah";
        const dir = r > 0.01 ? "Positif" : r < -0.01 ? "Negatif" : "Tidak Ada";
        const lines = [
          `${selectedCols[hovXi]} × ${selectedCols[hovYi]}`,
          `r = ${r.toFixed(3)}`,
          `${dir} — ${strength}`
        ];
        const tipW = 230, tipH = 68, tipPad = 10;
        let tipX = px + cw + 8;
        let tipY = py;
        if (tipX + tipW > canvasW - 10) tipX = px - tipW - 8;
        if (tipY + tipH > canvasH - 10) tipY = canvasH - tipH - 10;

        ctx.fillStyle = "rgba(26,26,26,0.93)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tipX, tipY, tipW, tipH, 8);
        else ctx.rect(tipX, tipY, tipW, tipH);
        ctx.fill();

        lines.forEach((line, i) => {
          ctx.font = i === 0 ? "bold 11px DM Sans" : "10px DM Sans";
          ctx.fillStyle = i === 2 ? corrToRGB(r) : (i === 1 ? "#f5e642" : "#fff");
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(line, tipX + tipPad, tipY + tipPad + i * 20);
        });
      }
    }

    draw(null, null, null);

    corrCanvas.onmousemove = (e) => {
      const rect = corrCanvas.getBoundingClientRect();
      const scaleX = canvasW / rect.width;
      const scaleY = canvasH / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      const xi = Math.floor((mx - labelPadLeft) / cw);
      const yi = Math.floor((my - topPad) / ch);
      const onBar = mx >= barX && mx <= barX + colorBarW && my >= barY && my <= barY + barH;

      if (xi >= 0 && xi < n2 && yi >= 0 && yi < n2) {
        draw(xi, yi, null);
        corrCanvas.style.cursor = "crosshair";
      } else if (onBar) {
        const frac = (my - barY) / barH;
        draw(null, null, Math.max(0, Math.min(1, frac)));
        corrCanvas.style.cursor = "ns-resize";
      } else {
        draw(null, null, null);
        corrCanvas.style.cursor = "default";
      }
    };
    corrCanvas.onmouseleave = () => {
      draw(null, null, null);
      corrCanvas.style.cursor = "default";
    };
  }

  buildHeatmap();
  corrCanvas._resizeObserver = new ResizeObserver(() => buildHeatmap());
  corrCanvas._resizeObserver.observe(corrCanvas.parentElement);

  // ── PAIR PLOT ─────────────────────────────────────────────────
  const pairContainer = document.getElementById("pair-plot-container");
  const n = selectedCols.length;
  const pairSample = cleanData.length > 300
    ? cleanData.sort(() => Math.random() - 0.5).slice(0, 300)
    : cleanData;

  const labelColW = 72;
  const isDarkMvPair = document.body.classList.contains("dark-mode");
  const labelColor = isDarkMvPair ? "#cccccc" : "#555555";
  const cellBg    = isDarkMvPair ? "#1e1e1e" : "#ffffff";
  const cellBorder= isDarkMvPair ? "#333333" : "#e8e8e8";

  let pairHtml = `<div style="display:flex;flex-direction:column;width:100%;gap:0;">`;

  // Label atas (sumbu X — nama kolom)
  pairHtml += `<div style="display:flex;margin-left:${labelColW}px;gap:3px;margin-bottom:4px;">`;
  selectedCols.forEach((col) => {
    const short = col.length > 11 ? col.substring(0, 10) + "…" : col;
    pairHtml += `<div style="flex:1;text-align:center;font-size:10px;font-weight:600;color:${labelColor};overflow:hidden;white-space:nowrap;padding:0 2px;" title="${col}">${short}</div>`;
  });
  pairHtml += `</div>`;

  // Body: label kiri + grid sel
  pairHtml += `<div style="display:flex;gap:0;">`;

  // Label kiri (sumbu Y — nama baris)
  pairHtml += `<div style="display:flex;flex-direction:column;gap:3px;width:${labelColW}px;flex-shrink:0;">`;
  selectedCols.forEach((col) => {
    const short = col.length > 11 ? col.substring(0, 10) + "…" : col;
    pairHtml += `<div style="flex:1;aspect-ratio:1;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;">
      <span style="font-size:10px;font-weight:600;color:${labelColor};text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:68px;display:block;" title="${col}">${short}</span>
    </div>`;
  });
  pairHtml += `</div>`;

  // Grid sel canvas
  pairHtml += `<div style="flex:1;min-width:0;display:grid;grid-template-columns:repeat(${n},1fr);gap:3px;">`;
  selectedCols.forEach((cy, row) => {
    selectedCols.forEach((cx, col) => {
      const cid = `mv-pair-${row}-${col}`;
      pairHtml += `<div style="width:100%;aspect-ratio:1;position:relative;background:${cellBg};border-radius:5px;overflow:hidden;border:1px solid ${cellBorder};">
        <canvas id="${cid}" style="width:100%;height:100%;display:block;"></canvas>
      </div>`;
    });
  });
  pairHtml += `</div>`;
  pairHtml += `</div>`; // end flex row
  pairHtml += `</div>`; // end wrapper
  pairContainer.innerHTML = pairHtml;

  setTimeout(() => {
    selectedCols.forEach((cy, row) => {
      selectedCols.forEach((cx, col) => {
        const cid = `mv-pair-${row}-${col}`;
        const canvas = document.getElementById(cid);
        if (!canvas) return;
        const actualW = canvas.parentElement.offsetWidth || 100;
        canvas.width  = actualW;
        canvas.height = actualW;
        if (row === col) {
          const dVals = pairSample.map(r => parseFloat(r[cx])).filter(v => !isNaN(v));
          const density = makeDensity(dVals, 40);
          destroyChart(cid);
          chartInstances[cid] = new Chart(canvas, {
            type: "line",
            data: {
              labels: density.xs.map(x => x.toFixed(1)),
              datasets: [{ data: density.ys, borderColor: "#1A5276", backgroundColor: "rgba(26,82,118,0.18)", fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }],
            },
            options: { responsive: false, animation: false, plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { callbacks: { title: () => cx } } }, scales: { x: { display: false }, y: { display: false } } },
          });
        } else {
          const pts = pairSample.map(r => ({ x: parseFloat(r[cx]), y: parseFloat(r[cy]) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
          const r = calcCorr(pairSample, cx, cy);
          const isDarkMv = document.body.classList.contains("dark-mode");
          const dotColor = r > 0.4
            ? (isDarkMv ? "rgba(255,220,0,0.9)" : "rgba(26,118,82,0.6)")
            : r < -0.4
            ? (isDarkMv ? "rgba(255,120,120,0.9)" : "rgba(192,57,43,0.6)")
            : (isDarkMv ? "rgba(100,210,255,0.95)" : "rgba(90,110,160,0.5)");
          destroyChart(cid);
          chartInstances[cid] = new Chart(canvas, {
            type: "scatter",
            data: { datasets: [{ data: pts, backgroundColor: dotColor, pointRadius: 2 }] },
            options: { responsive: false, animation: false, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { x: { display: false }, y: { display: false } } },
          });
        }
      });
    });
  }, 80);

  // ── INSIGHT OTOMATIS MULTIVARIAT (desain seragam, dalam card) ─────────────
  const insightEl = document.getElementById("mv-viz-insight");
  if (insightEl) {
    let pairs = [];
    for (let i = 0; i < selectedCols.length; i++) {
      for (let j = i + 1; j < selectedCols.length; j++) {
        pairs.push({ c1: selectedCols[i], c2: selectedCols[j], r: corrs[i][j] });
      }
    }
    pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

    const strongest  = pairs[0];
    const weakest    = pairs[pairs.length - 1];
    const posStrong  = pairs.filter(p => p.r >  0.6);
    const negStrong  = pairs.filter(p => p.r < -0.6);
    const highCorr   = pairs.filter(p => Math.abs(p.r) > 0.7);
    const avgAbsCorr = pairs.length
      ? (pairs.reduce((s, p) => s + Math.abs(p.r), 0) / pairs.length).toFixed(3)
      : "0.000";

    const rows = [];

    if (strongest) {
      const absR = Math.abs(strongest.r);
      const label = absR > 0.7 ? "kuat" : absR > 0.4 ? "sedang" : "lemah";
      const dir   = strongest.r > 0 ? "positif" : "negatif";
      rows.push({
        color: "#F4AECF",
        label: "Korelasi Terkuat",
        text: `<strong>${strongest.c1}</strong> vs <strong>${strongest.c2}</strong> — r = ${strongest.r.toFixed(3)} (${dir} ${label}). Jika ${strongest.c1} meningkat, ${strongest.c2} cenderung ${strongest.r > 0 ? "ikut naik" : "turun"}.`
      });
    }
    if (weakest && pairs.length > 1) {
      rows.push({
        color: "#A8CDEF",
        label: "Korelasi Terlemah",
        text: `<strong>${weakest.c1}</strong> vs <strong>${weakest.c2}</strong> — r = ${weakest.r.toFixed(3)}. Kedua variabel ini relatif independen satu sama lain.`
      });
    }
    rows.push({
      color: "#F5E642",
      label: "Rata-rata Korelasi Absolut",
      text: `Rata-rata |r| antar ${selectedCols.length} variabel = <strong>${avgAbsCorr}</strong>. ${
        parseFloat(avgAbsCorr) > 0.5 ? "Korelasi antar variabel dalam dataset ini relatif tinggi." :
        parseFloat(avgAbsCorr) < 0.2 ? "Variabel-variabel cenderung independen satu sama lain." :
        "Terdapat korelasi moderat antar variabel."
      }`
    });
    if (highCorr.length > 0) {
      rows.push({
        color: "#F4C4A0",
        label: "Potensi Multikolinearitas",
        text: `<strong>${highCorr.length} pasang variabel</strong> memiliki |r| > 0.7: ${highCorr.map(p => `${p.c1} & ${p.c2} (${p.r.toFixed(3)})`).join(", ")}. Perlu diperhatikan saat membangun model prediktif.`
      });
    }
    if (posStrong.length > 0) {
      rows.push({
        color: "#B8D96E",
        label: "Korelasi Positif Kuat",
        text: `${posStrong.length} pasang berkorelasi positif kuat (r > 0.6): ${posStrong.map(p => `${p.c1} ↔ ${p.c2}`).join(", ")}. Variabel-variabel ini mungkin mengukur dimensi yang serupa.`
      });
    }
    if (negStrong.length > 0) {
      rows.push({
        color: "#E88B42",
        label: "Korelasi Negatif Kuat",
        text: `${negStrong.length} pasang berkorelasi negatif kuat (r < −0.6): ${negStrong.map(p => `${p.c1} ↔ ${p.c2}`).join(", ")}. Peningkatan satu variabel cenderung diikuti penurunan yang lain.`
      });
    }

    const rowsHtml = rows.map(row => `
      <div style="
        display:flex;align-items:flex-start;gap:0;
        border-left:4px solid ${row.color};
        background:var(--cream-dark);border-radius:8px;
        padding:10px 14px;
        margin-bottom:8px;
      ">
        <div style="flex:1;">
          <span style="font-size:12px;font-weight:700;color:var(--text-dark);">${row.label}:</span>
          <span style="font-size:13px;color:var(--text-dark);margin-left:6px;">${row.text}</span>
        </div>
      </div>`).join("");

    insightEl.innerHTML = `
      <div class="card" style="margin-top:16px;padding:20px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--text-dark);">
          Insight Analisis Multivariat
        </div>
        <div style="display:flex;flex-direction:column;gap:0;">
          ${rowsHtml}
        </div>
      </div>`;
  }
}

function renderCatNumViz() {
  const cat = document.getElementById("cn-cat").value;
  const num = document.getElementById("cn-num").value;
  if (!cat || !num) return;

  const freq = {};
  cleanData.forEach((r) => {
    const k = r[cat];
    const v = parseFloat(r[num]);
    if (k === undefined || k === "" || isNaN(v)) return;
    if (!freq[k]) freq[k] = [];
    freq[k].push(v);
  });
  const catKeys = Object.keys(freq).slice(0, 10);
  const manyCategories = catKeys.length > 4;

  // Helper statistik deskriptif lengkap
  function descStats(vals) {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    const mean = s.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 === 0
      ? (s[n / 2 - 1] + s[n / 2]) / 2
      : s[Math.floor(n / 2)];
    const q1 = s[Math.floor(n * 0.25)];
    const q3 = s[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const wLow = Math.min(...s.filter(x => x >= q1 - 1.5 * iqr));
    const wHigh = Math.max(...s.filter(x => x <= q3 + 1.5 * iqr));
    const outliers = s.filter(x => x < wLow || x > wHigh);
    const modeMap = {};
    s.forEach(v => { modeMap[v] = (modeMap[v] || 0) + 1; });
    const maxFreq = Math.max(...Object.values(modeMap));
    const mode = parseFloat(Object.keys(modeMap).find(k => modeMap[k] === maxFreq));
    const skew = n > 2
      ? (s.reduce((a, b) => a + ((b - mean) / (std || 1)) ** 3, 0) / n)
      : 0;
    return { n, mean, median, mode, q1, q3, iqr, std, variance, min: s[0], max: s[n - 1], wLow, wHigh, outliers, skew };
  }

  function fmtN(v) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + "K";
    return v.toFixed(2);
  }

  // ── Callback untuk tick sumbu angka (singkat) ──────────────
  function shortTickCallback(value) {
    if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1) + "B";
    if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + "M";
    if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + "K";
    return value;
  }

  const means = catKeys.map((k) => {
    const vals = freq[k];
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  setTimeout(() => {

    // ── BOXPLOT ──────────────────────────────────────────────
    showLoading(document.getElementById("catbox-chart"));
    destroyChart("catbox-chart");
    chartInstances["catbox-chart"] = new Chart(
      document.getElementById("catbox-chart"),
      {
        type: "boxplot",
        data: {
          labels: catKeys,
          datasets: [{
            label: num,
            data: catKeys.map((k) => {
              const st = descStats(freq[k]);
              return {
                min: st.wLow,
                q1: st.q1,
                median: st.median,
                q3: st.q3,
                max: st.wHigh,
                outliers: st.outliers,
              };
            }),
            backgroundColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + "88"),
            borderColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 2,
            outlierBackgroundColor: "#E85D5D",
            outlierRadius: 4,
            itemRadius: 0,
          }],
        },
        options: {
  indexAxis: manyCategories ? "y" : "x",
  responsive: true,
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    title: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const k = catKeys[ctx.dataIndex];
          const st = descStats(freq[k]);
          return [
            `n         : ${st.n}`,
            `Mean      : ${fmtN(st.mean)}`,
            `Median    : ${fmtN(st.median)}`,
            `Mode      : ${fmtN(st.mode)}`,
            `Std Dev   : ${fmtN(st.std)}`,
            `Variance  : ${fmtN(st.variance)}`,
            `Q1        : ${fmtN(st.q1)}`,
            `Q3        : ${fmtN(st.q3)}`,
            `IQR       : ${fmtN(st.iqr)}`,
            `Min       : ${fmtN(st.min)}`,
            `Max       : ${fmtN(st.max)}`,
            `Whisker L : ${fmtN(st.wLow)}`,
            `Whisker H : ${fmtN(st.wHigh)}`,
            `Outliers  : ${st.outliers.length}`,
            `Skewness  : ${st.skew.toFixed(3)}`,
          ];
        },
      },
    },
  },
  scales: manyCategories ? {
    x: {
      title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
    y: {
      type: "category",
      labels: catKeys,
      title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 11 } },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
  } : {
    x: {
      type: "category",
      labels: catKeys,
      title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 11 } },
      grid: { display: false },
    },
    y: {
      title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
  },
},
},
);
    hideLoading("catbox-chart");

    // ── GROUPED BAR ───────────────────────────────────────────
    showLoading(document.getElementById("grouped-bar-chart"));
    destroyChart("grouped-bar-chart");
    chartInstances["grouped-bar-chart"] = new Chart(
      document.getElementById("grouped-bar-chart"),
      {
        type: "bar",
        data: {
          labels: catKeys,
          datasets: [{
            label: `Mean ${num}`,
            data: means,
            backgroundColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + "99"),
            borderRadius: 5,
          }],
        },
        options: {
  indexAxis: manyCategories ? "y" : "x",
  responsive: true,
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    title: {
      display: true,
      text: `Mean ${num} per ${cat}`,
      font: { family: "DM Sans", size: 14, weight: "bold" },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const k = catKeys[ctx.dataIndex];
          const st = descStats(freq[k]);
          return [
            `n         : ${st.n}`,
            `Mean      : ${fmtN(st.mean)}`,
            `Median    : ${fmtN(st.median)}`,
            `Std Dev   : ${fmtN(st.std)}`,
            `Min       : ${fmtN(st.min)}`,
            `Max       : ${fmtN(st.max)}`,
            `Skewness  : ${st.skew.toFixed(3)}`,
          ];
        },
      },
    },
  },
  scales: manyCategories ? {
    x: {
      title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
    y: {
      type: "category",
      labels: catKeys,
      title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 11 } },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
  } : {
    x: {
      type: "category",
      labels: catKeys,
      title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
      ticks: { maxRotation: 0, font: { family: "DM Sans", size: 11 } },
      grid: { display: false },
    },
    y: {
      title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
      ticks: { font: { family: "DM Sans", size: 11 }, callback: shortTickCallback },
      grid: { color: gridColor(), lineWidth: gridLineWidth() },
    },
  },
},
},
);
    hideLoading("grouped-bar-chart");

    // ── STRIP PLOT ────────────────────────────────────────────
    showLoading(document.getElementById("strip-chart"));
    const stripDatasets = catKeys.map((k, i) => ({
      label: k,
      data: freq[k].slice(0, 100).map((v) => ({ x: manyCategories ? v : k, y: manyCategories ? k : v })),
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "88",
      pointRadius: 4,
      showLine: false,
    }));
    destroyChart("strip-chart");
    chartInstances["strip-chart"] = new Chart(
      document.getElementById("strip-chart"),
      {
        type: "scatter",
        data: { datasets: stripDatasets },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const k = ctx.dataset.label;
                  const st = descStats(freq[k]);
                  const val = manyCategories ? ctx.parsed.x : ctx.parsed.y;
                  return [
                    `${k}`,
                    `Value     : ${fmtN(val)}`,
                    `Mean      : ${fmtN(st.mean)}`,
                    `Median    : ${fmtN(st.median)}`,
                    `Std Dev   : ${fmtN(st.std)}`,
                    `n         : ${st.n}`,
                  ];
                },
              },
            },
          },
          scales: {
            x: manyCategories
              ? {
                  title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
                  ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
                  grid: { color: gridColor(), lineWidth: gridLineWidth() },
                }
              : {
                  type: "category", labels: catKeys,
                  ticks: { font: { family: "DM Sans", size: 11 } },
                  grid: { display: false },
                },
            y: manyCategories
              ? {
                  type: "category", labels: catKeys,
                  ticks: { font: { family: "DM Sans", size: 11 } },
                  grid: { color: gridColor(), lineWidth: gridLineWidth() },
                }
              : {
                  title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
                  ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
                  grid: { color: gridColor(), lineWidth: gridLineWidth() },
                },
          },
        },
      },
    );
    hideLoading("strip-chart");

    // ── VIOLIN (Chart.js violin type, sama seperti numerik) ───
    showLoading(document.getElementById("violin-cat-chart"));
    destroyChart("violin-cat-chart");
    chartInstances["violin-cat-chart"] = new Chart(
      document.getElementById("violin-cat-chart"),
      {
        type: "violin",
        data: {
          labels: catKeys,
          datasets: [{
            label: num,
            data: catKeys.map(k => freq[k]),
            backgroundColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + "99"),
            borderColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 2,
            medianColor: "#e85d5d",
            meanColor: "#1a6ef5",
            itemRadius: 0,
          }],
        },
        options: {
          responsive: true,
          indexAxis: manyCategories ? "y" : "x",
          layout: { padding: { left: 20, right: 50, top: 10, bottom: 10 } },
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
            title: {
              display: true,
              text: `Violin Plot — ${num} per ${cat}`,
              font: { family: "DM Sans", size: 14, weight: "bold" },
              color: document.body.classList.contains("dark-mode") ? "#ffffff" : "#1a1a1a",
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const k = catKeys[ctx.dataIndex];
                  const st = descStats(freq[k]);
                  return [
                    `n         : ${st.n}`,
                    `Mean      : ${fmtN(st.mean)}`,
                    `Median    : ${fmtN(st.median)}`,
                    `Std Dev   : ${fmtN(st.std)}`,
                    `Q1        : ${fmtN(st.q1)}`,
                    `Q3        : ${fmtN(st.q3)}`,
                    `Min       : ${fmtN(st.min)}`,
                    `Max       : ${fmtN(st.max)}`,
                    `Outliers  : ${st.outliers.length}`,
                    `Skewness  : ${st.skew.toFixed(3)}`,
                  ];
                },
              },
            },
          },
          scales: manyCategories ? {
            x: {
              title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
              ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
              grid: { color: gridColor(), lineWidth: gridLineWidth() },
            },
            y: {
              type: "category",
              labels: catKeys,
              title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
              ticks: { font: { family: "DM Sans", size: 11 } },
              grid: { color: gridColor(), lineWidth: gridLineWidth() },
            },
          } : {
            x: {
              type: "category",
              labels: catKeys,
              title: { display: true, text: cat, font: { family: "DM Sans", size: 11 } },
              ticks: { font: { family: "DM Sans", size: 11 } },
              grid: { display: false },
            },
            y: {
              title: { display: true, text: num, font: { family: "DM Sans", size: 11 } },
              ticks: { font: { family: "DM Sans", size: 10 }, callback: shortTickCallback },
              grid: { color: gridColor(), lineWidth: gridLineWidth() },
            },
          },
          animation: { duration: 700, easing: "easeOutQuart" },
        },
      }
    );
    hideLoading("violin-cat-chart");

    // Auto Insight Kat vs Num
    const meanPerCat = catKeys.map(k => ({
      cat: k,
      mean: freq[k].reduce((a,b)=>a+b,0)/freq[k].length,
      count: freq[k].length,
      std: Math.sqrt(freq[k].reduce((a,b)=>a+(b-(freq[k].reduce((x,y)=>x+y,0)/freq[k].length))**2,0)/freq[k].length)
    }));
    const highMean = meanPerCat.reduce((a,b)=>a.mean>b.mean?a:b);
    const lowMean = meanPerCat.reduce((a,b)=>a.mean<b.mean?a:b);
    const highStd = meanPerCat.reduce((a,b)=>a.std>b.std?a:b);
    const allValsFlat = catKeys.flatMap(k=>freq[k]);
    const globalMean = allValsFlat.reduce((a,b)=>a+b,0)/allValsFlat.length;

    let cnInsightHtml = `
      <div style="margin-top:20px;padding:16px;background:var(--bg-card,#f5f0e8);border-radius:12px;border:1px solid var(--border,#e0ddd5);">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">Insight — ${num} per ${cat}</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #B8D96E;">
            <strong>Mean Tertinggi:</strong> "${highMean.cat}" — rata-rata ${highMean.mean.toFixed(2)} (${highMean.count} data)
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F4AECF;">
            <strong>Mean Terendah:</strong> "${lowMean.cat}" — rata-rata ${lowMean.mean.toFixed(2)} (${lowMean.count} data)
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #F5E642;">
            <strong>Variabilitas Terbesar:</strong> "${highStd.cat}" — Std Dev = ${highStd.std.toFixed(2)}, data paling tersebar
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid #A8CDEF;">
            <strong>Selisih Mean:</strong> ${(highMean.mean - lowMean.mean).toFixed(2)} — perbedaan antara kategori tertinggi dan terendah
          </div>
          <div style="padding:8px 12px;background:#fff;border-radius:8px;border-left:4px solid ${Math.abs(highMean.mean-globalMean)/globalMean>0.3?'#E85D5D':'#B8D96E'};">
            <strong>Global Mean:</strong> ${globalMean.toFixed(2)} — ${Math.abs(highMean.mean-globalMean)/globalMean>0.3?'ada perbedaan signifikan antar kategori':'perbedaan antar kategori relatif kecil'}
          </div>
        </div>
      </div>
    `;
    const cnInsightEl = document.getElementById("cn-viz-insight");
    if (cnInsightEl) cnInsightEl.innerHTML = cnInsightHtml;

  }, 50);
}

// ===== TIME SERIES =====
function initTimeSeries() {
  const noData = document.getElementById("ts-no-data");
  const noDatetime = document.getElementById("ts-no-datetime");
  const content = document.getElementById("ts-content");
  if (!cleanData.length) {
    noData.style.display = "flex";
    noDatetime.style.display = "none";
    content.style.display = "none";
    return;
  }
  noData.style.display = "none";

  const dtCols = headers.filter((h) => colTypes[h] === "datetime");
  const numCols = headers.filter((h) => colTypes[h] === "numeric");

  if (!dtCols.length) {
    noDatetime.style.display = "flex";
    content.style.display = "none";
    return;
  }

  // ── Filter: kolom datetime yang layak untuk time series ──
  // Syarat: setelah diagregasi per bulan/tahun, ada minimal 3 periode berbeda
  // DAN jumlah unique periode (bulan-tahun) < 90% dari total baris
  // Ini memastikan data tidak "satu tanggal per transaksi" tanpa pola agregasi yang bermakna
  function isGoodTSCol(col) {
    const vals = cleanData
      .map(r => r[col])
      .filter(v => v !== "" && v !== null && v !== undefined);
    if (!vals.length) return false;

    const parsed = vals.map(v => new Date(v)).filter(d => !isNaN(d.getTime()));
    if (parsed.length < 3) return false;

    // Hitung unique di level bulan-tahun
    const monthKeys = parsed.map(d => `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`);
    const uniqueMonths = new Set(monthKeys).size;

    // Hitung unique di level tahun
    const yearKeys = parsed.map(d => `${d.getFullYear()}`);
    const uniqueYears = new Set(yearKeys).size;

    // Hitung unique tanggal penuh
    const uniqueDates = new Set(parsed.map(d => d.toDateString())).size;

    const totalRows = parsed.length;

    // SYARAT UTAMA: ada pengulangan periode
    // Jika rata-rata baris per bulan >= 2 → ada agregasi yang bermakna
    const avgRowsPerMonth = totalRows / uniqueMonths;
    if (avgRowsPerMonth >= 2 && uniqueMonths >= 3) return true;

    // Jika rata-rata baris per tahun >= 5 → cocok diagregasi per tahun
    const avgRowsPerYear = totalRows / uniqueYears;
    if (avgRowsPerYear >= 5 && uniqueYears >= 2) return true;

    // TOLAK: jika hampir setiap baris punya tanggal unik (transaksi harian per baris)
    // uniqueDates / totalRows > 0.7 berarti 70%+ baris punya tanggal berbeda → tidak cocok
    if (uniqueDates / totalRows > 0.7) return false;

    return false;
  }

  const goodDtCols = dtCols.filter(isGoodTSCol);

  if (!goodDtCols.length) {
    noDatetime.style.display = "flex";
    content.style.display = "none";
    const pEl = noDatetime.querySelector("p");
    if (pEl) {
      pEl.textContent =
        "Kolom datetime ditemukan, namun tidak ada yang cocok untuk time series. " +
        "Kolom datetime yang valid untuk time series harus memiliki banyak transaksi per periode " +
        "(misal: banyak transaksi per bulan/tahun), bukan satu tanggal unik per baris.";
    }
    return;
  }

  noDatetime.style.display = "none";
  content.style.display = "block";

  const numColsFiltered = numCols.filter(h =>
    !isUniqueCol(h, "numeric") && !(/^id$|^ID$|_id$|^no$|^No$|^NO$|^index$|^idx$|^kode$/i.test(h))
  );

  const dateSelect = document.getElementById("ts-date-col");
  const valSelect  = document.getElementById("ts-value-col");

  dateSelect.innerHTML = goodDtCols.map(c => `<option>${c}</option>`).join("");
  valSelect.innerHTML  = numColsFiltered.map(c => `<option>${c}</option>`).join("");

  // Auto-render dengan variabel default (sama seperti summary dashboard)
  const defaultDateCol = goodDtCols[0];
  const defaultValCol = (() => {
    // Coba ambil kolom yang sama dengan summary dashboard (autoPickNumCol)
    const picked = autoPickNumCol();
    // Pastikan ada di daftar numColsFiltered
    if (picked && numColsFiltered.includes(picked)) return picked;
    return numColsFiltered[0] || null;
  })();

  if (defaultDateCol && defaultValCol) {
    dateSelect.value = defaultDateCol;
    valSelect.value  = defaultValCol;
    setTimeout(() => renderTimeSeries(), 150);
  }
}

function renderTimeSeries() {
  const dateCol = document.getElementById("ts-date-col").value;
  const valCol  = document.getElementById("ts-value-col").value;
  if (!dateCol || !valCol) return;

  // ── Parse & sort ──────────────────────────────────────────
  const raw = cleanData
    .map(r => ({ date: new Date(r[dateCol]), val: parseFloat(r[valCol]) }))
    .filter(d => !isNaN(d.date.getTime()) && !isNaN(d.val))
    .sort((a, b) => a.date - b.date);

  if (!raw.length) return;

  // ── Tentukan granularitas agregasi ────────────────────────
  const uniqueMonths = new Set(raw.map(d => `${d.date.getFullYear()}-${d.date.getMonth()}`)).size;
  const uniqueYears  = new Set(raw.map(d => `${d.date.getFullYear()}`)).size;
  const totalRows    = raw.length;

  let keyFn, labelFn, granLabel;

  const avgPerMonth = totalRows / uniqueMonths;
  const avgPerYear  = totalRows / uniqueYears;

  if (avgPerYear >= 5 && uniqueYears >= 2 && uniqueMonths <= 12) {
    keyFn      = d => `${d.getFullYear()}`;
    labelFn    = k => k;
    granLabel  = "per Tahun";
  } else if (avgPerMonth >= 2 && uniqueMonths >= 3) {
    keyFn      = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labelFn    = k => {
      const [y, m] = k.split('-');
      return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
    };
    granLabel  = "per Bulan";
  } else {
    keyFn      = d => d.toDateString();
    labelFn    = k => new Date(k).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
    granLabel  = "per Hari";
  }

  // ── Agregasi SUM per periode ──────────────────────────────
  const aggMap = new Map();
  raw.forEach(({ date, val }) => {
    const key = keyFn(date);
    if (!aggMap.has(key)) aggMap.set(key, { sum: 0, date });
    aggMap.get(key).sum += val;
  });

  const aggEntries = Array.from(aggMap.entries()).sort((a, b) => a[1].date - b[1].date);
  const labels = aggEntries.map(([k]) => labelFn(k));
  const values = aggEntries.map(([, v]) => v.sum);

  if (!labels.length) return;

  const n = values.length;

  // ── MA-7 ──────────────────────────────────────────────────
  const ma7 = values.map((_, i) => {
    if (i < 6) return null;
    return values.slice(i - 6, i + 1).reduce((a, b) => a + b, 0) / 7;
  });

  // ── Rolling Mean 30 ───────────────────────────────────────
  const roll30 = values.map((_, i) => {
    const sl = values.slice(Math.max(0, i - 29), i + 1);
    return sl.reduce((a, b) => a + b, 0) / sl.length;
  });

  // ── Trend (regresi linear) ────────────────────────────────
  const xs        = values.map((_, i) => i);
  const xMean     = xs.reduce((a, b) => a + b, 0) / n;
  const yMean     = values.reduce((a, b) => a + b, 0) / n;
  const denom     = xs.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
  const slope     = denom === 0 ? 0 : xs.reduce((acc, x, i) => acc + (x - xMean) * (values[i] - yMean), 0) / denom;
  const intercept = yMean - slope * xMean;
  const trendLine = xs.map(x => parseFloat((intercept + slope * x).toFixed(2)));

  // ── Point radius: tampilkan titik kalau data sedikit ──────
  const ptRadius = n <= 24 ? 4 : n <= 60 ? 2 : 0;

  // ── Shared chart options factory ──────────────────────────
  function makeOpts(titleText) {
    const isDarkTS = document.body.classList.contains("dark-mode");
    const gridColorVal = isDarkTS ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)";
    const gridLineWidthVal = isDarkTS ? 0.6 : 0.7;
    const titleColor = isDarkTS ? "#ffffff" : "#1a1a1a";
    const tickColor = isDarkTS ? "#aaaaaa" : "#666666";
    return {
      responsive: true,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        title: {
          display: true,
          text: titleText,
          font: { family: "DM Sans", size: 13, weight: "bold" },
          color: titleColor,
        },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            maxTicksLimit: 12,
            font: { family: "DM Sans", size: 10 },
            color: tickColor,
          },
          grid: {
            display: true,
            drawOnChartArea: true,
            drawTicks: true,
            color: gridColorVal,
            lineWidth: gridLineWidthVal,
          },
        },
        y: {
          ticks: {
            font: { family: "DM Sans", size: 10 },
            color: tickColor,
            callback: v => {
              const abs = Math.abs(v);
              if (abs >= 1e9) return (v/1e9).toFixed(1)+"B";
              if (abs >= 1e6) return (v/1e6).toFixed(1)+"M";
              if (abs >= 1e3) return (v/1e3).toFixed(1)+"K";
              return v;
            }
          },
          grid: {
            display: true,
            drawOnChartArea: true,
            drawTicks: true,
            color: gridColorVal,
            lineWidth: gridLineWidthVal,
          },
        },
      },
    };
  }

  // ── Destroy semua chart dulu, baru render ─────────────────
  ["ts-line-chart","ts-ma-chart","ts-roll-chart","ts-trend-chart"].forEach(id => destroyChart(id));

  // ── 1. Time Series Line Chart ─────────────────────────────
  chartInstances["ts-line-chart"] = new Chart(
    document.getElementById("ts-line-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: valCol,
          data: values,
          borderColor: "#d4a800",         // kuning lebih gelap agar terlihat
          backgroundColor: "rgba(245,230,66,0.18)",
          fill: true,
          tension: 0,                      // STRAIGHT lines, bukan smooth
          pointRadius: ptRadius,
          pointBackgroundColor: "#d4a800",
          borderWidth: 2,
        }],
      },
      options: makeOpts(`Time Series Line Chart — ${valCol} (Sum ${granLabel})`),
    }
  );

  // ── 2. Moving Average ─────────────────────────────────────
  chartInstances["ts-ma-chart"] = new Chart(
    document.getElementById("ts-ma-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: valCol,
            data: values,
            borderColor: "rgb(243, 111, 208)",
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: "Moving Average (7)",
            data: ma7,
            borderColor: "#c2006f",
            fill: false,
            tension: 0,
            pointRadius: values.length <= 24 ? 3 : 0,
            pointBackgroundColor: "#c2006f",
            borderWidth: 2.5,
          },
        ],
      },
      options: {
        ...makeOpts(`Moving Average 7 Periode — ${valCol}`),
        plugins: {
          ...makeOpts("").plugins,
          title: {
            display: true,
            text: `Moving Average 7 Periode — ${valCol}`,
            font: { family: "DM Sans", size: 13, weight: "bold" },
            color: "#1a1a1a",
          },
          legend: {
            display: true,
            position: "bottom",
            labels: { font: { family: "DM Sans", size: 11 }, boxWidth: 14 },
          },
          datalabels: { display: false },
        },
      },
    }
  );

  // ── 3. Rolling Mean ───────────────────────────────────────
  chartInstances["ts-roll-chart"] = new Chart(
    document.getElementById("ts-roll-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: valCol,
            data: values,
            borderColor: "rgb(140, 164, 241)",
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: "Rolling Mean (30)",
            data: roll30,
            borderColor: "#2d7a00",
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 2.5,
          },
        ],
      },
      options: {
        ...makeOpts(`Rolling Mean 30 Periode — ${valCol}`),
        plugins: {
          ...makeOpts("").plugins,
          title: {
            display: true,
            text: `Rolling Mean 30 Periode — ${valCol}`,
            font: { family: "DM Sans", size: 13, weight: "bold" },
            color: "#1a1a1a",
          },
          legend: {
            display: true,
            position: "bottom",
            labels: { font: { family: "DM Sans", size: 11 }, boxWidth: 14 },
          },
          datalabels: { display: false },
        },
      },
    }
  );

  // ── 4. Trend Line ─────────────────────────────────────────
  chartInstances["ts-trend-chart"] = new Chart(
    document.getElementById("ts-trend-chart"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: valCol,
            data: values,
            borderColor: "rgba(52, 232, 151, 0.81)",
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: "Trend Line",
            data: trendLine,
            borderColor: "#cc1a1a",
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 2.5,
            borderDash: [8, 4],
          },
        ],
      },
      options: {
        ...makeOpts(`Trend Line — ${valCol}`),
        plugins: {
          ...makeOpts("").plugins,
          title: {
            display: true,
            text: `Trend Line — ${valCol}`,
            font: { family: "DM Sans", size: 13, weight: "bold" },
            color: "#1a1a1a",
          },
          legend: {
            display: true,
            position: "bottom",
            labels: { font: { family: "DM Sans", size: 11 }, boxWidth: 14 },
          },
          datalabels: { display: false },
        },
      },
    }
  );

  // ── Summary Stats ─────────────────────────────────────────
  const direction  = slope > 0.001 ? "↑ Tren Naik" : slope < -0.001 ? "↓ Tren Turun" : "→ Stabil";
  const firstDate  = aggEntries[0][1].date;
  const lastDate   = aggEntries[aggEntries.length - 1][1].date;
  const rangeStr   = `${firstDate.toLocaleDateString("id-ID")} — ${lastDate.toLocaleDateString("id-ID")}`;
  const maxVal     = Math.max(...values);
  const minVal     = Math.min(...values);

  // Format angka ringkasan: K/M/B otomatis, 1 desimal
  function fmtTS(v) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return parseFloat(v.toFixed(1)).toLocaleString("id-ID");
  }
  function fmtSlope(s) {
    const abs = Math.abs(s);
    if (abs >= 1e6) return (s / 1e6).toFixed(2) + "M/periode";
    if (abs >= 1e3) return (s / 1e3).toFixed(2) + "K/periode";
    return s.toFixed(2) + "/periode";
  }

  document.getElementById("ts-summary-content").innerHTML = `
    <div class="grid-4">
      <div class="stat-card card-colored yellow">
        <div class="stat-label">Periode Data</div>
        <div class="stat-value" style="font-size:16px;">${n} titik</div>
        <div class="stat-sub">${rangeStr} · ${granLabel}</div>
      </div>
      <div class="stat-card card-colored pink">
        <div class="stat-label">Trend</div>
        <div class="stat-value" style="font-size:18px;">${direction}</div>
        <div class="stat-sub">slope = ${fmtSlope(slope)}</div>
      </div>
      <div class="stat-card card-colored green">
        <div class="stat-label">Nilai Max</div>
        <div class="stat-value" style="font-size:22px;">${fmtTS(maxVal)}</div>
        <div class="stat-sub">${valCol} (sum)</div>
      </div>
      <div class="stat-card card-colored blue">
        <div class="stat-label">Nilai Min</div>
        <div class="stat-value" style="font-size:22px;">${fmtTS(minVal)}</div>
        <div class="stat-sub">${valCol} (sum)</div>
      </div>
    </div>
  `;
}

// ===== INSIGHTS =====
function renderInsights() {
  const noData = document.getElementById("insight-no-data");
  const content = document.getElementById("insight-content");
  if (!cleanData.length) {
    noData.style.display = "flex";
    content.style.display = "none";
    return;
  }
  noData.style.display = "none";
  content.style.display = "block";

  const numCols = headers.filter((h) => colTypes[h] === "numeric" && !isUniqueCol(h, "numeric"));
  const catCols = headers.filter((h) => colTypes[h] === "categorical" && !isUniqueCol(h, "categorical"));
  const dtCols  = headers.filter((h) => colTypes[h] === "datetime");

  // ── HITUNG STATS ────────────────────────────────────────────
  const statsArr = numCols.map((col) => {
    const vals = cleanData.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));
    const s = calcNumStats(vals);
    return { col, ...s, outliers: countOutliers(vals), vals };
  });

  const rawMissingTotal = headers.reduce((acc, h) =>
    acc + rawData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length, 0);
  const cleanMissingTotal = headers.reduce((acc, h) =>
    acc + cleanData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length, 0);

  const rawSeen = new Set();
  let rawDupCount = 0;
  rawData.forEach(row => {
    const k = JSON.stringify(row);
    if (rawSeen.has(k)) rawDupCount++;
    else rawSeen.add(k);
  });
  const cleanSeen = new Set();
  let cleanDupCount = 0;
  cleanData.forEach(row => {
    const k = JSON.stringify(row);
    if (cleanSeen.has(k)) cleanDupCount++;
    else cleanSeen.add(k);
  });

  // ── HELPER ──────────────────────────────────────────────────
  function insightBox(text, sub, color) {
  return `<div style="padding:10px 14px;background:var(--cream-dark);border-radius:8px;border-left:4px solid ${color};margin-bottom:8px;">
    <div style="font-weight:700;font-size:13px;">${text}</div>
    ${sub ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${sub}</div>` : ""}
  </div>`;
}

  // ── 1. INTERPRETASI ─────────────────────────────────────────
  let interpHtml = "";

  interpHtml += insightBox(
    `Missing values berkurang dari ${rawMissingTotal} menjadi ${cleanMissingTotal}`,
    cleanMissingTotal === 0 ? "Dataset bersih dari nilai kosong setelah cleaning." : `Masih ada ${cleanMissingTotal} nilai kosong.`,
    cleanMissingTotal === 0 ? "#B8D96E" : "#E85D5D"
  );

  interpHtml += insightBox(
    `Duplikat berkurang dari ${rawDupCount} menjadi ${cleanDupCount}`,
    cleanDupCount === 0 ? "Semua baris sudah unik setelah cleaning." : `Masih ada ${cleanDupCount} baris duplikat.`,
    cleanDupCount === 0 ? "#B8D96E" : "#E85D5D"
  );

  const normalCols  = statsArr.filter(s => Math.abs(s.skewness) < 0.5);
  const skewedCols  = statsArr.filter(s => Math.abs(s.skewness) >= 0.5);
  const rightSkewed = statsArr.filter(s => s.skewness > 0.5);
  const leftSkewed  = statsArr.filter(s => s.skewness < -0.5);

  if (normalCols.length) {
    interpHtml += insightBox(
      `Distribusi mendekati normal: ${normalCols.map(s=>s.col).join(", ")}`,
      "Distribusi data sudah cukup seimbang.",
      "#A8CDEF"
    );
  }
  if (rightSkewed.length) {
    interpHtml += insightBox(
      `Right skew: ${rightSkewed.map(s=>s.col).join(", ")}`,
      "Sebagian besar data berada di nilai rendah dengan beberapa nilai tinggi ekstrem.",
      "#F4AECF"
    );
  }
  if (leftSkewed.length) {
    interpHtml += insightBox(
      `Left skew: ${leftSkewed.map(s=>s.col).join(", ")}`,
      "Sebagian besar data berada di nilai tinggi dengan beberapa nilai rendah ekstrem.",
      "#F4C4A0"
    );
  }

  const outlierCols = statsArr.filter(s => s.outliers > 0);
  if (outlierCols.length) {
    interpHtml += insightBox(
      `Outlier masih ditemukan pada: ${outlierCols.map(s=>`${s.col} (${s.outliers})`).join(", ")}`,
      "Nilai ekstrem dipertahankan agar informasi data tidak hilang.",
      "#F5E642"
    );
  }

  catCols.forEach(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const unique = sorted.length;
    const top = sorted[0];
    const topPct = top ? ((top[1] / vals.length) * 100).toFixed(1) : 0;
    interpHtml += insightBox(
      `${col}: ${unique} kategori unik, dominan "${top?.[0]}" (${topPct}%)`,
      null,
      "#B8D96E"
    );
  });

  interpHtml += insightBox(
    "Dataset siap untuk tahap analisis lanjutan",
    "Hasil cleaning membuat data lebih rapi dan konsisten.",
    "#B8D96E"
  );

  document.getElementById("insight-interpretasi").innerHTML = interpHtml;

  // ── 2. INSIGHT OTOMATIS ──────────────────────────────────────
  let insightHtml = "";

  // Numerik — tanpa missing
  if (statsArr.length) {
    const highMean    = statsArr.reduce((a, b) => a.mean > b.mean ? a : b);
    const highStd     = statsArr.reduce((a, b) => a.std > b.std ? a : b);
    const highOutlier = statsArr.reduce((a, b) => a.outliers > b.outliers ? a : b);

    insightHtml += insightBox(
      `Rata-rata tertinggi: ${highMean.col}`,
      `Mean = ${fmt(highMean.mean)} — variabel dengan nilai rata-rata tertinggi.`,
      "#A8CDEF"
    );

    insightHtml += insightBox(
      `Variabilitas terbesar: ${highStd.col}`,
      `Std Dev = ${fmt(highStd.std)} — data paling tersebar/tidak konsisten.`,
      "#A8CDEF"
    );

    if (highOutlier.outliers > 0) {
      const pct = ((highOutlier.outliers / cleanData.length) * 100).toFixed(1);
      const label = highOutlier.outliers > 50
        ? "Jumlah outlier sangat tinggi, perlu penanganan serius sebelum modeling."
        : highOutlier.outliers > 10
        ? "Outlier cukup signifikan, pertimbangkan transformasi atau robust scaling."
        : "Outlier relatif sedikit, masih bisa ditoleransi untuk analisis deskriptif.";
      insightHtml += insightBox(
        `Outlier terbanyak: ${highOutlier.col} (${highOutlier.outliers} data / ${pct}%)`,
        label,
        "#F5E642"
      );
    }

    statsArr.filter(s => Math.abs(s.skewness) > 1).forEach(s => {
      const dir = s.skewness > 0 ? "right skewed" : "left skewed";
      const meaning = s.skewness > 0
        ? "Data condong ke kiri, terdapat nilai ekstrem di kanan."
        : "Data condong ke kanan, terdapat nilai ekstrem di kiri.";
      insightHtml += insightBox(
        `${s.col}: ${dir} (skewness = ${s.skewness.toFixed(3)})`,
        meaning,
        "#F4AECF"
      );
    });
  }

  // Kategorik
  catCols.forEach(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const unique = sorted.length;
    const top = sorted[0];
    const topPct = top ? ((top[1] / vals.length) * 100).toFixed(1) : 0;
    insightHtml += insightBox(
      `${col}: ${unique} kategori unik`,
      `Kategori terbanyak: "${top?.[0]}" (${topPct}%)`,
      "#B8D96E"
    );
  });

  // Korelasi
  if (numCols.length >= 2) {
    let maxR = 0, c1 = "", c2 = "";
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i + 1; j < numCols.length; j++) {
        const r = Math.abs(calcCorr(cleanData, numCols[i], numCols[j]));
        if (r > maxR) { maxR = r; c1 = numCols[i]; c2 = numCols[j]; }
      }
    }
    const strength = maxR > 0.7 ? "Korelasi kuat — kedua variabel sangat berkaitan."
      : maxR > 0.4 ? "Korelasi sedang — ada hubungan moderat."
      : "Korelasi lemah — hubungan antar variabel tidak terlalu signifikan.";
    insightHtml += insightBox(
      `Korelasi terkuat: ${c1} vs ${c2} (r = ${maxR.toFixed(3)})`,
      strength,
      "#A8CDEF"
    );
  }

  document.getElementById("num-insights").innerHTML = insightHtml;
  document.getElementById("cat-insights").innerHTML = "";
  document.getElementById("corr-insights").innerHTML = "";

  // ── 3. TIME SERIES INSIGHT ───────────────────────────────────
  const tsInsightEl = document.getElementById("ts-insights");
  if (tsInsightEl) {
    if (!dtCols.length) {
      tsInsightEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">Tidak ada kolom datetime terdeteksi. Insight Time Series tidak tersedia untuk dataset ini.</div>`;
    } else {
      const dateCol = dtCols[0];
      const valCol  = numCols[0];
      if (!valCol) {
        tsInsightEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">Tidak ada kolom numerik untuk dianalisis.</div>`;
      } else {
        const tsData = cleanData
          .map(r => ({ date: new Date(r[dateCol]), val: parseFloat(r[valCol]) }))
          .filter(d => !isNaN(d.date.getTime()) && !isNaN(d.val))
          .sort((a, b) => a.date - b.date);
        if (!tsData.length) {
          tsInsightEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">Data time series tidak dapat diproses.</div>`;
        } else {
          const values   = tsData.map(d => d.val);
          const n        = values.length;
          const xMean    = (n - 1) / 2;
          const yMean    = values.reduce((a, b) => a + b, 0) / n;
          const slope    = values.reduce((acc, y, i) => acc + (i - xMean) * (y - yMean), 0)
                         / values.reduce((acc, _, i) => acc + (i - xMean) ** 2, 0);
          const maxVal   = Math.max(...values);
          const minVal   = Math.min(...values);
          const trendLabel = slope > 0.01 ? "Tren Naik" : slope < -0.01 ? "Tren Turun" : "Stabil";
          const trendColor = slope > 0.01 ? "#B8D96E" : slope < -0.01 ? "#E85D5D" : "#A8CDEF";
          const startDate = tsData[0].date.toLocaleDateString("id-ID");
          const endDate   = tsData[tsData.length - 1].date.toLocaleDateString("id-ID");

          let tsHtml = "";
          tsHtml += insightBox(`Kolom waktu: ${dateCol} | Variabel: ${valCol}`, `Total ${n} titik data | Periode: ${startDate} — ${endDate}`, "#A8CDEF");
          tsHtml += insightBox(`Tren: ${trendLabel} (slope = ${slope.toFixed(4)})`, slope > 0.01 ? "Nilai cenderung meningkat seiring waktu." : slope < -0.01 ? "Nilai cenderung menurun seiring waktu." : "Tidak ada tren yang jelas.", trendColor);
          tsHtml += insightBox(`Nilai tertinggi: ${fmt(maxVal)} | Terendah: ${fmt(minVal)}`, `Rata-rata: ${fmt(yMean)}`, "#B8D96E");
          tsInsightEl.innerHTML = tsHtml;
        }
      }
    }
  }

  // ── 4. REKOMENDASI ───────────────────────────────────────────
  let rekoHtml = "";

  const skewedVars = statsArr.filter(s => Math.abs(s.skewness) >= 0.5).map(s => s.col);
  if (skewedVars.length) {
    rekoHtml += insightBox(
      `Transformasi data disarankan`,
      `Variabel ${skewedVars.join(", ")} memiliki distribusi skewed. Gunakan transformasi log atau normalisasi sebelum modeling.`,
      "#F4AECF"
    );
  }

  const outlierVars = statsArr.filter(s => s.outliers > 0).map(s => s.col);
  if (outlierVars.length) {
    rekoHtml += insightBox(
      `Penanganan outlier disarankan`,
      `Variabel ${outlierVars.join(", ")} masih memiliki outlier. Pertimbangkan winsorizing, trimming, atau robust scaling untuk machine learning.`,
      "#F5E642"
    );
  }

  const imbalancedCats = catCols.filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
    const top = Object.values(freq).sort((a, b) => b - a)[0];
    return (top / vals.length) * 100 >= 70;
  });
  if (imbalancedCats.length) {
    rekoHtml += insightBox(
      `Distribusi kategori tidak seimbang`,
      `Variabel ${imbalancedCats.join(", ")} memiliki satu kategori dominan (>=70%). Pertimbangkan balancing data untuk klasifikasi.`,
      "#F4C4A0"
    );
  }

  if (cleanMissingTotal === 0 && cleanDupCount === 0) {
    rekoHtml += insightBox(
      `Dataset siap untuk analisis lanjutan`,
      "Tidak ada missing values dan duplikat. Data bersih dan konsisten.",
      "#B8D96E"
    );
  }

  if (numCols.length >= 2) {
    let maxR = 0;
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i + 1; j < numCols.length; j++) {
        const r = Math.abs(calcCorr(cleanData, numCols[i], numCols[j]));
        if (r > maxR) maxR = r;
      }
    }
    if (maxR < 0.3) {
      rekoHtml += insightBox(
        `Korelasi antar variabel lemah`,
        "Disarankan melakukan feature engineering atau menambahkan variabel lain untuk meningkatkan kualitas analisis.",
        "#A8CDEF"
      );
    }
  }

  if (!rekoHtml) {
    rekoHtml = `<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">Tidak terdapat rekomendasi khusus. Dataset sudah dalam kondisi baik.</div>`;
  }

  document.getElementById("insight-rekomendasi").innerHTML = rekoHtml;
}

// ===== REPORT =====
function renderReport() {
  if (!cleanData.length) return;
  const numCols = headers.filter((h) => colTypes[h] === "numeric");
  const catCols = headers.filter((h) => colTypes[h] === "categorical");
  const dtCols = headers.filter((h) => colTypes[h] === "datetime");
  const totalMissing = headers.reduce(
    (acc, h) =>
      acc +
      cleanData.filter(
        (r) => r[h] === "" || r[h] === null || r[h] === undefined,
      ).length,
    0,
  );

  const validasiStatus = totalMissing === 0 && cleanData.length > 0
    ? "✅ Dataset valid dan siap digunakan untuk analisis lanjutan"
    : totalMissing > 0
    ? `⚠️ Masih terdapat ${totalMissing} missing values`
    : "❌ Belum ada data";

  const versiCleaned = cleanData.length !== rawData.length
    ? `Versi cleaned: ${rawData.length - cleanData.length} baris dihapus dari dataset asli`
    : "Versi cleaned: tidak ada baris yang dihapus (data sudah bersih)";

  document.getElementById("report-summary-content").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px;">
      <div class="stat-card card-colored yellow"><div class="stat-label">Nama File</div><div class="stat-value" style="font-size:15px;word-break:break-all;">${fileName || "-"}</div><div class="stat-sub">Dataset aktif</div></div>
      <div class="stat-card card-colored pink"><div class="stat-label">Baris (After Cleaning)</div><div class="stat-value">${cleanData.length.toLocaleString()}</div><div class="stat-sub">${rawData.length} baris asli</div></div>
      <div class="stat-card card-colored green"><div class="stat-label">Kolom</div><div class="stat-value">${headers.length}</div><div class="stat-sub">${numCols.length} num · ${catCols.length} cat · ${dtCols.length} dt</div></div>
      <div class="stat-card card-colored blue"><div class="stat-label">Missing (After)</div><div class="stat-value">${totalMissing}</div><div class="stat-sub">${((totalMissing / Math.max(1, cleanData.length * headers.length)) * 100).toFixed(2)}%</div></div>
    </div>
    <div style="border-top:2px solid var(--border);margin:14px 0;"></div>
    <div style="font-size:12px;color:var(--text-muted);text-align:center;line-height:1.8;">
      Laporan ini dibuat secara otomatis oleh <strong>Auto EDA Analytics Dashboard</strong> — Kelompok 1 | SD-1306 Data Science Programming<br>
      Institut Teknologi Sains Bandung · Dosen: Bakti Siregar, M.Sc., CDS.<br>
      <span style="font-size:11px;color:var(--text-light);">Dibuat: ${new Date().toLocaleString("id-ID")}</span>
    </div>
  `;
}

function printFormalReport() {
  if (!cleanData.length) {
    showNotif("Belum ada data untuk dilaporkan!", "warning");
    return;
  }

  const numCols = headers.filter(h => colTypes[h] === "numeric");
  const catCols = headers.filter(h => colTypes[h] === "categorical");
  const dtCols  = headers.filter(h => colTypes[h] === "datetime");

  const totalMissing = headers.reduce((acc, h) =>
    acc + cleanData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length, 0);
  const rawMissingTotal = headers.reduce((acc, h) =>
    acc + rawData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length, 0);

  const rawSeen = new Set(); let rawDupCount = 0;
  rawData.forEach(row => { const k = JSON.stringify(row); if (rawSeen.has(k)) rawDupCount++; else rawSeen.add(k); });
  const cleanSeen = new Set(); let cleanDupCount = 0;
  cleanData.forEach(row => { const k = JSON.stringify(row); if (cleanSeen.has(k)) cleanDupCount++; else cleanSeen.add(k); });

  // ── Dataset Quality Score ──────────────────────────────────
  const { score: dqScore, issues: dqIssues } = computeDatasetQuality(cleanData, headers, colTypes);
  const dqColor = dqScore >= 80 ? "#1a7a2a" : dqScore >= 60 ? "#b8660a" : "#c0392b";
  const dqLabel = dqScore >= 95 ? "Sangat Baik" : dqScore >= 80 ? "Baik" : dqScore >= 60 ? "Cukup" : "Perlu Perhatian";

  // ── Before vs After per kolom ──────────────────────────────
  const beforeAfterRows = headers.map(col => {
    const missBefore = rawData.filter(r => r[col] === "" || r[col] === null || r[col] === undefined).length;
    const missAfter  = cleanData.filter(r => r[col] === "" || r[col] === null || r[col] === undefined).length;
    const missBefPct = ((missBefore / rawData.length) * 100).toFixed(1);
    const missAftPct = ((missAfter  / cleanData.length) * 100).toFixed(1);
    const t = colTypes[col];
    const typeLabel = t === "numeric" ? "Numerik" : t === "datetime" ? "Datetime" : "Kategorik";
    const status = missAfter === 0 && missBefore > 0 ? "✔ Diperbaiki"
      : missAfter === 0 ? "✔ Bersih"
      : missAfter < missBefore ? "△ Berkurang"
      : "✘ Masih Ada";
    const statusColor = missAfter === 0 ? "#1a7a2a" : missAfter < missBefore ? "#b8660a" : "#c0392b";
    return `<tr>
      <td style="text-align:left;font-weight:600;">${col}</td>
      <td>${typeLabel}</td>
      <td>${missBefore} (${missBefPct}%)</td>
      <td>${missAfter} (${missAftPct}%)</td>
      <td style="color:${statusColor};font-weight:700;">${status}</td>
    </tr>`;
  }).join("");

  // ── Statistik Numerik ──────────────────────────────────────
  const numStatsData = numCols.map(col => {
    const vals = cleanData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return null;
    const s = calcNumStats(vals);
    const outliers = countOutliers(vals);
    const missing = cleanData.filter(r => r[col] === "" || r[col] === null || r[col] === undefined).length;
    const missingPct = ((missing / cleanData.length) * 100).toFixed(1);
    const sorted = [...vals].sort((a,b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const range = s.max - s.min;
    const cv = s.mean !== 0 ? ((s.std / Math.abs(s.mean)) * 100).toFixed(1) : "-";
    const skewLabel = Math.abs(s.skewness) < 0.5 ? "Normal"
      : s.skewness > 1 ? "Right Skew"
      : s.skewness < -1 ? "Left Skew"
      : s.skewness > 0 ? "Mild Right" : "Mild Left";
    const normality = Math.abs(s.skewness) < 0.5 && Math.abs(s.kurtosis) < 1 ? "Normal" : "Tdk Normal";
    const wLow  = Math.min(...sorted.filter(v => v >= q1 - 1.5 * iqr));
    const wHigh = Math.max(...sorted.filter(v => v <= q3 + 1.5 * iqr));
    return { col, n: vals.length, mean: s.mean, median: s.median, mode: s.mode,
      min: s.min, max: s.max, range, q1, q3, iqr, std: s.std, variance: s.variance,
      cv, skewness: s.skewness, kurtosis: s.kurtosis, missing, missingPct,
      outliers, skewLabel, normality, wLow, wHigh };
  }).filter(Boolean);

  // Tabel numerik dibagi per 5 variabel supaya tidak kepotong
  const numChunkSize = 5;
  let numTablesHtml = "";
  for (let start = 0; start < numStatsData.length; start += numChunkSize) {
    const chunk = numStatsData.slice(start, start + numChunkSize);
    const chunkRows = chunk.map(d => `<tr>
      <td style="text-align:left;font-weight:600;white-space:nowrap;">${d.col}</td>
      <td>${d.n}</td>
      <td>${d.mean?.toFixed(3)??"-"}</td>
      <td>${d.median?.toFixed(3)??"-"}</td>
      <td>${d.mode?.toFixed(3)??"-"}</td>
      <td>${d.min?.toFixed(3)??"-"}</td>
      <td>${d.max?.toFixed(3)??"-"}</td>
      <td>${d.range?.toFixed(3)??"-"}</td>
      <td>${d.q1?.toFixed(3)??"-"}</td>
      <td>${d.q3?.toFixed(3)??"-"}</td>
      <td>${d.iqr?.toFixed(3)??"-"}</td>
      <td>${d.wLow?.toFixed(3)??"-"}</td>
      <td>${d.wHigh?.toFixed(3)??"-"}</td>
      <td>${d.std?.toFixed(3)??"-"}</td>
      <td>${d.variance?.toFixed(3)??"-"}</td>
      <td>${d.cv}%</td>
      <td>${d.skewness?.toFixed(3)??"-"}</td>
      <td>${d.kurtosis?.toFixed(3)??"-"}</td>
      <td>${d.missing}<br><span style="font-size:7pt;">(${d.missingPct}%)</span></td>
      <td>${d.outliers}</td>
      <td>${d.skewLabel}</td>
      <td>${d.normality}</td>
    </tr>`).join("");
    numTablesHtml += `
      ${start > 0 ? '<div class="page-break"></div>' : ''}
      <p class="tbl-note">${start === 0 ? `Total ${numStatsData.length} variabel numerik.` : `Lanjutan — variabel ${start+1} s/d ${Math.min(start+numChunkSize, numStatsData.length)} dari ${numStatsData.length}.`}</p>
      <div class="avoid-break">
        <table class="data-tbl">
          <thead><tr>
            <th>Variabel</th><th>N</th><th>Mean</th><th>Median</th><th>Mode</th>
            <th>Min</th><th>Max</th><th>Range</th><th>Q1</th><th>Q3</th><th>IQR</th>
            <th>W.Low</th><th>W.High</th><th>Std Dev</th><th>Variance</th><th>CV%</th>
            <th>Skewness</th><th>Kurtosis</th><th>Missing</th><th>Outlier</th>
            <th>Distribusi</th><th>Normalitas</th>
          </tr></thead>
          <tbody>${chunkRows}</tbody>
        </table>
      </div>`;
  }

  // ── Statistik Kategorik ────────────────────────────────────
  let catSectionHtml = "";
  if (catCols.length) {
    const catSummaryRows = catCols.map(col => {
      const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
      const freq = {};
      vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
      const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
      const mode = sorted[0]?.[0] ?? "-";
      const modeFreq = sorted[0]?.[1] ?? 0;
      const modePct = vals.length ? ((modeFreq/vals.length)*100).toFixed(1) : "0";
      const missing = cleanData.length - vals.length;
      const missingPct = ((missing/cleanData.length)*100).toFixed(1);
      const uniqueCount = Object.keys(freq).length;
      const entropy = -sorted.reduce((acc,[,v]) => {
        const p = v/vals.length; return acc + p * Math.log2(p);
      }, 0);
      const isImbalanced = parseFloat(modePct) >= 70;
      const top5 = sorted.slice(0,5).map(([k,v]) =>
        `${k}: ${v} (${((v/vals.length)*100).toFixed(1)}%)`).join("<br>");
      return `<tr>
        <td style="text-align:left;font-weight:600;">${col}</td>
        <td>${vals.length}</td>
        <td>${uniqueCount}</td>
        <td>${mode}</td>
        <td>${modeFreq}</td>
        <td style="color:${isImbalanced?'#c0392b':'#1a1a1a'};font-weight:${isImbalanced?'700':'400'};">${modePct}%${isImbalanced?' ⚠':''}</td>
        <td>${missing} (${missingPct}%)</td>
        <td>${entropy.toFixed(3)}</td>
        <td style="font-size:7.5pt;line-height:1.7;">${top5}</td>
      </tr>`;
    }).join("");

    // Detail distribusi per kolom kategorik (mini bar)
    const catDetailHtml = catCols.map(col => {
      const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
      const freq = {};
      vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
      const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
      const maxFreq = sorted[0]?.[1] || 1;
      const rows = sorted.map(([k, v]) => {
        const pct = ((v/vals.length)*100).toFixed(1);
        return `<tr>
          <td style="text-align:left;padding:3px 5px;font-size:8pt;">${k}</td>
          <td style="padding:3px 5px;font-size:8pt;text-align:center;">${v}</td>
          <td style="padding:3px 5px;font-size:8pt;text-align:center;">${pct}%</td>
        </tr>`;
      }).join("");
      return `
        <div class="avoid-break" style="margin-bottom:16px;">
          <p style="font-weight:700;font-size:10pt;margin-bottom:5px;border-left:4px solid #a8cdef;padding-left:8px;">${col} <span style="font-weight:400;font-size:9pt;color:#666;">(${sorted.length} kategori unik, n=${vals.length})</span></p>
          <table style="width:auto;border-collapse:collapse;">
            <thead><tr>
              <th style="background:#f0f0f0;color:#333;padding:4px 8px;font-size:8pt;text-align:left;border:1px solid #ddd;min-width:120px;">Kategori</th>
              <th style="background:#f0f0f0;color:#333;padding:4px 8px;font-size:8pt;border:1px solid #ddd;text-align:center;">Frekuensi</th>
              <th style="background:#f0f0f0;color:#333;padding:4px 8px;font-size:8pt;border:1px solid #ddd;text-align:center;">Persentase</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

    catSectionHtml = `
      <div class="page-break"></div>
      <h2>4. Statistik Deskriptif — Variabel Kategorik</h2>
      <p class="tbl-note">Total ${catCols.length} variabel kategorik.</p>
      <div class="avoid-break">
        <table class="data-tbl">
          <thead><tr>
            <th>Variabel</th><th>N Valid</th><th>Unique</th><th>Mode</th>
            <th>Frek. Mode</th><th>Mode %</th><th>Missing</th>
            <th>Entropy</th><th>Top 5 Kategori</th>
          </tr></thead>
          <tbody>${catSummaryRows}</tbody>
        </table>
      </div>
      <h3 style="margin-top:20px;">Detail Distribusi per Kolom Kategorik</h3>
      ${catDetailHtml}`;
  }

  // ── Matriks Korelasi ───────────────────────────────────────
  let corrSectionHtml = "";
  if (numCols.length >= 2) {
    const pairs = [];
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i+1; j < numCols.length; j++) {
        const r = calcCorr(cleanData, numCols[i], numCols[j]);
        const absR = Math.abs(r);
        const strength = absR > 0.7 ? "Kuat" : absR > 0.4 ? "Sedang" : "Lemah";
        const dir = r > 0.01 ? "Positif" : r < -0.01 ? "Negatif" : "Tidak Ada";
        const rColor = absR > 0.7 ? (r > 0 ? "#1a5276" : "#922b21") : absR > 0.4 ? (r > 0 ? "#1a6e3c" : "#c0392b") : "#555";
        pairs.push({ c1: numCols[i], c2: numCols[j], r, strength, dir, rColor });
      }
    }
    pairs.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));

    const highCorr  = pairs.filter(p => Math.abs(p.r) > 0.7);
    const midCorr   = pairs.filter(p => Math.abs(p.r) > 0.4 && Math.abs(p.r) <= 0.7);
    const lowCorr   = pairs.filter(p => Math.abs(p.r) <= 0.4);
    const avgAbsR   = pairs.length ? (pairs.reduce((s,p) => s+Math.abs(p.r), 0)/pairs.length).toFixed(3) : "0";

    const corrRows = pairs.map(p => `<tr>
      <td style="text-align:left;">${p.c1}</td>
      <td style="text-align:left;">${p.c2}</td>
      <td style="font-weight:700;color:${p.rColor};">${p.r.toFixed(4)}</td>
      <td>${Math.abs(p.r).toFixed(4)}</td>
      <td>${p.dir}</td>
      <td style="font-weight:600;color:${Math.abs(p.r)>0.7?'#c0392b':Math.abs(p.r)>0.4?'#b8660a':'#1a7a2a'}">${p.strength}</td>
    </tr>`).join("");

    corrSectionHtml = `
      <div class="page-break"></div>
      <h2>5. Analisis Korelasi Antar Variabel Numerik</h2>
      <div class="avoid-break" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
        <div class="summary-box"><div class="label">Total Pasangan</div><div class="value">${pairs.length}</div></div>
        <div class="summary-box"><div class="label">Korelasi Kuat (|r|>0.7)</div><div class="value" style="color:#c0392b;">${highCorr.length}</div></div>
        <div class="summary-box"><div class="label">Korelasi Sedang</div><div class="value" style="color:#b8660a;">${midCorr.length}</div></div>
        <div class="summary-box"><div class="label">Rata-rata |r|</div><div class="value">${avgAbsR}</div></div>
      </div>
      <div class="avoid-break">
        <table class="data-tbl">
          <thead><tr>
            <th>Variabel 1</th><th>Variabel 2</th>
            <th>Pearson r</th><th>|r|</th><th>Arah</th><th>Kekuatan</th>
          </tr></thead>
          <tbody>${corrRows}</tbody>
        </table>
      </div>
      ${highCorr.length > 0 ? `
      <div class="avoid-break" style="margin-top:10px;padding:10px 14px;background:#fff8f0;border:1px solid #f4c4a0;border-radius:6px;font-size:9.5pt;">
        <strong>⚠ Potensi Multikolinearitas:</strong> ${highCorr.map(p=>`${p.c1} & ${p.c2} (r=${p.r.toFixed(3)})`).join(", ")}. Perlu diperhatikan saat membangun model prediktif.
      </div>` : ""}`;
  }

  // ── Time Series Section ────────────────────────────────────
  let tsSectionHtml = "";
  if (dtCols.length && numCols.length) {
    const dateCol = dtCols[0];
    const tsInsights = numCols.map(valCol => {
      const tsData = cleanData
        .map(r => ({ date: new Date(r[dateCol]), val: parseFloat(r[valCol]) }))
        .filter(d => !isNaN(d.date.getTime()) && !isNaN(d.val))
        .sort((a,b) => a.date - b.date);
      if (tsData.length < 2) return null;
      const values = tsData.map(d => d.val);
      const n = values.length;
      const xMean = (n-1)/2;
      const yMean = values.reduce((a,b)=>a+b,0)/n;
      const slope = values.reduce((acc,y,i)=>acc+(i-xMean)*(y-yMean),0)
                  / values.reduce((acc,_,i)=>acc+(i-xMean)**2,0);
      const maxVal = Math.max(...values);
      const minVal = Math.min(...values);
      const stdVal = Math.sqrt(values.reduce((a,b)=>a+(b-yMean)**2,0)/n);
      const trendLabel = slope > 0.01 ? "Naik ↑" : slope < -0.01 ? "Turun ↓" : "Stabil →";
      const trendColor = slope > 0.01 ? "#1a7a2a" : slope < -0.01 ? "#c0392b" : "#1a5276";
      const startDate = tsData[0].date.toLocaleDateString("id-ID");
      const endDate   = tsData[tsData.length-1].date.toLocaleDateString("id-ID");
      return { valCol, n, yMean, slope, maxVal, minVal, stdVal, trendLabel, trendColor, startDate, endDate };
    }).filter(Boolean);

    if (tsInsights.length) {
      const tsRows = tsInsights.map(t => `<tr>
        <td style="text-align:left;font-weight:600;">${t.valCol}</td>
        <td>${t.n}</td>
        <td>${t.startDate}</td>
        <td>${t.endDate}</td>
        <td>${t.yMean.toFixed(3)}</td>
        <td>${t.minVal.toFixed(3)}</td>
        <td>${t.maxVal.toFixed(3)}</td>
        <td>${t.stdVal.toFixed(3)}</td>
        <td>${t.slope.toFixed(4)}</td>
        <td style="font-weight:700;color:${t.trendColor};">${t.trendLabel}</td>
      </tr>`).join("");

      tsSectionHtml = `
        <div class="page-break"></div>
        <h2>${numCols.length >= 2 ? "6." : "5."} Analisis Time Series</h2>
        <p class="tbl-note">Kolom waktu terdeteksi: <strong>${dateCol}</strong>. Total ${tsInsights.length} variabel dianalisis.</p>
        <div class="avoid-break">
          <table class="data-tbl">
            <thead><tr>
              <th>Variabel</th><th>N Data</th><th>Tanggal Awal</th><th>Tanggal Akhir</th>
              <th>Mean</th><th>Min</th><th>Max</th><th>Std Dev</th>
              <th>Slope</th><th>Tren</th>
            </tr></thead>
            <tbody>${tsRows}</tbody>
          </table>
        </div>`;
    }
  }

  // ── Intelligent Insights ───────────────────────────────────
  let insightHtml = "";
  const insightSectionNum = 2 + (numCols.length?1:0) + (catCols.length?1:0) + (numCols.length>=2?1:0) + (dtCols.length&&numCols.length?1:0);

  if (numStatsData.length) {
    const highMean    = numStatsData.reduce((a,b) => a.mean > b.mean ? a : b);
    const highStd     = numStatsData.reduce((a,b) => a.std > b.std ? a : b);
    const highOut     = numStatsData.reduce((a,b) => a.outliers > b.outliers ? a : b);
    const skewedVars  = numStatsData.filter(s => Math.abs(s.skewness) >= 0.5);
    const outlierVars = numStatsData.filter(s => s.outliers > 0);
    const rightSkewed = numStatsData.filter(s => s.skewness > 0.5);
    const leftSkewed  = numStatsData.filter(s => s.skewness < -0.5);
    const normalVars  = numStatsData.filter(s => Math.abs(s.skewness) < 0.5 && Math.abs(s.kurtosis) < 1);
    const highCVVars  = numStatsData.filter(s => parseFloat(s.cv) > 30);

    insightHtml += `<li>Variabel dengan <strong>rata-rata tertinggi</strong>: <strong>${highMean.col}</strong> (mean = ${highMean.mean?.toFixed(3)}, median = ${highMean.median?.toFixed(3)})</li>`;
    insightHtml += `<li>Variabel dengan <strong>variabilitas terbesar</strong>: <strong>${highStd.col}</strong> (std dev = ${highStd.std?.toFixed(3)}, CV = ${highStd.cv}%) — data paling tersebar.</li>`;

    if (highOut.outliers > 0) {
      const pct = ((highOut.outliers / cleanData.length)*100).toFixed(1);
      insightHtml += `<li>Variabel dengan <strong>outlier terbanyak</strong>: <strong>${highOut.col}</strong> (${highOut.outliers} data / ${pct}%) — pertimbangkan winsorizing atau robust scaling sebelum modeling.</li>`;
    }
    if (normalVars.length) {
      insightHtml += `<li><strong>Distribusi mendekati normal</strong>: ${normalVars.map(s=>s.col).join(", ")} — siap digunakan untuk analisis parametrik.</li>`;
    }
    if (rightSkewed.length) {
      insightHtml += `<li><strong>Right skewed</strong>: ${rightSkewed.map(s=>`${s.col} (skew=${s.skewness.toFixed(2)})`).join(", ")} — data condong ke kiri, ada nilai ekstrem di kanan. Disarankan transformasi log.</li>`;
    }
    if (leftSkewed.length) {
      insightHtml += `<li><strong>Left skewed</strong>: ${leftSkewed.map(s=>`${s.col} (skew=${s.skewness.toFixed(2)})`).join(", ")} — data condong ke kanan, ada nilai ekstrem di kiri.</li>`;
    }
    if (highCVVars.length) {
      insightHtml += `<li>Variabel dengan <strong>variabilitas tinggi (CV > 30%)</strong>: ${highCVVars.map(s=>`${s.col} (${s.cv}%)`).join(", ")} — perlu normalisasi sebelum digunakan dalam model ML.</li>`;
    }
    if (outlierVars.length) {
      insightHtml += `<li>Variabel dengan <strong>outlier</strong>: ${outlierVars.map(s=>`${s.col} (${s.outliers} titik)`).join(", ")}. Metode IQR digunakan untuk deteksi.</li>`;
    }
  }

  catCols.forEach(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v]||0)+1));
    const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
    const top = sorted[0];
    const topPct = top ? ((top[1]/vals.length)*100).toFixed(1) : 0;
    const isImbalanced = parseFloat(topPct) >= 70;
    insightHtml += `<li>Kolom <strong>${col}</strong>: ${Object.keys(freq).length} kategori unik. Dominan: "${top?.[0]}" (${topPct}%)${isImbalanced ? ' — ⚠ distribusi tidak seimbang, pertimbangkan balancing untuk klasifikasi.' : ' — distribusi relatif seimbang.'}</li>`;
  });

  if (numCols.length >= 2) {
    let maxR = 0, bestC1 = "", bestC2 = "";
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i+1; j < numCols.length; j++) {
        const r = Math.abs(calcCorr(cleanData, numCols[i], numCols[j]));
        if (r > maxR) { maxR = r; bestC1 = numCols[i]; bestC2 = numCols[j]; }
      }
    }
    const strength = maxR > 0.7 ? "kuat" : maxR > 0.4 ? "sedang" : "lemah";
    insightHtml += `<li>Korelasi terkuat: <strong>${bestC1}</strong> vs <strong>${bestC2}</strong> (r = ${maxR.toFixed(4)}) — korelasi ${strength}.</li>`;
  }

  if (totalMissing === 0 && cleanDupCount === 0) {
      insightHtml += `<li><span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg></span> <strong>Dataset bersih</strong> — tidak ada missing values dan duplikat. Siap untuk analisis lanjutan atau pemodelan.</li>`;
    } else {
      if (totalMissing > 0) insightHtml += `<li><span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Masih terdapat <strong>${totalMissing} missing values</strong> setelah cleaning — pertimbangkan imputation lanjutan.</li>`;
      if (cleanDupCount > 0) insightHtml += `<li><span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Masih terdapat <strong>${cleanDupCount} baris duplikat</strong> — jalankan kembali proses cleaning.</li>`;
    }

  // ── Rekomendasi ────────────────────────────────────────────
  let rekoHtml = "";
  const skewedForReko = numStatsData.filter(s => Math.abs(s.skewness) >= 0.5);
  const outlierForReko = numStatsData.filter(s => s.outliers > 0);
  const imbalancedCats = catCols.filter(col => {
    const vals = cleanData.map(r=>r[col]).filter(v=>v!==""&&v!==null&&v!==undefined);
    const freq = {};
    vals.forEach(v=>(freq[v]=(freq[v]||0)+1));
    const top = Object.values(freq).sort((a,b)=>b-a)[0];
    return (top/vals.length)*100 >= 70;
  });

  if (skewedForReko.length) {
    rekoHtml += `<li><strong>Transformasi data:</strong> Variabel ${skewedForReko.map(s=>s.col).join(", ")} memiliki distribusi skewed. Gunakan transformasi <em>log</em>, <em>sqrt</em>, atau <em>Box-Cox</em> sebelum modeling statistik parametrik.</li>`;
  }
  if (outlierForReko.length) {
    rekoHtml += `<li><strong>Penanganan outlier:</strong> Variabel ${outlierForReko.map(s=>`${s.col} (${s.outliers} titik)`).join(", ")} masih memiliki outlier. Pertimbangkan <em>winsorizing</em>, <em>trimming</em>, atau gunakan algoritma yang robust terhadap outlier.</li>`;
  }
  if (imbalancedCats.length) {
    rekoHtml += `<li><strong>Class imbalance:</strong> Kolom ${imbalancedCats.join(", ")} memiliki satu kategori yang mendominasi (≥70%). Gunakan teknik <em>SMOTE</em>, <em>oversampling</em>, atau sesuaikan metric evaluasi model.</li>`;
  }
  if (numCols.length >= 2) {
    let maxR = 0;
    for (let i = 0; i < numCols.length; i++)
      for (let j = i+1; j < numCols.length; j++) {
        const r = Math.abs(calcCorr(cleanData, numCols[i], numCols[j]));
        if (r > maxR) maxR = r;
      }
    if (maxR > 0.7) {
      rekoHtml += `<li><strong>Multikolinearitas:</strong> Terdapat pasangan variabel dengan korelasi kuat (|r| > 0.7). Pertimbangkan <em>PCA</em>, <em>VIF analysis</em>, atau hapus salah satu variabel sebelum regresi.</li>`;
    }
    if (maxR < 0.3) {
      rekoHtml += `<li><strong>Feature engineering:</strong> Korelasi antar variabel lemah. Pertimbangkan membuat fitur baru (interaksi, polynomial) untuk meningkatkan daya prediksi model.</li>`;
    }
  }
  if (numStatsData.filter(s => parseFloat(s.cv) > 30).length) {
    rekoHtml += `<li><strong>Normalisasi/Standardisasi:</strong> Beberapa variabel memiliki CV > 30%. Gunakan <em>Min-Max Scaling</em> atau <em>Standard Scaler (Z-score)</em> sebelum melatih model machine learning berbasis jarak.</li>`;
  }
  if (totalMissing === 0 && cleanDupCount === 0 && skewedForReko.length === 0 && outlierForReko.length === 0) {
    rekoHtml += `<li><span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg></span> <strong>Dataset dalam kondisi sangat baik</strong>. Tidak ada rekomendasi preprocessing tambahan yang diperlukan. Dataset siap untuk pemodelan langsung.</li>`;
  }

  // ── Cleaning Log ───────────────────────────────────────────
  const cleaningLogHtml = cleaningLog.length > 0
    ? cleaningLog.map(l => `<li>${l}</li>`).join("")
    : "<li>Belum ada proses cleaning yang dilakukan pada sesi ini.</li>";

  // ── HTML LAPORAN FINAL ─────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan EDA — ${fileName || "Dataset"}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Times New Roman", serif;
      font-size: 10.5pt;
      color: #000;
      background: #fff;
      padding: 12mm 14mm;
    }
    h1 { font-size: 14pt; text-align: center; margin-bottom: 4px; }
    h2 {
      font-size: 12pt; margin: 20px 0 8px;
      border-bottom: 2px solid #000; padding-bottom: 4px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 10.5pt; margin: 14px 0 5px;
      page-break-after: avoid; color: #1a1a1a;
    }
    p { line-height: 1.8; margin-top: 5px; font-size: 10.5pt; }
    .tbl-note { font-size: 8.5pt; color: #666; margin-bottom: 5px; font-style: italic; }

    .header {
      text-align: center; border-bottom: 3px double #000;
      padding-bottom: 12px; margin-bottom: 16px;
    }
    .header p { font-size: 10pt; margin-top: 3px; }

    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .info-table td { padding: 4px 8px; font-size: 10pt; vertical-align: top; border-bottom: 1px solid #eee; }
    .info-table td:first-child { font-weight: bold; width: 36%; white-space: nowrap; }

    .summary-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 8px; margin-bottom: 12px;
    }
    .summary-box {
      border: 1px solid #ccc; border-radius: 5px;
      padding: 8px 10px; text-align: center; background: #fafafa;
    }
    .summary-box .label { font-size: 8pt; color: #666; margin-bottom: 3px; }
    .summary-box .value { font-size: 14pt; font-weight: 700; line-height: 1.2; }
    .summary-box .sub { font-size: 7.5pt; color: #888; margin-top: 2px; }

    .status-box {
      padding: 9px 13px; border-radius: 5px; margin-bottom: 10px;
      border: 1px solid #dceeff; background: #f8fbff; font-size: 10pt;
    }
    .quality-box {
      padding: 10px 14px; border-radius: 5px; margin-bottom: 12px;
      border: 2px solid #ddd; background: #fafafa;
      display: flex; align-items: center; gap: 16px;
    }

    table.data-tbl {
      width: 100%; border-collapse: collapse;
      margin-bottom: 12px; font-size: 7.5pt;
      table-layout: auto;
    }
    table.data-tbl th {
      background: #1a1a1a; color: #fff;
      padding: 5px 4px; text-align: center;
      font-size: 7.5pt; white-space: nowrap;
      border: 1px solid #333;
    }
    table.data-tbl td {
      border: 1px solid #ccc; padding: 3px 4px;
      text-align: center; vertical-align: middle;
      word-break: break-word;
    }
    table.data-tbl tr:nth-child(even) td { background: #f7f7f7; }
    table.data-tbl tr:hover td { background: #eef4ff; }

    ul { margin-left: 18px; line-height: 1.9; }
    li { margin-bottom: 3px; font-size: 10pt; }

    .footer {
      margin-top: 32px; border-top: 1px solid #000;
      padding-top: 9px; font-size: 9pt;
      text-align: center; color: #444;
    }
    .page-break { page-break-before: always; }
    .avoid-break { page-break-inside: avoid; }
    .section-note {
      font-size: 9pt; color: #555; background: #fffbe6;
      border-left: 3px solid #f5e642; padding: 6px 10px;
      margin-bottom: 10px; border-radius: 0 4px 4px 0;
    }

    @media print {
      body { padding: 0; }
      @page { margin: 12mm 12mm; size: A4 landscape; }
      .page-break { page-break-before: always; }
      .avoid-break { page-break-inside: avoid; }
      table.data-tbl { font-size: 7pt; }
      table.data-tbl th, table.data-tbl td { padding: 2px 3px; }
    }
  </style>
</head>
<body>

<!-- ══ HEADER ══════════════════════════════════════════════ -->
<div class="header">
  <h1>LAPORAN ANALISIS DATA EKSPLORASI OTOMATIS</h1>
  <p><strong>Auto EDA Analytics Dashboard</strong> — SD-1306 Data Science Programming</p>
  <p>Kelompok 1 | Kelas A | Institut Teknologi Sains Bandung</p>
  <p>Dosen: <strong>Bakti Siregar, M.Sc., CDS.</strong></p>
  <p style="margin-top:7px;font-size:9pt;color:#555;">Dibuat: ${new Date().toLocaleString("id-ID")}</p>
</div>

<!-- ══ 1. INFORMASI DATASET ════════════════════════════════ -->
<h2>1. Informasi Dataset</h2>

<div class="quality-box avoid-break">
  <div style="text-align:center;min-width:80px;">
    <div style="font-size:28pt;font-weight:700;color:${dqColor};line-height:1;">${dqScore}%</div>
    <div style="font-size:8.5pt;font-weight:700;color:${dqColor};">${dqLabel}</div>
    <div style="font-size:7.5pt;color:#888;margin-top:2px;">Skor Kualitas Data</div>
  </div>
  <div style="flex:1;">
    <div style="font-size:9pt;color:#444;margin-bottom:5px;">
      ${dqIssues.length === 0
        ? `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg> Tidak ada masalah kualitas data yang terdeteksi.</span>`
        : dqIssues.map(i => `<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${i.label}</span>`).join(" &nbsp;·&nbsp; ")}
    </div>
    <div style="background:#eee;border-radius:10px;height:10px;width:100%;overflow:hidden;">
      <div style="background:${dqColor};height:100%;width:${dqScore}%;border-radius:10px;"></div>
    </div>
  </div>
</div>

<div class="summary-grid avoid-break">
  <div class="summary-box">
    <div class="label">Nama File</div>
    <div class="value" style="font-size:10pt;word-break:break-all;">${fileName || "-"}</div>
  </div>
  <div class="summary-box">
    <div class="label">Baris Asli</div>
    <div class="value">${rawData.length.toLocaleString()}</div>
    <div class="sub">sebelum cleaning</div>
  </div>
  <div class="summary-box">
    <div class="label">Baris Cleaned</div>
    <div class="value">${cleanData.length.toLocaleString()}</div>
    <div class="sub">${rawData.length - cleanData.length} baris dihapus</div>
  </div>
  <div class="summary-box">
    <div class="label">Total Kolom</div>
    <div class="value">${headers.length}</div>
    <div class="sub">${numCols.length} num · ${catCols.length} cat · ${dtCols.length} dt</div>
  </div>
</div>

<table class="info-table avoid-break">
  <tr><td>Missing Values (Sebelum Cleaning)</td><td>${rawMissingTotal} sel (${((rawMissingTotal/Math.max(1,rawData.length*headers.length))*100).toFixed(2)}% dari total sel)</td></tr>
  <tr><td>Missing Values (Setelah Cleaning)</td><td>${totalMissing} sel (${((totalMissing/Math.max(1,cleanData.length*headers.length))*100).toFixed(2)}% dari total sel)</td></tr>
  <tr><td>Duplikat (Sebelum Cleaning)</td><td>${rawDupCount} baris (${((rawDupCount/Math.max(1,rawData.length))*100).toFixed(1)}%)</td></tr>
  <tr><td>Duplikat (Setelah Cleaning)</td><td>${cleanDupCount} baris (${((cleanDupCount/Math.max(1,cleanData.length))*100).toFixed(1)}%)</td></tr>
  <tr><td>Kolom Numerik</td><td>${numCols.length > 0 ? numCols.join(", ") : "Tidak ada"}</td></tr>
  <tr><td>Kolom Kategorik</td><td>${catCols.length > 0 ? catCols.join(", ") : "Tidak ada"}</td></tr>
  <tr><td>Kolom Datetime</td><td>${dtCols.length > 0 ? dtCols.join(", ") : "Tidak ada"}</td></tr>
</table>

<div class="status-box avoid-break">
  <strong>Status Dataset:</strong>
  ${totalMissing === 0 && cleanDupCount === 0
    ? `<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg> Dataset valid dan bersih — siap digunakan untuk analisis lanjutan atau pemodelan.</span>`
    : [totalMissing > 0 ? `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Masih ada ${totalMissing} missing values.</span>` : "",
       cleanDupCount > 0 ? `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Masih ada ${cleanDupCount} baris duplikat.</span>` : ""]
      .filter(Boolean).join(" ")}
</div>

<!-- ══ 2. PROSES DATA CLEANING ═════════════════════════════ -->
<h2>2. Proses Data Cleaning</h2>
<div class="avoid-break">
  <h3>2.1 Log Proses Cleaning</h3>
  <ul>${cleaningLogHtml}</ul>

  <h3 style="margin-top:14px;">2.2 Perbandingan Missing Values Before vs After (per Kolom)</h3>
  <table class="data-tbl">
    <thead><tr>
      <th>Nama Kolom</th><th>Tipe Data</th>
      <th>Missing Sebelum</th><th>Missing Setelah</th><th>Status</th>
    </tr></thead>
    <tbody>${beforeAfterRows}</tbody>
  </table>
</div>

<!-- ══ 3. STATISTIK NUMERIK ════════════════════════════════ -->
${numCols.length ? `
<div class="page-break"></div>
<h2>3. Statistik Deskriptif — Variabel Numerik</h2>
${numTablesHtml}
` : ""}

<!-- ══ 4. STATISTIK KATEGORIK ══════════════════════════════ -->
${catSectionHtml}

<!-- ══ 5. KORELASI ═════════════════════════════════════════ -->
${corrSectionHtml}

<!-- ══ TIME SERIES ════════════════════════════════════════ -->
${tsSectionHtml}

<!-- ══ INTELLIGENT INSIGHTS ═══════════════════════════════ -->
<div class="page-break"></div>
<h2>${insightSectionNum}. Intelligent Insights</h2>
<ul class="avoid-break">${insightHtml || "<li>Tidak ada insight yang dihasilkan.</li>"}</ul>

<!-- ══ REKOMENDASI ═════════════════════════════════════════ -->
<h2 style="margin-top:20px;">${insightSectionNum + 1}. Rekomendasi Analisis Lanjutan</h2>
<ul class="avoid-break">${rekoHtml || "<li>Tidak ada rekomendasi khusus. Dataset sudah dalam kondisi optimal.</li>"}</ul>

<!-- ══ KESIMPULAN ══════════════════════════════════════════ -->
<h2 style="margin-top:20px;">${insightSectionNum + 2}. Kesimpulan</h2>
<p class="avoid-break">
  Dataset <strong>${fileName || "yang dianalisis"}</strong> terdiri dari
  <strong>${cleanData.length.toLocaleString()} baris</strong> dan
  <strong>${headers.length} kolom</strong> setelah proses cleaning
  (${rawData.length - cleanData.length} baris dihapus dari ${rawData.length.toLocaleString()} baris asli).
  Terdapat <strong>${numCols.length} variabel numerik</strong>,
  <strong>${catCols.length} variabel kategorik</strong>,
  dan <strong>${dtCols.length} variabel datetime</strong>.
  ${totalMissing === 0
    ? `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg></span> Dataset sudah bersih dari missing values.`
    : `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Masih terdapat <strong>${totalMissing} missing values</strong>.`}
  ${cleanDupCount === 0
    ? `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg></span> Tidak ada duplikat tersisa.`
    : `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Masih ada <strong>${cleanDupCount} duplikat</strong>.`}
  Skor kualitas dataset akhir: <strong style="color:${dqColor};">${dqScore}% (${dqLabel})</strong>.
  Laporan ini dihasilkan secara otomatis oleh Auto EDA Analytics Dashboard.
</p>

<div class="footer">
  Auto EDA Analytics Dashboard | SD-1306 Data Science Programming | Institut Teknologi Sains Bandung<br>
  Kota Deltamas Lot-A1 CBD, Jl. Ganesha Boulevard No.1, Cikarang Pusat, Bekasi<br>
  <span style="font-size:8.5pt;color:#888;">Dicetak otomatis: ${new Date().toLocaleString("id-ID")}</span>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;

  const baseName = (fileName || "data").replace(/\.[^.]+$/, "");
  const exportFileName = `${baseName}_clean_report.html`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  // Buka di tab baru untuk print/save PDF
  window.open(url, "_blank");

  // Simpan ke backend processed
  try {
    const formData = new FormData();
    formData.append("file", blob, exportFileName);
    formData.append("filename", exportFileName);
    fetch("/save-export", { method: "POST", body: formData })
      .catch(e => console.warn("Gagal simpan laporan ke processed:", e));
  } catch(e) { console.warn(e); }

  // Simpan ke export history
  addExportHistory({
    fileName: exportFileName,
    format: "pdf",
    originalName: fileName || "data",
    downloadedAt: new Date().toLocaleString("id-ID"),
    timestamp: Date.now(),
    rows: cleanData.length,
    cols: headers.length
  });

  showNotif("Laporan siap dicetak & disimpan ke processed!", "success");
  renderExportHistoryPanel();
}

function downloadHTML() {
  const a = document.createElement("a");
  a.href = window.location.href;
  a.download = "auto_eda_dashboard.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function exportExcel() {
  if (!cleanData.length) {
    showNotif("Belum ada data untuk di-export!", "warning");
    return;
  }

  const baseName = (fileName || "data").replace(/\.[^.]+$/, "");
  const exportFileName = `${baseName}_clean.xlsx`;

  const ws = XLSX.utils.aoa_to_sheet([headers, ...cleanData.map(r => headers.map(h => r[h] ?? ""))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  // Generate blob dari workbook
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });

  // Download ke browser
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Kirim ke backend untuk disimpan di processed
  try {
    const formData = new FormData();
    formData.append("file", new Blob([wbout], { type: "application/octet-stream" }), exportFileName);
    formData.append("filename", exportFileName);
    await fetch("/save-export", { method: "POST", body: formData });
  } catch(e) { console.warn("Gagal simpan Excel ke processed:", e); }

  // Simpan ke export history
  addExportHistory({
    fileName: exportFileName,
    format: "xlsx",
    originalName: fileName || "data",
    downloadedAt: new Date().toLocaleString("id-ID"),
    timestamp: Date.now(),
    rows: cleanData.length,
    cols: headers.length
  });

  showNotif(`File <b>${exportFileName}</b> berhasil diunduh & disimpan ke processed!`, "success");
  renderExportHistoryPanel();
}

function exportCSV() {
  if (!cleanData.length) {
    showNotif("Belum ada data untuk di-export!", "warning");
    return;
  }
  const escapeCSV = (val) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = [
    headers.map(escapeCSV).join(","),
    ...cleanData.map(r => headers.map(h => escapeCSV(r[h])).join(","))
  ];
  const csvContent = rows.join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const baseName = (fileName || "data").replace(/\.[^.]+$/, "");
  const exportFileName = `${baseName}_clean.csv`;

  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Simpan ke backend processed
  fetch("/save-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: cleanData, filename: exportFileName })
  }).catch(e => console.warn("Gagal simpan CSV ke processed:", e));

  // Simpan ke export history localStorage
  addExportHistory({
    fileName: exportFileName,
    format: "csv",
    originalName: fileName || "data",
    downloadedAt: new Date().toLocaleString("id-ID"),
    timestamp: Date.now(),
    rows: cleanData.length,
    cols: headers.length,
    dataSnapshot: null // tidak simpan data mentah di history, terlalu besar
  });

  URL.revokeObjectURL(url);
  showNotif(`File <b>${exportFileName}</b> berhasil diunduh & disimpan ke processed!`, "success");
  renderExportHistoryPanel();
}

function renderCleanPreview() {
  const container = document.getElementById("clean-preview-container");
  if (!container || !cleanData.length) return;

  const pageSize = 6;
  const totalPages = Math.ceil(cleanData.length / pageSize);
  if (cleanPreviewPage > totalPages) cleanPreviewPage = 1;

  const start = (cleanPreviewPage - 1) * pageSize;
  const pageData = cleanData.slice(start, start + pageSize);

  let html = `<table class="data-table"><thead><tr><th>#</th>`;
  headers.forEach(h => {
    const t = colTypes[h];
    const cls = t === "numeric" ? "tag-numeric" : t === "datetime" ? "tag-datetime" : "tag-categorical";
    html += `<th>${h} <span class="tag ${cls}" style="font-size:9px;">${t}</span></th>`;
  });
  html += `</tr></thead><tbody>`;
  pageData.forEach((row, i) => {
    html += `<tr><td style="color:var(--text-muted);font-size:11px;">${start + i + 1}</td>`;
    headers.forEach(h => {
      const v = row[h];
      const empty = v === "" || v === null || v === undefined;
      html += `<td style="${empty ? "color:var(--danger);font-style:italic;" : ""}">${empty ? "null" : v}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;

  // Pagination
  const pageInfo = `<div class="page-info" style="font-size:12px;color:var(--text-muted);">Menampilkan ${start + 1}–${Math.min(start + pageSize, cleanData.length)} dari ${cleanData.length} baris setelah cleaning</div>`;

  let pgHtml = "";
  if (totalPages > 1) {
    pgHtml += `<div class="pagination" style="justify-content:flex-end;padding:10px 0 0;">`;
    pgHtml += `<button class="page-btn" onclick="changeCleanPreviewPage(${cleanPreviewPage - 1}, ${totalPages})" ${cleanPreviewPage === 1 ? "disabled" : ""}>‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
      if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - cleanPreviewPage) <= 1) {
        pgHtml += `<button class="page-btn ${p === cleanPreviewPage ? "active" : ""}" onclick="changeCleanPreviewPage(${p}, ${totalPages})">${p}</button>`;
      } else if (Math.abs(p - cleanPreviewPage) === 2) {
        pgHtml += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
      }
    }
    pgHtml += `<button class="page-btn" onclick="changeCleanPreviewPage(${cleanPreviewPage + 1}, ${totalPages})" ${cleanPreviewPage === totalPages ? "disabled" : ""}>›</button>`;
    pgHtml += `</div>`;
  }

  container.innerHTML = `
    <div style="overflow:auto;">${html}</div>
    <div style="padding:10px 14px 4px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      ${pageInfo}
      ${pgHtml}
    </div>
  `;
}

function changeCleanPreviewPage(p, total) {
  if (p < 1 || p > total) return;
  cleanPreviewPage = p;
  renderCleanPreview();
}

// ===== CHART MATH HELPERS =====
function makeBins(vals, nBins) {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const binSize = (max - min) / nBins;
  const counts = Array(nBins).fill(0);
  vals.forEach((v) => {
    let i = Math.floor((v - min) / binSize);
    if (i >= nBins) i = nBins - 1;
    counts[i]++;
  });
  const labels = Array.from({ length: nBins }, (_, i) =>
    (min + i * binSize).toFixed(1),
  );
const centers = Array.from({ length: nBins }, (_, i) =>
  min + (i + 0.5) * binSize
);
return { labels, counts, centers };
}

function getBoxStats(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  return {
    min: s[0],
    q1: s[Math.floor(n * 0.25)],
    median: s[Math.floor(n * 0.5)],
    q3: s[Math.floor(n * 0.75)],
    max: s[n - 1],
  };
}

function makeDensity(vals, nPoints) {
  if (!vals.length) return { xs: [], ys: [] };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const std = Math.sqrt(
    vals.reduce(
      (a, b) =>
        a + (b - vals.reduce((x, y) => x + y, 0) / vals.length) ** 2,
      0,
    ) / vals.length,
  );
  const bw = std * Math.pow(vals.length, -0.2) * 1.06 || 1;
  const xs = Array.from(
    { length: nPoints },
    (_, i) => min + ((max - min) * i) / (nPoints - 1),
  );
  const ys = xs.map(
    (x) =>
      vals.reduce(
        (acc, xi) =>
          acc +
          Math.exp(-0.5 * ((x - xi) / bw) ** 2) /
            (bw * Math.sqrt(2 * Math.PI)),
        0,
      ) / vals.length,
  );
  return { xs, ys };
}

function makeQQ(vals) {
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(
    sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n,
  );
  const points = sorted.map((v, i) => {
    const p = (i + 0.5) / n;
    const theoretical = mean + std * probitApprox(p);
    return { x: theoretical, y: v };
  });
  const refLine = [points[0], points[points.length - 1]];
  return { points, refLine };
}

function probitApprox(p) {
  if (p <= 0) return -4;
  if (p >= 1) return 4;
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];
  const t =
    p < 0.5
      ? Math.sqrt(-2 * Math.log(p))
      : Math.sqrt(-2 * Math.log(1 - p));
  const num = a[0] + a[1] * t + a[2] * t ** 2;
  const den = 1 + b[0] * t + b[1] * t ** 2 + b[2] * t ** 3;
  return p < 0.5 ? -(t - num / den) : t - num / den;
}

function calcCorr(data, c1, c2) {
  const pairs = data
    .map((r) => [parseFloat(r[c1]), parseFloat(r[c2])])
    .filter(([a, b]) => !isNaN(a) && !isNaN(b));
  if (pairs.length < 2) return 0;
  const n = pairs.length;
  const mx = pairs.reduce((a, b) => a + b[0], 0) / n,
    my = pairs.reduce((a, b) => a + b[1], 0) / n;
  const num = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const dx = Math.sqrt(pairs.reduce((a, [x]) => a + (x - mx) ** 2, 0));
  const dy = Math.sqrt(pairs.reduce((a, [, y]) => a + (y - my) ** 2, 0));
  return dx && dy ? num / (dx * dy) : 0;
}

function corrColor(r) {
  const v = Math.abs(r);
  if (r > 0.7) return "#2A7A2A99";
  if (r > 0.4) return "#B8D96E99";
  if (r > 0) return "#F5E64299";
  if (r > -0.4) return "#F4AECF99";
  return "#E85D5D99";
}

// ===== DOWNLOAD VISUALISASI =====
let currentDownloadTab = "numerical-viz";
let currentDownloadCol = null;

function openDownloadModal(tab) {
  currentDownloadTab = tab;

  // Ambil kolom/variabel yang aktif
  const colMap = {
    "numerical-viz": () => document.getElementById("num-col-select")?.value || "",
    "categorical-viz": () => document.getElementById("cat-col-select")?.value || "",
    "bivariate-viz": () => {
      const x = document.getElementById("biv-x")?.value || "";
      const y = document.getElementById("biv-y")?.value || "";
      return x && y ? `${x} vs ${y}` : "";
    },
    "multivariate-viz": () => {
      const checked = document.querySelectorAll("#mv-col-checkboxes input:checked");
      return Array.from(checked).map(c => c.value).join(", ");
    },
    "catnum-viz": () => {
      const cat = document.getElementById("cn-cat")?.value || "";
      const num = document.getElementById("cn-num")?.value || "";
      return cat && num ? `${cat} vs ${num}` : "";
    },
    "timeseries": () => {
      const d = document.getElementById("ts-date-col")?.value || "";
      const v = document.getElementById("ts-value-col")?.value || "";
      return d && v ? `${d} · ${v}` : "";
    },
  };
  currentDownloadCol = colMap[tab] ? colMap[tab]() : "";

  // Tentukan chart list per tab
  const chartMap = {
    "numerical-viz": [
      { id: "hist-chart", label: "Histogram" },
      { id: "box-chart", label: "Boxplot" },
      { id: "density-chart", label: "Density Plot" },
      { id: "qq-chart", label: "QQ Plot" },
      { id: "violin-chart", label: "Violin Plot" },
    ],
    "categorical-viz": [
      { id: "bar-chart", label: "Bar Chart" },
      { id: "pie-chart", label: "Pie / Treemap" },
      { id: "count-chart", label: "Count Plot" },
      { id: "pareto-chart", label: "Pareto Chart" },
    ],
    "bivariate-viz": [
      { id: "scatter-chart", label: "Scatter Plot" },
      { id: "bubble-chart", label: "Bubble Chart" },
      { id: "corr-chart", label: "Correlation Heatmap" },
    ],
    "multivariate-viz": [
      { id: "corr-chart", label: "Correlation Heatmap" },
      { id: "pair-plot-container", label: "Pair Plot", isPairPlot: true },
    ],
    "catnum-viz": [
      { id: "catbox-chart", label: "Boxplot by Category" },
      { id: "grouped-bar-chart", label: "Grouped Bar Chart" },
      { id: "strip-chart", label: "Strip Plot" },
      { id: "violin-cat-chart", label: "Violin by Category" },
    ],
    "timeseries": [
      { id: "ts-line-chart", label: "Time Series Line Chart" },
      { id: "ts-ma-chart", label: "Moving Average (7)" },
      { id: "ts-roll-chart", label: "Rolling Mean (30)" },
      { id: "ts-trend-chart", label: "Trend Line" },
    ],
  };

  const charts = chartMap[tab] || [];
  const tabLabel = {
    "numerical-viz": "Numerik",
    "categorical-viz": "Kategorik",
    "bivariate-viz": "Num vs Num",
    "multivariate-viz": "Multivariat",
    "catnum-viz": "Kat vs Num",
    "timeseries": "Time Series",
  }[tab] || tab;

  // Buat / tampilkan modal
  let modal = document.getElementById("download-viz-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "download-viz-modal";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="
      position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:20000;
      display:flex;align-items:center;justify-content:center;
    " onclick="if(event.target===this)closeDownloadModal()">
      <div style="
        background:var(--white);border-radius:18px;padding:28px 32px;
        max-width:480px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.25);
        max-height:85vh;overflow-y:auto;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-family:'DM Serif Display',serif;font-size:18px;">Download Visualisasi</div>
          <button onclick="closeDownloadModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;">
          Tab: <strong>${tabLabel}</strong>${currentDownloadCol ? ` · Variabel: <strong>${currentDownloadCol}</strong>` : ""}
        </div>

        <!-- Pilihan: visualisasi saja atau + insight -->
        <div style="margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:10px;">Sertakan dalam Download</div>
          <div style="display:flex;gap:10px;">
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 14px;border:2px solid var(--border);border-radius:10px;cursor:pointer;transition:border 0.15s;" id="dl-opt-viz-label">
              <input type="radio" name="dl-include" value="viz" checked onchange="updateDownloadOptStyle()" style="accent-color:#f5e642;">
              <div>
                <div style="font-size:13px;font-weight:600;">Visualisasi Saja</div>
                <div style="font-size:11px;color:var(--text-muted);">Hanya gambar chart</div>
              </div>
            </label>
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 14px;border:2px solid var(--border);border-radius:10px;cursor:pointer;transition:border 0.15s;" id="dl-opt-both-label">
              <input type="radio" name="dl-include" value="both" onchange="updateDownloadOptStyle()" style="accent-color:#f5e642;">
              <div>
                <div style="font-size:13px;font-weight:600;">Visualisasi + Insight</div>
                <div style="font-size:11px;color:var(--text-muted);">Chart beserta insight</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Pilihan chart spesifik -->
        <div style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);">Pilih Visualisasi</div>
            <button onclick="dlSelectAll()" style="font-size:11px;padding:3px 10px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:6px;cursor:pointer;font-weight:600;">Pilih Semua</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px;" id="dl-chart-list">
            ${charts.map(c => `
              <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;cursor:pointer;transition:border 0.15s;" id="dl-check-label-${c.id}">
                <input type="checkbox" value="${c.id}" data-label="${c.label}" data-ispairplot="${c.isPairPlot||false}" checked
                  onchange="updateDlCheckStyle('${c.id}')"
                  style="accent-color:#f5e642;width:15px;height:15px;">
                <span style="font-size:13px;font-weight:500;">${c.label}</span>
              </label>
            `).join("")}
          </div>
        </div>

        <!-- Tombol aksi -->
        <div style="display:flex;gap:10px;">
          <button onclick="executeDownload()" style="
            flex:1;padding:11px 20px;background:#1a1a1a;color:#f5e642;
            border:none;border-radius:10px;font-size:13px;font-weight:700;
            cursor:pointer;font-family:'DM Sans',sans-serif;transition:background 0.18s;
          " onmouseover="this.style.background='#333'" onmouseout="this.style.background='#1a1a1a'">
            ⬇ Lakukan Download
          </button>
          <button onclick="closeDownloadModal()" style="
            padding:11px 18px;background:transparent;color:var(--text-muted);
            border:1.5px solid var(--border);border-radius:10px;font-size:13px;
            font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;
          ">Batal</button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = "block";
  updateDownloadOptStyle();
}

function updateDownloadOptStyle() {
  const val = document.querySelector("input[name='dl-include']:checked")?.value;
  document.getElementById("dl-opt-viz-label").style.borderColor = val === "viz" ? "#f5e642" : "var(--border)";
  document.getElementById("dl-opt-both-label").style.borderColor = val === "both" ? "#f5e642" : "var(--border)";
}

function updateDlCheckStyle(id) {
  const cb = document.querySelector(`#dl-chart-list input[value="${id}"]`);
  const label = document.getElementById(`dl-check-label-${id}`);
  if (label) label.style.borderColor = cb?.checked ? "#f5e642" : "var(--border)";
}

function dlSelectAll() {
  document.querySelectorAll("#dl-chart-list input[type=checkbox]").forEach(cb => {
    cb.checked = true;
    updateDlCheckStyle(cb.value);
  });
}

function closeDownloadModal() {
  const modal = document.getElementById("download-viz-modal");
  if (modal) modal.style.display = "none";
}

async function executeDownload() {
  const includeInsight = document.querySelector("input[name='dl-include']:checked")?.value === "both";
  const selectedCharts = Array.from(document.querySelectorAll("#dl-chart-list input[type=checkbox]:checked"));

  if (!selectedCharts.length) {
    showNotif("Pilih minimal satu visualisasi.", "warning");
    return;
  }

  closeDownloadModal();

  showConfirm(
    `Download <b>${selectedCharts.length} visualisasi</b>${includeInsight ? " + insight" : ""} menjadi <b>1 gambar</b>?`,
    async () => {
      showLoadingBar("Menyiapkan download...", 1800);
      await new Promise(r => setTimeout(r, 200));

      const isDark = document.body.classList.contains("dark-mode");
      const bgColor = isDark ? "#1e1e1e" : "#ffffff";

      // ── Tentukan nama file ──────────────────────────────────────────
      const tabSlugMap = {
        "numerical-viz": "num",
        "categorical-viz": "cat",
        "bivariate-viz": "numvsnum",
        "multivariate-viz": "mult",
        "catnum-viz": "catvsnum",
        "timeseries": "ts",
      };
      const tabSlug = tabSlugMap[currentDownloadTab] || currentDownloadTab;

      let varSlug = "";
      if (currentDownloadTab === "numerical-viz") {
        varSlug = (document.getElementById("num-col-select")?.value || "").replace(/[^a-zA-Z0-9]/g, "_");
      } else if (currentDownloadTab === "categorical-viz") {
        varSlug = (document.getElementById("cat-col-select")?.value || "").replace(/[^a-zA-Z0-9]/g, "_");
      } else if (currentDownloadTab === "bivariate-viz") {
        const x = document.getElementById("biv-x")?.value || "";
        const y = document.getElementById("biv-y")?.value || "";
        varSlug = (x + "_vs_" + y).replace(/[^a-zA-Z0-9_]/g, "_");
      } else if (currentDownloadTab === "multivariate-viz") {
        const checked = document.querySelectorAll("#mv-col-checkboxes input[type=checkbox]:checked");
        varSlug = checked.length + "var";
      } else if (currentDownloadTab === "catnum-viz") {
        const cat = document.getElementById("cn-cat")?.value || "";
        const num = document.getElementById("cn-num")?.value || "";
        varSlug = (cat + "_" + num).replace(/[^a-zA-Z0-9_]/g, "_");
      } else if (currentDownloadTab === "timeseries") {
        varSlug = (document.getElementById("ts-value-col")?.value || "").replace(/[^a-zA-Z0-9]/g, "_");
      }
      varSlug = varSlug.replace(/_+/g, "_").replace(/^_|_$/g, "").substring(0, 40);
      const downloadFileName = `viz_${tabSlug}_${varSlug || "chart"}.png`;

      // ── Tentukan insight element ──────────────────────────────────
      // Untuk time series: gabungkan ts-insights + ts-summary-card
      let insightEl = null;
      if (currentDownloadTab === "timeseries") {
        // Buat wrapper sementara yang menggabungkan summary + insight
        const tsSummary = document.getElementById("ts-summary-card");
        const tsInsightEl = document.getElementById("ts-insights");
        if (tsSummary || tsInsightEl) {
          const wrapper = document.createElement("div");
          wrapper.style.cssText = `
            background:${bgColor};padding:16px;border-radius:12px;
            font-family:'DM Sans',sans-serif;max-width:1200px;
            position:fixed;top:-9999px;left:-9999px;z-index:-1;
          `;
          if (tsSummary) {
            const clone = tsSummary.cloneNode(true);
            clone.style.marginBottom = "12px";
            wrapper.appendChild(clone);
          }
          if (tsInsightEl && tsInsightEl.innerHTML.trim()) {
            const insClone = tsInsightEl.cloneNode(true);
            wrapper.appendChild(insClone);
          }
          document.body.appendChild(wrapper);
          insightEl = wrapper;
          // Hapus setelah dipakai (dilakukan setelah html2canvas)
          insightEl._isTemp = true;
        }
      } else {
        const insightMap = {
          "numerical-viz": "num-viz-insight",
          "categorical-viz": "cat-viz-insight",
          "bivariate-viz": "biv-viz-insight",
          "multivariate-viz": "mv-viz-insight",
          "catnum-viz": "cn-viz-insight",
        };
        const insightId = insightMap[currentDownloadTab];
        insightEl = insightId ? document.getElementById(insightId) : null;
      }

      // ── Kumpulkan semua canvas/gambar ────────────────────────────
      const canvasList = []; // array of { canvas, label }

      for (const cb of selectedCharts) {
        const chartId = cb.value;
        const chartLabel = cb.dataset.label || chartId;
        const isPairPlot = cb.dataset.ispairplot === "true";

        try {
          if (isPairPlot) {
            const container = document.getElementById("pair-plot-container");
            if (!container) continue;
            const captured = await html2canvas(container, {
              backgroundColor: bgColor, scale: 2, useCORS: true, logging: false,
            });
            canvasList.push({ canvas: captured, label: chartLabel });
          } else {
            const originalCanvas = document.getElementById(chartId);
            if (!originalCanvas) continue;
            // Buat canvas salinan dengan background
            const exportCanvas = document.createElement("canvas");
            exportCanvas.width = originalCanvas.width;
            exportCanvas.height = originalCanvas.height;
            const exportCtx = exportCanvas.getContext("2d");
            exportCtx.fillStyle = bgColor;
            exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
            exportCtx.drawImage(originalCanvas, 0, 0);
            canvasList.push({ canvas: exportCanvas, label: chartLabel });
          }
        } catch (err) {
          console.error(`Gagal capture ${chartLabel}:`, err);
        }
      }

      if (!canvasList.length) {
        showNotif("Tidak ada chart yang berhasil di-capture.", "error");
        return;
      }

      // ── Capture insight ──────────────────────────────
      let insightCanvas = null;
      if (includeInsight && insightEl && insightEl.innerHTML.trim()) {
        try {
          insightCanvas = await html2canvas(insightEl, {
            backgroundColor: bgColor, scale: 2, useCORS: true, logging: false,
          });
        } catch (err) {
          console.warn("Gagal capture insight:", err);
        } finally {
          // Hapus wrapper sementara kalau time series
          if (insightEl._isTemp && insightEl.parentNode) {
            insightEl.parentNode.removeChild(insightEl);
          }
        }
      } else if (insightEl && insightEl._isTemp && insightEl.parentNode) {
        insightEl.parentNode.removeChild(insightEl);
      }

      // ── Susun layout: berapa kolom? ───────────────────────────────
      // Hitung kolom: kalau <=3 chart pakai 1 kolom per chart, kalau >3 bisa 2 kolom
      const numCharts = canvasList.length;
      const COLS = numCharts <= 2 ? numCharts : numCharts <= 4 ? 2 : 3;
      const ROWS = Math.ceil(numCharts / COLS);
      const PAD = 20;        // padding pinggir
      const GAP = 12;        // jarak antar chart
      const LABEL_H = 22;    // tinggi label nama chart
      const TITLE_H = 44;    // tinggi header judul keseluruhan

      // Hitung lebar & tinggi tiap cell (normalize ke lebar terbesar)
      const maxCW = Math.max(...canvasList.map(c => c.canvas.width));
      const cellW = Math.floor(maxCW / (COLS > 1 ? 1 : 1)); // tiap cell = lebar canvas asli
      // tinggi tiap cell = tinggi canvas masing-masing (akan di-scale ke cellW)
      // Kita pakai cellW yang sama untuk semua, scale height proporsional
      const cellHeights = canvasList.map(c => Math.round(c.canvas.height * (cellW / c.canvas.width)));
      // Tinggi per baris = max tinggi di baris tersebut
      const rowHeights = [];
      for (let r = 0; r < ROWS; r++) {
        let rh = 0;
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          if (idx < canvasList.length) rh = Math.max(rh, cellHeights[idx]);
        }
        rowHeights.push(rh);
      }

      const totalChartW = COLS * cellW + (COLS - 1) * GAP;
      const totalChartH = rowHeights.reduce((a, b) => a + b, 0) + (ROWS - 1) * GAP + ROWS * LABEL_H;

      const insightH = insightCanvas ? insightCanvas.height * (totalChartW / insightCanvas.width) + GAP + 24 : 0;
      const totalH = TITLE_H + totalChartH + PAD * 2 + insightH;
      const totalW = totalChartW + PAD * 2;

      // ── Buat canvas gabungan ──────────────────────────────────────
      const merged = document.createElement("canvas");
      merged.width = totalW;
      merged.height = totalH;
      const mCtx = merged.getContext("2d");

      // Background
      mCtx.fillStyle = bgColor;
      mCtx.fillRect(0, 0, totalW, totalH);

      // Header
      const tabLabelFull = {
        "numerical-viz": "Numerical",
        "categorical-viz": "Categorical",
        "bivariate-viz": "Num vs Num",
        "multivariate-viz": "Multivariate",
        "catnum-viz": "Cat vs Num",
        "timeseries": "Time Series",
      }[currentDownloadTab] || currentDownloadTab;
      mCtx.fillStyle = isDark ? "#ffffff" : "#1a1a1a";
      mCtx.font = "bold 16px DM Sans, sans-serif";
      mCtx.textAlign = "left";
      mCtx.textBaseline = "top";
      const headerText = `Auto EDA Analytics — ${tabLabelFull}${varSlug ? ": " + varSlug.replace(/_/g," ") : ""}`;
      mCtx.fillText(headerText, PAD, PAD);

      // Sub-header
      mCtx.fillStyle = isDark ? "#aaaaaa" : "#888888";
      mCtx.font = "11px DM Sans, sans-serif";
      mCtx.fillText(`SD-1306 Data Science Programming | Kelompok 1 | ${new Date().toLocaleDateString("id-ID")}`, PAD, PAD + 22);

      // Gambar chart per cell
      let yOffset = PAD + TITLE_H;
      for (let r = 0; r < ROWS; r++) {
        let xOffset = PAD;
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          if (idx >= canvasList.length) break;
          const { canvas: cc, label } = canvasList[idx];
          const scaledH = cellHeights[idx];

          // Label nama chart
          mCtx.fillStyle = isDark ? "#cccccc" : "#444444";
          mCtx.font = "bold 11px DM Sans, sans-serif";
          mCtx.textAlign = "left";
          mCtx.textBaseline = "top";
          mCtx.fillText(label, xOffset + 4, yOffset);

          // Background card
          mCtx.fillStyle = isDark ? "#252525" : "#f9f9f9";
          mCtx.beginPath();
          if (mCtx.roundRect) mCtx.roundRect(xOffset, yOffset + LABEL_H - 4, cellW, scaledH + 8, 6);
          else mCtx.rect(xOffset, yOffset + LABEL_H - 4, cellW, scaledH + 8);
          mCtx.fill();

          // Draw chart
          mCtx.drawImage(cc, xOffset, yOffset + LABEL_H, cellW, scaledH);

          xOffset += cellW + GAP;
        }
        yOffset += rowHeights[r] + LABEL_H + GAP;
      }

      // Gambar insight di bawah
      if (insightCanvas) {
        const iW = totalChartW;
        const iH = Math.round(insightCanvas.height * (iW / insightCanvas.width));
        // Label insight
        mCtx.fillStyle = isDark ? "#cccccc" : "#444444";
        mCtx.font = "bold 12px DM Sans, sans-serif";
        mCtx.textAlign = "left";
        mCtx.textBaseline = "top";
        mCtx.fillText("Insight Otomatis", PAD, yOffset);
        mCtx.drawImage(insightCanvas, PAD, yOffset + 18, iW, iH);
      }

      // ── Trigger download ──────────────────────────────────────────
      const link = document.createElement("a");
      link.download = downloadFileName;
      link.href = merged.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // ── Simpan ke backend folder data/visualisasi_png/ ────────────
      try {
        merged.toBlob(async (blob) => {
          if (!blob) return;
          const formData = new FormData();
          formData.append("file", blob, downloadFileName);
          formData.append("filename", downloadFileName);
          await fetch("/save-viz-png", { method: "POST", body: formData })
            .catch(e => console.warn("Gagal simpan viz PNG:", e));
        }, "image/png");
      } catch (e) {
        console.warn("Gagal kirim viz PNG ke backend:", e);
      }

      showNotif(`<b>${downloadFileName}</b> berhasil didownload!`, "success");
    }
  );
}

// ===== NOTIFICATION =====
let notifTimeout = null;
function showNotif(msg, type = "info", position = "center") {
  let el = document.getElementById("global-notif");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-notif";
    document.body.appendChild(el);
  }
  const colors = {
    success: { bg: "#d4f5e2", border: "#1aaa5a", text: "#0d5c30" },
    error:   { bg: "#fde8e8", border: "#e82020", text: "#8b0000" },
    warning: { bg: "#fff8d6", border: "#e8b800", text: "#7a5c00" },
    info:    { bg: "#dbeeff", border: "#1a7ae8", text: "#0a3d7a" },
  };
  const c = colors[type] || colors.info;
  const isRight = position === "right";

  el.innerHTML = msg;
  el.style.cssText = `
    position:fixed;
    top:28px;
    ${isRight ? "right:28px;left:auto;transform:none;" : "left:50%;transform:translateX(-50%);"}
    z-index:99999;
    padding:14px 28px;
    border-radius:12px;
    min-width:280px;
    max-width:520px;
    width:max-content;
    background:${c.bg};
    border-left:5px solid ${c.border};
    color:${c.text};
    font-size:14px;
    font-weight:500;
    box-shadow:0 6px 24px rgba(0,0,0,0.16);
    opacity:1;
    cursor:pointer;
    text-align:center;
    white-space:normal;
    word-break:break-word;
    overflow:visible;
  `;
  el.onclick = () => { el.innerHTML = ""; el.style.cssText = ""; };
  if (notifTimeout) clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => { el.innerHTML = ""; el.style.cssText = ""; }, 4000);
}

// ===== CONFIRM DIALOG =====
function showConfirm(msg, onYes, onNo) {
  let overlay = document.getElementById("confirm-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "confirm-overlay";
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `;
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="
      background:#fffdf7;border-radius:14px;padding:28px 32px;
      max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.18);text-align:center;
    ">
      <div style="margin-bottom:12px;display:flex;justify-content:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f5a623" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div style="font-size:15px;margin-bottom:20px;line-height:1.5;">${msg}</div>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="confirm-yes" style="padding:8px 24px;background:#dc3545;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Ya, Lanjutkan</button>
        <button id="confirm-no" style="padding:8px 24px;background:#eee;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Batal</button>
      </div>
    </div>
  `;
  overlay.style.display = "flex";
  document.getElementById("confirm-yes").onclick = () => { overlay.style.display = "none"; onYes(); };
  document.getElementById("confirm-no").onclick = () => { overlay.style.display = "none"; if (onNo) onNo(); };
}

// ===== LOGIN =====
let currentUser = null;

// ===== LOADING BAR SYSTEM =====
function showLoadingBar(label, durationMs, onDone) {
  const overlay = document.getElementById("loading-bar-overlay");
  const fill    = document.getElementById("loading-bar-fill");
  const lbl     = document.getElementById("loading-bar-label");
  if (!overlay || !fill || !lbl) { if (onDone) onDone(); return; }

  lbl.textContent = label || "Memuat...";
  fill.style.transition = "none";
  fill.style.width = "0%";
  overlay.classList.add("active");

  // Paksa reflow supaya transisi dari 0 berjalan
  void fill.offsetWidth;

  fill.style.transition = `width ${durationMs}ms cubic-bezier(0.4,0,0.2,1)`;
  fill.style.width = "92%";

  const timer = setTimeout(() => {
    fill.style.transition = `width 200ms ease`;
    fill.style.width = "100%";
    setTimeout(() => {
      overlay.classList.remove("active");
      fill.style.transition = "none";
      fill.style.width = "0%";
      if (onDone) onDone();
    }, 220);
  }, durationMs);
}
const ACCOUNTS_KEY = "eda_accounts";

function showPageLoading(pageId, label) {
  const overlay = document.getElementById("global-page-loading");
  const lbl = document.getElementById("gpl-label-text");
  if (!overlay) return;
  if (lbl) lbl.textContent = label || "Memuat...";
  overlay.classList.add("active");
}

function hidePageLoading(pageId) {
  const overlay = document.getElementById("global-page-loading");
  if (!overlay) return;
  overlay.style.transition = "opacity 0.25s ease";
  overlay.style.opacity = "0";
  setTimeout(() => {
    overlay.classList.remove("active");
    overlay.style.opacity = "1";
    overlay.style.transition = "";
  }, 260);
}

function getAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}"); }
  catch { return {}; }
}

function saveAccounts(accounts) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }
  catch(e) { console.warn("Gagal simpan akun:", e); }
}

function showLoginChoice() {
  document.getElementById("login-choice").style.display = "block";
  document.getElementById("login-form-panel").style.display = "none";
  document.getElementById("register-form-panel").style.display = "none";
}

function showLoginForm() {
  document.getElementById("login-choice").style.display = "none";
  document.getElementById("login-form-panel").style.display = "block";
  document.getElementById("register-form-panel").style.display = "none";
  setTimeout(() => document.getElementById("login-username").focus(), 100);
}

function showRegisterForm() {
  document.getElementById("login-choice").style.display = "none";
  document.getElementById("login-form-panel").style.display = "none";
  document.getElementById("register-form-panel").style.display = "block";
  document.getElementById("reg-username-error").style.display = "none";
  // Reset field register
  document.getElementById("reg-username").value = "";
  document.getElementById("reg-password").value = "";
  document.getElementById("reg-password-confirm").value = "";
  setTimeout(() => document.getElementById("reg-username").focus(), 100);
}

function loginWithUsername() {
  const usernameEl = document.getElementById("login-username");
  const passwordEl = document.getElementById("login-password-input");
  const name = usernameEl ? usernameEl.value.trim() : "";
  const pass = passwordEl ? passwordEl.value : "";

  if (!name) {
    usernameEl.style.borderColor = "#dc3545";
    usernameEl.placeholder = "Nama tidak boleh kosong!";
    setTimeout(() => { usernameEl.style.borderColor = "#ddd"; usernameEl.placeholder = "Nama akun..."; }, 2000);
    return;
  }

  const accounts = getAccounts();

  if (!accounts[name]) {
    // Akun belum terdaftar, izinkan masuk langsung
    finishLogin({ name, avatar: name.substring(0, 2).toUpperCase() });
    return;
  }

  // Akun ada, cek password
  if (accounts[name].password && accounts[name].password !== pass) {
    passwordEl.style.borderColor = "#dc3545";
    passwordEl.value = "";
    passwordEl.placeholder = "Password salah!";
    setTimeout(() => { passwordEl.style.borderColor = "#ddd"; passwordEl.placeholder = "Password..."; }, 2000);
    return;
  }

  finishLogin({ name, avatar: name.substring(0, 2).toUpperCase() });
}

function registerAccount() {
  const usernameEl = document.getElementById("reg-username");
  const passwordEl = document.getElementById("reg-password");
  const confirmEl  = document.getElementById("reg-password-confirm");
  const errorEl    = document.getElementById("reg-username-error");

  const name    = usernameEl ? usernameEl.value.trim() : "";
  const pass    = passwordEl ? passwordEl.value : "";
  const confirm = confirmEl  ? confirmEl.value  : "";

  // Reset error
  errorEl.style.display = "none";
  usernameEl.style.borderColor = "#ddd";

  if (!name) {
    usernameEl.style.borderColor = "#dc3545";
    usernameEl.placeholder = "Nama tidak boleh kosong!";
    setTimeout(() => { usernameEl.style.borderColor = "#ddd"; usernameEl.placeholder = "Buat nama akun anda..."; }, 2000);
    return;
  }

  const accounts = getAccounts();

  if (accounts[name]) {
    usernameEl.style.borderColor = "#dc3545";
    errorEl.style.display = "block";
    return;
  }

  if (!pass) {
    passwordEl.style.borderColor = "#dc3545";
    passwordEl.placeholder = "Password tidak boleh kosong!";
    setTimeout(() => { passwordEl.style.borderColor = "#ddd"; passwordEl.placeholder = "Buat password..."; }, 2000);
    return;
  }

  if (pass !== confirm) {
    confirmEl.style.borderColor = "#dc3545";
    confirmEl.value = "";
    confirmEl.placeholder = "Password tidak cocok!";
    setTimeout(() => { confirmEl.style.borderColor = "#ddd"; confirmEl.placeholder = "Ulangi password..."; }, 2000);
    return;
  }

  // Simpan akun baru
  accounts[name] = { password: pass, createdAt: new Date().toLocaleString("id-ID") };
  saveAccounts(accounts);

  // --- REDIRECT KE FORM LOGIN (bukan langsung masuk) ---
  // Isi field login dengan nama yang baru didaftarkan
  const loginUsernameEl = document.getElementById("login-username");
  const loginPasswordEl = document.getElementById("login-password-input");
  if (loginUsernameEl) loginUsernameEl.value = name;
  if (loginPasswordEl) loginPasswordEl.value = "";

  // Tampilkan form login
  showLoginForm();

  // Tampilkan notif sukses registrasi
  // Tambahkan pesan kecil di bawah input username di form login
  const loginHint = document.getElementById("login-register-success");
  if (loginHint) {
    loginHint.style.display = "block";
    setTimeout(() => { loginHint.style.display = "none"; }, 4000);
  }
}

function finishLogin(user) {
  showLoadingBar("Menyiapkan dashboard...", 900, () => {
    currentUser = user;
    document.getElementById("login-page").style.display = "none";
    document.getElementById("welcome-page").style.display = "flex";
    showNotif(`Selamat datang, <b>${user.name}</b>! Kamu berhasil masuk ke Auto EDA Analytics.`, "success", "right");
  });
}

function enterDashboard() {
  showLoadingBar("Membuka halaman upload...", 700, () => {
    document.getElementById("welcome-page").style.display = "none";
    const app = document.getElementById("app-container");
    app.style.cssText = "display:flex;flex-direction:row;width:100%;min-height:100vh;";
    setTimeout(() => {
      showPage("upload");
      renderHistoryPanel();
    }, 100);
  });
}

// ===== TOPBAR TABS (nomor 5, 6, 7) =====

function showTopbarTab(tab) {
  if (tab === 'tim') {
    openTimOverlay();
  } else if (tab === 'profile') {
    openProfileOverlay();
  } else if (tab === 'riwayat') {
    openRiwayatOverlay();
  } else if (tab === 'file') {
    if (fileName) {
      showNotif("File aktif: <b>" + fileName + "</b>", "info");
    } else {
      showNotif("Belum ada file yang dianalisis.", "info");
    }
  }
}

function closeTopbarOverlay(which) {
  const el = document.getElementById("overlay-" + which);
  if (el) el.style.display = "none";
}

// --- TIM OVERLAY ---
function openTimOverlay() {
  const overlay = document.getElementById("overlay-tim");
  const contentEl = document.getElementById("overlay-tim-content");
  if (!overlay || !contentEl) return;

  const meta = getHistoryMeta();
  contentEl.innerHTML = `
    <div style="background:var(--sidebar-bg);border-radius:12px;padding:14px 18px;margin-bottom:18px;">
      <div style="font-family:'DM Serif Display',serif;font-size:17px;color:var(--card-yellow);margin-bottom:2px;">Kelompok 1 — Kelas A</div>
      <div style="font-size:12px;color:#aaa;">SD-1306 Data Science Programming</div>
      <div style="font-size:12px;color:#888;margin-top:3px;">Dosen: <span style="color:var(--card-yellow);font-weight:600;">Bakti Siregar, M.Sc., CDS.</span></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">

      <!-- Member 1 -->
      <div style="background:#fff;border:2px solid #a8cdef;border-radius:14px;padding:18px 14px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0;">
        <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;border:3px solid #a8cdef;margin-bottom:10px;flex-shrink:0;">
          <img src="/static/assets/foto-ak.jpg" style="width:100%;height:100%;object-fit:cover;transform:scale(1.2);" onerror="this.style.display='none'">
        </div>
        <div style="font-size:10px;color:#888;font-weight:700;letter-spacing:0.8px;margin-bottom:3px;">52250001</div>
        <div style="font-weight:800;font-size:14px;color:#1a1a1a;margin-bottom:10px;line-height:1.3;">Angelique Kiyoshi Lakeisha B.U</div>
        <div style="width:100%;height:1px;background:#e8e4dc;margin-bottom:10px;"></div>
        <div style="display:flex;flex-direction:column;gap:5px;width:100%;">
          <span style="background:#1a5276;color:#a8cdef;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">Backend & Core Logic</span>
          <span style="background:#7a1560;color:#f4aecf;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">Interactive Visualization</span>
          <span style="background:#3a1a80;color:#c4a0f4;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">UI/UX Refinement</span>
          <span style="background:#0d5c4a;color:#a0e4dc;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">Feature Expansion</span>
        </div>
      </div>

      <!-- Member 2 -->
      <div style="background:#fff;border:2px solid #f5e642;border-radius:14px;padding:18px 14px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0;">
        <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;border:3px solid #f5e642;margin-bottom:10px;flex-shrink:0;">
          <img src="/static/assets/foto-pa.png" style="width:100%;height:100%;object-fit:cover;object-position:top;" onerror="this.style.display='none'">
        </div>
        <div style="font-size:10px;color:#888;font-weight:700;letter-spacing:0.8px;margin-bottom:3px;">52250002</div>
        <div style="font-weight:800;font-size:14px;color:#1a1a1a;margin-bottom:10px;line-height:1.3;">Putri Adria Garini</div>
        <div style="width:100%;height:1px;background:#e8e4dc;margin-bottom:10px;"></div>
        <div style="display:flex;flex-direction:column;gap:5px;width:100%;">
          <span style="background:#7a5c00;color:#f5e642;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">UI Design & Prototype</span>
          <span style="background:#2a5a00;color:#b8d96e;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">Base Visualization</span>
          <span style="background:#7a3800;color:#f4c4a0;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">Core Feature Dev</span>
          <span style="background:#7a0a0a;color:#f4aecf;padding:4px 0;border-radius:6px;font-size:10px;font-weight:700;display:block;text-align:center;">End-to-End Pipeline</span>
        </div>
      </div>

    </div>

    <div style="background:var(--cream-dark);border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1.5px solid var(--border);">
      <div style="font-size:12px;color:var(--text-muted);">Lihat fitur lengkap & cara kerja dashboard ini</div>
      <button onclick="closeTopbarOverlay('tim');showPage('dashboard');" style="padding:8px 16px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;transition:background 0.18s;" onmouseover="this.style.background='#333';" onmouseout="this.style.background='var(--sidebar-bg)';">
        Lihat Lebih &rarr;
      </button>
    </div>
  `;

  overlay.style.display = "flex";
}

// --- PROFILE OVERLAY ---
function openProfileOverlay() {
  const overlay = document.getElementById("overlay-profile");
  const contentEl = document.getElementById("overlay-profile-content");
  if (!overlay || !contentEl) return;

  const user = currentUser || { name: "Pengguna", avatar: "?" };
  const savedEmail = localStorage.getItem("eda_user_email_" + user.name) || "";

  contentEl.innerHTML = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="width:72px;height:72px;border-radius:50%;background:#f5e642;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;margin:0 auto 12px;border:3px solid #e8d800;">
        ${user.avatar || user.name.substring(0,2).toUpperCase()}
      </div>
      <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${user.name}</div>
      <div style="font-size:12px;color:#999;">Anggota Kelompok 1</div>
      ${savedEmail ? `<div style="font-size:12px;color:#4a9ee8;margin-top:4px;">${savedEmail}</div>` : `<div style="font-size:12px;color:#bbb;margin-top:4px;">Email belum terhubung</div>`}
    </div>

    <div style="border-top:1px solid #eee;padding-top:20px;display:flex;flex-direction:column;gap:10px;">

      <!-- Hubungkan / Ganti Email -->
      <div>
        <button id="btn-connect-email" onclick="toggleEmailSection()" style="width:100%;padding:10px 16px;background:#f0f4ff;border:1px solid #a8cdef;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#1a1a1a;text-align:left;display:flex;align-items:center;gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a5276" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          ${savedEmail ? "Ganti Email" : "Hubungkan Email"}
          ${savedEmail ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg>` : ''}
        </button>
        <div id="email-section" style="display:none;margin-top:10px;padding:14px;background:#f8f9ff;border-radius:10px;border:1px solid #dde;">
          ${savedEmail ? `<div style="font-size:11px;color:#888;margin-bottom:8px;padding:6px 10px;background:#e8f4ff;border-radius:6px;border:1px solid #a8cdef;">Email saat ini: <strong style="color:#1a5276;">${savedEmail}</strong></div>` : ""}
          <label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">${savedEmail ? "Alamat Email Baru" : "Alamat Email"}</label>
          <input id="input-email" type="email" placeholder="contoh@gmail.com" value=""
            style="width:100%;padding:10px 12px;border:2px solid #ddd;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;font-family:'DM Sans',sans-serif;"
            onfocus="this.style.borderColor='#a8cdef'"
            onblur="this.style.borderColor='#ddd'"
            onkeydown="if(event.key==='Enter') saveEmailProfile()"
          />
          <button onclick="saveEmailProfile()" style="margin-top:10px;padding:8px 20px;background:#a8cdef;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#1a1a1a;">
            ${savedEmail ? "Perbarui & Kirim Notifikasi" : "Hubungkan & Kirim Notifikasi"}
          </button>
          <div id="email-notif" style="font-size:12px;color:#4a9ee8;margin-top:8px;display:none;"></div>
        </div>
      </div>

      <!-- Ganti Password -->
      <div>
        <button id="btn-change-pass" onclick="togglePasswordSection()" style="width:100%;padding:10px 16px;background:#fff0f6;border:1px solid #f4aecf;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#1a1a1a;text-align:left;display:flex;align-items:center;gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b84280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Ganti Password
        </button>
        <div id="password-section" style="display:none;margin-top:10px;padding:14px;background:#fff8fb;border-radius:10px;border:1px solid #f4d0e0;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Buat Sandi Baru</label>
          <input id="input-new-pass" type="password" placeholder="Sandi baru..."
            style="width:100%;padding:10px 12px;border:2px solid #ddd;border-radius:8px;font-size:13px;outline:none;margin-bottom:8px;box-sizing:border-box;font-family:'DM Sans',sans-serif;"
            onfocus="this.style.borderColor='#f4aecf'"
            onblur="this.style.borderColor='#ddd'"
          />
          <label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Ulangi Sandi Baru</label>
          <input id="input-confirm-pass" type="password" placeholder="Ulangi sandi baru..."
            style="width:100%;padding:10px 12px;border:2px solid #ddd;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;font-family:'DM Sans',sans-serif;"
            onfocus="this.style.borderColor='#f4aecf'"
            onblur="this.style.borderColor='#ddd'"
          />
          <button onclick="savePasswordProfile()" style="margin-top:10px;padding:8px 20px;background:#f4aecf;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#1a1a1a;">
            Simpan Sandi
          </button>
          <div id="pass-notif" style="font-size:12px;margin-top:8px;display:none;"></div>
        </div>
      </div>

      <!-- Tombol Close Profile -->
      <button onclick="closeTopbarOverlay('profile')" style="margin-top:8px;width:100%;padding:10px 16px;background:#1a1a1a;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#f5e642;">
        ✕ Close Profile
      </button>
    </div>
  `;

  overlay.style.display = "flex";
}

function toggleEmailSection() {
  const sec = document.getElementById("email-section");
  if (sec) sec.style.display = sec.style.display === "none" ? "block" : "none";
}

function togglePasswordSection() {
  const sec = document.getElementById("password-section");
  if (sec) sec.style.display = sec.style.display === "none" ? "block" : "none";
}

function saveEmailProfile() {
  const input = document.getElementById("input-email");
  const notif = document.getElementById("email-notif");
  if (!input || !notif) return;
  const newEmail = input.value.trim();
  if (!newEmail || !newEmail.includes("@")) {
    notif.style.display = "block";
    notif.style.color = "#e85d5d";
    notif.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e85d5d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Masukkan alamat email yang valid.</span>`;
    return;
  }

  const user = currentUser || { name: "Pengguna" };
  const oldEmail = localStorage.getItem("eda_user_email_" + user.name) || "";
  const isGanti = oldEmail && oldEmail !== newEmail;

  // Simpan email baru
  localStorage.setItem("eda_user_email_" + user.name, newEmail);
  const nowStr = new Date().toLocaleString("id-ID");
  localStorage.setItem("eda_email_connected_" + user.name, nowStr);

  // Susun isi pesan email (tanpa password)
  let pesanUtama = "";
  if (isGanti) {
    pesanUtama = `Alamat email Anda berhasil diperbarui di Auto EDA Analytics.

Perubahan Email:
  Dari  : ${oldEmail}
  Ke    : ${newEmail}

Informasi Akun:
  Nama Akun          : ${user.name}
  Email Baru         : ${newEmail}
  Diperbarui Pada    : ${nowStr}

Harap simpan pesan ini sebagai informasi pribadi Anda tentang dashboard ini.
Jika Anda tidak merasa melakukan perubahan ini, segera hubungi administrator.`;
  } else {
    pesanUtama = `Email Anda berhasil dihubungkan ke Auto EDA Analytics!

Berikut adalah informasi profil Anda:
  Nama Akun       : ${user.name}
  Email           : ${newEmail}
  Terhubung Pada  : ${nowStr}

Harap simpan pesan ini sebagai informasi pribadi Anda tentang dashboard ini.`;
  }

  // Tampilkan loading di notif
  notif.style.display = "block";
  notif.style.color = "#888";
  notif.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Mengirim email konfirmasi...</span>`;

  sendProfileEmail(newEmail, user.name, pesanUtama)
    .then(() => {
      notif.style.color = "#1a7a2a";
      notif.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg> ${isGanti ? "Email diperbarui" : "Email terhubung"}! Cek inbox ${newEmail}</span>`;
      setTimeout(() => openProfileOverlay(), 2000);
    })
    .catch((err) => {
      console.error("EmailJS error:", err);
      notif.style.color = "#b8660a";
      notif.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8660a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Email tersimpan tapi gagal kirim notifikasi. Cek koneksi internet.</span>`;
      setTimeout(() => openProfileOverlay(), 2500);
    });
}

function savePasswordProfile() {
  const newPass = document.getElementById("input-new-pass");
  const confirmPass = document.getElementById("input-confirm-pass");
  const notif = document.getElementById("pass-notif");
  if (!newPass || !confirmPass || !notif) return;
  if (!newPass.value.trim()) {
    notif.style.display = "block";
    notif.style.color = "#e85d5d";
    notif.textContent = "⚠️ Sandi tidak boleh kosong.";
    return;
  }
  if (newPass.value !== confirmPass.value) {
    notif.style.display = "block";
    notif.style.color = "#e85d5d";
    notif.textContent = "⚠️ Sandi tidak cocok. Silakan ulangi.";
    return;
  }

  const user = currentUser || { name: "" };
  if (user.name) {
    const accounts = getAccounts();
    if (!accounts[user.name]) accounts[user.name] = {};
    accounts[user.name].password = newPass.value;
    saveAccounts(accounts);
  }

  notif.style.display = "block";
  notif.style.color = "#6dbf67";
  notif.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a7a2a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5"/><polyline points="7 13 10 16 17 9"/></svg> Sandi berhasil diperbarui. Gunakan sandi baru saat login berikutnya.</span>`;
  newPass.value = "";
  confirmPass.value = "";
}

// --- RIWAYAT DATASET OVERLAY ---
function openRiwayatOverlay() {
  const overlay = document.getElementById("overlay-riwayat");
  const contentEl = document.getElementById("overlay-riwayat-content");
  if (!overlay || !contentEl) return;

  renderRiwayatList(contentEl, "");
  overlay.style.display = "flex";
}

function renderRiwayatList(contentEl, keyword) {
  const meta = getHistoryMeta();
  const filtered = keyword
    ? meta.filter(m => m.fileName.toLowerCase().includes(keyword.toLowerCase()))
    : meta;

  if (!document.getElementById("riwayat-hover-style")) {
    const style = document.createElement("style");
    style.id = "riwayat-hover-style";
    style.textContent = `
      .riwayat-card {
        background:#fff;
        border:1px solid #e8e4dc;
        border-radius:12px;
        padding:14px 16px;
        display:flex;
        align-items:center;
        gap:14px;
        transition:box-shadow 0.18s, background 0.18s, transform 0.15s;
        cursor:default;
      }
      .riwayat-card:hover {
        background:#fffbe6;
        box-shadow:0 4px 18px rgba(0,0,0,0.1);
        transform:translateY(-2px);
        border-color:#f5e642;
      }
    `;
    document.head.appendChild(style);
  }

  function getRiwayatLogo(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#21A366"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="15" font-weight="700" fill="white">CSV</text></svg>`;
    if (ext === 'xlsx' || ext === 'xls') return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#1D6F42"/><text x="26" y="22" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,0.85)">EXCEL</text><text x="18" y="38" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="18" font-weight="900" fill="white">X</text></svg>`;
    if (ext === 'txt') return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#4A6FA5"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="14" font-weight="700" fill="white">TXT</text></svg>`;
    return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#888"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="13" font-weight="700" fill="white">FILE</text></svg>`;
  }

  let html = `
    <div style="margin-bottom:14px;position:relative;">
      <input
        id="riwayat-search-input"
        type="text"
        placeholder="🔍 Cari dataset..."
        value="${keyword}"
        oninput="renderRiwayatList(document.getElementById('overlay-riwayat-content'), this.value)"
        style="width:100%;padding:10px 16px;border:2px solid #ddd;border-radius:10px;font-size:13px;
               outline:none;font-family:'DM Sans',sans-serif;box-sizing:border-box;background:#fffdf7;
               transition:border 0.2s;"
        onfocus="this.style.borderColor='#f5e642'"
        onblur="this.style.borderColor='#ddd'"
      />
    </div>
  `;

  if (!filtered.length) {
    html += `<div style="text-align:center;padding:32px;color:#999;">
      <div style="font-size:36px;margin-bottom:12px;"></div>
      <p>${keyword ? 'Dataset tidak ditemukan.' : 'Belum ada dataset yang pernah diupload.'}</p>
    </div>`;
  } else {
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;color:#999;">${filtered.length} dataset ditemukan</span>
        <button onclick="clearAllHistoryFromOverlay()" style="padding:5px 12px;background:#fee;border:1px solid #f4aecf;border-radius:8px;font-size:12px;cursor:pointer;color:#c0392b;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
          Hapus Semua
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${filtered.map(entry => {
          const sizeStr = entry.fileSize > 0
            ? (entry.fileSize >= 1024*1024
                ? (entry.fileSize/(1024*1024)).toFixed(1)+" MB"
                : (entry.fileSize/1024).toFixed(1)+" KB")
            : "—";
          const hasData = !!loadDataFromSession(entry.id);
          return `
          <div class="riwayat-card">
            <div style="flex-shrink:0;">${getRiwayatLogo(entry.fileName)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${entry.fileName}">
                ${entry.fileName}
              </div>
              <div style="font-size:11px;color:#888;margin-top:3px;">
                ${entry.rows.toLocaleString()} baris &nbsp;·&nbsp; ${entry.cols} kolom &nbsp;·&nbsp; ${sizeStr}
              </div>
              <div style="font-size:11px;color:#bbb;margin-top:2px;">🕐 ${entry.uploadedAt}</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button onclick="loadHistoryEntryFromOverlay('${entry.id}')"
                ${!hasData ? 'disabled title="Data tidak tersedia, upload ulang"' : ''}
                style="padding:6px 12px;background:${hasData ? '#f5e642' : '#eee'};border:none;border-radius:8px;font-size:12px;cursor:${hasData ? 'pointer' : 'not-allowed'};font-weight:600;color:#1a1a1a;transition:background 0.15s;display:inline-flex;align-items:center;gap:5px;"
                ${hasData ? 'onmouseover="this.style.background=\'#e8d800\'" onmouseout="this.style.background=\'#f5e642\'"' : ''}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Muat
              </button>
              <button onclick="deleteHistoryEntryFromOverlay('${entry.id}')"
                style="padding:6px 10px;background:#fff0f0;border:1px solid #f4aecf;border-radius:8px;font-size:13px;cursor:pointer;transition:background 0.15s;display:inline-flex;align-items:center;justify-content:center;"
                onmouseover="this.style.background='#ffd5d5'" onmouseout="this.style.background='#fff0f0'"
                title="Hapus dari riwayat">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>`;
        }).join("")}
      </div>
    `;
  }

  contentEl.innerHTML = html;
  if (keyword !== "") {
    const inp = document.getElementById("riwayat-search-input");
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function loadHistoryEntryFromOverlay(id) {
  closeTopbarOverlay('riwayat');
  loadHistoryEntry(id);
}

function deleteHistoryEntryFromOverlay(id) {
  showConfirm("Hapus entri histori ini?", () => {
    const meta = getHistoryMeta().filter(m => m.id !== id);
    saveHistoryMeta(meta);
    try { sessionStorage.removeItem(HISTORY_DATA_PREFIX + id); } catch {}
    showNotif("Entri histori dihapus!", "info");
    openRiwayatOverlay(); // refresh tampilan
  });
}

function clearAllHistoryFromOverlay() {
  showConfirm("Hapus SEMUA histori upload? Tindakan ini tidak dapat dibatalkan.", () => {
    const meta = getHistoryMeta();
    meta.forEach(m => { try { sessionStorage.removeItem(HISTORY_DATA_PREFIX + m.id); } catch {} });
    saveHistoryMeta([]);
    renderHistoryPanel();
    showNotif("Semua histori telah dihapus!", "info");
    openRiwayatOverlay(); // refresh tampilan
  });
}

// ===== EXPORT HISTORY PANEL =====
function renderExportHistoryPanel() {
  const el = document.getElementById("export-history-list");
  if (!el) return;

  const allHist = getExportHistory();

  // Ambil keyword dari input pencarian kalau ada
  const searchInput = document.getElementById("export-history-search-input");
  const keyword = searchInput ? searchInput.value.toLowerCase() : "";
  const hist = keyword
    ? allHist.filter(h => h.fileName.toLowerCase().includes(keyword))
    : allHist;

  function getFormatLogo(format) {
    if (format === "xlsx") return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#1D6F42"/><text x="26" y="22" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="9" font-weight="700" fill="rgba(255,255,255,0.85)">EXCEL</text><text x="18" y="38" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="18" font-weight="900" fill="white">X</text></svg>`;
    if (format === "csv") return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#21A366"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="15" font-weight="700" fill="white">CSV</text></svg>`;
    if (format === "pdf") return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#E84040"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="15" font-weight="700" fill="white">PDF</text></svg>`;
    return `<svg width="38" height="38" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="52" height="52" rx="10" fill="#888"/><text x="26" y="33" text-anchor="middle" font-family="DM Sans,Arial,sans-serif" font-size="13" font-weight="700" fill="white">FILE</text></svg>`;
  }

  // Bangun HTML: kotak cari + list
  let listHtml = "";
  if (!hist.length) {
    listHtml = `<div style="text-align:center;padding:32px;color:#999;">
      <div style="font-size:36px;margin-bottom:12px;">📭</div>
      <p>${keyword ? 'Laporan tidak ditemukan.' : 'Belum ada riwayat export.'}</p>
    </div>`;
  } else {
    listHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;color:#999;">${hist.length} laporan ditemukan</span>
        <button onclick="clearAllExportHistory()" style="padding:5px 12px;background:#fee;border:1px solid #f4aecf;border-radius:8px;font-size:12px;cursor:pointer;color:#c0392b;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
          Hapus Semua
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${hist.map((h, idx) => {
          // Cari index asli di allHist karena hist bisa terfilter
          const realIdx = allHist.findIndex(x => x.timestamp === h.timestamp && x.fileName === h.fileName);
          return `
          <div style="
            display:flex;align-items:center;gap:14px;
            padding:14px 16px;background:#fff;border-radius:12px;
            border:1px solid #e8e4dc;
            transition:box-shadow 0.18s,background 0.18s;
          "
          onmouseover="this.style.background='#fffbe6';this.style.boxShadow='0 4px 18px rgba(0,0,0,0.08)'"
          onmouseout="this.style.background='#fff';this.style.boxShadow='none'"
          >
            <div style="flex-shrink:0;">${getFormatLogo(h.format)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${h.fileName}">
                ${h.fileName}
              </div>
              <div style="font-size:11px;color:#888;margin-top:2px;">
                ${h.rows ? h.rows.toLocaleString() + " baris · " : ""}${h.cols ? h.cols + " kolom · " : ""}Format: <strong>${h.format.toUpperCase()}</strong>
              </div>
              <div style="font-size:11px;color:#bbb;margin-top:2px;">🕐 ${h.downloadedAt}</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button onclick="redownloadExport(${realIdx})" style="
                padding:6px 12px;background:#f5e642;border:none;border-radius:8px;
                font-size:12px;cursor:pointer;font-weight:600;color:#1a1a1a;
                transition:background 0.15s;white-space:nowrap;
              "
              onmouseover="this.style.background='#e8d800'" onmouseout="this.style.background='#f5e642'">
                ↓ Download Lagi
              </button>
              <button onclick="deleteExportHistory(${realIdx})" style="
                padding:6px 10px;background:#fff0f0;border:1px solid #f4aecf;
                border-radius:8px;cursor:pointer;transition:background 0.15s;display:inline-flex;align-items:center;justify-content:center;
              "
              onmouseover="this.style.background='#ffd5d5'" onmouseout="this.style.background='#fff0f0'"
              title="Hapus dari riwayat">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }

  // Cek apakah kotak cari sudah ada (supaya tidak re-render saat mengetik)
  const existingSearch = document.getElementById("export-history-search-input");
  if (!existingSearch) {
    // Render kotak cari + list sekaligus
    el.innerHTML = `
      <div style="margin-bottom:14px;">
        <input
          id="export-history-search-input"
          type="text"
          placeholder="🔍 Cari laporan..."
          oninput="renderExportHistoryPanel()"
          style="width:100%;padding:10px 16px;border:2px solid #ddd;border-radius:10px;font-size:13px;
                 outline:none;font-family:'DM Sans',sans-serif;box-sizing:border-box;background:#fffdf7;
                 transition:border 0.2s;"
          onfocus="this.style.borderColor='#f5e642'"
          onblur="this.style.borderColor='#ddd'"
        />
      </div>
      <div id="export-history-results"></div>
    `;
  }

  // Update hanya bagian list, bukan kotak cari
  const resultsEl = document.getElementById("export-history-results");
  if (resultsEl) resultsEl.innerHTML = listHtml;
}

function clearAllExportHistory() {
  showConfirm("Hapus SEMUA riwayat export? Tindakan ini tidak dapat dibatalkan.", () => {
    saveExportHistory([]);
    renderExportHistoryPanel();
    showNotif("Semua riwayat export telah dihapus.", "info");
  });
}

function openExportHistoryOverlay() {
  const overlay = document.getElementById("overlay-export-history");
  if (!overlay) return;
  renderExportHistoryPanel();
  overlay.style.display = "flex";
}

function closeExportHistoryOverlay() {
  const overlay = document.getElementById("overlay-export-history");
  if (overlay) overlay.style.display = "none";
}

function redownloadExport(idx) {
  const hist = getExportHistory();
  const entry = hist[idx];
  if (!entry) return;

  if (entry.format === "csv") {
    if (!cleanData.length) {
      showNotif("Data tidak tersedia di sesi ini. Muat dataset terlebih dahulu!", "warning");
      return;
    }
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };
    const rows = [headers.map(escapeCSV).join(","), ...cleanData.map(r => headers.map(h => escapeCSV(r[h])).join(","))];
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = entry.fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotif(`<b>${entry.fileName}</b> berhasil diunduh kembali.`, "success");

  } else if (entry.format === "xlsx") {
    if (!cleanData.length) {
      showNotif("Data tidak tersedia di sesi ini! Muat dataset terlebih dahulu.", "warning");
      return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...cleanData.map(r => headers.map(h => r[h] ?? ""))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, entry.fileName);
    showNotif(`<b>${entry.fileName}</b> berhasil diunduh kembali.`, "success");

  } else if (entry.format === "pdf") {
    showNotif("Untuk laporan PDF, silakan klik <b>Download PDF</b> lagi dari halaman Laporan.", "info");
  }
}

function deleteExportHistory(idx) {
  showConfirm("Hapus entri riwayat export ini?", () => {
    const hist = getExportHistory();
    hist.splice(idx, 1);
    saveExportHistory(hist);
    renderExportHistoryPanel();
    showNotif("Entri riwayat export dihapus.", "info");
  });
}

function logout() {
  showConfirm("Keluar dari dashboard?", () => {
    showLoadingBar("Keluar dari dashboard...", 800, () => {
      currentUser = null;
      // Reset dark mode ke light mode saat logout
      document.body.classList.remove("dark-mode");
      localStorage.setItem("eda_dark_mode", "0");
      Chart.defaults.color = "#666666";
      Chart.defaults.borderColor = "#e0e0e0";
      const moon = document.getElementById("dark-mode-icon-moon");
      const sun  = document.getElementById("dark-mode-icon-sun");
      if (moon) moon.style.display = "block";
      if (sun)  sun.style.display  = "none";
      document.getElementById("app-container").style.display = "none";
      showLoginChoice();
      document.getElementById("login-page").style.display = "flex";
      showNotif("Kamu telah keluar.", "info");
    });
  });
}

// ===== SUMMARY DASHBOARD =====

function showAnalysisConfirm() {
  if (!rawData.length) return;
  showConfirm(
    `Yakin lanjutkan analisis dengan dataset <b>${fileName}</b>?`,
    () => {
      showLoadingBar("Menyiapkan summary dashboard...", 1100, () => {
        renderSummaryDashboard();
      });
    }
  );
}

function goBackToUpload() {
  showConfirm("Ubah file data? Tampilan summary akan hilang dan kamu kembali ke halaman upload.", () => {
    showLoadingBar("Kembali ke halaman upload...", 600, () => {
      rawData = [];
      cleanData = [];
      headers = [];
      colTypes = {};
      cleaningLog = [];
      fileName = "";
      document.getElementById("summary-dashboard-section").style.display = "none";
      document.getElementById("upload-main-section").style.display = "block";
      document.getElementById("file-info-card").style.display = "none";
      document.getElementById("upload-guide").style.display = "block";
      document.getElementById("file-input").value = "";
      document.getElementById("analyze-btn-wrap").style.display = "none";
      updateBadge("Belum ada file");
      resetAllDashboardState();
      showNotif("Data aktif telah dihapus.", "error");
    });
  });
}

function autoPickNumCol() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^NO$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  if (!numCols.length) return null;
  // Pilih kolom dengan std dev tertinggi (paling bervariasi)
  let best = numCols[0], bestStd = 0;
  numCols.forEach(col => {
    const vals = cleanData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (vals.length < 2) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (std > bestStd) { bestStd = std; best = col; }
  });
  return best;
}

function autoPickCatCol() {
  const catCols = headers.filter(h => colTypes[h] === "categorical").filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    return u >= 2 && u <= 6 && (u / vals.length) < 0.9;
  });
  // Jika tidak ada yang <= 6, fallback ke yang <= 10
  const fallbackCols = catCols.length === 0
    ? headers.filter(h => colTypes[h] === "categorical").filter(col => {
        const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
        const u = new Set(vals).size;
        return u >= 2 && u <= 10 && (u / vals.length) < 0.9;
      })
    : catCols;

  const targetCols = fallbackCols.length > 0 ? fallbackCols : headers.filter(h => colTypes[h] === "categorical").filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    return new Set(vals).size >= 2;
  });

  if (!targetCols.length) return null;
  // Pilih kolom dengan unique paling sedikit
  let best = targetCols[0];
  let bestU = Infinity;
  targetCols.forEach(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    if (u < bestU) { bestU = u; best = col; }
  });
  return best;
}

function autoPickNumPair() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  if (numCols.length < 2) return null;
  let bestR = 0, bestPair = [numCols[0], numCols[1]];
  for (let i = 0; i < Math.min(numCols.length, 6); i++) {
    for (let j = i + 1; j < Math.min(numCols.length, 6); j++) {
      const r = Math.abs(calcCorr(cleanData, numCols[i], numCols[j]));
      if (r > bestR && r < 0.999) { bestR = r; bestPair = [numCols[i], numCols[j]]; }
    }
  }
  return bestPair;
}

function autoPickCatNumPair() {
  const excludeC = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const catCols = headers.filter(h => colTypes[h] === "categorical" && !excludeC.test(h)).filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    const ratio = u / vals.length;
    return u >= 2 && u <= 15 && ratio < 0.85;
  });
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !excludeC.test(h));
  if (!catCols.length || !numCols.length) return null;
  // Pilih num dengan std tertinggi
  let bestNum = numCols[0], bestStd = 0;
  numCols.forEach(col => {
    const vals = cleanData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (std > bestStd) { bestStd = std; bestNum = col; }
  });
  return [catCols[0], bestNum];
}

// ===== RENDER SUMMARY DASHBOARD =====
function renderSummaryDashboard() {
  document.getElementById("upload-main-section").style.display = "none";
  document.getElementById("analyze-btn-wrap").style.display = "none";
  document.getElementById("file-info-card").style.display = "none";
  const section = document.getElementById("summary-dashboard-section");
  section.style.display = "block";

  const numCols = headers.filter(h => colTypes[h] === "numeric" && !(/^id$|_id$|^no$|^index$|^idx$|^kode$/i.test(h)));
  const catCols = headers.filter(h => colTypes[h] === "categorical").filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    return u >= 2 && u <= 30 && (u / vals.length) < 0.85;
  });
  const dtCols = headers.filter(h => colTypes[h] === "datetime");

  section.innerHTML = `
    <!-- HEADER -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:17px;color:var(--text-dark);">Summary Dashboard</div>
        <div style="font-size:11px;color:var(--text-muted);">Analisis otomatis: <strong>${fileName}</strong></div>
      </div>
      <button onclick="goBackToUpload()" style="padding:5px 12px;background:#fff;border:1.5px solid var(--border);border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;color:var(--danger);font-family:'DM Sans',sans-serif;" onmouseover="this.style.background='#fff0f0'" onmouseout="this.style.background='#fff'">↩ Ubah File</button>
    </div>

    <!-- ROW 1: 4 CARD (Data Quality | Data Preview | Numerical | Categorical) -->
    <div style="display:grid;grid-template-columns:220px 1fr 1fr 1fr;gap:7px;margin-bottom:7px;">

      <!-- Data Quality -->
      <div class="card" style="padding:9px;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:700;font-size:11px;">Data Quality</div>
          <button onclick="showPage('cleaning')" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Cleaning →</button>
        </div>
        ${buildCleaningIssues()}
      </div>

      <!-- Data Preview -->
      <div class="card" style="padding:9px;background:#fff;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <div style="font-weight:700;font-size:11px;">Data Preview</div>
          <button onclick="showPage('preview')" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Semua →</button>
        </div>
        <div style="overflow:auto;max-height:120px;">${buildPreviewTable(5)}</div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:3px;">5 dari ${rawData.length.toLocaleString()} baris</div>
      </div>

      <!-- Numerical Summary -->
      <div class="card" style="padding:9px;background:#e8f4ff;border:1.5px solid #a8cdef;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <div style="font-weight:700;font-size:11px;color:#1a5276;">Numerical Summary</div>
          <button onclick="showPage('stats')" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Semua →</button>
        </div>
        <div style="overflow:auto;max-height:120px;">
          <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
            <thead><tr style="background:#d0e8f8;">
              <th style="padding:3px 5px;text-align:left;font-size:8px;text-transform:uppercase;color:#1a5276;">Var</th>
              <th style="padding:3px 5px;color:#1a5276;">Mean</th>
              <th style="padding:3px 5px;color:#1a5276;">Std</th>
              <th style="padding:3px 5px;color:#1a5276;">Miss</th>
              <th style="padding:3px 5px;color:#1a5276;">Out</th>
              <th style="padding:3px 5px;color:#1a5276;">Dist</th>
            </tr></thead>
            <tbody>${buildNumStatRows()}</tbody>
          </table>
        </div>
      </div>

      <!-- Categorical Summary -->
      <div class="card" style="padding:9px;background:#e8f4ff;border:1.5px solid #a8cdef;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <div style="font-weight:700;font-size:11px;color:#1a5276;">Categorical Summary</div>
          <button onclick="showPage('stats');setTimeout(()=>switchStatsTab('categorical'),100)" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Semua →</button>
        </div>
        <div style="overflow:auto;max-height:120px;">
          <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
            <thead><tr style="background:#d0e8f8;">
              <th style="padding:3px 5px;text-align:left;font-size:8px;text-transform:uppercase;color:#1a5276;">Var</th>
              <th style="padding:3px 5px;color:#1a5276;">Uniq</th>
              <th style="padding:3px 5px;color:#1a5276;">Mode</th>
              <th style="padding:3px 5px;color:#1a5276;">Mode%</th>
              <th style="padding:3px 5px;color:#1a5276;">Miss</th>
            </tr></thead>
            <tbody>${buildCatStatRows()}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ROW 2: Insight + Rekomendasi + Quick Actions -->
    <div style="display:grid;grid-template-columns:1fr 1fr 200px;gap:7px;margin-bottom:7px;">

      <!-- Insight -->
      <div class="card" style="padding:9px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:700;font-size:11px;">Insight</div>
          <button onclick="showPage('insight')" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Semua →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">${buildSummaryInsights()}</div>
      </div>

      <!-- Rekomendasi -->
      <div class="card" style="padding:9px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:700;font-size:11px;">Rekomendasi</div>
          <button onclick="showPage('insight')" style="padding:2px 7px;background:var(--sidebar-bg);color:var(--card-yellow);border:none;border-radius:5px;font-size:9px;font-weight:600;cursor:pointer;">Semua →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">${buildSummaryRekomendasi()}</div>
      </div>

      <!-- Quick Actions -->
<div class="card" style="padding:9px;">
  <div style="font-weight:700;font-size:11px;margin-bottom:6px;">Quick Actions</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
    <button onclick="showLoadingBar('Membuka Cleaning...',500,()=>showPage('cleaning'))" style="padding:8px 4px;background:linear-gradient(135deg,#f5e642,#e8d800);border:none;border-radius:8px;cursor:pointer;font-size:9px;font-weight:700;color:#1a1a1a;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all 0.15s;box-shadow:0 2px 6px rgba(245,230,66,0.4);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 10px rgba(245,230,66,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 6px rgba(245,230,66,0.4)'">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Cleaning</span>
    </button>
    <button onclick="showLoadingBar('Membuka Statistik...',500,()=>showPage('stats'))" style="padding:8px 4px;background:linear-gradient(135deg,#a8cdef,#6aabdf);border:none;border-radius:8px;cursor:pointer;font-size:9px;font-weight:700;color:#1a1a1a;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all 0.15s;box-shadow:0 2px 6px rgba(168,205,239,0.4);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 10px rgba(168,205,239,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 6px rgba(168,205,239,0.4)'">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="12" width="4" height="9" rx="1" fill="#1a1a1a"/><rect x="10" y="7" width="4" height="14" rx="1" fill="#1a1a1a"/><rect x="17" y="3" width="4" height="18" rx="1" fill="#1a1a1a"/></svg>
      <span>Statistik</span>
    </button>
    <button onclick="showLoadingBar('Membuka Visualisasi...',500,()=>showPage('viz'))" style="padding:8px 4px;background:linear-gradient(135deg,#b8d96e,#8ec83a);border:none;border-radius:8px;cursor:pointer;font-size:9px;font-weight:700;color:#1a1a1a;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all 0.15s;box-shadow:0 2px 6px rgba(184,217,110,0.4);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 10px rgba(184,217,110,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 6px rgba(184,217,110,0.4)'">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#1a1a1a" stroke-width="2"/><path d="M12 3v9l6 3" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Visualisasi</span>
    </button>
    <button onclick="showPage('report')" style="padding:8px 4px;background:linear-gradient(135deg,#f4aecf,#e87ab8);border:none;border-radius:8px;cursor:pointer;font-size:9px;font-weight:700;color:#1a1a1a;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all 0.15s;box-shadow:0 2px 6px rgba(244,174,207,0.4);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 10px rgba(244,174,207,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 6px rgba(244,174,207,0.4)'">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v13M7 11l5 5 5-5" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Download</span>
    </button>
  </div>
</div>
</div>

    <!-- ROW 3: VISUALISASI SEMUA (6 panel) -->
    <div style="margin-bottom:4px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-weight:700;font-size:12px;">Visualisasi</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px;">
        ${buildSummaryNumViz()}
        ${buildSummaryCatViz()}
        ${buildSummaryBivViz()}
        ${buildSummaryCatNumViz()}
        ${buildSummaryMultiViz()}
        ${buildSummaryTSViz()}
      </div>
    </div>
  `;

  setTimeout(() => { renderSummaryCharts(); }, 120);
  updateBackToSummaryBtn();
}

// ===== HELPER: BUILD PREVIEW TABLE =====
function buildPreviewTable(n) {
  const rows = rawData.slice(0, n);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:9px;">
    <thead><tr style="background:var(--sidebar-bg);">
      <th style="color:var(--card-yellow);padding:3px 4px;font-size:8px;text-transform:uppercase;white-space:nowrap;">#</th>
      ${headers.map(h => `<th style="color:var(--card-yellow);padding:3px 4px;font-size:8px;text-transform:uppercase;white-space:nowrap;">${h}</th>`).join("")}
    </tr></thead><tbody>`;
  rows.forEach((row, i) => {
    html += `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:2px 4px;color:var(--text-muted);">${i + 1}</td>
      ${headers.map(h => {
        const v = row[h];
        const empty = v === "" || v === null || v === undefined;
        return `<td style="padding:2px 4px;white-space:nowrap;${empty ? "color:var(--danger);font-style:italic;" : ""}">${empty ? "null" : v}</td>`;
      }).join("")}
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

// ===== HELPER: BUILD CLEANING ISSUES =====
function buildCleaningIssues() {
  let totalMissing = 0;
  headers.forEach(h => { totalMissing += rawData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length; });
  const seen = new Set(); let dupCount = 0;
  rawData.forEach(row => { const k = JSON.stringify(row); if (seen.has(k)) dupCount++; else seen.add(k); });
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  let outlierCount = 0;
  numCols.forEach(col => {
    const vals = rawData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    outlierCount += countOutliers(vals);
  });
  const { score: dqScore } = computeDatasetQuality(rawData, headers, colTypes);
  const dqColor = dqScore >= 80 ? "#1a7a2a" : dqScore >= 60 ? "#b8660a" : "#c0392b";
  const dqLabel = dqScore >= 80 ? "Good" : dqScore >= 60 ? "Fair" : "Poor";
  const catCols = headers.filter(h => colTypes[h] === "categorical").filter(col => {
    const vals = cleanData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    return u >= 2 && u <= 30 && (u / vals.length) < 0.85;
  });
  const dtCols = headers.filter(h => colTypes[h] === "datetime");

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
      <div style="padding:5px 6px;background:#e8f4ff;border:1px solid #a8cdef;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Baris</div>
        <div style="font-size:15px;font-weight:700;color:#1a5276;line-height:1.2;">${rawData.length.toLocaleString()}</div>
        <div style="font-size:7px;color:#888;">records</div>
      </div>
      <div style="padding:5px 6px;background:#f0fff4;border:1px solid #b8d96e;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Kolom</div>
        <div style="font-size:15px;font-weight:700;color:#1a7a2a;line-height:1.2;">${headers.length}</div>
        <div style="font-size:7px;color:#888;">${numCols.length}N·${catCols.length}K·${dtCols.length}DT</div>
      </div>
      <div style="padding:5px 6px;background:#f0fff4;border:1px solid #b8d96e;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Kualitas</div>
        <div style="font-size:15px;font-weight:700;color:${dqColor};line-height:1.2;">${dqScore}%</div>
        <div style="font-size:7px;color:${dqColor};font-weight:700;">${dqLabel}</div>
      </div>
      <div style="padding:5px 6px;background:#fff0f0;border:1px solid #f4aecf;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Missing</div>
        <div style="font-size:15px;font-weight:700;color:${totalMissing>0?'#c0392b':'#1a7a2a'};line-height:1.2;">${totalMissing}</div>
        <div style="font-size:7px;color:#888;">${((totalMissing/Math.max(1,rawData.length*headers.length))*100).toFixed(1)}%</div>
      </div>
      <div style="padding:5px 6px;background:#fff8e8;border:1px solid #f5e642;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Duplikat</div>
        <div style="font-size:15px;font-weight:700;color:${dupCount>0?'#b8660a':'#1a7a2a'};line-height:1.2;">${dupCount}</div>
        <div style="font-size:7px;color:#888;">${((dupCount/Math.max(1,rawData.length))*100).toFixed(1)}%</div>
      </div>
      <div style="padding:5px 6px;background:#f0f6ff;border:1px solid #a8cdef;border-radius:8px;text-align:center;">
        <div style="font-size:7.5px;color:#888;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;">Outlier</div>
        <div style="font-size:15px;font-weight:700;color:${outlierCount>0?'#b8660a':'#1a7a2a'};line-height:1.2;">${outlierCount}</div>
        <div style="font-size:7px;color:#888;">${numCols.length} num col</div>
      </div>
    </div>`;
}

// ===== HELPER: BUILD NUM STAT ROWS =====
function buildNumStatRows() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  if (!numCols.length) return `<tr><td colspan="6" style="padding:6px;text-align:center;color:var(--text-muted);">Tidak ada kolom numerik</td></tr>`;
  return numCols.map(col => {
    const vals = rawData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return "";
    const s = calcNumStats(vals);
    const outliers = countOutliers(vals);
    const missing = rawData.filter(r => r[col] === "" || r[col] === null || r[col] === undefined).length;
    const isNormal = Math.abs(s.skewness) < 0.5 && Math.abs(s.kurtosis) < 1;
    const normLabel = isNormal ? "Normal" : "Tidak Normal";
    const normColor = isNormal ? "#2a7a2a" : "#c0392b";
    const normBg = isNormal ? "#e8f8e8" : "#fde8e8";
    return `<tr style="border-bottom:1px solid #dde8f4;">
      <td style="padding:2px 5px;font-weight:600;white-space:nowrap;">${col}</td>
      <td style="padding:2px 5px;text-align:center;">${fmt(s.mean)}</td>
      <td style="padding:2px 5px;text-align:center;">${fmt(s.std)}</td>
      <td style="padding:2px 5px;text-align:center;color:${missing>0?'#c0392b':'#2a7a2a'};font-weight:600;">${missing}</td>
      <td style="padding:2px 5px;text-align:center;color:${outliers>0?'#f5a623':'#2a7a2a'};font-weight:600;">${outliers}</td>
      <td style="padding:2px 5px;text-align:center;">
        <span style="font-size:8px;font-weight:700;color:${normColor};background:${normBg};padding:1px 5px;border-radius:8px;white-space:nowrap;">${normLabel}</span>
      </td>
    </tr>`;
  }).join("");
}

// ===== HELPER: BUILD CAT STAT ROWS =====
function buildCatStatRows() {
  const catCols = headers.filter(h => colTypes[h] === "categorical").filter(col => {
    const vals = rawData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const u = new Set(vals).size;
    return u >= 2 && (u / vals.length) < 0.85;
  });
  if (!catCols.length) return `<tr><td colspan="5" style="padding:6px;text-align:center;color:var(--text-muted);">Tidak ada kolom kategorik</td></tr>`;
  return catCols.map(col => {
    const vals = rawData.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const mode = sorted[0]?.[0] || "-";
    const modeFreq = sorted[0]?.[1] || 0;
    const modePct = vals.length ? ((modeFreq / vals.length) * 100).toFixed(1) : "0";
    const missing = rawData.length - vals.length;
    const unique = Object.keys(freq).length;
    return `<tr style="border-bottom:1px solid #dde8f4;">
      <td style="padding:2px 5px;font-weight:600;white-space:nowrap;">${col}</td>
      <td style="padding:2px 5px;text-align:center;">${unique}</td>
      <td style="padding:2px 5px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60px;">${mode}</td>
      <td style="padding:2px 5px;text-align:center;">${modePct}%</td>
      <td style="padding:2px 5px;text-align:center;color:${missing>0?'#c0392b':'#2a7a2a'};font-weight:600;">${missing}</td>
    </tr>`;
  }).join("");
}

// ===== HELPER: BUILD SUMMARY INSIGHTS =====
function buildSummaryInsights() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  const statsArr = numCols.map(col => {
    const vals = rawData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return null;
    const s = calcNumStats(vals);
    return { col, skewness: s.skewness, outliers: countOutliers(vals), mean: s.mean, std: s.std };
  }).filter(Boolean);

  const rows = [];

  // Outlier: 3 variabel tertinggi
  const outlierSorted = statsArr.filter(s => s.outliers > 0).sort((a, b) => b.outliers - a.outliers).slice(0, 3);
  if (outlierSorted.length > 0) {
    rows.push({
      text: `Outlier terbanyak: <strong>${outlierSorted.map(s => `${s.col}(${s.outliers})`).join(", ")}</strong>`,
      color: "#f5e642"
    });
  }

  // Right skewed
  const rightSkewed = statsArr.filter(s => s.skewness > 0.5).sort((a, b) => b.skewness - a.skewness);
  if (rightSkewed.length > 0) {
    rows.push({
      text: `Right skewed: <strong>${rightSkewed.slice(0,3).map(s => s.col).join(", ")}</strong>`,
      color: "#f4aecf"
    });
  }

  // Left skewed
  const leftSkewed = statsArr.filter(s => s.skewness < -0.5).sort((a, b) => a.skewness - b.skewness);
  if (leftSkewed.length > 0) {
    rows.push({
      text: `Left skewed: <strong>${leftSkewed.slice(0,3).map(s => s.col).join(", ")}</strong>`,
      color: "#a8cdef"
    });
  }

  // Paling normal
  const normalArr = statsArr.filter(s => Math.abs(s.skewness) < 0.5).sort((a, b) => Math.abs(a.skewness) - Math.abs(b.skewness));
  if (normalArr.length > 0) {
    rows.push({
      text: `Distribusi normal: <strong>${normalArr.slice(0,2).map(s => s.col).join(", ")}</strong>`,
      color: "#b8d96e"
    });
  }

  // Korelasi terkuat
  if (numCols.length >= 2) {
    let maxR = 0, bestC1 = "", bestC2 = "";
    for (let i = 0; i < Math.min(numCols.length, 6); i++) {
      for (let j = i + 1; j < Math.min(numCols.length, 6); j++) {
        const r = Math.abs(calcCorr(rawData, numCols[i], numCols[j]));
        if (r > maxR) { maxR = r; bestC1 = numCols[i]; bestC2 = numCols[j]; }
      }
    }
    if (maxR > 0) {
      rows.push({
        text: `Korelasi terkuat: <strong>${bestC1}</strong> vs <strong>${bestC2}</strong> (r=${maxR.toFixed(2)})`,
        color: "#f4c4a0"
      });
    }
  }

  if (!rows.length) return `<div style="color:var(--text-muted);font-size:10px;padding:4px 0;">Tidak ada insight terdeteksi.</div>`;

  return rows.map(ins => `
    <div style="padding:5px 8px;background:${ins.color}33;border-left:3px solid ${ins.color};border-radius:5px;font-size:10px;line-height:1.5;">
      ${ins.text}
    </div>
  `).join("");
}

// ===== HELPER: BUILD REKOMENDASI =====
function buildSummaryRekomendasi() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  const statsArr = numCols.map(col => {
    const vals = rawData.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return null;
    const s = calcNumStats(vals);
    return { col, skewness: s.skewness, outliers: countOutliers(vals) };
  }).filter(Boolean);

  const rekos = [];
  const skewedVars = statsArr.filter(s => Math.abs(s.skewness) >= 0.5);
  if (skewedVars.length) {
    rekos.push({ text: `Transformasi log/sqrt pada <strong>${skewedVars.slice(0,3).map(s => s.col).join(", ")}</strong> sebelum modeling.`, color: "#f4aecf" });
  }
  const outlierVars = statsArr.filter(s => s.outliers > 0);
  if (outlierVars.length) {
    rekos.push({ text: `Tangani outlier pada <strong>${outlierVars.slice(0,3).map(s => s.col).join(", ")}</strong> dengan winsorizing.`, color: "#f5e642" });
  }
  let totalMissing = 0;
  headers.forEach(h => { totalMissing += rawData.filter(r => r[h] === "" || r[h] === null || r[h] === undefined).length; });
  if (totalMissing > 0) {
    rekos.push({ text: `Selesaikan <strong>${totalMissing} missing values</strong> di halaman Data Cleaning.`, color: "#a8cdef" });
  } else if (rekos.length < 3) {
    rekos.push({ text: `Dataset bersih dari missing. Lanjut ke <strong>Statistik</strong> atau <strong>Visualisasi</strong>.`, color: "#b8d96e" });
  }

  if (!rekos.length) return `<div style="color:var(--text-muted);font-size:10px;padding:4px 0;">Tidak ada rekomendasi khusus.</div>`;
  return rekos.map(r => `
    <div style="padding:5px 8px;background:${r.color}33;border-left:3px solid ${r.color};border-radius:5px;font-size:10px;line-height:1.5;">
      ${r.text}
    </div>
  `).join("");
}

// ===== VIZ BUILDERS =====
function buildVizSectionHeader(title, color) {
  return `<div style="font-size:8.5px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;padding-bottom:3px;border-bottom:1.5px solid ${color}33;">${title}</div>`;
}

function buildSummaryNumViz() {
  const col = autoPickNumCol();
  if (!col) return `
    <div style="background:#f0f8ff;border:1.5px solid #a8cdef;border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:160px;gap:8px;text-align:center;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a8cdef" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      <div style="font-size:8.5px;font-weight:700;color:#1a5276;text-transform:uppercase;letter-spacing:0.5px;">Numerical</div>
      <div style="font-size:10px;color:#888;">Dataset tidak memiliki<br>kolom numerik</div>
    </div>`;
  return `
    <div style="background:#f8fbff;border:1.5px solid #a8cdef;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#1a5276;text-transform:uppercase;letter-spacing:0.5px;">Numerical</div>
        <button onclick="showPage('viz');setTimeout(()=>{switchVizTab('numerical-viz');document.getElementById('num-col-select').value='${col}';renderNumericalViz();},150)" style="padding:1px 5px;background:#1a5276;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${col}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #dde8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Histogram</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-hist" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #dde8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Boxplot</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-box" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #dde8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Density</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-density" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #dde8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">QQ Plot</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-qq" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
      </div>
    </div>`;
}

function buildSummaryCatViz() {
  const col = autoPickCatCol();
  if (!col) return `
    <div style="background:#fff8fb;border:1.5px solid #f4aecf;border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:160px;gap:8px;text-align:center;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f4aecf" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
      <div style="font-size:8.5px;font-weight:700;color:#b84280;text-transform:uppercase;letter-spacing:0.5px;">Categorical</div>
      <div style="font-size:10px;color:#888;">Dataset tidak memiliki<br>kolom kategorik</div>
    </div>`;
  return `
    <div style="background:#fff8fb;border:1.5px solid #f4aecf;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#b84280;text-transform:uppercase;letter-spacing:0.5px;">Categorical</div>
        <button onclick="showPage('viz');setTimeout(()=>{switchVizTab('categorical-viz');document.getElementById('cat-col-select').value='${col}';renderCategoricalViz();},150)" style="padding:1px 5px;background:#b84280;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${col}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #f4d0e8;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Pie</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-pie" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #f4d0e8;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Pareto</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-pareto" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #f4d0e8;display:flex;flex-direction:column;min-height:0;grid-column:1/-1;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Count</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-count" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
      </div>
    </div>`;
}

function buildSummaryBivViz() {
  const pair = autoPickNumPair();
  if (!pair) return `<div style="background:#f8f8f8;border:1px dashed #ccc;border-radius:10px;padding:8px;text-align:center;color:var(--text-muted);font-size:9px;display:flex;align-items:center;justify-content:center;min-height:160px;">Perlu ≥2 kolom numerik</div>`;
  const [cx, cy] = pair;
  return `
    <div style="background:#f0fff4;border:1.5px solid #b8d96e;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#1a7a2a;text-transform:uppercase;letter-spacing:0.5px;">Num vs Num</div>
        <button onclick="showPage('viz');setTimeout(()=>{switchVizTab('bivariate-viz');document.getElementById('biv-x').value='${cx}';document.getElementById('biv-y').value='${cy}';renderBivariateViz();},150)" style="padding:1px 5px;background:#1a7a2a;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cx} vs ${cy}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #d0eecc;display:flex;flex-direction:column;min-height:0;grid-column:1/-1;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Scatter + Regression</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-scatter" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #d0eecc;display:flex;flex-direction:column;min-height:0;grid-column:1/-1;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Bubble Chart</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-bubble" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
      </div>
    </div>`;
}

function buildSummaryCatNumViz() {
  const pair = autoPickCatNumPair();
  if (!pair) return `<div style="background:#f8f8f8;border:1px dashed #ccc;border-radius:10px;padding:8px;text-align:center;color:var(--text-muted);font-size:9px;display:flex;align-items:center;justify-content:center;min-height:160px;">Perlu kolom kat & num</div>`;
  const [cat, num] = pair;
  return `
    <div style="background:#fff8f0;border:1.5px solid #f4c4a0;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#c05a00;text-transform:uppercase;letter-spacing:0.5px;">Kat vs Num</div>
        <button onclick="showPage('viz');setTimeout(()=>{switchVizTab('catnum-viz');document.getElementById('cn-cat').value='${cat}';document.getElementById('cn-num').value='${num}';renderCatNumViz();},150)" style="padding:1px 5px;background:#c05a00;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cat} vs ${num}</div>
      <div style="display:grid;grid-template-columns:1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #f4d8b8;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Strip Plot</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-catstrip" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #f4d8b8;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Violin</div>
          <div id="sum-catviolin" style="height:52px;overflow:hidden;position:relative;"></div>
        </div>
      </div>
    </div>`;
}

function buildSummaryMultiViz() {
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));
  if (numCols.length < 2) {
    return `<div style="background:#f8f8f8;border:1px dashed #ccc;border-radius:10px;padding:8px;text-align:center;color:var(--text-muted);font-size:9px;display:flex;align-items:center;justify-content:center;min-height:160px;">Perlu ≥2 kolom numerik</div>`;
  }
  return `
    <div style="background:#f5f0ff;border:1.5px solid #c4a0f4;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#5a2ab8;text-transform:uppercase;letter-spacing:0.5px;">Multivariat</div>
        <button onclick="showPage('viz');setTimeout(()=>{switchVizTab('multivariate-viz');renderMultivariateViz();},200)" style="padding:1px 5px;background:#5a2ab8;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;">${numCols.length} variabel numerik</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #d8c8f4;display:flex;flex-direction:column;min-height:0;grid-column:1/-1;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Correlation Heatmap</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-mv-heatmap" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #d8c8f4;display:flex;flex-direction:column;min-height:0;grid-column:1/-1;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Pair Plot Matrix</div>
          <div id="sum-mv-pair" style="height:52px;overflow:hidden;"></div>
        </div>
      </div>
    </div>`;
}

function buildSummaryTSViz() {
  const dtCols = headers.filter(h => colTypes[h] === "datetime");
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const numCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));

  if (!dtCols.length) {
    return `<div style="background:#f0f8ff;border:1.5px solid #7ab8e8;border-radius:10px;padding:8px;text-align:center;color:#aaa;font-size:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:160px;gap:5px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="#ccc" stroke-width="1.5"/><line x1="3" y1="9" x2="21" y2="9" stroke="#ccc" stroke-width="1.5"/><line x1="8" y1="2" x2="8" y2="6" stroke="#ccc" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="2" x2="16" y2="6" stroke="#ccc" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span style="font-size:8.5px;font-weight:600;color:#1a4a7a;">Time Series</span>
      <span>Tidak ada kolom datetime</span>
    </div>`;
  }

  const dateCol = dtCols[0];
  const valCol = numCols[0] || "";
  return `
    <div style="background:#f0f8ff;border:1.5px solid #7ab8e8;border-radius:10px;padding:7px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:8.5px;font-weight:700;color:#1a4a7a;text-transform:uppercase;letter-spacing:0.5px;">Time Series</div>
        <button onclick="showPage('timeseries');setTimeout(()=>{document.getElementById('ts-date-col').value='${dateCol}';document.getElementById('ts-value-col').value='${valCol}';renderTimeSeries();},200)" style="padding:1px 5px;background:#1a4a7a;color:#fff;border:none;border-radius:4px;font-size:7.5px;font-weight:600;cursor:pointer;">Semua →</button>
      </div>
      <div style="font-size:7.5px;color:#666;text-align:center;margin-bottom:3px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dateCol} · ${valCol}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px;flex:1;">
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #b8d8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Line Chart</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-ts-line" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #b8d8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Moving Average (7)</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-ts-ma" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #b8d8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Rolling Mean (30)</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-ts-roll" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
        <div style="background:#fff;border-radius:4px;padding:2px;border:1px solid #b8d8f4;display:flex;flex-direction:column;min-height:0;">
          <div style="font-size:6.5px;color:#aaa;text-align:center;">Trend Line</div>
          <div style="flex:1;min-height:0;position:relative;"><canvas id="sum-ts-trend" style="width:100%!important;height:100%!important;max-height:52px;"></canvas></div>
        </div>
      </div>
    </div>`;
}

// ===== RENDER ALL SUMMARY CHARTS =====
function renderSummaryCharts() {

  function setSummaryCanvasSize(id, w, h) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const parentW = canvas.parentElement ? (canvas.parentElement.offsetWidth || w) : w;
    canvas.width = parentW;
    canvas.height = h;
    canvas.style.width = "100%";
    canvas.style.height = h + "px";
  }
  const CANVAS_IDS = [
    "sum-hist","sum-box","sum-density","sum-qq",
    "sum-bar","sum-pie","sum-count","sum-pareto",
    "sum-scatter","sum-bubble",
    "sum-catbox","sum-catbar","sum-catstrip",
    "sum-mv-heatmap",
    "sum-ts-line","sum-ts-ma","sum-ts-roll","sum-ts-trend"
  ];
  CANVAS_IDS.forEach(id => setSummaryCanvasSize(id, 120, 50));
  
  const MINI_OPTS = {
    responsive: true,
    animation: false,
    plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false, grid: { display: false } },
      y: { display: false, grid: { display: false } }
    }
  };

  const numCol = autoPickNumCol();
  const bivPair = autoPickNumPair();
  const catNumPair = autoPickCatNumPair();
  const dtColsTS = headers.filter(h => colTypes[h] === "datetime");
  const exclude = /^id$|^ID$|_id$|^no$|^No$|^index$|^idx$|^kode$/i;
  const allNumCols = headers.filter(h => colTypes[h] === "numeric" && !exclude.test(h));

  // ── NUMERICAL ─────────────────────────────────────────────
  if (numCol) {
    const vals = rawData.map(r => parseFloat(r[numCol])).filter(v => !isNaN(v));

    if (document.getElementById("sum-hist")) {
      const bins = makeBins(vals, 10);
      destroyChart("sum-hist");
      chartInstances["sum-hist"] = new Chart(document.getElementById("sum-hist"), {
        type: "bar",
        data: { datasets: [{ data: bins.centers.map((c, i) => ({ x: c, y: bins.counts[i] })), backgroundColor: "rgba(245,230,66,0.75)", borderColor: "#d4c800", borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0 }] },
        options: { ...MINI_OPTS, scales: { x: { type: "linear", display: false }, y: { display: false } } }
      });
    }

    if (document.getElementById("sum-box")) {
      const s = [...vals].sort((a, b) => a - b);
      const bq1 = s[Math.floor(s.length * 0.25)];
      const bq3 = s[Math.floor(s.length * 0.75)];
      const biqr = bq3 - bq1;
      const bWLow = Math.min(...s.filter(v => v >= bq1 - 1.5 * biqr));
      const bWHigh = Math.max(...s.filter(v => v <= bq3 + 1.5 * biqr));
      const bMed = s[Math.floor(s.length * 0.5)];
      const bOut = s.filter(v => v < bWLow || v > bWHigh);
      destroyChart("sum-box");
      chartInstances["sum-box"] = new Chart(document.getElementById("sum-box"), {
        type: "boxplot",
        data: { labels: [numCol], datasets: [{ data: [{ min: bWLow, q1: bq1, median: bMed, q3: bq3, max: bWHigh, outliers: bOut }], backgroundColor: "rgba(184,217,110,0.5)", borderColor: "#7aaa2a", borderWidth: 1.5, outlierBackgroundColor: "#e85d5d", outlierRadius: 2, medianColor: "#e85d5d", itemRadius: 0 }] },
        options: { ...MINI_OPTS, indexAxis: "y" }
      });
    }

    if (document.getElementById("sum-density")) {
      const density = makeDensity(vals, 40);
      destroyChart("sum-density");
      chartInstances["sum-density"] = new Chart(document.getElementById("sum-density"), {
        type: "line",
        data: { labels: density.xs.map(x => x.toFixed(1)), datasets: [{ data: density.ys, borderColor: "#f4aecf", backgroundColor: "rgba(244,174,207,0.25)", fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }] },
        options: MINI_OPTS
      });
    }

    if (document.getElementById("sum-qq")) {
      const qqData = makeQQ(vals);
      destroyChart("sum-qq");
      chartInstances["sum-qq"] = new Chart(document.getElementById("sum-qq"), {
        type: "scatter",
        data: { datasets: [{ data: qqData.points, backgroundColor: "rgba(168,205,239,0.7)", pointRadius: 1.5 }, { data: qqData.refLine, type: "line", borderColor: "#e85d5d", borderWidth: 1.5, pointRadius: 0, backgroundColor: "transparent", borderDash: [4, 3] }] },
        options: { ...MINI_OPTS, scales: { x: { display: false }, y: { display: false } } }
      });
    }
  }

  // ── CATEGORICAL ──────────────────────────────────────────────
  const catCol = autoPickCatCol();
  if (catCol) {
    const vals = rawData.map(r => r[catCol]).filter(v => v !== "" && v !== null && v !== undefined);
    const freq = {};
    vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([k]) => k);
    const data = sorted.map(([, v]) => v);
    const top5Labels = labels.slice(0, 5);
    const top5Data = data.slice(0, 5);

    // Pie/Doughnut chart
    const pieCanvasEl = document.getElementById("sum-pie");
    if (pieCanvasEl) {
      requestAnimationFrame(() => {
        destroyChart("sum-pie");
        const pw = pieCanvasEl.parentElement ? (pieCanvasEl.parentElement.offsetWidth || 100) : 100;
        pieCanvasEl.width = pw;
        pieCanvasEl.height = 52;
        pieCanvasEl.style.width = "100%";
        pieCanvasEl.style.height = "52px";
        chartInstances["sum-pie"] = new Chart(pieCanvasEl, {
          type: "doughnut",
          data: { labels: labels.slice(0, 5), datasets: [{ data: data.slice(0, 5), backgroundColor: CHART_COLORS.slice(0, 5), borderWidth: 1, borderColor: "#fff" }] },
          options: { ...MINI_OPTS, cutout: "40%" }
        });
      });
    }

    // Count chart (vertikal, batang ke atas)
    const countCanvasEl = document.getElementById("sum-count");
    if (countCanvasEl) {
      requestAnimationFrame(() => {
        destroyChart("sum-count");
        const pw = countCanvasEl.parentElement ? (countCanvasEl.parentElement.offsetWidth || 100) : 100;
        countCanvasEl.width = pw;
        countCanvasEl.height = 52;
        countCanvasEl.style.width = "100%";
        countCanvasEl.style.height = "52px";
        chartInstances["sum-count"] = new Chart(countCanvasEl, {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.slice(0, labels.length), borderColor: CHART_COLORS.slice(0, labels.length), borderWidth: 1, borderRadius: 2 }] },
          options: { ...MINI_OPTS, indexAxis: "x" }
        });
      });
    }

    // Pareto chart
    const paretoCanvasEl = document.getElementById("sum-pareto");
    if (paretoCanvasEl) {
      requestAnimationFrame(() => {
        const cumulative = [];
        let cum = 0;
        data.forEach(d => { cum += d; cumulative.push(((cum / vals.length) * 100).toFixed(1)); });
        destroyChart("sum-pareto");
        const pw = paretoCanvasEl.parentElement ? (paretoCanvasEl.parentElement.offsetWidth || 100) : 100;
        paretoCanvasEl.width = pw;
        paretoCanvasEl.height = 52;
        paretoCanvasEl.style.width = "100%";
        paretoCanvasEl.style.height = "52px";
        chartInstances["sum-pareto"] = new Chart(paretoCanvasEl, {
          type: "bar",
          data: {
            labels,
            datasets: [
              { type: "bar", data, backgroundColor: CHART_COLORS.slice(0, labels.length), borderWidth: 0, borderRadius: 2, yAxisID: "y" },
              { type: "line", data: cumulative, borderColor: "#1A1A1A", borderWidth: 1.5, pointRadius: 0, backgroundColor: "transparent", yAxisID: "y1", tension: 0.1 }
            ]
          },
          options: { ...MINI_OPTS, scales: { x: { display: false }, y: { display: false }, y1: { display: false, max: 100 } } }
        });
      });
    }
  }

  // ── BIVARIATE ────────────────────────────────────────────
  if (bivPair) {
    const [cx, cy] = bivPair;
    const points = rawData.map(r => ({ x: parseFloat(r[cx]), y: parseFloat(r[cy]) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
    const sample = points.length > 150 ? points.sort(() => Math.random() - 0.5).slice(0, 150) : points;

    // Scatter + regression
    if (document.getElementById("sum-scatter") && sample.length >= 2) {
      const n = sample.length;
      const mx = sample.reduce((a, b) => a + b.x, 0) / n;
      const my = sample.reduce((a, b) => a + b.y, 0) / n;
      const slope = sample.reduce((a, b) => a + (b.x - mx) * (b.y - my), 0) / sample.reduce((a, b) => a + (b.x - mx) ** 2, 0);
      const intercept = my - slope * mx;
      const minX = Math.min(...sample.map(p => p.x));
      const maxX = Math.max(...sample.map(p => p.x));
      destroyChart("sum-scatter");
      chartInstances["sum-scatter"] = new Chart(document.getElementById("sum-scatter"), {
        type: "scatter",
        data: { datasets: [
          { data: sample, backgroundColor: "rgba(168,205,239,0.55)", pointRadius: 1.5 },
          { data: [{ x: minX, y: intercept + slope * minX }, { x: maxX, y: intercept + slope * maxX }], type: "line", borderColor: "#E85D5D", borderWidth: 1.5, pointRadius: 0, backgroundColor: "transparent" }
        ]},
        options: { ...MINI_OPTS, scales: { x: { display: false }, y: { display: false } } }
      });
    }

    // Bubble chart
    if (document.getElementById("sum-bubble") && sample.length >= 2) {
      const bubbleSample = sample.slice(0, 60);
      const maxVal = Math.max(...bubbleSample.map(p => Math.abs(p.x)));
      const bubbleData = bubbleSample.map(p => ({
        x: p.x, y: p.y,
        r: Math.min(Math.max(Math.abs(p.x) / (maxVal / 8 || 1), 2), 8)
      }));
      destroyChart("sum-bubble");
      chartInstances["sum-bubble"] = new Chart(document.getElementById("sum-bubble"), {
        type: "bubble",
        data: { datasets: [{
          data: bubbleData,
          backgroundColor: "rgba(244,174,207,0.5)",
          borderColor: "#F4AECF",
          borderWidth: 1,
        }]},
        options: { ...MINI_OPTS, scales: { x: { display: false }, y: { display: false } } }
      });
    }
  }

  // ── CAT vs NUM ────────────────────────────────────────────
  if (catNumPair) {
    const [cat, num] = catNumPair;
    const freqCN = {};
    rawData.forEach(r => {
      const k = r[cat]; const v = parseFloat(r[num]);
      if (k === undefined || k === "" || isNaN(v)) return;
      if (!freqCN[k]) freqCN[k] = [];
      freqCN[k].push(v);
    });
    const catKeys = Object.keys(freqCN).filter(k => freqCN[k].length > 0).slice(0, 8);

    if (catKeys.length > 0) {
      // Boxplot
      const catboxEl = document.getElementById("sum-catbox");
      if (catboxEl) {
        requestAnimationFrame(() => {
          destroyChart("sum-catbox");
          const pw = catboxEl.parentElement ? (catboxEl.parentElement.offsetWidth || 100) : 100;
          catboxEl.width = pw;
          catboxEl.height = 52;
          catboxEl.style.width = "100%";
          catboxEl.style.height = "52px";
          chartInstances["sum-catbox"] = new Chart(catboxEl, {
            type: "boxplot",
            data: {
              labels: catKeys,
              datasets: [{
                data: catKeys.map(k => {
                  const s = [...freqCN[k]].sort((a, b) => a - b);
                  if (s.length < 2) return { min: s[0], q1: s[0], median: s[0], q3: s[0], max: s[0], outliers: [] };
                  const q1 = s[Math.floor(s.length * 0.25)];
                  const q3 = s[Math.floor(s.length * 0.75)];
                  const iqr = q3 - q1;
                  const wLow = Math.min(...s.filter(v => v >= q1 - 1.5 * iqr));
                  const wHigh = Math.max(...s.filter(v => v <= q3 + 1.5 * iqr));
                  const med = s[Math.floor(s.length * 0.5)];
                  return { min: wLow, q1, median: med, q3, max: wHigh, outliers: s.filter(v => v < wLow || v > wHigh) };
                }),
                backgroundColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + "88"),
                borderColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                borderWidth: 1.5, outlierBackgroundColor: "#e85d5d", outlierRadius: 2, itemRadius: 0,
              }]
            },
            options: { ...MINI_OPTS, indexAxis: catKeys.length > 4 ? "y" : "x" }
          });
        });
      }

      // Bar avg
      const catbarEl = document.getElementById("sum-catbar");
      if (catbarEl) {
        requestAnimationFrame(() => {
          const means = catKeys.map(k => freqCN[k].reduce((a, b) => a + b, 0) / freqCN[k].length);
          destroyChart("sum-catbar");
          const pw = catbarEl.parentElement ? (catbarEl.parentElement.offsetWidth || 100) : 100;
          catbarEl.width = pw;
          catbarEl.height = 52;
          catbarEl.style.width = "100%";
          catbarEl.style.height = "52px";
          chartInstances["sum-catbar"] = new Chart(catbarEl, {
            type: "bar",
            data: { labels: catKeys, datasets: [{ data: means, backgroundColor: catKeys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + "99"), borderRadius: 2 }] },
            options: { ...MINI_OPTS, indexAxis: catKeys.length > 4 ? "y" : "x" }
          });
        });
      }

      // Strip plot
      const catstripEl = document.getElementById("sum-catstrip");
      if (catstripEl) {
        requestAnimationFrame(() => {
          const stripDatasets = catKeys.map((k, i) => ({
            label: k,
            data: freqCN[k].slice(0, 60).map(v => ({ x: k, y: v })),
            backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "88",
            pointRadius: 2,
            showLine: false,
          }));
          destroyChart("sum-catstrip");
          const pw = catstripEl.parentElement ? (catstripEl.parentElement.offsetWidth || 100) : 100;
          catstripEl.width = pw;
          catstripEl.height = 52;
          catstripEl.style.width = "100%";
          catstripEl.style.height = "52px";
          chartInstances["sum-catstrip"] = new Chart(catstripEl, {
            type: "scatter",
            data: { datasets: stripDatasets },
            options: {
              ...MINI_OPTS,
              scales: {
                x: { type: "category", labels: catKeys, display: false },
                y: { display: false }
              }
            }
          });
        });
      }

      // Violin
      const violinContainer = document.getElementById("sum-catviolin");
      if (violinContainer) {
        requestAnimationFrame(() => {
          violinContainer.innerHTML = `<canvas id="sum-catviolin-canvas" style="width:100%;height:52px;display:block;"></canvas>`;
          const vCanvas = document.getElementById("sum-catviolin-canvas");
          if (vCanvas) {
            const vW = violinContainer.offsetWidth || 100;
            const vH = 52;
            vCanvas.width = vW;
            vCanvas.height = vH;
            const vCtx = vCanvas.getContext("2d");
            const nCats = catKeys.length;
            const colW = vW / nCats;
            const allFlat = catKeys.flatMap(k => freqCN[k]);
            const globalMin = Math.min(...allFlat);
            const globalMax = Math.max(...allFlat);
            catKeys.forEach((k, i) => {
              const vals = freqCN[k];
              if (!vals || vals.length < 2) return;
              const centre = i * colW + colW / 2;
              const maxHalf = colW * 0.38;
              const d = makeDensity(vals, 30);
              const maxDens = Math.max(...d.ys);
              const col = CHART_COLORS[i % CHART_COLORS.length];
              vCtx.beginPath();
              d.xs.forEach((x, j) => {
                const py = vH - ((x - globalMin) / (globalMax - globalMin || 1)) * vH;
                const half = (d.ys[j] / maxDens) * maxHalf;
                if (j === 0) vCtx.moveTo(centre - half, py);
                else vCtx.lineTo(centre - half, py);
              });
              for (let j = d.xs.length - 1; j >= 0; j--) {
                const py = vH - ((d.xs[j] - globalMin) / (globalMax - globalMin || 1)) * vH;
                const half = (d.ys[j] / maxDens) * maxHalf;
                vCtx.lineTo(centre + half, py);
              }
              vCtx.closePath();
              vCtx.fillStyle = col + "99";
              vCtx.fill();
              vCtx.strokeStyle = col;
              vCtx.lineWidth = 1;
              vCtx.stroke();
              const sorted = [...vals].sort((a, b) => a - b);
              const med = sorted[Math.floor(sorted.length * 0.5)];
              const medY = vH - ((med - globalMin) / (globalMax - globalMin || 1)) * vH;
              vCtx.beginPath();
              vCtx.arc(centre, medY, 2, 0, Math.PI * 2);
              vCtx.fillStyle = "#e85d5d";
              vCtx.fill();
            });
          }
        });
      }
    }
  }

  // ── MULTIVARIAT ───────────────────────────────────────────
  const mvCols = allNumCols.slice(0, 6);
  if (mvCols.length >= 2) {
    // Mini heatmap multivariat
    const mvCanvas = document.getElementById("sum-mv-heatmap");
    if (mvCanvas) {
      const mvCorrs = mvCols.map(c1 => mvCols.map(c2 => calcCorr(rawData, c1, c2)));
      const mvCtx = mvCanvas.getContext("2d");
      const n2 = mvCols.length;

      function drawMvHeatmap() {
        const pw = mvCanvas.parentElement.offsetWidth || 80;
        const cellSize = Math.max(Math.floor(pw / n2), 8);
        mvCanvas.width = cellSize * n2;
        mvCanvas.height = cellSize * n2;
        mvCanvas.style.width = "100%";
        mvCanvas.style.height = (cellSize * n2) + "px";
        mvCols.forEach((_, xi) => {
          mvCols.forEach((__, yi) => {
            const r = mvCorrs[yi][xi];
            const t = Math.max(-1, Math.min(1, r));
            let R, G, B;
            if (t >= 0) { R = Math.round(245 - t * 219); G = Math.round(245 - t * 163); B = Math.round(240 - t * 122); }
            else { const s2 = -t; R = Math.round(245 - s2 * 53); G = Math.round(245 - s2 * 188); B = Math.round(240 - s2 * 197); }
            mvCtx.fillStyle = `rgb(${R},${G},${B})`;
            mvCtx.fillRect(xi * cellSize, yi * cellSize, cellSize, cellSize);
            mvCtx.strokeStyle = "rgba(255,255,255,0.5)";
            mvCtx.lineWidth = 0.5;
            mvCtx.strokeRect(xi * cellSize, yi * cellSize, cellSize, cellSize);
            if (cellSize >= 12) {
              mvCtx.fillStyle = Math.abs(r) > 0.5 ? "#fff" : "#1a1a1a";
              mvCtx.font = `bold ${Math.min(cellSize / 3.5, 7)}px DM Sans`;
              mvCtx.textAlign = "center";
              mvCtx.textBaseline = "middle";
              mvCtx.fillText(r.toFixed(1), xi * cellSize + cellSize / 2, yi * cellSize + cellSize / 2);
            }
          });
        });
      }
      drawMvHeatmap();
      if (mvCanvas._resizeObserver) mvCanvas._resizeObserver.disconnect();
      mvCanvas._resizeObserver = new ResizeObserver(drawMvHeatmap);
      mvCanvas._resizeObserver.observe(mvCanvas.parentElement);
    }

    // Mini pair plot
    const pairContainer = document.getElementById("sum-mv-pair");
    if (pairContainer) {
      const pairCols = mvCols.slice(0, 4);
      const n = pairCols.length;
      const pairSample = rawData.length > 100 ? rawData.sort(() => Math.random() - 0.5).slice(0, 100) : rawData;
      let pairHtml = `<div style="display:grid;grid-template-columns:repeat(${n},1fr);gap:1px;height:58px;">`;
      pairCols.forEach((cy, row) => {
        pairCols.forEach((cx, col) => {
          const cid = `sum-mv-pair-${row}-${col}`;
          pairHtml += `<div style="position:relative;background:#fff;border-radius:2px;overflow:hidden;border:0.5px solid #e8e8e8;"><canvas id="${cid}" style="width:100%;height:100%;display:block;"></canvas></div>`;
        });
      });
      pairHtml += `</div>`;
      pairContainer.innerHTML = pairHtml;

      setTimeout(() => {
        pairCols.forEach((cy, row) => {
          pairCols.forEach((cx, col) => {
            const cid = `sum-mv-pair-${row}-${col}`;
            const canvas = document.getElementById(cid);
            if (!canvas) return;
            const actualW = canvas.parentElement.offsetWidth || 20;
            const actualH = canvas.parentElement.offsetHeight || 14;
            canvas.width = actualW;
            canvas.height = actualH;
            if (row === col) {
              const dVals = pairSample.map(r => parseFloat(r[cx])).filter(v => !isNaN(v));
              const density = makeDensity(dVals, 20);
              destroyChart(cid);
              chartInstances[cid] = new Chart(canvas, {
                type: "line",
                data: { labels: density.xs.map(x => x.toFixed(1)), datasets: [{ data: density.ys, borderColor: "#A8CDEF", backgroundColor: "rgba(168,205,239,0.3)", fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1 }] },
                options: { responsive: false, animation: false, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
              });
            } else {
              const pts = pairSample.map(r => ({ x: parseFloat(r[cx]), y: parseFloat(r[cy]) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
              const r = calcCorr(pairSample, cx, cy);
              const dotColor = r > 0.4 ? "rgba(100,180,100,0.6)" : r < -0.4 ? "rgba(220,80,80,0.6)" : "rgba(168,205,239,0.6)";
              destroyChart(cid);
              chartInstances[cid] = new Chart(canvas, {
                type: "scatter",
                data: { datasets: [{ data: pts, backgroundColor: dotColor, pointRadius: 1 }] },
                options: { responsive: false, animation: false, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
              });
            }
          });
        });
      }, 50);
    }
  }

  // ── TIME SERIES ───────────────────────────────────────────
  if (dtColsTS.length && allNumCols.length) {
    const dateCol = dtColsTS[0];
    const valCol = allNumCols[0];
    const tsRaw = rawData.map(r => ({ date: new Date(r[dateCol]), val: parseFloat(r[valCol]) }))
      .filter(d => !isNaN(d.date.getTime()) && !isNaN(d.val))
      .sort((a, b) => a.date - b.date);

    if (tsRaw.length >= 2) {
      // Agregasi per bulan
      const aggMap = new Map();
      tsRaw.forEach(({ date, val }) => {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!aggMap.has(key)) aggMap.set(key, { sum: 0, date });
        aggMap.get(key).sum += val;
      });
      const aggEntries = Array.from(aggMap.entries()).sort((a, b) => a[1].date - b[1].date);
      const labels = aggEntries.map(([k]) => {
        const [y, m] = k.split('-');
        return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
      });
      const values = aggEntries.map(([, v]) => v.sum);

      if (!values.length) return;

      const ma7 = values.map((_, i) => i < 6 ? null : values.slice(i - 6, i + 1).reduce((a, b) => a + b, 0) / 7);
      const roll30 = values.map((_, i) => { const sl = values.slice(Math.max(0, i - 29), i + 1); return sl.reduce((a, b) => a + b, 0) / sl.length; });
      const n = values.length;
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;
      const slope = values.reduce((acc, y, i) => acc + (i - xMean) * (y - yMean), 0) / values.reduce((acc, _, i) => acc + (i - xMean) ** 2, 0);
      const intercept = yMean - slope * xMean;
      const trendLine = values.map((_, i) => parseFloat((intercept + slope * i).toFixed(2)));

      const TS_MINI_OPTS = {
        responsive: false,
        animation: false,
        plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false, grid: { display: false } }, y: { display: false, grid: { display: false } } }
      };

      // Line Chart — kuning fill area, titik visible, lurus (tension:0)
      if (document.getElementById("sum-ts-line")) {
        destroyChart("sum-ts-line");
        chartInstances["sum-ts-line"] = new Chart(document.getElementById("sum-ts-line"), {
          type: "line",
          data: { labels, datasets: [{ data: values, borderColor: "#d4a800", backgroundColor: "rgba(245,230,66,0.25)", fill: true, tension: 0, pointRadius: values.length <= 24 ? 2 : 0, pointBackgroundColor: "#d4a800", borderWidth: 1.5 }] },
          options: TS_MINI_OPTS
        });
      }

      // MA(7) — garis abu tipis + garis pink tebal
      if (document.getElementById("sum-ts-ma")) {
        destroyChart("sum-ts-ma");
        chartInstances["sum-ts-ma"] = new Chart(document.getElementById("sum-ts-ma"), {
          type: "line",
          data: { labels, datasets: [
            { data: values, borderColor: "rgba(168,205,239,0.4)", fill: false, tension: 0, pointRadius: 0, borderWidth: 1 },
            { data: ma7, borderColor: "#e85d9a", fill: false, tension: 0, pointRadius: values.length <= 24 ? 2 : 0, pointBackgroundColor: "#e85d9a", borderWidth: 2 }
          ]},
          options: TS_MINI_OPTS
        });
      }

      // Rolling(30) — garis hijau muda tipis + garis hijau tua tebal
      if (document.getElementById("sum-ts-roll")) {
        destroyChart("sum-ts-roll");
        chartInstances["sum-ts-roll"] = new Chart(document.getElementById("sum-ts-roll"), {
          type: "line",
          data: { labels, datasets: [
            { data: values, borderColor: "rgba(184,217,110,0.4)", fill: false, tension: 0, pointRadius: 0, borderWidth: 1 },
            { data: roll30, borderColor: "#5a9e1a", fill: false, tension: 0, pointRadius: 0, borderWidth: 2 }
          ]},
          options: TS_MINI_OPTS
        });
      }

      // Trend Line
      if (document.getElementById("sum-ts-trend")) {
        destroyChart("sum-ts-trend");
        chartInstances["sum-ts-trend"] = new Chart(document.getElementById("sum-ts-trend"), {
          type: "line",
          data: { labels, datasets: [
            { data: values, borderColor: "rgba(168,205,239,0.5)", fill: false, tension: 0, pointRadius: 0, borderWidth: 1 },
            { data: trendLine, borderColor: "#E85D5D", fill: false, tension: 0, pointRadius: 0, borderWidth: 2, borderDash: [4, 3] }
          ]},
          options: TS_MINI_OPTS
        });
      }
    }
  }
}

// ===== EMAILJS CONFIG =====
const EJS_SERVICE_ID  = "service_k5swrds";   // ganti dengan Service ID dari EmailJS
const EJS_TEMPLATE_ID = "template_rxgvmu7";  // ganti dengan Template ID dari EmailJS

function sendProfileEmail(toEmail, namaAkun, pesanUtama) {
  const now = new Date().toLocaleString("id-ID", {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit"
  });
  return emailjs.send(EJS_SERVICE_ID, EJS_TEMPLATE_ID, {
    to_email:    toEmail,
    nama_akun:   namaAkun,
    pesan_utama: pesanUtama,
    tanggal:     now,
  });
}

// ===== SCROLL HINT (PETUNJUK SCROLL OTOMATIS) =====
// ===== SCROLL HINT =====
const SCROLL_HINT_KEY = "eda_scroll_hints_seen_v2";

function getSeenHints() {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_HINT_KEY) || "{}"); }
  catch { return {}; }
}
function markHintSeen(key) {
  try {
    const s = getSeenHints(); s[key] = true;
    sessionStorage.setItem(SCROLL_HINT_KEY, JSON.stringify(s));
  } catch {}
}
function clearAllHints() {
  try { sessionStorage.removeItem(SCROLL_HINT_KEY); } catch {}
  document.querySelectorAll(".scroll-hint").forEach(el => el.remove());
}

function removeExistingHint() {
  const old = document.getElementById("eda-scroll-hint");
  if (old) { old.remove(); }
}

function showScrollHint(type, hintKey) {
  // type: 'down' atau 'right'
  removeExistingHint();
  const seen = getSeenHints();
  if (seen[hintKey]) return;

  const hint = document.createElement("div");
  hint.id = "eda-scroll-hint";
  hint.className = "scroll-hint" + (type === "right" ? " horizontal" : "");

  if (type === "right") {
    hint.innerHTML = `Geser untuk lihat lebih <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
  } else {
    hint.innerHTML = `Scroll untuk lihat lebih banyak <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  document.body.appendChild(hint);

  const remove = () => {
    hint.classList.add("hide");
    markHintSeen(hintKey);
    setTimeout(() => hint.remove(), 420);
    window.removeEventListener("scroll", remove);
  };
  window.addEventListener("scroll", remove, { passive: true });

  // Auto-hilang setelah 5 detik kalau user tidak scroll
  setTimeout(() => {
    if (document.getElementById("eda-scroll-hint") === hint) remove();
  }, 5000);
}

function injectWindowScrollHint(pageId) {
  removeExistingHint();
  // Cek apakah page bisa di-scroll ke bawah
  setTimeout(() => {
    const isScrollable = document.documentElement.scrollHeight > window.innerHeight + 80;
    if (isScrollable) {
      showScrollHint("down", "page-down-" + pageId);
    }
  }, 300);
}

function injectScrollHints(root) {
  if (!root) return;
  setTimeout(() => {
    const candidates = root.querySelectorAll(".table-container, #pair-plot-container, .history-list");
    candidates.forEach((el, idx) => {
      const canScrollH = el.scrollWidth > el.clientWidth + 8;
      const canScrollV = el.scrollHeight > el.clientHeight + 8;
      if (!canScrollH && !canScrollV) return;

      const idStr = el.id || el.className.split(" ")[0] || "el";
      const hintKey = "el-" + idStr + "-" + idx;
      const seen = getSeenHints();
      if (seen[hintKey]) return;

      const type = canScrollH && !canScrollV ? "right" : "down";

      // Tampilkan hint saat elemen masuk viewport (user hover / focus area)
      const showOnce = () => {
        showScrollHint(type, hintKey);
        el.removeEventListener("mouseenter", showOnce);
        el.removeEventListener("touchstart", showOnce);

        // Hilangkan saat elemen di-scroll
        const onElScroll = () => {
          removeExistingHint();
          markHintSeen(hintKey);
          el.removeEventListener("scroll", onElScroll);
        };
        el.addEventListener("scroll", onElScroll, { passive: true });
      };

      el.addEventListener("mouseenter", showOnce, { once: true });
      el.addEventListener("touchstart", showOnce, { once: true, passive: true });
    });
  }, 400);
}

// INIT
window.onload = function () {
  renderHistoryPanel();
  initDarkMode();
};