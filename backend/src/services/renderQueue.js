const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { RENDERS_DIR, RENDER_CHUNK_SIZE } = require("../config");
const { ensureDir } = require("../utils/files");
const { run, get, all } = require("./db");
const { getProject } = require("./projectService");

ensureDir(RENDERS_DIR);

const queue = [];
let activeJob = null;
let configuredFfmpegPath = null;
let selectedVideoEncoder = null;
const renderDebugState = new Map();

async function createRenderJob(projectId) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const jobId = uuidv4();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO render_jobs (id, projectId, status, progress, outputPath, error, createdAt, updatedAt)
     VALUES (?, ?, 'queued', 0, NULL, NULL, ?, ?)`,
    [jobId, projectId, now, now]
  );
  queue.push(jobId);
  renderDebugState.set(jobId, {
    stage: "queued",
    bootstrapStep: null,
    renderMode: null,
    lastMessage: null,
    updatedAt: now,
  });
  processQueue();
  return getRenderJob(jobId);
}

async function getRenderJob(jobId) {
  return get("SELECT * FROM render_jobs WHERE id = ?", [jobId]);
}

function updateRenderDebug(jobId, patch) {
  const current = renderDebugState.get(jobId) || {
    stage: "queued",
    bootstrapStep: null,
    renderMode: null,
    lastMessage: null,
    updatedAt: new Date().toISOString(),
  };
  renderDebugState.set(jobId, {
    stage: patch.stage ?? current.stage,
    bootstrapStep: patch.bootstrapStep ?? current.bootstrapStep,
    renderMode: patch.renderMode ?? current.renderMode,
    lastMessage: patch.lastMessage ?? current.lastMessage,
    updatedAt: new Date().toISOString(),
  });
}

async function getRenderDebug(jobId) {
  const job = await getRenderJob(jobId);
  if (!job) {
    return null;
  }
  const debug = renderDebugState.get(jobId);
  if (debug) {
    return { ...debug, status: job.status, progress: job.progress };
  }
  if (job.status === "queued") {
    return {
      stage: "queued",
      bootstrapStep: null,
      renderMode: null,
      status: job.status,
      progress: job.progress,
      lastMessage: null,
    };
  }
  if (job.status === "running") {
    return {
      stage: "encoding",
      bootstrapStep: null,
      renderMode: null,
      status: job.status,
      progress: job.progress,
      lastMessage: null,
    };
  }
  if (job.status === "done") {
    return {
      stage: "finalizing",
      bootstrapStep: null,
      renderMode: null,
      status: job.status,
      progress: job.progress,
      lastMessage: null,
    };
  }
  return {
    stage: "queued",
    bootstrapStep: null,
    renderMode: null,
    status: job.status,
    progress: job.progress,
    lastMessage: job.error || null,
  };
}

async function processQueue() {
  if (activeJob || queue.length === 0) {
    return;
  }
  const nextId = queue.shift();
  activeJob = nextId;
  updateRenderDebug(nextId, { stage: "starting" });
  try {
    await runRender(nextId);
  } catch (error) {
    await setJobState(nextId, {
      status: "failed",
      progress: 0,
      error: `Renderer crashed: ${error.message}`,
    });
    updateRenderDebug(nextId, { stage: "finalizing", lastMessage: error.message });
  } finally {
    activeJob = null;
    processQueue();
  }
}

async function setJobState(jobId, patch) {
  const current = await getRenderJob(jobId);
  if (!current) {
    return;
  }
  const next = {
    status: patch.status ?? current.status,
    progress: patch.progress ?? current.progress,
    outputPath: patch.outputPath ?? current.outputPath,
    error: patch.error ?? current.error,
  };
  await run(
    `UPDATE render_jobs
      SET status = ?, progress = ?, outputPath = ?, error = ?, updatedAt = ?
      WHERE id = ?`,
    [next.status, next.progress, next.outputPath, next.error, new Date().toISOString(), jobId]
  );
}

function parseTimemarkToSeconds(timemark) {
  if (!timemark || typeof timemark !== "string") {
    return 0;
  }
  const parts = timemark.split(":");
  if (parts.length !== 3) {
    return 0;
  }
  const hours = Number(parts[0] || 0);
  const minutes = Number(parts[1] || 0);
  const seconds = Number(parts[2] || 0);
  if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) {
    return 0;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function escapeConcatPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/'/g, "'\\''");
}

function resolveFfmpegPath() {
  if (configuredFfmpegPath) {
    return configuredFfmpegPath;
  }
  const candidates = [];
  if (process.env.FFMPEG_PATH) {
    candidates.push(process.env.FFMPEG_PATH);
  }
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const toolsDir = path.join(userProfile, "tools");
    if (fs.existsSync(toolsDir)) {
      for (const entry of fs.readdirSync(toolsDir)) {
        const candidate = path.join(toolsDir, entry, "bin", "ffmpeg.exe");
        candidates.push(candidate);
      }
    }
  }
  candidates.push("ffmpeg");
  for (const candidate of candidates) {
    try {
      if (candidate === "ffmpeg" || fs.existsSync(candidate)) {
        configuredFfmpegPath = candidate;
        return candidate;
      }
    } catch (_) {
      // try next candidate
    }
  }
  throw new Error(
    "FFmpeg executable was not found. Set FFMPEG_PATH or add ffmpeg.exe to PATH."
  );
}

function resolveVideoEncoder() {
  if (selectedVideoEncoder) {
    return selectedVideoEncoder;
  }
  // Stable default to avoid expensive/fragile startup probing on Windows.
  selectedVideoEncoder = "libopenh264";
  return selectedVideoEncoder;
}

function buildFrameInputFilter(frames, project) {
  const streams = frames
    .map(
      (_, index) =>
        `[${index}:v]scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v${index}]`,
    )
    .join(";");

  if (!project.transitionEnabled || frames.length < 2) {
    const concat = frames
      .map((_, index) => `[v${index}]trim=duration=${project.frameDurationMs / 1000},setpts=PTS-STARTPTS[c${index}]`)
      .join(";") + ";" +
      frames.map((_, index) => `[c${index}]`).join("") +
      `concat=n=${frames.length}:v=1:a=0[vout]`;
    return `${streams};${concat}`;
  }

  const transitionSec = Math.max(0.1, project.transitionDurationMs / 1000);
  const clipSec = Math.max(transitionSec + 0.1, project.frameDurationMs / 1000);
  const staged = frames
    .map((_, index) => `[v${index}]trim=duration=${clipSec},setpts=PTS-STARTPTS[c${index}]`)
    .join(";");
  let acc = clipSec;
  const xfadeParts = [];
  for (let i = 1; i < frames.length; i += 1) {
    const out = i === frames.length - 1 ? "[vout]" : `[xf${i}]`;
    const inputA = i === 1 ? "[c0]" : `[xf${i - 1}]`;
    const inputB = `[c${i}]`;
    const offset = Math.max(0, acc - transitionSec);
    xfadeParts.push(`${inputA}${inputB}xfade=transition=fade:duration=${transitionSec}:offset=${offset}${out}`);
    acc += clipSec - transitionSec;
  }
  return `${streams};${staged};${xfadeParts.join(";")}`;
}

function buildSegmentVideoInputFilter(segmentCount, segmentDurationSec, transitionSec) {
  const normalized = Array.from({ length: segmentCount }, (_, index) => {
    return `[${index}:v]setpts=PTS-STARTPTS,format=yuv420p[s${index}]`;
  }).join(";");

  if (segmentCount < 2) {
    return `${normalized};[s0]copy[vout]`;
  }

  let acc = segmentDurationSec[0];
  const xfadeParts = [];
  for (let i = 1; i < segmentCount; i += 1) {
    const out = i === segmentCount - 1 ? "[vout]" : `[sx${i}]`;
    const inputA = i === 1 ? "[s0]" : `[sx${i - 1}]`;
    const inputB = `[s${i}]`;
    const offset = Math.max(0, acc - transitionSec);
    xfadeParts.push(`${inputA}${inputB}xfade=transition=fade:duration=${transitionSec}:offset=${offset}${out}`);
    acc += segmentDurationSec[i] - transitionSec;
  }

  return `${normalized};${xfadeParts.join(";")}`;
}

function shouldUseInlineXfade(frames, project) {
  if (!project.transitionEnabled || frames.length < 2) {
    return false;
  }
  // Guardrail against Windows CreateProcess command-line limit (~32k chars).
  // We keep transitions enabled for large projects and only fallback when the
  // generated ffmpeg command is likely too long to start reliably.
  const transitionSec = Math.max(0.1, Number(project.transitionDurationMs || 300) / 1000);
  const frameDurationSec = Math.max(0.1, Number(project.frameDurationMs || 2000) / 1000);
  const transitionClipSec = Math.max(transitionSec + 0.1, frameDurationSec);
  const perInputArgsLength = frames.reduce(
    (sum, frame) =>
      sum +
      "-loop".length +
      1 +
      "1".length +
      1 +
      "-t".length +
      1 +
      String(transitionClipSec).length +
      1 +
      "-i".length +
      1 +
      String(frame.filePath || "").length +
      1,
    0
  );
  const fixedArgsLength =
    "-hide_banner -loglevel info -stats -filter_complex_script C:/tmp/filter.txt ".length +
    " -map [vout] -c:v libopenh264 -b:v 10M -maxrate 14M -bufsize 20M -g 60 -bf 0 -force_key_frames 0 -pix_fmt yuv420p -r 30 -movflags +faststart -y output.mp4".length;
  const estimatedCommandLength = perInputArgsLength + fixedArgsLength;

  return estimatedCommandLength < 30000;
}

async function renderFramesWithInlineXfade({
  ffmpegPath,
  ffmpegEnv,
  frames,
  project,
  videoEncoder,
  outputPath,
  filterScriptPath,
  onStderr,
  timeoutMs = 0,
}) {
  const transitionSec = Math.max(0.1, Number(project.transitionDurationMs || 300) / 1000);
  const frameDurationSec = Math.max(0.1, Number(project.frameDurationMs || 2000) / 1000);
  const transitionClipSec = Math.max(transitionSec + 0.1, frameDurationSec);

  fs.writeFileSync(filterScriptPath, `${buildFrameInputFilter(frames, project)}\n`, "utf8");
  const args = [];
  for (const frame of frames) {
    args.push("-loop", "1", "-t", `${transitionClipSec}`, "-i", frame.filePath);
  }
  args.push(
    "-hide_banner",
    "-loglevel",
    "info",
    "-stats",
    "-filter_complex_script",
    filterScriptPath,
    "-map",
    "[vout]",
    "-c:v",
    videoEncoder,
    "-b:v",
    "10M",
    "-maxrate",
    "14M",
    "-bufsize",
    "20M",
    "-g",
    "60",
    "-bf",
    "0",
    "-force_key_frames",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-movflags",
    "+faststart",
    "-y",
    outputPath
  );
  await runFfmpegCommand(ffmpegPath, args, ffmpegEnv, onStderr, timeoutMs);
}

function buildAdaptiveRenderTimeoutMs(expectedDurationSec, minTimeoutMs = 240000) {
  // Dynamic timeout for long renders:
  // - minimum 4 minutes
  // - roughly 2.5x of expected media duration plus startup/finalization buffer
  const durationMs = Math.max(0, Number(expectedDurationSec || 0) * 1000);
  const adaptive = durationMs * 2.5 + 120000;
  return Math.max(minTimeoutMs, Math.round(adaptive));
}

function runFfmpegCommand(ffmpegPath, args, envPatch = {}, onStderr, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, ...envPatch },
      windowsHide: true,
    });
    let finished = false;
    let timeout = null;
    let timedOut = false;
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (finished) {
          return;
        }
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch (_) {
          // ignore
        }
      }, timeoutMs);
    }

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) {
        onStderr(text);
      }
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(new Error(`FFmpeg process spawn failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve();
        return;
      }
      if (timedOut) {
        reject(new Error(`FFmpeg timed out after ${timeoutMs}ms\n${stderr.slice(-4000)}`));
        return;
      }
      reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

function buildFfmpegEnv(ffmpegPath) {
  const ffmpegBinDir = ffmpegPath === "ffmpeg" ? "" : path.dirname(ffmpegPath);
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return {
    PATH: [ffmpegBinDir, `${systemRoot}\\System32`, systemRoot].filter(Boolean).join(";"),
  };
}

async function runRender(jobId) {
  const setBootstrapStep = (step, message = null) => {
    updateRenderDebug(jobId, {
      stage: "starting",
      bootstrapStep: step,
      lastMessage: message,
    });
  };
  setBootstrapStep("load-job");
  const job = await getRenderJob(jobId);
  if (!job) {
    return;
  }
  setBootstrapStep("load-project");
  const project = await getProject(job.projectId);
  setBootstrapStep("load-frames");
  const dbFrames = await all(
    "SELECT filePath, orderIndex FROM frames WHERE projectId = ? ORDER BY orderIndex ASC",
    [job.projectId]
  );
  if (!project || dbFrames.length === 0) {
    await setJobState(jobId, { status: "failed", error: "No frames to render", progress: 0 });
    updateRenderDebug(jobId, { stage: "finalizing", lastMessage: "No frames to render" });
    return;
  }
  let frames = dbFrames;

  const outputPath = path.join(RENDERS_DIR, `${jobId}.mp4`);
  setBootstrapStep("set-running-state");
  await setJobState(jobId, { status: "running", progress: 1, outputPath });
  const transitionRequested = Boolean(project.transitionEnabled);
  const useInlineXfade = shouldUseInlineXfade(frames, project);
  const useSimpleConcat = !transitionRequested || frames.length < 2;
  const useSegmentedXfade = transitionRequested && frames.length >= 2 && !useInlineXfade;
  const frameDurationSec = Math.max(0.1, Number(project.frameDurationMs || 2000) / 1000);
  const transitionSec = Math.max(0.1, Number(project.transitionDurationMs || 300) / 1000);
  const transitionClipSec = Math.max(transitionSec + 0.1, frameDurationSec);
  // Progress must follow the actual render path duration, otherwise it jumps to 95 immediately.
  const expectedDurationSec = useSimpleConcat
    ? frames.length * frameDurationSec
    : Math.max(
        0.1,
        frames.length * transitionClipSec - (frames.length - 1) * transitionSec
      );
  const expectedFrames = Math.max(1, Math.round(expectedDurationSec * 30));
  const mainTimeoutMs = buildAdaptiveRenderTimeoutMs(expectedDurationSec, 240000);
  let stderrTail = "";
  let lastProgress = 1;
  let lastHeartbeatAt = Date.now();
  const updateProgress = (nextPct) => {
    const pct = Math.max(1, Math.min(99, Number(nextPct) || 1));
    if (pct > lastProgress) {
      lastProgress = pct;
      setJobState(jobId, { progress: pct }).catch(() => {});
      lastHeartbeatAt = Date.now();
    }
  };
  const updateProgressFromTimemark = (text, durationSec, minPct, maxPct) => {
    if (!durationSec || durationSec <= 0) {
      return;
    }
    const match = String(text || "").match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (!match) {
      return;
    }
    const timeSec = parseTimemarkToSeconds(match[1]);
    const normalized = Math.max(0, Math.min(1, timeSec / durationSec));
    const pct = minPct + normalized * (maxPct - minPct);
    updateProgress(pct);
  };
  setBootstrapStep("resolve-ffmpeg");
  const ffmpegPath = resolveFfmpegPath();
  setBootstrapStep("resolve-encoder");
  const videoEncoder = resolveVideoEncoder();
  setBootstrapStep(
    "select-render-path",
    `transition=${transitionRequested} inlineXfade=${useInlineXfade} segmentedXfade=${useSegmentedXfade} concat=${useSimpleConcat}`
  );

  const ffmpegEnv = buildFfmpegEnv(ffmpegPath);
  const listFilePath = path.join(RENDERS_DIR, `${jobId}.concat.txt`);
  const filterScriptPath = path.join(RENDERS_DIR, `${jobId}.filter_complex.txt`);
  const chunkFilterScriptPath = path.join(RENDERS_DIR, `${jobId}.chunk.filter_complex.txt`);
  try {
    setBootstrapStep("build-ffmpeg-args");
    let args = [];
    if (useSimpleConcat) {
      updateRenderDebug(jobId, { renderMode: "concat" });
      const lines = [];
      for (const frame of frames) {
        lines.push(`file '${escapeConcatPath(frame.filePath)}'`);
        lines.push(`duration ${frameDurationSec}`);
      }
      lines.push(`file '${escapeConcatPath(frames[frames.length - 1].filePath)}'`);
      fs.writeFileSync(listFilePath, `${lines.join("\n")}\n`, "utf8");
      args = [
        "-hide_banner",
        "-loglevel",
        "info",
        "-stats",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFilePath,
        "-vf",
        "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p",
        "-avoid_negative_ts",
        "make_zero",
        "-fps_mode",
        "vfr",
        "-c:v",
        videoEncoder,
        "-b:v",
        "10M",
        "-maxrate",
        "14M",
        "-bufsize",
        "20M",
        "-g",
        "60",
        "-bf",
        "0",
        "-force_key_frames",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ];
    } else if (useInlineXfade) {
      updateRenderDebug(jobId, { renderMode: "inlineXfade" });
      await renderFramesWithInlineXfade({
        ffmpegPath,
        ffmpegEnv,
        frames,
        project,
        videoEncoder,
        outputPath,
        filterScriptPath,
        timeoutMs: mainTimeoutMs,
        onStderr: (line) => {
          const text = String(line || "");
          stderrTail = `${stderrTail}\n${text}`.slice(-4000);
          updateRenderDebug(jobId, { stage: "encoding", lastMessage: text.trim().slice(-180) });
          updateProgressFromTimemark(text, expectedDurationSec, 1, 99);
          if (Date.now() - lastHeartbeatAt > 5000) {
            setJobState(jobId, { progress: lastProgress }).catch(() => {});
            lastHeartbeatAt = Date.now();
          }
        },
      });
      args = null;
    } else if (useSegmentedXfade) {
      updateRenderDebug(jobId, { renderMode: "segmentedXfade" });
      const chunkSize = RENDER_CHUNK_SIZE;
      const chunks = [];
      for (let i = 0; i < frames.length; i += chunkSize) {
        chunks.push(frames.slice(i, i + chunkSize));
      }
      const chunkPaths = [];
      const chunkDurations = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkOutputPath = path.join(RENDERS_DIR, `${jobId}.chunk.${i}.mp4`);
        const chunkScriptPath = path.join(RENDERS_DIR, `${jobId}.chunk.${i}.filter.txt`);
        const n = chunks[i].length;
        const chunkDuration = Math.max(0.1, n * transitionClipSec - (n - 1) * transitionSec);
        const chunkTimeoutMs = buildAdaptiveRenderTimeoutMs(chunkDuration, 240000);
        const chunkStartPct = 1 + (i / chunks.length) * 85;
        const chunkEndPct = 1 + ((i + 1) / chunks.length) * 85;
        updateProgress(chunkStartPct);
        await renderFramesWithInlineXfade({
          ffmpegPath,
          ffmpegEnv,
          frames: chunks[i],
          project,
          videoEncoder,
          outputPath: chunkOutputPath,
          filterScriptPath: chunkScriptPath,
          timeoutMs: chunkTimeoutMs,
          onStderr: (line) => {
            const text = String(line || "");
            stderrTail = `${stderrTail}\n${text}`.slice(-4000);
            updateRenderDebug(jobId, { stage: "encoding", lastMessage: `chunk ${i + 1}/${chunks.length}: ${text.trim().slice(-140)}` });
            updateProgressFromTimemark(text, chunkDuration, chunkStartPct, chunkEndPct);
            if (Date.now() - lastHeartbeatAt > 5000) {
              setJobState(jobId, { progress: lastProgress }).catch(() => {});
              lastHeartbeatAt = Date.now();
            }
          },
        });
        updateProgress(chunkEndPct);
        chunkPaths.push(chunkOutputPath);
        chunkDurations.push(chunkDuration);
        fs.rmSync(chunkScriptPath, { force: true });
      }

      fs.writeFileSync(
        chunkFilterScriptPath,
        `${buildSegmentVideoInputFilter(chunkPaths.length, chunkDurations, transitionSec)}\n`,
        "utf8"
      );
      const mergeArgs = [];
      for (const chunkPath of chunkPaths) {
        mergeArgs.push("-i", chunkPath);
      }
      mergeArgs.push(
        "-hide_banner",
        "-loglevel",
        "info",
        "-stats",
        "-filter_complex_script",
        chunkFilterScriptPath,
        "-map",
        "[vout]",
        "-c:v",
        videoEncoder,
        "-b:v",
        "10M",
        "-maxrate",
        "14M",
        "-bufsize",
        "20M",
        "-g",
        "60",
        "-bf",
        "0",
        "-force_key_frames",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-movflags",
        "+faststart",
        "-y",
        outputPath
      );
      await runFfmpegCommand(
        ffmpegPath,
        mergeArgs,
        ffmpegEnv,
        (line) => {
          const text = String(line || "");
          stderrTail = `${stderrTail}\n${text}`.slice(-4000);
          updateRenderDebug(jobId, { stage: "encoding", lastMessage: `merge chunks: ${text.trim().slice(-140)}` });
          const mergeDurationSec = Math.max(
            0.1,
            chunkDurations.reduce((sum, value) => sum + value, 0) -
              Math.max(0, (chunkDurations.length - 1) * transitionSec)
          );
          updateProgressFromTimemark(text, mergeDurationSec, 86, 99);
          if (Date.now() - lastHeartbeatAt > 5000) {
            setJobState(jobId, { progress: lastProgress }).catch(() => {});
            lastHeartbeatAt = Date.now();
          }
        },
        buildAdaptiveRenderTimeoutMs(
          Math.max(
            0.1,
            chunkDurations.reduce((sum, value) => sum + value, 0) -
              Math.max(0, (chunkDurations.length - 1) * transitionSec)
          ),
          360000
        )
      );
      for (const chunkPath of chunkPaths) {
        fs.rmSync(chunkPath, { force: true });
      }
      args = null;
    }

    if (args) {
      setBootstrapStep("spawn-ffmpeg");
      await runFfmpegCommand(
        ffmpegPath,
        args,
        ffmpegEnv,
        (line) => {
          const text = String(line || "");
          stderrTail = `${stderrTail}\n${text}`.slice(-4000);
          updateRenderDebug(jobId, { stage: "encoding", lastMessage: text.trim().slice(-180) });
          const frameMatch = text.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            const frameNo = Number(frameMatch[1]);
            if (!Number.isNaN(frameNo) && frameNo >= 0) {
              const pctByFrame = Math.max(1, Math.min(99, (frameNo / expectedFrames) * 99));
              updateProgress(pctByFrame);
            }
          }
          const match = text.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
          if (match && expectedDurationSec > 0) {
            const timeSec = parseTimemarkToSeconds(match[1]);
            const pct = Math.max(1, Math.min(99, (timeSec / expectedDurationSec) * 99));
            updateProgress(pct);
          }
          if (Date.now() - lastHeartbeatAt > 5000) {
            setJobState(jobId, { progress: lastProgress }).catch(() => {});
            lastHeartbeatAt = Date.now();
          }
        },
        mainTimeoutMs
      );
    }
    await setJobState(jobId, { status: "done", progress: 100, outputPath, error: null });
    updateRenderDebug(jobId, { stage: "finalizing", lastMessage: null });
  } catch (error) {
    const detail = stderrTail ? `${error.message}\n${stderrTail}` : error.message;
    await setJobState(jobId, { status: "failed", progress: 0, error: detail });
    updateRenderDebug(jobId, { stage: "finalizing", lastMessage: detail });
  } finally {
    fs.rmSync(listFilePath, { force: true });
    fs.rmSync(filterScriptPath, { force: true });
    fs.rmSync(chunkFilterScriptPath, { force: true });
  }
}

module.exports = {
  createRenderJob,
  getRenderJob,
  getRenderDebug,
};
