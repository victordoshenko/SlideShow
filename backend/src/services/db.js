const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { DB_PATH } = require("../config");

const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    frameDurationMs INTEGER NOT NULL,
    transitionEnabled INTEGER NOT NULL DEFAULT 0,
    transitionDurationMs INTEGER NOT NULL DEFAULT 300,
    status TEXT NOT NULL DEFAULT 'draft',
    createdAt TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS frames (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    orderIndex INTEGER NOT NULL,
    fileName TEXT NOT NULL,
    filePath TEXT NOT NULL,
    durationMs INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(projectId) REFERENCES projects(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS render_jobs (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    outputPath TEXT,
    error TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(projectId) REFERENCES projects(id)
  )`);

  // If backend was restarted mid-render, do not leave stale jobs "running" forever.
  await run(
    `UPDATE render_jobs
     SET status = 'failed',
         error = COALESCE(error, 'Render interrupted by server restart'),
         updatedAt = ?
     WHERE status IN ('queued', 'running')`,
    [new Date().toISOString()]
  );
}

async function failStaleRunningJobs(maxStaleSeconds = 45) {
  const staleDays = Math.max(5, Number(maxStaleSeconds) || 45) / 86400;
  await run(
    `UPDATE render_jobs
     SET status = 'failed',
         progress = CASE WHEN progress > 0 THEN progress ELSE 0 END,
         error = COALESCE(error, 'Render process ended unexpectedly'),
         updatedAt = ?
     WHERE status = 'running'
       AND julianday(updatedAt) <= julianday('now') - ?`,
    [new Date().toISOString(), staleDays]
  );
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb,
  failStaleRunningJobs,
};
