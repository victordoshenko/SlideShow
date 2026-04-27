const fs = require("fs");
const path = require("path");
const { ALLOWED_IMAGE_EXTENSIONS } = require("../config");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isAllowedImage(fileName) {
  return ALLOWED_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

module.exports = {
  ensureDir,
  sanitizeFileName,
  isAllowedImage,
};
