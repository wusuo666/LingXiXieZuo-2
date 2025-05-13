const axios = require('axios');
const crypto = require('crypto');
const vscode = require('vscode');
const { OpenAI } = require('openai'); // 导入OpenAI SDK
const { spawn } = require('child_process');
// const dotenv = require('dotenv'); // 移除dotenv引用
const readline = require('readline');
const { fileURLToPath } = require('url');

/**
 * 大模型API调用模块
 * 负责处理与AI平台的通信，发送请求并处理响应
 */

// 默认配置
let config = {
    // OpenAI配置
    openaiApiKey: '',
    model: 'gpt-3.5-turbo',
    baseUrl: 'https://api.openai.com/v1',
    
    // 智谱AI配置
    zhipuApiKey: '',
    zhipuModel: 'glm-4-flash',
    zhipuBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    
    // DeepSeek配置
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    deepseekBaseUrl: 'https://api.deepseek.com',
    
    // 当前使用的模型提供商: 'openai', 'zhipuai' 或 'deepseek'
    provider: 'openai',
    
    // 其他配置
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2000
};

// OpenAI客户端实例
let openaiClient = null;
let serverProcess = null;
let rl = null;
let availableTools = [];

// 添加对话历史管理
let conversationHistory = {}; // 用于存储不同会话的对话历史
let currentSessionId = 'default'; // 默认会话ID

/**
 * 初始化OpenAI客户端
 * @returns {OpenAI} OpenAI客户端实例
 */
function initOpenAIClient() {
    let apiKey;
    let baseURL;
    
    if (config.provider === 'openai') {
        if (!config.openaiApiKey) {
            throw new Error('未配置OpenAI API Key');
        }
        apiKey = config.openaiApiKey;
        baseURL = config.baseUrl;
    } else if (config.provider === 'deepseek') {
        if (!config.deepseekApiKey) {
            throw new Error('未配置DeepSeek API Key');
        }
        apiKey = config.deepseekApiKey;
        baseURL = config.deepseekBaseUrl;
    } else {
        throw new Error(`不支持的提供商: ${config.provider}`);
    }
    
    return new OpenAI({
        baseURL: baseURL,
        apiKey: apiKey
    });
}

/**
 * 更新配置信息
 * @param {Object} newConfig 新配置信息
 */
function updateConfig(newConfig) {
    console.log('更新API配置:', JSON.stringify(newConfig, null, 2));
    
    // 处理apiKey - 同时根据当前provider决定存储在哪个特定字段
    if (newConfig.apiKey !== undefined) {
        if (config.provider === 'zhipuai') {
            config.zhipuApiKey = newConfig.apiKey;
            console.log('已更新智谱API Key');
        } else if (config.provider === 'deepseek') {
            config.deepseekApiKey = newConfig.apiKey;
            console.log('已更新DeepSeek API Key');
        } else if (config.provider === 'openai') {
            config.openaiApiKey = newConfig.apiKey;
            console.log('已更新OpenAI API Key');
        }
    }
    
    // 单独处理 deepseekApiKey
    if (newConfig.deepseekApiKey !== undefined) {
        config.deepseekApiKey = newConfig.deepseekApiKey;
        console.log('已直接更新DeepSeek API Key:', config.deepseekApiKey ? '已设置' : '未设置');
    }
    
    // 处理zhipuApiKey
    if (newConfig.zhipuApiKey !== undefined) {
        config.zhipuApiKey = newConfig.zhipuApiKey;
        console.log('已直接更新智谱API Key:', config.zhipuApiKey ? '已设置' : '未设置');
    }
    
    // 处理model
    if (newConfig.model !== undefined) {
        if (config.provider === 'zhipuai') {
            config.zhipuModel = newConfig.model;
            console.log('已更新智谱模型:', newConfig.model);
        } else if (config.provider === 'deepseek') {
            config.deepseekModel = newConfig.model;
            console.log('已更新DeepSeek模型:', newConfig.model);
        } else if (config.provider === 'openai') {
            config.model = newConfig.model;
            console.log('已更新OpenAI模型:', newConfig.model);
        }
    }
    
    // 处理deepseekModel
    if (newConfig.deepseekModel !== undefined) {
        config.deepseekModel = newConfig.deepseekModel;
        console.log('已直接更新DeepSeek模型:', newConfig.deepseekModel);
    }
    
    // 处理zhipuModel
    if (newConfig.zhipuModel !== undefined) {
        config.zhipuModel = newConfig.zhipuModel;
        console.log('已直接更新智谱模型:', newConfig.zhipuModel);
    }
    
    // 处理provider
    if (newConfig.provider !== undefined) {
        config.provider = newConfig.provider;
        console.log('已更新AI提供商:', newConfig.provider);
    }
    
    // 处理baseUrl
    if (newConfig.baseUrl !== undefined) {
        if (config.provider === 'openai') {
            config.baseUrl = newConfig.baseUrl;
            console.log('已更新OpenAI基础URL:', newConfig.baseUrl);
        }
    }
    
    // 重置客户端
    openaiClient = null;
    console.log('已重置客户端');
    
    // 打印当前配置状态
    console.log('当前AI提供商:', config.provider);
    if (config.provider === 'zhipuai') {
        console.log('当前智谱模型:', config.zhipuModel);
        console.log('智谱API Key是否已设置:', !!config.zhipuApiKey);
    } else if (config.provider === 'deepseek') {
        console.log('当前DeepSeek模型:', config.deepseekModel);
        console.log('DeepSeek API Key是否已设置:', !!config.deepseekApiKey);
        console.log('DeepSeek API Key长度:', config.deepseekApiKey ? config.deepseekApiKey.length : 0);
    } else if (config.provider === 'openai') {
        console.log('当前OpenAI模型:', config.model);
        console.log('OpenAI API Key是否已设置:', !!config.openaiApiKey);
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
 * 连接到MCP服务器并列出可用工具
 * @param {string} serverScriptPath - 服务器脚本路径
 * @param {string} workspaceDir - 工作区目录路径
 * @returns {Promise<void>}
 */
async function connectToServer(serverScriptPath, workspaceDir) {
    if (!serverScriptPath) return;
    
    const isPython = serverScriptPath.endsWith('.py');
    const isJs = serverScriptPath.endsWith('.js');
    
    if (!(isPython || isJs)) {
        throw new Error('服务器脚本必须是.py或.js文件');
    }
    
    const command = isPython ? 'python' : 'node';
    
    // 增加命令行参数，传递工作区目录
    const args = [serverScriptPath];
    if (workspaceDir) {
        console.log(`传递工作区目录参数: ${workspaceDir}`);
        args.push('--workspace');
        args.push(workspaceDir);
    }
    
    // 启动服务器进程
    serverProcess = spawn(command, args);
    
    // 创建读写接口
    rl = readline.createInterface({
        input: serverProcess.stdout,
        output: serverProcess.stdin
    });
    
    // 处理错误
    serverProcess.stderr.on('data', (data) => {
        console.error(`服务器错误: ${data}`);
    });
    
    // 初始化与服务器的通信
    await initialize();
    
    // 列出可用工具
    const tools = await listTools();
    availableTools = tools;
    
    console.log('\n已连接到服务器，支持以下工具:', tools.map(tool => tool.name));
}

/**
 * 初始化与服务器的通信
 * @returns {Promise<object>} 初始化响应
 */
async function initialize() {
    const initMessage = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {},
        id: 1
    };
    
    return new Promise((resolve, reject) => {
        serverProcess.stdin.write(JSON.stringify(initMessage) + '\n');
        
        rl.once('line', (line) => {
            try {
                const response = JSON.parse(line);
                resolve(response);
            } catch (error) {
                reject(new Error(`无法解析服务器响应: ${error.message}`));
            }
        });
    });
}

/**
 * 列出服务器上可用的工具
 * @returns {Promise<Array>} 工具列表
 */
async function listTools() {
    if (!serverProcess || !rl) {
        return [];
    }
    
    const listToolsMessage = {
        jsonrpc: '2.0',
        method: 'list_tools',
        params: {},
        id: 2
    };
    
    return new Promise((resolve, reject) => {
        serverProcess.stdin.write(JSON.stringify(listToolsMessage) + '\n');
        
        rl.once('line', (line) => {
            try {
                const response = JSON.parse(line);
                resolve(response.result.tools || []);
            } catch (error) {
                reject(new Error(`无法解析工具列表: ${error.message}`));
            }
        });
    });
}

/**
 * 调用服务器上的工具
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @returns {Promise<object>} 工具调用结果
 */
async function callTool(toolName, args) {
    if (!serverProcess || !rl) {
        throw new Error('未连接到服务器');
    }
    
    const callToolMessage = {
        jsonrpc: '2.0',
        method: 'call_tool',
        params: {
            name: toolName,
            input: args
        },
        id: 3
    };
    
    return new Promise((resolve, reject) => {
        serverProcess.stdin.write(JSON.stringify(callToolMessage) + '\n');
        
        rl.once('line', (line) => {
            try {
                const response = JSON.parse(line);
                resolve(response.result || {});
            } catch (error) {
                reject(new Error(`无法解析工具调用结果: ${error.message}`));
            }
        });
    });
}

/**
 * 处理来自Agent的查询
 * @param {string} query 用户查询内容
 * @param {string} sessionId 会话ID，默认使用currentSessionId
 * @returns {Promise<string>} 处理结果
 */
async function handleAgentQuery(query, sessionId = currentSessionId) {
    console.log(`处理查询: ${query}`);
    console.log(`当前提供商: ${config.provider}`);
    console.log(`当前会话ID: ${sessionId}`);
    
    // 打印当前配置状态
    if (config.provider === 'zhipuai') {
        console.log('当前智谱模型:', config.zhipuModel);
        console.log('智谱API Key是否已设置:', !!config.zhipuApiKey);
    } else if (config.provider === 'deepseek') {
        console.log('当前DeepSeek模型:', config.deepseekModel);
        console.log('DeepSeek API Key是否已设置:', !!config.deepseekApiKey);
        console.log('DeepSeek API Key长度:', config.deepseekApiKey ? config.deepseekApiKey.length : 0);
    } else if (config.provider === 'openai') {
        console.log('当前OpenAI模型:', config.model);
        console.log('OpenAI API Key是否已设置:', !!config.openaiApiKey);
    }
    
    // 检查服务器连接和工具状态
    console.log('服务器进程状态:', serverProcess ? '已连接' : '未连接');
    console.log('可用工具数量:', availableTools ? availableTools.length : 0);
    
    // 如果服务器已连接但没有可用工具，尝试重新获取工具列表
    if (serverProcess && rl && (!availableTools || availableTools.length === 0)) {
        try {
            console.log('尝试重新获取工具列表...');
            const tools = await listTools();
            if (tools && tools.length > 0) {
                availableTools = tools;
                console.log('成功获取工具列表，可用工具:', tools.map(tool => tool.name));
            } else {
                console.log('获取工具列表成功，但没有可用工具');
            }
        } catch (error) {
            console.error('获取工具列表失败:', error);
        }
    }
    
    try {
        if (config.provider === 'zhipuai') {
            // 使用智谱AI
            if (!config.zhipuApiKey) {
                console.log('智谱API Key未设置，返回错误信息');
                return "请先在设置中配置智谱AI的API Key";
            }
            
            const headers = getZhipuAIHeaders();
            
            // 获取历史对话
            let messages = getConversationHistory(sessionId);
            
            // 如果历史为空，添加系统消息
            if (messages.length === 0) {
                messages.push({
                    role: 'system',
                    content: '你是一位专业的编程助手，擅长回答编程相关问题和解释代码。'
                });
            }
            
            // 添加当前用户消息
            messages.push({
                role: 'user',
                content: query
            });
            
            // 将用户消息添加到历史
            addToConversationHistory(sessionId, 'user', query);
            
            const requestData = {
                model: config.zhipuModel,
                messages: messages,
                temperature: config.temperature,
                top_p: config.topP,
                max_tokens: config.maxTokens
            };
            
            console.log(`向智谱AI发送请求: ${config.zhipuBaseUrl}`);
            const response = await axios.post(config.zhipuBaseUrl, requestData, { headers });
            
            if (response.data && response.data.choices && response.data.choices.length > 0) {
                const assistantResponse = response.data.choices[0].message.content;
                
                // 将助手回复添加到历史
                addToConversationHistory(sessionId, 'assistant', assistantResponse);
                
                return assistantResponse;
            } else {
                throw new Error('智谱AI响应格式错误');
            }
        } else if (config.provider === 'deepseek' || config.provider === 'openai') {
            // 使用OpenAI兼容接口的模型
            let apiKeyField = config.provider === 'deepseek' ? 'deepseekApiKey' : 'openaiApiKey';
            console.log(`检查 ${apiKeyField} 是否已设置:`, !!config[apiKeyField]);
            
            if (!config[apiKeyField]) {
                console.log(`${config.provider} API Key未设置，返回错误信息`);
                return `请先在设置中配置${config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'}的API Key`;
            }
            
            if (!openaiClient) {
                try {
                    openaiClient = initOpenAIClient();
                    console.log('成功初始化OpenAI客户端');
                } catch (error) {
                    console.error('初始化OpenAI客户端失败:', error);
                    return `初始化客户端失败: ${error.message}`;
                }
            }
            
            const modelName = config.provider === 'deepseek' ? config.deepseekModel : config.model;
            console.log(`向${config.provider}发送请求，使用模型: ${modelName}`);
            
            // 获取对话历史
            let messages = getConversationHistory(sessionId);
            
            // 如果历史为空且是新对话，添加系统消息
            if (messages.length === 0) {
                messages.push({
                    role: 'system',
                    content: '你是一位专业的编程助手，擅长回答编程相关问题和解释代码。'
                });
            }
            
            // 添加当前用户消息
            messages.push({ role: 'user', content: query });
            
            // 将用户消息添加到历史
            addToConversationHistory(sessionId, 'user', query);
            
            // 打印消息历史长度，用于调试
            console.log(`发送请求前的消息历史长度: ${messages.length}`);
            
            // 检查是否有可用的工具
            if (availableTools && availableTools.length > 0) {
                console.log('有可用工具，数量:', availableTools.length);
                
                // 将工具转换为OpenAI工具格式
                const tools = availableTools.map(tool => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                }));
                
                console.log('可用工具：', tools.map(t => t.function.name));
                
                try {
                    // 第一步：调用模型获取工具调用意图
                    console.log('第一次调用模型，判断是否需要使用工具');
                    const response = await openaiClient.chat.completions.create({
                        model: modelName,
                        messages,
                        tools
                    });
                    
                    const assistantMessage = response.choices[0].message;
                    console.log('模型回复类型:', response.choices[0].finish_reason);
                    
                    // 添加模型回复到消息列表
                    messages.push(assistantMessage);
                    
                    // 检查是否有工具调用
                    if (response.choices[0].finish_reason === 'tool_calls' && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                        console.log('模型选择调用工具');
                        
                        // 处理每个工具调用
                        for (const toolCall of assistantMessage.tool_calls) {
                            const toolName = toolCall.function.name;
                            let toolArgs;
                            
                            try {
                                toolArgs = JSON.parse(toolCall.function.arguments);
                            } catch (error) {
                                console.error(`解析工具参数错误: ${error.message}`);
                                return `解析工具参数时出错: ${error.message}`;
                            }
                            
                            console.log(`调用工具: ${toolName}, 参数:`, toolArgs);
                            
                            // 执行工具调用
                            let result;
                            try {
                                result = await callTool(toolName, toolArgs);
                                console.log('工具调用结果:', result);
                            } catch (error) {
                                console.error(`工具调用错误: ${error.message}`);
                                result = { content: [{ type: 'text', text: `工具调用失败: ${error.message}` }] };
                            }
                            
                            // 添加工具结果到消息列表
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: result.content?.[0]?.text || '工具未返回任何内容'
                            });
                        }
                        
                        // 第二步：将结果返回给大模型生成最终回答
                        console.log('第二次调用模型，生成最终回答');
                        try {
                            const finalResponse = await openaiClient.chat.completions.create({
                                model: modelName,
                                messages
                            });
                            
                            const assistantResponse = finalResponse.choices[0].message.content;
                            
                            // 将助手回复添加到历史
                            addToConversationHistory(sessionId, 'assistant', assistantResponse);
                            
                            return assistantResponse;
                        } catch (error) {
                            console.error(`最终响应错误: ${error.message}`);
                            return `生成最终回答时出错: ${error.message}`;
                        }
                    } else {
                        // 模型直接回答，没有调用工具
                        console.log('模型直接回答，没有调用工具');
                        const assistantResponse = assistantMessage.content;
                        
                        // 将助手回复添加到历史
                        addToConversationHistory(sessionId, 'assistant', assistantResponse);
                        
                        return assistantResponse;
                    }
                } catch (error) {
                    console.error('调用模型错误:', error);
                    return `调用模型时出错: ${error.message}`;
                }
            } else {
                console.log('没有可用工具，直接调用大模型');
                // 没有可用工具，直接调用大模型
                try {
                    // 使用完整的对话历史
                    const completion = await openaiClient.chat.completions.create({
                        messages: messages,
                        model: modelName,
                    });
                    
                    const assistantResponse = completion.choices[0].message.content;
                    
                    // 将助手回复添加到历史
                    addToConversationHistory(sessionId, 'assistant', assistantResponse);
                    
                    return assistantResponse;
                } catch (error) {
                    console.error('调用模型错误:', error);
                    return `调用模型时出错: ${error.message}`;
                }
            }
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
    config.openaiApiKey = '';
    openaiClient = null;
}

/**
 * 清理资源
 */
function cleanup() {
    if (serverProcess) {
        serverProcess.kill();
    }
    
    if (rl) {
        rl.close();
    }
}

/**
 * 管理对话历史
 * @param {string} sessionId - 会话ID
 * @param {string} role - 消息角色 ('user', 'assistant', 'system')
 * @param {string} content - 消息内容
 */
function addToConversationHistory(sessionId, role, content) {
    // 如果会话不存在，初始化一个新会话
    if (!conversationHistory[sessionId]) {
        conversationHistory[sessionId] = [];
    }
    
    // 添加消息到历史记录
    conversationHistory[sessionId].push({ role, content });
    
    console.log(`添加到会话[${sessionId}]历史: role=${role}, content长度=${content.length}`);
}

/**
 * 获取指定会话的对话历史
 * @param {string} sessionId - 会话ID
 * @returns {Array} 对话历史消息数组
 */
function getConversationHistory(sessionId) {
    return conversationHistory[sessionId] || [];
}

/**
 * 清除指定会话的对话历史
 * @param {string} sessionId - 会话ID
 */
function clearConversationHistory(sessionId) {
    if (sessionId === 'all') {
        // 清空所有会话历史
        conversationHistory = {};
        console.log('已清空所有会话历史');
    } else {
        // 清空指定会话历史
        if (conversationHistory[sessionId]) {
            delete conversationHistory[sessionId];
            console.log(`已清空会话[${sessionId}]历史`);
        }
    }
}

/**
 * 获取当前配置
 * @returns {Object} 当前配置对象的副本
 */
function getConfig() {
    // 返回配置的副本而不是直接引用，以防止外部修改
    return { ...config };
}

// 导出模块接口
module.exports = {
    updateConfig,
    handleAgentQuery,
    clearApiKeys,
    connectToServer,
    cleanup,
    listTools,  // 导出获取工具列表的函数
    callTool,   // 导出调用工具的函数
    addToConversationHistory,  // 导出对话历史管理函数
    getConversationHistory,    // 导出获取对话历史函数
    clearConversationHistory,  // 导出清除对话历史函数
    setCurrentSessionId: (id) => { currentSessionId = id; },  // 设置当前会话ID的函数
    getConfig  // 导出获取配置的函数
};