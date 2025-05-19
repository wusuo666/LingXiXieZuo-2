#!/usr/bin/env node

const WebSocket = require('ws');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { program } = require('commander');
// 添加 dotenv 依赖
require('dotenv').config();

// 常量定义
const TIME_PER_CHUNK = 0.2;  // 每次发送的音频数据的时间长度，单位：s
const NUM_CHANNEL = 1;  // 声道数
const NUM_QUANTIFY = 16;  // 量化位数
const SAMPLE_RATE = 16000;  // 采样频率
const BYTES_PER_CHUNK = Math.floor(SAMPLE_RATE * NUM_QUANTIFY * TIME_PER_CHUNK * NUM_CHANNEL / 8);
const SLEEP_TIME_DURATION = 100; // 100ms, 转换为毫秒

// 创建输出流（文件或控制台）
let outputStream = process.stdout;
let outputFile = null;

// 生成签名
function generateSignature(appId, apiKey) {
    console.log(appId, apiKey)
    const ts = Math.floor(Date.now() / 1000).toString();
    const md5 = crypto.createHash('md5');
    md5.update(appId + ts);
    const baseString = md5.digest();
    
    const hmac = crypto.createHmac('sha1', apiKey);
    hmac.update(baseString);
    const signa = hmac.digest('base64');
    
    return { signa, ts };
}

// 发送音频数据
async function sendAudioData(ws) {
    return new Promise((resolve, reject) => {
        const filename = options.audio_file;
        const readStream = fs.createReadStream(filename, {
            highWaterMark: BYTES_PER_CHUNK
        });

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        readStream.on('data', async chunk => {
            const startTime = Date.now();
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(chunk);
                const elapsed = Date.now() - startTime;
                if (elapsed < SLEEP_TIME_DURATION) {
                    await sleep(SLEEP_TIME_DURATION - elapsed);
                }
            }
        });

        readStream.on('end', () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('');  // 发送空字符串表示结束
            }
            resolve();
        });

        readStream.on('error', reject);
    });
}

// 接收识别结果
function receiveRecognitionResult(ws, printMode) {
    console.log(`接收ASR结果，输出模式: ${printMode}`);
    
    // 跟踪最后一个段落ID，用于调试
    let lastSegId = null;
    
    ws.on('message', data => {
        if (!data) return;
        
        try {
            const asrJson = JSON.parse(data);
            const isFinal = asrJson.is_final || false;
            const segId = asrJson.seg_id || 0;
            const asr = asrJson.asr || "";
            const type = asrJson.type || "";

            // 仅在段落ID变化时记录一下，避免日志过多
            if (segId !== lastSegId) {
                console.log(`接收到段落 ${segId} 的ASR结果`);
                lastSegId = segId;
            }

            if (printMode === "typewriter") {
                if (type === "asr") {
                    if (isFinal) {
                        // 确保段落ID和文本之间有明确的分隔符，便于后续解析
                        outputStream.write(`${segId}:${asr}\n`);
                    } else {
                        // 非最终结果也写入文件，但使用\r使终端输出覆盖同一行
                        outputStream.write(`\r${segId}:${asr}`);
                    }
                }
            } else {
                // JSON模式下，保持一致的格式输出
                try {
                    if (isFinal) {
                        // 在JSON模式中，确保最终结果也保持"段落ID:内容"的一致格式
                        outputStream.write(`${segId}:${asr}\n`);
                        // 同时写入完整的JSON数据，但使用注释标记，避免干扰解析
                        outputStream.write(`# JSON数据: ${JSON.stringify(asrJson, null, 2)}\n`);
                    } else {
                        // 非最终结果仅在终端显示，不写入文件
                        if (outputFile) {
                            // 什么都不做
                        } else {
                            // 终端输出时，使用\r覆盖同一行
                            process.stdout.write(`\r${segId}:${asr}`);
                        }
                    }
                } catch (err) {
                    console.error('写入JSON输出错误:', err);
                }
            }
        } catch (err) {
            console.error('Error parsing message:', err);
        }
    });
}

// 添加默认的 metadata
const defaultMetadata = {
    "user_id": "1234567890",
    "user_name": "John Doe",
    "user_email": "john.doe@example.com",
    "user_phone": "1234567890",
    "user_role": "student",
    "user_class": "1001",
    "user_school": "ABC School",
    "user_grade": "6"
};

async function connectToServer(printMode, asrType) {
    // 从环境变量中读取
    const appId = "lianxintest2";
    const appSecret = "b7c02cd9-8ebe-4d24-a3b1-f094783b651a";
    
    // 检查环境变量
    if (!appId || !appSecret) {
        throw new Error('缺少必需的环境变量：ZMEET_APP_ID 或 ZMEET_APP_SECRET 未设置');
    }
    
    console.log(`Using appId: ${appId}, appSecret: ${appSecret}`);
    
    const baseUrl = "wss://audio.abcpen.com:8443/asr-realtime/v2/ws";
    
    const { signa, ts } = generateSignature(appId, appSecret);
    const url = `${baseUrl}?appid=${appId}&ts=${ts}&signa=${encodeURIComponent(signa)}&asr_type=${asrType}` +
        `&voiceprint=${options.voiceprint}` +
        `&voiceprint_org_id=${options.voiceprint_org_id}` +
        `&voiceprint_tag_id=${options.voiceprint_tag_id}` +
        `&word_time=${options.word_time}` +
        `&metadata=${encodeURIComponent(JSON.stringify(options.metadata))}`;

    const ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
        ws.on('open', async () => {
            console.log('Connected to server');
            receiveRecognitionResult(ws, printMode);
            
            try {
                await sendAudioData(ws);
            } catch (err) {
                console.error('Error sending audio:', err);
                ws.close();
            }
        });

        ws.on('error', err => {
            console.error('WebSocket error:', err);
            reject(err);
        });

        ws.on('close', () => {
            console.log('Connection closed');
            // 关闭输出文件
            if (outputFile) {
                outputStream.end();
                console.log(`结果已保存到文件: ${outputFile}`);
            }
            resolve();
        });
    });
}

// 命令行参数解析
program
    .option('--mode <type>', 'Output mode: typewriter or json', 'typewriter')
    .option('--asr_type <type>', 'ASR recognition mode: sentence or word', 'word')
    .option('--voiceprint <string>', 'Enable voiceprint recognition', '1')
    .option('--voiceprint_org_id <string>', 'Organization ID for voiceprint', process.env.ZMEET_APP_ID)
    .option('--voiceprint_tag_id <string>', 'Tag ID for voiceprint', process.env.ZMEET_APP_ID)
    .option('--word_time <string>', 'Enable word-level timing output (0: disabled, 1: enabled)', '0')
    .option('--audio_file <path>', '音频文件路径', path.join(__dirname, "../dataset/asr/1006_20241223_081645_full_audio.wav"))
    .option('--metadata <string>', 'Metadata for the request', JSON.stringify(defaultMetadata))
    .option('--output_file <path>', '输出文件路径，不指定则输出到终端')
    .parse(process.argv);

const options = program.opts();

// 如果指定了输出文件，创建文件输出流
if (options.output_file) {
    outputFile = options.output_file;
    try {
        // 确保输出目录存在
        const outputDir = path.dirname(outputFile);
        if (!fs.existsSync(outputDir)) {
            console.log(`创建输出目录: ${outputDir}`);
            fs.mkdirSync(outputDir, { recursive: true });
        }
        console.log(`将输出保存到: ${outputFile}`);
        outputStream = fs.createWriteStream(outputFile, { encoding: 'utf8' });
        
        // 写入BOM标记，确保文件被正确识别为UTF-8
        outputStream.write('\ufeff');
        
        // 写入文件头部，帮助识别文件格式
        const currentTime = new Date().toLocaleString();
        const audioFileName = path.basename(options.audio_file);
        
        outputStream.write(`# ASR识别结果 - ${currentTime}\n`);
        outputStream.write(`# 模式: ${options.mode}, ASR类型: ${options.asr_type}\n`);
        outputStream.write(`# 音频文件: ${audioFileName}\n\n`);
        
        console.log(`输出将保存到文件: ${outputFile}`);
    } catch (err) {
        console.error(`创建输出文件失败: ${err.message}`);
        console.log('将使用终端作为输出');
        outputStream = process.stdout;
        outputFile = null;
    }
}

// 主程序执行
connectToServer(options.mode, options.asr_type)
    .catch(err => {
        console.error('Program error:', err);
        if (outputFile) {
            outputStream.end();
        }
        process.exit(1);
    });