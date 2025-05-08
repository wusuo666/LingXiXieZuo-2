const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getClipboardHistory } = require('../clipboard');
const agentApi = require('../agent/agentApi');
const { connectToServer, sendMessage, disconnectFromServer, isConnected } = require('../chatroom/client');

/**
 * 灵犀协作侧边栏视图提供者
 * 负责渲染侧边栏Webview内容并处理标签页交互
 */
class LingxiSidebarProvider {
    /**
     * 构造函数
     * @param {vscode.ExtensionContext} context 插件上下文
     */
    constructor(context) {
        this._context = context;
        this._webviewView = null;
        this._chatClient = null;
        this._userName = `User_${Date.now().toString().slice(-4)}`;
        this._roomId = 'default';
    }

    /**
     * 向 Webview 发送剪贴板历史记录
     */
    sendClipboardHistory() {
        if (!this._webviewView) {
            return;
        }

        const history = getClipboardHistory();
        // 格式化时间戳和类型
        const formatted = history.map(item => ({
            id: item.id,
            content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
            type: item.type,
            time: item.timestamp ? new Date(item.timestamp).toLocaleString([], {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : ''
        }));

        this._webviewView.webview.postMessage({ type: 'clipboardHistory', data: formatted });
    }

    /**
     * 扫描并获取工作区中的画布文件列表
     * @returns {Promise<Array<{name: string, path: string, lastModified: string}>>}
     */
    async loadCanvasList() {
        const canvasFiles = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return canvasFiles;
        }
        
        try {
            // 搜索工作区中的.drawio文件
            const drawioFiles = await vscode.workspace.findFiles('**/*.drawio', '**/node_modules/**');
            
            for (const fileUri of drawioFiles) {
                try {
                    const fileStat = await vscode.workspace.fs.stat(fileUri);
                    const fileName = path.basename(fileUri.fsPath);
                    const relativePath = vscode.workspace.asRelativePath(fileUri.fsPath);
                    
                    canvasFiles.push({
                        name: fileName,
                        path: relativePath,
                        fullPath: fileUri.fsPath,
                        lastModified: new Date(fileStat.mtime).toLocaleString([], {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})
                    });
                } catch (err) {
                    console.error(`获取文件信息失败: ${fileUri.fsPath}`, err);
                }
            }
            
            // 按修改时间降序排序，最新的在前面
            canvasFiles.sort((a, b) => {
                return new Date(b.lastModified) - new Date(a.lastModified);
            });
            
            return canvasFiles;
        } catch (error) {
            console.error('搜索画布文件失败:', error);
            return [];
        }
    }

    /**
     * 向Webview发送画布文件列表
     */
    async sendCanvasList() {
        if (!this._webviewView) {
            return;
        }
        
        try {
            const canvasList = await this.loadCanvasList();
            this._webviewView.webview.postMessage({ 
                type: 'canvasList', 
                data: canvasList 
            });
        } catch (error) {
            console.error('发送画布列表失败:', error);
        }
    }

    /**
     * 处理聊天消息
     * @param {string} message 消息内容
     */
    handleChatMessage(message) {
        console.log('收到聊天消息:', message);
        
        // 使用isConnected函数检查连接状态
        if (isConnected()) {
            // 使用聊天室客户端发送消息
            sendMessage(message);
        } else {
            // 如果客户端未连接，提示用户启动聊天室服务
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatResponse',
                    sender: '系统提示',
                    content: '聊天室服务未启动，请点击"启动聊天室"按钮启动服务，或在从机模式下连接到现有服务器。',
                    time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
                });
            }
        }
    }

    /**
     * 处理Agent查询
     * @param {string} query 查询内容
     * @param {string} thinkingId 思考状态元素ID
     */
    async handleAgentQuery(query, thinkingId) {
        console.log('收到Agent查询:', query);
        
        if (!this._webviewView) {
            console.error('Webview 未初始化，无法处理Agent查询');
            return;
        }

        // 添加实际的 API 调用逻辑
        try {
            // 调用 agentApi 处理查询
            const result = await agentApi.handleAgentQuery(query);
            
            // 将结果发送回 Webview
            this._webviewView.webview.postMessage({
                command: 'agentResponse',
                result: result,
                status: 'success',
                thinkingId: thinkingId // 将 thinkingId 传回，以便前端移除"思考中"提示
            });

        } catch (error) {
            console.error('处理 Agent 查询时出错:', error);
            // 将错误信息发送回 Webview
            this._webviewView.webview.postMessage({
                command: 'agentResponse',
                result: `处理请求时出错: ${error.message}`,
                status: 'error',
                thinkingId: thinkingId
            });
            // 可以在这里添加更友好的错误提示给用户
            vscode.window.showErrorMessage(`AI助手请求失败: ${error.message}`);
        }
    }

    /**
     * Webview 解析入口
     * @param {vscode.WebviewView} webviewView
     */
    resolveWebviewView(webviewView) {
        this._webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            // 允许加载本地资源
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'sidebar')]
        };
        webviewView.webview.html = this.getHtmlForWebview();
        
        // 监听Webview消息
        this.setupMessageListeners(this._context); // 将 context 传递下去

        // 初始加载时主动发送一次剪贴板历史
        setTimeout(() => {
            this.sendClipboardHistory();
            // 同时请求 API Key 状态
            this._webviewView.webview.postMessage({ command: 'getApiKeyStatus' });
        }, 500);
    }

    /**
     * 处理协作区标签页相关初始化
     */
    handleCollabAreaTab() {
        // 协作区标签页切换处理，后续可根据需要添加功能
        console.log('切换到协作区标签页');
    }

    /**
     * 连接到聊天室服务器
     * @param {number} port 服务器端口
     * @param {string} ipAddress IP地址，默认为localhost
     */
    connectToChatServer(port = 3000, ipAddress = 'localhost') {
        if (this._chatClient) {
            console.log('已连接到聊天室，无需重新连接');
            return;
        }
        
        try {
            this._chatClient = connectToServer(
                port, 
                this._roomId, 
                `vscode_${Date.now()}`, 
                this._userName,
                ipAddress
            );
            
            // 添加消息处理
            const originalOnMessage = this._chatClient.onmessage;
            this._chatClient.onmessage = (event) => {
                // 调用原始处理函数
                if (originalOnMessage) {
                    originalOnMessage(event);
                }
                
                // 添加我们自己的处理逻辑
                try {
                    const message = JSON.parse(event.data);
                    // 将消息发送到前端
                    if (this._webviewView) {
                        this._webviewView.webview.postMessage({
                            command: 'chatResponse',
                            sender: typeof message.sender === 'object' ? message.sender.name : (message.sender || '其他用户'),
                            content: message.content,
                            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
                        });
                    }
                } catch (error) {
                    console.error('处理聊天消息时出错:', error);
                }
            };
            
            // 通知前端连接成功
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatServerStatus',
                    status: 'connected',
                    port: port,
                    ipAddress: ipAddress
                });
            }
            
        } catch (error) {
            console.error('连接到聊天室服务器失败:', error);
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatServerStatus',
                    status: 'error',
                    error: error.message
                });
            }
        }
    }
    
    /**
     * 断开聊天室服务器连接
     */
    disconnectFromChatServer() {
        if (this._chatClient) {
            disconnectFromServer(true); // 明确标记为手动断开
            this._chatClient = null;
            
            // 通知前端断开连接
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatServerStatus',
                    status: 'disconnected'
                });
            }
        }
    }

    /**
     * 设置Webview消息监听器
     * @param {vscode.ExtensionContext} context - 传递 context 用于访问 secrets
     */
    setupMessageListeners(context) { // 接收 context
        this._webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'switchTab':
                    if (message.tabId === 'history') {
                        // 切换到 History 标签页时刷新数据
                        this.sendClipboardHistory();
                    } else if (message.tabId === 'canvas') {
                        // 切换到 Canvas 标签页时加载画布列表
                        this.sendCanvasList();
                    } else if (message.tabId === 'collab-area') {
                        // 切换到协作区标签页时的处理
                        this.handleCollabAreaTab();
                    }
                    this.handleTabSwitch(message.tabId);
                    break;
                case 'createCanvas':
                    // 调用创建Draw.io画布的命令
                    vscode.commands.executeCommand('lingxixiezuo.createDrawio');
                    break;
                case 'getClipboardHistory':
                    this.sendClipboardHistory();
                    break;
                case 'getCanvasList':
                    this.sendCanvasList();
                    break;
                case 'openCanvas':
                    // 打开指定路径的画布文件
                    if (message.path) {
                        try {
                            const uri = vscode.Uri.file(message.path);
                            await vscode.commands.executeCommand('vscode.open', uri);
                        } catch (error) {
                            console.error('打开画布文件失败:', error);
                        }
                    }
                    break;
                case 'sendChatMessage':
                    // 处理聊天消息
                    if (message.message) {
                        this.handleChatMessage(message.message);
                    }
                    break;
                case 'startChatServer':
                    // 启动聊天室服务器
                    vscode.commands.executeCommand('lingxixiezuo.startChatServer');
                    break;
                case 'stopChatServer':
                    // 停止聊天室服务器
                    vscode.commands.executeCommand('lingxixiezuo.stopChatServer');
                    break;
                case 'connectToChatServer':
                    // 连接到聊天室服务器
                    this.connectToChatServer(message.port || 3000, message.ipAddress || 'localhost');
                    break;
                case 'disconnectFromChatServer':
                    // 断开聊天室服务器连接
                    this.disconnectFromChatServer();
                    break;
                case 'setUserName':
                    // 设置用户名
                    if (message.userName) {
                        this._userName = message.userName;
                    }
                    break;
                case 'agentQuery':
                    // 处理Agent查询
                    if (message.query) {
                        this.handleAgentQuery(message.query, message.thinkingId);
                    }
                    break;
                case 'updateApiKey': // 处理更新 API Key 的消息
                    if (message.apiKey) {
                        try {
                            await context.secrets.store('lingxi.apiKey', message.apiKey);
                            agentApi.updateConfig({ apiKey: message.apiKey }); // 更新 agentApi 配置
                            vscode.window.showInformationMessage('智谱AI API Key 已保存。');
                            // 通知 Webview 更新状态
                            this._webviewView.webview.postMessage({ command: 'apiKeyStatus', isSet: true });
                        } catch (error) {
                            console.error('保存 API Key 失败:', error);
                            vscode.window.showErrorMessage('保存 API Key 失败。');
                        }
                    }
                    break;
                case 'getApiKeyStatus': // 处理获取 API Key 状态的消息
                    try {
                        const apiKey = await context.secrets.get('lingxi.apiKey');
                        this._webviewView.webview.postMessage({ command: 'apiKeyStatus', isSet: !!apiKey });
                    } catch (error) {
                        console.error('读取 API Key 状态失败:', error);
                        this._webviewView.webview.postMessage({ command: 'apiKeyStatus', isSet: false });
                    }
                    break;
                case 'copyToClipboard':
                    // 复制文本到剪贴板
                    if (message.text) {
                        try {
                            await vscode.env.clipboard.writeText(message.text);
                            this._webviewView.webview.postMessage({
                                command: 'clipboardCopyResult',
                                success: true
                            });
                        } catch (error) {
                            console.error('复制到剪贴板失败:', error);
                            this._webviewView.webview.postMessage({
                                command: 'clipboardCopyResult',
                                success: false,
                                error: error.message
                            });
                        }
                    }
                    break;
            }
        });
    }

    /**
     * 处理标签页切换
     * @param {string} tabId 要切换到的标签页ID
     */
    handleTabSwitch(tabId) {
        this._webviewView.webview.postMessage({
            command: 'updateTab',
            activeTab: tabId
        });
    }

    /**
     * 生成侧边栏Webview的HTML内容，读取静态HTML文件并注入脚本
     * @returns {string}
     */
    getHtmlForWebview() {
        const htmlPath = path.join(this._context.extensionPath, 'sidebar', 'sidebar.html');
        try {
            let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            
            // 生成 Webview 可访问的 JS 文件 URI
            const scriptUri = this._webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'sidebar', 'sidebar.js'));

            // 注入脚本标签
            htmlContent = htmlContent.replace('</body>', `<script type="module" src="${scriptUri}"></script>\n</body>`);
            
            return htmlContent;
        } catch (e) {
            console.error("读取或处理 sidebar.html 失败:", e);
            return `<html><body><h2>灵犀协作侧边栏</h2><p>无法加载页面。</p></body></html>`;
        }
    }
}

module.exports = LingxiSidebarProvider;