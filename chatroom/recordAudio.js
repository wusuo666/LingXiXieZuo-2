#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Mic = require('node-microphone');
const WebSocket = require('ws');
// 添加音频处理库
const WavEncoder = require('wav-encoder');
const WavDecoder = require('wav-decoder');
const AudioBuffer = require('audio-buffer');
const os = require('os');
const dns = require('dns');

// 全局配置
const config = {
  audio: {
    sampleRate: 44100,
    numChannels: 1,
    bitsPerSample: 16,
    enhancementEnabled: true,
    calibrationFactor: 1.35
  },
  server: {
    port: 3000,
    address: 'localhost'
  },
  conferenceId: 'default'
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    streamMode: args.includes('-stream'),
    duration: parseInt(args[0] || '5', 10),
    quality: 'medium'
  };
  
  // 提取服务器参数
  const portIndex = args.indexOf('-port');
  if (portIndex !== -1 && args.length > portIndex + 1) {
    config.server.port = parseInt(args[portIndex + 1], 10);
  }
  
  const addressIndex = args.indexOf('-address');
  if (addressIndex !== -1 && args.length > addressIndex + 1) {
    config.server.address = args[addressIndex + 1];
  }
  
  // 提取会议ID
  const confIdIndex = args.indexOf('-conferenceId');
  if (confIdIndex !== -1 && args.length > confIdIndex + 1) {
    config.conferenceId = args[confIdIndex + 1];
  }
  
  // 提取用户ID
  const userIdIndex = args.indexOf('-userId');
  if (userIdIndex !== -1 && args.length > userIdIndex + 1) {
    options.userId = args[userIdIndex + 1];
  } else {
    options.userId = findExistingUserId() || `user_${Date.now()}`;
  }
  
  // 提取工作区路径
  options.workspacePath = getWorkspacePath(args);
  
  // 设置音频质量
  const qualityIndex = args.indexOf('-quality');
  if (qualityIndex !== -1 && args.length > qualityIndex + 1) {
    options.quality = args[qualityIndex + 1];
  }
  
  return options;
}

// 获取工作区路径
function getWorkspacePath(args) {
  // 从参数获取
  const workspaceIndex = args.indexOf('-workspace');
  if (workspaceIndex !== -1 && args.length > workspaceIndex + 1) {
    const path = args[workspaceIndex + 1].replace(/\\\\/g, '\\').replace(/^["']|["']$/g, '');
    if (fs.existsSync(path)) return path;
  }
  
  return null;
}

// 查找已保存的用户ID
function findExistingUserId() {
  const possiblePaths = [
    path.join(os.tmpdir(), 'lingxi-userid'),
    path.join(process.env.HOME || process.env.USERPROFILE, '.lingxi-userid')
  ];
  
  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const userId = fs.readFileSync(filePath, 'utf8').trim();
        if (userId) return userId;
      } catch (err) {}
    }
  }
  
  return null;
}

// 保存用户ID
function saveUserId(userId) {
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'lingxi-userid'), userId);
  } catch (err) {}
}

// 创建WAV文件头
function createWavHeader(sampleRate = config.audio.sampleRate) {
  const numChannels = config.audio.numChannels;
  const bitsPerSample = config.audio.bitsPerSample;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  
  const header = Buffer.alloc(44);
  
  // RIFF头
  header.write('RIFF', 0);
  header.writeUInt32LE(0, 4); // 文件大小，稍后更新
  header.write('WAVE', 8);
  
  // fmt子块
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM格式
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  
  // data子块
  header.write('data', 36);
  header.writeUInt32LE(0, 40); // 数据大小，稍后更新
  
  return header;
}

// 简化的音频增强
function enhanceAudio(audioData) {
  // 简化后的音频增强逻辑
  // 将Buffer转换为Float32Array用于处理
  const buffer = Buffer.from(audioData);
  const floatData = new Float32Array(buffer.length / 2);
  
  // 提取音频样本
  for (let i = 0; i < buffer.length / 2; i++) {
    floatData[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }
  
  // 简单的音频增强：增益和柔化处理
  for (let i = 0; i < floatData.length; i++) {
    // 增益调整
    floatData[i] *= 1.5;
    
    // 软限幅
    floatData[i] = Math.tanh(floatData[i]);
  }
  
  // 转换回Buffer
  const resultBuffer = Buffer.alloc(floatData.length * 2);
  for (let i = 0; i < floatData.length; i++) {
    resultBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(floatData[i] * 32768))), i * 2);
  }
  
  return resultBuffer;
}

// 录音功能
async function recordAudio(options) {
  return new Promise((resolve, reject) => {
    const mic = new Mic();
    const audioChunks = [];
    let recordingStartTime = null;
    const targetDuration = options.duration * 1000;
    
    // 设置输出文件
    let outputFile = null;
    let savedFilePath = null;
    
    if (options.workspacePath) {
      const recordingsDir = path.join(options.workspacePath, 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      savedFilePath = path.join(recordingsDir, `recording_${timestamp}.wav`);
      outputFile = fs.createWriteStream(savedFilePath);
      outputFile.write(createWavHeader());
    }
    
    // 开始录音
    const micStream = mic.startRecording();
    
    // 数据处理
    micStream.on('data', (data) => {
      if (recordingStartTime === null) {
        recordingStartTime = Date.now();
      }
      
      audioChunks.push(data);
    });
    
    // 错误处理
    micStream.on('error', (err) => {
      mic.stopRecording();
      if (outputFile) outputFile.end();
      reject(err);
    });
    
    // 检查录制时长
    const checkDuration = () => {
      if (recordingStartTime === null) {
        setTimeout(checkDuration, 100);
        return;
      }
      
      const elapsedTime = Date.now() - recordingStartTime;
      if (elapsedTime < targetDuration) {
        setTimeout(checkDuration, Math.min(targetDuration - elapsedTime, 1000));
        return;
      }
      
      // 完成录音
      mic.stopRecording();
      
      // 处理音频
      const combinedAudio = Buffer.concat(audioChunks);
      const enhancedAudio = enhanceAudio(combinedAudio);
      
      // 计算时长
      const actualDuration = (Date.now() - recordingStartTime) / 1000;
      const adjustedSampleRate = Math.floor(config.audio.sampleRate / config.audio.calibrationFactor);
      
      if (savedFilePath) {
        // 更新WAV头部
        outputFile.end();
        const header = createWavHeader(adjustedSampleRate);
        header.writeUInt32LE(enhancedAudio.length + 36, 4); // 文件大小
        header.writeUInt32LE(enhancedAudio.length, 40); // 数据大小
        
        // 写入完整文件
        fs.writeFileSync(savedFilePath, Buffer.concat([header, enhancedAudio]));
        
        // 读取文件并返回
        const fileData = fs.readFileSync(savedFilePath);
        resolve({
          audioData: fileData.toString('base64'),
          filename: path.basename(savedFilePath),
          enhanced: true,
          durationMs: Math.round(actualDuration * 1000)
        });
      } else {
        // 没有保存文件，返回内存中的数据
        const header = createWavHeader(adjustedSampleRate);
        header.writeUInt32LE(enhancedAudio.length + 36, 4);
        header.writeUInt32LE(enhancedAudio.length, 40);
        
        const completeAudio = Buffer.concat([header, enhancedAudio]);
        resolve({
          audioData: completeAudio.toString('base64'),
          filename: `virtual_recording_${Date.now()}.wav`,
          enhanced: true,
          virtual: true,
          durationMs: Math.round(actualDuration * 1000)
        });
      }
    };
    
    // 开始检查
    checkDuration();
  });
}

// 音频流功能
async function streamAudio(options) {
  return new Promise((resolve, reject) => {
    const mic = new Mic();
    let sequenceNumber = 0;
    let streamOutputFile = null;
    
    // 确保用户ID格式正确
    if (!options.userId) {
      options.userId = `user_${Date.now()}`;
    }
    
    // 确保用户ID有正确的前缀
    if (!options.userId.startsWith('vscode_') && !options.userId.startsWith('user_')) {
      const isVSCode = process.env.VSCODE_PID || process.env.VSCODE_CWD || 
                      process.title.toLowerCase().includes('vscode');
      options.userId = isVSCode ? `vscode_${options.userId}` : `user_${options.userId}`;
    }
    
    // 生成用户名 - 这是关键修复点
    const userName = `Stream_${options.userId.substring(0, 8)}`;
    
    // 如果需要保存流记录
    if (options.workspacePath) {
      const recordingsDir = path.join(options.workspacePath, 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const streamFilePath = path.join(recordingsDir, `stream_${config.conferenceId}_${timestamp}.wav`);
      streamOutputFile = fs.createWriteStream(streamFilePath);
      streamOutputFile.write(createWavHeader());
    }
    
    // 连接WebSocket
    const ws = new WebSocket(`ws://${config.server.address}:${config.server.port}`);
    
    ws.on('open', () => {
      // 发送身份验证 - 确保包含name字段
      ws.send(JSON.stringify({
        type: 'join',
        userId: options.userId,
        roomId: 'default',
        name: userName // 使用生成的用户名
      }));
      
      // 发送初始化消息
      const adjustedSampleRate = Math.floor(config.audio.sampleRate / config.audio.calibrationFactor);
      ws.send(JSON.stringify({
        type: 'init',
        role: 'streamer',
        format: {
          sampleRate: adjustedSampleRate,
          numChannels: config.audio.numChannels,
          bitsPerSample: config.audio.bitsPerSample
        },
        enhancementEnabled: config.audio.enhancementEnabled
      }));
      
      // 开始录音
      const micStream = mic.startRecording();
      
      micStream.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          // 处理音频数据
          const enhancedData = enhanceAudio(data);
          
          // 发送音频流消息 - 确保包含所有必要字段
          ws.send(JSON.stringify({
            type: 'audioStream',
            conferenceId: config.conferenceId,
            senderId: options.userId,
            senderName: userName, // 使用生成的用户名
            sequence: sequenceNumber++,
            timestamp: Date.now(),
            format: {
              sampleRate: adjustedSampleRate,
              numChannels: config.audio.numChannels,
              bitsPerSample: config.audio.bitsPerSample,
              isWav: false
            },
            audioData: enhancedData.toString('base64')
          }));
          
          // 保存到文件
          if (streamOutputFile) {
            streamOutputFile.write(enhancedData);
          }
        }
      });
      
      // 错误处理
      micStream.on('error', (err) => {
        mic.stopRecording();
        if (streamOutputFile) streamOutputFile.end();
        ws.close();
        reject(err);
      });
      
      // 处理WebSocket关闭
      ws.on('close', () => {
        mic.stopRecording();
        if (streamOutputFile) streamOutputFile.end();
        resolve();
      });
      
      // 处理WebSocket错误
      ws.on('error', (err) => {
        mic.stopRecording();
        if (streamOutputFile) streamOutputFile.end();
        reject(err);
      });
    });
    
    // 处理WebSocket连接错误
    ws.on('error', (err) => {
      console.error('WebSocket连接错误:', err.message);
      reject(err);
    });
  });
}

// 主程序
async function main() {
  const options = parseArgs();
  
  // 保存用户ID
  saveUserId(options.userId);
  
  if (options.streamMode) {
    // 音频流模式
    try {
      await streamAudio(options);
      process.exit(0);
    } catch (err) {
      console.error('音频流失败:', err.message);
      process.exit(1);
    }
  } else {
    // 录音模式
    try {
      const result = await recordAudio(options);
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } catch (err) {
      console.error('录音失败:', err.message);
      process.exit(1);
    }
  }
}

// 启动程序
main(); 