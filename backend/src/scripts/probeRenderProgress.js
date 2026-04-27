async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    // eslint-disable-next-line no-console
    console.error("Usage: node src/scripts/probeRenderProgress.js <projectId>");
    process.exit(1);
  }

  const start = await fetch(`http://localhost:4000/api/projects/${projectId}/render`, {
    method: "POST",
  });
  const job = await start.json();
  // eslint-disable-next-line no-console
  console.log(`JOB ${job.id}`);

  for (let i = 0; i < 120; i += 1) {
    const response = await fetch(`http://localhost:4000/api/render-jobs/${job.id}/debug`);
    const debug = await response.json();
    // eslint-disable-next-line no-console
    console.log(
      `${i}: status=${debug.status} stage=${debug.stage} progress=${Math.floor(
        debug.progress || 0
      )} msg=${(debug.lastMessage || "").slice(0, 80)}`
    );
    if (debug.status === "done" || debug.status === "failed") {
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
