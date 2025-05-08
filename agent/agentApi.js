const axios = require('axios');
const crypto = require('crypto');
const vscode = require('vscode');

/**
 * 智谱AI GLM-4模型API调用模块
 * 负责处理与智谱AI平台的通信，发送请求并处理响应
 */

// 默认配置
let config = {
    apiKey: '',
    model: 'glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2000
};

/**
 * 更新API配置
 * @param {Object} newConfig - 新的配置对象
 */
function updateConfig(newConfig) {
    if (newConfig.apiKey !== undefined) {
        config.apiKey = newConfig.apiKey;
    }
    if (newConfig.model !== undefined) {
        config.model = newConfig.model;
    }
}

/**
 * 验证API配置是否有效
 * @returns {boolean} 配置是否有效
 */
function validateConfig() {
    if (!config.apiKey) {
        vscode.window.showErrorMessage('请先在灵犀协作设置中配置智谱AI的API Key');
        return false;
    }
    return true;
}

/**
 * 发送聊天请求到智谱AI
 * @param {Array} messages - 消息历史数组，格式为[{role: 'user', content: '内容'}]
 * @param {Object} options - 可选参数，如temperature、topP等
 * @returns {Promise<Object>} 返回API响应
 */
async function sendChatRequest(messages, options = {}) {
    if (!validateConfig()) {
        throw new Error('API配置无效，请在设置中填写 API Key');
    }
    
    try {
        const requestBody = {
            model: options.model || config.model,
            messages,
            temperature: options.temperature || config.temperature,
            top_p: options.topP || config.topP,
            max_tokens: options.maxTokens || config.maxTokens,
            stream: false,
            request_id: options.requestId || `lingxi-${Date.now()}`
        };
        
        const response = await axios.post(config.baseUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}` 
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('智谱AI API请求失败:', error);
        
        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;
            let errorMessage = `API请求失败 (${statusCode})`;
            if (errorData && errorData.error) {
                errorMessage += `: ${errorData.error.message || JSON.stringify(errorData)}`;
            }
            if (statusCode === 401) {
                errorMessage += '。请检查您的 API Key 是否正确或有效。'
            }
            throw new Error(errorMessage);
        } else if (error.request) {
            throw new Error('未收到API响应，请检查网络连接');
        } else {
            throw new Error(`请求配置错误: ${error.message}`);
        }
    }
}

/**
 * 处理Agent查询
 * @param {string} query - 用户查询内容
 * @param {Object} options - 可选参数
 * @returns {Promise<string>} 返回AI回复内容
 */
async function handleAgentQuery(query, options = {}) {
    try {
        // 构建消息数组
        const messages = [
            {
                role: 'system',
                content: options.systemPrompt || '你是灵犀协作插件中的AI助手，可以帮助用户解答编程问题、提供代码建议和解释概念。请提供简洁、准确、有帮助的回答。'
            },
            {
                role: 'user',
                content: query
            }
        ];
        
        // 如果有对话历史，添加到消息数组中
        if (options.history && Array.isArray(options.history)) {
            // 将历史消息插入到system和user消息之间
            messages.splice(1, 0, ...options.history);
        }
        
        // 发送请求
        const response = await sendChatRequest(messages, options);
        
        // 提取AI回复
        if (response && response.choices && response.choices.length > 0) {
            return response.choices[0].message.content;
        } else {
            throw new Error('API返回的响应格式不正确');
        }
    } catch (error) {
        console.error('处理Agent查询失败:', error);
        throw error;
    }
}

/**
 * 获取当前配置
 * @returns {Object} 当前配置对象（不包含敏感信息）
 */
function getConfig() {
    return config;
}

module.exports = {
    updateConfig,
    sendChatRequest,
    handleAgentQuery,
    getConfig,
    validateConfig
};