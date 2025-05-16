/**
 * 讯飞语音听写Node.js实现
 * 将音频文件上传并获取转写结果
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto-js');

// 讯飞语音听写API地址
const LFASR_HOST = 'https://raasr.xfyun.cn/v2/api';
const API_UPLOAD = '/upload';
const API_GET_RESULT = '/getResult';

class IfasrApi {
  constructor(appId, secretKey, filePath) {
    this.appId = appId;
    this.secretKey = secretKey;
    this.filePath = filePath;
    this.ts = Math.floor(Date.now() / 1000).toString();
    this.signa = this.getSigna();
  }

  /**
   * 生成签名
   */
  getSigna() {
    const md5 = crypto.MD5(this.appId + this.ts).toString();
    const signa = crypto.HmacSHA1(md5, this.secretKey);
    return crypto.enc.Base64.stringify(signa);
  }

  /**
   * 上传音频文件
   */
  async upload() {
    console.log('上传部分：');
    const fileStats = fs.statSync(this.filePath);
    const fileName = path.basename(this.filePath);

    const params = {
      appId: this.appId,
      signa: this.signa,
      ts: this.ts,
      fileSize: fileStats.size,
      fileName: fileName,
      duration: '200' // 音频时长，以秒为单位，可以根据实际情况设置
    };

    console.log('upload参数：', params);

    // 构建请求URL
    const queryString = Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    const uploadUrl = `${LFASR_HOST}${API_UPLOAD}?${queryString}`;
    console.log('upload_url:', uploadUrl);

    // 读取文件
    const fileData = fs.readFileSync(this.filePath);

    try {
      const response = await axios({
        method: 'post',
        url: uploadUrl,
        headers: {
          'Content-Type': 'application/json'
        },
        data: fileData
      });

      console.log('upload resp:', response.data);
      return response.data;
    } catch (error) {
      console.error('上传失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取转写结果
   */
  async getResult() {
    try {
      const uploadResp = await this.upload();
      
      // 检查响应是否包含content字段
      if (!uploadResp.content) {
        console.error('错误: 上传失败，服务返回信息:', uploadResp.descInfo || '未知错误');
        return uploadResp;
      }
      
      const orderId = uploadResp.content.orderId;
      
      const params = {
        appId: this.appId,
        signa: this.signa,
        ts: this.ts,
        orderId: orderId,
        resultType: 'transfer,predict'
      };

      console.log('\n查询部分：');
      console.log('get result参数：', params);

      const queryString = Object.keys(params)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&');
      
      let status = 3; // 初始状态为处理中
      let result; // 定义结果变量
      
      // 轮询获取结果
      while (status === 3) {
        const response = await axios({
          method: 'post',
          url: `${LFASR_HOST}${API_GET_RESULT}?${queryString}`,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        result = response.data; // 保存结果
        console.log(result);
        
        status = result.content.orderInfo.status;
        console.log('status=', status);
        
        if (status === 4) { // 转写完成
          break;
        }
        
        // 等待5秒后再次查询
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      console.log('get_result resp:', result);
      return result;
    } catch (error) {
      console.error('获取结果失败:', error.message);
      throw error;
    }
  }
}

/**
 * 将转写结果保存为TXT文件
 * @param {Object} result - 讯飞API返回的转写结果
 * @param {string} audioFilePath - 音频文件路径
 */
function saveResultToTxt(result, audioFilePath) {
  // 如果结果无效，直接返回
  if (!result || !result.content || !result.content.orderResult) {
    console.error('结果无效，无法保存为TXT文件');
    console.log('结果内容:', JSON.stringify(result, null, 2));
    return;
  }
  
  try {
    // 解析结果
    const orderResult = JSON.parse(result.content.orderResult);
    console.log('解析后的结果格式:', JSON.stringify(Object.keys(orderResult), null, 2));
    
    let textContent = '';
    
    // 处理讯飞API返回的结果格式
    if (orderResult.lattice && Array.isArray(orderResult.lattice)) {
      console.log('正在处理lattice格式的结果，共有', orderResult.lattice.length, '个片段');
      
      // 按照时间顺序排序
      orderResult.lattice.sort((a, b) => {
        const bgA = extractBgTime(a.json_1best);
        const bgB = extractBgTime(b.json_1best);
        return bgA - bgB;
      });
      
      // 提取每个片段的文本并合并成一个连续的文本
      let combinedText = '';
      orderResult.lattice.forEach(item => {
        try {
          // 解析每个lattice中的json_1best字段
          const json1Best = JSON.parse(item.json_1best);
          const sentence = extractSentence(json1Best);
          if (sentence) {
            combinedText += sentence;
          }
        } catch (err) {
          console.error('解析json_1best时出错:', err.message);
        }
      });
      
      // 将合并的文本按句子分割
      // 使用正则表达式匹配常见的句末标点（句号、问号、感叹号、分号等）
      const sentences = combinedText.split(/([。？！；])/);
      
      // 重新组合句子，每个标点跟前面的文字放一起
      let formattedSentences = [];
      for (let i = 0; i < sentences.length; i += 2) {
        const text = sentences[i];
        const punctuation = sentences[i + 1] || '';
        if (text.trim()) {
          formattedSentences.push(text + punctuation);
        }
      }
      
      // 处理最后一个可能没有标点的句子
      if (sentences.length % 2 === 1 && sentences[sentences.length - 1].trim()) {
        formattedSentences.push(sentences[sentences.length - 1]);
      }
      
      // 为每个句子添加序号
      textContent = formattedSentences.map((sentence, index) => {
        // 只处理非空的句子
        if (sentence.trim()) {
          return `${index}:${sentence}`;
        }
        return '';
      }).filter(line => line).join('\n');
    } else {
      console.error('未找到有效的lattice结构');
      // 将完整的结果结构写入文件以便调试
      textContent = '0:' + JSON.stringify(orderResult, null, 2);
    }
    
    // 生成输出文件名（基于音频文件名）
    const audioFileName = path.basename(audioFilePath, path.extname(audioFilePath));
    const outputFileName = `${audioFileName}_转写结果.txt`;
    const outputPath = path.join(path.dirname(audioFilePath), outputFileName);
    
    // 写入文件
    fs.writeFileSync(outputPath, textContent, 'utf8');
    console.log(`转写结果已保存至: ${outputPath}`);
  } catch (error) {
    console.error('保存TXT文件时出错:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

/**
 * 从json_1best中提取"bg"时间戳
 * @param {string} json1Best - json_1best字段的字符串值
 * @returns {number} 开始时间的数值
 */
function extractBgTime(json1Best) {
  try {
    const parsedJson = JSON.parse(json1Best);
    if (parsedJson && parsedJson.st && parsedJson.st.bg) {
      return parseInt(parsedJson.st.bg, 10);
    }
  } catch (e) {
    // 解析错误，返回0
  }
  return 0;
}

/**
 * 从解析后的json_1best中提取句子文本
 * @param {Object} json1Best - 解析后的json_1best对象
 * @returns {string} 提取的句子文本
 */
function extractSentence(json1Best) {
  try {
    if (!json1Best || !json1Best.st || !json1Best.st.rt) {
      return '';
    }
    
    let sentence = '';
    // 遍历每个词组
    json1Best.st.rt.forEach(rt => {
      if (rt.ws) {
        rt.ws.forEach(ws => {
          if (ws.cw) {
            ws.cw.forEach(cw => {
              // 包括标点符号，更好地处理文本结构
              if (cw.w) {
                // 如果是标点符号，直接添加，不加空格
                if (cw.wp === 'p') {
                  sentence += cw.w;
                } else {
                  // 如果是普通词，添加到句子中
                  sentence += cw.w;
                }
              }
            });
          }
        });
      }
    });
    
    return sentence;
  } catch (e) {
    console.error('提取句子时出错:', e.message);
    return '';
  }
}

/**
 * 执行语音识别任务
 * @param {Object} options - 配置选项
 * @param {string} options.audioFile - 音频文件路径
 * @param {string} [options.outputFile] - 输出文件路径，可选
 * @param {string} [options.appId] - 讯飞应用ID，可选
 * @param {string} [options.secretKey] - 讯飞密钥，可选
 * @returns {Promise<Object>} 语音识别结果
 */
async function runASR(options) {
  const appId = options.appId || '7ee86186';
  const secretKey = options.secretKey || '4d80f1c53821991149cc6a0e7be83119';
  const filePath = options.audioFile;
  
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('错误: 音频文件不存在');
    throw new Error('音频文件不存在: ' + filePath);
  }
  
  try {
    const api = new IfasrApi(appId, secretKey, filePath);
    const result = await api.getResult();
    console.log('转写完成！');
    
    // 如果指定了输出文件，保存转写结果
    if (options.outputFile) {
      const outputDir = path.dirname(options.outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // 保存转写结果为TXT文件
      saveResultToTxt(result, filePath);
      
      // 如果有明确的输出路径，则写入指定位置
      if (options.outputFile) {
        try {
          // 从result中提取文本内容
          let textContent = '';
          if (result && result.content && result.content.orderResult) {
            const orderResult = JSON.parse(result.content.orderResult);
            
            if (orderResult.lattice && Array.isArray(orderResult.lattice)) {
              // 按照时间顺序排序
              orderResult.lattice.sort((a, b) => {
                const bgA = extractBgTime(a.json_1best);
                const bgB = extractBgTime(b.json_1best);
                return bgA - bgB;
              });
              
              // 提取每个片段的文本
              let combinedText = '';
              orderResult.lattice.forEach(item => {
                try {
                  const json1Best = JSON.parse(item.json_1best);
                  const sentence = extractSentence(json1Best);
                  if (sentence) {
                    combinedText += sentence;
                  }
                } catch (err) {}
              });
              
              // 将合并的文本按句子分割
              // 使用正则表达式匹配常见的句末标点（句号、问号、感叹号、分号等）
              const sentences = combinedText.split(/([。？！；])/);
              
              // 重新组合句子，每个标点跟前面的文字放一起
              let formattedSentences = [];
              for (let i = 0; i < sentences.length; i += 2) {
                const text = sentences[i];
                const punctuation = sentences[i + 1] || '';
                if (text.trim()) {
                  formattedSentences.push(text + punctuation);
                }
              }
              
              // 处理最后一个可能没有标点的句子
              if (sentences.length % 2 === 1 && sentences[sentences.length - 1].trim()) {
                formattedSentences.push(sentences[sentences.length - 1]);
              }
              
              // 为每个句子添加序号
              textContent = formattedSentences.map((sentence, index) => {
                // 只处理非空的句子
                if (sentence.trim()) {
                  return `${index}:${sentence}`;
                }
                return '';
              }).filter(line => line).join('\n');
            } else {
              textContent = '0:' + JSON.stringify(orderResult, null, 2);
            }
          }
          
          // 写入指定输出文件
          fs.writeFileSync(options.outputFile, textContent, 'utf8');
          console.log(`转写结果已保存至: ${options.outputFile}`);
        } catch (error) {
          console.error('保存到指定输出文件时出错:', error.message);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('语音识别运行错误:', error);
    throw error;
  }
}

// 检查是否直接运行此脚本
if (require.main === module) {
  // 命令行参数处理
  const args = process.argv.slice(2);
  let outputFile = null;
  let audioFile = null;
  
  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output_file' && i + 1 < args.length) {
      outputFile = args[i + 1];
      i++; // 跳过下一个参数
    } else if (!audioFile) {
      // 假设第一个非选项参数是音频文件
      audioFile = args[i];
    }
  }
  
  // 如果没有指定音频文件，使用默认文件
  if (!audioFile) {
    audioFile = path.join(__dirname, 'audio', 'lfasr_涉政.wav');
    console.log(`使用默认音频文件: ${audioFile}`);
  }
  
  // 执行ASR
  runASR({
    audioFile,
    outputFile
  }).catch(error => {
    console.error('ASR执行失败:', error);
    process.exit(1);
  });
} else {
  // 作为模块导出
  module.exports = {
    IfasrApi,
    saveResultToTxt,
    runASR
  };
} 