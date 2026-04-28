const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const releasesDir = path.join(rootDir, "releases");
const pagesManifestPath = path.join(rootDir, "frontend", "public", "latest-electron.json");
const appDirName = "SlideShow-win32-x64";
const PART_SIZE_MB = Math.max(1, Number(process.env.ELECTRON_ARCHIVE_PART_MB || 90));
const PART_SIZE_BYTES = PART_SIZE_MB * 1024 * 1024;
const GITHUB_REPO = process.env.GITHUB_REPO || "victordoshenko/SlideShow";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const KEEP_LOCALES = (process.env.ELECTRON_KEEP_LOCALES || "en-US")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function run(command) {
  execSync(command, { cwd: rootDir, stdio: "inherit" });
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function createZipWithRootFolder(zipFileName) {
  const zipBase = zipFileName.replace(/\.zip$/i, "");
  const stageRoot = path.join(releasesDir, "__zip_stage");
  const stageDir = path.join(stageRoot, zipBase);
  const sourceDir = path.join(releasesDir, appDirName);
  const zipPath = path.join(releasesDir, zipFileName);

  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.cpSync(sourceDir, stageDir, { recursive: true });
  fs.rmSync(zipPath, { force: true });

  const ps = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${stageRoot.replace(/\\/g, "\\\\")}', '${zipPath.replace(/\\/g, "\\\\")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
  ].join("; ");
  execSync(`powershell -NoProfile -Command "${ps}"`, { cwd: rootDir, stdio: "inherit" });
  fs.rmSync(stageRoot, { recursive: true, force: true });
}

function splitArchive(zipFileName, partSizeBytes) {
  const zipPath = path.join(releasesDir, zipFileName);
  const totalBytes = fs.statSync(zipPath).size;
  if (totalBytes <= partSizeBytes) {
    return [zipFileName];
  }

  const partFiles = [];
  const fd = fs.openSync(zipPath, "r");
  try {
    let offset = 0;
    let partIndex = 1;
    while (offset < totalBytes) {
      const currentSize = Math.min(partSizeBytes, totalBytes - offset);
      const buffer = Buffer.allocUnsafe(currentSize);
      fs.readSync(fd, buffer, 0, currentSize, offset);
      const partFileName = `${zipFileName}.${String(partIndex).padStart(3, "0")}`;
      fs.writeFileSync(path.join(releasesDir, partFileName), buffer);
      partFiles.push(partFileName);
      offset += currentSize;
      partIndex += 1;
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(zipPath, { force: true });
  return partFiles;
}

function createSelfExtractLauncher(archiveBaseName, partFiles) {
  const launcherFileName = `${archiveBaseName}.extract.cmd`;
  const launcherPath = path.join(releasesDir, launcherFileName);
  const copyList = partFiles.map((name) => `"${name}"`).join("+");
  const script = [
    "@echo off",
    "setlocal",
    `set "ARCHIVE_BASE=${archiveBaseName}"`,
    `set "COPY_LIST=${copyList}"`,
    "set \"WORK_ZIP=%TEMP%\\%ARCHIVE_BASE%\"",
    "set \"TARGET_DIR=%~dp0%ARCHIVE_BASE%\"",
    "if exist \"%WORK_ZIP%\" del /f /q \"%WORK_ZIP%\" >nul 2>nul",
    "echo Combining multi-volume archive...",
    "copy /b %COPY_LIST% \"%WORK_ZIP%\" >nul",
    "if errorlevel 1 (",
    "  echo Failed to combine archive parts. Ensure all parts are in this folder.",
    "  pause",
    "  exit /b 1",
    ")",
    "echo Extracting archive...",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath '%WORK_ZIP%' -DestinationPath '%TARGET_DIR%' -Force\"",
    "if errorlevel 1 (",
    "  echo Extraction failed.",
    "  pause",
    "  exit /b 1",
    ")",
    "del /f /q \"%WORK_ZIP%\" >nul 2>nul",
    "echo Done. Extracted to:",
    "echo %TARGET_DIR%",
    "pause",
  ].join("\r\n");
  fs.writeFileSync(launcherPath, script, "utf8");
  return launcherFileName;
}

function cleanupOldArtifacts({ archiveBaseName, parts, launcherFileName }) {
  const keep = new Set(["latest-electron.json", archiveBaseName, launcherFileName, ...parts]);
  const artifactPattern =
    /^SlideShow-win32-x64-portable(?:-lite)?-\d{14}\.zip(?:\.\d{3}|\.extract\.cmd)?$/i;
  for (const entry of fs.readdirSync(releasesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (!artifactPattern.test(entry.name)) {
      continue;
    }
    if (keep.has(entry.name)) {
      continue;
    }
    fs.rmSync(path.join(releasesDir, entry.name), { force: true });
  }
}

function trimLocales() {
  const localesDir = path.join(releasesDir, appDirName, "locales");
  if (!fs.existsSync(localesDir)) {
    return;
  }
  for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".pak")) {
      continue;
    }
    const locale = entry.name.replace(/\.pak$/i, "");
    if (!KEEP_LOCALES.includes(locale)) {
      fs.rmSync(path.join(localesDir, entry.name), { force: true });
    }
  }
}

function main() {
  fs.mkdirSync(releasesDir, { recursive: true });
  run("npm run build --prefix frontend");
  run("npx electron-rebuild -f -w sqlite3 --module-dir backend");
  run(
    'electron-packager . SlideShow --platform=win32 --arch=x64 --out=releases --overwrite --ignore="^/releases($|/)" --ignore="^/\\.git($|/)" --ignore="^/node_modules($|/)" --ignore="^/src-tauri($|/)" --ignore="^/tauri($|/)" --ignore="^/backend/storage($|/)" --ignore="^/backend/test($|/)" --ignore="^/frontend/node_modules($|/)" --ignore="^/frontend/src($|/)" --ignore="^/frontend/public($|/)"'
  );
  trimLocales();

  const fileName = `SlideShow-win32-x64-portable-lite-${timestamp()}.zip`;
  createZipWithRootFolder(fileName);
  const parts = splitArchive(fileName, PART_SIZE_BYTES);
  const launcherFileName = createSelfExtractLauncher(fileName, parts);
  cleanupOldArtifacts({
    archiveBaseName: fileName,
    parts,
    launcherFileName,
  });

  const manifestPath = path.join(releasesDir, "latest-electron.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        fileName: parts[0],
        archiveBaseName: fileName,
        multipart: parts.length > 1,
        parts,
        launcherFileName,
        partSizeMb: PART_SIZE_MB,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(
    pagesManifestPath,
    JSON.stringify(
      {
        fileName: parts[0],
        archiveBaseName: fileName,
        multipart: parts.length > 1,
        parts,
        launcherFileName,
        partSizeMb: PART_SIZE_MB,
        partDownloadUrls: parts.map(
          (name) => `https://github.com/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/releases/${name}`
        ),
        launcherDownloadUrl: `https://github.com/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/releases/${launcherFileName}`,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
  // eslint-disable-next-line no-console
  console.log(
    parts.length > 1
      ? `Latest Electron multi-volume archive: ${parts.length} parts x ${PART_SIZE_MB} MB`
      : `Latest Electron ZIP: ${parts[0]}`
  );
}

main();
