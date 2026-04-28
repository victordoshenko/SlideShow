const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");
const http = require("http");

const BACKEND_PORT = Number(process.env.PORT || 4000);
let backendServer = null;
let staleJobsTimer = null;
let mainWindow = null;

function logLine(message) {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "main.log");
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (_) {
    // ignore logging failures
  }
}

function resolveBackendSrcDir() {
  return path.join(app.getAppPath(), "backend", "src");
}

function resolveFrontendEntry() {
  return path.join(app.getAppPath(), "frontend", "dist", "index.html");
}

function waitForBackendReady(timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Backend healthcheck failed with status ${response.statusCode}`));
          return;
        }
        setTimeout(probe, 500);
      });
      request.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Backend did not start in time"));
          return;
        }
        setTimeout(probe, 500);
      });
      request.setTimeout(2000, () => {
        request.destroy();
      });
    };
    probe();
  });
}

async function startBackend() {
  if (backendServer) {
    return;
  }
  const backendSrcDir = resolveBackendSrcDir();
  logLine(`Starting backend in-process: ${backendSrcDir}`);
  process.env.ELECTRON_APP = "1";
  process.env.PORT = String(BACKEND_PORT);
  const dbService = require(path.join(backendSrcDir, "services", "db.js"));
  const expressApp = require(path.join(backendSrcDir, "app.js"));

  await dbService.initDb();
  staleJobsTimer = setInterval(() => {
    dbService.failStaleRunningJobs(45).catch((error) => {
      logLine(`failStaleRunningJobs error: ${error.message}`);
    });
  }, 15000);
  backendServer = expressApp.listen(BACKEND_PORT, "127.0.0.1", () => {
    logLine(`Backend started on http://127.0.0.1:${BACKEND_PORT}`);
  });
}

function stopBackend() {
  if (staleJobsTimer) {
    clearInterval(staleJobsTimer);
    staleJobsTimer = null;
  }
  if (!backendServer) {
    return;
  }
  backendServer.close(() => {
    logLine("Backend server closed");
  });
  backendServer = null;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadURL(
    "data:text/html;charset=UTF-8,<html><body style='background:#0f172a;color:#e2e8f0;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;'><div>Starting SlideShow...</div></body></html>"
  );

  await startBackend();
  try {
    await waitForBackendReady();
    await mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}/`);
  } catch (error) {
    logLine(`Startup failed: ${error.message}`);
    await mainWindow.loadURL(
      `data:text/html;charset=UTF-8,<html><body style='background:#0f172a;color:#fecaca;font-family:Segoe UI,sans-serif;padding:24px;'><h2>SlideShow failed to start</h2><p>${String(
        error.message || "Unknown startup error"
      ).replace(/</g, "&lt;")}</p><p>See logs in userData/logs/main.log</p></body></html>`
    );
  }
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackend();
});
