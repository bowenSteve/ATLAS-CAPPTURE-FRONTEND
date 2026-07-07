const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selectFile: (filters) => ipcRenderer.invoke("select-file", filters),
  selectFiles: (filters) => ipcRenderer.invoke("select-files", filters),
  openOutput: (path) => ipcRenderer.invoke("open-output", path),
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  runAnnotation: (args) => ipcRenderer.invoke("run-annotation", args),
  cancelAnnotation: (annotationId) => ipcRenderer.invoke("cancel-annotation", annotationId),
  onProgress: (cb) => ipcRenderer.on("annotation-progress", (_, data) => cb(data)),
  removeProgressListener: () => ipcRenderer.removeAllListeners("annotation-progress"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: (cb) => ipcRenderer.on("update-status", (_, data) => cb(data)),
  removeUpdateListener: () => ipcRenderer.removeAllListeners("update-status"),
});
