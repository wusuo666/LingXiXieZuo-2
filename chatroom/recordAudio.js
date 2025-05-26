#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Mic = require('node-microphone');
const WebSocket = require('ws');
// 添加音频处理库
const WavEncoder = require('wav-encoder');
const WavDecoder = require('wav-decoder');
const AudioBuffer = require('audio-buffer');

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

// 如果是流模式，解析端口和地址
if (streamMode) {
    // 查找端口参数
    const portIndex = args.indexOf('-port');
    if (portIndex !== -1 && args.length > portIndex + 1) {
        serverPort = parseInt(args[portIndex + 1], 10);
    }
    
    // 查找地址参数
    const addressIndex = args.indexOf('-address');
    if (addressIndex !== -1 && args.length > addressIndex + 1) {
        serverAddress = args[addressIndex + 1];
    }
    
    console.error(`音频流模式启动，服务器: ${serverAddress}:${serverPort}`);
}

// 如果不是流模式，按原来的逻辑处理录音时长参数
const duration = streamMode ? 0 : parseInt(args[0] || '5', 10);

// 确保recordings文件夹存在
// 尝试获取工作区根目录
let recordingsDir = null;
let canSaveFiles = false;

// 打印接收到的命令行参数，用于调试
console.error('接收到的命令行参数:', process.argv);
console.error('处理后的args:', args);

// 多种方式尝试获取工作区路径
const getWorkspacePath = () => {
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
};

try {
    // 获取工作区路径
    const workspacePath = getWorkspacePath();
    
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
} catch (error) {
    console.error('处理工作区路径时出错:', error);
    canSaveFiles = false;
}

// 音频文件路径（仅用于录音模式且有有效工作区）
let savedWavFile;
if (!streamMode && canSaveFiles && recordingsDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // 添加随机字符串确保唯一性
    const uniqueId = Math.random().toString(36).substring(2, 10);
    savedWavFile = path.join(recordingsDir, `recording_${timestamp}_${uniqueId}.wav`);
    console.error(`将保存录音文件: ${savedWavFile}`);
} else if (!streamMode) {
    console.error('未检测到有效工作区或无写入权限，录音将不会被保存到文件');
}

/**
 * 处理音频数据，应用增强效果
 * @param {Buffer} audioData 原始音频数据
 * @returns {Promise<Buffer>} 处理后的音频数据
 */
async function enhanceAudioData(audioData) {
    try {
        // 检查数据是否包含WAV头
        const hasWavHeader = audioData.length > 44 && 
                             audioData[0] === 82 && audioData[1] === 73 && 
                             audioData[2] === 70 && audioData[3] === 70; // "RIFF"
        
        // 如果没有启用增强，直接返回原始数据
        if (!audioSettings.enhancementEnabled) {
            return audioData;
        }
        
        let audioBuffer;
        
        if (hasWavHeader) {
            // 使用WavDecoder解码WAV数据
            try {
                const decodedData = await WavDecoder.decode(audioData);
                const channelData = decodedData.channelData[0]; // 假设是单声道
                
                // 应用音频处理
                const enhancedData = applyAudioEnhancements(channelData);
                
                // 重新编码为WAV
                const wavData = await WavEncoder.encode({
                    sampleRate: decodedData.sampleRate,
                    channelData: [enhancedData]
                });
                
                return Buffer.from(wavData);
            } catch (error) {
                console.error('WAV解码失败，跳过增强处理:', error);
                return audioData;
            }
        } else {
            // 直接处理PCM数据
            // 假设16位单声道PCM数据
            const sampleCount = audioData.length / 2;
            const floatSamples = new Float32Array(sampleCount);
            
            // 转换Int16PCM到Float32
            for (let i = 0; i < sampleCount; i++) {
                floatSamples[i] = audioData.readInt16LE(i * 2) / 32768.0; // 归一化到[-1,1]
            }
            
            // 应用音频处理
            const enhancedData = applyAudioEnhancements(floatSamples);
            
            // 转换回Int16PCM格式
            const enhancedBuffer = Buffer.alloc(enhancedData.length * 2);
            for (let i = 0; i < enhancedData.length; i++) {
                // 限制在有效范围内
                const value = Math.max(-1, Math.min(1, enhancedData[i]));
                // 转换回Int16
                enhancedBuffer.writeInt16LE(Math.round(value * 32767), i * 2);
            }
            
            return enhancedBuffer;
        }
    } catch (error) {
        console.error('音频增强处理失败:', error);
        // 失败时返回原始数据
        return audioData;
    }
}

/**
 * 应用音频增强处理
 * @param {Float32Array} audioData 浮点音频数据
 * @returns {Float32Array} 处理后的浮点音频数据
 */
function applyAudioEnhancements(audioData) {
    // 克隆数据以避免修改原始数据
    const enhancedData = new Float32Array(audioData);
    
    // 1. 应用语音增强
    if (audioSettings.voiceEnhancement.enabled) {
        // 语音增益处理
        for (let i = 0; i < enhancedData.length; i++) {
            // 应用非线性增益曲线增强信号(保持小信号特性，增强中等信号)
            const sample = enhancedData[i];
            const sign = Math.sign(sample);
            const abs = Math.abs(sample);
            
            // 非线性压缩/增益曲线
            let processed;
            if (abs < 0.1) {
                // 保持小信号完整性
                processed = sample * audioSettings.voiceEnhancement.gain * 0.8;
            } else if (abs < 0.4) {
                // 中等信号增强
                processed = sign * (Math.pow(abs, 0.8) * audioSettings.voiceEnhancement.gain);
            } else {
                // 大信号软饱和压缩
                const compressed = sign * (1.0 - Math.exp(-(abs - 0.4) * 2));
                processed = sign * (Math.min(abs * 0.9, compressed) * audioSettings.voiceEnhancement.gain);
            }
            
            // 应用清晰度处理 - 通过增强瞬态
            if (i > 0) {
                const diff = Math.abs(enhancedData[i] - enhancedData[i-1]);
                const clarityBoost = diff * audioSettings.voiceEnhancement.clarity * 0.5;
                processed += clarityBoost * sign;
            }
            
            // 确保结果在[-1, 1]范围内
            enhancedData[i] = Math.max(-1, Math.min(1, processed));
        }
    }
    
    // 2. 应用均衡器
    if (audioSettings.equalizer.enabled) {
        // 简化的均衡器实现 - 在实际项目中应使用FFT或滤波器组实现
        // 这里使用简单的峰值检测和增强
        
        // 简单的峰值增强
        for (let i = 0; i < enhancedData.length; i++) {
            // 人声范围加强 (模拟均衡效果)
            enhancedData[i] *= 1.2; // 整体提升20%
            
            // 确保结果在[-1, 1]范围内
            enhancedData[i] = Math.max(-1, Math.min(1, enhancedData[i]));
        }
    }
    
    // 3. 最终处理 - 轻微饱和度压缩以避免过载
    for (let i = 0; i < enhancedData.length; i++) {
        // 软饱和度压缩 (tanh函数模拟)
        enhancedData[i] = Math.tanh(enhancedData[i] * 0.95);
    }
    
    return enhancedData;
}

/**
 * 实时音频流传输函数
 * @returns {Promise<void>}
 */
async function streamAudio() {
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
    
    if (canSaveFiles && recordingsDir) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueId = Math.random().toString(36).substring(2, 10);
        streamRecordingFile = path.join(recordingsDir, `stream_${timestamp}_${uniqueId}.wav`);
        
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
            
            // 查找conferenceId参数
            let conferenceId = null;
            const confIdIndex = args.indexOf('-conferenceId');
            if (confIdIndex !== -1 && args.length > confIdIndex + 1) {
                conferenceId = args[confIdIndex + 1];
                console.error(`指定会议ID: ${conferenceId}`);
            }
            
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
 * 录制音频的函数
 * @param {number} seconds 录制时长(秒)
 * @returns {Promise<Object>} 返回包含音频文件的base64编码和文件名的对象
 */
async function recordAudio(seconds) {
    console.error(`开始录制音频，时长${seconds}秒...`);
    
    return new Promise((resolve, reject) => {
        try {
            // 创建输出文件流（如果可以保存文件）
            let outputFile = null;
            if (canSaveFiles && savedWavFile) {
                outputFile = fs.createWriteStream(savedWavFile);
                outputFile.write(createWavHeader());
                console.error(`将录音保存到: ${savedWavFile}`);
            } else {
                console.error('不保存录音文件，只处理音频数据');
            }
            
            // 记录数据大小，用于后续更新头部
            let dataSize = 0;
            
            // 初始化麦克风
            const mic = new Mic();
            console.error("麦克风已初始化，请开始说话...");
            
            // 处理收集的音频数据段
            let audioChunks = [];
            
            // 用于跟踪实际录音开始的时间
            let recordingStartTime = null;
            
            // 确保我们录制足够的时间
            const targetDuration = seconds * 1000; // 目标时长(毫秒)
            
            // 开始录音
            const micStream = mic.startRecording();
            
            // 数据处理
            micStream.on('data', (data) => {
                // 第一次收到数据时开始计时
                if (recordingStartTime === null) {
                    recordingStartTime = Date.now();
                    console.error('录音实际开始时间:', new Date(recordingStartTime).toISOString());
                }
                
                dataSize += data.length;
                // 存储音频段，稍后处理
                audioChunks.push(data);
            });
            
            // 错误处理
            micStream.on('error', (err) => {
                console.error('录音错误:', err);
                mic.stopRecording();
                if (outputFile) outputFile.end();
                reject(err);
            });
            
            // 使用递归检查函数，确保录制足够的时间
            const checkRecordingDuration = () => {
                // 如果还没开始收到数据，继续等待
                if (recordingStartTime === null) {
                    console.error('等待麦克风开始收集数据...');
                    setTimeout(checkRecordingDuration, 100);
                    return;
                }
                
                // 计算已经录制的时间
                const elapsedTime = Date.now() - recordingStartTime;
                
                // 如果还没达到目标时长，继续等待
                if (elapsedTime < targetDuration) {
                    const remaining = targetDuration - elapsedTime;
                    console.error(`已录制 ${elapsedTime}ms，还需 ${remaining}ms 达到目标 ${targetDuration}ms`);
                    setTimeout(checkRecordingDuration, Math.min(remaining, 1000));
                    return;
                }
                
                // 达到目标时长，完成录音
                console.error(`录音已达到目标时长 ${targetDuration}ms，实际录制了 ${elapsedTime}ms`);
                finishRecording();
            };
            
            // 完成录音的函数
            const finishRecording = async () => {
                console.error('停止录音');
                mic.stopRecording();
                
                try {
                    // 合并所有音频段
                    const combinedAudio = Buffer.concat(audioChunks);
                    console.error(`收集到原始音频数据: ${combinedAudio.length} 字节`);
                    
                    // 应用音频增强
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
                    
                    // 获取用于写入WAV文件的音频数据
                    let finalAudioData = enhancedAudio;
                    
                    // 如果理论时长与实际时长相差超过5%，尝试修正
                    if (Math.abs(theoreticalDuration - actualDuration) / actualDuration > 0.05) {
                        console.error(`检测到时长不匹配，尝试调整...`);
                        
                        // 方法1: 调整音频头部中的采样率，使得播放器正确解释音频时长
                        // 这不会改变音频内容，只会影响播放器对时长的计算
                        const adjustedSampleRate = Math.floor(audioSettings.sampleRate / audioSettings.calibrationFactor);
                        console.error(`调整后的采样率: ${adjustedSampleRate}Hz (原始: ${audioSettings.sampleRate}Hz)`);
                        
                        // 如果可以保存文件，写入处理后的音频数据
                        if (canSaveFiles && outputFile) {
                            // 重要：关闭之前的输出流
                            outputFile.end();
                            
                            // 创建完整的WAV文件（包括正确的头部）
                            const wavHeader = createWavHeader(adjustedSampleRate);
                            
                            // 手动更新头部信息
                            // 更新RIFF块大小 (文件大小 - 8)
                            wavHeader.writeUInt32LE(finalAudioData.length + 36, 4);
                            // 更新data块大小
                            wavHeader.writeUInt32LE(finalAudioData.length, 40);
                            
                            // 写入完整文件（头部+音频数据）
                            fs.writeFileSync(savedWavFile, Buffer.concat([wavHeader, finalAudioData]));
                            
                            // 重新计算理论时长（使用调整后的采样率）
                            const adjustedBytesPerSecond = adjustedSampleRate * bytesPerSample;
                            const adjustedDuration = finalAudioData.length / adjustedBytesPerSecond;
                            console.error(`调整后的理论时长: ${(adjustedDuration * 1000).toFixed(0)}ms (${adjustedDuration.toFixed(2)}秒)`);
                            
                            console.error(`录音已完成，文件保存至: ${savedWavFile}`);
                            
                            // 提取文件名
                            const filename = path.basename(savedWavFile);
                            
                            // 读取文件并转为base64
                            fs.readFile(savedWavFile, (err, fileData) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                const base64Data = fileData.toString('base64');
                                resolve({
                                    audioData: base64Data,
                                    filename: filename,
                                    enhanced: true,
                                    durationMs: Math.round(actualDuration * 1000), // 使用实际录制时长
                                    fileSizeBytes: fileData.length,
                                    adjustedSampleRate: adjustedSampleRate
                                });
                            });
                        } else {
                            // 没有保存文件，直接处理内存中的音频数据
                            console.error('没有保存到文件，直接处理内存中的音频数据');
                            
                            // 创建一个WAV文件结构的完整内存缓冲区（使用调整后的采样率）
                            const header = createWavHeader(adjustedSampleRate);
                            
                            // 更新头部信息
                            header.writeUInt32LE(finalAudioData.length, 40); // 数据大小
                            header.writeUInt32LE(finalAudioData.length + 36, 4); // 文件大小 - 8
                            
                            const completeAudio = Buffer.concat([header, finalAudioData]);
                            
                            // 生成一个虚拟文件名以供识别
                            const virtualFilename = `virtual_recording_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.wav`;
                            
                            // 直接将缓冲区转换为base64
                            const base64Data = completeAudio.toString('base64');
                            
                            resolve({
                                audioData: base64Data,
                                filename: virtualFilename,
                                enhanced: true,
                                virtual: true, // 标记为虚拟文件，未保存到磁盘
                                durationMs: Math.round(actualDuration * 1000), // 使用实际录制时长
                                fileSizeBytes: completeAudio.length,
                                adjustedSampleRate: adjustedSampleRate
                            });
                        }
                    } else {
                        // 时长匹配正常，使用常规处理
                        
                        // 如果可以保存文件，写入处理后的音频数据
                        if (canSaveFiles && outputFile) {
                            // 重要：关闭之前的输出流
                            outputFile.end();
                            
                            // 创建完整的WAV文件（包括正确的头部）
                            const wavHeader = createWavHeader();
                            
                            // 手动更新头部信息
                            // 更新RIFF块大小 (文件大小 - 8)
                            wavHeader.writeUInt32LE(finalAudioData.length + 36, 4);
                            // 更新data块大小
                            wavHeader.writeUInt32LE(finalAudioData.length, 40);
                            
                            // 写入完整文件（头部+音频数据）
                            fs.writeFileSync(savedWavFile, Buffer.concat([wavHeader, finalAudioData]));
                            
                            console.error(`录音已完成，文件保存至: ${savedWavFile}`);
                            
                            // 提取文件名
                            const filename = path.basename(savedWavFile);
                            
                            // 读取文件并转为base64
                            fs.readFile(savedWavFile, (err, fileData) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                const base64Data = fileData.toString('base64');
                                resolve({
                                    audioData: base64Data,
                                    filename: filename,
                                    enhanced: true,
                                    durationMs: Math.round(theoreticalDuration * 1000),
                                    fileSizeBytes: fileData.length
                                });
                            });
                        } else {
                            // 没有保存文件，直接处理内存中的音频数据
                            console.error('没有保存到文件，直接处理内存中的音频数据');
                            
                            // 创建一个WAV文件结构的完整内存缓冲区
                            const header = createWavHeader();
                            
                            // 更新头部信息
                            header.writeUInt32LE(finalAudioData.length, 40); // 数据大小
                            header.writeUInt32LE(finalAudioData.length + 36, 4); // 文件大小 - 8
                            
                            const completeAudio = Buffer.concat([header, finalAudioData]);
                            
                            // 生成一个虚拟文件名以供识别
                            const virtualFilename = `virtual_recording_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.wav`;
                            
                            // 直接将缓冲区转换为base64
                            const base64Data = completeAudio.toString('base64');
                            
                            resolve({
                                audioData: base64Data,
                                filename: virtualFilename,
                                enhanced: true,
                                virtual: true, // 标记为虚拟文件，未保存到磁盘
                                durationMs: Math.round(theoreticalDuration * 1000),
                                fileSizeBytes: completeAudio.length
                            });
                        }
                    }
                } catch (error) {
                    console.error('处理音频数据失败:', error);
                    reject(error);
                }
            };
            
            // 启动录音持续时间检查 - 使用递归检查代替简单的setTimeout
            checkRecordingDuration();
            
            // 设置一个最大录制时长限制，防止出现问题时永远不结束
            setTimeout(() => {
                if (recordingStartTime === null) {
                    console.error('警告: 在规定时间内未检测到麦克风输入，强制结束录音');
                    mic.stopRecording();
                    reject(new Error('麦克风未检测到输入'));
                }
            }, (seconds + 5) * 1000); // 给予额外5秒的缓冲时间
            
        } catch (err) {
            console.error('初始化录音设备时出错:', err);
            reject(err);
        }
    });
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

// 根据模式执行不同的功能
if (streamMode) {
    // 执行音频流传输
    streamAudio()
        .then(() => {
            console.error('音频流传输已完成');
            process.exit(0);
        })
        .catch(error => {
            console.error('音频流传输失败:', error);
            process.exit(1);
        });
} else {
    // 执行普通录音
    recordAudio(duration)
        .then(result => {
            try {
                // 一定要在命令行输出内容前清空所有可能的日志
                // 将所有调试信息输出到标准错误流
                process.stderr.write('\n准备输出录音结果...\n');
                
                // 确保结果对象结构正确
                if (!result || !result.audioData || !result.filename) {
                    process.stderr.write('警告: 录音结果对象结构不完整\n');
                    if (!result) result = {};
                    if (!result.audioData) result.audioData = '';
                    if (!result.filename) result.filename = `recording_empty_${Date.now()}.wav`;
                }
                
                // 检查base64数据的有效性
                if (result.audioData) {
                    // 移除可能的前缀
                    const base64Data = result.audioData.replace(/^data:audio\/\w+;base64,/, '');
                    // 替换为清理后的数据
                    result.audioData = base64Data;
                }
                
                // 使用JSON.stringify确保数据格式正确
                const output = JSON.stringify(result);
                
                // 仅将JSON输出到标准输出，确保没有其他文本
                process.stdout.write(output);
                process.exit(0);
            } catch (error) {
                process.stderr.write(`JSON序列化失败: ${error.message}\n`);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('录音失败:', error);
            process.exit(1);
        }); 
} 