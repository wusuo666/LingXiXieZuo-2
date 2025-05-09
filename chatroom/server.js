const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 聊天室用户和消息存储
const chatRooms = new Map(); // 存储多个聊天室
const users = new Map(); // 存储用户信息
const canvasVersions = new Map(); // 画布版本集合

// 存储画布内容
const canvasStore = new Map();

// 创建HTTP服务器
const server = http.createServer((req, res) => {
  // 添加CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理OPTIONS请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 简单的HTTP响应，可以在这里提供静态文件服务
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) {
        res.end('无法加载聊天室页面');
      } else {
        res.end(data);
      }
    });
  } else if (req.url === '/canvas/list') {
    // 获取所有画布列表
    const canvasList = Array.from(canvasStore.entries()).map(([canvasId, canvas]) => ({
      canvasId,
      fileName: canvas.fileName,
      userId: canvas.userId || '未知用户',
      timestamp: canvas.timestamp,
      versionCount: canvasVersions.get(canvas.fileName)?.length || 0
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(canvasList));
  } else if (req.url.startsWith('/canvas/')) {
    // 从URL中提取画布ID
    const parts = req.url.split('/');
    const canvasId = parts[2];
    const isDownload = parts[3] === 'download';

    console.log('画布请求:', {
      url: req.url,
      canvasId,
      isDownload,
      storeSize: canvasStore.size,
      availableIds: Array.from(canvasStore.keys()),
      headers: req.headers
    });

    const canvas = canvasStore.get(canvasId);
    
    if (canvas) {
      console.log('找到画布:', {
        id: canvasId,
        fileName: canvas.fileName,
        contentLength: canvas.content.length,
        contentType: typeof canvas.content
      });

      if (isDownload) {
        try {
          // 处理直接下载请求
          const content = canvas.content;
          
          // 检查内容是否有效
          if (!content) {
            throw new Error('画布内容为空');
          }

          // 确保内容是字符串
          const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
          const contentLength = Buffer.byteLength(contentStr);

          console.log('准备下载画布:', {
            id: canvasId,
            fileName: canvas.fileName,
            contentLength,
            contentType: typeof content,
            contentPreview: contentStr.substring(0, 100) // 只记录前100个字符
          });

          // 设置响应头
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(canvas.fileName)}`,
            'Content-Length': contentLength,
            'Cache-Control': 'no-cache',
            'Access-Control-Expose-Headers': 'Content-Disposition'
          });

          // 直接写入内容
          res.write(contentStr);
          res.end();
          
          console.log('画布下载完成:', canvasId);
        } catch (error) {
          console.error('下载画布时出错:', {
            error: error.message,
            stack: error.stack,
            canvasId,
            fileName: canvas.fileName,
            contentType: typeof canvas.content
          });
          
          res.writeHead(500, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({
            error: '下载画布时发生错误',
            message: error.message
          }));
        }
      } else {
        // 检查请求的Accept头
        const accept = req.headers.accept || '';
        const wantsHtml = accept.includes('text/html');

        if (wantsHtml) {
          // 如果请求HTML，返回一个简单的下载页面
          const html = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>下载画布</title>
              <meta charset="utf-8">
              <script>
                window.onload = function() {
                  // 自动触发下载
                  fetch('/canvas/${canvasId}/download')
                    .then(response => {
                      if (!response.ok) {
                        return response.json().then(err => {
                          throw new Error(err.message || '下载失败: ' + response.status);
                        });
                      }
                      return response.blob();
                    })
                    .then(blob => {
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = '${canvas.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}';
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      a.remove();
                    })
                    .catch(error => {
                      console.error('下载失败:', error);
                      document.body.innerHTML += '<p style="color: red;">下载失败: ' + error.message + '</p>';
                    });
                }
              </script>
            </head>
            <body>
              <h1>正在下载画布...</h1>
              <p>如果没有自动下载，请<a href="/canvas/${canvasId}/download">点击这里</a></p>
            </body>
            </html>
          `;

          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Content-Length': Buffer.byteLength(html)
          });
          res.end(html);
        } else {
          try {
            // 直接返回JSON内容
            const content = canvas.content;
            const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
            
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(canvas.fileName)}`,
              'Content-Length': Buffer.byteLength(contentStr),
              'Cache-Control': 'no-cache',
              'Access-Control-Expose-Headers': 'Content-Disposition'
            });
            res.write(contentStr);
            res.end();
          } catch (error) {
            console.error('返回JSON内容时出错:', {
              error: error.message,
              stack: error.stack,
              canvasId,
              fileName: canvas.fileName
            });
            
            res.writeHead(500, { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
              error: '返回画布内容时发生错误',
              message: error.message
            }));
          }
        }
      }
    } else {
      console.log('画布不存在:', {
        id: canvasId,
        storeSize: canvasStore.size,
        availableIds: Array.from(canvasStore.keys())
      });
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('画布不存在或已过期');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 处理WebSocket连接
wss.on('connection', (ws) => {
  let userId = null;
  let currentRoom = null;

  // 处理消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          // 用户加入聊天室
          userId = data.userId || `user_${Date.now()}`;
          currentRoom = data.roomId || 'default';
          
          // 初始化聊天室
          if (!chatRooms.has(currentRoom)) {
            chatRooms.set(currentRoom, new Set());
          }
          
          // 添加用户到聊天室
          chatRooms.get(currentRoom).add(userId);
          users.set(userId, { 
            ws, 
            name: data.name || '匿名用户',
            avatar: data.avatar || null
          });
          
          // 广播用户加入消息
          broadcastToRoom(currentRoom, {
            type: 'system',
            content: `${users.get(userId).name} 加入了聊天室`,
            timestamp: Date.now(),
            users: getUsersInRoom(currentRoom)
          }, userId);
          break;
          
        case 'message':
          // 发送消息到聊天室
          if (userId && currentRoom) {
            broadcastToRoom(currentRoom, {
              type: 'message',
              userId: userId,
              sender: {
                id: userId,
                name: users.get(userId).name
              },
              content: data.content,
              timestamp: Date.now()
            }, userId);
          }
          break;
          
        case 'privateMessage':
          // 私聊消息
          if (userId && data.targetId && users.has(data.targetId)) {
            const targetWs = users.get(data.targetId).ws;
            const message = {
              type: 'privateMessage',
              userId: userId,
              sender: users.get(userId).name,
              content: data.content,
              timestamp: Date.now()
            };
            
            // 发送给目标用户
            targetWs.send(JSON.stringify(message));
            // 发送给自己的确认
            ws.send(JSON.stringify({
              ...message,
              isSent: true
            }));
          }
          break;
          
        case 'canvas':
          handleCanvasMessage(ws, data, userId, currentRoom);
          break;
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    if (userId && currentRoom && chatRooms.has(currentRoom)) {
      // 从聊天室移除用户
      chatRooms.get(currentRoom).delete(userId);
      
      // 如果聊天室为空，删除聊天室
      if (chatRooms.get(currentRoom).size === 0) {
        chatRooms.delete(currentRoom);
      } else {
        // 广播用户离开消息
        broadcastToRoom(currentRoom, {
          type: 'system',
          content: `${users.get(userId).name} 离开了聊天室`,
          timestamp: Date.now(),
          users: getUsersInRoom(currentRoom)
        }, null);
      }
      
      // 删除用户信息
      users.delete(userId);
    }
  });
});

/**
 * 处理画布相关消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 消息数据
 * @param {string} userId 用户ID
 * @param {string} currentRoom 当前房间ID
 */
function handleCanvasMessage(ws, data, userId, currentRoom) {
  console.log('处理画布消息:', data);
  
  try {
    switch (data.action) {
      case 'list':
        // 获取当前房间的所有画布列表
        const canvasList = Array.from(canvasVersions.entries()).map(([fileName, versions]) => ({
          fileName: fileName,
          userId: versions[0]?.userId || '未知用户',
          timestamp: versions[0]?.timestamp || Date.now(),
          versionCount: versions.length
        }));
        
        // 发送画布列表给请求者
        ws.send(JSON.stringify({
          type: 'canvas',
          action: 'list',
          canvasList: canvasList,
          timestamp: Date.now()
        }));
        break;
        
      case 'submit':
        // 存储画布内容
        if (data.canvasId) {
          console.log('收到画布提交:', {
            canvasId: data.canvasId,
            fileName: data.fileName,
            contentLength: data.content ? data.content.length : 0,
            contentType: typeof data.content
          });

          // 确保内容是正确的JSON格式
          let content;
          try {
            // 如果内容已经是字符串，尝试解析它
            if (typeof data.content === 'string') {
              try {
                content = JSON.parse(data.content);
              } catch (e) {
                // 如果解析失败，可能是编码问题，尝试解码
                content = decodeURIComponent(escape(data.content));
                content = JSON.parse(content);
              }
            } else {
              content = data.content;
            }
            // 重新序列化为字符串，确保使用UTF-8编码
            content = JSON.stringify(content, null, 2);
          } catch (error) {
            console.error('解析画布内容失败:', error);
            ws.send(JSON.stringify({
              type: 'canvas',
              action: 'error',
              message: '画布内容格式错误'
            }));
            return;
          }

          // 存储画布内容
          canvasStore.set(data.canvasId, {
            content: content,
            fileName: data.fileName,
            timestamp: data.timestamp || Date.now(),
            userId: userId
          });

          console.log('画布已保存:', {
            id: data.canvasId,
            fileName: data.fileName,
            contentLength: content.length,
            storeSize: canvasStore.size,
            availableIds: Array.from(canvasStore.keys())
          });

          // 发送确认消息
          ws.send(JSON.stringify({
            type: 'canvas',
            action: 'submit',
            status: 'success',
            canvasId: data.canvasId,
            fileName: data.fileName,
            timestamp: Date.now()
          }));
        }
        
        // 更新版本历史
        if (!canvasVersions.has(data.fileName)) {
          canvasVersions.set(data.fileName, []);
        }
        canvasVersions.get(data.fileName).push({
          content: content,
          userId: userId,
          timestamp: data.timestamp || Date.now()
        });
        
        // 广播更新消息
        broadcastToRoom(currentRoom, {
          type: 'canvas',
          action: 'update',
          fileName: data.fileName,
          timestamp: Date.now()
        });
        break;
        
      case 'pull':
        // 获取画布版本历史
        const key = `${data.fileName}_${data.filePath}`;
        const canvasVersionsList = canvasVersions.get(key) || [];
        
        if (canvasVersionsList.length > 0) {
          // 发送版本历史给请求者
          ws.send(JSON.stringify({
            type: 'canvas',
            action: 'versions',
            fileName: data.fileName,
            filePath: data.filePath,
            versions: canvasVersionsList,
            currentContent: data.currentContent
          }));
        } else {
          // 发送明确的错误消息
          ws.send(JSON.stringify({
            type: 'canvas',
            action: 'error',
            message: `画布 "${data.fileName}" 没有可用的版本历史`,
            fileName: data.fileName,
            filePath: data.filePath
          }));
        }
        break;
    }
  } catch (error) {
    console.error('处理画布消息时出错:', error);
    ws.send(JSON.stringify({
      type: 'canvas',
      action: 'error',
      message: error.message
    }));
  }
}

// 向聊天室广播消息
function broadcastToRoom(roomId, message, senderUserId = null) {
  if (!chatRooms.has(roomId)) return;
  
  const messageStr = JSON.stringify(message);
  chatRooms.get(roomId).forEach(userId => {
    // 移除不向发送者发送消息的限制
    if (users.has(userId)) {
      users.get(userId).ws.send(messageStr);
    }
  });
}

// 获取聊天室中的用户列表
function getUsersInRoom(roomId) {
  if (!chatRooms.has(roomId)) return [];
  
  return Array.from(chatRooms.get(roomId)).map(userId => ({
    id: userId,
    name: users.get(userId).name,
    avatar: users.get(userId).avatar
  }));
}

// 启动服务器函数
function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    try {
      server.listen(port, () => {
        console.log(`聊天室服务器已启动，监听端口 ${port}`);
        resolve({ port });
      });
    } catch (error) {
      console.error('启动服务器失败:', error);
      reject(error);
    }
  });
}

// 停止服务器函数
function stopServer() {
  return new Promise((resolve, reject) => {
    try {
      server.close(() => {
        console.log('聊天室服务器已关闭');
        resolve();
      });
    } catch (error) {
      console.error('关闭服务器失败:', error);
      reject(error);
    }
  });
}

module.exports = {
  startServer,
  stopServer
};