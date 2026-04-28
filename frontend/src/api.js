const isFileProtocol =
  typeof window !== "undefined" && window.location?.protocol === "file:";
const isWebProtocol =
  typeof window !== "undefined" &&
  (window.location?.protocol === "http:" || window.location?.protocol === "https:");
const FRONTEND_HOST =
  typeof window !== "undefined" && window.location?.hostname
    ? window.location.hostname
    : "127.0.0.1";
const FRONTEND_PROTOCOL =
  typeof window !== "undefined" && window.location?.protocol
    ? window.location.protocol
    : "http:";
const SERVER_ORIGIN = isFileProtocol
  ? "http://127.0.0.1:4000"
  : isWebProtocol
    ? `${FRONTEND_PROTOCOL}//${FRONTEND_HOST}:4000`
    : "http://127.0.0.1:4000";
const API_BASE = `${SERVER_ORIGIN}/api`;
const MEDIA_BASE = SERVER_ORIGIN;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function uploadWithProgress(
  url,
  formData,
  { onTransferProgress = null, onServerProgress = null, serverProgressUrl = "" } = {}
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    let pollingActive = true;
    let pollTimer = null;
    let inFlightPoll = null;
    const hasServerPolling = Boolean(onServerProgress && serverProgressUrl);

    const pollServerProgress = async () => {
      if (!pollingActive || !hasServerPolling) {
        return null;
      }
      if (inFlightPoll) {
        return inFlightPoll;
      }
      inFlightPoll = (async () => {
        try {
          const response = await fetch(serverProgressUrl);
          const data = await response.json();
          onServerProgress(data);
          return data;
        } catch {
          return null;
        } finally {
          inFlightPoll = null;
        }
      })();
      return inFlightPoll;
    };

    const scheduleNextPoll = () => {
      if (!pollingActive || !hasServerPolling) {
        return;
      }
      pollTimer = setTimeout(async () => {
        await pollServerProgress();
        scheduleNextPoll();
      }, 700);
    };

    const stopPolling = () => {
      pollingActive = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    if (hasServerPolling) {
      // Immediate first poll + controlled one-by-one polling.
      pollServerProgress();
      scheduleNextPoll();
    }
    xhr.upload.onprogress = (event) => {
      if (!onTransferProgress || !event.lengthComputable) {
        return;
      }
      const pct = Math.max(0, Math.min(100, (event.loaded / event.total) * 100));
      onTransferProgress(pct);
    };
    xhr.onload = async () => {
      stopPolling();
      if (inFlightPoll) {
        await inFlightPoll;
      }
      // Final explicit poll (without restarting the loop) to align UI to last server state.
      if (hasServerPolling) {
        try {
          const response = await fetch(serverProgressUrl);
          const data = await response.json();
          onServerProgress(data);
        } catch {
          // ignore final poll error; xhr result still authoritative
        }
      }
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      reject(new Error(data.error || "Upload failed"));
    };
    xhr.onerror = () => {
      stopPolling();
      reject(new Error("Upload failed"));
    };
    xhr.send(formData);
  });
}

export async function createProject(name) {
  const response = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJson(response);
}

export async function waitForServerReady({
  attempts = 30,
  delayMs = 350,
} = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await parseJson(response);
      if (data?.ok) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }
  throw lastError || new Error("Backend is not ready yet");
}

export async function updateSettings(projectId, settings) {
  const response = await fetch(`${API_BASE}/projects/${projectId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return parseJson(response);
}

export async function uploadFiles(projectId, files, callbacks) {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file));
  return uploadWithProgress(`${API_BASE}/projects/${projectId}/upload/files`, formData, {
    ...callbacks,
    serverProgressUrl: `${API_BASE}/projects/${projectId}/upload-status`,
  });
}

export async function uploadZip(projectId, zipFile, callbacks) {
  const formData = new FormData();
  formData.append("archive", zipFile);
  return uploadWithProgress(`${API_BASE}/projects/${projectId}/upload/zip`, formData, {
    ...callbacks,
    serverProgressUrl: `${API_BASE}/projects/${projectId}/upload-status`,
  });
}

export async function getFrames(projectId, offset = 0, limit = 250) {
  const response = await fetch(
    `${API_BASE}/projects/${projectId}/frames?offset=${offset}&limit=${limit}`
  );
  const data = await parseJson(response);
  return {
    ...data,
    frames: data.frames.map((frame) => ({
      ...frame,
      previewUrl: `${MEDIA_BASE}${frame.previewUrl}`,
    })),
  };
}

export async function getUploadStatus(projectId) {
  const response = await fetch(`${API_BASE}/projects/${projectId}/upload-status`);
  return parseJson(response);
}

export async function startRender(projectId, options = {}) {
  const response = await fetch(`${API_BASE}/projects/${projectId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return parseJson(response);
}

export async function getRenderJob(jobId) {
  const response = await fetch(`${API_BASE}/render-jobs/${jobId}`);
  return parseJson(response);
}

export async function getRenderJobDebug(jobId) {
  const response = await fetch(`${API_BASE}/render-jobs/${jobId}/debug`);
  return parseJson(response);
}

export async function getLatestElectronDownload() {
  const response = await fetch(`${API_BASE}/downloads/latest-electron`);
  return parseJson(response);
}

export function buildPreviewVideoUrl(jobId) {
  return `${API_BASE}/render-jobs/${jobId}/preview`;
}

export function buildDownloadUrl(jobId) {
  return `${API_BASE}/render-jobs/${jobId}/download`;
}
