const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const isDev = !app.isPackaged;
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {}
  return { backendUrl: process.env.BACKEND_URL || (isDev ? "http://localhost:8004" : "http://167.86.81.188:8004") };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function sendUpdateStatus(type, payload = {}) {
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send("update-status", { type, ...payload })
  );
}

if (!isDev) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking"));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("not-available"));
  autoUpdater.on("download-progress", (p) => sendUpdateStatus("downloading", { percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus("downloaded", { version: info.version }));
  autoUpdater.on("error", (err) => sendUpdateStatus("error", { message: err.message }));
}

function createWindow() {
  const iconPath = path.join(__dirname, "../assets/icon.png");
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── File picker ──────────────────────────────────────────────────────────────
ipcMain.handle("select-file", async (_, filters = []) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ["openFile"], filters });
  return filePaths[0] || null;
});

ipcMain.handle("select-files", async (_, filters = []) => {
  const { filePaths } = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters });
  return filePaths || [];
});

ipcMain.handle("open-output", (_, filePath) => shell.openPath(filePath));

// ── Config ───────────────────────────────────────────────────────────────────
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_, cfg) => { saveConfig(cfg); return true; });

// ── Updates ──────────────────────────────────────────────────────────────────
ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-for-updates", () => {
  if (isDev) {
    sendUpdateStatus("dev-mode");
    return;
  }
  autoUpdater.checkForUpdates();
});

ipcMain.handle("download-update", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle("install-update", () => {
  autoUpdater.quitAndInstall();
});

// ── Run process_video.py ─────────────────────────────────────────────────────
const runningAnnotations = new Map(); // annotationId -> { proc, cancelled }

ipcMain.handle("cancel-annotation", (_, annotationId) => {
  const entry = runningAnnotations.get(String(annotationId));
  if (!entry) return false;
  entry.cancelled = true;
  entry.proc.kill();
  return true;
});

ipcMain.handle("run-annotation", async (event, args) => {
  const { videoPath, tier, framesPerSec, context, apiKey, model, apiUrl, annotationId, screenshotPaths = [] } = args;

  const isWin = process.platform === "win32";

  const scriptArgs = [
    "--video", videoPath,
    "--tier", tier,
    "--frames-per-sec", String(framesPerSec),
    "--api-key", apiKey,
    "--model", model,
    "--api-url", apiUrl,
    "--annotation-id", String(annotationId),
  ];
  if (context) scriptArgs.push("--context", context);
  if (screenshotPaths.length > 0) scriptArgs.push("--screenshots", ...screenshotPaths);

  let proc;
  if (isDev) {
    const pyScript = path.join(__dirname, "../process_video.py");
    proc = spawn(isWin ? "python" : "python3", [pyScript, ...scriptArgs], { env: { ...process.env } });
  } else if (isWin) {
    // Packaged Windows: run the bundled PyInstaller exe directly (no Python required)
    const exePath = path.join(process.resourcesPath, "process_video.exe");
    proc = spawn(exePath, scriptArgs, { env: { ...process.env } });
  } else {
    // Packaged Linux/Mac: run python3 with the bundled script
    const pyScript = path.join(process.resourcesPath, "process_video.py");
    proc = spawn("python3", [pyScript, ...scriptArgs], { env: { ...process.env } });
  }

  const procEntry = { proc, cancelled: false };
  runningAnnotations.set(String(annotationId), procEntry);

  return new Promise((resolve, reject) => {

    let lastResult = null;
    let pythonError = null;
    const stderrLines = [];

    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          event.sender.send("annotation-progress", parsed);
          if (parsed.event === "done") lastResult = parsed;
          if (parsed.event === "error") pythonError = parsed.message;
        } catch {}
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      console.error("[Python]", text.trim());
      stderrLines.push(text);
      event.sender.send("annotation-progress", { event: "log", message: text });
    });

    proc.on("close", (code) => {
      runningAnnotations.delete(String(annotationId));
      if (procEntry.cancelled) {
        reject(new Error("CANCELLED"));
      } else if (code === 0 && lastResult) {
        resolve(lastResult);
      } else {
        const detail = pythonError || stderrLines.join("").trim().split("\n").pop() || `Exit code ${code}`;
        reject(new Error(detail));
      }
    });
  });
});
