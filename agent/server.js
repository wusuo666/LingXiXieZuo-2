const axios = require('axios');
// const dotenv = require('dotenv');
const { fileURLToPath } = require('url');
const fs = require('fs').promises;
const path = require('path');


// 注释掉环境变量加载
// dotenv.config();

// 初始化全局变量存储Excalidraw目录路径
let EXCALIDRAW_DIR = '';

/**
 * 设置Excalidraw目录路径
 * @param {string} dirPath - Excalidraw目录路径
 */
function setExcalidrawDir(dirPath) {
  console.error(`设置Excalidraw目录: ${dirPath}`);
  EXCALIDRAW_DIR = dirPath;
}

/**
 * MCP 服务器类，管理JSON-RPC通信和工具
 */
class FastMCP {
  /**
   * 创建新的MCP服务器实例
   * @param {string} serverName - 服务器名称
   */
  constructor(serverName) {
    this.serverName = serverName;
    this.tools = {};
    this.nextId = 1;
  }

  /**
   * 工具装饰器，用于注册工具函数
   * @returns {Function} 装饰器函数
   */
  tool() {
    return (target) => {
      const toolName = target.name;
      this.tools[toolName] = target;
      return target;
    };
  }

  /**
   * 处理JSON-RPC请求
   * @param {object} request - JSON-RPC请求对象
   * @returns {object} JSON-RPC响应对象
   */
  async handleRequest(request) {
    const { method, params, id } = request;
    
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        result: {
          serverInfo: {
            name: this.serverName,
            version: '1.0.0'
          }
        },
        id
      };
    }
    
    if (method === 'list_tools') {
      const tools = Object.entries(this.tools).map(([name, fn]) => {
        // 优先使用函数上定义的参数信息
        if (fn.parameters) {
          return {
            name,
            description: fn.description || `执行${name}工具`,
            inputSchema: fn.parameters
          };
        }
        
        // 回退到参数解析方法
        const params = {};
        
        // 提取函数参数信息
        const fnStr = fn.toString();
        const paramMatch = fnStr.match(/async\s+\w+\s*\(\s*([^)]*)\s*\)/);
        
        if (paramMatch && paramMatch[1]) {
          const paramNames = paramMatch[1].split(',').map(p => p.trim());
          paramNames.forEach(paramName => {
            if (paramName) {
              params[paramName] = { type: 'string' };
            }
          });
        }
        
        return {
          name,
          description: fn.description || `执行${name}工具`,
          inputSchema: {
            type: 'object',
            properties: params,
            required: Object.keys(params)
          }
        };
      });
      
      return {
        jsonrpc: '2.0',
        result: { tools },
        id
      };
    }
    
    if (method === 'call_tool') {
      const { name, input } = params;
      const tool = this.tools[name];
      
      if (!tool) {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `未找到工具: ${name}`
          },
          id
        };
      }
      
      try {
        // 使用stderr而不是stdout进行调试
        console.error(`调用工具 ${name}，参数:`, input);

        // 如果工具有parameters属性，使用指定的参数名
        let result;
        if (tool.parameters && tool.parameters.properties) {
          const paramNames = Object.keys(tool.parameters.properties);
          if (paramNames.length === 1) {
            // 如果只有一个参数，直接传递
            result = await tool(input[paramNames[0]]);
          } else {
            // 多个参数，按顺序传递
            result = await tool(...paramNames.map(p => input[p]));
          }
        } else {
          // 回退到旧方法
          result = await tool(...Object.values(input));
        }

        return {
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: result
              }
            ]
          },
          id
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `工具执行错误: ${error.message}`
          },
          id
        };
      }
    }
    
    return {
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `未知方法: ${method}`
      },
      id
    };
  }

  /**
   * 运行MCP服务器
   * @param {object} options - 服务器选项
   */
  run(options = {}) {
    const { transport = 'stdio' } = options;
    
    if (transport === 'stdio') {
      // 使用标准输入输出进行通信
      process.stdin.setEncoding('utf8');
      
      const handleLine = async (line) => {
        try {
          const request = JSON.parse(line);
          const response = await this.handleRequest(request);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
          const errorResponse = {
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: `解析错误: ${error.message}`
            },
            id: this.nextId++
          };
          process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
      };
      
      // 逐行处理输入
      let buffer = '';
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的一行
        
        for (const line of lines) {
          if (line.trim()) {
            handleLine(line);
          }
        }
      });
    } else {
      throw new Error(`不支持的传输方式: ${transport}`);
    }
  }
}

// 初始化MCP服务器
const mcp = new FastMCP('ExcalidrawServer');

// 模拟Excalidraw存储位置
// const EXCALIDRAW_DIR = vscode.workspace.workspaceFolders[0].uri.path;
const DEFAULT_TEMPLATES = {
  '空白画布': {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: 20
    }
  },
  '基础图形': {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'rectangle1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 42,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'ellipse1',
        type: 'ellipse',
        x: 400,
        y: 100,
        width: 150,
        height: 100,
        angle: 0,
        strokeColor: '#1864ab',
        backgroundColor: '#a5d8ff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 43,
        version: 1,
        versionNonce: 1
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: 20
    }
  },
  '流程图': {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'start-box',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#4c6ef5',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 1234,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'start-text',
        type: 'text',
        x: 150,
        y: 130,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 1235,
        version: 1,
        versionNonce: 1,
        text: '开始',
        fontSize: 20,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'end-box',
        type: 'rectangle',
        x: 100,
        y: 300,
        width: 200,
        height: 80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#fa5252',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 1236,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'end-text',
        type: 'text',
        x: 150,
        y: 330,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 1237,
        version: 1,
        versionNonce: 1,
        text: '结束',
        fontSize: 20,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'arrow1',
        type: 'arrow',
        x: 199,
        y: 180,
        width: 1,
        height: 120,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 1238,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [1, 120]
        ],
        startBinding: {
          elementId: 'start-box',
          focus: 0.5,
          gap: 1
        },
        endBinding: {
          elementId: 'end-box',
          focus: 0.5,
          gap: 1
        }
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: 20
    }
  },
  '思维导图': {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'central-topic',
        type: 'ellipse',
        x: 400,
        y: 250,
        width: 200,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#4c6ef5',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2000,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'central-text',
        type: 'text',
        x: 450,
        y: 290,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2001,
        version: 1,
        versionNonce: 1,
        text: '中心主题',
        fontSize: 20,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'topic1',
        type: 'rectangle',
        x: 150,
        y: 150,
        width: 150,
        height: 60,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#82c91e',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2002,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'topic1-text',
        type: 'text',
        x: 175,
        y: 170,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2003,
        version: 1,
        versionNonce: 1,
        text: '主题一',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'topic2',
        type: 'rectangle',
        x: 700,
        y: 150,
        width: 150,
        height: 60,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#fa5252',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2004,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'topic2-text',
        type: 'text',
        x: 725,
        y: 170,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2005,
        version: 1,
        versionNonce: 1,
        text: '主题二',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'topic3',
        type: 'rectangle',
        x: 150,
        y: 350,
        width: 150,
        height: 60,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#15aabf',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2006,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'topic3-text',
        type: 'text',
        x: 175,
        y: 370,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2007,
        version: 1,
        versionNonce: 1,
        text: '主题三',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'topic4',
        type: 'rectangle',
        x: 700,
        y: 350,
        width: 150,
        height: 60,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#a61e4d',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2008,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'topic4-text',
        type: 'text',
        x: 725,
        y: 370,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2009,
        version: 1,
        versionNonce: 1,
        text: '主题四',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'line1',
        type: 'line',
        x: 300,
        y: 180,
        width: 100,
        height: 80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2010,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [100, 80]
        ]
      },
      {
        id: 'line2',
        type: 'line',
        x: 600,
        y: 260,
        width: 100,
        height: -80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2011,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [100, -80]
        ]
      },
      {
        id: 'line3',
        type: 'line',
        x: 400,
        y: 300,
        width: -100,
        height: 80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2012,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [-100, 80]
        ]
      },
      {
        id: 'line4',
        type: 'line',
        x: 600,
        y: 300,
        width: 100,
        height: 80,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 2013,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [100, 80]
        ]
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: 20
    }
  },
  '组织结构图': {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'ceo-box',
        type: 'rectangle',
        x: 400,
        y: 50,
        width: 200,
        height: 60,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#4c6ef5',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3000,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'ceo-text',
        type: 'text',
        x: 450,
        y: 70,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3001,
        version: 1,
        versionNonce: 1,
        text: '总经理',
        fontSize: 18,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'vp1-box',
        type: 'rectangle',
        x: 200,
        y: 200,
        width: 180,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#15aabf',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3002,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'vp1-text',
        type: 'text',
        x: 240,
        y: 215,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3003,
        version: 1,
        versionNonce: 1,
        text: '技术副总',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'vp2-box',
        type: 'rectangle',
        x: 600,
        y: 200,
        width: 180,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#15aabf',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3004,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'vp2-text',
        type: 'text',
        x: 640,
        y: 215,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3005,
        version: 1,
        versionNonce: 1,
        text: '市场副总',
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'mgr1-box',
        type: 'rectangle',
        x: 100,
        y: 350,
        width: 150,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#82c91e',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3006,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'mgr1-text',
        type: 'text',
        x: 125,
        y: 365,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3007,
        version: 1,
        versionNonce: 1,
        text: '研发经理',
        fontSize: 14,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'mgr2-box',
        type: 'rectangle',
        x: 330,
        y: 350,
        width: 150,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#82c91e',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3008,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'mgr2-text',
        type: 'text',
        x: 355,
        y: 365,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3009,
        version: 1,
        versionNonce: 1,
        text: '测试经理',
        fontSize: 14,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'mgr3-box',
        type: 'rectangle',
        x: 520,
        y: 350,
        width: 150,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#82c91e',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3010,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'mgr3-text',
        type: 'text',
        x: 545,
        y: 365,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3011,
        version: 1,
        versionNonce: 1,
        text: '销售经理',
        fontSize: 14,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'mgr4-box',
        type: 'rectangle',
        x: 750,
        y: 350,
        width: 150,
        height: 50,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: '#82c91e',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3012,
        version: 1,
        versionNonce: 1
      },
      {
        id: 'mgr4-text',
        type: 'text',
        x: 775,
        y: 365,
        width: 100,
        height: 25,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3013,
        version: 1,
        versionNonce: 1,
        text: '客服经理',
        fontSize: 14,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        id: 'arrow1',
        type: 'arrow',
        x: 499,
        y: 110,
        width: 1,
        height: 90,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3014,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [-210, 90]
        ]
      },
      {
        id: 'arrow2',
        type: 'arrow',
        x: 501,
        y: 110,
        width: 1,
        height: 90,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3015,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [190, 90]
        ]
      },
      {
        id: 'arrow3',
        type: 'arrow',
        x: 290,
        y: 250,
        width: 1,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3016,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [-115, 100]
        ]
      },
      {
        id: 'arrow4',
        type: 'arrow',
        x: 290,
        y: 250,
        width: 1,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3017,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [115, 100]
        ]
      },
      {
        id: 'arrow5',
        type: 'arrow',
        x: 690,
        y: 250,
        width: 1,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3018,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [-95, 100]
        ]
      },
      {
        id: 'arrow6',
        type: 'arrow',
        x: 690,
        y: 250,
        width: 1,
        height: 100,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        seed: 3019,
        version: 1,
        versionNonce: 1,
        points: [
          [0, 0],
          [135, 100]
        ]
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1,
      gridSize: 20
    }
  }
};

/**
 * 确保Excalidraw文件目录存在
 * @returns {Promise<void>}
 */
async function ensureExcalidrawDir() {
  try {
    // 如果目录路径为空，使用临时目录
    if (!EXCALIDRAW_DIR || EXCALIDRAW_DIR.trim() === '') {
      const tempDir = path.join(require('os').tmpdir(), 'excalidraw_files');
      console.error(`EXCALIDRAW_DIR未设置，使用临时目录: ${tempDir}`);
      EXCALIDRAW_DIR = tempDir;
    }
    
    // 输出调试信息
    console.error(`尝试创建目录: ${EXCALIDRAW_DIR}`);
    
    // 处理路径中的特殊字符
    let dirToCreate = EXCALIDRAW_DIR;
    if (dirToCreate.startsWith('/c%3A/')) {
      // 替换Windows路径编码
      dirToCreate = dirToCreate.replace('/c%3A/', 'C:/');
      console.error(`处理后的路径: ${dirToCreate}`);
    }
    
    // 创建目录（递归）
    await fs.mkdir(dirToCreate, { recursive: true });
    console.error(`Excalidraw目录已确认: ${dirToCreate}`);
  } catch (error) {
    console.error(`创建Excalidraw目录失败: ${error.message}`);
    // 尝试创建临时目录作为备选
    try {
      const backupDir = path.join(require('os').tmpdir(), 'excalidraw_backup');
      console.error(`尝试使用备选临时目录: ${backupDir}`);
      await fs.mkdir(backupDir, { recursive: true });
      EXCALIDRAW_DIR = backupDir;
      console.error(`已改用备选目录: ${EXCALIDRAW_DIR}`);
    } catch (backupError) {
      console.error(`创建备选目录也失败了: ${backupError.message}`);
      throw error; // 如果备选方案也失败，抛出原始错误
    }
  }
}

/**
 * 创建新的Excalidraw画布
 * @param {string} name - 画布名称
 * @param {string} template - 模板名称 (可选)
 * @returns {Promise<string>} 创建结果
 */
async function createCanvas(name, template = '空白画布') {
  console.error(`开始创建画布，名称: ${name}, 模板: ${template}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 检查文件是否已存在
    const fileName = `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    try {
      await fs.access(filePath);
      return `⚠️ 画布 ${name} 已存在，请使用不同名称或使用 editCanvas 工具编辑`;
    } catch {
      // 文件不存在，可以继续创建
    }
    
    // 检查模板是否有效
    if (!DEFAULT_TEMPLATES[template]) {
      return `⚠️ 模板 ${template} 不存在，可用模板: ${Object.keys(DEFAULT_TEMPLATES).join(', ')}`;
    }
    
    // 创建基于模板的新画布，确保数据格式正确
    const templateData = DEFAULT_TEMPLATES[template];
    
    // 确保每个元素都有必要的属性
    if (templateData.elements) {
      templateData.elements.forEach(element => {
        // 确保每个元素都有id
        if (!element.id) {
          element.id = `gen-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        }
        
        // 确保每个元素都有version和versionNonce
        if (!element.version) {
          element.version = 1;
        }
        if (!element.versionNonce) {
          element.versionNonce = Math.floor(Math.random() * 1000);
        }
        
        // 确保每个元素都有seed
        if (!element.seed) {
          element.seed = Math.floor(Math.random() * 10000);
        }
        
        // 确保每个元素都有angle
        if (element.angle === undefined) {
          element.angle = 0;
        }
      });
    }
    
    // 确保appState包含必要的字段
    if (!templateData.appState) {
      templateData.appState = {};
    }
    
    if (!templateData.appState.theme) {
      templateData.appState.theme = 'light';
    }
    
    if (!templateData.appState.viewBackgroundColor) {
      templateData.appState.viewBackgroundColor = '#ffffff';
    }
    
    if (!templateData.appState.gridSize) {
      templateData.appState.gridSize = 20;
    }
    
    // 确保基本结构完整
    const canvasData = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: templateData.elements || [],
      appState: templateData.appState,
      files: {}
    };
    
    console.error(`画布数据准备完成，包含 ${canvasData.elements.length} 个元素`);
    
    // 写入文件，确保格式正确
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`画布创建成功: ${filePath}`);
    return `✅ 成功创建画布 ${name}\n💾 文件保存在: ${filePath}\n📐 使用模板: ${template}，接下来可以用getCanvasDetails获取新建画布的元素信息`;
  } catch (error) {
    console.error(`创建画布失败: ${error.message}`);
    return `❌ 创建画布失败: ${error.message}`;
  }
}

/**
 * 列出所有Excalidraw画布
 * @returns {Promise<string>} 画布列表
 */
async function listCanvases() {
  console.error(`开始列出画布`);
  
  try {
    await ensureExcalidrawDir();
    
    const files = await fs.readdir(EXCALIDRAW_DIR);
    const excalidrawFiles = files.filter(file => 
      file.endsWith('.excalidraw') || 
      file.endsWith('.excalidraw.json') || 
      file.endsWith('.excalidraw.svg') || 
      file.endsWith('.excalidraw.png')
    );
    
    if (excalidrawFiles.length === 0) {
      return `📂 当前没有Excalidraw画布文件`;
    }
    
    // 获取文件信息
    const fileInfoPromises = excalidrawFiles.map(async (file) => {
      const filePath = path.join(EXCALIDRAW_DIR, file);
      const stats = await fs.stat(filePath);
      return {
        name: file,
        size: stats.size,
        modified: stats.mtime
      };
    });
    
    const fileInfos = await Promise.all(fileInfoPromises);
    
    // 格式化输出
    let result = `📋 Excalidraw画布列表 (共${excalidrawFiles.length}个):\n\n`;
    fileInfos.forEach((info, index) => {
      result += `${index + 1}. 📄 ${info.name}\n`;
      result += `   📅 修改时间: ${info.modified.toLocaleString()}\n`;
      result += `   📊 文件大小: ${formatFileSize(info.size)}\n\n`;
    });
    
    console.error(`画布列表生成完成，找到${excalidrawFiles.length}个文件`);
    return result;
  } catch (error) {
    console.error(`列出画布失败: ${error.message}`);
    return `❌ 列出画布失败: ${error.message}`;
  }
}

/**
 * 格式化文件大小为人类可读格式
 * @param {number} bytes - 文件字节大小
 * @returns {string} 格式化后的文件大小
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 导出画布为图像格式
 * @param {string} name - 画布名称
 * @param {string} format - 导出格式 (svg)
 * @param {boolean} withBackground - 是否包含背景
 * @param {boolean} withDarkMode - 是否使用暗色模式
 * @param {number} exportScale - 导出缩放比例
 * @returns {Promise<string>} 操作结果
 */
async function exportCanvas(name, format, withBackground = true, withDarkMode = false, exportScale = 1) {
  console.error(`开始导出画布，名称: ${name}, 格式: ${format}, 包含背景: ${withBackground}, 暗色模式: ${withDarkMode}, 缩放: ${exportScale}`);
  
  if (format !== 'svg') {
    return `⚠️ 无效的导出格式: ${format}，目前仅支持 svg 格式`;
  }
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 导出文件名
    const exportName = fileName.replace('.excalidraw', `.excalidraw.${format}`);
    const exportPath = path.join(EXCALIDRAW_DIR, exportName);
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch (e) {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容: ${e.message}`;
    }
    
    // 准备导出选项
    const exportOptions = {
      elements: canvasData.elements || [],
      appState: {
        ...canvasData.appState,
        exportWithDarkMode: withDarkMode,
        exportBackground: withBackground,
        exportScale: exportScale,
        viewBackgroundColor: withBackground ? (canvasData.appState?.viewBackgroundColor || '#ffffff') : 'transparent'
      }
    };
    
    try {
      // 使用备选方法生成SVG
      console.error(`正在生成SVG格式...`);
      
      // 使用简化的SVG生成方法
      const svgContent = generateSVG(exportOptions);
      await fs.writeFile(exportPath, svgContent, 'utf8');
      console.error(`SVG生成成功: ${exportPath}`);
    } catch (error) {
      console.error(`SVG生成失败: ${error.message}`);
      throw new Error(`SVG导出失败: ${error.message}`);
    }
    
    console.error(`画布导出成功: ${exportPath}`);
    return `✅ 成功导出画布 ${name} 为 SVG 格式
💾 导出文件: ${exportPath}
${withBackground ? '🎨 包含背景' : '🔍 透明背景'}
${withDarkMode ? '🌙 暗色模式' : '☀️ 亮色模式'}
📏 缩放比例: ${exportScale}x`;
  } catch (error) {
    console.error(`导出画布失败: ${error.message}`);
    return `❌ 导出画布失败: ${error.message}`;
  }
}

/**
 * 生成SVG格式内容 - 备选方法，不依赖外部库
 * @param {object} exportOptions - 导出选项
 * @returns {string} SVG内容
 */
function generateSVG(exportOptions) {
  console.error(`使用备选方法生成SVG...`);
  
  const { elements, appState } = exportOptions;
  const width = 800; // 默认宽度
  const height = 600; // 默认高度
  const backgroundColor = appState.viewBackgroundColor || '#ffffff';
  
  // 计算画布边界，以便适当缩放
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  elements.forEach(el => {
    if (el.x !== undefined && el.y !== undefined) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 0));
      maxY = Math.max(maxY, el.y + (el.height || 0));
    }
  });
  
  // 如果没有元素或无法计算边界，使用默认值
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
    minX = 0;
    minY = 0;
    maxX = width;
    maxY = height;
  }
  
  // 添加一些内边距
  const padding = 20;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  
  // 计算尺寸和视图框
  const svgWidth = maxX - minX;
  const svgHeight = maxY - minY;
  const viewBox = `${minX} ${minY} ${svgWidth} ${svgHeight}`;
  
  // 生成SVG元素
  const svgElements = elements.map(el => {
    let elementSvg = '';
    const id = el.id || `el-${Math.random().toString(36).substr(2, 9)}`;
    
    // 根据元素类型生成SVG
    switch (el.type) {
      case 'rectangle':
        elementSvg = `<rect id="${id}" x="${el.x}" y="${el.y}" width="${el.width || 100}" height="${el.height || 80}" 
          fill="${el.backgroundColor || 'none'}" stroke="${el.strokeColor || '#000'}" 
          stroke-width="${el.strokeWidth || 1}" />`;
        break;
      
      case 'ellipse':
        const cx = el.x + (el.width || 100) / 2;
        const cy = el.y + (el.height || 80) / 2;
        const rx = (el.width || 100) / 2;
        const ry = (el.height || 80) / 2;
        elementSvg = `<ellipse id="${id}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" 
          fill="${el.backgroundColor || 'none'}" stroke="${el.strokeColor || '#000'}" 
          stroke-width="${el.strokeWidth || 1}" />`;
        break;
      
      case 'diamond':
        // 使用多边形绘制菱形
        const diamondX = el.x;
        const diamondY = el.y;
        const diamondWidth = el.width || 100;
        const diamondHeight = el.height || 80;
        const points = `
          ${diamondX + diamondWidth/2},${diamondY} 
          ${diamondX + diamondWidth},${diamondY + diamondHeight/2} 
          ${diamondX + diamondWidth/2},${diamondY + diamondHeight} 
          ${diamondX},${diamondY + diamondHeight/2}
        `;
        elementSvg = `<polygon id="${id}" points="${points}" 
          fill="${el.backgroundColor || 'none'}" stroke="${el.strokeColor || '#000'}" 
          stroke-width="${el.strokeWidth || 1}" />`;
        break;
      
      case 'line':
      case 'arrow':
        // 简单的直线或箭头
        const isArrow = el.type === 'arrow';
        const startX = el.x;
        const startY = el.y;
        const endX = startX + (el.width || 100);
        const endY = startY + (el.height || 0);
        
        // 创建线条
        const linePath = `M ${startX} ${startY} L ${endX} ${endY}`;
        
        // 如果是箭头，添加箭头标记
        let arrowMarker = '';
        if (isArrow) {
          const markerId = `arrow-${id}`;
          arrowMarker = `
            <defs>
              <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" 
                markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="${el.strokeColor || '#000'}" />
              </marker>
            </defs>
          `;
          
          elementSvg = `${arrowMarker}
            <path id="${id}" d="${linePath}" fill="none" stroke="${el.strokeColor || '#000'}" 
              stroke-width="${el.strokeWidth || 1}" marker-end="url(#${markerId})" />`;
        } else {
          elementSvg = `<path id="${id}" d="${linePath}" fill="none" 
            stroke="${el.strokeColor || '#000'}" stroke-width="${el.strokeWidth || 1}" />`;
        }
        break;
      
      case 'text':
        // 文本元素
        elementSvg = `<text id="${id}" x="${el.x}" y="${el.y + 20}" font-family="Arial" 
          font-size="${el.fontSize || 20}" fill="${el.strokeColor || '#000'}">
          ${el.text || '[文本]'}
        </text>`;
        break;
      
      default:
        console.error(`不支持的元素类型: ${el.type}`);
        break;
    }
    
    return elementSvg;
  }).join('\n  ');
  
  // 将原始数据嵌入到SVG中，以便以后编辑
  const jsonData = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: elements,
    appState: {
      ...appState,
      exportWithDarkMode: appState.exportWithDarkMode,
      exportBackground: appState.exportBackground,
      exportScale: appState.exportScale
    }
  });
  const encodedData = Buffer.from(jsonData).toString('base64');
  
  // 创建完整的SVG文档
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${svgWidth}"
  height="${svgHeight}"
  viewBox="${viewBox}"
  version="1.1"
  style="background-color: ${backgroundColor};"
>
  <!-- 由LingXiXieZuo Excalidraw生成 -->
  ${svgElements}
  <desc>
    <!-- 原始Excalidraw数据 -->
    excalidraw.data:${encodedData}
  </desc>
</svg>`;
}

/**
 * 添加基本形状到画布
 * @param {string} name - 画布名称
 * @param {string} shapeType - 形状类型
 * @param {number} x - X坐标
 * @param {number} y - Y坐标 
 * @param {string} color - 颜色代码
 * @returns {Promise<string>} 操作结果
 */
async function addShape(name, shapeType, x, y, color) {
  console.error(`开始添加形状，画布: ${name}, 类型: ${shapeType}, 位置: (${x},${y}), 颜色: ${color}`);
  
  // 验证形状类型
  const validShapes = ['rectangle', 'ellipse', 'diamond', 'text'];
  if (!validShapes.includes(shapeType)) {
    return `⚠️ 无效的形状类型: ${shapeType}，有效类型: ${validShapes.join(', ')}`;
  }
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 创建新形状
    const newShape = {
      id: `shape-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: shapeType,
      x: parseInt(x),
      y: parseInt(y),
      width: 100,
      height: 80,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      seed: Math.floor(Math.random() * 10000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000)
    };
    
    // 根据形状类型调整属性
    if (shapeType === 'text') {
      newShape.text = '双击编辑文本';
      newShape.fontSize = 20;
      newShape.fontFamily = 1;
      newShape.textAlign = 'center';
      newShape.verticalAlign = 'middle';
    }
    
    // 添加到画布
    canvasData.elements.push(newShape);
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`形状添加成功: ${filePath}`);
    return `✅ 成功添加 ${shapeType} 形状到画布 ${name}\n📍 位置: (${x}, ${y})\n🎨 颜色: ${color}\n🆔 形状ID: ${newShape.id}`;
  } catch (error) {
    console.error(`添加形状失败: ${error.message}`);
    return `❌ 添加形状失败: ${error.message}`;
  }
}

/**
 * 导入Excalidraw公共库
 * @param {string} libraryUrl - 库URL或识别符
 * @param {string} canvasName - 要导入到的画布名称 (可选)
 * @returns {Promise<string>} 操作结果
 */
async function importLibrary(libraryUrl, canvasName = '') {
  console.error(`开始导入库，URL: ${libraryUrl}, 画布: ${canvasName || '(工作区库)'}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 检查URL格式，支持直接URL或预定义库标识符
    let libraryContent;
    if (libraryUrl.startsWith('http')) {
      // 从URL获取库内容
      try {
        const response = await axios.get(libraryUrl);
        libraryContent = response.data;
        console.error(`成功从URL获取库内容`);
      } catch (error) {
        return `⚠️ 无法从URL获取库内容: ${error.message}`;
      }
    } else {
      // 使用预定义库ID从Excalidraw公共库获取
      try {
        const response = await axios.get(`https://libraries.excalidraw.com/libraries/${libraryUrl}.excalidrawlib`);
        libraryContent = response.data;
        console.error(`成功从公共库获取: ${libraryUrl}`);
      } catch (error) {
        return `⚠️ 无法从公共库获取: ${error.message}`;
      }
    }
    
    // 验证库内容
    if (!libraryContent || typeof libraryContent !== 'object') {
      return `⚠️ 库内容无效，应为JSON对象`;
    }
    
    // 处理导入选项
    if (canvasName) {
      // 导入到指定画布
      const fileName = canvasName.endsWith('.excalidraw') ? canvasName : `${canvasName}.excalidraw`;
      const filePath = path.join(EXCALIDRAW_DIR, fileName);
      
      try {
        await fs.access(filePath);
      } catch {
        return `⚠️ 画布 ${canvasName} 不存在，请先创建或检查名称是否正确`;
      }
      
      // 读取画布内容
      const fileContent = await fs.readFile(filePath, 'utf8');
      let canvasData;
      try {
        canvasData = JSON.parse(fileContent);
      } catch {
        return `⚠️ 画布文件 ${canvasName} 格式无效，无法解析JSON内容`;
      }
      
      // 添加库项目到画布
      if (libraryContent.libraryItems && Array.isArray(libraryContent.libraryItems)) {
        // 确保elements数组存在
        if (!canvasData.elements) {
          canvasData.elements = [];
        }
        
        // 导入库项目作为元素
        let importCount = 0;
        for (const item of libraryContent.libraryItems) {
          if (item.elements && Array.isArray(item.elements)) {
            // 给每个元素生成新ID
            const elements = item.elements.map(el => ({
              ...el,
              id: `imported-${Date.now()}-${Math.floor(Math.random() * 1000)}-${importCount}`
            }));
            
            canvasData.elements.push(...elements);
            importCount += elements.length;
          }
        }
        
        // 写回文件
        await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
        console.error(`库导入到画布成功: ${filePath}`);
        return `✅ 成功将库 ${getLibraryName(libraryUrl, libraryContent)} 导入到画布 ${canvasName}\n📊 导入了 ${importCount} 个元素`;
      } else {
        return `⚠️ 库格式不正确，缺少有效的libraryItems数组`;
      }
    } else {
      // 保存为工作区库
      const libraryName = getLibraryName(libraryUrl, libraryContent);
      const libFileName = `${libraryName}.excalidrawlib`;
      const libFilePath = path.join(EXCALIDRAW_DIR, libFileName);
      
      // 写入库文件
      await fs.writeFile(libFilePath, JSON.stringify(libraryContent, null, 2), 'utf8');
      
      console.error(`库保存为工作区库成功: ${libFilePath}`);
      return `✅ 成功导入库 ${libraryName} 作为工作区库\n💾 文件保存在: ${libFilePath}\n📊 包含 ${libraryContent.libraryItems?.length || 0} 个项目`;
    }
  } catch (error) {
    console.error(`导入库失败: ${error.message}`);
    return `❌ 导入库失败: ${error.message}`;
  }
}

/**
 * 获取库名称
 * @param {string} url - 库URL
 * @param {object} content - 库内容
 * @returns {string} 库名称
 */
function getLibraryName(url, content) {
  // 首先尝试从内容中获取名称
  if (content.name) {
    return content.name;
  }
  
  // 然后从URL中提取
  if (url.includes('/')) {
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.replace('.excalidrawlib', '');
  }
  
  // 最后使用默认名称
  return `imported-library-${Date.now()}`;
}

/**
 * 获取画布详细信息
 * @param {string} name - 画布名称
 * @returns {Promise<string>} 画布详细信息
 */
async function getCanvasDetails(name) {
  console.error(`开始获取画布详细信息，名称: ${name}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 获取元素分类统计
    const elements = canvasData.elements || [];
    const stats = {
      total: elements.length,
      types: {}
    };
    
    // 计算画布边界
    let bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    
    // 统计各类元素数量并计算边界
    elements.forEach(element => {
      const type = element.type || 'unknown';
      if (!stats.types[type]) {
        stats.types[type] = 0;
      }
      stats.types[type]++;
      
      // 更新边界
      const x = element.x || 0;
      const y = element.y || 0;
      const width = element.width || 0;
      const height = element.height || 0;
      
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x + width);
      bounds.maxY = Math.max(bounds.maxY, y + height);
      
      // 对于线条和箭头，考虑终点坐标
      if (type === 'line' || type === 'arrow') {
        const points = element.points || [];
        points.forEach(point => {
          bounds.minX = Math.min(bounds.minX, x + point[0]);
          bounds.minY = Math.min(bounds.minY, y + point[1]);
          bounds.maxX = Math.max(bounds.maxX, x + point[0]);
          bounds.maxY = Math.max(bounds.maxY, y + point[1]);
        });
      }
    });
    
    // 生成元素详细信息
    let elementDetails = '';
    elements.forEach((element, index) => {
      elementDetails += `\n${index + 1}. ${element.type || '未知类型'} (ID: ${element.id || '无ID'})`;
      
      // 基本属性
      const x = element.x || 0;
      const y = element.y || 0;
      const width = element.width || 0;
      const height = element.height || 0;
      const angle = element.angle || 0;
      
      elementDetails += `\n   📍 位置: (${x}, ${y})`;
      
      // 计算中心点
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      elementDetails += `\n   🎯 中心点: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`;
      
      // 根据元素类型添加特定信息
      switch (element.type) {
        case 'text':
        elementDetails += `\n   📝 文本内容: "${element.text.substring(0, 50)}${element.text.length > 50 ? '...' : ''}"`;
          elementDetails += `\n   📏 字体大小: ${element.fontSize || '默认'}`;
          elementDetails += `\n   📏 文本对齐: ${element.textAlign || '默认'}`;
          elementDetails += `\n   📏 字体系列: ${element.fontFamily || '默认'}`;
          elementDetails += `\n   📏 文本宽度: ${width}px`;
          elementDetails += `\n   📏 文本高度: ${height}px`;
          elementDetails += `\n   📏 基线位置: ${element.baseline || '默认'}`;
          break;
          
        case 'rectangle':
          elementDetails += `\n   📏 尺寸: ${width}×${height}`;
          elementDetails += `\n   🎨 填充样式: ${element.fillStyle || '无填充'}`;
          elementDetails += `\n   🎨 背景颜色: ${element.backgroundColor || '透明'}`;
          elementDetails += `\n   ✏️ 线条宽度: ${element.strokeWidth || '1'}`;
          elementDetails += `\n   ✏️ 线条样式: ${element.strokeStyle || 'solid'}`;
          
          // 计算矩形的四个顶点坐标（考虑旋转）
          if (angle === 0) {
            // 不旋转的情况
            elementDetails += `\n   📐 顶点坐标:`;
            elementDetails += `\n     ↖ 左上: (${x}, ${y})`;
            elementDetails += `\n     ↗ 右上: (${x + width}, ${y})`;
            elementDetails += `\n     ↘ 右下: (${x + width}, ${y + height})`;
            elementDetails += `\n     ↙ 左下: (${x}, ${y + height})`;
          } else {
            // 旋转的情况，计算旋转后的顶点
            const angleRad = angle * Math.PI / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            
            // 以中心点为旋转中心
            const vertices = [
              rotatePoint(x, y, centerX, centerY, cos, sin),
              rotatePoint(x + width, y, centerX, centerY, cos, sin),
              rotatePoint(x + width, y + height, centerX, centerY, cos, sin),
              rotatePoint(x, y + height, centerX, centerY, cos, sin)
            ];
            
            elementDetails += `\n   📐 旋转后顶点坐标:`;
            elementDetails += `\n     ↖ 左上: (${vertices[0][0].toFixed(2)}, ${vertices[0][1].toFixed(2)})`;
            elementDetails += `\n     ↗ 右上: (${vertices[1][0].toFixed(2)}, ${vertices[1][1].toFixed(2)})`;
            elementDetails += `\n     ↘ 右下: (${vertices[2][0].toFixed(2)}, ${vertices[2][1].toFixed(2)})`;
            elementDetails += `\n     ↙ 左下: (${vertices[3][0].toFixed(2)}, ${vertices[3][1].toFixed(2)})`;
          }
          
          // 添加圆角信息
          if (element.roundness) {
            elementDetails += `\n   🔄 圆角: ${element.roundness.type === 3 ? element.roundness.value + 'px' : '自动'}`;
          }
          break;
          
        case 'diamond':
          elementDetails += `\n   📏 尺寸: ${width}×${height}`;
          elementDetails += `\n   🎨 填充样式: ${element.fillStyle || '无填充'}`;
          elementDetails += `\n   🎨 背景颜色: ${element.backgroundColor || '透明'}`;
          elementDetails += `\n   ✏️ 线条宽度: ${element.strokeWidth || '1'}`;
          elementDetails += `\n   ✏️ 线条样式: ${element.strokeStyle || 'solid'}`;
          
          // 计算菱形的四个顶点坐标
          if (angle === 0) {
            // 不旋转的情况
            elementDetails += `\n   📐 顶点坐标:`;
            elementDetails += `\n     ⬆️ 上点: (${centerX.toFixed(2)}, ${y})`;
            elementDetails += `\n     ➡️ 右点: (${(x + width).toFixed(2)}, ${centerY.toFixed(2)})`;
            elementDetails += `\n     ⬇️ 下点: (${centerX.toFixed(2)}, ${(y + height).toFixed(2)})`;
            elementDetails += `\n     ⬅️ 左点: (${x}, ${centerY.toFixed(2)})`;
          } else {
            // 旋转的情况
            const angleRad = angle * Math.PI / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            
            // 以中心点为旋转中心
            const vertices = [
              rotatePoint(centerX, y, centerX, centerY, cos, sin),
              rotatePoint(x + width, centerY, centerX, centerY, cos, sin),
              rotatePoint(centerX, y + height, centerX, centerY, cos, sin),
              rotatePoint(x, centerY, centerX, centerY, cos, sin)
            ];
            
            elementDetails += `\n   📐 旋转后顶点坐标:`;
            elementDetails += `\n     ⬆️ 上点: (${vertices[0][0].toFixed(2)}, ${vertices[0][1].toFixed(2)})`;
            elementDetails += `\n     ➡️ 右点: (${vertices[1][0].toFixed(2)}, ${vertices[1][1].toFixed(2)})`;
            elementDetails += `\n     ⬇️ 下点: (${vertices[2][0].toFixed(2)}, ${vertices[2][1].toFixed(2)})`;
            elementDetails += `\n     ⬅️ 左点: (${vertices[3][0].toFixed(2)}, ${vertices[3][1].toFixed(2)})`;
          }
          break;
          
        case 'ellipse':
          elementDetails += `\n   📏 尺寸: ${width}×${height}`;
          elementDetails += `\n   🎨 填充样式: ${element.fillStyle || '无填充'}`;
          elementDetails += `\n   🎨 背景颜色: ${element.backgroundColor || '透明'}`;
          elementDetails += `\n   ✏️ 线条宽度: ${element.strokeWidth || '1'}`;
          elementDetails += `\n   ✏️ 线条样式: ${element.strokeStyle || 'solid'}`;
          
          // 椭圆特有属性
          const rx = width / 2;  // 水平半径
          const ry = height / 2; // 垂直半径
          
          elementDetails += `\n   ⭕ 椭圆参数:`;
          elementDetails += `\n     🔵 中心: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`;
          elementDetails += `\n     ↔️ 水平半径: ${rx.toFixed(2)}`;
          elementDetails += `\n     ↕️ 垂直半径: ${ry.toFixed(2)}`;
          
          // 计算椭圆的关键点（0°, 90°, 180°, 270°）
          if (angle === 0) {
            // 不旋转的情况
            elementDetails += `\n   📐 关键点坐标:`;
            elementDetails += `\n     ⬆️ 上点: (${centerX.toFixed(2)}, ${(centerY - ry).toFixed(2)})`;
            elementDetails += `\n     ➡️ 右点: (${(centerX + rx).toFixed(2)}, ${centerY.toFixed(2)})`;
            elementDetails += `\n     ⬇️ 下点: (${centerX.toFixed(2)}, ${(centerY + ry).toFixed(2)})`;
            elementDetails += `\n     ⬅️ 左点: (${(centerX - rx).toFixed(2)}, ${centerY.toFixed(2)})`;
          } else {
            // 旋转的情况
            const angleRad = angle * Math.PI / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            
            // 以中心点为旋转中心
            const keyPoints = [
              rotatePoint(centerX, centerY - ry, centerX, centerY, cos, sin),
              rotatePoint(centerX + rx, centerY, centerX, centerY, cos, sin),
              rotatePoint(centerX, centerY + ry, centerX, centerY, cos, sin),
              rotatePoint(centerX - rx, centerY, centerX, centerY, cos, sin)
            ];
            
            elementDetails += `\n   📐 旋转后关键点坐标:`;
            elementDetails += `\n     ⬆️ 上点: (${keyPoints[0][0].toFixed(2)}, ${keyPoints[0][1].toFixed(2)})`;
            elementDetails += `\n     ➡️ 右点: (${keyPoints[1][0].toFixed(2)}, ${keyPoints[1][1].toFixed(2)})`;
            elementDetails += `\n     ⬇️ 下点: (${keyPoints[2][0].toFixed(2)}, ${keyPoints[2][1].toFixed(2)})`;
            elementDetails += `\n     ⬅️ 左点: (${keyPoints[3][0].toFixed(2)}, ${keyPoints[3][1].toFixed(2)})`;
          }
          break;
          
        case 'line':
          const points = element.points || [];
          const startX = x;
          const startY = y;
          const endX = x + (points[points.length-1]?.[0] || 0);
          const endY = y + (points[points.length-1]?.[1] || 0);
          
          elementDetails += `\n   📍 起点: (${startX}, ${startY})`;
          elementDetails += `\n   📍 终点: (${endX}, ${endY})`;
          elementDetails += `\n   📏 线长: ${calculateDistance(startX, startY, endX, endY).toFixed(2)}`;
          elementDetails += `\n   📐 角度: ${calculateAngle(startX, startY, endX, endY).toFixed(2)}°`;
          elementDetails += `\n   ✏️ 线条宽度: ${element.strokeWidth || '1'}`;
          elementDetails += `\n   ✏️ 线条样式: ${element.strokeStyle || 'solid'}`;
          
          // 如果有多个点，显示所有点
          if (points.length > 1) {
            elementDetails += `\n   📍 所有点坐标:`;
            points.forEach((point, i) => {
              const pointX = x + point[0];
              const pointY = y + point[1];
              elementDetails += `\n     点${i+1}: (${pointX}, ${pointY})`;
            });
          }
          break;
          
        case 'arrow':
          const arrowPoints = element.points || [];
          const arrowStartX = x;
          const arrowStartY = y;
          const arrowEndX = x + (arrowPoints[arrowPoints.length-1]?.[0] || 0);
          const arrowEndY = y + (arrowPoints[arrowPoints.length-1]?.[1] || 0);
          
          elementDetails += `\n   📍 起点: (${arrowStartX}, ${arrowStartY})`;
          elementDetails += `\n   📍 终点: (${arrowEndX}, ${arrowEndY})`;
          elementDetails += `\n   📏 线长: ${calculateDistance(arrowStartX, arrowStartY, arrowEndX, arrowEndY).toFixed(2)}`;
          elementDetails += `\n   📐 角度: ${calculateAngle(arrowStartX, arrowStartY, arrowEndX, arrowEndY).toFixed(2)}°`;
          elementDetails += `\n   ✏️ 线条宽度: ${element.strokeWidth || '1'}`;
          elementDetails += `\n   ✏️ 线条样式: ${element.strokeStyle || 'solid'}`;
          elementDetails += `\n   ➡️ 起点箭头: ${element.startArrowhead || '无'}`;
          elementDetails += `\n   ➡️ 终点箭头: ${element.endArrowhead || '箭头'}`;
          
          // 如果有绑定关系，显示绑定信息
          if (element.startBinding) {
            elementDetails += `\n   🔗 起点绑定: 元素ID ${element.startBinding.elementId}，焦点 ${element.startBinding.focus}`;
          }
          if (element.endBinding) {
            elementDetails += `\n   🔗 终点绑定: 元素ID ${element.endBinding.elementId}，焦点 ${element.endBinding.focus}`;
          }
          
          // 如果有多个点，显示所有点
          if (arrowPoints.length > 1) {
            elementDetails += `\n   📍 所有点坐标:`;
            arrowPoints.forEach((point, i) => {
              const pointX = x + point[0];
              const pointY = y + point[1];
              elementDetails += `\n     点${i+1}: (${pointX}, ${pointY})`;
            });
          }
          break;
          
        case 'frame':
          elementDetails += `\n   📏 尺寸: ${width}×${height}`;
          elementDetails += `\n   📝 标签: ${element.name || '无标签'}`;
          
          // 计算框架的四个顶点坐标
          elementDetails += `\n   📐 顶点坐标:`;
          elementDetails += `\n     ↖ 左上: (${x}, ${y})`;
          elementDetails += `\n     ↗ 右上: (${x + width}, ${y})`;
          elementDetails += `\n     ↘ 右下: (${x + width}, ${y + height})`;
          elementDetails += `\n     ↙ 左下: (${x}, ${y + height})`;
          
          // 如果有自定义数据，显示
          if (element.customData) {
            elementDetails += `\n   🔧 自定义数据:`;
            for (const [key, value] of Object.entries(element.customData)) {
              elementDetails += `\n     ${key}: ${value}`;
            }
          }
          break;
      }
      
      // 通用样式属性
      if (element.strokeColor) {
        elementDetails += `\n   🎨 线条颜色: ${element.strokeColor}`;
      }
      if (element.backgroundColor && element.backgroundColor !== 'transparent') {
        elementDetails += `\n   🎨 背景颜色: ${element.backgroundColor}`;
      }
      if (element.opacity !== undefined && element.opacity !== 100) {
        elementDetails += `\n   💧 透明度: ${element.opacity}%`;
      }
      if (element.angle) {
        elementDetails += `\n   🔄 旋转角度: ${element.angle}°`;
      }
      if (element.roughness !== undefined) {
        elementDetails += `\n   📊 粗糙度: ${element.roughness}`;
      }
      if (element.seed !== undefined) {
        elementDetails += `\n   🌱 种子值: ${element.seed}`;
      }
      if (element.version !== undefined) {
        elementDetails += `\n   🔄 版本: ${element.version}`;
      }
      if (element.updated) {
        const updateDate = new Date(element.updated);
        elementDetails += `\n   📅 更新时间: ${updateDate.toLocaleString()}`;
      }
      
      elementDetails += '\n';
    });
    
    // 获取画布属性
    const appState = canvasData.appState || {};
    const theme = appState.theme || 'light';
    const backgroundColor = appState.viewBackgroundColor || '#ffffff';
    const gridSize = appState.gridSize || 20;
    const zoomLevel = appState.zoom?.value || 1;
    
    // 生成完整报告
    let result = `📊 画布 ${name} 详细信息:\n`;
    result += `\n📄 基本信息:`;
    result += `\n   🖼️ 画布主题: ${theme}`;
    result += `\n   🎨 背景颜色: ${backgroundColor}`;
    result += `\n   📏 网格大小: ${gridSize}px`;
    result += `\n   🔍 缩放级别: ${(zoomLevel * 100).toFixed(0)}%`;
    result += `\n   📂 文件路径: ${filePath}`;
    
    // 添加画布边界信息
    if (elements.length > 0) {
      result += `\n\n📐 画布边界:`;
      result += `\n   左上角: (${bounds.minX.toFixed(2)}, ${bounds.minY.toFixed(2)})`;
      result += `\n   右下角: (${bounds.maxX.toFixed(2)}, ${bounds.maxY.toFixed(2)})`;
      result += `\n   画布尺寸: ${(bounds.maxX - bounds.minX).toFixed(2)}×${(bounds.maxY - bounds.minY).toFixed(2)}`;
    }
    
    result += `\n\n📊 元素统计 (共${stats.total}个):`;
    for (const [type, count] of Object.entries(stats.types)) {
      result += `\n   ${getElementEmoji(type)} ${type}: ${count}个`;
    }
    
    if (stats.total > 0) {
      result += `\n\n📋 元素详细信息:${elementDetails}`;
    }
    
    console.error(`画布详细信息生成完成: ${name}`);
    return result;
  } catch (error) {
    console.error(`获取画布详细信息失败: ${error.message}`);
    return `❌ 获取画布详细信息失败: ${error.message}`;
  }
}

/**
 * 添加箭头到画布
 * @param {string} name - 画布名称
 * @param {number} x - 起始X坐标
 * @param {number} y - 起始Y坐标
 * @param {number} endX - 结束X坐标
 * @param {number} endY - 结束Y坐标
 * @param {string} color - 箭头颜色
 * @param {string} startArrowhead - 起始箭头样式 (可选)
 * @param {string} endArrowhead - 结束箭头样式 (可选)
 * @returns {Promise<string>} 操作结果
 */
async function addArrow(name, x, y, endX, endY, color = '#000000', startArrowhead = null, endArrowhead = 'arrow') {
  console.error(`开始添加箭头，画布: ${name}, 起点: (${x},${y}), 终点: (${endX},${endY}), 颜色: ${color}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 计算箭头的宽度和高度
    const width = endX - x;
    const height = endY - y;
    
    // 创建箭头元素
    const newArrow = {
      id: `arrow-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: 'arrow',
      x: x,
      y: y,
      width: width,
      height: height,
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      points: [
        [0, 0],
        [width, height]
      ],
      startBinding: null,
      endBinding: null,
      lastCommittedPoint: null,
      startArrowhead: startArrowhead,
      endArrowhead: endArrowhead,
      seed: Math.floor(Math.random() * 10000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000)
    };
    
    // 添加到画布
    canvasData.elements.push(newArrow);
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`箭头添加成功: ${filePath}`);
    return `✅ 成功添加箭头到画布 ${name}
📍 起点: (${x}, ${y})
📍 终点: (${endX}, ${endY})
🎨 颜色: ${color}
${startArrowhead ? `➡️ 起始箭头: ${startArrowhead}` : ''}
${endArrowhead ? `➡️ 结束箭头: ${endArrowhead}` : ''}
🆔 箭头ID: ${newArrow.id}`;
  } catch (error) {
    console.error(`添加箭头失败: ${error.message}`);
    return `❌ 添加箭头失败: ${error.message}`;
  }
}

/**
 * 添加线条到画布
 * @param {string} name - 画布名称
 * @param {number} x - 起始X坐标
 * @param {number} y - 起始Y坐标
 * @param {number} endX - 结束X坐标
 * @param {number} endY - 结束Y坐标
 * @param {string} color - 线条颜色
 * @param {number} strokeWidth - 线条宽度
 * @param {string} strokeStyle - 线条样式 (solid, dashed, dotted)
 * @returns {Promise<string>} 操作结果
 */
async function addLine(name, x, y, endX, endY, color = '#000000', strokeWidth = 1, strokeStyle = 'solid') {
  console.error(`开始添加线条，画布: ${name}, 起点: (${x},${y}), 终点: (${endX},${endY}), 颜色: ${color}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 计算线条的宽度和高度
    const width = endX - x;
    const height = endY - y;
    
    // 创建线条元素
    const newLine = {
      id: `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: 'line',
      x: x,
      y: y,
      width: width,
      height: height,
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: strokeWidth,
      strokeStyle: strokeStyle,
      roughness: 1,
      opacity: 100,
      points: [
        [0, 0],
        [width, height]
      ],
      seed: Math.floor(Math.random() * 10000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000)
    };
    
    // 添加到画布
    canvasData.elements.push(newLine);
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`线条添加成功: ${filePath}`);
    return `✅ 成功添加线条到画布 ${name}
📍 起点: (${x}, ${y})
📍 终点: (${endX}, ${endY})
🎨 颜色: ${color}
📏 线宽: ${strokeWidth}
📝 样式: ${strokeStyle}
🆔 线条ID: ${newLine.id}`;
  } catch (error) {
    console.error(`添加线条失败: ${error.message}`);
    return `❌ 添加线条失败: ${error.message}`;
  }
}

/**
 * 获取元素类型对应的表情符号
 * @param {string} type - 元素类型
 * @returns {string} 表情符号
 */
function getElementEmoji(type) {
  const emojiMap = {
    'rectangle': '🔲',
    'ellipse': '⭕',
    'diamond': '💠',
    'arrow': '➡️',
    'line': '📏',
    'text': '📝',
    'unknown': '❓'
  };
  
  return emojiMap[type] || emojiMap.unknown;
}

/**
 * 添加文本到画布
 * @param {string} name - 画布名称
 * @param {string} text - 文本内容
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {string} color - 文本颜色 (可选)
 * @param {number} fontSize - 字体大小 (可选)
 * @returns {Promise<string>} 操作结果
 */
async function addText(name, text, x, y, color = '#000000', fontSize = 20) {
  console.error(`开始添加文本，画布: ${name}, 内容: "${text}", 位置: (${x},${y}), 颜色: ${color}, 字体大小: ${fontSize}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 计算文本宽度（增加宽度系数以确保足够空间）
    const estimatedWidth = text.length * fontSize * 1;
    console.error(`估算文本宽度: ${estimatedWidth}px (文本长度: ${text.length}, 字体大小: ${fontSize})`);
    
    // 创建新文本元素
    const newText = {
      id: `text-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: 'text',
      x: parseInt(x),
      y: parseInt(y),
      width: estimatedWidth,
      height: fontSize * 1.5, // 增加高度以确保足够空间
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      text: text,
      fontSize: fontSize,
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'top',
      seed: Math.floor(Math.random() * 10000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000)
    };
    
    // 添加到画布
    canvasData.elements.push(newText);
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`文本添加成功: ${filePath}`);
    return `✅ 成功添加文本到画布 ${name}\n📝 内容: "${text}"\n📍 位置: (${x}, ${y})\n🎨 颜色: ${color}\n📊 字体大小: ${fontSize}\n🆔 元素ID: ${newText.id}`;
  } catch (error) {
    console.error(`添加文本失败: ${error.message}`);
    return `❌ 添加文本失败: ${error.message}`;
  }
}

/**
 * 从画布中删除指定元素
 * @param {string} name - 画布名称
 * @param {string} elementId - 要删除的元素ID
 * @returns {Promise<string>} 操作结果
 */
async function deleteElement(name, elementId) {
  console.error(`开始删除元素，画布: ${name}, 元素ID: ${elementId}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements || !Array.isArray(canvasData.elements)) {
      return `⚠️ 画布 ${name} 中没有找到有效的元素数组`;
    }
    
    // 查找要删除的元素
    const initialElementCount = canvasData.elements.length;
    const elementIndex = canvasData.elements.findIndex(el => el.id === elementId);
    
    if (elementIndex === -1) {
      return `⚠️ 在画布 ${name} 中未找到ID为 ${elementId} 的元素`;
    }
    
    // 获取元素信息，用于报告
    const elementToDelete = canvasData.elements[elementIndex];
    const elementType = elementToDelete.type || '未知类型';
    
    // 删除元素
    canvasData.elements.splice(elementIndex, 1);
    
    // 检查是否有箭头或线条绑定到这个元素，如果有需要解除绑定
    canvasData.elements.forEach(el => {
      // 检查startBinding
      if (el.startBinding && el.startBinding.elementId === elementId) {
        delete el.startBinding;
      }
      
      // 检查endBinding
      if (el.endBinding && el.endBinding.elementId === elementId) {
        delete el.endBinding;
      }
    });
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`元素删除成功: ${filePath}`);
    return `✅ 成功从画布 ${name} 中删除元素
🆔 元素ID: ${elementId}
📋 元素类型: ${elementType}
📊 画布中剩余 ${canvasData.elements.length} 个元素`;
  } catch (error) {
    console.error(`删除元素失败: ${error.message}`);
    return `❌ 删除元素失败: ${error.message}`;
  }
}

/**
 * 在画布中创建一个框架用于分组元素
 * @param {string} name - 画布名称
 * @param {number} x - 框架X坐标位置
 * @param {number} y - 框架Y坐标位置
 * @param {number} width - 框架宽度
 * @param {number} height - 框架高度
 * @param {string} label - 框架标签文本
 * @param {string} color - 框架颜色
 * @returns {Promise<string>} 操作结果
 */
async function createFrame(name, x, y, width, height, label = '框架', color = '#4a90e2') {
  console.error(`开始创建框架，画布: ${name}, 位置: (${x}, ${y}), 尺寸: ${width}x${height}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 创建框架ID
    const frameId = `frame_${Date.now()}`;

    // 计算标签文本的宽度
    const estimatedWidth = label.length * 16 * 1.5;
    
    // 创建框架元素
    const frame = {
      id: frameId,
      type: 'rectangle',
      x: x,
      y: y,
      width: estimatedWidth,
      height: height,
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 1,
      strokeStyle: 'dashed',
      roughness: 1,
      opacity: 80,
      groupIds: [],
      frameId: null,
      roundness: {
        type: 3,
        value: 10
      },
      seed: Math.floor(Math.random() * 1000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      customData: {
        isFrame: true
      }
    };
    
    // 创建框架标签
    const labelElement = {
      id: `label_${frameId}`,
      type: 'text',
      x: x + 10,
      y: y - 5,
      width: 100,
      height: 25,
      angle: 0,
      strokeColor: color,
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      seed: Math.floor(Math.random() * 1000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      text: label,
      fontSize: 16,
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'top',
      baseline: 18
    };
    
    // 添加框架和标签到画布
    canvasData.elements.push(frame);
    canvasData.elements.push(labelElement);
    
    // 保存更新后的画布
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2));
    
    return `✅ 成功在画布 ${name} 创建框架，位置:(${x}, ${y})，尺寸:${width}x${height}，标签:"${label}"`;
  } catch (error) {
    console.error('创建框架时出错：', error);
    return `❌ 创建框架失败: ${error.message}`;
  }
}

/**
 * 在画布中嵌入网页链接
 * @param {string} name - 画布名称
 * @param {string} url - 要嵌入的网页URL
 * @param {number} x - X坐标位置
 * @param {number} y - Y坐标位置
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Promise<string>} 操作结果
 */
async function embedWebpage(name, url, x, y, width = 320, height = 180) {
  console.error(`开始嵌入网页，画布: ${name}, URL: ${url}, 位置: (${x}, ${y}), 尺寸: ${width}x${height}`);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements) {
      canvasData.elements = [];
    }
    
    // 创建嵌入网页的框架
    const frameId = `embed_${Date.now()}`;
    
    // 创建框架元素表示网页容器
    const embedFrame = {
      id: frameId,
      type: 'rectangle',
      x: x,
      y: y,
      width: width,
      height: height,
      angle: 0,
      strokeColor: '#1971c2',
      backgroundColor: '#daeaf6',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: {
        type: 3,
        value: 3
      },
      seed: Math.floor(Math.random() * 1000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      customData: {
        isEmbeddedWebpage: true,
        url: url
      }
    };
    
    // 创建URL文本元素
    const urlElement = {
      id: `url_${frameId}`,
      type: 'text',
      x: x + 10,
      y: y + 10,
      width: width - 20,
      height: 20,
      angle: 0,
      strokeColor: '#1971c2',
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      seed: Math.floor(Math.random() * 1000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      text: `🔗 ${url}`,
      fontSize: 14,
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'top',
      baseline: 14
    };
    
    // 创建图标表示网页窗口
    const iconElement = {
      id: `icon_${frameId}`,
      type: 'rectangle',
      x: x + 10,
      y: y + 40,
      width: width - 20,
      height: height - 50,
      angle: 0,
      strokeColor: '#1971c2',
      backgroundColor: '#ffffff',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 1000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now()
    };
    
    // 添加元素到画布
    canvasData.elements.push(embedFrame);
    canvasData.elements.push(urlElement);
    canvasData.elements.push(iconElement);
    
    // 保存更新后的画布
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2));
    
    return `✅ 成功在画布 ${name} 嵌入网页 ${url}，位置:(${x}, ${y})，尺寸:${width}x${height}`;
  } catch (error) {
    console.error('嵌入网页时出错：', error);
    return `❌ 嵌入网页失败: ${error.message}`;
  }
}

/**
 * 调整画布中元素的样式
 * @param {string} name - 画布名称
 * @param {string} elementId - 元素ID
 * @param {Object} styleOptions - 样式选项
 * @returns {Promise<string>} 操作结果
 */
async function updateElementStyle(name, elementId, styleOptions = {}) {
  console.error(`开始更新元素样式，画布: ${name}, 元素ID: ${elementId}, 样式选项:`, styleOptions);
  
  try {
    await ensureExcalidrawDir();
    
    // 验证文件存在
    const fileName = name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
    const filePath = path.join(EXCALIDRAW_DIR, fileName);
    
    try {
      await fs.access(filePath);
    } catch {
      return `⚠️ 画布 ${name} 不存在，请先创建或检查名称是否正确`;
    }
    
    // 读取画布内容
    const fileContent = await fs.readFile(filePath, 'utf8');
    let canvasData;
    try {
      canvasData = JSON.parse(fileContent);
    } catch {
      return `⚠️ 画布文件 ${name} 格式无效，无法解析JSON内容`;
    }
    
    // 确保elements数组存在
    if (!canvasData.elements || !Array.isArray(canvasData.elements)) {
      return `⚠️ 画布 ${name} 中不存在元素数组`;
    }
    
    // 查找指定的元素
    const elementIndex = canvasData.elements.findIndex(e => e.id === elementId);
    if (elementIndex === -1) {
      return `⚠️ 在画布 ${name} 中未找到ID为 ${elementId} 的元素`;
    }
    
    // 获取元素引用
    const element = canvasData.elements[elementIndex];
    const elementType = element.type || 'unknown';
    
    console.error(`正在更新元素类型: ${elementType}, ID: ${elementId}`);
    
    // 根据元素类型定义可更新的样式属性列表
    let updatableProps = [
      'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 
      'strokeStyle', 'roughness', 'opacity'
    ];
    
    // 针对不同类型的元素添加特定的可更新属性
    switch (elementType) {
      case 'text':
        // 文本特有属性
        updatableProps = [
          ...updatableProps,
          'fontSize', 'fontFamily', 'textAlign', 'verticalAlign',
          'text', 'baseline', 'lineHeight'
        ];
        break;
        
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
        // 形状特有属性
        updatableProps = [
          ...updatableProps,
          'width', 'height', 'angle'
        ];
        
        // 处理圆角属性
        if (styleOptions.roundness !== undefined) {
          if (!element.roundness) {
            element.roundness = { type: 3, value: 0 };
          }
          element.roundness.value = parseFloat(styleOptions.roundness);
          styleOptions.roundness = undefined; // 避免后面重复处理
        }
        break;
        
      case 'line':
        // 线条特有属性
        updatableProps = [
          ...updatableProps,
          'strokeWidth', 'strokeStyle', 'points'
        ];
        break;
        
      case 'arrow':
        // 箭头特有属性
        updatableProps = [
          ...updatableProps,
          'strokeWidth', 'strokeStyle', 'points',
          'startArrowhead', 'endArrowhead'
        ];
        break;
        
      case 'frame':
        // 框架特有属性
        updatableProps = [
          ...updatableProps,
          'width', 'height', 'name'
        ];
        
        // 框架名称特殊处理
        if (styleOptions.name && element.customData) {
          element.customData.frameName = styleOptions.name;
        }
        break;
    }
    
    // 应用样式更新
    let updatedProps = [];
    
    // 处理位置调整（如果提供了x和y坐标）
    if (styleOptions.x !== undefined || styleOptions.y !== undefined) {
      if (styleOptions.x !== undefined) {
        element.x = parseFloat(styleOptions.x);
        updatedProps.push(`x: ${element.x}`);
      }
      
      if (styleOptions.y !== undefined) {
        element.y = parseFloat(styleOptions.y);
        updatedProps.push(`y: ${element.y}`);
      }
    }
    
    // 处理其他样式属性
    for (const [key, value] of Object.entries(styleOptions)) {
      if (key === 'x' || key === 'y' || key === 'roundness') {
        // 已经处理过的属性，跳过
        continue;
      }
      
      if (updatableProps.includes(key)) {
        // 根据属性类型进行适当的转换
        if (key === 'width' || key === 'height' || key === 'opacity' || key === 'strokeWidth' || key === 'fontSize') {
          element[key] = parseFloat(value);
        } else if (key === 'angle') {
          element[key] = parseFloat(value) % 360; // 确保角度在0-360范围内
        } else {
          element[key] = value;
        }
        
        updatedProps.push(`${key}: ${value}`);
      }
    }
    
    // 更新时间戳
    element.updated = Date.now();
    element.versionNonce = Math.floor(Math.random() * 1000000);
    
    // 如果没有更新任何属性
    if (updatedProps.length === 0) {
      return `⚠️ 未指定任何有效的样式属性进行更新`;
    }
    
    // 保存更新后的画布
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2));
    
    return `✅ 成功更新画布 ${name} 中${elementType}元素 ${elementId} 的样式，更新了以下属性: ${updatedProps.join(', ')}`;
  } catch (error) {
    console.error('更新元素样式时出错：', error);
    return `❌ 更新元素样式失败: ${error.message}`;
  }
}

// 添加参数描述
createCanvas.description = '创建新的Excalidraw画布，为用户提供绘图的基础环境。可以选择不同的模板来快速开始绘图。';
createCanvas.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称（不需要包含.excalidraw扩展名）'
    },
    template: {
      type: 'string',
      description: '可选的模板名称，可用模板: 空白画布, 基础图形, 流程图，思维导图，组织结构图'
    }
  },
  required: ['name']
};

listCanvases.description = '列出所有已创建的画布，帮助用户了解现有画布情况。';
listCanvases.parameters = {
  type: 'object',
  properties: {
    random: {
      type: 'string',
      description: '无需参数'
    }
  }
};

exportCanvas.description = '导出画布为SVG格式，便于用户分享和使用绘制的内容。';
exportCanvas.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    format: {
      type: 'string',
      description: '导出格式: svg'
    },
    withBackground: {
      type: 'boolean',
      description: '是否包含背景（默认为true）'
    },
    withDarkMode: {
      type: 'boolean',
      description: '是否使用暗色模式（默认为false）'
    },
    exportScale: {
      type: 'number',
      description: '导出缩放比例（默认为1）'
    }
  },
  required: ['name', 'format']
};

addShape.description = '添加基本形状，构建图表的基本元素。一般配合addText使用，确保形状的边框与线条的连接。';
addShape.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    shapeType: {
      type: 'string',
      description: '形状类型: rectangle, ellipse, diamond, text'
    },
    x: {
      type: 'number',
      description: 'X坐标位置'
    },
    y: {
      type: 'number',
      description: 'Y坐标位置'
    },
    color: {
      type: 'string',
      description: '颜色代码，如 #000000 或 #ff0000'
    }
  },
  required: ['name', 'shapeType', 'x', 'y']
};

importLibrary.description = '导入Excalidraw库，使用预设模板快速创建复杂图形。可以导入公共库或自定义库。';
importLibrary.parameters = {
  type: 'object',
  properties: {
    libraryUrl: {
      type: 'string',
      description: '库URL或识别符（如"rocket"、"charts"等公共库ID或完整URL）'
    },
    canvasName: {
      type: 'string',
      description: '可选：要导入到的画布名称。如不提供，将作为工作区库导入'
    }
  },
  required: ['libraryUrl']
};

getCanvasDetails.description = '获取画布详细信息，深入了解画布内容和结构。包括元素位置、样式、属性等详细信息。';
getCanvasDetails.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    }
  },
  required: ['name']
};

addText.description = '添加独立文本，为图表添加说明或标签。支持自定义字体大小和颜色。一般配合addShape使用，确保文本的边框与形状的边框对齐。';
addText.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    text: {
      type: 'string',
      description: '文本内容'
    },
    x: {
      type: 'number',
      description: 'X坐标位置'
    },
    y: {
      type: 'number',
      description: 'Y坐标位置'
    },
    color: {
      type: 'string',
      description: '文本颜色，如 #000000 或 #ff0000 (可选，默认为黑色)'
    },
    fontSize: {
      type: 'number',
      description: '字体大小 (可选，默认为20)'
    }
  },
  required: ['name', 'text', 'x', 'y']
};

deleteElement.description = '删除画布中的元素，修改或纠正图表内容。';
deleteElement.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    elementId: {
      type: 'string',
      description: '要删除的元素ID'
    }
  },
  required: ['name', 'elementId']
};

createFrame.description = '创建一个框架用于分组元素，创建边框前一般先读取画布的元素信息，确保边框能够覆盖到需要分组的元素。';
createFrame.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    x: {
      type: 'number',
      description: '框架X坐标位置'
    },
    y: {
      type: 'number',
      description: '框架Y坐标位置'
    },
    width: {
      type: 'number',
      description: '框架宽度'
    },
    height: {
      type: 'number',
      description: '框架高度'
    },
    label: {
      type: 'string',
      description: '框架标签文本（默认为"框架"）'
    },
    color: {
      type: 'string',
      description: '框架颜色代码（默认为蓝色）'
    }
  },
  required: ['name', 'x', 'y', 'width', 'height']
};

embedWebpage.description = '在画布中嵌入网页链接';
embedWebpage.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    url: {
      type: 'string',
      description: '要嵌入的网页URL'
    },
    x: {
      type: 'number',
      description: 'X坐标位置'
    },
    y: {
      type: 'number',
      description: 'Y坐标位置'
    },
    width: {
      type: 'number',
      description: '宽度（默认为320）'
    },
    height: {
      type: 'number',
      description: '高度（默认为180）'
    }
  },
  required: ['name', 'url', 'x', 'y']
};

updateElementStyle.description = '调整画布中元素的样式';
updateElementStyle.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    elementId: {
      type: 'string',
      description: '要调整样式的元素ID'
    },
    styleOptions: {
      type: 'object',
      description: '样式选项对象，可包含以下属性: strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, fontSize, fontFamily, textAlign, verticalAlign'
    }
  },
  required: ['name', 'elementId', 'styleOptions']
};

// 添加参数描述
addLine.description = '添加普通线条，创建不带箭头的连接线。在添加线条前读取画布的元素信息，确保线条连接到正确的元素。并且起点终点优先靠近目标位置的边框中点等美观的位置。';
addLine.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    x: {
      type: 'number',
      description: '起始X坐标'
    },
    y: {
      type: 'number',
      description: '起始Y坐标'
    },
    endX: {
      type: 'number',
      description: '结束X坐标'
    },
    endY: {
      type: 'number',
      description: '结束Y坐标'
    },
    color: {
      type: 'string',
      description: '线条颜色（默认为黑色）'
    },
    strokeWidth: {
      type: 'number',
      description: '线条宽度（默认为1）'
    },
    strokeStyle: {
      type: 'string',
      description: '线条样式（默认为solid，可选：solid, dashed, dotted）'
    }
  },
  required: ['name', 'x', 'y', 'endX', 'endY']
};

// 添加参数描述
addArrow.description = '添加带箭头的线条，表示流程方向或关系。在添加箭头前读取画布的元素信息，确保箭头连接到正确的元素。并且起点终点优先靠近目标位置的边框中点等美观的位置。';
addArrow.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    x: {
      type: 'number',
      description: '起始X坐标'
    },
    y: {
      type: 'number',
      description: '起始Y坐标'
    },
    endX: {
      type: 'number',
      description: '结束X坐标'
    },
    endY: {
      type: 'number',
      description: '结束Y坐标'
    },
    color: {
      type: 'string',
      description: '箭头颜色（默认为黑色）'
    },
    startArrowhead: {
      type: 'string',
      description: '起始箭头样式（可选，如 "arrow", "bar", "dot" 等）'
    },
    endArrowhead: {
      type: 'string',
      description: '结束箭头样式（默认为 "arrow"）'
    }
  },
  required: ['name', 'x', 'y', 'endX', 'endY']
};

// 如果直接运行此文件
if (process.argv[1] === __filename) {
  // 解析命令行参数
  let workspaceDir = '';
  
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--workspace' && i + 1 < process.argv.length) {
      workspaceDir = process.argv[i + 1];
      i++; // 跳过下一个参数
    }
  }
  
  // 设置工作区目录（如果有提供）
  if (workspaceDir) {
    console.error(`从命令行参数设置工作区目录: ${workspaceDir}`);
    setExcalidrawDir(workspaceDir);
  }
  
  // 以标准I/O方式运行MCP服务器
  mcp.run({ transport: 'stdio' });
} 

// 导出变量和函数给其他模块使用
module.exports = {
  setExcalidrawDir,
  EXCALIDRAW_DIR
};

// 注册MCP工具
mcp.tool('createCanvas', createCanvas);
mcp.tool('listCanvases', listCanvases);
mcp.tool('exportCanvas', exportCanvas);
mcp.tool('addShape', addShape);
mcp.tool('addText', addText);
mcp.tool('getCanvasDetails', getCanvasDetails);
mcp.tool('importLibrary', importLibrary);
mcp.tool('deleteElement', deleteElement);
mcp.tool('createFrame', createFrame);
mcp.tool('embedWebpage', embedWebpage);
mcp.tool('updateElementStyle', updateElementStyle);
mcp.tool('addArrow', addArrow);
mcp.tool('addLine', addLine);


// 注册工具
mcp.tool()(createCanvas);
mcp.tool()(listCanvases);
mcp.tool()(exportCanvas);
mcp.tool()(addShape);
mcp.tool()(importLibrary);
mcp.tool()(getCanvasDetails);
mcp.tool()(addText);
mcp.tool()(deleteElement);
mcp.tool()(createFrame);
mcp.tool()(embedWebpage);
mcp.tool()(updateElementStyle);
mcp.tool()(addArrow);
mcp.tool()(addLine);

/**
 * 计算点绕中心点旋转后的新坐标
 * @param {number} x - 点的X坐标
 * @param {number} y - 点的Y坐标
 * @param {number} cx - 中心点X坐标
 * @param {number} cy - 中心点Y坐标
 * @param {number} cos - 余弦值
 * @param {number} sin - 正弦值
 * @returns {Array} 旋转后的坐标 [x, y]
 */
function rotatePoint(x, y, cx, cy, cos, sin) {
  // 将点平移到原点
  const dx = x - cx;
  const dy = y - cy;
  
  // 旋转
  const newX = dx * cos - dy * sin + cx;
  const newY = dx * sin + dy * cos + cy;
  
  return [newX, newY];
}

/**
 * 计算两点之间的距离
 * @param {number} x1 - 第一个点的X坐标
 * @param {number} y1 - 第一个点的Y坐标
 * @param {number} x2 - 第二个点的X坐标
 * @param {number} y2 - 第二个点的Y坐标
 * @returns {number} 距离
 */
function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * 计算线段的角度（相对于水平线）
 * @param {number} x1 - 起点X坐标
 * @param {number} y1 - 起点Y坐标
 * @param {number} x2 - 终点X坐标
 * @param {number} y2 - 终点Y坐标
 * @returns {number} 角度（度）
 */
function calculateAngle(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}
