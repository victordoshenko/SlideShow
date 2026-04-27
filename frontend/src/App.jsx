import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  buildDownloadUrl,
  createProject,
  getFrames,
  getRenderJob,
  getRenderJobDebug,
  startRender,
  updateSettings,
  uploadFiles,
  uploadZip,
} from "./api";

function App() {
  const [project, setProject] = useState(null);
  const [frames, setFrames] = useState([]);
  const [totalFrames, setTotalFrames] = useState(0);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renderJob, setRenderJob] = useState(null);
  const [renderDebug, setRenderDebug] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({
    active: false,
    label: "",
    pct: 0,
  });

  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const filmstripRef = useRef(null);

  async function refreshFrames(projectId, onProgress) {
    if (!projectId) return;
    setLoadingFrames(true);
    try {
      const pageSize = onProgress ? 100 : 1000;
      const firstPage = await getFrames(projectId, 0, pageSize);
      const allFrames = [...firstPage.frames];
      const total = Math.max(firstPage.total || 0, allFrames.length || 0);
      if (onProgress) {
        const firstPct = total > 0 ? (allFrames.length / total) * 100 : 100;
        onProgress(Math.max(0, Math.min(100, firstPct)));
      }
      let offset = firstPage.frames.length;
      while (offset < firstPage.total && allFrames.length < 10000) {
        const page = await getFrames(projectId, offset, pageSize);
        allFrames.push(...page.frames);
        offset += page.frames.length;
        if (onProgress) {
          const pct = total > 0 ? (allFrames.length / total) * 100 : 100;
          onProgress(Math.max(0, Math.min(100, pct)));
        }
        if (page.frames.length === 0) break;
      }
      setFrames(allFrames);
      setTotalFrames(firstPage.total);
      if (onProgress) {
        onProgress(100);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingFrames(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    createProject(`Project ${new Date().toLocaleString()}`)
      .then(async (value) => {
        if (!mounted) return;
        setProject(value);
        await refreshFrames(value.id);
      })
      .catch((err) => setError(err.message));

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!renderJob?.id || renderJob.status === "done" || renderJob.status === "failed") {
      return undefined;
    }
    const timer = setInterval(async () => {
      try {
        const [fresh, debug] = await Promise.all([
          getRenderJob(renderJob.id),
          getRenderJobDebug(renderJob.id),
        ]);
        setRenderJob(fresh);
        setRenderDebug(debug);
      } catch (err) {
        setError(err.message);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [renderJob]);

  const totalDuration = useMemo(() => {
    if (!project) return 0;
    const overlap = project.transitionEnabled
      ? ((Math.max(0, totalFrames - 1) * project.transitionDurationMs) || 0)
      : 0;
    return Math.max(0, totalFrames * project.frameDurationMs - overlap);
  }, [project, totalFrames]);
  const normalizedActiveFrameIndex = Math.min(activeFrameIndex, Math.max(0, frames.length - 1));
  const activeFrame = frames[normalizedActiveFrameIndex];
  const renderProgressLabel = renderJob
    ? `${Number(renderJob.progress || 0).toFixed(2)}%`
    : "0.00%";

  async function onUploadFiles(event) {
    const selected = Array.from(event.target.files || []);
    if (!project || selected.length === 0) return;
    setBusy(true);
    setError("");
    try {
      setUploadProgress({ active: true, label: "Uploading photos", pct: 0 });
      const result = await uploadFiles(project.id, selected, {
        onTransferProgress: (pct) =>
          setUploadProgress((prev) => ({
            active: true,
            label: "Uploading photos",
            // Do not inflate progress by transfer bytes; keep a small activity indicator
            // until server starts reporting processed/total.
            pct: Math.max(prev.pct, Math.min(5, Number(pct || 0) * 0.05)),
          })),
        onServerProgress: (status) =>
          setUploadProgress((prev) => ({
            active: true,
            label:
              status.phase === "ready"
                ? "Ready"
                : `Processing photos${
                    Number(status.total || 0) > 0
                      ? ` (${Number(status.processed || 0)}/${Number(status.total || 0)})`
                      : ""
                  }`,
            pct: Math.max(
              prev.pct,
              status.phase === "ready"
                ? 100
                : Math.max(
                    0,
                    Math.min(
                      100,
                      Number(status.total || 0) > 0
                        ? (Number(status.processed || 0) / Number(status.total || 1)) * 100
                        : Number(status.progress || 0)
                    )
                  )
            ),
          })),
      });
      setTotalFrames(Number(result?.total || 0));
      await refreshFrames(project.id);
      setActiveFrameIndex(0);
      setUploadProgress({ active: true, label: "Ready", pct: 100 });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setTimeout(() => setUploadProgress({ active: false, label: "", pct: 0 }), 250);
      event.target.value = "";
    }
  }

  async function onUploadZip(event) {
    const zipFile = event.target.files?.[0];
    if (!project || !zipFile) return;
    setBusy(true);
    setError("");
    try {
      setUploadProgress({ active: true, label: "Uploading ZIP", pct: 0 });
      const result = await uploadZip(project.id, zipFile, {
        onTransferProgress: (pct) =>
          setUploadProgress((prev) => ({
            active: true,
            label: "Uploading ZIP",
            // Do not inflate progress by transfer bytes; keep a small activity indicator
            // until server starts reporting processed/total.
            pct: Math.max(prev.pct, Math.min(5, Number(pct || 0) * 0.05)),
          })),
        onServerProgress: (status) =>
          setUploadProgress((prev) => ({
            active: true,
            label:
              status.phase === "ready"
                ? "Ready"
                : `Processing photos${
                    Number(status.total || 0) > 0
                      ? ` (${Number(status.processed || 0)}/${Number(status.total || 0)})`
                      : ""
                  }`,
            pct: Math.max(
              prev.pct,
              status.phase === "ready"
                ? 100
                : Math.max(
                    0,
                    Math.min(
                      100,
                      Number(status.total || 0) > 0
                        ? (Number(status.processed || 0) / Number(status.total || 1)) * 100
                        : Number(status.progress || 0)
                    )
                  )
            ),
          })),
      });
      setTotalFrames(Number(result?.total || 0));
      await refreshFrames(project.id);
      setActiveFrameIndex(0);
      setUploadProgress({ active: true, label: "Ready", pct: 100 });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setTimeout(() => setUploadProgress({ active: false, label: "", pct: 0 }), 250);
      event.target.value = "";
    }
  }

  async function onUpdateSettings(next) {
    if (!project) return;
    setBusy(true);
    try {
      const updated = await updateSettings(project.id, next);
      setProject(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onRender() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const createdJob = await startRender(project.id);
      setRenderJob(createdJob);
      setRenderDebug(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!filmstripRef.current) return;
    const thumb = filmstripRef.current.querySelector(`[data-index="${normalizedActiveFrameIndex}"]`);
    if (thumb) {
      thumb.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [normalizedActiveFrameIndex]);

  function onSelectFrame(index) {
    setActiveFrameIndex(index);
  }

  return (
    <main className="layout">
      <h1>Photo to Video Studio</h1>
      <p className="muted">
        Upload up to 10,000 photos, adjust frame pause and transitions, then render MP4 (1080p
        30fps).
      </p>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Uploads</h2>
        <div className="uploadRow">
          <label>
            Upload photos
            <input type="file" multiple accept=".jpg,.jpeg,.png,.webp" onChange={onUploadFiles} />
          </label>
          <label>
            Upload ZIP
            <input type="file" accept=".zip" onChange={onUploadZip} />
          </label>
        </div>
        {uploadProgress.active && (
          <div className="uploadProgress">
            <div className="uploadProgressHeader">
              <span>{uploadProgress.label}</span>
              <span>{Math.floor(uploadProgress.pct)}%</span>
            </div>
            <div className="uploadBar">
              <div className="uploadBarFill" style={{ width: `${uploadProgress.pct}%` }} />
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Settings</h2>
        <div className="settingsGrid">
          <label>
            Frame pause (ms)
            <input
              type="number"
              min={200}
              max={20000}
              value={project?.frameDurationMs || 4000}
              onChange={(event) =>
                onUpdateSettings({ frameDurationMs: Number(event.target.value || 4000) })
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(project?.transitionEnabled)}
              onChange={(event) => onUpdateSettings({ transitionEnabled: event.target.checked })}
            />
            Smooth transition
          </label>
          <label>
            Transition duration (ms)
            <input
              type="number"
              min={100}
              max={5000}
              value={project?.transitionDurationMs || 400}
              onChange={(event) =>
                onUpdateSettings({ transitionDurationMs: Number(event.target.value || 400) })
              }
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Storyboard preview</h2>
        <p className="muted">
          Frames: {totalFrames}
          {totalFrames > 0 ? ` | Total duration: ${(totalDuration / 1000).toFixed(2)} sec` : ""}
        </p>
        {loadingFrames ? (
          <p>Loading frames...</p>
        ) : (
          <>
            <div className="previewStage">
              {activeFrame ? (
                <img src={activeFrame.previewUrl} alt={activeFrame.fileName} className="previewImage" />
              ) : (
                <div className="previewEmpty">Upload images to preview</div>
              )}
            </div>
            <div className="filmstripWrap">
              <div className="filmstrip" ref={filmstripRef}>
                {frames.map((frame, index) => (
                  <button
                    type="button"
                    key={frame.id}
                    className={`filmThumb ${index === normalizedActiveFrameIndex ? "active" : ""}`}
                    onClick={() => onSelectFrame(index)}
                    data-index={index}
                  >
                    <img src={frame.previewUrl} alt={frame.fileName} />
                    <span>#{index + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {renderJob?.status === "done" && (
        <section className="card">
          <h2>Render</h2>
          <div className="renderStatus">
            <p>
              Job: <code>{renderJob.id}</code> | Status: {renderJob.status} | Progress:{" "}
              {renderProgressLabel}
            </p>
            <a href={buildDownloadUrl(renderJob.id)}>Download MP4</a>
          </div>
        </section>
      )}

      <div className="renderDock">
        <div>
          <strong>Video render</strong>
          <p className="muted">
            {renderJob
              ? `Status: ${renderJob.status}, ${renderProgressLabel}`
              : "Ready to render"}
          </p>
          {renderJob?.id && (
            <p className="muted">
              Job ID: <code>{renderJob.id}</code>
            </p>
          )}
          {renderDebug && (
            <div className="renderDebug">
              <p className="muted">
                Stage: <code>{renderDebug.stage || "-"}</code>
                {renderDebug.bootstrapStep
                  ? ` | Step: ${renderDebug.bootstrapStep}`
                  : ""}
                {renderDebug.renderMode ? ` | Mode: ${renderDebug.renderMode}` : ""}
              </p>
              {renderDebug.lastMessage && (
                <p className="muted renderDebugMessage">
                  Last log: <code>{renderDebug.lastMessage}</code>
                </p>
              )}
            </div>
          )}
        </div>
        <div className="renderDockActions">
          <button type="button" disabled={busy || totalFrames === 0} onClick={onRender}>
            {busy ? "Working..." : "Render video"}
          </button>
          {renderJob?.id && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(renderJob.id);
                } catch {
                  // no-op fallback: ID remains visible for manual copy
                }
              }}
            >
              Copy ID
            </button>
          )}
          {renderJob?.status === "done" && (
            <a href={buildDownloadUrl(renderJob.id)} className="downloadBtn">
              Download MP4
            </a>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
