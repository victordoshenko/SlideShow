const state = new Map();

function setUploadProgress(projectId, patch) {
  const current = state.get(projectId) || {
    active: false,
    phase: "idle",
    progress: 0,
    message: null,
    total: 0,
    processed: 0,
    updatedAt: new Date().toISOString(),
  };
  state.set(projectId, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function startUploadProgress(projectId, total, phase = "uploading") {
  setUploadProgress(projectId, {
    active: true,
    phase,
    progress: 0,
    message: null,
    total,
    processed: 0,
  });
}

function updateProcessingProgress(projectId, processed, total, message = null) {
  const safeTotal = Math.max(1, Number(total || 0));
  const safeProcessed = Math.max(0, Math.min(safeTotal, Number(processed || 0)));
  const progress = (safeProcessed / safeTotal) * 100;
  setUploadProgress(projectId, {
    active: true,
    phase: "processing",
    progress,
    processed: safeProcessed,
    total: safeTotal,
    message,
  });
}

function finishUploadProgress(projectId) {
  setUploadProgress(projectId, {
    active: false,
    phase: "ready",
    progress: 100,
  });
}

function failUploadProgress(projectId, message) {
  setUploadProgress(projectId, {
    active: false,
    phase: "failed",
    progress: 0,
    message: message || "Upload failed",
  });
}

function getUploadProgress(projectId) {
  return (
    state.get(projectId) || {
      active: false,
      phase: "idle",
      progress: 0,
      message: null,
      total: 0,
      processed: 0,
      updatedAt: new Date().toISOString(),
    }
  );
}

module.exports = {
  startUploadProgress,
  updateProcessingProgress,
  finishUploadProgress,
  failUploadProgress,
  getUploadProgress,
};
