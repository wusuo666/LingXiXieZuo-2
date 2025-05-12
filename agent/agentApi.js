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
    
    if (newConfig.provider !== undefined) {
        config.provider = newConfig.provider;
        console.log('已更新AI提供商:', newConfig.provider);
    }
    
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
 * @returns {Promise<void>}
 */
async function connectToServer(serverScriptPath) {
    if (!serverScriptPath) return;
    
    const isPython = serverScriptPath.endsWith('.py');
    const isJs = serverScriptPath.endsWith('.js');
    
    if (!(isPython || isJs)) {
        throw new Error('服务器脚本必须是.py或.js文件');
    }
    
    const command = isPython ? 'python' : 'node';
    
    // 启动服务器进程
    serverProcess = spawn(command, [serverScriptPath]);
    
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
 * @returns {Promise<string>} 处理结果
 */
async function handleAgentQuery(query) {
    console.log(`处理查询: ${query}`);
    console.log(`当前提供商: ${config.provider}`);
    
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
    
    try {
        if (config.provider === 'zhipuai') {
            // 使用智谱AI
            if (!config.zhipuApiKey) {
                console.log('智谱API Key未设置，返回错误信息');
                return "请先在设置中配置智谱AI的API Key";
            }
            
            const headers = getZhipuAIHeaders();
            const requestData = {
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
            
            console.log(`向智谱AI发送请求: ${config.zhipuBaseUrl}`);
            const response = await axios.post(config.zhipuBaseUrl, requestData, { headers });
            
            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content;
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
                openaiClient = initOpenAIClient();
            }
            
            const modelName = config.provider === 'deepseek' ? config.deepseekModel : config.model;
            console.log(`向${config.provider}发送请求，使用模型: ${modelName}`);
            
            const messages = [{ role: 'user', content: query }];
            
            // 检查是否有可用的工具
            if (availableTools && availableTools.length > 0) {
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
                
                // 第一步：调用模型决定是否调用工具
                const response = await openaiClient.chat.completions.create({
                    model: modelName,
                    messages,
                    tools: tools
                });
                
                const content = response.choices[0];
                
                // 如果模型决定调用工具
                if (content.finish_reason === 'tool_calls' && content.message.tool_calls) {
                    const toolCall = content.message.tool_calls[0];
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
                    
                    // 将模型返回和工具执行结果存入messages
                    messages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: toolCall.id,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: JSON.stringify(toolArgs)
                            }
                        }]
                    });
                    
                    messages.push({
                        role: 'tool',
                        content: result.content?.[0]?.text || '工具未返回任何内容',
                        tool_call_id: toolCall.id
                    });
                    
                    // 第二步：将结果返回给大模型生成最终回答
                    try {
                        const finalResponse = await openaiClient.chat.completions.create({
                            model: modelName,
                            messages
                        });
                        
                        return finalResponse.choices[0].message.content;
                    } catch (error) {
                        console.error(`最终响应错误: ${error.message}`);
                        return `生成最终回答时出错: ${error.message}`;
                    }
                }
                
                // 如果模型直接回答没有调用工具
                return content.message.content;
            } else {
                // 没有可用工具，直接调用大模型
                const completion = await openaiClient.chat.completions.create({
                    messages: [
                        { role: "system", content: "你是一位专业的编程助手，擅长回答编程相关问题和解释代码。" },
                        { role: "user", content: query }
                    ],
                    model: modelName,
                });
                
                return completion.choices[0].message.content;
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

// 导出模块接口
module.exports = {
    updateConfig,
    handleAgentQuery,
    clearApiKeys,
    connectToServer,
    cleanup
};