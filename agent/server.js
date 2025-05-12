import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// 加载环境变量
dotenv.config();

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
const mcp = new FastMCP('WeatherServer');

// OpenWeather API配置
const OPENWEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5/weather';
const API_KEY = process.env.OPENWEATHER_API_KEY || 'a44caf262fdf751fca4d1a6b5ca10bc8'; // 使用环境变量或默认值
const USER_AGENT = 'weather-app/1.0';

/**
 * 从OpenWeather API获取天气信息
 * @param {string} city - 城市名称（需使用英文，如Beijing）
 * @returns {Promise<object|null>} 天气数据字典；若出错返回包含error信息的字典
 */
async function fetchWeather(city) {
  // 记录请求信息到标准错误流
  console.error(`请求天气数据，城市: ${city}，API密钥: ${API_KEY.substring(0, 4)}...`);
  
  const params = {
    q: city,
    appid: API_KEY,
    units: 'metric',
    lang: 'zh_cn'
  };
  
  const headers = {
    'User-Agent': USER_AGENT
  };
  
  try {
    const response = await axios.get(OPENWEATHER_API_BASE, { 
      params, 
      headers, 
      timeout: 30000
    });
    console.error(`API响应状态码: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error(`API请求错误:`, error.message);
    if (error.response) {
      console.error(`HTTP状态码: ${error.response.status}`);
      return { error: `HTTP错误: ${error.response.status}` };
    }
    return { error: `请求失败: ${error.message}` };
  }
}

/**
 * 将天气数据格式化为易读文本
 * @param {object|string} data - 天气数据（可以是对象或JSON字符串）
 * @returns {string} 格式化后的天气信息字符串
 */
function formatWeather(data) {
  // 如果传入的是字符串，则先转换为对象
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (error) {
      return `无法解析天气数据: ${error.message}`;
    }
  }
  
  // 如果数据中包含错误信息，直接返回错误提示
  if (data.error) {
    return `⚠️ ${data.error}`;
  }
  
  // 提取数据时做容错处理
  const city = data.name || '未知';
  const country = data.sys?.country || '未知';
  const temp = data.main?.temp ?? 'N/A';
  const humidity = data.main?.humidity ?? 'N/A';
  const windSpeed = data.wind?.speed ?? 'N/A';
  const weatherList = data.weather || [{}];
  const description = weatherList[0].description || '未知';
  
  return (
    `🌍 ${city}, ${country}\n` +
    `🌡 温度: ${temp}°C\n` +
    `💧 湿度: ${humidity}%\n` +
    `🌬 风速: ${windSpeed} m/s\n` +
    `🌤 天气: ${description}\n`
  );
}

/**
 * 查询指定城市的天气
 * @param {string} city - 城市名称（需使用英文）
 * @returns {Promise<string>} 格式化后的天气信息
 */
async function queryWeather(city) {
  // 使用stderr而不是stdout进行调试
  console.error(`查询城市天气: ${city}`);
  
  // 参数验证
  if (!city) {
    return "错误: 未提供城市名称，请指定要查询天气的城市";
  }
  
  try {
    // 尝试自动将中文城市名转换为英文（简单处理常见城市）
    const cityMapping = {
      '北京': 'Beijing',
      '上海': 'Shanghai',
      '广州': 'Guangzhou',
      '深圳': 'Shenzhen',
      '香港': 'Hong Kong',
      '台北': 'Taipei',
      '东京': 'Tokyo',
      '首尔': 'Seoul',
      '纽约': 'New York'
    };
    
    const queryCity = cityMapping[city] || city;
    console.error(`使用城市名称查询: ${queryCity}`);
    
    const data = await fetchWeather(queryCity);
    return formatWeather(data);
  } catch (error) {
    console.error(`天气查询错误: ${error.message}`);
    return `查询天气时出错: ${error.message}`;
  }
}
// 添加函数描述，用于MCP工具注册
queryWeather.description = '输入指定城市的英文名称，返回今日天气查询结果';

// 更明确地定义参数信息
queryWeather.parameters = {
  type: 'object',
  properties: {
    city: {
      type: 'string',
      description: '城市名称（英文）'
    }
  },
  required: ['city']
};

// 注册工具
mcp.tool()(queryWeather);

// 如果直接运行此文件
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // 以标准I/O方式运行MCP服务器
  mcp.run({ transport: 'stdio' });
} 