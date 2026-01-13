const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 打开文件夹
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  
  // 获取上传路径
  getUploadPath: () => ipcRenderer.invoke('get-upload-path')
});
