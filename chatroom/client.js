const WebSocket = require('ws');
const readline = require('readline'); // 用于命令行交互测试

let wsClient = null;
let currentRoomId = 'default'; // 默认房间ID
let currentUserId = `client_${Date.now()}`; // 默认用户ID
let currentUserName = 'TestClientUser'; // 默认用户名
let reconnectAttempts = 0;
let maxReconnectAttempts = 3;
let reconnectTimeout = null;
let isManualDisconnect = false; // 添加主动断开标志

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * 连接到 WebSocket 服务器
 * @param {number} port 服务器端口号
 * @param {string} roomId 要加入的房间ID
 * @param {string} userId 用户ID
 * @param {string} userName 用户名
 * @param {string} ipAddress 服务器IP地址
 * @returns {WebSocket} WebSocket 实例
 */
function connectToServer(port = 3000, roomId = 'default', userId = `client_${Date.now()}`, userName = 'TestClientUser', ipAddress = 'localhost') {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    console.log('已经连接到服务器。');
    return wsClient;
  }
  
  // 重置重连尝试计数和断开标志
  reconnectAttempts = 0;
  isManualDisconnect = false;
  
  // 清除任何可能存在的重连计时器
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const serverUrl = `ws://${ipAddress}:${port}`;
  console.log(`尝试连接到服务器: ${serverUrl}`);
  
  try {
    wsClient = new WebSocket(serverUrl);

    currentRoomId = roomId;
    currentUserId = userId;
    currentUserName = userName;

    wsClient.onopen = () => {
      console.log(`已连接到聊天服务器 ${serverUrl}`);
      // 重置重连尝试计数
      reconnectAttempts = 0;
      
      // 发送加入房间的消息
      const joinMessage = {
        type: 'join',
        roomId: currentRoomId,
        userId: currentUserId,
        name: currentUserName,
        avatar: null // 您可以根据需要设置头像
      };
      
      try {
        wsClient.send(JSON.stringify(joinMessage));
        console.log(`尝试加入房间: ${currentRoomId}，用户名为: ${currentUserName}`);
        
        // 检查readline状态后再调用promptForMessage
        if (!rl.closed) {
          promptForMessage(); // 连接成功后开始提示输入
        }
      } catch (sendError) {
        console.error('发送加入消息失败:', sendError);
      }
    };

    wsClient.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('\n收到消息:', message);
        // 在实际前端应用中，这里会更新UI
        // 例如: displayMessage(message);
        
        // 检查readline状态后再调用promptForMessage
        if (!rl.closed) {
          promptForMessage(); // 收到消息后再次提示输入
        }
      } catch (error) {
        console.error('解析服务器消息时出错:', error);
        console.log('原始消息数据:', event.data);
      }
    };

    wsClient.onerror = (error) => {
      console.error('WebSocket 错误:', error.message || '未知错误');
      // 不在这里尝试重连，而是在onclose中处理，避免重复重连
    };

    wsClient.onclose = (event) => {
      console.log(`与聊天服务器断开连接。代码: ${event.code}, 原因: ${event.reason || '无'}`);
      
      // 在尝试重连前先保存引用，因为要设置wsClient = null
      const savedWsClient = wsClient;
      wsClient = null;
      
      // 只有在非手动断开且未达到最大重连次数时才尝试重连
      if (!isManualDisconnect && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectAttempts * 1000; // 递增延迟，1秒，2秒，3秒...
        console.log(`将在 ${delay/1000} 秒后尝试第 ${reconnectAttempts} 次重连...`);
        
        reconnectTimeout = setTimeout(() => {
          console.log(`正在尝试第 ${reconnectAttempts} 次重连...`);
          connectToServer(port, roomId, userId, userName, ipAddress);
        }, delay);
      } else {
        if (isManualDisconnect) {
          console.log('手动断开连接，不尝试重连。');
        } else {
          console.log('达到最大重连次数，不再尝试重连。');
        }
        
        // 安全关闭readline - 只在不再重连时关闭
        if (rl && !rl.closed) {
          try {
            rl.close();
            console.log('readline接口已安全关闭');
          } catch (err) {
            console.error('关闭readline时出错:', err);
          }
        }
      }
    };
    
    return wsClient;
  } catch (e) {
    console.error('创建WebSocket连接时出错:', e);
    return null;
  }
}

/**
 * 发送公共消息
 * @param {string} content 消息内容
 * @returns {boolean} 是否发送成功
 */
function sendMessage(content) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    try {
      const message = {
        type: 'message',
        content: content
        // 服务器会从连接上下文中获取 userId 和 roomId
      };
      wsClient.send(JSON.stringify(message));
      console.log('已发送消息:', content);
      return true;
    } catch (error) {
      console.error('发送消息失败:', error);
      return false;
    }
  } else {
    console.log('未连接到服务器，无法发送消息。');
    promptForMessage(); // 如果未连接，重新提示
    return false;
  }
}

/**
 * 发送语音消息
 * @param {string} audioData base64编码的WAV格式音频数据
 * @param {number} duration 语音时长（秒）
 * @param {string} audioFilename 音频文件名（可选）
 * @param {string} messageId 消息唯一标识ID（可选，如果不提供则生成一个）
 * @returns {boolean} 是否发送成功
 */
function sendAudioMessage(audioData, duration = 0, audioFilename = null, messageId = null) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    try {
      // 使用传入的messageId或生成一个新的
      const actualMessageId = messageId || `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const message = {
        type: 'audioMessage',
        audioData: audioData,
        duration: duration,
        id: actualMessageId
        // 服务器会从连接上下文中获取 userId 和 roomId
      };
      
      // 如果提供了文件名，添加到消息中
      if (audioFilename) {
        message.audioFilename = audioFilename;
      }
      
      console.log(`发送语音消息: ID=${actualMessageId}${audioFilename ? ', 文件名=' + audioFilename : ''}`);
      
      wsClient.send(JSON.stringify(message));
      console.log('已发送语音消息，数据大小:', audioData.length, '字符');
      return true;
    } catch (error) {
      console.error('发送语音消息失败:', error);
      return false;
    }
  } else {
    console.log('未连接到服务器，无法发送语音消息。');
    return false;
  }
}

/**
 * 检查连接状态
 * @returns {boolean} 是否已连接
 */
function isConnected() {
  return wsClient !== null && wsClient.readyState === WebSocket.OPEN;
}

/**
 * 发送私聊消息
 * @param {string} targetId 目标用户ID
 * @param {string} content 消息内容
 */
function sendPrivateMessage(targetId, content) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    const message = {
      type: 'privateMessage',
      targetId: targetId,
      content: content
    };
    wsClient.send(JSON.stringify(message));
    console.log(`已发送私聊消息给 ${targetId}: ${content}`);
  } else {
    console.log('未连接到服务器，无法发送私聊消息。');
    promptForMessage(); // 如果未连接，重新提示
  }
}

/**
 * 发送私聊语音消息
 * @param {string} targetId 目标用户ID
 * @param {string} audioData base64编码的WAV格式音频数据
 * @param {number} duration 语音时长（秒）
 * @returns {boolean} 是否发送成功
 */
function sendPrivateAudioMessage(targetId, audioData, duration = 0) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    try {
      const message = {
        type: 'privateAudioMessage',
        targetId: targetId,
        audioData: audioData,
        duration: duration
      };
      wsClient.send(JSON.stringify(message));
      console.log(`已发送私聊语音消息给 ${targetId}，数据大小: ${audioData.length} 字符`);
      return true;
    } catch (error) {
      console.error('发送私聊语音消息失败:', error);
      return false;
    }
  } else {
    console.log('未连接到服务器，无法发送私聊语音消息。');
    return false;
  }
}

/**
 * 断开与服务器的连接
 * @param {boolean} manual 是否是手动断开连接
 */
function disconnectFromServer(manual = true) {
  if (wsClient) {
    console.log('正在断开与服务器的连接...');
    isManualDisconnect = manual; // 设置主动断开标志
    
    try {
      wsClient.close();
    } catch (error) {
      console.error('关闭WebSocket连接时出错:', error);
    } finally {
      wsClient = null;
      
      // 安全关闭readline
      if (rl && !rl.closed) {
        try {
          rl.close();
          console.log('readline接口已安全关闭');
        } catch (err) {
          // 忽略关闭错误
        }
      }
    }
  }
}

/**
 * 提示用户输入消息的函数 (用于命令行测试)
 */
function promptForMessage() {
  // 首先检查readline是否已关闭或WebSocket连接是否无效
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN || rl.closed) {
    // 如果连接已关闭或readline已关闭，不再提示
    if (wsClient === null && !rl.closed) {
      console.log('连接已关闭。输入任何键退出。');
      try {
        rl.close(); // 确保readline在连接关闭时关闭
      } catch (err) {
        // 忽略关闭错误
      }
    }
    return;
  }
  
  try {
    rl.question('输入消息 (或 "/quit" 断开, "/pm <userId> <消息>" 发私信): ', (input) => {
      // 再次检查连接和readline状态
      if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        if (!rl.closed) {
          try {
            rl.close();
          } catch (err) {
            // 忽略关闭错误
          }
        }
        return;
      }
      
      if (input.toLowerCase() === '/quit') {
        disconnectFromServer();
        return;
      }
      
      if (input.startsWith('/pm ')) {
        const parts = input.split(' ');
        if (parts.length >= 3) {
          const targetUserId = parts[1];
          const privateMsgContent = parts.slice(2).join(' ');
          sendPrivateMessage(targetUserId, privateMsgContent);
        } else {
          console.log('私聊消息格式错误。请使用: /pm <userId> <消息>');
        }
      } else if (input.trim() !== '') {
        sendMessage(input);
      }
    });
  } catch (error) {
    console.error('readline操作错误:', error);
    // 如果readline出错，尝试关闭它
    if (!rl.closed) {
      try {
        rl.close();
      } catch (err) {
        // 忽略关闭错误
      }
    }
  }
}

/**
 * 离开当前聊天室但保持连接
 * @returns {boolean} 是否成功发送离开消息
 */
function leaveRoom() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    try {
      const leaveMessage = {
        type: 'leave',
        roomId: currentRoomId
      };
      wsClient.send(JSON.stringify(leaveMessage));
      console.log(`已离开房间: ${currentRoomId}`);
      return true;
    } catch (error) {
      console.error('发送离开房间消息失败:', error);
      return false;
    }
  } else {
    console.log('未连接到服务器，无法离开房间。');
    return false;
  }
}

/**
 * 加入指定聊天室
 * @param {string} roomId 要加入的房间ID
 * @returns {boolean} 是否成功发送加入消息
 */
function joinRoom(roomId) {
  if (!roomId) {
    console.error('未指定房间ID');
    return false;
  }
  
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    try {
      const joinMessage = {
        type: 'join',
        roomId: roomId,
        userId: currentUserId,
        name: currentUserName
      };
      
      currentRoomId = roomId; // 更新当前房间ID
      
      wsClient.send(JSON.stringify(joinMessage));
      console.log(`已加入房间: ${roomId}`);
      return true;
    } catch (error) {
      console.error('发送加入房间消息失败:', error);
      return false;
    }
  } else {
    console.log('未连接到服务器，无法加入房间。');
    return false;
  }
}

// 如果此文件被直接执行 (例如通过 npm run test-chat-client)
if (require.main === module) {
  const defaultPort = 3000; // 服务器默认端口
  // 可以从命令行参数获取端口、房间名等信息
  // const args = process.argv.slice(2);
  // const port = args[0] ? parseInt(args[0]) : defaultPort;
  // const room = args[1] || 'defaultRoom';
  // const user = args[2] || `cliUser_${Date.now()}`;
  // const name = args[3] || 'CLI User';

  console.log(`尝试连接到聊天服务器，端口: ${defaultPort}...`);
  connectToServer(defaultPort, 'testRoom', `cliUser_${Date.now()}`, 'CLI User Test');
}

module.exports = {
  connectToServer,
  sendMessage,
  sendAudioMessage,
  sendPrivateMessage,
  sendPrivateAudioMessage,
  disconnectFromServer,
  isConnected,
  leaveRoom,
  joinRoom
};