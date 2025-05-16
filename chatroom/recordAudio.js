#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const Mic = require('node-microphone');
const WebSocket = require('ws');

// 检查命令行参数
const args = process.argv.slice(2);
const streamMode = args.includes('-stream');
let serverPort = 3000; // 默认WebSocket服务器端口
let serverAddress = 'localhost'; // 默认地址

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
let recordingsDir;
try {
    // 如果命令行传递了工作区路径参数
    const workspacePathIndex = streamMode ? args.indexOf('-workspace') : 1;
    if (workspacePathIndex !== -1 && args.length > workspacePathIndex + 1) {
        const workspacePath = args[workspacePathIndex + 1];
        recordingsDir = path.join(workspacePath, 'recordings');
        console.error(`使用命令行参数提供的工作区路径: ${workspacePath}`);
    } else {
        // 默认使用相对于插件目录的recordings文件夹
        recordingsDir = path.join(path.resolve(__dirname, '..'), 'recordings');
        console.error(`使用默认路径: ${recordingsDir}`);
    }
    
    // 确保recordings文件夹存在
    if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
        console.error(`创建recordings文件夹: ${recordingsDir}`);
    }
} catch (error) {
    console.error('创建recordings文件夹失败:', error);
    process.exit(1);
}

// 音频文件路径（仅用于录音模式）
let savedWavFile;
if (!streamMode) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // 添加随机字符串确保唯一性
    const uniqueId = Math.random().toString(36).substring(2, 10);
    savedWavFile = path.join(recordingsDir, `recording_${timestamp}_${uniqueId}.wav`);
    console.error(`将保存录音文件: ${savedWavFile}`);
}

/**
 * 实时音频流传输函数
 * @returns {Promise<void>}
 */
async function streamAudio() {
    console.error('开始音频流传输...');
    
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
                
                // 发送初始化消息，标识为音频流发送者
                ws.send(JSON.stringify({
                    type: 'init',
                    role: 'streamer',
                    format: {
                        sampleRate: 44100,
                        numChannels: 1,
                        bitsPerSample: 16
                    }
                }));
                
                // 开始录音
                const micStream = mic.startRecording();
                
                // 数据处理 - 发送音频数据块
                micStream.on('data', (data) => {
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
                                const sampleRate = 44100;
                                const numChannels = 1;
                                const bitsPerSample = 16;
                                
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
                            
                            // 将处理后的二进制数据转换为Base64字符串
                            const base64Audio = audioDataWithHeader.toString('base64');
                            console.log(`Base64编码后长度: ${base64Audio.length} 字符`);
                            
                            // 构建JSON消息
                            const audioMessage = {
                                type: 'audioStream',
                                audioData: base64Audio,
                                sequence: sequenceNumber++,
                                format: {
                                    sampleRate: 44100,
                                    numChannels: 1,
                                    bitsPerSample: 16,
                                    isWav: true // 标记为WAV格式
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
                    ws.close();
                    reject(err);
                });
                
                // 处理WebSocket关闭事件
                ws.on('close', () => {
                    console.error('WebSocket连接已关闭，停止音频流');
                    mic.stopRecording();
                    resolve();
                });
                
                // 处理WebSocket错误
                ws.on('error', (err) => {
                    console.error('WebSocket错误:', err);
                    mic.stopRecording();
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
                            ws.close();
                            resolve();
                        }
                    } catch (err) {
                        console.error('解析服务器消息失败:', err);
                    }
                });
                
                // 处理用户中断信号
                process.on('SIGINT', () => {
                    console.error('接收到中断信号，结束音频流');
                    mic.stopRecording();
                    ws.close();
                    resolve();
                });
            });
            
            // 处理连接失败
            ws.on('error', (err) => {
                console.error('连接到WebSocket服务器失败:', err);
                reject(err);
            });
            
        } catch (err) {
            console.error('初始化音频流传输时出错:', err);
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
            // 创建输出文件流
            const outputFile = fs.createWriteStream(savedWavFile);
            
            // 初始化WAV文件头
            outputFile.write(createWavHeader());
            
            // 记录数据大小，用于后续更新头部
            let dataSize = 0;
            
            // 初始化麦克风
            const mic = new Mic();
            console.error("麦克风已初始化，请开始说话...");
            
            // 开始录音
            const micStream = mic.startRecording();
            
            // 数据处理
            micStream.on('data', (data) => {
                dataSize += data.length;
                outputFile.write(data);
            });
            
            // 错误处理
            micStream.on('error', (err) => {
                console.error('录音错误:', err);
                mic.stopRecording();
                outputFile.end();
                reject(err);
            });
            
            // 设置定时器，在指定时间后停止录音
            setTimeout(() => {
                console.error('停止录音');
                mic.stopRecording();
                
                // 完成文件写入
                outputFile.end();
                
                // 更新WAV文件头中的数据大小
                updateWavHeader(savedWavFile, dataSize);
                
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
                        filename: filename
                    });
                });
            }, seconds * 1000);
            
        } catch (err) {
            console.error('初始化录音设备时出错:', err);
            reject(err);
        }
    });
}

/**
 * 创建WAV文件头（44字节）
 * @returns {Buffer} WAV文件头
 */
function createWavHeader() {
    // WAV文件参数 - 使用更常见的参数
    const sampleRate = 44100;      // 采样率
    const numChannels = 1;         // 单声道
    const bitsPerSample = 16;      // 采样位深
    
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
 */
function updateWavHeader(filePath, dataSize) {
    try {
        const fd = fs.openSync(filePath, 'r+');
        
        // 更新data块大小 (偏移量40)
        const dataSizeBuffer = Buffer.alloc(4);
        dataSizeBuffer.writeUInt32LE(dataSize, 0);
        fs.writeSync(fd, dataSizeBuffer, 0, 4, 40);
        
        // 更新RIFF块大小 (文件大小 - 8) (偏移量4)
        const fileSizeBuffer = Buffer.alloc(4);
        fileSizeBuffer.writeUInt32LE(dataSize + 36, 0); // 文件大小 = 数据大小 + 头部(44) - 8
        fs.writeSync(fd, fileSizeBuffer, 0, 4, 4);
        
        fs.closeSync(fd);
        
        console.error(`WAV头部已更新，数据大小: ${dataSize} 字节，总文件大小: ${dataSize + 44} 字节`);
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