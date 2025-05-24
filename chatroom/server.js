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

// 语音会议相关存储
const voiceConferences = new Map(); // 存储语音会议房间
const voiceParticipants = new Map(); // 存储参与者信息

// 在文件顶部声明全局变量
const isServerInstance = true;
const serverUserId = `server_${Date.now()}`;

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

  console.log('[连接] 新的WebSocket连接已建立');
  
  // 添加函数来清理重复的WebSocket连接
  const cleanupDuplicateConnections = (newUserId) => {
    console.log(`[连接清理] 检查是否存在需要清理的旧连接，用户ID: ${newUserId}`);
    
    // 获取当前WebSocket
    const currentWs = ws;
    
    // 查找使用同一个WebSocket连接的所有ID
    const connectedIds = [];
    for (const [id, user] of users.entries()) {
      if (user.ws === currentWs) {
        connectedIds.push(id);
      }
    }
    
    if (connectedIds.length <= 1) {
      // 只有一个或没有ID，不需要清理
      return;
    }
    
    console.log(`[连接清理] 发现多个ID使用同一WebSocket连接: ${connectedIds.join(', ')}`);
    
    // 创建一个函数来确定ID的优先级
    const getIdPriority = (id) => {
      let priority = 0;
      
      // 1. 最高优先级：已经在聊天室中使用的ID
      for (const [roomId, roomUsers] of chatRooms.entries()) {
        if (roomUsers.has(id)) {
          priority += 100; // 给予很高的优先级
          break;
        }
      }
      
      // 2. 其次是前缀优先级
      if (id.startsWith('vscode_')) {
        // vscode前缀的基础分数
        priority += 10;
        
        // 标准格式的vscode_timestamp比vscode_timestamp_random优先级高
        const parts = id.split('_');
        if (parts.length === 2) {
          priority += 5; // 标准格式额外加分
        }
      }
      else if (id.startsWith('user_')) priority += 8;
      else if (id.startsWith('client_')) priority += 5;
      
      // 3. 如果是当前ID，给予额外的优先级
      if (id === newUserId) {
        priority += 3;
      }
      
      console.log(`[连接清理] ID ${id} 计算的优先级: ${priority}`);
      return priority;
    };
    
    // 按优先级对ID进行排序
    connectedIds.sort((a, b) => {
      return getIdPriority(b) - getIdPriority(a); // 降序排序，优先级高的排在前面
    });
    
    // 保留优先级最高的ID，删除其他ID
    const idToKeep = connectedIds[0];
    const idsToRemove = connectedIds.slice(1);
    
    console.log(`[连接清理] 保留ID: ${idToKeep}, 将移除: ${idsToRemove.join(', ')}`);
    
    // 移除不需要的ID
    for (const idToRemove of idsToRemove) {
        // 从所有房间中移除
        for (const [roomId, roomUsers] of chatRooms.entries()) {
        if (roomUsers.has(idToRemove)) {
          roomUsers.delete(idToRemove);
          console.log(`[连接清理] 已从房间 ${roomId} 移除ID: ${idToRemove}`);
          }
        }
        
        // 从会议中移除
      if (voiceParticipants.has(idToRemove)) {
        const confId = voiceParticipants.get(idToRemove).conferenceId;
          if (voiceConferences.has(confId)) {
          voiceConferences.get(confId).participants.delete(idToRemove);
          console.log(`[连接清理] 已从会议 ${confId} 移除ID: ${idToRemove}`);
          }
        voiceParticipants.delete(idToRemove);
        }
        
        // 从用户列表中移除
      users.delete(idToRemove);
      }
    
    if (idsToRemove.length > 0) {
      console.log(`[连接清理] 清理完成，保留ID: ${idToKeep}, 移除了 ${idsToRemove.length} 个ID`);
    }
  };

  // 处理消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const messageType = data.type || '未知';
      logMessageReceived(messageType, message.length, data);
      
      // 优先处理音频流消息
      if (messageType === 'audioStream') {
        handleAudioStreamMessage(ws, data, userId, currentRoom);
        return;
      }
      
      // 其他类型消息处理
      switch (messageType) {
        case 'join':
          handleJoinMessage(ws, data);
          break;
          
        case 'message':
          handleTextMessage(ws, data, userId, currentRoom);
          break;
          
        case 'audioMessage':
          handleAudioMessage(ws, data, userId, currentRoom);
          break;
          
        case 'privateMessage':
          handlePrivateMessage(ws, data, userId);
          break;
          
        case 'privateAudioMessage':
          handlePrivateAudioMessage(ws, data, userId);
          break;
          
        case 'canvas':
          handleCanvasMessage(ws, data, userId, currentRoom);
          break;
          
        case 'voiceConference':
          handleVoiceConferenceMessage(ws, data, userId, currentRoom);
          break;
          
        default:
          sendErrorToClient(ws, `未知的消息类型: ${messageType}`);
      }
    } catch (error) {
      handleMessageError(ws, error);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    console.log(`[断开] WebSocket连接关闭, 用户: ${userId || '未知'}`);
    if (userId && currentRoom && chatRooms.has(currentRoom)) {
      // 从聊天室移除用户
      chatRooms.get(currentRoom).delete(userId);
      
      // 如果用户在语音会议中，处理离开
      if (voiceParticipants.has(userId)) {
        const conferenceId = voiceParticipants.get(userId).conferenceId;
        console.log(`[会议] 用户 ${userId} 断开连接，自动离开会议 ${conferenceId}`);
        handleVoiceConferenceLeave(userId, conferenceId);
      }
      
      // 如果聊天室为空，删除聊天室
      if (chatRooms.get(currentRoom).size === 0) {
        console.log(`[聊天室] 聊天室 ${currentRoom} 已空，准备删除`);
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
      console.log(`[用户] 已删除用户 ${userId} 的信息`);
    }
  });
  
  // 处理连接错误
  ws.on('error', (error) => {
    console.error(`[连接错误] WebSocket错误, 用户: ${userId || '未知'}:`, error);
  });
});

/**
 * 记录接收到的消息
 */
function logMessageReceived(type, size, data) {
  console.log(`[消息] 收到 ${type} 类型消息, 大小: ${size} 字节`);
  
  // 特殊类型的详细日志
  if (type === 'audioStream') {
    console.log(`[音频流] 收到音频数据, 序列号: ${data.sequence}, 大小: ${data.audioData?.length || 0} 字节`);
  }
}

/**
 * 处理用户加入消息
 */
function handleJoinMessage(ws, data) {
  // 获取用户ID和房间ID
  userId = data.userId || `user_${Date.now()}`;
  currentRoom = data.roomId || 'default';
  
  console.log(`[加入] 用户 ${data.name || '匿名用户'} (ID: ${userId}) 加入聊天室 ${currentRoom}`);
  
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
  
  // 将ID关联到WebSocket对象上
  ws.userId = userId;
  ws.roomId = currentRoom;
  
  // 广播用户加入消息
  broadcastToRoom(currentRoom, {
    type: 'system',
    content: `${users.get(userId).name} 加入了聊天室`,
    timestamp: Date.now(),
    users: getUsersInRoom(currentRoom)
  }, userId);
}

/**
 * 处理文本消息
 */
function handleTextMessage(ws, data, userId, roomId) {
  if (!userId || !roomId) return;
  
  const senderName = users.has(userId) ? users.get(userId).name : '未知用户';
  
  broadcastToRoom(roomId, {
    type: 'message',
    userId: userId,
    sender: {
      id: userId,
      name: senderName
    },
    content: data.content,
    timestamp: Date.now()
  }, userId);
}

/**
 * 处理音频流消息
 */
function handleAudioStreamMessage(ws, data, userId, roomId) {
  // 必须有会议ID
  if (!data.conferenceId) {
    sendErrorToClient(ws, '音频流消息缺少会议ID');
    return;
  }
  
  // 如果已有用户ID和房间ID，直接处理
  if (userId && roomId) {
    forwardAudioStream(data, userId, roomId);
    return;
  }
  
  // 尝试查找或创建用户身份
  const userInfo = findOrCreateUserIdentity(ws, data);
  
  // 使用找到的用户身份转发音频
  forwardAudioStream(data, userInfo.userId, userInfo.roomId);
}

/**
 * 查找或创建用户身份
 */
function findOrCreateUserIdentity(ws, data) {
  // 首先查找与WebSocket匹配的用户ID
  const connectedIds = findConnectedUserIds(ws);
  
  if (connectedIds.length > 0) {
    // 找到了已关联的用户，使用优先级最高的ID
    const foundUserId = connectedIds[0];
    const foundRoomId = findUserRoom(foundUserId);
    
    if (foundRoomId) {
      return { userId: foundUserId, roomId: foundRoomId };
    }
  }
  
  // 使用WebSocket对象上已关联的ID
  if (ws.userId && ws.roomId) {
    return { userId: ws.userId, roomId: ws.roomId };
  }
  
  // 创建新用户身份
  const newUserId = `user_${Date.now()}`;
  const newRoomId = data.conferenceId; // 使用会议ID作为房间ID
  
  // 保存到WebSocket对象
  ws.userId = newUserId;
  ws.roomId = newRoomId;
  
  // 创建用户和房间
  ensureUserAndRoomExist(ws, newUserId, newRoomId);
  
  return { userId: newUserId, roomId: newRoomId };
}

/**
 * 查找与WebSocket关联的所有用户ID
 */
function findConnectedUserIds(ws) {
  const connectedIds = [];
  
  for (const [id, user] of users.entries()) {
    if (user.ws === ws) {
      connectedIds.push(id);
    }
  }
  
  // 按优先级排序
  return connectedIds.sort((a, b) => getPriorityValueForId(b) - getPriorityValueForId(a));
}

/**
 * 查找用户所在的房间
 */
function findUserRoom(userId) {
  for (const [roomId, roomUsers] of chatRooms.entries()) {
    if (roomUsers.has(userId)) {
      return roomId;
    }
  }
  return null;
}

/**
 * 确保用户和房间存在
 */
function ensureUserAndRoomExist(ws, userId, roomId) {
  // 清理重复连接
  cleanupDuplicateConnections(userId);
  
  // 创建用户
  if (!users.has(userId)) {
    users.set(userId, {
      ws,
      name: `用户_${userId.substring(0, 8)}`,
      avatar: null
    });
  }
  
  // 创建房间
  if (!chatRooms.has(roomId)) {
    chatRooms.set(roomId, new Set());
  }
  
  // 添加用户到房间
  chatRooms.get(roomId).add(userId);
}

/**
 * 处理语音消息
 */
function handleAudioMessage(ws, data, userId, roomId) {
  if (!userId || !roomId || !data.audioData || typeof data.audioData !== 'string') {
    sendErrorToClient(ws, '语音消息格式错误');
    return;
  }
  
  broadcastToRoom(roomId, {
    type: 'audioMessage',
    userId: userId,
    sender: {
      id: userId,
      name: users.get(userId).name
    },
    audioData: data.audioData,
    duration: data.duration || 0,
    timestamp: Date.now(),
    id: data.id || `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    audioFilename: data.audioFilename
  }, userId);
}

/**
 * 处理私聊消息
 */
function handlePrivateMessage(ws, data, userId) {
  if (!userId || !data.targetId || !users.has(data.targetId)) {
    return;
  }
  
  const message = {
    type: 'privateMessage',
    userId: userId,
    sender: users.get(userId).name,
    content: data.content,
    timestamp: Date.now()
  };
  
  // 发送给目标用户
  users.get(data.targetId).ws.send(JSON.stringify(message));
  
  // 发送确认给发送者
  ws.send(JSON.stringify({
    ...message,
    isSent: true
  }));
}

/**
 * 处理私聊语音消息
 */
function handlePrivateAudioMessage(ws, data, userId) {
  if (!userId || !data.targetId || !users.has(data.targetId) || 
      !data.audioData || typeof data.audioData !== 'string') {
    sendErrorToClient(ws, '私聊语音消息格式错误');
    return;
  }
  
  const message = {
    type: 'privateAudioMessage',
    userId: userId,
    sender: users.get(userId).name,
    audioData: data.audioData,
    duration: data.duration || 0,
    timestamp: Date.now()
  };
  
  // 发送给目标用户
  users.get(data.targetId).ws.send(JSON.stringify(message));
  
  // 发送确认给发送者
  ws.send(JSON.stringify({
    ...message,
    isSent: true
  }));
}

/**
 * 处理消息错误
 */
function handleMessageError(ws, error) {
  console.error('[处理错误] 处理消息时出错:', error);
  sendErrorToClient(ws, `服务器处理消息时出错: ${error.message}`);
}

/**
 * 发送错误消息给客户端
 */
function sendErrorToClient(ws, errorMessage) {
  try {
    ws.send(JSON.stringify({
      type: 'error',
      content: errorMessage,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('[处理错误] 发送错误消息失败:', error);
  }
}

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
  
  // 验证消息格式
  if (typeof message !== 'object') {
    console.error('尝试广播无效消息:', message);
    return;
  }

  // 确保消息中有完整的sender信息
  if (message.type === 'message' && (!message.sender || !message.sender.name)) {
    console.error('消息缺少sender信息:', message);
    if (!message.sender) {
      message.sender = { id: 'system', name: '系统' };
    } else if (!message.sender.name) {
      message.sender.name = '未知用户';
    }
  }
  
  try {
    const messageStr = JSON.stringify(message);
    chatRooms.get(roomId).forEach(userId => {
      // 确保用户存在
      if (users.has(userId)) {
        users.get(userId).ws.send(messageStr);
      }
    });
  } catch (error) {
    console.error('广播消息时出错:', error, message);
  }
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

/**
 * 处理语音会议相关消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 消息数据
 * @param {string} userId 用户ID
 * @param {string} currentRoom 当前房间ID
 */
function handleVoiceConferenceMessage(ws, data, userId, currentRoom) {
  console.log('处理语音会议消息:', data);
  
  try {
    switch (data.action) {
      case 'create':
        // 创建新的语音会议
        const conferenceId = data.conferenceId || `conf_${currentRoom}_${Date.now()}`;
        
        // 检查会议是否已存在
        if (!voiceConferences.has(conferenceId)) {
          voiceConferences.set(conferenceId, {
            roomId: currentRoom,
            creatorId: userId,
            participants: new Set([userId]),
            createdAt: Date.now(),
            settings: data.settings || {
              maxParticipants: 10,
              audioQuality: 'medium'
            }
          });
          
          // 将用户添加到语音参与者列表
          voiceParticipants.set(userId, {
            conferenceId: conferenceId,
            joinedAt: Date.now(),
            isMuted: false,
            ws: ws
          });
          
          console.log(`用户 ${userId} 创建了语音会议 ${conferenceId}`);
          
          // 发送成功消息给创建者
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'created',
            conferenceId: conferenceId,
            status: 'success',
            timestamp: Date.now()
          }));
          
          // 广播会议创建消息
          broadcastToRoom(currentRoom, {
            type: 'voiceConference',
            action: 'available',
            conferenceId: conferenceId,
            creatorId: userId,
            creatorName: users.get(userId).name,
            timestamp: Date.now(),
            participantCount: 1
          }, userId);
        } else {
          // 会议已存在，发送错误消息
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'error',
            message: '会议ID已存在',
            timestamp: Date.now()
          }));
        }
        break;
        
      case 'join':
        // 加入现有语音会议
        const joinConferenceId = data.conferenceId;
        
        if (voiceConferences.has(joinConferenceId)) {
          const conference = voiceConferences.get(joinConferenceId);
          
          // 简化：不再检查用户是否在其他会议，直接加入新会议
          // 如果已在当前会议，也不做特殊处理，简单更新状态即可
          
          // 添加用户到会议
          conference.participants.add(userId);
          
          // 更新参与者信息
          voiceParticipants.set(userId, {
            conferenceId: joinConferenceId,
            joinedAt: Date.now(),
            isMuted: false,
            ws: ws
          });
          
          console.log(`用户 ${userId} 加入语音会议 ${joinConferenceId}`);
          
          // 向新加入的用户发送当前会议状态
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'joined',
            conferenceId: joinConferenceId,
            participants: getConferenceParticipants(joinConferenceId),
            timestamp: Date.now()
          }));
          
          // 向其他会议参与者广播新成员加入的消息
          broadcastToConference(joinConferenceId, {
            type: 'voiceConference',
            action: 'memberJoined',
            conferenceId: joinConferenceId,
            userId: userId,
            userName: users.get(userId).name,
            timestamp: Date.now()
          }, userId);
        } else {
          // 会议不存在，创建新会议并加入
          // ...现有代码...
        }
        break;
        
      case 'leave':
        // 离开语音会议
        if (voiceParticipants.has(userId)) {
          const leaveConferenceId = voiceParticipants.get(userId).conferenceId;
          handleVoiceConferenceLeave(userId, leaveConferenceId);
        } else {
          // 用户不在任何会议中
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'info',
            message: '您不在任何语音会议中',
            timestamp: Date.now()
          }));
        }
        break;
        
      case 'mute':
        // 静音/取消静音
        if (voiceParticipants.has(userId)) {
          const participantInfo = voiceParticipants.get(userId);
          const muteConferenceId = participantInfo.conferenceId;
          
          // 更新静音状态
          participantInfo.isMuted = data.muted;
          
          console.log(`用户 ${userId} ${data.muted ? '开启' : '关闭'}静音`);
          
          // 广播静音状态变更
          broadcastToConference(muteConferenceId, {
            type: 'voiceConference',
            action: 'participantMuted',
            conferenceId: muteConferenceId,
            userId: userId,
            userName: users.get(userId).name,
            isMuted: data.muted,
            timestamp: Date.now()
          }, null);
        }
        break;
        
      case 'list':
        // 获取聊天室中的语音会议列表
        const conferencesInRoom = Array.from(voiceConferences.entries())
          .filter(([id, conf]) => conf.roomId === currentRoom)
          .map(([id, conf]) => ({
            conferenceId: id,
            creatorId: conf.creatorId,
            creatorName: users.has(conf.creatorId) ? users.get(conf.creatorId).name : '未知用户',
            participantCount: conf.participants.size,
            createdAt: conf.createdAt
          }));
        
        // 发送会议列表
        ws.send(JSON.stringify({
          type: 'voiceConference',
          action: 'list',
          conferences: conferencesInRoom,
          timestamp: Date.now()
        }));
        break;
    }
  } catch (error) {
    console.error('处理语音会议消息时出错:', error);
    ws.send(JSON.stringify({
      type: 'voiceConference',
      action: 'error',
      message: error.message,
      timestamp: Date.now()
    }));
  }
}

/**
 * 处理用户离开语音会议
 * @param {string} userId 离开的用户ID
 * @param {string} conferenceId 会议ID
 */
function handleVoiceConferenceLeave(userId, conferenceId) {
  if (!voiceConferences.has(conferenceId)) {
    console.log(`[会议] 会议 ${conferenceId} 不存在，无需处理用户离开`);
    return;
  }
  
  if (!users.has(userId)) {
    console.log(`[会议] 用户 ${userId} 不存在，但仍会从会议中移除`);
    // 即使用户不存在，也要从会议的参与者列表中移除
    if (voiceConferences.has(conferenceId)) {
      voiceConferences.get(conferenceId).participants.delete(userId);
    }
    
    // 从会议参与者映射中删除用户
    voiceParticipants.delete(userId);
    return;
  }
  
  const conference = voiceConferences.get(conferenceId);
  const roomId = conference.roomId;
  
  // 从会议的参与者列表中移除用户
  conference.participants.delete(userId);
  
  // 从会议参与者映射中删除用户
  voiceParticipants.delete(userId);
  
  console.log(`用户 ${userId} 离开语音会议 ${conferenceId}`);
  
  // 向离开的用户发送离开确认
  try {
    users.get(userId).ws.send(JSON.stringify({
      type: 'voiceConference',
      action: 'leaveConfirmed',
      conferenceId: conferenceId,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error(`向用户 ${userId} 发送会议离开确认失败:`, error);
  }
  
  // 如果会议中没有参与者，删除会议
  if (conference.participants.size === 0) {
    voiceConferences.delete(conferenceId);
    console.log(`语音会议 ${conferenceId} 已关闭（无参与者）`);
    
    // 广播会议关闭消息
    broadcastToRoom(roomId, {
      type: 'voiceConference',
      action: 'closed',
      conferenceId: conferenceId,
      reason: 'empty',
      timestamp: Date.now()
    }, null);
  } else {
    // 向会议中其他参与者广播用户离开消息
    broadcastToConference(conferenceId, {
      type: 'voiceConference',
      action: 'participantLeft',
      conferenceId: conferenceId,
      userId: userId,
      userName: users.get(userId).name,
      timestamp: Date.now(),
      participants: getConferenceParticipants(conferenceId)
    }, userId);
    
    // 广播会议更新消息到聊天室
    broadcastToRoom(roomId, {
      type: 'voiceConference',
      action: 'updated',
      conferenceId: conferenceId,
      timestamp: Date.now(),
      participantCount: conference.participants.size
    }, null);
  }
}

/**
 * 转发音频流到会议参与者
 * @param {Object} data 音频数据和元信息
 * @param {string} senderId 发送者ID
 * @param {string} roomId 房间ID
 */
function forwardAudioStream(data, senderId, roomId) {
    // 简化的音频消息，只保留必要字段
    const audioMessage = {
        type: 'audioStream',
        conferenceId: data.conferenceId,
        senderId,
        senderName: users.get(senderId)?.name || 'Unknown',
        audioData: data.audioData,
        sequence: data.sequence || 0,
        // 移除非必要字段，保留格式信息
        format: {
            sampleRate: data.format?.sampleRate || 44100,
            numChannels: data.format?.numChannels || 1
        }
    };
    
    // 一次性检查会议状态
    const conference = getOrCreateConference(data.conferenceId, senderId, roomId);
    if (!conference) return;
    
    // 一次性检查用户状态
    if (isUserMutedOrInactive(senderId, data.conferenceId)) return;
    
    // 直接发送给所有活跃参与者
    sendToActiveParticipants(conference, audioMessage, senderId);
}

/**
 * 确保会议存在，不存在则创建
 */
function getOrCreateConference(conferenceId, creatorId, roomId) {
    if (!voiceConferences.has(conferenceId)) {
        voiceConferences.set(conferenceId, {
            id: conferenceId,
            creator: creatorId,
            roomId: roomId,
            participants: new Set(),
            createdAt: Date.now()
        });
        
        // 广播会议创建消息
        broadcastToRoom(roomId, {
            type: 'voiceConference',
            action: 'created',
            conferenceId: conferenceId,
            creatorId: creatorId,
            creatorName: users.get(creatorId)?.name || 'Unknown',
            timestamp: Date.now()
        });
    }
}

/**
 * 检查用户是否被静音或不活跃
 * @param {string} userId 用户ID
 * @param {string} conferenceId 会议ID
 * @returns {boolean} 如果用户被静音或不活跃则返回true
 */
function isUserMutedOrInactive(userId, conferenceId) {
    // 检查用户是否存在
    if (!users.has(userId)) {
        console.log(`用户 ${userId} 不存在，视为不活跃`);
        return true;
    }
    
    // 检查用户是否在会议中
    if (!voiceParticipants.has(userId)) {
        console.log(`用户 ${userId} 不在任何会议中，视为不活跃`);
        return true;
    }
    
    // 检查用户是否在正确的会议中
    const userConferenceInfo = voiceParticipants.get(userId);
    if (userConferenceInfo.conferenceId !== conferenceId) {
        console.log(`用户 ${userId} 在其他会议中: ${userConferenceInfo.conferenceId}`);
        return true;
    }
    
    // 检查用户是否被静音
    if (userConferenceInfo.isMuted) {
        console.log(`用户 ${userId} 已静音`);
        return true;
    }
    
    // 检查用户WebSocket连接是否活跃
    const userWs = users.get(userId).ws;
    if (!userWs || userWs.readyState !== WebSocket.OPEN) {
        console.log(`用户 ${userId} WebSocket连接不活跃`);
        return true;
    }
    
    // 用户活跃且未静音
    return false;
}

function sendToActiveParticipants(conference, message, excludeId) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    // 高效遍历并发送
    for (const participantId of conference.participants) {
        if (participantId === excludeId) continue;
        
        const participant = users.get(participantId);
        if (!participant?.ws || participant.ws.readyState !== WebSocket.OPEN) continue;
        
        try {
            participant.ws.send(messageStr);
            sentCount++;
        } catch (error) {
            // 简化错误处理，只记录错误不中断流程
        }
    }
    
    return sentCount;
}

/**
 * 向语音会议中的所有参与者广播消息
 * @param {string} conferenceId 会议ID
 * @param {Object} message 消息对象
 * @param {string} excludeUserId 要排除的用户ID（可选）
 */
function broadcastToConference(conferenceId, message, excludeUserId = null) {
  if (!voiceConferences.has(conferenceId)) return;
  
  const conference = voiceConferences.get(conferenceId);
  const messageStr = JSON.stringify(message);
  
  conference.participants.forEach(participantId => {
    if (users.has(participantId) && participantId !== excludeUserId) {
      try {
        users.get(participantId).ws.send(messageStr);
      } catch (error) {
        console.error(`向会议参与者 ${participantId} 发送消息失败:`, error);
      }
    }
  });
}

/**
 * 获取语音会议参与者信息
 * @param {string} conferenceId 会议ID
 * @returns {Array} 参与者信息数组
 */
function getConferenceParticipants(conferenceId) {
  if (!voiceConferences.has(conferenceId)) return [];
  
  const conference = voiceConferences.get(conferenceId);
  return Array.from(conference.participants).map(participantId => {
    const participant = voiceParticipants.get(participantId);
    return {
      id: participantId,
      name: users.has(participantId) ? users.get(participantId).name : '未知用户',
      isMuted: participant ? participant.isMuted : false,
      joinedAt: participant ? participant.joinedAt : Date.now()
    };
  });
}

/**
 * 获取ID的优先级值
 * @param {string} id 用户ID
 * @returns {number} 优先级值，数字越大优先级越高
 */
function getPriorityValueForId(id) {
  if (!id) return 0;
  
  // vscode_开头的ID有最高优先级
  if (id.startsWith('vscode_')) return 3;
  
  // user_开头的ID有次高优先级
  if (id.startsWith('user_')) return 2;
  
  // client_开头的ID有第三优先级
  if (id.startsWith('client_')) return 1;
  
  // 其他ID有最低优先级
  return 0;
}

// 启动服务器函数
function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    try {
      server.listen(port, () => {
        console.log(`聊天室服务器已启动，监听端口 ${port}`);
        
        // 将服务器自身作为特殊用户添加到用户列表
        users.set(serverUserId, {
          id: serverUserId,
          name: "服务器",
          isServer: true,
          ws: null  // 服务器不需要WebSocket连接
        });
        
        // 创建一个模拟的WebSocket对象，用于服务器自身
        const serverWs = {
          readyState: WebSocket.OPEN,
          send: function(data) {
            try {
              // 服务器收到消息后的处理
              const message = JSON.parse(data);
              
              // 如果是音频流数据，直接在本地播放
              if (message.type === 'audioStream' && message.audioData) {
                console.log('[服务器] 收到音频流，准备播放');
                // 在这里实现音频播放逻辑
                // playAudio(message.audioData);
              }
            } catch (error) {
              console.error('[服务器] 处理消息失败:', error);
            }
          }
        };
        
        // 更新服务器用户的WebSocket连接
        users.get(serverUserId).ws = serverWs;
        
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