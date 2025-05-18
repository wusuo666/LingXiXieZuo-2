const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getClipboardHistory } = require('../clipboard');
const agentApi = require('../agent/agentApi');
const { connectToServer, sendMessage, disconnectFromServer, isConnected } = require('../chatroom/client');
const WebSocket = require('ws');
const { DOMParser, XMLSerializer } = require('xmldom');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

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
        
        // 设置WebSocket消息处理
        this.setupWebSocketHandlers();
    }

    /**
     * 设置WebSocket消息处理器
     */
    setupWebSocketHandlers() {
        if (this._chatClient) {
            // 添加重连机制
            this._chatClient.onclose = () => {
                console.log('WebSocket连接已关闭，尝试重连...');
                setTimeout(() => {
                    if (this._chatClient.readyState === WebSocket.CLOSED) {
                        this.reconnectWebSocket();
                    }
                }, 3000);
            };

            this._chatClient.onerror = (error) => {
                console.error('WebSocket错误:', error);
                vscode.window.showErrorMessage('WebSocket连接出错，正在尝试重连...');
            };

            this._chatClient.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('收到WebSocket消息:', message);
                    
                    // 处理不同类型的消息
                    switch (message.type) {
                        case 'canvas':
                            console.log('处理画布消息:', message);
                            if (message.action === 'list' && message.canvasList) {
                                console.log('收到画布列表:', message.canvasList);
                                await this.handleCanvasList(message.canvasList);
                            } else {
                                await this.handleCanvasMessage(message);
                            }
                            break;
                            
                        case 'message':
                            if (message.canvasData) {
                                // 带画布数据的消息
                                if (this._webviewView) {
                                    this._webviewView.webview.postMessage({
                                        command: 'chatResponse',
                                        sender: message.sender.name,
                                        content: message.content,
                                        time: new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                                        canvasData: message.canvasData
                                    });
                                }
                            } else {
                                // 普通文本消息
                                this.handleChatMessage(message);
                            }
                            break;
                            
                        case 'system':
                            // 处理系统消息(如用户加入/离开)
                            if (this._webviewView) {
                                this._webviewView.webview.postMessage({
                                    command: 'addSystemMessage',
                                    message: message
                                });
                            }
                            break;
                            
                        case 'audioMessage':
                            // 处理语音消息
                            if (this._webviewView) {
                                this._webviewView.webview.postMessage({
                                    command: 'addAudioMessage',
                                    message: message
                                });
                            }
                            break;
                            
                        case 'privateMessage':
                            // 处理私聊消息
                            if (this._webviewView) {
                                this._webviewView.webview.postMessage({
                                    command: 'addPrivateMessage',
                                    message: message
                                });
                            }
                            break;
                            
                        case 'privateAudioMessage':
                            // 处理私聊语音消息
                            if (this._webviewView) {
                                this._webviewView.webview.postMessage({
                                    command: 'addPrivateAudioMessage',
                                    message: message
                                });
                            }
                            break;
                            
                        case 'voiceConference':
                            // 转发语音会议消息到前端
                            console.log('收到会议消息, 转发到前端:', message);
                            if (this._webviewView) {
                                this._webviewView.webview.postMessage({
                                    command: 'forwardWebSocketMessage',
                                    wsMessage: message
                                });
                            }
                            break;
                            
                        case 'audioStream':
                            // 转发音频流消息到前端
                            console.log('收到音频流消息, 转发到前端:', {
                                序列号: message.sequence,
                                会议ID: message.conferenceId, 
                                发送者: message.senderId,
                                发送者名称: message.senderName,
                                数据长度: message.audioData ? message.audioData.length : 0,
                                当前用户ID: this._userId,
                                是否WAV格式: message.format?.isWav || false
                            });
                            
                            // 检查该消息是否是自己发送的
                            const isSelfMessage = message.senderId === this._userId;
                            if (isSelfMessage) {
                                console.log('音频流消息来自自己，但仍转发到前端以让前端决定是否播放');
                            }
                            
                            if (this._webviewView) {
                                try {
                                    this._webviewView.webview.postMessage({
                                        command: 'forwardWebSocketMessage',
                                        wsMessage: message
                                    });
                                    console.log('音频流消息已成功转发到前端, 序列号:', message.sequence);
                                } catch (err) {
                                    console.error('转发音频流消息到前端失败:', err);
                                }
                            } else {
                                console.error('无法转发音频流消息: webviewView未初始化');
                            }
                            break;
                            
                        default:
                            console.log('未处理的消息类型:', message.type);
                    }
                } catch (error) {
                    console.error('处理WebSocket消息时出错:', error);
                    vscode.window.showErrorMessage(`处理消息失败: ${error.message}`);
                }
            };
        }
    }

    /**
     * 重新连接WebSocket
     */
    async reconnectWebSocket() {
        try {
            console.log('尝试重新连接WebSocket...');
            if (this._chatClient) {
                this._chatClient.close();
            }
            
            // 重新连接
            this._chatClient = connectToServer(
                3000,
                this._roomId,
                `vscode_${Date.now()}`,
                this._userName
            );
            
            // 重新设置消息处理器
            this.setupWebSocketHandlers();
            
            vscode.window.showInformationMessage('WebSocket已重新连接');
        } catch (error) {
            console.error('重新连接WebSocket失败:', error);
            vscode.window.showErrorMessage(`重新连接失败: ${error.message}`);
        }
    }

    /**
     * 处理画布相关消息
     * @param {Object} message 消息数据
     */
    async handleCanvasMessage(message) {
        console.log('处理画布消息:', message);
        
        try {
            switch (message.action) {
                case 'getAll':
                    if (!message.canvasList || message.canvasList.length === 0) {
                        vscode.window.showInformationMessage('当前没有可用的画布');
                        return;
                    }
                    await this.saveAllCanvas(message.canvasList);
                    break;
                case 'update':
                    vscode.window.showInformationMessage(`画布 ${message.fileName} 已被其他用户更新`);
                    break;
                case 'error':
                    vscode.window.showErrorMessage(message.message || '拉取画布失败');
                    break;
            }
        } catch (error) {
            console.error('处理画布消息时出错:', error);
            vscode.window.showErrorMessage(`处理画布消息失败: ${error.message}`);
        }
    }

    /**
     * 保存所有画布到本地
     * @param {Array} canvasList 画布列表
     */
    async saveAllCanvas(canvasList) {
        try {
            console.log('开始保存画布:', canvasList);
            
            // 获取工作区根目录
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('未打开工作区');
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            // 保存每个画布
            for (const canvas of canvasList) {
                try {
                    // 获取最新版本
                    const latestVersion = canvas.versions[canvas.versions.length - 1];
                    if (!latestVersion) continue;

                    // 构建文件路径
                    const filePath = path.join(workspaceRoot, canvas.fileName);
                    
                    // 保存文件
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(filePath),
                        Buffer.from(latestVersion.content, 'utf8')
                    );
                    
                    console.log(`已保存画布: ${canvas.fileName}`);

                    // 自动打开保存的画布
                    const uri = vscode.Uri.file(filePath);
                    await vscode.commands.executeCommand('vscode.open', uri);
                } catch (error) {
                    console.error(`保存画布 ${canvas.fileName} 失败:`, error);
                }
            }

            vscode.window.showInformationMessage(`已保存并打开 ${canvasList.length} 个画布`);
        } catch (error) {
            console.error('保存画布失败:', error);
            vscode.window.showErrorMessage(`保存画布失败: ${error.message}`);
        }
    }

    /**
     * 处理画布版本历史
     * @param {Object} message 版本历史消息
     */
    async handleCanvasVersions(message) {
        console.log('处理画布版本历史:', message); // 添加日志
        
        try {
            if (!message.versions || !Array.isArray(message.versions) || message.versions.length === 0) {
                vscode.window.showInformationMessage(`画布 ${message.fileName} 没有可用的版本历史`);
                return;
            }

            // 显示版本选择列表
            const versionItems = message.versions.map((version, index) => ({
                label: `版本 ${index + 1}`,
                description: `由用户 ${version.userId || '未知用户'} 在 ${new Date(version.timestamp).toLocaleString()} 提交`,
                detail: `文件: ${message.fileName}`,
                version: version
            }));

            // 设置超时时间
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('选择版本超时')), 30000);
            });

            // 显示版本选择列表，带超时处理
            const selected = await Promise.race([
                vscode.window.showQuickPick(versionItems, {
                    placeHolder: '选择要合并的版本',
                    ignoreFocusOut: true
                }),
                timeoutPromise
            ]);

            if (!selected) {
                vscode.window.showInformationMessage('未选择版本或选择超时');
                return;
            }

            console.log('选中版本:', selected.version); // 添加日志
            
            // 预览选中的版本
            await this.previewCanvas(message.fileName, selected.version.content);
            
            // 询问是否合并
            const mergeOptions = [
                { label: '是', description: '合并此版本到当前画布' },
                { label: '否', description: '取消合并' }
            ];

            const merge = await Promise.race([
                vscode.window.showQuickPick(mergeOptions, {
                    placeHolder: '是否合并此版本？',
                    ignoreFocusOut: true
                }),
                timeoutPromise
            ]);

            if (merge && merge.label === '是') {
                await this.mergeCanvasVersions(message.filePath, message.currentContent, selected.version.content);
            } else {
                vscode.window.showInformationMessage('已取消合并');
            }
        } catch (error) {
            console.error('处理版本历史时出错:', error);
            if (error.message === '选择版本超时') {
                vscode.window.showErrorMessage('选择版本超时，请重试');
            } else {
                vscode.window.showErrorMessage(`处理版本历史失败: ${error.message}`);
            }
        }
    }

    /**
     * 预览画布内容
     * @param {string} fileName 画布文件名
     * @param {string} content 画布内容
     */
    async previewCanvas(fileName, content) {
        try {
            console.log('预览画布:', fileName);
            
            if (!content) {
                throw new Error('画布内容为空');
            }

            // 创建临时文件
            const tempDir = path.join(this._context.globalStoragePath, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFile = path.join(tempDir, `preview_${fileName}`);
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(tempFile),
                Buffer.from(content, 'utf8')
            );

            // 先以文本形式预览
            const doc = await vscode.workspace.openTextDocument(tempFile);
            await vscode.window.showTextDocument(doc, {
                preview: true,
                viewColumn: vscode.ViewColumn.Beside
            });

            // 询问是否用Excalidraw打开
            const openWithExcalidraw = await vscode.window.showQuickPick([
                { label: '是', description: '使用Excalidraw打开此文件' },
                { label: '否', description: '保持文本预览' }
            ], {
                placeHolder: '是否使用Excalidraw打开此文件？'
            });

            if (openWithExcalidraw && openWithExcalidraw.label === '是') {
                // 使用Excalidraw打开文件
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tempFile));
            }
            
            // 延长临时文件保存时间到30分钟
            setTimeout(async () => {
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(tempFile));
                } catch (error) {
                    console.error('删除临时预览文件失败:', error);
                }
            }, 30 * 60 * 1000); // 30分钟
        } catch (error) {
            console.error('预览画布失败:', error);
            vscode.window.showErrorMessage(`预览画布失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 提交画布到协作服务器
     * @param {string} path 画布文件路径
     * @param {string} name 画布文件名
     */
    async submitCanvas(path, name) {
        try {
            // 读取画布文件内容
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
            const contentStr = Buffer.from(content).toString('utf8');

            // 生成唯一ID
            const canvasId = `canvas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 发送到WebSocket服务器
            if (this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                // 获取当前WebSocket连接的URL
                const wsUrl = this._chatClient.url;
                // 从WebSocket URL中提取主机地址
                const host = wsUrl.replace('ws://', '').replace('wss://', '').split('/')[0];
                
                const message = {
                    type: 'canvas',
                    action: 'submit',
                    fileName: name,
                    filePath: path,
                    content: contentStr,
                    canvasId: canvasId,
                    timestamp: Date.now()
                };
                this._chatClient.send(JSON.stringify(message));

                // 创建画布链接，使用当前连接的主机地址
                const canvasLink = `http://${host}/canvas/${canvasId}`;
                
                // 发送链接到聊天室
                const linkMessage = {
                    type: 'message',
                    content: `我提交了一个新的画布 "${name}"，可以通过以下链接访问：${canvasLink}`,
                    timestamp: Date.now()
                };
                this._chatClient.send(JSON.stringify(linkMessage));

                vscode.window.showInformationMessage(`画布 ${name} 已提交，链接已发送到聊天室`);
                
                // 预览提交的画布
                await this.previewCanvas(name, contentStr);
            } else {
                vscode.window.showErrorMessage('未连接到协作服务器，请先连接');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`提交画布失败: ${error.message}`);
        }
    }

    /**
     * 从协作服务器拉取画布
     * @param {string} path 当前画布文件路径
     * @param {string} name 当前画布文件名
     */
    async pullCanvas(path, name) {
        try {
            // 获取工作区根目录
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('未打开工作区');
            }
            const workspaceRoot = workspaceFolders[0].uri;

            // 提示用户输入画布链接
            const canvasUrl = await vscode.window.showInputBox({
                prompt: '请输入画布链接（例如：http://10.21.206.55:3000/canvas/canvas_1746716514361_9ofni5v55）',
                placeHolder: '画布链接',
                validateInput: (value) => {
                    if (!value) return '请输入画布链接';
                    if (!value.startsWith('http://') && !value.startsWith('https://')) {
                        return '请输入正确的链接格式（以http://或https://开头）';
                    }
                    if (!value.includes('/canvas/')) {
                        return '请输入正确的画布链接（包含/canvas/路径）';
                    }
                    return null;
                }
            });

            if (!canvasUrl) {
                vscode.window.showInformationMessage('已取消拉取操作');
                return;
            }

            // 显示正在拉取的提示
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
            statusBarItem.text = "$(sync~spin) 正在拉取画布...";
            statusBarItem.show();

            try {
                // 从URL中提取文件名
                const urlParts = canvasUrl.split('/');
                const canvasId = urlParts[urlParts.length - 1];
                const fileName = `${canvasId}.excalidraw`;

                // 下载画布
                const response = await fetch(canvasUrl);
                if (!response.ok) {
                    throw new Error('下载画布失败');
                }

                const downloadedContent = await response.text();
                let downloadedJson;
                try {
                    downloadedJson = JSON.parse(downloadedContent);
                } catch (error) {
                    console.error('解析画布内容失败:', error);
                    throw new Error('画布内容格式错误');
                }

                // 读取当前文件内容
                const currentContent = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
                let currentJson;
                try {
                    currentJson = JSON.parse(Buffer.from(currentContent).toString('utf8'));
                } catch (error) {
                    console.error('解析当前文件内容失败:', error);
                    throw new Error('当前文件内容格式错误');
                }

                // 合并elements数组，只保留id不同的元素
                const mergedElements = [...currentJson.elements];
                const existingIds = new Set(currentJson.elements.map(e => e.id));
                
                downloadedJson.elements.forEach(element => {
                    if (!existingIds.has(element.id)) {
                        mergedElements.push(element);
                    }
                });

                // 更新elements数组
                currentJson.elements = mergedElements;

                // 保存合并后的内容
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(path),
                    Buffer.from(JSON.stringify(currentJson, null, 2), 'utf8')
                );

                // 打开合并后的文件
                const uri = vscode.Uri.file(path);
                await vscode.commands.executeCommand('vscode.open', uri);
                vscode.window.showInformationMessage(`画布已合并并打开`);

            } finally {
                // 隐藏状态栏提示
                statusBarItem.dispose();
            }

        } catch (error) {
            console.error('拉取画布失败:', error);
            vscode.window.showErrorMessage(`拉取画布失败: ${error.message}`);
        }
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
            // 搜索工作区中的.excalidraw文件
            const excalidrawFiles = await vscode.workspace.findFiles('**/*.excalidraw', '**/node_modules/**');
            
            for (const fileUri of excalidrawFiles) {
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
        if (!this._webviewView || !message) return;
        
        try {
            if (message.type === 'message' || message.type === 'system') {
                this._webviewView.webview.postMessage({
                    command: 'addChatMessage',
                    message
                });
            } else if (message.type === 'privateMessage') {
                this._webviewView.webview.postMessage({
                    command: 'addPrivateMessage',
                    message
                });
            } else if (message.type === 'audioMessage') {
                // 处理语音消息
                this._webviewView.webview.postMessage({
                    command: 'addAudioMessage',
                    message
                });
            } else if (message.type === 'privateAudioMessage') {
                // 处理私聊语音消息
                this._webviewView.webview.postMessage({
                    command: 'addPrivateAudioMessage',
                    message
                });
            } else if (message.type === 'canvas') {
                this.handleCanvasMessage(message);
            }
        } catch (error) {
            console.error('处理聊天消息失败:', error);
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
        
        // 监听Webview消息，传递context
        this.setupMessageListeners(this._context);

        // 监听 webview 消息，实现 clipboardHistory 同步
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'getClipboardHistory') {
                this.sendClipboardHistory();
            } else if (message.command === 'switchTab') {
                if (message.tabId === 'history') {
                    // 切换到 History 标签页时刷新数据
                    this.sendClipboardHistory();
                } else if (message.tabId === 'canvas') {
                    // 切换到 Canvas 标签页时加载画布列表
                    this.sendCanvasList();
                }
                this.handleTabSwitch(message.tabId);
            } else if (message.type === 'getCanvasList') {
                // 响应画布列表请求
                this.sendCanvasList();
            } else if (message.command === 'openCanvas') {
                // 打开指定路径的画布文件
                if (message.path) {
                    try {
                        const uri = vscode.Uri.file(message.path);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    } catch (error) {
                        console.error('打开画布文件失败:', error);
                    }
                }
            }
        });

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
     * 连接到聊天服务器
     * @param {number} port 服务器端口
     * @param {string} ipAddress 服务器IP地址
     */
    connectToChatServer(port = 3000, ipAddress = 'localhost') {
        try {
            console.log(`正在连接到聊天服务器 ${ipAddress}:${port}...`);
            
            const { connectToServer } = require('../chatroom/client');
            
            // 生成一个唯一的用户ID
            const userId = `vscode_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            this._userId = userId; // 在类实例中保存，确保可以在多个地方访问
            
            this._chatClient = connectToServer(
                port,
                this._roomId,
                userId, // 使用生成的一致ID
                this._userName,
                ipAddress
            );
            
            console.log('已连接到聊天服务器，用户ID:', userId);
            
            // 设置WebSocket消息处理
            this.setupWebSocketHandlers();
            
            // 将用户ID通知前端，这对语音会议功能很重要
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'updateCurrentUser',
                    userId: userId
                });
                
                // 多发送一次确保接收到
                setTimeout(() => {
                    if (this._webviewView) {
                        this._webviewView.webview.postMessage({
                            command: 'updateCurrentUser',
                            userId: userId
                        });
                    }
                }, 1000);
            }
            
            // 更新服务器状态
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatServerStatus',
                    status: 'connected',
                    ipAddress: ipAddress,
                    port: port,
                    roomId: this._roomId,
                    userId: userId // 也在这里包含用户ID
                });
            }
            
            vscode.window.showInformationMessage(`已连接到聊天服务器: ${ipAddress}:${port}`);
            
            return this._chatClient;
        } catch (error) {
            console.error('连接聊天服务器失败:', error);
            vscode.window.showErrorMessage(`连接失败: ${error.message}`);
            
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'chatServerStatus',
                    status: 'error',
                    error: error.message
                });
            }
            
            return null;
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
        this._webviewView.webview.onDidReceiveMessage(
            async (message) => {
                console.log('收到来自Webview的消息:', message);
                
                try {
                    const command = message.command;
                    
                    switch (command) {
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
                    // 调用创建Excalidraw画布的命令
                    vscode.commands.executeCommand('lingxixiezuo.createExcalidraw');
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
                            // 处理发送聊天消息
                            if (message.message && this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                                try {
                                    // 使用chatroom/client.js中的函数发送文本消息
                                    const chatClient = require('../chatroom/client');
                                    const success = await chatClient.sendMessage(message.message);
                                    
                                    console.log('文本消息已发送:', message.message);
                                    
                                    // 直接在前端显示消息
                                    if (success) {
                                        // 构建一个本地消息对象，模拟从服务器返回的消息
                                        const localMessage = {
                                            type: 'message',
                                            userId: this._chatClient._userId || 'unknown_user',
                                            sender: {
                                                id: this._chatClient._userId,
                                                name: this._userName
                                            },
                                            content: message.message,
                                            timestamp: Date.now(),
                                            isLocalMessage: true // 标记为本地发送的消息
                                        };
                                        
                                        // 给前端发送消息
                                        this._webviewView.webview.postMessage({
                                            command: 'addChatMessage',
                                            message: localMessage
                                        });
                                    }
                                } catch (error) {
                                    console.error('发送文本消息失败:', error);
                                    vscode.window.showErrorMessage(`发送消息失败: ${error.message}`);
                                }
                            } else if (!this._chatClient || this._chatClient.readyState !== WebSocket.OPEN) {
                                vscode.window.showErrorMessage('未连接到聊天服务器，无法发送消息');
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
                case 'showCanvasContextMenu':
                    this.showCanvasContextMenu(message.path, message.name);
                    break;
                        case 'executeCommand':
                            // 执行VSCode命令
                            if (message.commandId) {
                                try {
                                    // 执行命令
                                    const result = await vscode.commands.executeCommand(message.commandId, message.args);
                                    
                                    // 如果是录音命令，处理录音结果
                                    if (message.commandId === 'lingxixiezuo.recordAudio') {
                                        if (result) {
                                            // 成功获取到录音数据
                                            this._webviewView.webview.postMessage({
                                                command: 'audioRecordResult',
                                                success: true,
                                                audioData: result.audioData,
                                                audioFilename: result.filename,
                                                duration: message.args?.duration || 5 // 默认5秒
                                            });
                                        } else {
                                            // 录音被取消或失败
                                            this._webviewView.webview.postMessage({
                                                command: 'audioRecordResult',
                                                success: false,
                                                error: '录音被取消或失败'
                                            });
                                        }
                                    }
                                } catch (error) {
                                    console.error(`执行命令 ${message.commandId} 失败:`, error);
                                    // 通知前端执行失败
                                    this._webviewView.webview.postMessage({
                                        command: 'commandResult',
                                        commandId: message.commandId,
                                        success: false,
                                        error: error.message
                                    });
                                    
                                    // 如果是录音命令，还需要发送特定的录音失败消息
                                    if (message.commandId === 'lingxixiezuo.recordAudio') {
                                        this._webviewView.webview.postMessage({
                                            command: 'audioRecordResult',
                                            success: false,
                                            error: error.message
                                        });
                                    }
                                }
                            }
                            break;
                        case 'showError':
                            // 显示错误消息
                            if (message.text) {
                                vscode.window.showErrorMessage(message.text);
                            }
                            break;
                        case 'sendAudioMessage':
                            // 处理发送语音消息
                            if (this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                                try {
                                    const { audioData, duration, audioFilename, messageId } = message;
                                    // 使用chatroom/client.js中的函数发送语音消息
                                    const chatClient = require('../chatroom/client');
                                    const success = await chatClient.sendAudioMessage(audioData, duration, audioFilename, messageId);
                                    
                                    console.log('语音消息已发送，使用ID:', messageId, '文件名:', audioFilename);
                                    
                                    // 直接在前端显示消息
                                    if (success) {
                                        // 构建一个本地消息对象，模拟从服务器返回的消息
                                        const localMessage = {
                                            type: 'audioMessage',
                                            userId: this._chatClient._userId || 'unknown_user',
                                            sender: {
                                                id: this._chatClient._userId,
                                                name: this._userName
                                            },
                                            audioData: audioData,
                                            duration: duration || 0,
                                            id: messageId,
                                            audioFilename: audioFilename,
                                            timestamp: Date.now(),
                                            isLocalMessage: true // 标记为本地发送的消息
                                        };
                                        
                                        // 给前端发送消息
                                        this._webviewView.webview.postMessage({
                                            command: 'addAudioMessage',
                                            message: localMessage
                                        });
                                    }
                                    
                                    this._webviewView.webview.postMessage({
                                        command: 'audioMessageSent',
                                        success: true,
                                        messageId: messageId
                                    });
                                } catch (error) {
                                    console.error('发送语音消息失败:', error);
                                    this._webviewView.webview.postMessage({
                                        command: 'audioMessageSent',
                                        success: false,
                                        error: error.message
                                    });
                                }
                            } else {
                                vscode.window.showErrorMessage('未连接到聊天服务器，无法发送语音消息');
                                this._webviewView.webview.postMessage({
                                    command: 'audioMessageSent',
                                    success: false,
                                    error: '未连接到聊天服务器'
                                });
                            }
                            break;
                        
                        case 'sendPrivateAudioMessage':
                            // 处理发送私聊语音消息
                            if (this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                                try {
                                    const { targetId, audioData, duration } = message;
                                    // 使用chatroom/client.js中的函数发送私聊语音消息
                                    const chatClient = require('../chatroom/client');
                                    await chatClient.sendPrivateAudioMessage(targetId, audioData, duration);
                                    
                                    console.log('私聊语音消息已发送给', targetId);
                                    this._webviewView.webview.postMessage({
                                        command: 'privateAudioMessageSent',
                                        success: true,
                                        targetId
                                    });
                                } catch (error) {
                                    console.error('发送私聊语音消息失败:', error);
                                    this._webviewView.webview.postMessage({
                                        command: 'privateAudioMessageSent',
                                        success: false,
                                        error: error.message
                                    });
                                }
                            } else {
                                vscode.window.showErrorMessage('未连接到聊天服务器，无法发送私聊语音消息');
                                this._webviewView.webview.postMessage({
                                    command: 'privateAudioMessageSent',
                                    success: false,
                                    error: '未连接到聊天服务器'
                                });
                            }
                            break;
                        case 'openAudioFile':
                            // 处理使用系统播放器打开音频文件的请求
                            if (message.filename) {
                                try {
                                    const fs = require('fs');
                                    const path = require('path');
                                    
                                    // 构建音频文件路径 - 使用多种可能的路径
                                    const rootPath = path.resolve(__dirname, '..');
                                    const recordingsDir = path.join(rootPath, 'recordings');
                                    
                                    // 获取工作区路径
                                    let workspacePath = '';
                                    let workspaceRecordingsDir = null;
                                    try {
                                        const workspaceFolders = vscode.workspace.workspaceFolders;
                                        if (workspaceFolders && workspaceFolders.length > 0) {
                                            workspacePath = workspaceFolders[0].uri.fsPath;
                                            workspaceRecordingsDir = path.join(workspacePath, 'recordings');
                                            console.log('工作区recordings路径:', workspaceRecordingsDir);
                                        }
                                    } catch (error) {
                                        console.error('获取工作区路径失败:', error);
                                    }
                                    
                                    // 首先尝试工作区路径
                                    let fullPath = workspaceRecordingsDir ? 
                                        path.join(workspaceRecordingsDir, message.filename) : 
                                        path.join(recordingsDir, message.filename);
                                    
                                    console.log('尝试播放音频文件:', fullPath);
                                    
                                    // 检查文件是否存在
                                    if (fs.existsSync(fullPath)) {
                                        // 读取文件并转为base64
                                        const audioData = fs.readFileSync(fullPath);
                                        const base64Data = audioData.toString('base64');
                                        
                                        console.log(`成功读取音频文件，大小: ${audioData.length} 字节，base64大小: ${base64Data.length} 字符`);
                                        
                                        // 创建一个临时的audio元素在Node.js环境播放
                                        // 这里需要使用前端的Audio API，所以我们把数据发回前端
                                        this._webviewView.webview.postMessage({
                                            command: 'playAudioData',
                                            audioData: base64Data,
                                            filename: message.filename,  // 添加文件名
                                            mimeType: 'audio/wav'  // 提供MIME类型
                                        });
                                    } else {
                                        console.error('音频文件不存在:', fullPath);
                                        
                                        // 尝试查找音频文件的其他位置
                                        console.log('尝试查找音频文件的其他位置');
                                        
                                        // 检查输入的文件名是否包含完整路径
                                        const cleanFilename = path.basename(message.filename);
                                        console.log('提取的文件名:', cleanFilename);
                                        
                                        // 尝试列出recordings文件夹内容查找类似文件名
                                        try {
                                            // 优先尝试工作区recordings目录
                                            let recordingsFiles = [];
                                            let searchedDir = '';
                                            
                                            if (workspaceRecordingsDir && fs.existsSync(workspaceRecordingsDir)) {
                                                recordingsFiles = fs.readdirSync(workspaceRecordingsDir);
                                                searchedDir = workspaceRecordingsDir;
                                                console.log('工作区recordings文件夹中的文件列表:', recordingsFiles);
                                            }
                                            
                                            // 如果工作区中没有找到文件，尝试插件目录
                                            if (recordingsFiles.length === 0 && fs.existsSync(recordingsDir)) {
                                                recordingsFiles = fs.readdirSync(recordingsDir);
                                                searchedDir = recordingsDir;
                                                console.log('插件目录recordings文件夹中的文件列表:', recordingsFiles);
                                            }
                                            
                                            // 提取时间戳部分进行模糊匹配
                                            if (cleanFilename.startsWith('recording_') && cleanFilename.includes('-')) {
                                                const timestampParts = cleanFilename.replace('recording_', '').split('.')[0];
                                                // 只取日期部分进行匹配，忽略毫秒部分
                                                const datePartToMatch = timestampParts.substring(0, 16); // "2025-05-14T15-57" 格式
                                                console.log('尝试匹配的日期部分:', datePartToMatch);
                                                
                                                // 查找文件名中包含此日期部分的文件
                                                const matchingFiles = recordingsFiles.filter(file => 
                                                    file.startsWith('recording_') && 
                                                    file.includes(datePartToMatch)
                                                );
                                                
                                                console.log('匹配到的文件:', matchingFiles);
                                                
                                                if (matchingFiles.length > 0) {
                                                    // 使用第一个匹配的文件
                                                    const matchedFile = matchingFiles[0];
                                                    const matchedPath = path.join(searchedDir, matchedFile);
                                                    
                                                    try {
                                                        console.log('找到匹配的文件:', matchedPath);
                                                        const audioData = fs.readFileSync(matchedPath);
                                                        const base64Data = audioData.toString('base64');
                                                        
                                                        console.log(`成功读取匹配的音频文件，大小: ${audioData.length} 字节`);
                                                        
                                                        // 确定文件的MIME类型
                                                        let mimeType = 'audio/wav'; // 默认
                                                        if (matchedPath.toLowerCase().endsWith('.mp3')) {
                                                            mimeType = 'audio/mpeg';
                                                        } else if (matchedPath.toLowerCase().endsWith('.m4a')) {
                                                            mimeType = 'audio/mp4';
                                                        } else if (matchedPath.toLowerCase().endsWith('.ogg')) {
                                                            mimeType = 'audio/ogg';
                                                        } else if (matchedPath.toLowerCase().endsWith('.aac')) {
                                                            mimeType = 'audio/aac';
                                                        }
                                                        
                                                        this._webviewView.webview.postMessage({
                                                            command: 'playAudioData',
                                                            audioData: base64Data,
                                                            filename: matchedFile,
                                                            mimeType: mimeType
                                                        });
                                                        
                                                        fileFound = true;
                                                        return;
                                                    } catch (error) {
                                                        console.error('读取音频文件失败:', error);
                                                        this._webviewView.webview.postMessage({
                                                            command: 'showError',
                                                            text: `读取音频文件失败: ${error.message}`
                                                        });
                                                    }
                                                }
                                            }
                                        } catch (dirError) {
                                            console.error('列出recordings目录内容失败:', dirError);
                                        }
                                        
                                        // 尝试多种路径组合
                                        const potentialPaths = [];
                                        
                                        // 1. 工作区相关路径
                                        if (workspaceRecordingsDir) {
                                            potentialPaths.push(
                                                path.join(workspaceRecordingsDir, cleanFilename),
                                                // 考虑工作区中可能的子文件夹
                                                path.join(workspacePath, 'recordings', 'audio', cleanFilename),
                                                path.join(workspacePath, 'audio', cleanFilename)
                                            );
                                        }
                                        
                                        // 2. 插件相关路径
                                        potentialPaths.push(
                                            path.join('./recordings', cleanFilename),
                                            path.join(process.cwd(), 'recordings', cleanFilename),
                                            path.join(__dirname, '../recordings', cleanFilename),
                                            path.join(rootPath, 'recordings', cleanFilename),
                                            path.join(process.cwd(), '../recordings', cleanFilename),
                                            path.join(rootPath, 'LingXiXieZuo-2-main', 'recordings', cleanFilename)
                                        );
                                        
                                        // 3. 相对于工作区的可能路径
                                        if (vscode.workspace.rootPath) {
                                            potentialPaths.push(
                                                path.join(vscode.workspace.rootPath, 'recordings', cleanFilename)
                                            );
                                        }
                                        
                                        let fileFound = false;
                                        
                                        for (const potentialPath of potentialPaths) {
                                            console.log('尝试路径:', potentialPath);
                                            
                                            if (fs.existsSync(potentialPath)) {
                                                console.log('在路径中找到文件:', potentialPath);
                                                
                                                try {
                                                    const audioData = fs.readFileSync(potentialPath);
                                                    const base64Data = audioData.toString('base64');
                                                    
                                                    console.log(`成功读取备选路径音频文件，大小: ${audioData.length} 字节`);
                                                    
                                                    // 确定文件的MIME类型
                                                    let mimeType = 'audio/wav'; // 默认
                                                    if (potentialPath.toLowerCase().endsWith('.mp3')) {
                                                        mimeType = 'audio/mpeg';
                                                    } else if (potentialPath.toLowerCase().endsWith('.m4a')) {
                                                        mimeType = 'audio/mp4';
                                                    } else if (potentialPath.toLowerCase().endsWith('.ogg')) {
                                                        mimeType = 'audio/ogg';
                                                    } else if (potentialPath.toLowerCase().endsWith('.aac')) {
                                                        mimeType = 'audio/aac';
                                                    }
                                                    
                                                    this._webviewView.webview.postMessage({
                                                        command: 'playAudioData',
                                                        audioData: base64Data,
                                                        filename: cleanFilename,  // 添加文件名
                                                        mimeType: mimeType
                                                    });
                                                    
                                                    fileFound = true;
                                                    break;
                                                } catch (readError) {
                                                    console.error('读取备选路径文件失败:', readError);
                                                }
                                            }
                                        }
                                        
                                        if (!fileFound) {
                                            console.error('在任何路径下都未找到音频文件:', cleanFilename);
                                            this._webviewView.webview.postMessage({
                                                command: 'audioPlaybackError',
                                                error: '音频文件不存在，已尝试多个路径但无法找到'
                                            });
                                        }
                                    }
                                } catch (error) {
                                    console.error('打开音频文件失败:', error);
                                    this._webviewView.webview.postMessage({
                                        command: 'showError',
                                        text: `打开音频文件失败: ${error.message}`
                                    });
                                }
                            }
                            break;
                            
                        case 'stopAudioPlayback':
                            // 处理停止音频播放请求
                            // 由于音频播放实际上在前端进行，所以这里只需要通知前端停止播放
                            this._webviewView.webview.postMessage({
                                command: 'stopAudioPlayback'
                            });
                            break;
                        case 'playAudioFile':
                            // 处理播放音频文件请求
                            if (message.audioData) {
                                try {
                                    // 直接使用提供的音频数据
                                    this._webviewView.webview.postMessage({
                                        command: 'playAudioData',
                                        audioData: message.audioData,
                                        mimeType: message.mimeType || 'audio/wav'
                                    });
                                } catch (error) {
                                    console.error('播放音频数据失败:', error);
                                    this._webviewView.webview.postMessage({
                                        command: 'audioPlaybackError',
                                        error: error.message
                                    });
                                }
                            } else {
                                console.error('未提供音频数据');
                                this._webviewView.webview.postMessage({
                                    command: 'audioPlaybackError',
                                    error: '未提供音频数据'
                                });
                            }
                            break;
                        case 'executeStreamCommand':
                            // 执行音频流命令
                            this.executeAudioStreamCommand(message.script, message.args || []);
                            break;
                        
                        case 'terminateStreamProcess':
                            // 终止音频流进程
                            this.terminateAudioStreamProcess();
                            break;
                        
                        case 'sendWebSocketMessage':
                            // 发送WebSocket消息到服务器
                            this.sendWebSocketMessage(message.message);
                            break;
                    }
                    
                } catch (error) {
                    console.error('处理Webview消息时出错:', error);
                    vscode.window.showErrorMessage(`处理消息失败: ${error.message}`);
                }
            },
            null,
            context.subscriptions
        );
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

    /**
     * 显示画布右键菜单
     * @param {string} path 画布文件路径
     * @param {string} name 画布文件名
     */
    async showCanvasContextMenu(path, name) {
        const items = [
            {
                label: '提交画布',
                description: '将当前画布保存并提交到协作服务器'
            },
            {
                label: '拉取画布',
                description: '从协作服务器拉取画布并合并'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择操作'
        });

        if (selected) {
            if (selected.label === '提交画布') {
                await this.submitCanvas(path, name);
            } else if (selected.label === '拉取画布') {
                await this.pullCanvas(path, name);
            }
        }
    }

    /**
     * 处理画布列表
     * @param {Array} canvasList 画布列表
     */
    async handleCanvasList(canvasList) {
        try {
            console.log('开始处理画布列表:', canvasList);
            
            if (!canvasList || canvasList.length === 0) {
                vscode.window.showInformationMessage('当前没有可用的画布');
                return;
            }

            // 格式化画布列表项
            const items = canvasList.map(canvas => ({
                label: canvas.fileName,
                description: `由用户 ${canvas.userId || '未知用户'} 在 ${new Date(canvas.timestamp).toLocaleString()} 提交`,
                detail: `版本数: ${canvas.versionCount || 0}`,
                canvas: canvas
            }));

            console.log('格式化后的画布列表项:', items);

            // 显示画布选择列表
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要拉取的画布',
                ignoreFocusOut: true
            });

            console.log('用户选择的画布:', selected);

            if (selected) {
                // 发送拉取请求
                if (this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                    const message = {
                        type: 'canvas',
                        action: 'pull',
                        fileName: selected.canvas.fileName,
                        timestamp: Date.now()
                    };
                    console.log('发送拉取请求:', message);
                    this._chatClient.send(JSON.stringify(message));
                    vscode.window.showInformationMessage(`正在拉取画布 ${selected.canvas.fileName} 的版本历史...`);
                } else {
                    vscode.window.showErrorMessage('未连接到协作服务器，请先连接');
                }
            } else {
                vscode.window.showInformationMessage('已取消选择画布');
            }
        } catch (error) {
            console.error('处理画布列表时出错:', error);
            vscode.window.showErrorMessage(`处理画布列表失败: ${error.message}`);
        }
    }

    /**
     * 音频流进程引用
     * @type {import('child_process').ChildProcess}
     */
    _audioStreamProcess = null;
    
    /**
     * 执行音频流命令
     * @param {string} script 脚本路径
     * @param {string[]} args 命令参数
     */
    executeAudioStreamCommand(script, args) {
        try {
            const argStr = args.join(' '); // 用于日志显示
            console.log(`执行音频流命令: ${script} ${argStr}`);
            
            // 终止之前的进程
            this.terminateAudioStreamProcess();
            
            // 获取扩展目录
            const extensionPath = this._context.extensionPath;
            
            // 脚本路径可以是相对于扩展目录的路径，也可以是相对于工作区的路径
            // 首先检查相对于工作区的路径
            let scriptPath = '';
            const workspaceFolders = vscode.workspace.workspaceFolders;
            let workspacePath = '';
            
            if (workspaceFolders && workspaceFolders.length > 0) {
                workspacePath = workspaceFolders[0].uri.fsPath;
                scriptPath = path.join(workspacePath, script);
                
                // 如果文件不存在，则尝试相对于扩展目录的路径
                if (!fs.existsSync(scriptPath)) {
                    scriptPath = path.join(extensionPath, script);
                }
            } else {
                // 如果没有打开工作区，则使用相对于扩展目录的路径
                scriptPath = path.join(extensionPath, script);
            }
            
            // 检查脚本文件是否存在
            if (!fs.existsSync(scriptPath)) {
                throw new Error(`脚本文件不存在: ${scriptPath}`);
            }
            
            console.log(`找到脚本文件: ${scriptPath}`);
            
            // 创建录音目录（如果不存在）
            const recordingsDir = path.join(workspacePath || extensionPath, 'recordings');
            if (!fs.existsSync(recordingsDir)) {
                fs.mkdirSync(recordingsDir, { recursive: true });
                console.log(`已创建录音目录: ${recordingsDir}`);
            }
            
            // 添加工作区路径参数，确保recordAudio.js能找到正确的recordings目录
            if (workspacePath) {
                args.push('-workspace', workspacePath);
            }
            
            // 使用Node.js子进程执行命令
            const { spawn } = require('child_process');
            this._audioStreamProcess = spawn('node', [scriptPath, ...args], {
                cwd: workspacePath || extensionPath,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            // 添加命令行调试输出
            console.log(`启动命令: node ${scriptPath} ${args.join(' ')}`);
            console.log(`工作目录: ${workspacePath || extensionPath}`);
            
            // 处理进程输出
            this._audioStreamProcess.stdout.on('data', (data) => {
                console.log(`音频流输出: ${data}`);
            });
            
            this._audioStreamProcess.stderr.on('data', (data) => {
                console.log(`音频流信息: ${data}`);
            });
            
            // 处理进程结束
            this._audioStreamProcess.on('close', (code) => {
                console.log(`音频流进程已结束，退出码: ${code}`);
                this._audioStreamProcess = null;
                
                // 通知前端进程已结束
                if (this._webviewView) {
                    this._webviewView.webview.postMessage({
                        command: 'audioStreamEnded',
                        exitCode: code
                    });
                }
            });
            
            console.log('音频流进程已启动');
        } catch (error) {
            console.error('启动音频流失败:', error);
            vscode.window.showErrorMessage(`启动音频流失败: ${error.message}`);
            
            // 通知前端启动失败
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'audioStreamError',
                    error: error.message
                });
            }
        }
    }
    
    /**
     * 终止音频流进程
     */
    terminateAudioStreamProcess() {
        if (this._audioStreamProcess) {
            try {
                console.log('正在终止音频流进程...');
                
                // 终止进程
                if (process.platform === 'win32') {
                    // Windows下使用taskkill强制终止进程树
                    const { execSync } = require('child_process');
                    execSync(`taskkill /pid ${this._audioStreamProcess.pid} /f /t`);
                } else {
                    // 其他平台使用kill信号
                    this._audioStreamProcess.kill('SIGTERM');
                }
                
                // 重置进程引用
                this._audioStreamProcess = null;
                console.log('音频流进程已终止');
                
                // 通知前端进程已终止
                if (this._webviewView) {
                    this._webviewView.webview.postMessage({
                        command: 'audioStreamTerminated'
                    });
                }
            } catch (error) {
                console.error('终止音频流进程时出错:', error);
            }
        }
    }
    
    /**
     * 发送WebSocket消息到服务器
     * @param {string} message JSON格式的消息
     */
    sendWebSocketMessage(message) {
        try {
            // 检查WebSocket连接状态
            if (!this._chatClient) {
                console.error('[WebSocket调试] 未创建WebSocket连接');
                throw new Error('未连接到聊天服务器');
            }
            
            // 输出WebSocket连接状态
            const states = {
                0: 'CONNECTING',
                1: 'OPEN',
                2: 'CLOSING',
                3: 'CLOSED'
            };
            
            console.log('[WebSocket调试] 当前连接状态:', states[this._chatClient.readyState], `(${this._chatClient.readyState})`);
            
            if (this._chatClient.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket连接未就绪，当前状态: ' + states[this._chatClient.readyState]);
            }
            
            // 尝试解析消息，检查格式是否正确
            let messageObj;
            try {
                messageObj = JSON.parse(message);
                console.log('[WebSocket调试] 消息解析成功:', {
                    类型: messageObj.type,
                    动作: messageObj.action,
                    会议ID: messageObj.conferenceId,
                    音频数据长度: messageObj.audioData ? messageObj.audioData.length : 0
                });
            } catch (parseError) {
                console.error('[WebSocket调试] 消息解析失败:', parseError);
                // 即使解析失败也继续发送，因为可能是特殊格式
            }
            
            // 发送消息
            this._chatClient.send(message);
            console.log('[WebSocket调试] 消息已发送，大小:', message.length, '字节');
            
            // 针对音频流和会议消息的特殊处理
            if (messageObj) {
                if (messageObj.type === 'audioStream') {
                    console.log('[WebSocket调试] 已发送音频流数据，序列号:', messageObj.sequence);
                } else if (messageObj.type === 'voiceConference') {
                    console.log('[WebSocket调试] 已发送会议消息:', {
                        动作: messageObj.action,
                        会议ID: messageObj.conferenceId,
                        静音状态: messageObj.muted
                    });
                }
            }
        } catch (error) {
            console.error('[WebSocket调试] 发送WebSocket消息失败:', error);
            vscode.window.showErrorMessage(`发送消息失败: ${error.message}`);
            
            // 通知前端发送失败
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'webSocketError',
                    error: error.message
                });
            }
        }
    }

    // 接收WebSocket消息并转发到前端的处理函数
    onWebSocketMessage(ws, message) {
        try {
            // 将消息解析为对象
            const messageObj = JSON.parse(message);
            const messageType = messageObj.type;
            
            console.log(`[WebSocket] 收到消息类型: ${messageType}`);
            
            // 处理音频流消息
            if (messageType === 'audioStream') {
                console.log(`[WebSocket] 收到音频流数据, 序列号: ${messageObj.sequence}, 数据长度: ${messageObj.audioData ? messageObj.audioData.length : 0} 字节`);
                
                // 直接转发音频流消息到前端
                if (this._webviewView) {
                    this._webviewView.webview.postMessage({
                        command: 'forwardWebSocketMessage',
                        wsMessage: messageObj
                    });
                }
            }
            
            // 处理其它类型的消息...
            else if (messageType === 'voiceConference') {
                // 转发会议相关消息
                if (this._webviewView) {
                    this._webviewView.webview.postMessage({
                        command: 'forwardWebSocketMessage',
                        wsMessage: messageObj
                    });
                }
            }
            
            // ... 处理其他消息类型 ...
            
        } catch (error) {
            console.error('[WebSocket] 处理消息时出错:', error);
        }
    }
}

module.exports = LingxiSidebarProvider;