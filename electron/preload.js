const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selectFile: (filters) => ipcRenderer.invoke("select-file", filters),
  openOutput: (path) => ipcRenderer.invoke("open-output", path),
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  runAnnotation: (args) => ipcRenderer.invoke("run-annotation", args),
  onProgress: (cb) => ipcRenderer.on("annotation-progress", (_, data) => cb(data)),
  removeProgressListener: () => ipcRenderer.removeAllListeners("annotation-progress"),
});
