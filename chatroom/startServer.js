const vscode = require('vscode');
const { startServer, stopServer } = require('./server');
const os = require('os');

let serverInstance = null;
let sidebarProvider = null;

/**
 * 获取本机IP地址
 * @returns {string} 本机IP地址
 */
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  let ipAddress = 'localhost';
  let ipAddresses = [];
  
  // 收集所有可用的IPv4地址
  for (const interfaceName in interfaces) {
    const interfaceInfo = interfaces[interfaceName];
    for (const info of interfaceInfo) {
      // 过滤IPv4地址且非内部地址
      if (info.family === 'IPv4' && !info.internal) {
        ipAddresses.push({
          name: interfaceName,
          address: info.address
        });
      }
    }
  }
  
  // 如果找到IP地址
  if (ipAddresses.length > 0) {
    // 优先使用有线网络接口
    const ethernetInterface = ipAddresses.find(ip => 
      ip.name.toLowerCase().includes('ethernet') || 
      ip.name.toLowerCase().includes('以太网') ||
      ip.name.toLowerCase().includes('eth'));
    
    if (ethernetInterface) {
      return ethernetInterface.address;
    }
    
    // 其次使用无线网络接口
    const wifiInterface = ipAddresses.find(ip => 
      ip.name.toLowerCase().includes('wi-fi') || 
      ip.name.toLowerCase().includes('wireless') ||
      ip.name.toLowerCase().includes('wlan'));
    
    if (wifiInterface) {
      return wifiInterface.address;
    }
    
    // 如果没有找到这些首选接口，则使用第一个非内部IPv4地址
    return ipAddresses[0].address;
  }
  
  // 如果没有找到合适的地址，返回localhost
  return ipAddress;
}

/**
 * 设置侧边栏提供者，用于在服务器状态变化时通知前端
 * @param {object} provider 侧边栏提供者实例
 */
function setSidebarProvider(provider) {
  sidebarProvider = provider;
}

/**
 * 启动聊天室服务器
 */
async function startChatServer() {
  try {
    if (serverInstance) {
      vscode.window.showInformationMessage('聊天室服务器已经在运行中');
      return;
    }

    // 获取端口号，默认为3000
    const portInput = await vscode.window.showInputBox({
      prompt: '请输入服务器端口号',
      placeHolder: '3000',
      value: '3000'
    });

    if (!portInput) return; // 用户取消了输入

    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      vscode.window.showErrorMessage('请输入有效的端口号 (1-65535)');
      return;
    }

    // 获取本机IP地址
    let ipAddress = getLocalIPAddress();
    
    // 显示检测到的IP地址，并询问是否使用
    const useDetectedIp = await vscode.window.showInformationMessage(
      `检测到本机IP地址: ${ipAddress}，是否使用此地址？`,
      { modal: true },
      '使用此地址',
      '手动输入'
    );
    
    // 如果用户选择手动输入
    if (useDetectedIp === '手动输入') {
      const manualIpInput = await vscode.window.showInputBox({
        prompt: '请输入服务器IP地址',
        placeHolder: ipAddress,
        value: ipAddress
      });
      
      if (!manualIpInput) return; // 用户取消了输入
      ipAddress = manualIpInput;
    } else if (!useDetectedIp) {
      return; // 用户取消了操作
    }

    // 启动服务器
    serverInstance = await startServer(port);
    vscode.window.showInformationMessage(`聊天室服务器已启动，监听端口 ${port}`);
    
    // 通知侧边栏服务器已启动
    if (sidebarProvider && sidebarProvider._webviewView) {
      sidebarProvider._webviewView.webview.postMessage({
        command: 'chatServerStatus',
        status: 'running',
        port: port,
        ipAddress: ipAddress
      });
    }
    
    // 显示访问链接
    const openButton = '打开聊天室';
    const copyButton = '复制连接信息';
    const result = await vscode.window.showInformationMessage(
      `聊天室可通过 ws://${ipAddress}:${port} 访问`,
      openButton,
      copyButton
    );
    
    // 根据用户操作处理
    if (result === openButton) {
      if (sidebarProvider) {
        sidebarProvider.connectToChatServer(port, ipAddress);
      }
    } else if (result === copyButton) {
      // 复制连接信息到剪贴板
      await vscode.env.clipboard.writeText(`灵犀协作聊天室连接信息: ws://${ipAddress}:${port}`);
      vscode.window.showInformationMessage('连接信息已复制到剪贴板');
    }
    
  } catch (error) {
    vscode.window.showErrorMessage(`启动聊天室服务器失败: ${error.message}`);
    console.error('启动服务器失败:', error);
  }
}

/**
 * 停止聊天室服务器
 */
async function stopChatServer() {
  try {
    if (!serverInstance) {
      vscode.window.showInformationMessage('聊天室服务器未运行');
      return;
    }

    // 如果连接了客户端，先断开连接
    if (sidebarProvider) {
      sidebarProvider.disconnectFromChatServer(); // 这里已经标记为手动断开
    }

    await stopServer();
    serverInstance = null;
    vscode.window.showInformationMessage('聊天室服务器已停止');
    
    // 通知侧边栏服务器已停止
    if (sidebarProvider && sidebarProvider._webviewView) {
      sidebarProvider._webviewView.webview.postMessage({
        command: 'chatServerStatus',
        status: 'stopped'
      });
    }
  } catch (error) {
    vscode.window.showErrorMessage(`停止聊天室服务器失败: ${error.message}`);
    console.error('停止服务器失败:', error);
  }
}

module.exports = {
  startChatServer,
  stopChatServer,
  setSidebarProvider
};