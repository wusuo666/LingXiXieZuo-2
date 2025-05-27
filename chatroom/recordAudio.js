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

// 提前定义getWorkspacePath函数，使用函数声明而不是函数表达式
function getWorkspacePath(args) {
    // 方法1: 从命令行参数获取
    const workspacePathIndex = args.indexOf('-workspace');
    if (workspacePathIndex !== -1 && args.length > workspacePathIndex + 1) {
        let fromArg = args[workspacePathIndex + 1];
        
        // 规范化路径格式（处理Windows路径问题）
        fromArg = fromArg.replace(/\\\\/g, '\\');
        
        console.error(`检查工作区路径存在性: "${fromArg}"`);
        try {
            if (fs.existsSync(fromArg)) {
                console.error(`从命令行参数获取工作区路径: ${fromArg}`);
                return fromArg;
            } else {
                console.error(`路径不存在: ${fromArg}`);
                // 尝试去除引号
                const cleanPath = fromArg.replace(/^["']|["']$/g, '');
                if (cleanPath !== fromArg && fs.existsSync(cleanPath)) {
                    console.error(`清理引号后路径存在: ${cleanPath}`);
                    return cleanPath;
                }
            }
        } catch (err) {
            console.error(`检查路径时出错: ${err.message}`);
        }
    } else {
        console.error('未找到-workspace参数');
    }
    
    // 方法2: 检查第二个位置参数
    if (args.length >= 2) {
        let secondArg = args[1];
        
        // 检查第二个参数是否是有效路径
        try {
            secondArg = secondArg.replace(/\\\\/g, '\\');
            console.error(`检查第二个参数是否为工作区路径: "${secondArg}"`);
            
            if (fs.existsSync(secondArg)) {
                console.error(`从位置参数获取工作区路径: ${secondArg}`);
                return secondArg;
            }
        } catch (err) {
            console.error(`检查第二个参数路径时出错: ${err.message}`);
        }
    }
    
    // 如果获取路径失败
    console.error('无法确定工作区路径');
    return null;
}

// 全局音频处理设置
const audioSettings = {
    sampleRate: 44100,      // 采样率
    numChannels: 1,         // 通道数
    bitsPerSample: 16,      // 采样位深
    // 音频增强设置
    enhancementEnabled: true,   // 整体增强开关
    voiceEnhancement: {
        enabled: true,
        gain: 1.5,         // 语音增益
        clarity: 1.3       // 清晰度调整
    },
    // 均衡器设置 - 针对人声频率增强
    equalizer: {
        enabled: true,
        // 人声增强均衡器 (单位为dB)
        bands: [
            { frequency: 100, gain: 1.0 },   // 低频
            { frequency: 250, gain: 1.5 },   // 低中频 - 温暖度
            { frequency: 800, gain: 2.0 },   // 中频 - 人声基频
            { frequency: 2000, gain: 2.5 },  // 中高频 - 清晰度
            { frequency: 4000, gain: 2.0 },  // 高频 - 明亮度
            { frequency: 8000, gain: 1.0 }   // 超高频
        ]
    },
    // 实际音频采集校准系数 - 根据实验校准
    calibrationFactor: 1.35,  // 理论时长与实际时长的比例因子
    // 回声消除设置
    echoCancellation: {
        enabled: true,       // 启用回声消除
        strength: 0.9        // 回声消除强度（0-1）
    },
    // 噪声抑制设置
    noiseSuppression: {
        enabled: true,       // 启用噪声抑制
        threshold: 0.05,     // 噪声阈值
        reduction: 0.7       // 噪声抑制强度
    }
};

// 状态和命令文件路径
const recordingStatusFile = path.join(os.tmpdir(), 'audio_recording_status.json');
const stopCommandFile = path.join(os.tmpdir(), 'audio_recording_stop_command');

// 检查命令行参数
const args = process.argv.slice(2);
const streamMode = args.includes('-stream');
let serverPort = 3000; // 默认WebSocket服务器端口
let serverAddress = 'localhost'; // 默认地址

// 处理音频质量参数
const qualityIndex = args.indexOf('-quality');
if (qualityIndex !== -1 && args.length > qualityIndex + 1) {
    const quality = args[qualityIndex + 1];
    if (quality === 'high') {
        // 高质量设置
        audioSettings.voiceEnhancement.gain = 1.7;
        audioSettings.voiceEnhancement.clarity = 2.0;
        audioSettings.equalizer.bands[2].gain = 2.5; // 增强人声基频
        audioSettings.equalizer.bands[3].gain = 3.0; // 更多清晰度
        console.error(`使用高质量音频设置`);
    } else if (quality === 'low') {
        // 低质量设置 - 减少处理以节省资源
        audioSettings.voiceEnhancement.enabled = false;
        audioSettings.equalizer.enabled = true;
        audioSettings.equalizer.bands = audioSettings.equalizer.bands.map(band => {
            return { ...band, gain: Math.min(band.gain, 1.5) };
        });
        console.error(`使用低质量音频设置`);
    }
    console.error(`音频质量设置为: ${quality}`);
}

// 根据模式执行不同的功能
if (streamMode) {
    // 初始化所有必要的变量，再调用startRecording
    // 确保recordings文件夹存在
    // 尝试获取工作区根目录
    let recordingsDir = null;
    let canSaveFiles = false;

    // 打印接收到的命令行参数，用于调试
    console.error('接收到的命令行参数:', process.argv);
    console.error('处理后的args:', args);

    // 多种方式尝试获取工作区路径
    const workspacePath = getWorkspacePath(args);
    
    // 执行音频流传输
    streamAudio(canSaveFiles, recordingsDir)
        .then(() => {
            console.error('音频流传输已完成');
            process.exit(0);
        })
        .catch(error => {
            console.error('音频流传输失败:', error);
            process.exit(1);
        });
} else {
    // 检查是否为start或stop命令
    const command = args[0];
    
    if (command === 'start') {
        console.error('启动无限制录音模式');
        
        // 创建录音状态文件
        try {
            const statusData = {
                pid: process.pid,
                startTime: Date.now(),
                workspacePath: args[1] || ''
            };
            
            fs.writeFileSync(recordingStatusFile, JSON.stringify(statusData));
            console.error(`已创建录音状态文件: ${recordingStatusFile}`);
        } catch (error) {
            console.error(`创建录音状态文件失败: ${error.message}`);
            process.exit(1);
        }
        
        // 初始化所有必要的变量，再调用startRecording
        // 确保recordings文件夹存在
        // 尝试获取工作区根目录
        let recordingsDir = null;
        let canSaveFiles = false;

        // 打印接收到的命令行参数，用于调试
        console.error('接收到的命令行参数:', process.argv);
        console.error('处理后的args:', args);

        // 多种方式尝试获取工作区路径
        const workspacePath = getWorkspacePath(args);
    
        if (workspacePath) {
            recordingsDir = path.join(workspacePath, 'recordings');
            canSaveFiles = true;
            console.error(`使用工作区路径: ${workspacePath}`);
            
            // 确保recordings文件夹存在
            if (!fs.existsSync(recordingsDir)) {
                fs.mkdirSync(recordingsDir, { recursive: true });
                console.error(`创建recordings文件夹: ${recordingsDir}`);
            }
            
            // 测试文件夹写入权限
            try {
                const testFilePath = path.join(recordingsDir, 'test.txt');
                fs.writeFileSync(testFilePath, 'test', { flag: 'w' });
                console.error(`测试文件写入成功: ${testFilePath}`);
                // 成功创建测试文件后删除它
                fs.unlinkSync(testFilePath);
                console.error('测试文件已删除');
                // 确认可以写入
                canSaveFiles = true;
            } catch (writeErr) {
                console.error(`测试文件写入失败，没有写入权限: ${writeErr}`);
                canSaveFiles = false;
            }
        } else {
            console.error('未提供有效的工作区路径，音频将不会被保存到文件');
        canSaveFiles = false;
    }

    // 音频文件路径（仅用于录音模式且有有效工作区）
    let savedWavFile;
            if (canSaveFiles && recordingsDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        // 添加随机字符串确保唯一性
        const uniqueId = Math.random().toString(36).substring(2, 10);
        savedWavFile = path.join(recordingsDir, `recording_${timestamp}_${uniqueId}.wav`);
        console.error(`将保存录音文件: ${savedWavFile}`);
            } else {
        console.error('未检测到有效工作区或无写入权限，录音将不会被保存到文件');
    }
        
        // 现在所有变量都初始化好了，可以安全地调用startRecording
        startRecording(canSaveFiles, recordingsDir, savedWavFile);
    } else if (command === 'stop') {
        console.error('执行停止录音命令');
        stopRecording();
    }
}

// 确保recordings文件夹存在
// 尝试获取工作区根目录
let recordingsDir = null;
let canSaveFiles = false;

// 打印接收到的命令行参数，用于调试
console.error('接收到的命令行参数:', process.argv);
console.error('处理后的args:', args);

// 多种方式尝试获取工作区路径
const workspacePath = getWorkspacePath(args);

// 简化的音频增强
function enhanceAudioData(audioData) {
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
  
/**
 * 实时音频流传输函数
 * @returns {Promise<void>}
 */
async function streamAudio(canSaveFiles, recordingsDir) {
    console.error('开始音频流传输...');

    console.error('流模式参数检查:');
    console.error('- canSaveFiles:', canSaveFiles);
    console.error('- recordingsDir:', recordingsDir);
    console.error('- streamMode:', streamMode);
    console.error('- 工作区路径参数索引:', args.indexOf('-workspace'));
    console.error('- 完整参数列表:', args);
    
    // 应用校准后的采样率
    const adjustedSampleRate = Math.floor(audioSettings.sampleRate / audioSettings.calibrationFactor);
    console.error(`应用采样率校准: 原始采样率 ${audioSettings.sampleRate}Hz, 校准后 ${adjustedSampleRate}Hz`);
    
    // 为流模式准备录音文件（如果有工作区）
    let streamRecordingFile = null;
    let streamOutputFile = null;
    
    // 查找conferenceId参数
    let conferenceId = null;
    const confIdIndex = args.indexOf('-conferenceId');
    if (confIdIndex !== -1 && args.length > confIdIndex + 1) {
        conferenceId = args[confIdIndex + 1];
        console.error(`指定会议ID: ${conferenceId}`);
    }
    
    if (canSaveFiles && recordingsDir) {
        // 获取当前日期时间并格式化为YYYY-MM-DD_HH-MM-SS
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const formattedTimestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
        
        // 按照要求的格式创建文件名：stream_conference_会议ID_时间戳.wav
        if (conferenceId) {
            streamRecordingFile = path.join(recordingsDir, `stream_conference_${conferenceId}_${formattedTimestamp}.wav`);
        } else {
            // 如果没有会议ID，则使用随机ID
            const uniqueId = Math.random().toString(36).substring(2, 10);
            streamRecordingFile = path.join(recordingsDir, `stream_conference_${uniqueId}_${formattedTimestamp}.wav`);
        }
        
        try {
            // 创建WAV文件和写入头部 - 使用校准后的采样率
            streamOutputFile = fs.createWriteStream(streamRecordingFile);
            streamOutputFile.write(createWavHeader(adjustedSampleRate));
            console.error(`将保存流音频到: ${streamRecordingFile}`);
        } catch (err) {
            console.error(`创建流录音文件失败: ${err}`);
            streamOutputFile = null;
        }
    }
    
    return new Promise((resolve, reject) => {
        try {
            // 初始化麦克风
            const mic = new Mic();
            console.error("麦克风已初始化，准备流传输...");
            
            // 创建WebSocket连接到服务器
            const wsUrl = `ws://${serverAddress}:${serverPort}`;
            console.error(`尝试连接到WebSocket服务器: ${wsUrl}`);
            
            const ws = new WebSocket(wsUrl);
            
            // 跟踪发送的数据包序号
            let sequenceNumber = 0;
            
            // 记录音频数据总大小，用于更新WAV头部
            let totalAudioDataSize = 0;
            
            ws.on('open', () => {
                console.error('已连接到WebSocket服务器，开始传输音频流');
                
                // 查找userId参数
                let userId = null;
                const userIdIndex = args.indexOf('-userId');
                if (userIdIndex !== -1 && args.length > userIdIndex + 1) {
                    userId = args[userIdIndex + 1];
                    console.error(`指定用户ID: ${userId}`);
                }
                
                // 查找roomId参数
                let roomId = 'default';
                const roomIdIndex = args.indexOf('-roomId');
                if (roomIdIndex !== -1 && args.length > roomIdIndex + 1) {
                    roomId = args[roomIdIndex + 1];
                    console.error(`指定房间ID: ${roomId}`);
                }
                
                // 第一步：必须先发送join消息加入聊天室，这样服务器才能识别用户
                if (userId) {
                    ws.send(JSON.stringify({
                        type: 'join',
                        userId: userId,
                        roomId: roomId,
                        name: `Stream_${userId.substring(0, 8)}`
                    }));
                    console.error(`已发送身份认证信息，用户ID: ${userId}, 房间ID: ${roomId}`);
                }
                
                // 发送初始化消息，标识为音频流发送者 - 使用校准后的采样率
                ws.send(JSON.stringify({
                    type: 'init',
                    role: 'streamer',
                    format: {
                        sampleRate: adjustedSampleRate, // 使用校准后的采样率
                        numChannels: audioSettings.numChannels,
                        bitsPerSample: audioSettings.bitsPerSample
                    },
                    enhancementEnabled: audioSettings.enhancementEnabled
                }));
                
                // 开始录音
                const micStream = mic.startRecording();
                
                // 数据处理 - 发送音频数据块
                micStream.on('data', async (data) => {
                    // 检查WebSocket连接状态
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            // 获取音频数据信息
                            const audioDataSize = data.length;
                            console.log(`捕获到音频数据块，大小: ${audioDataSize} 字节`);
                            
                            // 处理音频数据 - 需添加WAV头部确保一致的格式
                            let audioDataWithHeader;
                            
                            // 检查数据是否已经包含WAV头
                            const hasRiffHeader = data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70; // "RIFF"
                            
                            if (!hasRiffHeader) {
                                // 添加WAV头部 (44字节标准WAV头)
                                const sampleRate = adjustedSampleRate; // 使用校准后的采样率
                                const numChannels = audioSettings.numChannels;
                                const bitsPerSample = audioSettings.bitsPerSample;
                                
                                // 创建头部
                                const headerBytes = Buffer.alloc(44);
                                
                                // RIFF块
                                headerBytes.write('RIFF', 0);
                                // 文件大小 (数据+头部-8)
                                const fileSize = audioDataSize + 36;
                                headerBytes.writeUInt32LE(fileSize, 4);
                                // 文件类型
                                headerBytes.write('WAVE', 8);
                                
                                // fmt块
                                headerBytes.write('fmt ', 12);
                                // fmt块大小
                                headerBytes.writeUInt32LE(16, 16);
                                // 音频格式 (1表示PCM)
                                headerBytes.writeUInt16LE(1, 20);
                                // 通道数
                                headerBytes.writeUInt16LE(numChannels, 22);
                                // 采样率
                                headerBytes.writeUInt32LE(sampleRate, 24);
                                // 字节率 = 采样率 * 通道数 * (采样位深/8)
                                headerBytes.writeUInt32LE(sampleRate * numChannels * (bitsPerSample/8), 28);
                                // 块对齐 = 通道数 * (采样位深/8)
                                headerBytes.writeUInt16LE(numChannels * (bitsPerSample/8), 32);
                                // 每个样本位数
                                headerBytes.writeUInt16LE(bitsPerSample, 34);
                                
                                // data块
                                headerBytes.write('data', 36);
                                // 数据大小
                                headerBytes.writeUInt32LE(audioDataSize, 40);
                                
                                // 合并头部和数据
                                audioDataWithHeader = Buffer.concat([headerBytes, data]);
                                console.log(`添加WAV头部成功，总大小: ${audioDataWithHeader.length} 字节`);
                            } else {
                                // 已有头部，直接使用原始数据
                                audioDataWithHeader = data;
                                console.log('音频数据已包含WAV头部');
                            }
                            
                            // 应用音频增强处理
                            const enhancedAudio = await enhanceAudioData(audioDataWithHeader);
                            console.log(`音频增强处理完成，处理后大小: ${enhancedAudio.length} 字节`);
                            
                            // 保存到本地文件（如果启用）
                            if (streamOutputFile) {
                                try {
                                    // 提取纯音频数据（不含WAV头）
                                    let rawAudioData;
                                    if (hasRiffHeader || enhancedAudio.length > 44) {
                                        // 如果有头部，跳过前44字节
                                        rawAudioData = enhancedAudio.slice(44);
                                    } else {
                                        rawAudioData = enhancedAudio;
                                    }
                                    
                                    // 写入原始音频数据
                                    streamOutputFile.write(rawAudioData);
                                    totalAudioDataSize += rawAudioData.length;
                                    console.log(`已将${rawAudioData.length}字节音频数据写入文件，总计: ${totalAudioDataSize}字节`);
                                } catch (writeErr) {
                                    console.error(`写入音频文件失败: ${writeErr}`);
                                }
                            }
                            
                            // 将处理后的二进制数据转换为Base64字符串
                            const base64Audio = enhancedAudio.toString('base64');
                            console.log(`Base64编码后长度: ${base64Audio.length} 字符`);
                            
                            // 构建JSON消息
                            const audioMessage = {
                                type: 'audioStream',
                                audioData: base64Audio,
                                sequence: sequenceNumber++,
                                format: {
                                    sampleRate: adjustedSampleRate, // 使用校准后的采样率
                                    numChannels: audioSettings.numChannels,
                                    bitsPerSample: audioSettings.bitsPerSample,
                                    isWav: true, // 标记为WAV格式
                                    enhanced: audioSettings.enhancementEnabled
                                },
                                timestamp: Date.now()
                            };
                            
                            // 如果指定了会议ID，添加到消息中
                            if (conferenceId) {
                                audioMessage.conferenceId = conferenceId;
                            }
                            
                            // 发送JSON格式的音频数据
                            const msgStr = JSON.stringify(audioMessage);
                            console.log(`发送音频消息，序列号: ${sequenceNumber-1}, 大小: ${msgStr.length} 字节`);
                            ws.send(msgStr);
                        } catch (err) {
                            console.error('发送音频数据失败:', err);
                        }
                    }
                });
                
                // 错误处理
                micStream.on('error', (err) => {
                    console.error('录音错误:', err);
                    mic.stopRecording();
                    
                    // 关闭流文件
                    if (streamOutputFile) {
                        streamOutputFile.end();
                        // 更新WAV文件头 - 使用校准后的采样率
                        updateWavHeader(streamRecordingFile, totalAudioDataSize, adjustedSampleRate);
                        console.error(`流音频文件已关闭并更新头部，总大小: ${totalAudioDataSize}字节`);
                    }
                    
                    ws.close();
                    reject(err);
                });
                
                // 处理WebSocket关闭事件
                ws.on('close', () => {
                    console.error('WebSocket连接已关闭，停止音频流');
                    mic.stopRecording();
                    
                    // 关闭流文件
                    if (streamOutputFile) {
                        streamOutputFile.end();
                        // 更新WAV文件头 - 使用校准后的采样率
                        updateWavHeader(streamRecordingFile, totalAudioDataSize, adjustedSampleRate);
                        console.error(`流音频文件已关闭并更新头部，总大小: ${totalAudioDataSize}字节`);
                    }
                    
                    resolve();
                });
                
                // 处理WebSocket错误
                ws.on('error', (err) => {
                    console.error('WebSocket错误:', err);
                    mic.stopRecording();
                    
                    // 关闭流文件
                    if (streamOutputFile) {
                        streamOutputFile.end();
                        // 更新WAV文件头 - 使用校准后的采样率
                        updateWavHeader(streamRecordingFile, totalAudioDataSize, adjustedSampleRate);
                        console.error(`流音频文件已关闭并更新头部，总大小: ${totalAudioDataSize}字节`);
                    }
                    
                    reject(err);
                });
                
                // 处理来自服务器的消息
                ws.on('message', (message) => {
                    try {
                        const msg = JSON.parse(message);
                        
                        // 处理停止命令
                        if (msg.type === 'command' && msg.action === 'stop') {
                            console.error('接收到停止命令，结束音频流');
                            mic.stopRecording();
                            
                            // 关闭流文件
                            if (streamOutputFile) {
                                streamOutputFile.end();
                                // 更新WAV文件头 - 使用校准后的采样率
                                updateWavHeader(streamRecordingFile, totalAudioDataSize, adjustedSampleRate);
                                console.error(`流音频文件已关闭并更新头部，总大小: ${totalAudioDataSize}字节`);
                            }
                            
                            ws.close();
                            resolve();
                        }
                        
                        // 处理音频设置更改命令
                        if (msg.type === 'command' && msg.action === 'updateAudioSettings') {
                            console.error('接收到音频设置更新命令');
                            if (msg.settings) {
                                // 更新音频设置
                                if (typeof msg.settings.enhancementEnabled !== 'undefined') {
                                    audioSettings.enhancementEnabled = msg.settings.enhancementEnabled;
                                }
                                
                                if (msg.settings.voiceEnhancement) {
                                    audioSettings.voiceEnhancement = {
                                        ...audioSettings.voiceEnhancement,
                                        ...msg.settings.voiceEnhancement
                                    };
                                }
                                
                                if (msg.settings.equalizer) {
                                    audioSettings.equalizer.enabled = 
                                        msg.settings.equalizer.enabled !== undefined ? 
                                        msg.settings.equalizer.enabled : 
                                        audioSettings.equalizer.enabled;
                                        
                                    if (msg.settings.equalizer.bands) {
                                        // 更新均衡器频段
                                        audioSettings.equalizer.bands = msg.settings.equalizer.bands;
                                    }
                                }
                                
                                console.error('音频设置已更新');
                            }
                        }
                    } catch (err) {
                        console.error('解析服务器消息失败:', err);
                    }
                });
                
                // 处理用户中断信号
                process.on('SIGINT', () => {
                    console.error('接收到中断信号，结束音频流');
                    mic.stopRecording();
                    
                    // 关闭流文件
                    if (streamOutputFile) {
                        streamOutputFile.end();
                        // 更新WAV文件头 - 使用校准后的采样率
                        updateWavHeader(streamRecordingFile, totalAudioDataSize, adjustedSampleRate);
                        console.error(`流音频文件已关闭并更新头部，总大小: ${totalAudioDataSize}字节`);
                    }
                    
                    ws.close();
                    resolve();
                });
            });
            
            // 处理连接失败
            ws.on('error', (err) => {
                console.error('连接到WebSocket服务器失败:', err);
                
                // 关闭流文件
                if (streamOutputFile) {
                    streamOutputFile.end();
                    console.error('流音频文件已关闭（连接失败）');
                }
                
                reject(err);
            });
            
        } catch (err) {
            console.error('初始化音频流传输时出错:', err);
            
            // 关闭流文件
            if (streamOutputFile) {
                streamOutputFile.end();
                console.error('流音频文件已关闭（初始化错误）');
            }
            
            reject(err);
        }
    });
}

/**
 * 无限制录音函数 - 开始录音直到收到停止命令
 */
async function startRecording(canSaveFiles, recordingsDir, savedWavFile) {
    console.error(`开始无限制录音...`);
    
    // 调试变量
    console.error(`调试: canSaveFiles=${canSaveFiles}, recordingsDir=${recordingsDir}, savedWavFile=${savedWavFile}`);
    
    // 删除可能存在的旧停止命令文件
    try {
        if (fs.existsSync(stopCommandFile)) {
            fs.unlinkSync(stopCommandFile);
            console.error('删除旧的停止命令文件');
        }
    } catch (error) {
        console.error(`删除旧停止命令文件失败: ${error.message}`);
    }
    
    // 设置信号处理，用于接收停止信号
    process.on('SIGTERM', () => {
        console.error('收到SIGTERM信号，停止录音');
        finishRecording();
    });
    
    process.on('SIGINT', () => {
        console.error('收到SIGINT信号，停止录音');
        finishRecording();
    });
    
    // 创建自定义信号用于内部通信
    process.on('message', (msg) => {
        if (msg === 'stop') {
            console.error('收到停止录音消息');
            finishRecording();
        }
    });
    
    // 添加调试输出，确保这些变量已经被初始化
    console.error(`调试: canSaveFiles=${canSaveFiles}, recordingsDir=${recordingsDir}, savedWavFile=${savedWavFile}`);
    
            let outputFile = null;
    try {
            if (canSaveFiles && savedWavFile) {
            console.error(`尝试创建输出文件: ${savedWavFile}`);
                outputFile = fs.createWriteStream(savedWavFile);
                outputFile.write(createWavHeader());
                console.error(`将录音保存到: ${savedWavFile}`);
        }
    } catch (fileError) {
        console.error(`创建输出文件失败: ${fileError.message}`);
        console.error(`错误堆栈: ${fileError.stack}`);
            }
            
            // 记录数据大小，用于后续更新头部
            let dataSize = 0;
            
            // 初始化麦克风
    let mic = null;
    try {
        console.error("尝试初始化麦克风...");
        mic = new Mic();
            console.error("麦克风已初始化，请开始说话...");
    } catch (micError) {
        console.error(`麦克风初始化失败: ${micError.message}`);
        console.error(`错误堆栈: ${micError.stack}`);
        if (outputFile) outputFile.end();
        console.log(JSON.stringify({
            success: false,
            error: `麦克风初始化失败: ${micError.message}`
        }));
        process.exit(1);
    }
            
            // 处理收集的音频数据段
            let audioChunks = [];
            
            // 用于跟踪实际录音开始的时间
            let recordingStartTime = null;
    let micStream = null;
            
    try {
            // 开始录音
        console.error("尝试启动录音流...");
        micStream = mic.startRecording();
        console.error("录音流启动成功");
            
        // 数据处理逻辑与原有代码保持一致
            micStream.on('data', (data) => {
            try {
                // 第一次收到数据时开始计时
                if (recordingStartTime === null) {
                    recordingStartTime = Date.now();
                    console.error('录音实际开始时间:', new Date(recordingStartTime).toISOString());
                }
                
                dataSize += data.length;
                // 存储音频段，稍后处理
                audioChunks.push(data);
                
                // 定期记录数据大小
                if (audioChunks.length % 10 === 0) {
                    console.error(`已收集 ${audioChunks.length} 个音频数据块，总大小: ${dataSize} 字节`);
                }
            } catch (dataError) {
                console.error(`处理音频数据块时出错: ${dataError.message}`);
                console.error(`错误堆栈: ${dataError.stack}`);
            }
            });
            
            // 错误处理
            micStream.on('error', (err) => {
            console.error(`录音流错误: ${err.message}`);
            console.error(`错误堆栈: ${err.stack || '无堆栈信息'}`);
            try {
                mic.stopRecording();
                if (outputFile) outputFile.end();
            } catch (stopError) {
                console.error(`停止录音时出错: ${stopError.message}`);
            }
            console.error(JSON.stringify({
                success: false,
                error: err.message
            }));
            process.exit(1);
            });
    } catch (streamError) {
        console.error(`创建录音流失败: ${streamError.message}`);
        console.error(`错误堆栈: ${streamError.stack}`);
        if (outputFile) outputFile.end();
        console.log(JSON.stringify({
            success: false,
            error: `创建录音流失败: ${streamError.message}`
        }));
        process.exit(1);
    }
    
    // 设置周期性检查停止命令文件的定时器
    const stopFileCheckInterval = setInterval(() => {
        try {
            if (fs.existsSync(stopCommandFile)) {
                console.error('检测到停止命令文件，停止录音');
                clearInterval(stopFileCheckInterval);
                finishRecording();
            }
        } catch (error) {
            console.error(`检查停止命令文件时出错: ${error.message}`);
                }
    }, 500); // 每500毫秒检查一次
                
    // 修改安全超时处理，确保清理定时器
    const safetyTimeout = 3 * 60 * 1000; // 3分钟
    const safetyTimeoutId = setTimeout(() => {
        console.error('达到最大录音时长，自动停止');
        clearInterval(stopFileCheckInterval);
        finishRecording();
    }, safetyTimeout);
                
    // 全局变量，用于在信号处理中访问
    global.mic = mic;
    global.audioChunks = audioChunks;
    global.outputFile = outputFile;
    global.recordingStartTime = recordingStartTime;
    global.stopFileCheckInterval = stopFileCheckInterval;
    global.safetyTimeoutId = safetyTimeoutId;
    global.canSaveFiles = canSaveFiles;         // 添加这些变量到global
    global.recordingsDir = recordingsDir;       // 添加这些变量到global
    global.savedWavFile = savedWavFile;         // 添加这些变量到global
    
    // 完成录音的函数将在收到停止信号时调用
    global.finishRecording = async () => {
        console.error('finishRecording函数被调用');
        
        if (!recordingStartTime) {
            console.error('录音尚未开始，取消操作');
            process.exit(0);
                    return;
                }
                
                console.error('停止录音');
        try {
                mic.stopRecording();
            console.error('麦克风录音已停止');
        } catch (stopError) {
            console.error(`停止麦克风录音失败: ${stopError.message}`);
        }
                
                try {
            // 这里可以保留原有的录音处理逻辑，确保与之前行为一致
                    // 合并所有音频段
            console.error(`尝试合并 ${audioChunks.length} 个音频段...`);
                    const combinedAudio = Buffer.concat(audioChunks);
                    console.error(`收集到原始音频数据: ${combinedAudio.length} 字节`);
                    
                    // 应用音频增强
            console.error('开始应用音频增强...');
                    const enhancedAudio = await enhanceAudioData(combinedAudio);
                    console.error(`音频增强处理完成，处理后大小: ${enhancedAudio.length} 字节`);
                    
                    // 计算理论音频时长
                    const bytesPerSample = (audioSettings.bitsPerSample / 8) * audioSettings.numChannels;
                    const samplesPerSecond = audioSettings.sampleRate;
                    const bytesPerSecond = samplesPerSecond * bytesPerSample;
                    const theoreticalDuration = enhancedAudio.length / bytesPerSecond;
                    console.error(`理论音频时长: ${(theoreticalDuration * 1000).toFixed(0)}ms (${theoreticalDuration.toFixed(2)}秒)`);
                    
                    // 应用校准 - 根据实际录制时长调整音频数据
                    const actualDuration = (Date.now() - recordingStartTime) / 1000; // 实际录制秒数
                    console.error(`实际录制时长: ${(actualDuration * 1000).toFixed(0)}ms (${actualDuration.toFixed(2)}秒)`);
            
            // 确保WAV头部信息正确
            const header = createWavHeader();
            // 更新头部信息
            header.writeUInt32LE(enhancedAudio.length, 40); // 数据大小
            header.writeUInt32LE(enhancedAudio.length + 36, 4); // 文件大小 - 8
            // 创建完整的音频数据（头部+音频数据）
            const completeAudio = Buffer.concat([header, enhancedAudio]);
            // 转为base64
            const base64Data = completeAudio.toString('base64');
                        
            // 保存文件处理
            let audioBase64 = '';
            let filesize = 0;
            
            if (outputFile && savedWavFile) {
                try {
                    // 写入WAV文件
                    outputFile.write(completeAudio);
                    outputFile.end();
                    console.error('WAV文件写入完成');
                    
                    // 更新WAV头
                    updateWavHeader(savedWavFile, enhancedAudio.length);
                    
                    // 保存文件成功
                    const filename = path.basename(savedWavFile);
                    filesize = enhancedAudio.length + 44; // 数据大小加上头部大小
                    
                    // 将文件内容转为base64供直接使用
                    audioBase64 = base64Data;
                    
                    console.error(`录音已完成，文件保存至: ${savedWavFile}`);
                    
                    // 关键改进: 使用纯stdout输出JSON结果
                    // 确保JSON输出是完整的一条单独的记录
                    const result = {
                        success: true,
                        filename: filename,
                        filepath: savedWavFile,
                        filesize: filesize,
                        duration: actualDuration,
                        audioData: audioBase64
                    };
                    
                    // 确保在输出JSON之前没有其他stdout输出
                    // 使用process.stdout.write确保一次性完整输出
                    process.stdout.write(JSON.stringify(result));
                } catch (fileWriteError) {
                    console.error(`写入WAV文件失败: ${fileWriteError.message}`);
                    
                    // 输出错误JSON
                    process.stdout.write(JSON.stringify({
                        success: false,
                        error: `写入WAV文件失败: ${fileWriteError.message}`
                    }));
                }
            } else {
                // 处理无文件输出的情况
                console.error('未保存到文件，创建内存中的WAV结构');
                
                // 创建一个完整的WAV文件结构（头部+数据）
                const header = createWavHeader();
                header.writeUInt32LE(enhancedAudio.length, 40); // 数据大小
                header.writeUInt32LE(enhancedAudio.length + 36, 4); // 文件大小 - 8
                
                // 合并头部和音频数据
                const completeAudio = Buffer.concat([header, enhancedAudio]);
                
                // 生成虚拟文件名
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const uniqueId = Math.random().toString(36).substring(2, 10);
                const virtualFilename = `recording_${timestamp}_${uniqueId}.wav`;
                
                // 将完整WAV转为base64
                const audioBase64 = completeAudio.toString('base64');
                
                // 保持与原始响应格式一致
                const result = {
                    success: true,
                    duration: actualDuration,
                    filename: virtualFilename,
                    audioData: audioBase64
                };
                
                // 输出结果
                console.error(`创建虚拟音频文件: ${virtualFilename}`);
                process.stdout.write(JSON.stringify(result));
            }
            
            // 删除状态文件
            try {
                if (fs.existsSync(recordingStatusFile)) {
                    fs.unlinkSync(recordingStatusFile);
                    console.error('已删除录音状态文件');
                }
            } catch (unlinkError) {
                console.error(`删除状态文件失败: ${unlinkError.message}`);
            }
            
            // 清理停止检查定时器
            if (global.stopFileCheckInterval) {
                clearInterval(global.stopFileCheckInterval);
            }
            
            // 清理安全超时定时器
            if (global.safetyTimeoutId) {
                clearTimeout(global.safetyTimeoutId);
            }
            
            // 添加一个小延迟确保所有数据都已处理
            setTimeout(() => {
                console.error('录音处理完成，程序退出');
                process.exit(0);
            }, 500);
        } catch (error) {
            console.error(`处理录音数据时出错: ${error.message}`);
            console.error(`错误堆栈: ${error.stack || '无堆栈信息'}`);
            
            // 错误输出也使用stdout，但确保格式正确
            process.stdout.write(JSON.stringify({
                success: false,
                error: `处理录音数据时出错: ${error.message}`
            }));
            
            process.exit(1);
        }
    };
}

/**
 * 停止录音函数 - 创建停止命令文件通知正在运行的录音进程
 */
function stopRecording() {
    console.error('尝试停止录音...');
    
    try {
        // 检查状态文件是否存在
        if (!fs.existsSync(recordingStatusFile)) {
            console.error('找不到录音状态文件，可能没有正在进行的录音');
            // 使用stdout输出JSON
            process.stdout.write(JSON.stringify({
                success: false, 
                error: '找不到录音状态文件，可能没有正在进行的录音'
            }));
            process.exit(0);
        }
        
        // 读取状态文件
        const statusContent = fs.readFileSync(recordingStatusFile, 'utf8');
        const statusData = JSON.parse(statusContent);
        
        if (!statusData.pid) {
            console.error('状态文件中没有进程ID信息');
            process.exit(1);
        }
        
        // 创建停止命令文件
        fs.writeFileSync(stopCommandFile, `stop_command_${Date.now()}`);
        console.error(`已创建停止命令文件: ${stopCommandFile}`);
        
        console.error(`已向进程 ${statusData.pid} 发送停止信号`);
        
        // 仍然尝试使用process.kill向进程发送SIGTERM信号作为备用
        try {
            process.kill(statusData.pid, 'SIGTERM');
            console.error('已发送SIGTERM信号');
        } catch (killError) {
            console.error(`发送SIGTERM信号失败: ${killError.message}，将依赖停止命令文件`);
        }
        
        // 使用stdout输出JSON
        process.stdout.write(JSON.stringify({
            success: true,
            message: '已发送录音停止命令'
        }));
        
        process.exit(0);
    } catch (error) {
        console.error(`处理停止录音时出错: ${error.message}`);
        console.error(`错误堆栈: ${error.stack}`);
        
        // 使用stdout输出JSON
        process.stdout.write(JSON.stringify({
            success: false,
            error: `处理停止录音时出错: ${error.message}`
        }));
        
        process.exit(1);
    }
}

/**
 * 创建WAV文件头（44字节）
 * @param {number} [overrideSampleRate] 覆盖默认采样率的值
 * @returns {Buffer} WAV文件头
 */
function createWavHeader(overrideSampleRate) {
    // WAV文件参数
    const sampleRate = overrideSampleRate || audioSettings.sampleRate;
    const numChannels = audioSettings.numChannels;
    const bitsPerSample = audioSettings.bitsPerSample;
    
    // 计算派生值
    const blockAlign = numChannels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    
    // 创建文件头缓冲区
    const header = Buffer.alloc(44);
    
    // RIFF块
    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4);    // 文件大小，稍后更新
    header.write('WAVE', 8);
    
    // fmt子块
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);                // fmt块大小 (16字节)
    header.writeUInt16LE(1, 20);                 // 音频格式 PCM=1
    header.writeUInt16LE(numChannels, 22);       // 通道数
    header.writeUInt32LE(sampleRate, 24);        // 采样率
    header.writeUInt32LE(byteRate, 28);          // 字节率 = 采样率 * 块对齐
    header.writeUInt16LE(blockAlign, 32);        // 块对齐 = 通道数 * 采样位深/8
    header.writeUInt16LE(bitsPerSample, 34);     // 采样位深
    
    // data子块
    header.write('data', 36);
    header.writeUInt32LE(0, 40);     // 数据大小，稍后更新
    
    return header;
}

/**
 * 更新WAV文件头中的文件大小和数据大小
 * @param {string} filePath WAV文件路径
 * @param {number} dataSize 音频数据大小（字节）
 * @param {number} [overrideSampleRate] 覆盖默认采样率的值
 */
function updateWavHeader(filePath, dataSize, overrideSampleRate) {
    try {
        // 使用同步方法确保写入完成
        const fd = fs.openSync(filePath, 'r+');
        
        // 确定采样率
        const sampleRate = overrideSampleRate || audioSettings.sampleRate;
        const numChannels = audioSettings.numChannels;
        const bitsPerSample = audioSettings.bitsPerSample;
        
        // 计算派生值
        const blockAlign = numChannels * bitsPerSample / 8;
        const byteRate = sampleRate * blockAlign;
        
        // 更新采样率 (偏移量24)
        const sampleRateBuffer = Buffer.alloc(4);
        sampleRateBuffer.writeUInt32LE(sampleRate, 0);
        fs.writeSync(fd, sampleRateBuffer, 0, 4, 24);
        
        // 更新字节率 (偏移量28)
        const byteRateBuffer = Buffer.alloc(4);
        byteRateBuffer.writeUInt32LE(byteRate, 0);
        fs.writeSync(fd, byteRateBuffer, 0, 4, 28);
        
        // 更新data块大小 (偏移量40)
        const dataSizeBuffer = Buffer.alloc(4);
        dataSizeBuffer.writeUInt32LE(dataSize, 0);
        fs.writeSync(fd, dataSizeBuffer, 0, 4, 40);
        
        // 更新RIFF块大小 (文件大小 - 8) (偏移量4)
        const fileSizeBuffer = Buffer.alloc(4);
        fileSizeBuffer.writeUInt32LE(dataSize + 36, 0); // 文件大小 = 数据大小 + 头部(44) - 8
        fs.writeSync(fd, fileSizeBuffer, 0, 4, 4);
        
        // 添加文件同步和关闭
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        // 计算理论音频时长
        const bytesPerSample = (bitsPerSample / 8) * numChannels;
        const samplesPerSecond = sampleRate;
        const bytesPerSecond = samplesPerSecond * bytesPerSample;
        const theoreticalDuration = dataSize / bytesPerSecond;
        
        console.error(`WAV头部已更新，数据大小: ${dataSize} 字节，总文件大小: ${dataSize + 44} 字节`);
        console.error(`使用采样率: ${sampleRate}Hz, 理论音频时长: ${(theoreticalDuration * 1000).toFixed(0)}ms (${theoreticalDuration.toFixed(2)}秒)`);
    } catch (error) {
        console.error('更新WAV文件头失败:', error);
    }
}

