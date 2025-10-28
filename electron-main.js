const { app, BrowserWindow, Tray, Menu, dialog } = require('electron');
const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');

let mainWindow;
let tray;
let server;

// 获取本机IP地址
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// 直接在 Electron 中启动 Express 服务器
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // 引入服务器代码
      const serverModule = require('./server.js');
      
      // 给服务器一些时间启动
      setTimeout(() => {
        resolve();
      }, 1000);
    } catch (error) {
      console.error('启动服务器失败:', error);
      reject(error);
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'QR File Transfer - 二维码文件传输',
    autoHideMenuBar: true
  });

  // 生产环境不开启开发者工具
  // mainWindow.webContents.openDevTools();

  try {
    // 启动服务器
    await startServer();
    
    // 加载页面
    await mainWindow.loadURL('http://localhost:3000');
    console.log('页面加载成功');
  } catch (error) {
    console.error('初始化失败:', error);
    dialog.showErrorBox('启动失败', `无法启动服务器: ${error.message}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 窗口最小化到托盘
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  // 创建系统托盘图标
  const trayIconPath = path.join(__dirname, 'tray-icon.png');
  
  // 如果没有托盘图标，使用默认
  try {
    tray = new Tray(trayIconPath);
  } catch (e) {
    // 使用默认图标
    tray = new Tray(path.join(__dirname, 'icon.ico'));
  }

  const localIP = getLocalIP();
  
  // 获取上传文件夹路径
  const { shell } = require('electron');
  const userDataPath = app.getPath('userData');
  const uploadsFolder = path.join(userDataPath, 'uploads');
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'QR File Transfer', 
      enabled: false 
    },
    { type: 'separator' },
    { 
      label: `本地访问: http://localhost:3000`,
      click: () => {
        mainWindow.show();
      }
    },
    { 
      label: `局域网访问: http://${localIP}:3000`,
      click: () => {
        mainWindow.show();
      }
    },
    { type: 'separator' },
    { 
      label: '📁 打开上传文件夹', 
      click: () => {
        shell.openPath(uploadsFolder);
      }
    },
    { type: 'separator' },
    { 
      label: '显示窗口', 
      click: () => {
        mainWindow.show();
      }
    },
    { 
      label: '隐藏窗口', 
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    { 
      label: '退出', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('QR File Transfer - 二维码文件传输');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

app.on('ready', () => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // macOS 上保持应用运行
  if (process.platform !== 'darwin') {
    if (serverProcess) {
      serverProcess.kill();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});
