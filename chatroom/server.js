const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 聊天室用户和消息存储
const chatRooms = new Map(); // 存储多个聊天室
const users = new Map(); // 存储用户信息

// 创建HTTP服务器
const server = http.createServer((req, res) => {
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
  } else {
    res.writeHead(404);
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

// 向聊天室广播消息
function broadcastToRoom(roomId, message, senderUserId = null) {
  if (!chatRooms.has(roomId)) return;
  
  const messageStr = JSON.stringify(message);
  chatRooms.get(roomId).forEach(userId => {
    // 不向消息发送者发送消息
    if (users.has(userId) && userId !== senderUserId) {
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