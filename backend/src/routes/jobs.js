const express = require("express");
const path = require("path");
const { getRenderJob, getRenderDebug } = require("../services/renderQueue");

const router = express.Router();

router.get("/:id", async (req, res) => {
  const job = await getRenderJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

router.get("/:id/debug", async (req, res) => {
  const job = await getRenderJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const debug = await getRenderDebug(req.params.id);
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: debug?.stage || "queued",
    bootstrapStep: debug?.bootstrapStep || null,
    renderMode: debug?.renderMode || null,
    lastMessage: debug?.lastMessage || null,
    updatedAt: debug?.updatedAt || job.updatedAt,
  });
});

router.get("/:id/download", async (req, res) => {
  const job = await getRenderJob(req.params.id);
  if (!job || !job.outputPath || job.status !== "done") {
    res.status(404).json({ error: "Rendered file not found" });
    return;
  }
  res.download(job.outputPath, path.basename(job.outputPath));
});

router.get("/:id/preview", async (req, res) => {
  const job = await getRenderJob(req.params.id);
  if (!job || !job.outputPath || job.status !== "done") {
    res.status(404).json({ error: "Rendered file not found" });
    return;
  }
  res.sendFile(path.resolve(job.outputPath));
});

module.exports = router;
