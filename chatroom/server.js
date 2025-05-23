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
      let msgType = '未知';
      let msgSize = message.length;
      
      try {
        // 尝试解析消息类型，但不中断处理
        const previewData = JSON.parse(message);
        msgType = previewData.type || '未知';
        console.log(`[消息] 收到 ${msgType} 类型消息, 大小: ${msgSize} 字节`);
        
        // 如果是音频流消息，输出更多详细信息
        if (previewData.type === 'audioStream') {
          console.log(`[音频流] 收到音频数据, 序列号: ${previewData.sequence}, 大小: ${previewData.audioData ? previewData.audioData.length : 0} 字节, 会议ID: ${previewData.conferenceId}`);
        }
      } catch (previewError) {
        console.log(`[消息] 收到无法解析的消息, 大小: ${msgSize} 字节`);
      }
      
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          // 用户加入聊天室
          userId = data.userId || `user_${Date.now()}`;
          currentRoom = data.roomId || 'default';
          
          console.log(`[加入] 用户 ${data.name || '匿名用户'} (ID: ${userId}) 加入聊天室 ${currentRoom}`);
          
          // 初始化聊天室
          if (!chatRooms.has(currentRoom)) {
            chatRooms.set(currentRoom, new Set());
            console.log(`[聊天室] 创建新聊天室: ${currentRoom}`);
          }
          
          // 清理可能存在的重复连接
          cleanupDuplicateConnections(userId);
          
          // 添加用户到聊天室
          chatRooms.get(currentRoom).add(userId);
          users.set(userId, { 
            ws, 
            name: data.name || '匿名用户',
            avatar: data.avatar || null
          });
          
          console.log(`[聊天室] 当前聊天室 ${currentRoom} 的用户数: ${chatRooms.get(currentRoom).size}`);
          
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
              // 确保用户存在且有name属性
              const senderName = users.has(userId) ? users.get(userId).name : '未知用户';
              
              broadcastToRoom(currentRoom, {
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
            break;
        
        // 音频流相关消息处理
        case 'audioStream':
          // 直接转发音频流数据
          if (userId && currentRoom && data.conferenceId) {
            console.log(`[音频流] 准备转发音频流, 用户: ${userId}, 会议: ${data.conferenceId}, 序列号: ${data.sequence}`);
            forwardAudioStream(data, userId, currentRoom);
          } else {
            console.log(`[音频流] 转发条件不满足: userId=${userId}, currentRoom=${currentRoom}, conferenceId=${data.conferenceId}`);
            
            // 检查会议ID是否存在
            if (data.conferenceId) {
              // 尝试通过WebSocket连接查找用户ID和房间ID
              let foundUserId = null;
              let foundRoomId = null;
              
              // 遍历所有用户，查找匹配当前WebSocket连接的用户
              const connectedIds = [];
              for (const [id, user] of users.entries()) {
                if (user.ws === ws) {
                  connectedIds.push(id);
                }
              }
              
              // 按优先级排序，优先使用vscode_开头的ID
              if (connectedIds.length > 0) {
                connectedIds.sort((a, b) => getPriorityValueForId(b) - getPriorityValueForId(a));
                foundUserId = connectedIds[0];
                
                // 查找此ID所在的房间
                for (const [roomId, roomUsers] of chatRooms.entries()) {
                  if (roomUsers.has(foundUserId)) {
                    foundRoomId = roomId;
                    break;
                  }
                }
              }
              
              // 如果找到了用户ID和房间ID，则使用它们进行转发
              if (foundUserId && foundRoomId) {
                console.log(`[音频流] 已找到用户和房间信息: userId=${foundUserId}, roomId=${foundRoomId}`);
                userId = foundUserId;
                currentRoom = foundRoomId;
                forwardAudioStream(data, userId, currentRoom);
              } else {
                // 没有找到已注册的用户和房间，使用Web Socket上的 userId 和 roomId
                console.log(`[音频流] 未找到用户和房间信息，尝试使用WebSocket上的信息`);
                
                // 使用WebSocket上已关联的userId和roomId（如果有的话）
                if (ws.userId && ws.roomId) {
                  userId = ws.userId;
                  currentRoom = ws.roomId;
                  console.log(`[音频流] 使用WebSocket上关联的用户ID: ${userId}, 房间ID: ${currentRoom}`);
                } else {
                  // 如果WebSocket上也没有关联ID，才创建新的临时ID
                  console.log(`[音频流] WebSocket上没有关联的ID，创建临时用户和房间`);
                
                  // 优先使用会议ID作为房间ID
                currentRoom = data.conferenceId; // 使用会议ID作为房间ID
                  
                  // 尝试从用户的Cookie或Session找出已有ID（模拟实现，实际代码中没有这个功能）
                  // 如果完全找不到，才生成新的ID
                  userId = `user_${Date.now()}`;
                
                // 保存到WebSocket对象
                ws.userId = userId;
                ws.roomId = currentRoom;
                }
                
                // 清理可能存在的重复连接
                cleanupDuplicateConnections(userId);
                
                // 确保用户存在于用户列表中
                if (!users.has(userId)) {
                // 将用户添加到用户列表
                users.set(userId, {
                  ws,
                  name: `用户_${userId.substring(0, 8)}`,
                  avatar: null
                });
                }
                
                // 创建或更新聊天室
                if (!chatRooms.has(currentRoom)) {
                  chatRooms.set(currentRoom, new Set());
                  console.log(`[聊天室] 创建新聊天室: ${currentRoom}`);
                }
                
                // 添加用户到聊天室
                chatRooms.get(currentRoom).add(userId);
                
                console.log(`[音频流] 已使用/创建用户和房间: userId=${userId}, roomId=${currentRoom}`);
                
                // 使用用户ID和房间ID转发音频流
                forwardAudioStream(data, userId, currentRoom);
              }
            } else {
              // 如果没有会议ID，返回错误消息
              ws.send(JSON.stringify({
                type: 'error',
                content: '音频流消息缺少会议ID',
                timestamp: Date.now()
              }));
            }
          }
          break;
          
        case 'audioMessage':
          // 处理语音消息
          if (userId && currentRoom) {
            // 验证base64编码的WAV音频数据
            if (data.audioData && typeof data.audioData === 'string') {
              console.log(`接收到来自 ${users.get(userId).name} 的语音消息，大小: ${data.audioData.length} 字符`);
              
              // 广播语音消息到聊天室
              broadcastToRoom(currentRoom, {
                type: 'audioMessage',
                userId: userId,
                sender: {
                  id: userId,
                  name: users.get(userId).name
                },
                audioData: data.audioData,
                duration: data.duration || 0, // 语音时长（秒）
                timestamp: Date.now(),
                id: data.id || `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`, // 保存传入的ID或生成新ID
                audioFilename: data.audioFilename // 保存文件名
              }, userId);
            } else {
              // 向发送者返回错误消息
              ws.send(JSON.stringify({
                type: 'error',
                content: '语音消息格式错误，请确保发送base64编码的WAV音频数据',
                timestamp: Date.now()
              }));
            }
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
          
        case 'privateAudioMessage':
          // 私聊语音消息
          if (userId && data.targetId && users.has(data.targetId)) {
            // 验证base64编码的WAV音频数据
            if (data.audioData && typeof data.audioData === 'string') {
              const targetWs = users.get(data.targetId).ws;
              const message = {
                type: 'privateAudioMessage',
                userId: userId,
                sender: users.get(userId).name,
                audioData: data.audioData,
                duration: data.duration || 0,
                timestamp: Date.now()
              };
              
              console.log(`发送私聊语音消息从 ${users.get(userId).name} 到 ${users.get(data.targetId).name}`);
              
              // 发送给目标用户
              targetWs.send(JSON.stringify(message));
              // 发送给自己的确认
              ws.send(JSON.stringify({
                ...message,
                isSent: true
              }));
            } else {
              // 向发送者返回错误消息
              ws.send(JSON.stringify({
                type: 'error',
                content: '私聊语音消息格式错误，请确保发送base64编码的WAV音频数据',
                timestamp: Date.now()
              }));
            }
          }
          break;
          
        case 'canvas':
          handleCanvasMessage(ws, data, userId, currentRoom);
          break;
          
        case 'voiceConference':
          // 处理语音会议相关消息
          console.log(`[会议] 收到会议消息, 用户: ${userId}, 动作: ${data.action}, 会议ID: ${data.conferenceId}`);
          handleVoiceConferenceMessage(ws, data, userId, currentRoom);
          break;
      }
    } catch (error) {
      console.error('[处理错误] 处理消息时出错:', error);
      
      // 尝试向客户端发送错误信息
      try {
        ws.send(JSON.stringify({
          type: 'error',
          content: `服务器处理消息时出错: ${error.message}`,
          timestamp: Date.now()
        }));
      } catch (sendError) {
        console.error('[处理错误] 发送错误消息失败:', sendError);
      }
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
          
          // 检查用户是否已在其他会议中
          if (voiceParticipants.has(userId)) {
            const currentConference = voiceParticipants.get(userId).conferenceId;
            if (currentConference !== joinConferenceId) {
              // 先让用户离开当前会议
              handleVoiceConferenceLeave(userId, currentConference);
            } else {
              // 用户已经在此会议中
              ws.send(JSON.stringify({
                type: 'voiceConference',
                action: 'info',
                message: '您已经在此会议中',
                conferenceId: joinConferenceId,
                timestamp: Date.now()
              }));
              return;
            }
          }
          
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
          
          // 识别同一WebSocket连接的所有ID
          const findSameConnectionIds = () => {
            const sameConnectionIds = [];
            const currentWs = ws;
            
            // 详细记录WebSocket连接信息
            console.log(`[会议调试] 当前用户ID: ${userId}, 查找相同WebSocket连接的其他ID`);
            
            // 保存当前WebSocket的特征用于调试
            let currentWsInfo = null;
            if (currentWs && currentWs._socket) {
              currentWsInfo = {
                remoteAddress: currentWs._socket.remoteAddress,
                remotePort: currentWs._socket.remotePort
              };
              console.log(`[会议调试] 当前WebSocket特征:`, currentWsInfo);
            }
            
            for (const [id, user] of users.entries()) {
              if (user.ws === currentWs) {
                sameConnectionIds.push(id);
                console.log(`[会议调试] 找到相同WebSocket连接的ID: ${id}`);
              }
              
              // 详细记录每个用户的WebSocket连接特征
              if (user.ws && user.ws._socket) {
                const wsInfo = {
                  id,
                  remoteAddress: user.ws._socket.remoteAddress,
                  remotePort: user.ws._socket.remotePort,
                  isSame: user.ws === currentWs
                };
                console.log(`[会议调试] 用户 ${id} 的WebSocket特征:`, wsInfo);
              }
            }
            
            console.log(`[会议调试] 找到 ${sameConnectionIds.length} 个使用相同WebSocket的ID: ${sameConnectionIds.join(', ')}`);
            return sameConnectionIds;
          };
          
          // 判断ID格式 - 我们优先保留已用于聊天的ID
          const isIdAlreadyInChat = (id) => {
            // 检查此ID是否已经在任何聊天室中使用
            for (const [roomId, members] of chatRooms.entries()) {
              if (members.has(id) && roomId !== currentRoom) { // 忽略当前房间
                return true;
              }
            }
            return false;
          };
          
          // 获取同一连接的所有ID
          const sameConnectionIds = findSameConnectionIds();
          
          if (sameConnectionIds.length > 1) {
            console.log(`[会议] 发现同一连接的多个ID: ${sameConnectionIds.join(', ')}`);
            
            // 优先保留已经在其他聊天室使用的ID
            const chatIds = sameConnectionIds.filter(isIdAlreadyInChat);
            console.log(`[会议调试] 找到 ${chatIds.length} 个已在其他聊天室使用的ID: ${chatIds.join(', ')}`);
            
            if (chatIds.length > 0) {
              // 优先使用已有的聊天室ID
              const idToKeep = chatIds[0];
              console.log(`[会议] 保留已在其他聊天室使用的ID: ${idToKeep}`);
              
              // 从会议中移除非聊天室的ID
              for (const id of sameConnectionIds) {
                if (id !== idToKeep) {
                  console.log(`[会议] 从会议 ${joinConferenceId} 中移除ID: ${id}`);
                  conference.participants.delete(id);
                  
                  if (voiceParticipants.has(id)) {
                    voiceParticipants.delete(id);
                  }
                }
              }
            } else {
              // 没有已在聊天室使用的ID，检查是否有"标准"格式的ID (不带额外下划线的)
              const containsExtraUnderscore = (id) => {
                const parts = id.split('_');
                // vscode_timestamp_random 格式的ID会有两个以上的下划线
                return id.startsWith('vscode_') && parts.length > 2;
              };
              
              const standardIds = sameConnectionIds.filter(id => !containsExtraUnderscore(id));
              console.log(`[会议调试] 找到 ${standardIds.length} 个标准格式ID: ${standardIds.join(', ')}`);
              
              if (standardIds.length > 0) {
                // 如果有标准格式ID，按时间戳排序保留最新的
                standardIds.sort((a, b) => {
                  const getTimestamp = (id) => {
                    const match = id.match(/^vscode_(\d+)/);
                    return match ? Number(match[1]) : 0;
                  };
                  return getTimestamp(b) - getTimestamp(a); // 降序，最新的排在前面
              });
              
                const idToKeep = standardIds[0];
                console.log(`[会议] 保留标准格式的最新ID: ${idToKeep}`);
              
              for (const id of sameConnectionIds) {
                if (id !== idToKeep) {
                  console.log(`[会议] 从会议 ${joinConferenceId} 中移除ID: ${id}`);
                  conference.participants.delete(id);
                  
                  if (voiceParticipants.has(id)) {
                    voiceParticipants.delete(id);
                  }
                }
              }
            } else {
                // 全部是复杂格式的ID，保留时间戳最新的
                console.log(`[会议调试] 没有找到标准格式ID，保留时间戳最新的ID`);
              
              // 按照ID中的时间戳部分排序
              sameConnectionIds.sort((a, b) => {
                // 提取vscode_后面的时间戳部分
                const getTimestamp = (id) => {
                  const match = id.match(/^vscode_(\d+)/);
                  return match ? Number(match[1]) : 0;
                };
                return getTimestamp(b) - getTimestamp(a); // 降序，最新的排在前面
              });
              
              const idToKeep = sameConnectionIds[0];
              console.log(`[会议] 保留时间戳最新的ID: ${idToKeep}`);
              
              for (const id of sameConnectionIds) {
                if (id !== idToKeep) {
                  console.log(`[会议] 从会议 ${joinConferenceId} 中移除ID: ${id}`);
                  conference.participants.delete(id);
                  
                  if (voiceParticipants.has(id)) {
                    voiceParticipants.delete(id);
                    }
                  }
                }
              }
            }
          } else {
            console.log(`[会议调试] 没有发现同一连接的多个ID，保留唯一ID: ${userId}`);
          }
          
          console.log(`[会议] 清理后的会议参与者列表:`, Array.from(conference.participants));
          
          // 发送成功消息给加入者
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'joined',
            conferenceId: joinConferenceId,
            status: 'success',
            participants: getConferenceParticipants(joinConferenceId),
            timestamp: Date.now()
          }));
          
          // 向会议中其他参与者广播新用户加入消息
          broadcastToConference(joinConferenceId, {
            type: 'voiceConference',
            action: 'participantJoined',
            conferenceId: joinConferenceId,
            userId: userId,
            userName: users.get(userId).name,
            timestamp: Date.now(),
            participants: getConferenceParticipants(joinConferenceId)
          }, userId);
          
          // 广播会议更新消息到聊天室
          broadcastToRoom(currentRoom, {
            type: 'voiceConference',
            action: 'updated',
            conferenceId: joinConferenceId,
            timestamp: Date.now(),
            participantCount: conference.participants.size
          }, null);
        } else {
          // 会议不存在，发送错误消息
          ws.send(JSON.stringify({
            type: 'voiceConference',
            action: 'error',
            message: '会议不存在',
            timestamp: Date.now()
          }));
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
 * 转发音频流数据到会议中的其他参与者
 * @param {Object} data 音频流数据
 * @param {string} senderId 发送者ID
 * @param {string} roomId 聊天室ID
 */
function forwardAudioStream(data, senderId, roomId) {
    const conferenceId = data.conferenceId;
    
    // 检查并清理可能存在的重复ID - 确保同一个WebSocket连接只关联一个用户ID
    // 优先保留聊天室已有的ID
    if (senderId) {
        // 查找其他可能关联到同一个WebSocket连接的ID
        const senderWs = users.get(senderId)?.ws;
        if (senderWs) {
            // 遍历所有用户寻找同一个WebSocket连接
            const sameWsIds = [];
            for (const [id, user] of users.entries()) {
                if (user.ws === senderWs) {
                    sameWsIds.push(id);
                }
            }
            
            // 如果找到多个ID使用同一WebSocket连接，进行清理
            if (sameWsIds.length > 1) {
                console.log(`[音频转发] 发现WebSocket连接有多个ID: ${sameWsIds.join(', ')}`);
                console.log(`[音频转发] 当前使用ID: ${senderId}`);
                
                // 保留当前senderId，清理其他ID
                for (const id of sameWsIds) {
                    if (id !== senderId) {
                        console.log(`[音频转发] 清理重复ID: ${id}`);
                    
                    // 从所有房间中移除该ID
                    for (const [rid, roomUsers] of chatRooms.entries()) {
                        if (roomUsers.has(id)) {
                            roomUsers.delete(id);
                                console.log(`[音频转发] 已从房间 ${rid} 移除重复ID: ${id}`);
                        }
                    }
                    
                    // 从会议中移除该ID
                    if (voiceParticipants.has(id)) {
                        const oldConfId = voiceParticipants.get(id).conferenceId;
                            console.log(`[音频转发] 已从会议 ${oldConfId} 移除重复ID: ${id}`);
                            voiceParticipants.delete(id);
                    }
                    }
                }
            }
        }
    }
    
    console.log(`[音频转发] 准备转发音频流数据，大小: ${data.audioData ? data.audioData.length : 0} 字节，` +
                `发送者: ${senderId}, 会议ID: ${conferenceId}`);
    
    // 检查会议是否存在，如果不存在则自动创建
    if (!voiceConferences.has(conferenceId)) {
        console.log(`[音频转发] 会议 ${conferenceId} 不存在，自动创建`);
        
        // 创建新会议
        voiceConferences.set(conferenceId, {
            id: conferenceId,
            creator: senderId,
            roomId: roomId,
            participants: new Set(),
            createdAt: Date.now()
        });
        
        // 广播会议创建消息
        broadcastToRoom(roomId, {
            type: 'voiceConference',
            action: 'created',
            conferenceId: conferenceId,
            creatorId: senderId,
            creatorName: users.get(senderId).name,
            timestamp: Date.now()
        }, null);
    }
    
    // 获取会议实例
    const conference = voiceConferences.get(conferenceId);
    
    // 清理会议中的重复ID，保持与会议加入逻辑一致
    const cleanupDuplicateParticipants = () => {
        // 找出同一WebSocket连接的所有ID
        const wsToIds = new Map(); // WebSocket -> 相关ID列表

        // 详细记录当前会议的参与者
        console.log(`[音频转发调试] 当前会议参与者列表: ${Array.from(conference.participants).join(', ')}`);
 
        // 第一步：按WebSocket连接分组所有ID
        for (const participantId of conference.participants) {
            if (users.has(participantId)) {
                const userWs = users.get(participantId).ws;
                if (userWs) {
                    // 记录用户WebSocket特征
                    if (userWs._socket) {
                        console.log(`[音频转发调试] 用户 ${participantId} 的WebSocket特征:`, {
                            remoteAddress: userWs._socket.remoteAddress,
                            remotePort: userWs._socket.remotePort
                        });
                    }
                     
                    if (!wsToIds.has(userWs)) {
                        wsToIds.set(userWs, []);
                    }
                    wsToIds.get(userWs).push(participantId);
                }
            }
        }
 
        // 第二步：处理每组WebSocket连接中的多个ID
        for (const [ws, ids] of wsToIds.entries()) {
            if (ids.length <= 1) {
                console.log(`[音频转发调试] WebSocket连接只有一个ID: ${ids[0]}`);
                continue; // 只有一个ID，无需处理
            }
             
            console.log(`[音频转发] 发现同一WebSocket连接的多个ID: ${ids.join(', ')}`);
             
            // 如果当前发送者ID在列表中，优先保留它
            if (ids.includes(senderId)) {
                const idToKeep = senderId;
                console.log(`[音频转发] 当前发送者ID ${senderId} 在冲突ID列表中，优先保留此ID`);
                
                // 从会议中移除其他ID
                for (const id of ids) {
                    if (id !== idToKeep) {
                        console.log(`[音频转发] 从会议 ${conferenceId} 中移除ID: ${id}`);
                        conference.participants.delete(id);
                        
                        if (voiceParticipants.has(id)) {
                            voiceParticipants.delete(id);
                        }
                    }
                }
                continue; // 已处理完此组ID
            }

            // 优先选择非vscode_时间戳_随机数格式的ID (即优先保留聊天室ID)
            const containsUnderscore = (id) => {
                const parts = id.split('_');
                // 如果是 vscode_timestamp_random 格式，parts长度会大于2
                return id.startsWith('vscode_') && parts.length > 2;
            };
             
            // 检查是否有非vscode_timestamp_random格式的ID (更可能是聊天室使用的ID)
            const standardIds = ids.filter(id => !containsUnderscore(id));
            
            console.log(`[音频转发调试] 过滤后标准ID格式的数量: ${standardIds.length}`, standardIds);
             
            if (standardIds.length > 0) {
                // 如果有标准格式ID，保留时间戳最新的一个
                standardIds.sort((a, b) => {
                    // 提取时间戳部分
                    const getTimestamp = (id) => {
                        const match = id.match(/^vscode_(\d+)/);
                        return match ? Number(match[1]) : 0;
                    };
                    return getTimestamp(b) - getTimestamp(a); // 降序，最新的排在前面
                });
                 
                const idToKeep = standardIds[0];
                console.log(`[音频转发] 保留标准格式的最新ID: ${idToKeep}`);
                 
                for (const id of ids) {
                    if (id !== idToKeep) {
                        console.log(`[音频转发] 从会议 ${conferenceId} 中移除ID: ${id}`);
                        conference.participants.delete(id);
                        
                        if (voiceParticipants.has(id)) {
                            voiceParticipants.delete(id);
                        }
                    }
                }
            } else {
                // 全部是复杂格式，按时间戳从新到旧排序
                ids.sort((a, b) => {
                    // 提取vscode_后面的时间戳部分
                    const getTimestamp = (id) => {
                        const match = id.match(/^vscode_(\d+)/);
                        return match ? Number(match[1]) : 0;
                    };
                    return getTimestamp(b) - getTimestamp(a); // 降序，最新的排在前面
                });
                 
                const idToKeep = ids[0];
                console.log(`[音频转发] 保留时间戳最新的ID: ${idToKeep}`);
                 
                for (const id of ids) {
                    if (id !== idToKeep) {
                        console.log(`[音频转发] 从会议 ${conferenceId} 中移除ID: ${id}`);
                        conference.participants.delete(id);
                        
                        if (voiceParticipants.has(id)) {
                            voiceParticipants.delete(id);
                        }
                    }
                }
            }
        }
         
        console.log(`[音频转发] 清理后的会议参与者列表:`, Array.from(conference.participants));
    };

    // 执行清理
    cleanupDuplicateParticipants();
    
    // 检查发送者是否已经是会议参与者，如果不是则自动加入
    if (!voiceParticipants.has(senderId) || 
        voiceParticipants.get(senderId).conferenceId !== conferenceId) {
        
        console.log(`[音频转发] 发送者 ${senderId} 不是会议 ${conferenceId} 的参与者，自动加入`);
        
        // 如果发送者已在其它会议中，先让其离开
        if (voiceParticipants.has(senderId)) {
            const oldConferenceId = voiceParticipants.get(senderId).conferenceId;
            handleVoiceConferenceLeave(senderId, oldConferenceId);
        }
        
        // 添加发送者为会议参与者
        voiceParticipants.set(senderId, {
            conferenceId: conferenceId,
            isMuted: false,
            joinedAt: Date.now()
        });
        
        // 将发送者添加到会议参与者列表
        conference.participants.add(senderId);
        
        // 再次执行清理，确保新加入的用户不会创建重复ID
        cleanupDuplicateParticipants();
        
        console.log(`[音频转发] 已将发送者 ${senderId} 添加到会议 ${conferenceId}`);
    }
    
    // 检查发送者是否处于静音状态
    if (voiceParticipants.has(senderId) && voiceParticipants.get(senderId).isMuted) {
        console.log(`[音频转发] 用户 ${senderId} 已静音，不转发音频`);
        return; // 静音状态不转发音频
    }
    
    const participantCount = conference.participants.size;
    
    console.log(`[音频转发] 准备向 ${participantCount-1} 个参与者转发音频流，序列号: ${data.sequence || 0}`);
    
    // 记录所有参与者
    console.log(`[音频转发] 会议参与者列表:`, Array.from(conference.participants));
    
    // 创建转发消息
    const audioStreamMessage = JSON.stringify({
        type: 'audioStream',
        conferenceId: conferenceId,
        senderId: senderId,
        senderName: users.get(senderId).name,
        audioData: data.audioData,
        sequence: data.sequence || 0,
        format: data.format || { sampleRate: 44100, numChannels: 1, bitsPerSample: 16 },
        timestamp: Date.now()
    });
    
    // 记录转发消息的基本信息（不包含实际数据，以避免日志过大）
    console.log(`[音频转发] 音频流消息已创建，大小: ${audioStreamMessage.length} 字节`);
    
    let forwardCount = 0;
    let errorCount = 0;
    
    // 判断是否只有一个参与者（即发送者自己）
    const isSingleParticipant = participantCount <= 1;
    console.log(`[音频转发] 会议参与者数量: ${participantCount}, 是否只有一人: ${isSingleParticipant}`);
    
    // 向会议中的其他参与者转发，永远不向发送者本人转发
    conference.participants.forEach(participantId => {
        // 判断是否应该转发(永远跳过发送者自己)
        const shouldForward = (participantId !== senderId);
        
        if (shouldForward && users.has(participantId)) {
            try {
                const targetUser = users.get(participantId);
                
                // 检查目标用户的WebSocket连接是否仍然有效
                if (targetUser && targetUser.ws && targetUser.ws.readyState === WebSocket.OPEN) {
                    targetUser.ws.send(audioStreamMessage);
                    forwardCount++;
                        console.log(`[音频转发] 已转发音频数据到用户: ${participantId}`);
                } else {
                    console.error(`[音频转发] 用户 ${participantId} 的WebSocket连接不可用，状态: ${targetUser?.ws?.readyState}`);
                    errorCount++;
                }
            } catch (error) {
                console.error(`[音频转发] 向用户 ${participantId} 转发音频流失败:`, error);
                errorCount++;
            }
        } else if (participantId === senderId) {
            console.log(`[音频转发] 跳过向发送者 ${senderId} 转发（防止回传）`);
        } else if (!users.has(participantId)) {
            console.error(`[音频转发] 用户 ${participantId} 不存在`);
            errorCount++;
        }
    });
    
    console.log(`[音频转发] 音频流转发完成，成功: ${forwardCount}，失败: ${errorCount}，序列号: ${data.sequence || 0}`);
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