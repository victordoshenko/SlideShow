const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const STORAGE_DIR = process.env.SLIDESHOW_STORAGE_DIR
  ? path.resolve(process.env.SLIDESHOW_STORAGE_DIR)
  : path.join(ROOT_DIR, "storage");

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
  TRANSITION_OUTPUT_FPS: Math.max(6, Number(process.env.TRANSITION_OUTPUT_FPS || 8)),
  VIDEO_CRF: Math.max(16, Math.min(35, Number(process.env.VIDEO_CRF || 24))),
  OPENH264_TRANSITION_BITRATE_K: Math.max(
    800,
    Number(process.env.OPENH264_TRANSITION_BITRATE_K || 1100)
  ),
  OPENH264_BASE_BITRATE_K: Math.max(
    700,
    Number(process.env.OPENH264_BASE_BITRATE_K || 900)
  ),
  ALLOWED_IMAGE_EXTENSIONS: new Set([".jpg", ".jpeg", ".png", ".webp"]),
};
