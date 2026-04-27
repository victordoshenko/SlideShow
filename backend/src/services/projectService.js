const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { PROJECTS_DIR, MAX_FILES } = require("../config");
const { run, get, all } = require("./db");
const { ensureDir, sanitizeFileName, isAllowedImage } = require("../utils/files");

async function createProject(name = "Untitled project") {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO projects (id, name, frameDurationMs, transitionEnabled, transitionDurationMs, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, 4000, 1, 400, "draft", createdAt]
  );
  ensureDir(path.join(PROJECTS_DIR, id));
  return getProject(id);
}

async function getProject(projectId) {
  return get("SELECT * FROM projects WHERE id = ?", [projectId]);
}

async function updateProjectSettings(projectId, settings) {
  const current = await getProject(projectId);
  if (!current) {
    return null;
  }

  const frameDurationMs = Number(settings.frameDurationMs ?? current.frameDurationMs);
  const transitionEnabled =
    settings.transitionEnabled === undefined
      ? current.transitionEnabled
      : settings.transitionEnabled
      ? 1
      : 0;
  const transitionDurationMs = Number(
    settings.transitionDurationMs ?? current.transitionDurationMs
  );

  await run(
    `UPDATE projects
     SET frameDurationMs = ?, transitionEnabled = ?, transitionDurationMs = ?
     WHERE id = ?`,
    [frameDurationMs, transitionEnabled, transitionDurationMs, projectId]
  );
  await run("UPDATE frames SET durationMs = ? WHERE projectId = ?", [frameDurationMs, projectId]);
  return getProject(projectId);
}

async function getFrames(projectId, offset = 0, limit = 200) {
  return all(
    `SELECT id, orderIndex, fileName, durationMs, filePath
     FROM frames WHERE projectId = ?
     ORDER BY orderIndex ASC
     LIMIT ? OFFSET ?`,
    [projectId, limit, offset]
  );
}

async function countFrames(projectId) {
  const row = await get("SELECT COUNT(*) as count FROM frames WHERE projectId = ?", [projectId]);
  return Number(row?.count ?? 0);
}

async function addFilesToProject(projectId, sourceFiles, onProgress = null) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const currentCount = await countFrames(projectId);
  if (currentCount + sourceFiles.length > MAX_FILES) {
    throw new Error(`Too many files. Max allowed is ${MAX_FILES}`);
  }

  const projectDir = path.join(PROJECTS_DIR, projectId);
  ensureDir(projectDir);

  let orderIndex = currentCount;
  const createdAt = new Date().toISOString();

  for (const sourceFile of sourceFiles) {
    if (!isAllowedImage(sourceFile.originalName)) {
      continue;
    }

    const safeName = `${Date.now()}_${uuidv4()}_${sanitizeFileName(sourceFile.originalName)}`;
    const targetPath = path.join(projectDir, safeName);
    fs.copyFileSync(sourceFile.path, targetPath);
    // Normalize orientation once on import so render output is deterministic.
    // sharp.rotate() applies EXIF orientation and strips orientation ambiguity.
    const normalizedPath = `${targetPath}.normalized`;
    try {
      await sharp(targetPath).rotate().toFile(normalizedPath);
      fs.rmSync(targetPath, { force: true });
      fs.renameSync(normalizedPath, targetPath);
    } catch (_) {
      fs.rmSync(normalizedPath, { force: true });
    }

    await run(
      `INSERT INTO frames (id, projectId, orderIndex, fileName, filePath, durationMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        projectId,
        orderIndex,
        sourceFile.originalName,
        targetPath,
        project.frameDurationMs,
        createdAt,
      ]
    );
    orderIndex += 1;
    if (onProgress) {
      // onProgress receives (processedCount, totalCount)
      // for deterministic server-side import progress.
      onProgress(orderIndex - currentCount, sourceFiles.length);
    }
  }
}

module.exports = {
  createProject,
  getProject,
  updateProjectSettings,
  getFrames,
  countFrames,
  addFilesToProject,
};
