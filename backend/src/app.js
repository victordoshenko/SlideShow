const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { PROJECTS_DIR } = require("./config");
const projectRoutes = require("./routes/projects");
const jobRoutes = require("./routes/jobs");

const app = express();
const RELEASES_DIR = path.resolve(__dirname, "..", "..", "releases");
const FRONTEND_DIST_DIR = path.resolve(__dirname, "..", "..", "frontend", "dist");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/media/projects", express.static(PROJECTS_DIR));
app.use("/downloads", express.static(RELEASES_DIR));

function resolveLatestElectronZip() {
  const manifestPath = path.join(RELEASES_DIR, "latest-electron.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (Array.isArray(data?.parts) && data.parts.length > 0) {
        const allPartsExist = data.parts.every((part) =>
          fs.existsSync(path.join(RELEASES_DIR, part))
        );
        if (allPartsExist) {
          const launcherFileName =
            data.launcherFileName &&
            fs.existsSync(path.join(RELEASES_DIR, data.launcherFileName))
              ? data.launcherFileName
              : null;
          return {
            fileName: data.fileName || data.parts[0],
            parts: data.parts,
            multipart: true,
            partSizeMb: Number(data.partSizeMb) || 90,
            launcherFileName,
          };
        }
      }
      if (data?.fileName && fs.existsSync(path.join(RELEASES_DIR, data.fileName))) {
        return {
          fileName: data.fileName,
          parts: [data.fileName],
          multipart: false,
          partSizeMb: Number(data.partSizeMb) || 90,
          launcherFileName: null,
        };
      }
    } catch (_) {
      // fallback to file scan
    }
  }
  const candidates = fs
    .readdirSync(RELEASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^SlideShow-win32-x64-portable(?:-lite)?-\d{14}\.zip(?:\.\d{3})?$/i.test(name))
    .sort()
    .reverse();
  if (!candidates[0]) {
    return null;
  }
  return {
    fileName: candidates[0],
    parts: [candidates[0]],
    multipart: false,
    partSizeMb: 90,
    launcherFileName: null,
  };
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/api/downloads/latest-electron", (_, res) => {
  const archive = resolveLatestElectronZip();
  if (!archive) {
    res.status(404).json({ error: "Electron build archive not found" });
    return;
  }
  res.json({
    fileName: archive.fileName,
    downloadUrl: `/downloads/${archive.fileName}`,
    multipart: archive.multipart,
    partSizeMb: archive.partSizeMb,
    parts: archive.parts,
    partDownloadUrls: archive.parts.map((part) => `/downloads/${part}`),
    launcherFileName: archive.launcherFileName,
    launcherDownloadUrl: archive.launcherFileName ? `/downloads/${archive.launcherFileName}` : null,
  });
});

app.use("/api/projects", projectRoutes);
app.use("/api/render-jobs", jobRoutes);

if (process.env.ELECTRON_APP === "1" && fs.existsSync(FRONTEND_DIST_DIR)) {
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get("/", (_, res) => {
    res.sendFile(path.join(FRONTEND_DIST_DIR, "index.html"));
  });
}

app.use((error, _, res, __) => {
  res.status(500).json({ error: error.message || "Internal server error" });
});

module.exports = app;
