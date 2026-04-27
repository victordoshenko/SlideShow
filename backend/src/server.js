const { PORT } = require("./config");
const { initDb, failStaleRunningJobs } = require("./services/db");
const app = require("./app");

async function start() {
  await initDb();
  setInterval(() => {
    failStaleRunningJobs(45).catch(() => {});
  }, 15000);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend started on http://localhost:${PORT}`);
  });
}

start();
