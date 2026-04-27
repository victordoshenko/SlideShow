const express = require("express");
const cors = require("cors");
const { PROJECTS_DIR } = require("./config");
const projectRoutes = require("./routes/projects");
const jobRoutes = require("./routes/jobs");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/media/projects", express.static(PROJECTS_DIR));

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.use("/api/projects", projectRoutes);
app.use("/api/render-jobs", jobRoutes);

app.use((error, _, res, __) => {
  res.status(500).json({ error: error.message || "Internal server error" });
});

module.exports = app;
