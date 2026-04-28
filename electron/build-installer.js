const path = require("path");
const fs = require("fs");
const { createWindowsInstaller } = require("electron-winstaller");

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const appDirectory = path.join(rootDir, "releases", "SlideShow-win32-x64");
  const outputDirectory = path.join(rootDir, "releases", "installer");

  if (!fs.existsSync(appDirectory)) {
    throw new Error(
      "Packaged app folder not found. Run `npm run electron:build` before creating installer."
    );
  }

  await createWindowsInstaller({
    appDirectory,
    outputDirectory,
    authors: "SlideShow",
    exe: "SlideShow.exe",
    setupExe: "SlideShow-Setup.exe",
    noMsi: true,
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
