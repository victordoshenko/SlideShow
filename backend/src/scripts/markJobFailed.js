const { run } = require("../services/db");

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    // eslint-disable-next-line no-console
    console.error("Usage: node src/scripts/markJobFailed.js <jobId>");
    process.exit(1);
  }

  await run(
    "UPDATE render_jobs SET status = 'failed', error = 'Render process ended unexpectedly', updatedAt = ? WHERE id = ?",
    [new Date().toISOString(), jobId]
  );
  // eslint-disable-next-line no-console
  console.log(`Marked failed: ${jobId}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
