// Publica Code.gs como Web App de Apps Script y pega aqui la URL terminada en /exec.
// Ejemplo: const API_URL = "https://script.google.com/macros/s/XXXXX/exec";
const API_URL = "https://script.google.com/macros/s/AKfycbxgxLlPPF_j_GUvYY831_HHRoSwn3OTsu3_VSRGtD_97FLLLMOWv2C5C6_RxShOfe4D/exec";
const CACHE_KEY = "pomodoro_tracker_cache_v1";

const state = {
  records: [],
  syncMode: "cache",
  syncing: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  mapElements();
  bindEvents();
  state.records = loadCache();
  resetForm();
  renderAll();
  synchronize();
});

function mapElements() {
  [
    "syncStatus", "syncStatusText", "studyForm", "idEstudio", "fecha",
    "materia", "materiasList", "cantidad", "tiempo", "totalPreview",
    "saveButton", "newButton", "formTitle", "recordCount", "flashcards",
    "tableBody", "emptyState", "retryButton"
  ].forEach((id) => { elements[id] = document.getElementById(id); });
}

function bindEvents() {
  elements.studyForm.addEventListener("submit", handleSubmit);
  elements.newButton.addEventListener("click", resetForm);
  elements.retryButton.addEventListener("click", synchronize);
  elements.cantidad.addEventListener("input", updatePreview);
  elements.tiempo.addEventListener("input", updatePreview);
  window.addEventListener("online", synchronize);
  window.addEventListener("offline", () => setSyncMode("cache"));
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached.map(normalizeRecord) : [];
  } catch (error) {
    console.warn("No se pudo leer el cache local.", error);
    return [];
  }
}

function persistCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.records));
}

function normalizeRecord(record) {
  if (Array.isArray(record)) {
    return {
      idEstudio: String(record[0] || ""),
      fecha: String(record[1] || ""),
      materia: String(record[2] || ""),
      cantidad: Number(record[3]) || 0,
      tiempo: Number(record[4]) || 0,
      totalMinutos: Number(record[3]) * Number(record[4]) || 0
    };
  }

  return {
    ...record,
    idEstudio: String(record.idEstudio || ""),
    fecha: String(record.fecha || ""),
    materia: String(record.materia || ""),
    cantidad: Number(record.cantidad) || 0,
    tiempo: Number(record.tiempo) || 0,
    totalMinutos: Number(record.cantidad) * Number(record.tiempo) || 0
  };
}

function rowToRecord(row) {
  return normalizeRecord(row);
}

function recordToPayload(record) {
  return {
    idEstudio: record.idEstudio,
    fecha: toInputDate(record.fecha),
    materia: record.materia,
    cantidad: record.cantidad,
    tiempo: record.tiempo
  };
}

async function synchronize() {
  if (state.syncing) return;
  if (!isApiConfigured() || !navigator.onLine) {
    setSyncMode("cache");
    return;
  }

  state.syncing = true;
  try {
    await retryPendingRecords();
    const response = await apiGetData();
    const remoteRecords = (response.rows || []).map(rowToRecord);
    const pendingRecords = state.records.filter((record) => record._pending);
    const pendingIds = new Set(pendingRecords.map((record) => record.idEstudio));
    state.records = remoteRecords.filter((record) => !pendingIds.has(record.idEstudio)).concat(pendingRecords);
    persistCache();
    renderAll();
    setSyncMode(hasPendingRecords() ? "pending" : "synced");
  } catch (error) {
    console.error("Fallo la sincronizacion.", error);
    setSyncMode("error");
  } finally {
    state.syncing = false;
  }
}

async function retryPendingRecords() {
  const ids = state.records.filter((record) => record._pending).map((record) => record.idEstudio);
  for (const id of ids) {
    const current = state.records.find((record) => record.idEstudio === id && record._pending);
    if (current) await sendPendingRecord(current);
  }
}

async function sendPendingRecord(record) {
  const snapshotRevision = record._revision;
  const oldId = record.idEstudio;
  const response = await apiSaveRecord(recordToPayload(record));
  const official = rowToRecord(response.row);
  const index = state.records.findIndex((item) => item.idEstudio === oldId);
  if (index === -1) return;

  const latest = state.records[index];
  if (latest._revision === snapshotRevision) {
    state.records[index] = official;
  } else {
    state.records[index] = {
      ...latest,
      idEstudio: official.idEstudio,
      _pending: true
    };
  }
  persistCache();
  renderAll();
}

async function apiGetData() {
  const response = await fetch(`${API_URL}?action=getData`, { method: "GET" });
  return readApiResponse(response);
}

async function apiSaveRecord(data) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "saveRecord", data })
  });
  return readApiResponse(response);
}

async function readApiResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Respuesta invalida de la API.");
  return payload.data;
}

function handleSubmit(event) {
  event.preventDefault();
  if (!elements.studyForm.reportValidity()) return;

  const id = elements.idEstudio.value || crypto.randomUUID();
  const record = normalizeRecord({
    idEstudio: id,
    fecha: toDisplayDate(elements.fecha.value),
    materia: elements.materia.value.trim(),
    cantidad: Number(elements.cantidad.value),
    tiempo: Number(elements.tiempo.value),
    _pending: true,
    _revision: crypto.randomUUID()
  });

  const index = state.records.findIndex((item) => item.idEstudio === id);
  if (index === -1) state.records.push(record);
  else state.records[index] = record;

  persistCache();
  renderAll();
  resetForm();
  setSyncMode("pending");
  synchronize();
}

function renderAll() {
  renderTable();
  renderFlashcards();
  renderDatalist();
  renderStatus();
}

function renderTable() {
  elements.tableBody.textContent = "";
  const fragment = document.createDocumentFragment();

  [...state.records].reverse().forEach((record) => {
    if (!record.materia) return;
    const row = document.createElement("tr");
    row.addEventListener("click", () => editRecord(record));
    appendCell(row, record.fecha);
    appendCell(row, record.materia);
    appendCell(row, record.cantidad);
    appendCell(row, `${record.tiempo} min`);
    appendCell(row, `${record.totalMinutos} min`, "total");
    appendCell(row, record._pending ? "Pendiente" : "Sincronizado", record._pending ? "pending-label" : "synced-label");
    fragment.appendChild(row);
  });

  elements.tableBody.appendChild(fragment);
  elements.emptyState.hidden = state.records.length > 0;
  elements.recordCount.textContent = `${state.records.length} ${state.records.length === 1 ? "registro" : "registros"}`;
}

function appendCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  row.appendChild(cell);
}

function renderFlashcards() {
  const totals = new Map();
  state.records.forEach((record) => {
    if (!record.materia) return;
    totals.set(record.materia, (totals.get(record.materia) || 0) + record.totalMinutos);
  });

  elements.flashcards.textContent = "";
  [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([materia, minutes]) => {
      const card = document.createElement("article");
      card.className = "flashcard";
      const metric = document.createElement("p");
      metric.className = "metric";
      metric.textContent = formatDuration(minutes);
      const label = document.createElement("p");
      label.className = "label";
      label.textContent = materia;
      const detail = document.createElement("p");
      detail.className = "detail";
      detail.textContent = `${minutes} minutos acumulados`;
      card.append(metric, label, detail);
      elements.flashcards.appendChild(card);
    });
}

function renderDatalist() {
  const subjects = [...new Set(state.records.map((record) => record.materia).filter(Boolean))].sort();
  elements.materiasList.textContent = "";
  subjects.forEach((subject) => {
    const option = document.createElement("option");
    option.value = subject;
    elements.materiasList.appendChild(option);
  });
}

function editRecord(record) {
  elements.idEstudio.value = record.idEstudio;
  elements.fecha.value = toInputDate(record.fecha);
  elements.materia.value = record.materia;
  elements.cantidad.value = record.cantidad;
  elements.tiempo.value = record.tiempo;
  elements.formTitle.textContent = "Editar sesion";
  elements.saveButton.textContent = "Actualizar";
  updatePreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  elements.studyForm.reset();
  elements.idEstudio.value = "";
  elements.fecha.value = todayInputValue();
  elements.cantidad.value = 1;
  elements.tiempo.value = 25;
  elements.formTitle.textContent = "Sesion de enfoque";
  elements.saveButton.textContent = "Guardar";
  updatePreview();
}

function updatePreview() {
  const total = (Number(elements.cantidad.value) || 0) * (Number(elements.tiempo.value) || 0);
  elements.totalPreview.textContent = `${total} min`;
}

function setSyncMode(mode) {
  state.syncMode = mode;
  renderStatus();
}

function renderStatus() {
  const pending = hasPendingRecords();
  const mode = pending && state.syncMode !== "error" ? "pending" : state.syncMode;
  const labels = {
    synced: "Online sincronizado",
    cache: "Trabajando con cache",
    pending: "Cambios pendientes",
    error: "Error de sincronizacion"
  };
  elements.syncStatus.className = `sync-status ${mode}`;
  elements.syncStatusText.textContent = labels[mode];
  elements.retryButton.hidden = !pending && mode !== "error";
}

function hasPendingRecords() {
  return state.records.some((record) => record._pending);
}

function isApiConfigured() {
  return API_URL.startsWith("https://script.google.com/macros/s/") && API_URL.endsWith("/exec");
}

function toDisplayDate(inputDate) {
  const parts = inputDate.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : inputDate;
}

function toInputDate(displayDate) {
  const parts = displayDate.split("/");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : displayDate;
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${String(remaining).padStart(2, "0")}m` : `${remaining}m`;
}
