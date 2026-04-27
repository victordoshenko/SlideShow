const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const unzipper = require("unzipper");
const { TMP_DIR, MAX_FILES, PROJECTS_DIR } = require("../config");
const { ensureDir, isAllowedImage } = require("../utils/files");
const {
  createProject,
  getProject,
  updateProjectSettings,
  getFrames,
  countFrames,
  addFilesToProject,
} = require("../services/projectService");
const { createRenderJob } = require("../services/renderQueue");
const {
  startUploadProgress,
  updateProcessingProgress,
  finishUploadProgress,
  failUploadProgress,
  getUploadProgress,
} = require("../services/uploadProgress");

ensureDir(TMP_DIR);
ensureDir(PROJECTS_DIR);

const upload = multer({
  dest: TMP_DIR,
  limits: {
    files: MAX_FILES,
    fileSize: 25 * 1024 * 1024,
  },
});

const router = express.Router();

router.post("/", async (req, res) => {
  const project = await createProject(req.body?.name);
  res.status(201).json(project);
});

router.get("/:id", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

router.patch("/:id/settings", async (req, res) => {
  const project = await updateProjectSettings(req.params.id, req.body || {});
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

router.post("/:id/upload/files", upload.array("photos", MAX_FILES), async (req, res) => {
  try {
    startUploadProgress(req.params.id, (req.files || []).length, "processing");
    const files = (req.files || [])
      .filter((item) => isAllowedImage(item.originalname))
      .map((item) => ({ path: item.path, originalName: item.originalname }));
    await addFilesToProject(req.params.id, files, (processed, total) => {
      updateProcessingProgress(req.params.id, processed, total);
    });
    const total = await countFrames(req.params.id);
    finishUploadProgress(req.params.id);
    res.json({ ok: true, imported: files.length, total });
  } catch (error) {
    failUploadProgress(req.params.id, error.message);
    res.status(400).json({ error: error.message });
  } finally {
    for (const item of req.files || []) {
      fs.rmSync(item.path, { force: true });
    }
  }
});

router.post("/:id/upload/zip", upload.single("archive"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "ZIP archive is required" });
    return;
  }

  const tmpExtractDir = path.join(TMP_DIR, `${Date.now()}_${req.params.id}`);
  ensureDir(tmpExtractDir);

  try {
    const directory = await unzipper.Open.file(req.file.path);
    const extracted = [];
    for (const entry of directory.files) {
      if (entry.type !== "File" || !isAllowedImage(entry.path)) {
        continue;
      }
      const extractedPath = path.join(tmpExtractDir, path.basename(entry.path));
      await new Promise((resolve, reject) => {
        entry
          .stream()
          .pipe(fs.createWriteStream(extractedPath))
          .on("finish", resolve)
          .on("error", reject);
      });
      extracted.push({ path: extractedPath, originalName: path.basename(entry.path) });
      if (extracted.length >= MAX_FILES) {
        break;
      }
    }

    startUploadProgress(req.params.id, extracted.length, "processing");
    await addFilesToProject(req.params.id, extracted, (processed, totalCount) => {
      updateProcessingProgress(req.params.id, processed, totalCount);
    });
    const total = await countFrames(req.params.id);
    finishUploadProgress(req.params.id);
    res.json({ ok: true, imported: extracted.length, total });
  } catch (error) {
    failUploadProgress(req.params.id, error.message);
    res.status(400).json({ error: error.message });
  } finally {
    fs.rmSync(req.file.path, { force: true });
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
  }
});

router.get("/:id/frames", async (req, res) => {
  const offset = Number(req.query.offset || 0);
  const limit = Math.min(500, Number(req.query.limit || 200));
  const frames = await getFrames(req.params.id, offset, limit);
  const total = await countFrames(req.params.id);

  const normalized = frames.map((frame) => ({
    ...frame,
    previewUrl: `/media/projects/${req.params.id}/${path.basename(frame.filePath)}`,
  }));
  res.json({ frames: normalized, total, offset, limit });
});

router.get("/:id/upload-status", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(getUploadProgress(req.params.id));
});

router.post("/:id/render", async (req, res) => {
  try {
    const job = await createRenderJob(req.params.id);
    res.status(201).json(job);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
