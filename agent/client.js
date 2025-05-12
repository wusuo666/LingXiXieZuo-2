import { spawn } from 'child_process';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

// 加载环境变量
dotenv.config();

/**
 * MCP客户端类，负责与MCP服务器通信及调用OpenAI API
 */
export class MCPClient {
  constructor() {
    // 初始化配置和状态
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.baseUrl = process.env.BASE_URL;
    this.model = process.env.MODEL;
    
    if (!this.openaiApiKey) {
      throw new Error('❌ 未找到OpenAI API Key，请在.env文件中设置OPENAI_API_KEY');
    }
    
    // 创建OpenAI客户端
    this.client = new OpenAI({
      apiKey: this.openaiApiKey,
      baseURL: this.baseUrl
    });
    
    this.serverProcess = null;
    this.rl = null;
    this.availableTools = [];
  }
  
  /**
   * 连接到MCP服务器并列出可用工具
   * @param {string} serverScriptPath - 服务器脚本路径
   * @returns {Promise<void>}
   */
  async connectToServer(serverScriptPath) {
    const isPython = serverScriptPath.endsWith('.py');
    const isJs = serverScriptPath.endsWith('.js');
    
    if (!(isPython || isJs)) {
      throw new Error('服务器脚本必须是.py或.js文件');
    }
    
    const command = isPython ? 'python' : 'node';
    
    // 启动服务器进程
    this.serverProcess = spawn(command, [serverScriptPath]);
    
    // 创建读写接口
    this.rl = readline.createInterface({
      input: this.serverProcess.stdout,
      output: this.serverProcess.stdin
    });
    
    // 处理错误
    this.serverProcess.stderr.on('data', (data) => {
      console.error(`服务器错误: ${data}`);
    });
    
    // 初始化与服务器的通信
    await this.initialize();
    
    // 列出可用工具
    const tools = await this.listTools();
    this.availableTools = tools;
    
    console.log('\n已连接到服务器，支持以下工具:', tools.map(tool => tool.name));
  }
  
  /**
   * 初始化与服务器的通信
   * @returns {Promise<object>} 初始化响应
   */
  async initialize() {
    const initMessage = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {},
      id: 1
    };
    
    return new Promise((resolve, reject) => {
      this.serverProcess.stdin.write(JSON.stringify(initMessage) + '\n');
      
      this.rl.once('line', (line) => {
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
  async listTools() {
    const listToolsMessage = {
      jsonrpc: '2.0',
      method: 'list_tools',
      params: {},
      id: 2
    };
    
    return new Promise((resolve, reject) => {
      this.serverProcess.stdin.write(JSON.stringify(listToolsMessage) + '\n');
      
      this.rl.once('line', (line) => {
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
  async callTool(toolName, args) {
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
      this.serverProcess.stdin.write(JSON.stringify(callToolMessage) + '\n');
      
      this.rl.once('line', (line) => {
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
   * 使用大模型处理查询并调用可用的MCP工具
   * @param {string} query - 用户查询
   * @returns {Promise<string>} 处理结果
   */
  async processQuery(query) {
    const messages = [{ role: 'user', content: query }];
    
    try {
      // 获取最新工具列表
      const tools = await this.listTools();
      this.availableTools = tools;
      
      // 转换为OpenAI工具格式
      const availableTools = this.availableTools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
      
      console.error('使用工具：', availableTools);
      
      // 第一步：调用模型决定是否调用工具
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: availableTools
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
        
        console.error(`调用工具: ${toolName}, 参数:`, toolArgs);
        
        // 执行工具调用
        let result;
        try {
          result = await this.callTool(toolName, toolArgs);
          console.error('工具调用结果:', result);
        } catch (error) {
          console.error(`工具调用错误: ${error.message}`);
          result = { content: [{ type: 'text', text: `工具调用失败: ${error.message}` }] };
        }
        
        console.log(`\n\n[调用工具 ${toolName} 参数 ${JSON.stringify(toolArgs)}]\n\n`);
        
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
          const finalResponse = await this.client.chat.completions.create({
            model: this.model,
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
    } catch (error) {
      console.error(`处理查询错误: ${error.message}`);
      return `处理查询时出错: ${error.message}`;
    }
  }
  
  /**
   * 运行交互式聊天循环
   * @returns {Promise<void>}
   */
  async chatLoop() {
    console.log('\nMCP客户端已启动！输入"quit"退出');
    
    const userRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    while (true) {
      const query = await new Promise(resolve => {
        userRl.question('\n你: ', (answer) => {
          resolve(answer.trim());
        });
      });
      
      if (query.toLowerCase() === 'quit') {
        break;
      }
      
      try {
        const response = await this.processQuery(query);
        console.log(`\n🤖 Agent: ${response}`);
      } catch (error) {
        console.error(`\n⚠️ 发生错误: ${error.message}`);
      }
    }
    
    userRl.close();
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
    
    if (this.rl) {
      this.rl.close();
    }
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('用法: node client.js <服务器脚本路径>');
    process.exit(1);
  }
  
  const client = new MCPClient();
  
  try {
    await client.connectToServer(args[0]);
    await client.chatLoop();
  } catch (error) {
    console.error(`启动错误: ${error.message}`);
  } finally {
    client.cleanup();
  }
}

// 如果直接运行此文件
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
} 