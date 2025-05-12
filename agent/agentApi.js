const axios = require('axios');
const crypto = require('crypto');
const vscode = require('vscode');
const { OpenAI } = require('openai'); // 导入OpenAI SDK

/**
 * 智谱AI GLM-4模型和DeepSeek V3模型API调用模块
 * 负责处理与AI平台的通信，发送请求并处理响应
 */

// 默认配置
let config = {
    // 智谱AI配置
    zhipuApiKey: '',  // 修改为更具体的名称
    zhipuModel: 'glm-4-flash', // 修改为更具体的名称
    zhipuBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', // 修改为更具体的名称
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2000,
    
    // DeepSeek配置
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    deepseekBaseUrl: 'https://api.deepseek.com',
    
    // 当前使用的模型提供商: 'zhipuai' 或 'deepseek'
    provider: 'zhipuai'
};

// OpenAI客户端实例
let openaiClient = null;

/**
 * 初始化OpenAI客户端
 * @returns {OpenAI} OpenAI客户端实例
 */
function initOpenAIClient() {
    if (!config.deepseekApiKey) {
        throw new Error('未配置DeepSeek API Key');
    }
    
    return new OpenAI({
        baseURL: config.deepseekBaseUrl,
        apiKey: config.deepseekApiKey
    });
}

/**
 * 更新配置信息
 * @param {Object} newConfig 新配置信息
 */
function updateConfig(newConfig) {
    console.log('更新API配置:', newConfig);
    
    // 使用具体的属性名来更新配置
    if (newConfig.apiKey !== undefined) {
        config.zhipuApiKey = newConfig.apiKey; // 更新智谱API Key
        console.log('已更新智谱API Key');
    }
    
    if (newConfig.deepseekApiKey !== undefined) {
        config.deepseekApiKey = newConfig.deepseekApiKey; // 更新DeepSeek API Key
        console.log('已更新DeepSeek API Key');
    }
    
    if (newConfig.model !== undefined) {
        config.zhipuModel = newConfig.model; // 更新智谱模型
        console.log('已更新智谱模型:', newConfig.model);
    }
    
    if (newConfig.deepseekModel !== undefined) {
        config.deepseekModel = newConfig.deepseekModel; // 更新DeepSeek模型
        console.log('已更新DeepSeek模型:', newConfig.deepseekModel);
    }
    
    if (newConfig.provider !== undefined) {
        config.provider = newConfig.provider; // 更新提供商
        console.log('已更新AI提供商:', newConfig.provider);
    }
    
    // 如果更新了DeepSeek API Key，重置OpenAI客户端
    if (newConfig.deepseekApiKey !== undefined) {
        openaiClient = null;
        console.log('已重置OpenAI客户端');
    }
    
    // 打印当前配置状态
    console.log('当前AI提供商:', config.provider);
    if (config.provider === 'zhipuai') {
        console.log('当前智谱模型:', config.zhipuModel);
        console.log('智谱API Key是否已设置:', !!config.zhipuApiKey);
    } else if (config.provider === 'deepseek') {
        console.log('当前DeepSeek模型:', config.deepseekModel);
        console.log('DeepSeek API Key是否已设置:', !!config.deepseekApiKey);
    }
}

/**
 * 获取智谱AI API请求头
 * @returns {Object} 请求头对象
 */
function getZhipuAIHeaders() {
    const apiKey = config.zhipuApiKey;
    if (!apiKey) {
        throw new Error('未配置智谱 API Key');
    }
    
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureRaw = `${timestamp}\n${apiKey}`;
    const signature = crypto.createHmac('sha256', apiKey).update(signatureRaw).digest('hex');
    
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-ZhipuAI-Timestamp': `${timestamp}`,
        'X-ZhipuAI-Signature': signature
    };
}

/**
 * 生成API请求数据
 * @param {string} query 用户查询
 * @returns {Object} 请求数据对象
 */
function buildZhipuAIRequestData(query) {
    return {
        model: config.zhipuModel,
        messages: [
            {
                role: 'system',
                content: '你是一位专业的编程助手，擅长回答编程相关问题和解释代码。'
            },
            {
                role: 'user',
                content: query
            }
        ],
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxTokens
    };
}

/**
 * 处理来自Agent的查询
 * @param {string} query 用户查询内容
 * @returns {Promise<string>} 处理结果
 */
async function handleAgentQuery(query) {
    console.log(`处理查询: ${query}`);
    console.log(`当前提供商: ${config.provider}`);
    
    try {
        if (config.provider === 'zhipuai') {
            // 使用智谱AI
            if (!config.zhipuApiKey) {
                return "请先在设置中配置智谱AI的API Key";
            }
            
            const headers = getZhipuAIHeaders();
            const requestData = buildZhipuAIRequestData(query);
            
            console.log(`向智谱AI发送请求: ${config.zhipuBaseUrl}`);
            const response = await axios.post(config.zhipuBaseUrl, requestData, { headers });
            
            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content;
            } else {
                throw new Error('智谱AI响应格式错误');
            }
        } else if (config.provider === 'deepseek') {
            // 使用DeepSeek
            if (!config.deepseekApiKey) {
                return "请先在设置中配置DeepSeek的API Key";
            }
            
            if (!openaiClient) {
                openaiClient = initOpenAIClient();
            }
            
            console.log(`向DeepSeek发送请求，使用模型: ${config.deepseekModel}`);
            const completion = await openaiClient.chat.completions.create({
                messages: [
                    { role: "system", content: "你是一位专业的编程助手，擅长回答编程相关问题和解释代码。" },
                    { role: "user", content: query }
                ],
                model: config.deepseekModel,
            });
            
            return completion.choices[0].message.content;
        } else {
            throw new Error(`不支持的AI提供商: ${config.provider}`);
        }
    } catch (error) {
        console.error('Agent查询处理失败:', error);
        return `处理查询时出错: ${error.message}`;
    }
}

/**
 * 清除API Key，使用户需要在下次启动时重新输入
 */
function clearApiKeys() {
    config.zhipuApiKey = '';
    config.deepseekApiKey = '';
    openaiClient = null;
}

// 导出模块接口
module.exports = {
    updateConfig,
    handleAgentQuery,
    clearApiKeys
};