const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const QRCode = require('qrcode');
const crypto = require('crypto');
const os = require('os');

// 读取配置
const config = require('./config.json');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 确保上传目录存在
let uploadPath;

// 检测是否在 Electron 环境中运行
function isElectronEnvironment() {
  return process.versions && process.versions.electron;
}

if (isElectronEnvironment()) {
  // 在 Electron 环境中，使用 app.getPath('userData') 作为基础路径
  try {
    const { app } = require('electron');
    const userDataPath = app.getPath('userData');
    uploadPath = path.join(userDataPath, 'uploads');
  } catch (e) {
    // 如果获取失败，使用配置路径
    uploadPath = path.resolve(process.cwd(), config.uploadPath);
  }
} else if (config.uploadPath.startsWith('./') || config.uploadPath.startsWith('../')) {
  // 相对路径，使用当前工作目录
  uploadPath = path.resolve(process.cwd(), config.uploadPath);
} else {
  // 绝对路径
  uploadPath = path.resolve(config.uploadPath);
}

// 创建目录（如果不存在）
try {
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }
} catch (error) {
  console.error('创建上传目录失败:', error);
  // 如果失败，尝试使用临时目录
  uploadPath = path.join(os.tmpdir(), 'qr-file-transfer-uploads');
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }
}

// 存储活跃的上传令牌
const activeTokens = new Map();

// 配置文件存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // 使用时间戳和原始文件名
    const timestamp = Date.now();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${timestamp}-${originalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.maxFileSize * 1024 * 1024 // 转换为字节
  }
});

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

// 生成唯一令牌
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// 清理过期令牌
function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, data] of activeTokens.entries()) {
    if (now - data.createdAt > config.tokenExpireMinutes * 60 * 1000) {
      activeTokens.delete(token);
    }
  }
}

// 每分钟清理一次过期令牌
setInterval(cleanExpiredTokens, 60000);

// 静态文件服务
// 在打包环境中，public 目录的路径需要特殊处理
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.use(express.json());

// 添加根路由，重定向到 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 生成新的上传令牌和二维码
app.get('/api/generate-qr', async (req, res) => {
  try {
    const token = generateToken();
    const localIP = getLocalIP();
    const uploadUrl = `http://${localIP}:${config.port}/upload/${token}`;
    
    activeTokens.set(token, {
      createdAt: Date.now(),
      used: false
    });
    
    const qrCodeDataUrl = await QRCode.toDataURL(uploadUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    res.json({
      qrCode: qrCodeDataUrl,
      token: token,
      uploadUrl: uploadUrl,
      expiresIn: config.tokenExpireMinutes * 60
    });
  } catch (error) {
    res.status(500).json({ error: '生成二维码失败' });
  }
});

// 上传页面路由
app.get('/upload/:token', (req, res) => {
  const token = req.params.token;
  
  if (!activeTokens.has(token)) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>链接已失效</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
          }
          h1 { color: #e74c3c; margin-bottom: 1rem; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚠️ 链接已失效</h1>
          <p>该上传链接已过期或无效</p>
          <p>请重新扫描二维码</p>
        </div>
      </body>
      </html>
    `);
  }
  
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// 获取上传路径的 API
app.get('/api/upload-path', (req, res) => {
  res.json({ path: uploadPath });
});

// 打开上传文件夹的 API
app.get('/api/open-folder', (req, res) => {
  try {
    const { exec } = require('child_process');
    
    // 根据操作系统使用不同的命令
    let command;
    if (process.platform === 'darwin') {
      // macOS - 使用 open 命令在 Finder 中打开
      command = `open "${uploadPath}"`;
    } else if (process.platform === 'win32') {
      // Windows - 使用 explorer 命令，需要转换路径格式
      // 将正斜杠转换为反斜杠，这在 Windows 上更可靠
      const winPath = uploadPath.replace(/\//g, '\\');
      command = `explorer "${winPath}"`;
    } else {
      // Linux - 使用 xdg-open
      command = `xdg-open "${uploadPath}"`;
    }
    
    console.log(`执行命令: ${command}`);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('打开文件夹失败:', error);
        console.error('stderr:', stderr);
        res.json({ 
          success: false, 
          path: uploadPath, 
          error: error.message,
          details: stderr 
        });
      } else {
        console.log('文件夹已打开');
        res.json({ success: true, path: uploadPath });
      }
    });
  } catch (error) {
    console.error('打开文件夹异常:', error);
    res.json({ 
      success: false, 
      path: uploadPath, 
      error: error.message 
    });
  }
});

// 文件上传处理
app.post('/api/upload/:token', upload.array('files', 10), (req, res) => {
  const token = req.params.token;
  
  if (!activeTokens.has(token)) {
    return res.status(400).json({ error: '无效的上传令牌' });
  }
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有文件被上传' });
  }
  
  // 标记令牌已使用
  const tokenData = activeTokens.get(token);
  tokenData.used = true;
  
  // 通知所有连接的客户端刷新二维码
  io.emit('upload-complete', {
    fileCount: req.files.length,
    files: req.files.map(f => ({
      name: f.filename,
      size: f.size,
      path: f.path
    }))
  });
  
  res.json({
    success: true,
    message: `成功上传 ${req.files.length} 个文件`,
    files: req.files.map(f => f.filename)
  });
});

// WebSocket连接
io.on('connection', (socket) => {
  console.log('客户端已连接');
  
  socket.on('disconnect', () => {
    console.log('客户端已断开');
  });
});

// 启动服务器
const PORT = config.port;
server.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log('\n=================================');
  console.log('🚀 二维码文件传输服务已启动');
  console.log('=================================');
  console.log(`📱 本地访问: http://localhost:${PORT}`);
  console.log(`📱 局域网访问: http://${localIP}:${PORT}`);
  console.log(`📁 文件保存位置: ${uploadPath}`);
  console.log('=================================\n');
});
