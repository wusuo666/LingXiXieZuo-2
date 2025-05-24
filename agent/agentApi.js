const axios = require('axios');
const vscode = require('vscode');
const { OpenAI } = require('openai'); // 保留OpenAI SDK仅用于兼容DeepSeek API
const { spawn } = require('child_process');
const readline = require('readline');
const { fileURLToPath } = require('url');

/**
 * 大模型API调用模块
 * 负责处理与DeepSeek平台的通信，发送请求并处理响应
 */

// 默认配置
let config = {
    // DeepSeek配置
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    deepseekBaseUrl: 'https://api.deepseek.com',
    
    // 当前使用的模型提供商: 'deepseek'
    provider: 'deepseek',
    
    // 其他配置
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2000
};

// DeepSeek客户端实例
let deepseekClient = null;
let serverProcess = null;
let rl = null;
let availableTools = [];

// 添加对话历史管理
let conversationHistory = {}; // 用于存储不同会话的对话历史
let currentSessionId = 'default'; // 默认会话ID

/**
 * 初始化DeepSeek客户端
 * @returns {OpenAI} DeepSeek客户端实例(使用OpenAI兼容接口)
 */
function initDeepSeekClient() {
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
    console.log('更新API配置:', JSON.stringify(newConfig, null, 2));
    
    // 处理apiKey
    if (newConfig.apiKey !== undefined) {
        config.deepseekApiKey = newConfig.apiKey;
        console.log('已更新DeepSeek API Key');
    }
    
    // 单独处理 deepseekApiKey
    if (newConfig.deepseekApiKey !== undefined) {
        config.deepseekApiKey = newConfig.deepseekApiKey;
        console.log('已直接更新DeepSeek API Key:', config.deepseekApiKey ? '已设置' : '未设置');
    }
    
    // 处理model
    if (newConfig.model !== undefined) {
        config.deepseekModel = newConfig.model;
        console.log('已更新DeepSeek模型:', newConfig.model);
    }
    
    // 处理deepseekModel
    if (newConfig.deepseekModel !== undefined) {
        config.deepseekModel = newConfig.deepseekModel;
        console.log('已直接更新DeepSeek模型:', newConfig.deepseekModel);
    }
    
    // 重置客户端
    deepseekClient = null;
    console.log('已重置客户端');
    
    // 打印当前配置状态
    console.log('当前DeepSeek模型:', config.deepseekModel);
    console.log('DeepSeek API Key是否已设置:', !!config.deepseekApiKey);
    console.log('DeepSeek API Key长度:', config.deepseekApiKey ? config.deepseekApiKey.length : 0);
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
    console.log(`当前会话ID: ${sessionId}`);
    
    // 打印当前配置状态
    console.log('当前DeepSeek模型:', config.deepseekModel);
    console.log('DeepSeek API Key是否已设置:', !!config.deepseekApiKey);
    console.log('DeepSeek API Key长度:', config.deepseekApiKey ? config.deepseekApiKey.length : 0);
    
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
        // 使用DeepSeek
        if (!config.deepseekApiKey) {
            console.log('DeepSeek API Key未设置，返回错误信息');
            return "请先在设置中配置DeepSeek的API Key";
        }
        
        if (!deepseekClient) {
            try {
                deepseekClient = initDeepSeekClient();
                console.log('成功初始化DeepSeek客户端');
            } catch (error) {
                console.error('初始化DeepSeek客户端失败:', error);
                return `初始化客户端失败: ${error.message}`;
            }
        }
        
        const modelName = config.deepseekModel;
        console.log(`向DeepSeek发送请求，使用模型: ${modelName}`);
        
        // 获取对话历史
        let messages = getConversationHistory(sessionId);
        
        // 如果历史为空且是新对话，添加系统消息
        if (messages.length === 0) {
            messages.push({
                role: 'system',
                content: `你是灵犀协作的AI绘图助手，专精于Excalidraw图形设计。你可以帮助用户创建和管理流程图、思维导图、组织结构图等图形内容。

使用建议:
1. 坐标以画布左上角为原点(0,0)，向右为x轴正方向，向下为y轴正方向
2. 思维导图、流程图、组织结构图等的节点建议先添加基础形状，再用线条和箭头连接对应靠近的两个边框的中心点。
3. 创建边框前一定要先读取画布的元素信息，确保边框能够覆盖到需要分组的元素。

请用简洁专业的方式回答用户问题，理解用户意图，并推荐适合的工具组合来实现用户目标。提供具体的参数建议，并在可能的情况下提供图形布局的最佳实践。`
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
            
            // 将工具转换为工具格式
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
                console.log('使用DeepSeek Function Calling');
                
                const response = await deepseekClient.chat.completions.create({
                    model: modelName,
                    messages,
                    tools,
                    // 确保设置了正确的参数
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                    top_p: config.topP
                });
                
                console.log('DeepSeek响应状态:', response.choices[0].finish_reason);
                
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
                    
                    // 第二步：将结果返回给大模型生成最终回答或继续调用工具
                    console.log('第二次调用模型，生成最终回答或继续调用工具');
                    try {
                        // 循环处理可能的多轮工具调用，直到获得最终回答
                        let hasFinalAnswer = false;
                        let finalResponse = null;
                        let callCount = 1;

                        while (!hasFinalAnswer) {
                            // DeepSeek的模型调用
                            const response = await deepseekClient.chat.completions.create({
                                model: modelName,
                                messages,
                                temperature: config.temperature,
                                max_tokens: config.maxTokens,
                                top_p: config.topP,
                                tools: tools // 继续传入工具列表，以便模型可以多次调用工具
                            });
                            
                            callCount++;
                            console.log(`第${callCount}轮调用模型，结果:`, response.choices[0].finish_reason);
                            
                            const assistantMessage = response.choices[0].message;
                            messages.push(assistantMessage);
                            
                            // 检查是否继续需要调用工具
                            if (response.choices[0].finish_reason === 'tool_calls' && 
                                assistantMessage.tool_calls && 
                                assistantMessage.tool_calls.length > 0) {
                                
                                console.log(`模型继续请求工具调用，第${callCount}轮工具调用`);
                                
                                // 处理每个工具调用
                                for (const toolCall of assistantMessage.tool_calls) {
                                    const toolName = toolCall.function.name;
                                    let toolArgs;
                                    
                                    try {
                                        toolArgs = JSON.parse(toolCall.function.arguments);
                                    } catch (error) {
                                        console.error(`解析工具参数错误: ${error.message}`);
                                        messages.push({
                                            role: 'tool',
                                            tool_call_id: toolCall.id,
                                            content: `解析工具参数时出错: ${error.message}`
                                        });
                                        continue;
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
                            } else {
                                // 模型提供了最终回答，不再需要调用工具
                                console.log('模型生成了最终回答');
                                hasFinalAnswer = true;
                                finalResponse = assistantMessage.content;
                            }
                            
                            // 安全措施：防止无限循环，限制最多10轮工具调用
                            if (callCount > 15) {
                                console.log('达到最大工具调用次数限制(15)，强制结束');
                                if (!finalResponse) {
                                    finalResponse = "由于工具调用次数过多，系统自动结束了对话。请尝试将您的请求分解为更小的步骤。";
                                }
                                break;
                            }
                        }
                        
                        // 将助手回复添加到历史
                        addToConversationHistory(sessionId, 'assistant', finalResponse);
                        
                        return finalResponse;
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
                const completion = await deepseekClient.chat.completions.create({
                    messages: messages,
                    model: modelName,
                    temperature: config.temperature,
                    max_tokens: config.maxTokens,
                    top_p: config.topP
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
    } catch (error) {
        console.error('Agent查询处理失败:', error);
        return `处理查询时出错: ${error.message}`;
    }
}

/**
 * 清除API Key，使用户需要在下次启动时重新输入
 */
function clearApiKeys() {
    config.deepseekApiKey = '';
    deepseekClient = null;
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

/**
 * 使用 DeepSeek V3 对会议纪要进行总结
 * @param {string} memoText 会议纪要原文
 * @returns {Promise<string>} 总结结果
 */
async function summarizeMemoWithDeepseek(memoText) {
    if (!config.deepseekApiKey) {
        throw new Error('未配置DeepSeek API Key');
    }
    if (!memoText || typeof memoText !== 'string') {
        throw new Error('无效的会议纪要内容');
    }
    const prompt = `请对以下会议纪要内容进行总结，要求简明扼要、条理清晰：\n${memoText}`;
    const client = deepseekClient || initDeepSeekClient();
    try {
        const completion = await client.chat.completions.create({
            model: config.deepseekModel || 'deepseek-chat',
            messages: [
                { role: 'system', content: '你是一名会议纪要总结助手。' },
                { role: 'user', content: prompt }
            ],
            temperature: config.temperature,
            top_p: config.topP,
            max_tokens: config.maxTokens
        });
        const result = completion.choices?.[0]?.message?.content || '';
        return result.trim();
    } catch (e) {
        throw new Error('调用DeepSeek总结失败: ' + (e.message || e.toString()));
    }
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
    getConfig,  // 导出获取配置的函数
    summarizeMemoWithDeepseek
};