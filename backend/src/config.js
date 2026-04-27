const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");

module.exports = {
  PORT: process.env.PORT || 4000,
  ROOT_DIR,
  STORAGE_DIR,
  PROJECTS_DIR: path.join(STORAGE_DIR, "projects"),
  RENDERS_DIR: path.join(STORAGE_DIR, "renders"),
  TMP_DIR: path.join(STORAGE_DIR, "tmp"),
  DB_PATH: path.join(STORAGE_DIR, "slideshow.db"),
  MAX_FILES: 10000,
  RENDER_CHUNK_SIZE: Math.max(2, Number(process.env.RENDER_CHUNK_SIZE || 50)),
  ALLOWED_IMAGE_EXTENSIONS: new Set([".jpg", ".jpeg", ".png", ".webp"]),
};
