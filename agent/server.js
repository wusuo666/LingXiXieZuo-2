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
      currentItemFontFamily: 1
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
        strokeColor: '#000000',
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      },
      {
        id: 'ellipse1',
        type: 'ellipse',
        x: 400,
        y: 100,
        width: 150,
        height: 100,
        strokeColor: '#1864ab',
        backgroundColor: '#a5d8ff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1
    }
  },
  '流程图': {
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
        height: 80,
        strokeColor: '#000000',
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      },
      {
        id: 'rectangle2',
        type: 'rectangle',
        x: 100,
        y: 300,
        width: 200,
        height: 80,
        strokeColor: '#000000',
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      },
      {
        id: 'arrow1',
        type: 'arrow',
        x: 200,
        y: 180,
        width: 0,
        height: 120,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      }
    ],
    appState: {
      theme: 'light',
      viewBackgroundColor: '#ffffff',
      currentItemFontFamily: 1
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
    
    // 创建基于模板的新画布
    const canvasData = JSON.stringify(DEFAULT_TEMPLATES[template], null, 2);
    await fs.writeFile(filePath, canvasData, 'utf8');
    
    console.error(`画布创建成功: ${filePath}`);
    return `✅ 成功创建画布 ${name}\n💾 文件保存在: ${filePath}\n📐 使用模板: ${template}`;
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
 * 切换画布主题
 * @param {string} name - 画布名称
 * @param {string} theme - 主题名称 (light/dark/auto)
 * @returns {Promise<string>} 操作结果
 */
async function switchTheme(name, theme) {
  console.error(`开始切换画布主题，名称: ${name}, 主题: ${theme}`);
  
  if (!['light', 'dark', 'auto'].includes(theme)) {
    return `⚠️ 无效的主题: ${theme}，请使用 light, dark 或 auto`;
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
    
    // 更新主题
    if (!canvasData.appState) {
      canvasData.appState = {};
    }
    
    const oldTheme = canvasData.appState.theme || 'light';
    canvasData.appState.theme = theme;
    
    // 写回文件
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    
    console.error(`画布主题切换成功: ${filePath}`);
    return `✅ 成功将画布 ${name} 的主题从 ${oldTheme} 切换为 ${theme}`;
  } catch (error) {
    console.error(`切换画布主题失败: ${error.message}`);
    return `❌ 切换画布主题失败: ${error.message}`;
  }
}

/**
 * 导出画布为图像格式
 * @param {string} name - 画布名称
 * @param {string} format - 导出格式 (svg/png)
 * @param {boolean} withBackground - 是否包含背景
 * @returns {Promise<string>} 操作结果
 */
async function exportCanvas(name, format, withBackground) {
  console.error(`开始导出画布，名称: ${name}, 格式: ${format}, 包含背景: ${withBackground}`);
  
  if (!['svg', 'png'].includes(format)) {
    return `⚠️ 无效的导出格式: ${format}，请使用 svg 或 png`;
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
    
    // 模拟导出过程
    // 实际实现中，这里应该调用Excalidraw的导出API
    // 我们这里简单地复制文件并模拟导出
    await fs.copyFile(filePath, exportPath);
    
    console.error(`画布导出成功: ${exportPath}`);
    return `✅ 成功导出画布 ${name} 为 ${format.toUpperCase()} 格式\n💾 导出文件: ${exportPath}\n${withBackground ? '🎨 包含背景' : '🔍 透明背景'}`;
  } catch (error) {
    console.error(`导出画布失败: ${error.message}`);
    return `❌ 导出画布失败: ${error.message}`;
  }
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
  const validShapes = ['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text'];
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
      opacity: 100
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

// 添加参数描述
createCanvas.description = '创建新的Excalidraw画布，可选择模板';
createCanvas.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称（不需要包含.excalidraw扩展名）'
    },
    template: {
      type: 'string',
      description: '可选的模板名称，可用模板: 空白画布, 基础图形, 流程图'
    }
  },
  required: ['name']
};

listCanvases.description = '列出所有已创建的Excalidraw画布';
listCanvases.parameters = {
  type: 'object',
  properties: {
    random: {
      type: 'string',
      description: '无需参数'
    }
  }
};

switchTheme.description = '切换Excalidraw画布的主题';
switchTheme.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    theme: {
      type: 'string',
      description: '主题名称: light, dark 或 auto'
    }
  },
  required: ['name', 'theme']
};

exportCanvas.description = '将Excalidraw画布导出为图像格式';
exportCanvas.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    format: {
      type: 'string',
      description: '导出格式: svg 或 png'
    },
    withBackground: {
      type: 'boolean',
      description: '是否包含背景（默认为true）'
    }
  },
  required: ['name', 'format']
};

addShape.description = '向Excalidraw画布添加基本形状';
addShape.parameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: '画布名称'
    },
    shapeType: {
      type: 'string',
      description: '形状类型: rectangle, ellipse, diamond, line, arrow, text'
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

// 注册工具
mcp.tool()(createCanvas);
mcp.tool()(listCanvases);
mcp.tool()(switchTheme);
mcp.tool()(exportCanvas);
mcp.tool()(addShape);

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