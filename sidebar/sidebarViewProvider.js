const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
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
        this._remoteCanvasDir = path.join(context.globalStoragePath, 'remote_canvas');
        
        // 确保远程画布目录存在
        if (!fs.existsSync(this._remoteCanvasDir)) {
            fs.mkdirSync(this._remoteCanvasDir, { recursive: true });
        }
        
        // 添加视图状态存储变量
        this._viewState = {
            activeTab: 'collab-area',
            activeInnerTab: 'chat',
            chatMessages: [],
            agentMessages: [],
            canvasList: [],
            mcpServerStatus: '未启动',
            chatServerConnected: false
        };
        
        // 设置WebSocket消息处理
        this.setupWebSocketHandlers();
    }

    /**
     * 设置WebSocket消息处理器
     */
    setupWebSocketHandlers() {
        console.log('cccccccccccc');
        if (this._chatClient) {
            console.log('dddddddddddd');
            // 添加重连机制
            this._chatClient.onclose = () => {
                console.log('WebSocket连接已关闭，尝试重连...');
                setTimeout(() => {
                    if (this._chatClient && this._chatClient.readyState === WebSocket.CLOSED) {
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
                    console.log('收到原始WebSocket消息类型:', typeof event.data);
                    console.log('消息长度:', event.data.length);
                
                    const message = JSON.parse(event.data);
                    console.log('解析后的消息类型:', message.type);

                    // 处理不同类型的消息
                    switch (message.type) {
                        case 'message':
                            this.handleChatMessage(message);
                            if (message.content) {
                                console.log('处理聊天消息:', message.content);
                                console.log('消息发送者:', message.sender);
                                console.log('消息内容类型:', typeof message.content);
                                
                                // 检测消息的 content 部分是否包含画布链接
                                // 允许http或https，支持IP地址或域名，可选端口号
                                const canvasLinkMatch = message.content.match(/https?:\/\/([^\/]+)\/canvas\/([^"\s]+)/);
                                console.log('消息链接匹配结果:', canvasLinkMatch);
                                
                                if (canvasLinkMatch) {
                                    const serverAddress = canvasLinkMatch[1]; // 第一个捕获组是服务器地址(包含可选端口号)
                                    const canvasId = canvasLinkMatch[2]; // 第二个捕获组是画布ID
                                    console.log('检测到画布链接，服务器:', serverAddress);
                                    console.log('检测到画布链接，ID:', canvasId);
                                    
                                    console.log(1145141919810);
                                    console.log(1145141919810);
                                    console.log(1145141919810);
                                    console.log(1145141919810);

                                    // 询问用户是否下载远程画布
                                    const senderName = message.sender && message.sender.name ? message.sender.name : '其他用户';
                                    const answer = await vscode.window.showInformationMessage(
                                        `${senderName} 分享了一个画布，是否下载并打开？`,  
                                        '下载并打开', '忽略'
                                    );

                                    
                                    if (answer === '下载并打开') {
                                        // 构造完整链接
                                        const fullLink = `http://${serverAddress}/canvas/${canvasId}`;
                                        console.log('提取的完整链接:', fullLink);
                                        
                                        // 下载远程画布
                                        await this.downloadRemoteCanvas(canvasId, fullLink);
                                    }
                                } else {
                                    console.log('未在消息中找到画布链接');
                                }
                                
                                // 移除重复发送的代码，因为handleChatMessage方法中已经处理了消息发送
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
                            // 处理所有语音消息，包括当前用户自己发送的
                                this._webviewView.webview.postMessage({
                                    command: 'addAudioMessage',
                                message
                                });
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
            
            // 确保内容是JSON格式
            let jsonContent;
            if (typeof content === 'string') {
                try {
                    jsonContent = JSON.parse(content);
                } catch (e) {
                    console.error('解析JSON内容失败:', e);
                    jsonContent = content;
                }
            } else {
                jsonContent = content;
            }

            // 确保jsonContent是有效的Excalidraw格式
            if (typeof jsonContent === 'object') {
                if (!jsonContent.type) {
                    jsonContent.type = "excalidraw";
                }
                if (!jsonContent.version) {
                    jsonContent.version = 2;
                }
                if (!jsonContent.elements) {
                    jsonContent.elements = [];
                }
                if (!jsonContent.appState) {
                    jsonContent.appState = {
                        viewBackgroundColor: "#ffffff",
                        currentItemFontFamily: 1,
                        gridSize: null,
                        theme: "light"
                    };
                }
            }
            
            // 将内容写入临时文件
            const contentToWrite = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent, null, 2);
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(tempFile),
                Buffer.from(contentToWrite, 'utf8')
            );

            // 直接使用Excalidraw打开文件
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tempFile));
            
            // 延长临时文件保存时间到30分钟
            setTimeout(async () => {
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(tempFile));
                } catch (error) {
                    console.error('删除临时预览文件失败:', error);
                }
            }, 30 * 60 * 1000);
        } catch (error) {
            console.error('预览画布失败:', error);
            vscode.window.showErrorMessage(`预览画布失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 自动保存文件
     * @param {string} filePath 文件路径
     * @returns {Promise<boolean>} 保存是否成功
     */
    async autoSaveFile(filePath) {
        try {
            console.log('尝试自动保存文件:', filePath);
            
            // 强制保存所有打开的文档
            const success = await vscode.workspace.saveAll(false);
            
            if (success) {
                console.log('所有文档已保存成功，包括:', filePath);
                
                // 为确保操作之间有足够间隔，等待短暂时间
                await new Promise(resolve => setTimeout(resolve, 300));
                
                return true;
            } else {
                console.log('文档保存可能失败，继续执行操作');
                return true; // 继续执行，这样既使保存失败也不会阻止后续操作
            }
        } catch (error) {
            console.error('自动保存文件失败:', error);
            // 即使保存失败，我们仍然返回true以允许继续执行操作
            return true;
        }
    }

    /**
     * 提交画布到协作服务器
     * @param {string} path 画布文件路径
     * @param {string} name 画布文件名
     */
    async submitCanvas(path, name) {
        try {
            // 尝试自动保存文件
            await this.autoSaveFile(path);
            
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
                
                // 构造要发送的画布内容消息
                const message = {
                    type: 'canvas',
                    action: 'submit',
                    fileName: name,
                    filePath: path,
                    content: contentStr,
                    canvasId: canvasId,
                    timestamp: Date.now()
                };
                
                // 发送画布内容
                this._chatClient.send(JSON.stringify(message));

                // 创建画布链接，使用当前连接的主机地址
                const canvasLink = `http://${host}/canvas/${canvasId}`;
                
                // 构造并发送聊天消息
                const linkMessage = {
                    type: 'message',
                    content: `我提交了一个新的画布 "${name}"，可以通过以下链接访问：${canvasLink}`,
                    timestamp: Date.now(),
                    sender: {
                        id: `user_${Date.now()}`,
                        name: this._userName || '当前用户'
                    }
                };
                
                // 发送链接消息
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
     * @param {string} filePath 当前画布文件路径
     * @param {string} name 当前画布文件名
     */
    async pullCanvas(filePath, name) {
        try {
            // 尝试自动保存文件
            await this.autoSaveFile(filePath);
            
            // 获取所有远程画布文件
            const remoteFiles = await this.getRemoteCanvasFiles();
            
            if (remoteFiles.length === 0) {
                vscode.window.showInformationMessage('没有可用的远程画布');
                return;
            }

            // 显示远程画布选择列表
            const items = remoteFiles.map(file => ({
                label: `画布_${file.id}.excalidraw`,
                description: `远程画布 (${new Date(file.timestamp).toLocaleString()})`,
                detail: `ID: ${file.id}`,
                file: file
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要合并的远程画布'
            });

            if (!selected) {
                vscode.window.showInformationMessage('已取消拉取操作');
                return;
            }

            // 显示正在拉取的提示
            const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
            statusBarItem.text = "$(sync~spin) 正在合并画布...";
            statusBarItem.show();

            try {
                // 读取远程画布内容
                const remoteContent = await vscode.workspace.fs.readFile(vscode.Uri.file(selected.file.path));
                let remoteJson;
                try {
                    remoteJson = JSON.parse(Buffer.from(remoteContent).toString('utf8'));
                } catch (error) {
                    console.error('解析远程画布内容失败:', error);
                    throw new Error('远程画布内容格式错误');
                }

                // 读取当前文件内容
                const currentContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                let currentJson;
                try {
                    currentJson = JSON.parse(Buffer.from(currentContent).toString('utf8'));
                } catch (error) {
                    console.error('解析当前文件内容失败:', error);
                    throw new Error('当前文件内容格式错误');
                }

                // 检查是否存在ID冲突
                const currentIds = new Map();
                currentJson.elements.forEach(element => {
                    currentIds.set(element.id, element);
                });

                // 冲突检测
                const conflicts = [];
                remoteJson.elements.forEach(remoteElement => {
                    if (currentIds.has(remoteElement.id)) {
                        const currentElement = currentIds.get(remoteElement.id);
                        // 检查元素是否相同
                        if (!this.areElementsEqual(currentElement, remoteElement)) {
                            conflicts.push({
                                id: remoteElement.id,
                                current: currentElement,
                                remote: remoteElement
                            });
                        }
                    }
                });

                if (conflicts.length > 0) {
                    console.log(`检测到 ${conflicts.length} 个ID冲突`);
                    
                    // 创建临时目录（如果不存在）
                    const pathModule = require('path');
                    const tempDir = path.join(this._context.globalStoragePath, 'temp_previews');
                    if (!fs.existsSync(tempDir)) {
                        fs.mkdirSync(tempDir, { recursive: true });
                    }
                    
                    const originalDir = pathModule.dirname(filePath);
                    const fileNameWithoutExt = name.replace('.excalidraw', '');
                    const timestamp = Date.now().toString().slice(-6);
                    
                    // 版本1：使用当前文件的冲突元素（本地优先）
                    const version1Json = JSON.parse(JSON.stringify(currentJson));
                    const mergedElements1 = [...version1Json.elements];
                    
                    // 添加不冲突的远程元素
                    remoteJson.elements.forEach(remoteElement => {
                        if (!currentIds.has(remoteElement.id)) {
                            mergedElements1.push(remoteElement);
                        }
                    });
                    
                    version1Json.elements = mergedElements1;
                    // 保存到临时目录
                    const version1FileName = `本地优先_${timestamp}.excalidraw`;
                    const version1Path = pathModule.join(tempDir, version1FileName);
                    
                    // 版本2：使用远程文件的冲突元素（远程优先）
                    const version2Json = JSON.parse(JSON.stringify(currentJson));
                    const mergedElements2 = version2Json.elements.filter(element => 
                        !conflicts.some(conflict => conflict.id === element.id)
                    );
                    
                    // 添加所有远程元素
                    remoteJson.elements.forEach(remoteElement => {
                        mergedElements2.push(remoteElement);
                    });
                    
                    version2Json.elements = mergedElements2;
                    // 保存到临时目录
                    const version2FileName = `远程优先_${timestamp}.excalidraw`;
                    const version2Path = pathModule.join(tempDir, version2FileName);
                    
                    // 保存两个临时版本
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(version1Path),
                        Buffer.from(JSON.stringify(version1Json, null, 2), 'utf8')
                    );
                    
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(version2Path),
                        Buffer.from(JSON.stringify(version2Json, null, 2), 'utf8')
                    );
                    
                    // 为了便于用户对比，同时打开两个临时预览，确保在不同窗口中打开
                    // 先打开第一个文件（本地优先版本）
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(version1Path));

                    // 显示冲突提示并让用户选择要保存的最终版本
                    vscode.window.showInformationMessage(
                        `检测到 ${conflicts.length} 个ID冲突，已打开本地优先版本。请选择操作：`,
                        '查看远程优先版本',
                        '保存本地优先版本',
                        '保存远程优先版本',
                        '取消'
                    ).then(async selected => {
                        if (selected === '查看远程优先版本') {
                            // 使用与新建画布相同的方式打开远程优先版本
                            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(version2Path));

                            // 确保文件被正确打开
                            await new Promise(resolve => setTimeout(resolve, 1000));

                            // 再次显示选择提示
                            vscode.window.showInformationMessage(
                                `请选择要保存的最终版本：`,
                                '保存本地优先版本',
                                '保存远程优先版本',
                                '取消'
                            ).then(async finalSelected => {
                                let finalJson;
                                if (finalSelected === '保存本地优先版本') {
                                    finalJson = version1Json;
                                } else if (finalSelected === '保存远程优先版本') {
                                    finalJson = version2Json;
                                } else {
                                    vscode.window.showInformationMessage('已取消合并操作');
                                    return;
                                }
                                
                                // 创建最终合并文件名
                                const mergedFileName = `${fileNameWithoutExt}_merged_${timestamp}.excalidraw`;
                                const mergedFilePath = pathModule.join(originalDir, mergedFileName);
                                
                                // 保存最终合并文件
                                await vscode.workspace.fs.writeFile(
                                    vscode.Uri.file(mergedFilePath),
                                    Buffer.from(JSON.stringify(finalJson, null, 2), 'utf8')
                                );
                                
                                // 打开最终合并文件
                                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(mergedFilePath));
                                vscode.window.showInformationMessage(`已创建并打开合并画布: ${mergedFileName}`);
                            });
                        } else if (selected === '保存本地优先版本') {
                            finalJson = version1Json;
                        } else if (selected === '保存远程优先版本') {
                            finalJson = version2Json;
                        } else {
                            vscode.window.showInformationMessage('已取消合并操作');
                            return;
                        }
                        
                        // 创建最终合并文件名
                        const mergedFileName = `${fileNameWithoutExt}_merged_${timestamp}.excalidraw`;
                        const mergedFilePath = pathModule.join(originalDir, mergedFileName);
                        
                        // 保存最终合并文件
                        await vscode.workspace.fs.writeFile(
                            vscode.Uri.file(mergedFilePath),
                            Buffer.from(JSON.stringify(finalJson, null, 2), 'utf8')
                        );
                        
                        // 打开最终合并文件
                        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(mergedFilePath));
                        vscode.window.showInformationMessage(`已创建并打开合并画布: ${mergedFileName}`);
                    });
                } else {
                    // 无冲突，执行常规合并
                // 合并elements数组，只保留id不同的元素
                const mergedElements = [...currentJson.elements];
                const existingIds = new Set(currentJson.elements.map(e => e.id));
                
                    remoteJson.elements.forEach(element => {
                    if (!existingIds.has(element.id)) {
                        mergedElements.push(element);
                    }
                });

                    // 创建新的合并画布对象
                    const mergedJson = { ...currentJson };
                    mergedJson.elements = mergedElements;
                    
                    // 获取原始文件所在目录和文件名（不带扩展名）
                    const pathModule = require('path');
                    const originalDir = pathModule.dirname(filePath);
                    const fileNameWithoutExt = name.replace('.excalidraw', '');
                    
                    // 使用简单的命名方式
                    const timestamp = Date.now().toString().slice(-6);
                    const newFileName = `${fileNameWithoutExt}_merged_${timestamp}.excalidraw`;
                    const newFilePath = pathModule.join(originalDir, newFileName);
                    
                    console.log('新画布将保存至:', newFilePath);

                    // 保存合并后的内容到新文件
                await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(newFilePath),
                        Buffer.from(JSON.stringify(mergedJson, null, 2), 'utf8')
                );

                // 打开合并后的文件
                    const uri = vscode.Uri.file(newFilePath);
                await vscode.commands.executeCommand('vscode.open', uri);
                    vscode.window.showInformationMessage(`已创建并打开合并画布: ${newFileName}`);
                }

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
     * 比较两个元素是否相同
     * @param {Object} element1 第一个元素
     * @param {Object} element2 第二个元素
     * @returns {boolean} 是否相同
     */
    areElementsEqual(element1, element2) {
        // 简单比较：将元素转为JSON字符串比较
        // 忽略可能会自然变化的属性，如随机种子、版本号等
        const compareElement1 = { ...element1 };
        const compareElement2 = { ...element2 };
        
        // 忽略这些属性
        const ignoreProps = ['seed', 'versionNonce', 'version', 'updated'];
        ignoreProps.forEach(prop => {
            delete compareElement1[prop];
            delete compareElement2[prop];
        });
        
        return JSON.stringify(compareElement1) === JSON.stringify(compareElement2);
    }

    /**
     * 向 Webview 发送剪贴板历史记录
     */
    // sendClipboardHistory() { ... } // 整个函数移除

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
            // 检查是否为当前用户发送的消息
            if (message.type === 'message'|| message.type === 'system') {
                const isFromCurrentUser = message.sender && 
                                         message.sender.id && 
                                         this._userId && 
                                         message.sender.id === this._userId;
                
                if (isFromCurrentUser) {
                    console.log('已忽略当前用户自己发送的文字消息:', message.content);
                    return; // 不向前端发送当前用户自己的消息
                }
                
                // 不是当前用户的消息，正常发送
                this._webviewView.webview.postMessage({
                    command: 'addChatMessage',
                    message
                });
            } else if (message.type === 'system') {
                // 系统消息正常显示
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
                // 处理所有语音消息，包括当前用户自己发送的
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
     * 下载远程画布到临时目录
     * @param {string} canvasId 画布ID
     * @param {string} canvasUrl 画布URL
     */
    async downloadRemoteCanvas(canvasId, canvasUrl) {
        try {
            console.log('开始下载远程画布:', { canvasId, canvasUrl });
            
            if (!canvasId || !canvasUrl) {
                console.error('画布ID或URL为空:', { canvasId, canvasUrl });
                throw new Error('画布ID或URL不能为空');
            }
            
            // 下载画布内容
            console.log('发起axios请求:', canvasUrl);
            let response;
            try {
                response = await axios.get(canvasUrl, {
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': 'VSCode-Extension'
                    },
                    timeout: 10000, // 10秒超时
                    validateStatus: function (status) {
                        // 允许所有状态码通过，我们会手动处理错误
                        return true;
                    }
                });
                console.log('画布下载响应状态:', response.status);
                
                // 处理不同的状态码
                if (response.status === 404) {
                    console.error('画布不存在或已过期');
                    
                    // 显示错误信息，并询问用户是否创建本地画布
                    const answer = await vscode.window.showErrorMessage(
                        `远程画布 ${canvasId} 不存在或已过期，是否创建本地画布？`, 
                        '是', '否'
                    );
                    
                    if (answer === '是') {
                        // 创建本地空白画布
                        await this.createLocalCanvas(canvasId);
                        return; // 退出函数，不继续尝试下载
        } else {
                        throw new Error('远程画布不存在或已过期');
                    }
                } else if (response.status !== 200) {
                    console.error('响应状态不正确:', response.status, response.statusText);
                    throw new Error(`下载画布失败: ${response.status} ${response.statusText}`);
                }
            } catch (axiosError) {
                console.error('axios请求失败:', axiosError);
                
                // 如果是网络错误，给出更友好的提示
                if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                    const serverAddress = canvasUrl.split('/')[2];
                    const errorMsg = `无法连接到服务器 ${serverAddress}，请确认服务器地址正确且已启动`;
                    
                    // 询问用户是否创建本地画布
                    const answer = await vscode.window.showErrorMessage(
                        `${errorMsg}，是否创建本地画布？`, 
                        '是', '否'
                    );
                    
                    if (answer === '是') {
                        // 创建本地空白画布
                        await this.createLocalCanvas(canvasId);
                        return; // 退出函数，不继续尝试下载
                    } else {
                        throw new Error(errorMsg);
                    }
                } else if (axiosError.code === 'ETIMEDOUT') {
                    throw new Error(`连接服务器超时，请检查网络连接或服务器负载`);
                } else {
                    throw new Error(`请求画布失败: ${axiosError.message}`);
                }
            }

            let content;
            try {
                content = response.data;
                
                // 检查内容是否为空
                if (!content) {
                    throw new Error('画布内容为空');
                }
                
                // 如果内容是字符串但可能是JSON，尝试解析它
                if (typeof content === 'string') {
                    try {
                        const jsonContent = JSON.parse(content);
                        content = jsonContent;
                        console.log('成功解析JSON内容');
                    } catch (jsonError) {
                        // 不是有效的JSON，保持字符串格式
                        console.log('内容不是有效的JSON，保持字符串格式');
                    }
                }
                
                console.log('画布内容类型:', typeof content);
                if (typeof content === 'object') {
                    console.log('画布内容预览:', JSON.stringify(content).substring(0, 100) + '...');
                } else if (typeof content === 'string') {
                    console.log('画布内容长度:', content.length);
                    console.log('画布内容预览:', content.substring(0, 100) + '...');
                } else {
                    console.log('未知格式的画布内容:', typeof content);
                }
            } catch (contentError) {
                console.error('处理画布内容时出错:', contentError);
                throw new Error(`处理画布内容失败: ${contentError.message}`);
            }
            
            // 确保远程画布目录存在
            if (!fs.existsSync(this._remoteCanvasDir)) {
                fs.mkdirSync(this._remoteCanvasDir, { recursive: true });
            }
            
            // 保存到临时文件
            const tempFilePath = path.join(this._remoteCanvasDir, `remote_${canvasId}.excalidraw`);
            console.log('保存画布到临时文件:', tempFilePath);
            
            try {
                // 如果内容是对象，将其转换为字符串
                const contentToSave = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(tempFilePath),
                    Buffer.from(contentToSave, 'utf8')
                );
                console.log(`远程画布已成功保存到: ${tempFilePath}`);
                
                // 通知用户
                vscode.window.showInformationMessage(`已下载远程画布: ${canvasId}`);
                
                // 自动打开下载的画布文件
                const uri = vscode.Uri.file(tempFilePath);
                await vscode.commands.executeCommand('vscode.open', uri);
            } catch (writeError) {
                console.error('保存画布文件失败:', writeError);
                throw new Error(`保存画布文件失败: ${writeError.message}`);
            }
        } catch (error) {
            console.error('下载远程画布失败:', error);
            vscode.window.showErrorMessage(`下载远程画布失败: ${error.message}`);
        }
    }

    /**
     * 创建本地空白画布
     * @param {string} canvasId 画布ID
     * @returns {Promise<string>} 创建的画布路径
     */
    async createLocalCanvas(canvasId) {
        try {
            console.log('开始创建本地画布:', canvasId);
            
            // 创建空白画布内容 - 使用与submitCanvas方法相同的格式
            const emptyCanvas = {
                type: "excalidraw",
                version: 2,
                source: "VS Code 灵犀协作",
                elements: [],
                appState: {
                    viewBackgroundColor: "#ffffff",
                    currentItemFontFamily: 1,
                    gridSize: null,
                    theme: "light"
                },
                files: {}
            };
            
            // 确保远程画布目录存在
            if (!fs.existsSync(this._remoteCanvasDir)) {
                fs.mkdirSync(this._remoteCanvasDir, { recursive: true });
            }
            
            // 为了让ID格式保持一致，如果ID不是canvas_开头的，则添加canvas_前缀
            const formattedCanvasId = canvasId.startsWith('canvas_') ? 
                canvasId : 
                `canvas_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            
            // 保存到临时文件
            const localFilePath = path.join(this._remoteCanvasDir, `local_${formattedCanvasId}.excalidraw`);
            console.log('保存本地画布到文件:', localFilePath);
            
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(localFilePath),
                Buffer.from(JSON.stringify(emptyCanvas, null, 2), 'utf8')
            );
            
            console.log(`本地画布已成功创建: ${localFilePath}`);
            vscode.window.showInformationMessage(`已创建本地画布: ${formattedCanvasId}`);
            
            // 自动打开创建的画布文件
            const uri = vscode.Uri.file(localFilePath);
            await vscode.commands.executeCommand('vscode.open', uri);
            
            return localFilePath;
        } catch (error) {
            console.error('创建本地画布失败:', error);
            vscode.window.showErrorMessage(`创建本地画布失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取所有远程画布文件
     * @returns {Promise<Array<{id: string, path: string, timestamp: number}>>}
     */
    async getRemoteCanvasFiles() {
        try {
            console.log('开始获取远程画布文件列表');
            console.log('远程画布目录:', this._remoteCanvasDir);
            
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this._remoteCanvasDir));
            console.log('目录中的文件列表:', files);
            
            const remoteFiles = [];

            for (const [fileName, fileType] of files) {
                console.log('处理文件:', { fileName, fileType });
                
                if (fileType === vscode.FileType.File && fileName.startsWith('remote_') && fileName.endsWith('.excalidraw')) {
                    const filePath = path.join(this._remoteCanvasDir, fileName);
                    const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                    const canvasId = fileName.replace('remote_', '').replace('.excalidraw', '');
                    
                    console.log('找到远程画布文件:', {
                        fileName,
                        filePath,
                        canvasId,
                        timestamp: fileStat.mtime
                    });
                    
                    remoteFiles.push({
                        id: canvasId,
                        path: filePath,
                        timestamp: fileStat.mtime
                    });
                }
            }

            console.log('找到的远程画布文件数量:', remoteFiles.length);
            // 按时间戳降序排序
            const sortedFiles = remoteFiles.sort((a, b) => b.timestamp - a.timestamp);
            console.log('排序后的远程画布文件:', sortedFiles);
            
            return sortedFiles;
        } catch (error) {
            console.error('获取远程画布文件失败:', error);
            return [];
        }
    }

    /**
     * 处理Agent查询
     * @param {string} query 查询内容
     * @param {string} thinkingId 思考状态元素ID
     */
    async handleAgentQuery(query, thinkingId) {
        try {
            // 保存查询消息到状态
            if (!this._viewState.agentMessages) {
                this._viewState.agentMessages = [];
            }
            
            // 添加用户消息到状态
            this._viewState.agentMessages.push({
                role: 'user',
                content: query,
                timestamp: Date.now()
            });
            
            // 调用 agentApi 的 handleAgentQuery 方法处理查询
            console.log('调用 agentApi.handleAgentQuery：', query);
            const response = await agentApi.handleAgentQuery(query);
            console.log('Agent响应:', response);
            
            // 将响应保存到状态
            this._viewState.agentMessages.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            });
            
            // 发送响应到前端
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'agentResponse',
                    thinkingId: thinkingId,
                    result: response
                });
            }
        } catch (error) {
            console.error('处理Agent查询失败:', error);
            
            // 出错时也需要通知前端
            if (this._webviewView) {
                this._webviewView.webview.postMessage({
                    command: 'agentResponse',
                    thinkingId: thinkingId,
                    result: `错误: ${error.message || '未知错误'}`
                });
            }
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
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'sidebar')],
            retainContextWhenHidden: true  // 添加这个选项以在隐藏时保留Webview内容
        };
        webviewView.webview.html = this.getHtmlForWebview();
        
        // 监听Webview可见性变化
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                console.log('灵犀协作侧边栏变为可见，恢复状态');
                this.restoreViewState();
            }
        });
        
        // 监听Webview消息
        this.setupMessageListeners(this._context);

        // 初始化API配置并立即向前端发送状态
        this.initializeApiConfiguration().then(() => {
            // 已在initializeApiConfiguration中向前端传递状态
        }).catch(error => {
            console.error('初始化API配置失败:', error);
        });

        // 监听 webview 消息，实现 clipboardHistory 同步
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'switchTab') {
                // 保存当前活动标签页状态
                this._viewState.activeTab = message.tabId;
                
                if (message.tabId === 'canvas') {
                    // 切换到 Canvas 标签页时加载画布列表
                    this.sendCanvasList();
                }
                this.handleTabSwitch(message.tabId);
            } else if (message.command === 'switchInnerTab') {
                // 保存当前活动内部标签页状态
                this._viewState.activeInnerTab = message.innerTabId;
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
            } else if (message.command === 'requestMemoFilePick') {
                const files = message.files || [];
                if (files.length === 0) return;
                // 构造 QuickPickItems
                const items = files.map(f => ({ label: f, description: '', detail: f }));
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: '请选择要总结的会议纪要文件',
                    ignoreFocusOut: true
                });
                if (selected && selected.label) {
                    this._webviewView.webview.postMessage({ command: 'memoFilePicked', file: selected.label });
                }
                return;
            }
        });
    }

    /**
     * 初始化API配置
     */
    async initializeApiConfiguration() {
        try {
            // 不再从secrets加载API Key，但仍保留状态通知功能
            
            // 获取当前配置状态
            const config = agentApi.getConfig();
            const isDeepSeekKeySet = !!(config && config.deepseekApiKey);
            
            // 通知前端DeepSeek API Key状态
            if (this._webviewView) {
                this._webviewView.webview.postMessage({ 
                    command: 'deepseekApiKeyStatus', 
                    isSet: isDeepSeekKeySet 
                });
                
                // 同时通知常规状态
                this._webviewView.webview.postMessage({ 
                    command: 'apiKeyStatus', 
                    isSet: isDeepSeekKeySet  // 使用相同的状态，保持兼容性
                });
            }
        } catch (error) {
            console.error('初始化API配置失败:', error);
            throw error; // 重新抛出错误以便上层捕获
        }
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
        this._webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'switchTab':
                    if (message.tabId === 'canvas') {
                        // 切换到 Canvas 标签页时加载画布列表
                        this.sendCanvasList();
                    } else if (message.tabId === 'collab-area') {
                        // 切换到协作区标签页时的处理
                        this.handleCollabAreaTab();
                    }
                    this.handleTabSwitch(message.tabId);
                    break;
                case 'switchInnerTab':
                    // 处理内部标签切换
                    this.saveViewState('activeInnerTab', message.innerTabId);
                    break;
                case 'saveViewState':
                    // 处理保存视图状态的请求
                    if (message.key) {
                        this.saveViewState(message.key, message.value);
                    }
                    break;
                case 'createCanvas':
                    // 调用创建Excalidraw画布的命令
                    vscode.commands.executeCommand('lingxixiezuo.createExcalidraw');
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
                    // 通过WebSocket发送消息
                    if (this._chatClient && this._chatClient.readyState === WebSocket.OPEN) {
                        try {
                            const chatMsg = {
                                type: 'message',
                                content: message.message
                            };
                            this._chatClient.send(JSON.stringify(chatMsg));
                            console.log('已发送消息:', message.message);
                        } catch (error) {
                            console.error('发送聊天消息失败:', error);
                        }
                    } else {
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
                case 'runAsrTest':
                    // 运行ASR测试程序
                    vscode.commands.executeCommand('lingxixiezuo.runAsrTest', {
                        outputFile: message.outputFile
                    });
                    // 通知前端ASR测试已启动
                    this._webviewView.webview.postMessage({
                        command: 'asrTestStarted',
                        outputFile: message.outputFile
                    });
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
                case 'saveApiKey': // 处理更新智谱API Key的消息
                    if (message.apiKey) {
                        try {
                            // 不再持久化存储API Key到secrets
                            // 只更新当前会话中的设置
                            console.log('正在保存智谱AI API Key...');
                            agentApi.updateConfig({ 
                                zhipuApiKey: message.apiKey 
                            }); // 直接使用zhipuApiKey参数而不是apiKey
                            vscode.window.showInformationMessage('智谱AI API Key 已保存至当前会话。');
                            
                            // 获取最新配置并检查状态
                            const config = agentApi.getConfig();
                            console.log('保存后的智谱AI配置:', config);
                            const isKeySet = !!(config && config.zhipuApiKey);
                            
                            // 通知 Webview 更新状态
                            this._webviewView.webview.postMessage({ 
                                command: 'apiKeyStatus', 
                                isSet: isKeySet
                            });
                            console.log('已发送智谱AI API Key状态更新:', isKeySet);
                        } catch (error) {
                            console.error('保存智谱API Key 失败:', error);
                            vscode.window.showErrorMessage('保存智谱AI API Key 失败。');
                        }
                    }
                    break;
                case 'saveDeepSeekApiKey': // 处理更新DeepSeek API Key的消息
                    if (message.apiKey) {
                        try {
                            // 不再持久化存储API Key到secrets
                            // 只更新当前会话中的设置
                            console.log('正在保存DeepSeek API Key...');
                            agentApi.updateConfig({ 
                                deepseekApiKey: message.apiKey 
                            }); // 更新 agentApi 配置
                            vscode.window.showInformationMessage('DeepSeek API Key 已保存至当前会话。');
                            
                            // 获取最新配置并检查状态
                            const config = agentApi.getConfig();
                            console.log('保存后的DeepSeek配置:', config);
                            const isKeySet = !!(config && config.deepseekApiKey);
                            
                            // 通知 Webview 更新状态
                            this._webviewView.webview.postMessage({ 
                                command: 'deepseekApiKeyStatus', 
                                isSet: isKeySet
                            });
                            console.log('已发送DeepSeek API Key状态更新:', isKeySet);
                        } catch (error) {
                            console.error('保存DeepSeek API Key 失败:', error);
                            vscode.window.showErrorMessage('保存DeepSeek API Key 失败。');
                        }
                    }
                    break;
                case 'setAIProvider': // 处理AI提供商切换
                    // 所有提供商均设置为deepseek
                    try {
                        // 更新提供商配置
                        const updateConfig = { provider: 'deepseek' };
                        
                        // 如果同时传入了model，一并更新
                        if (message.model) {
                            updateConfig.deepseekModel = message.model;
                        }
                        
                        // 更新配置
                        agentApi.updateConfig(updateConfig);
                        console.log(`已设置为DeepSeek，模型: ${message.model || '默认'}`);
                        vscode.window.showInformationMessage(`已设置为DeepSeek模型。`);
                    } catch (error) {
                        console.error('设置DeepSeek提供商失败:', error);
                        vscode.window.showErrorMessage('设置DeepSeek提供商失败。');
                    }
                    break;
                case 'setAIModel': // 处理模型选择
                    // 移除处理智谱AI模型选择，所有模型均设置为deepseek模型
                    if (message.model) {
                        try {
                            agentApi.updateConfig({ deepseekModel: message.model });
                            console.log(`已切换DeepSeek模型至: ${message.model}`);
                            vscode.window.showInformationMessage(`已切换至DeepSeek ${message.model} 模型。`);
                        } catch (error) {
                            console.error('更新DeepSeek模型失败:', error);
                            vscode.window.showErrorMessage('更新DeepSeek模型失败。');
                        }
                    }
                    break;
                case 'setDeepSeekModel': // 处理DeepSeek模型选择
                    if (message.model) {
                        try {
                            agentApi.updateConfig({ deepseekModel: message.model });
                            console.log(`已切换DeepSeek模型至: ${message.model}`);
                            vscode.window.showInformationMessage(`已切换至DeepSeek ${message.model} 模型。`);
                        } catch (error) {
                            console.error('更新DeepSeek模型失败:', error);
                            vscode.window.showErrorMessage('更新DeepSeek模型失败。');
                        }
                    }
                    break;
                case 'getApiKeyStatus': // 处理获取API Key状态的消息，重定向到DeepSeek
                    // 重定向到DeepSeek API Key状态
                    try {
                        const config = agentApi.getConfig();
                        console.log('检查DeepSeek API Key状态:', config);
                        const isKeySet = !!(config && config.deepseekApiKey);
                        console.log('DeepSeek API Key是否已设置:', isKeySet);
                        this._webviewView.webview.postMessage({ 
                            command: 'apiKeyStatus', 
                            isSet: isKeySet 
                        });
                    } catch (error) {
                        console.error('获取DeepSeek API Key状态失败:', error);
                        this._webviewView.webview.postMessage({ 
                            command: 'apiKeyStatus', 
                            isSet: false,
                            error: error.message
                        });
                    }
                    break;
                case 'getDeepSeekApiKeyStatus': // 处理获取DeepSeek API Key 状态的消息
                    // 检查API Key是否已设置 - 直接检查config对象
                    try {
                        const config = agentApi.getConfig();
                        console.log('检查DeepSeek API Key状态:', config);
                        const isDeepSeekKeySet = !!(config && config.deepseekApiKey);
                        console.log('DeepSeek API Key是否已设置:', isDeepSeekKeySet);
                        this._webviewView.webview.postMessage({ 
                            command: 'deepseekApiKeyStatus', 
                            isSet: isDeepSeekKeySet 
                        });
                    } catch (error) {
                        console.error('获取DeepSeek API Key状态失败:', error);
                        this._webviewView.webview.postMessage({ 
                            command: 'deepseekApiKeyStatus', 
                            isSet: false,
                            error: error.message
                        });
                    }
                    break;
                case 'toggleMcpServer': // 处理MCP服务器启用/禁用
                    if (message.isEnabled) {
                        try {
                            // 使用扩展上下文路径找到服务器脚本
                            // 构建服务器脚本的绝对路径
                            const serverPath = path.join(this._context.extensionPath, 'agent', 'server.js');
                            
                            console.log(`正在启动MCP服务器，脚本路径: ${serverPath}`);
                            
                            // 检查文件是否存在
                            if (!fs.existsSync(serverPath)) {
                                throw new Error(`服务器脚本文件不存在: ${serverPath}`);
                            }
                            
                            // 获取工作区目录
                            let workspaceDir = '';
                            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                workspaceDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                                console.log(`为MCP服务器提供工作区目录: ${workspaceDir}`);
                            }
                            
                            // 启动MCP服务器，传递工作区目录
                            await agentApi.connectToServer(serverPath, workspaceDir);
                            
                            // 通知前端更新状态
                            this._webviewView.webview.postMessage({ 
                                command: 'mcpServerStatus', 
                                status: '运行中'
                            });
                            
                            vscode.window.showInformationMessage('MCP服务器已启动');
                        } catch (error) {
                            console.error('启动MCP服务器失败:', error);
                            this._webviewView.webview.postMessage({ 
                                command: 'mcpServerStatus', 
                                status: '启动失败'
                            });
                            vscode.window.showErrorMessage(`启动MCP服务器失败: ${error.message}`);
                        }
                    } else {
                        try {
                            // 停止MCP服务器
                            console.log('正在停止MCP服务器');
                            agentApi.cleanup();
                            
                            // 通知前端更新状态
                            this._webviewView.webview.postMessage({ 
                                command: 'mcpServerStatus', 
                                status: '已停止'
                            });
                            
                            vscode.window.showInformationMessage('MCP服务器已停止');
                        } catch (error) {
                            console.error('停止MCP服务器失败:', error);
                            vscode.window.showErrorMessage(`停止MCP服务器失败: ${error.message}`);
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
                            
                            // 不再直接在前端显示本地消息，避免语音消息重复
                            // 服务器会回传消息，由handleChatMessage方法处理
                            if (success) {
                                console.log('语音消息发送成功，不显示本地回显，等待服务器回传');
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
                case 'addMemoToCanvas':
                    // 向画布添加纪要
                    await this.addMemoToCanvas();
                    break;
                case 'listMemoFiles': {
                    // 枚举 workspace/yuyin/output/ 下所有 meeting_*.txt 文件
                    let memoFiles = [];
                    try {
                        let searchDirs = [];
                        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                            searchDirs.push(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'yuyin', 'output'));
                        } else {
                            searchDirs.push(path.join(process.cwd(), 'yuyin', 'output'));
                        }
                        for (const dir of searchDirs) {
                            if (fs.existsSync(dir)) {
                                const files = fs.readdirSync(dir);
                                memoFiles = memoFiles.concat(files.filter(f => /^meeting_.*\.txt$/.test(f)));
                            }
                        }
                    } catch (e) {
                        console.error('查找纪要文件出错:', e);
                    }
                    this._webviewView.webview.postMessage({ command: 'memoFilesList', files: memoFiles });
                    break;
                }
                case 'aiSummaryMemo': {
                    // 读取指定纪要文件内容，调用 agentApi 的 deepseekV3 总结接口
                    const file = message.file;
                    let fileContent = '';
                    try {
                        // file 已为 yuyin/output/meeting_*.txt 的相对路径或文件名，需拼接 workspace/yuyin/output 路径
                        let filePath = file;
                        if (!path.isAbsolute(filePath)) {
                            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                                const dir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                                filePath = path.join(dir, 'yuyin', 'output', file);
                            } else {
                                filePath = path.join(process.cwd(), 'yuyin', 'output', file);
                            }
                        }
                        if (fs.existsSync(filePath)) {
                            fileContent = fs.readFileSync(filePath, 'utf8');
                        } else {
                            vscode.window.showErrorMessage('未找到文件: ' + file);
                            this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: '未找到文件: ' + file });
                            return;
                        }
                    } catch (e) {
                        vscode.window.showErrorMessage('读取文件失败: ' + e.message);
                        this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: '读取文件失败: ' + e.message });
                        return;
                    }
                    // 检查API Key
                    const config = agentApi.getConfig();
                    if (!config.deepseekApiKey) {
                        vscode.window.showErrorMessage('未配置API Key');
                        this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: '未配置API Key' });
                        return;
                    }
                    // 只取主要文本部分（如有需要可进一步提取）
                    let summary = '';
                    try {
                        summary = await agentApi.summarizeMemoWithDeepseek(fileContent);
                    } catch (e) {
                        vscode.window.showErrorMessage('AI总结失败: ' + e.message);
                        this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: 'AI总结失败: ' + e.message });
                        return;
                    }
                    if (!summary || typeof summary !== 'string' || summary.trim() === '') {
                        vscode.window.showErrorMessage('AI总结失败：未获得有效输出');
                        this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: 'AI总结失败：未获得有效输出' });
                        return;
                    }
                    // 解析会议编号
                    let meetingId = 'unknown';
                    const match = file.match(/meeting_(\d+)_transcript\.txt/);
                    if (match && match[1]) {
                        meetingId = match[1];
                    } else {
                        // 兼容 meeting_编号.txt
                        const match2 = file.match(/meeting_(\d+)\.txt/);
                        if (match2 && match2[1]) meetingId = match2[1];
                    }
                    // 构造保存路径
                    let savePath = '';
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        const dir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                        savePath = path.join(dir, 'yuyin', 'output', `meeting_summarized_${meetingId}.txt`);
                    } else {
                        savePath = path.join(process.cwd(), 'yuyin', 'output', `meeting_summarized_${meetingId}.txt`);
                    }
                    // 写入总结内容
                    try {
                        fs.writeFileSync(savePath, summary, 'utf8');
                        vscode.window.showInformationMessage(`AI总结结果已保存到: ${savePath}`);
                    } catch (e) {
                        vscode.window.showErrorMessage('保存AI总结结果失败: ' + e.message);
                        this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary: '保存AI总结结果失败: ' + e.message });
                        return;
                    }
                    // 通知前端
                    this._webviewView.webview.postMessage({ command: 'memoSummaryResult', summary });
                    return;
                }
            }
        });
    }

    /**
     * 处理标签页切换
     * @param {string} tabId 要切换到的标签页ID
     */
    handleTabSwitch(tabId) {
        // 保存当前活动的标签页
        this.saveViewState('activeTab', tabId);
        
        // 通知前端更新标签页
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
            },
            {
                label: '重命名画布',
                description: '修改画布文件名'
            },
            {
                label: '删除画布',
                description: '删除当前画布文件'
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
            } else if (selected.label === '重命名画布') {
                await this.renameCanvas(path, name);
            } else if (selected.label === '删除画布') {
                await this.deleteCanvas(path, name);
            }
        }
    }

    /**
     * 重命名画布文件
     * @param {string} path 画布文件路径
     * @param {string} name 画布文件名
     */
    async renameCanvas(path, name) {
        try {
            // 获取文件名（不含扩展名）
            const fileNameWithoutExt = name.replace('.excalidraw', '');
            
            // 显示输入框让用户输入新文件名
            const newName = await vscode.window.showInputBox({
                value: fileNameWithoutExt,
                prompt: '请输入新的画布名称',
                validateInput: (value) => {
                    if (!value) {
                        return '文件名不能为空';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return '文件名不能包含路径分隔符';
                    }
                    if (value.length > 100) {
                        return '文件名不能超过100个字符';
                    }
                    return null;
                }
            });

            if (!newName) {
                return; // 用户取消输入
            }

            // 构建新文件路径
            const newPath = path.replace(fileNameWithoutExt, newName);

            // 检查新文件名是否已存在
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
                vscode.window.showErrorMessage(`文件名 "${newName}.excalidraw" 已存在`);
                return;
            } catch (error) {
                // 文件不存在，可以继续重命名
            }

            // 如果文件当前正在编辑，先保存它
            const document = vscode.workspace.textDocuments.find(doc => doc.fileName === path);
            if (document) {
                await vscode.window.showTextDocument(document);
                await vscode.commands.executeCommand('workbench.action.files.save');
            }

            // 重命名文件
            await vscode.workspace.fs.rename(
                vscode.Uri.file(path),
                vscode.Uri.file(newPath)
            );

            // 刷新画布列表
            await this.sendCanvasList();

            vscode.window.showInformationMessage(`画布已重命名为 "${newName}.excalidraw"`);

            // 打开重命名后的文件
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(newPath));
        } catch (error) {
            console.error('重命名画布失败:', error);
            vscode.window.showErrorMessage(`重命名画布失败: ${error.message}`);
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
     * 恢复视图状态
     * 在Webview变为可见时调用以恢复之前的状态
     */
    restoreViewState() {
        if (!this._webviewView) {
            return;
        }
        
        console.log('恢复视图状态', this._viewState);
        
        // 恢复活动标签页
        this._webviewView.webview.postMessage({
            command: 'restoreState',
            state: this._viewState
        });
        
        // 重新发送各种数据
        // 移除sendClipboardHistory函数调用
        // 移除sendCanvasList函数调用
        
        // 重新发送API密钥状态
        this.initializeApiConfiguration().catch(err => {
            console.error('恢复API配置状态失败:', err);
        });
        
        // 如果之前连接了聊天服务器，恢复聊天服务器状态
        if (this._viewState.chatServerConnected && this._chatClient) {
            this._webviewView.webview.postMessage({
                command: 'chatServerStatus',
                status: 'connected',
                port: 3000, // 使用默认端口，或者保存实际端口
                ipAddress: 'localhost' // 使用默认地址，或者保存实际地址
            });
        }
        
        // 恢复MCP服务器状态
        this._webviewView.webview.postMessage({
            command: 'mcpServerStatus',
            status: this._viewState.mcpServerStatus
        });
    }

    /**
     * 存储视图状态
     * @param {string} key 状态键
     * @param {any} value 状态值
     */
    saveViewState(key, value) {
        if (this._viewState && key) {
            this._viewState[key] = value;
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
            console.log('workspaceFolders', workspaceFolders);
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
    /**
     * 获取最新的ASR结果文件
     * @returns {Promise<string|null>} 最新ASR结果文件的路径
     */
    async getLatestAsrResultFile() {
        try {
            // 获取工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                console.error('获取ASR结果文件失败: 未打开工作区');
                throw new Error('未打开工作区');
            }

            // 构建ASR输出目录路径
            const asrOutputDir = path.join(workspaceFolders[0].uri.fsPath, 'yuyin', 'output');
            console.log(`正在查找ASR结果文件，搜索目录: ${asrOutputDir}`);
            
            if (!fs.existsSync(asrOutputDir)) {
                console.error(`ASR输出目录不存在: ${asrOutputDir}`);
                // 尝试创建目录
                fs.mkdirSync(asrOutputDir, { recursive: true });
                console.log(`已创建ASR输出目录: ${asrOutputDir}`);
                throw new Error('ASR输出目录刚刚创建，暂无结果文件');
            }

            // 读取目录中的所有文件
            const dirEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(asrOutputDir));
            console.log(`ASR输出目录中的文件数量: ${dirEntries.length}`);
            
            // 过滤出ASR结果文件（以meeting_开头的.txt文件或以asr_result_开头的.txt文件）
            const asrResultFiles = dirEntries
                .filter(([name, type]) => {
                    const isFile = type === vscode.FileType.File;
                    const isAsrResult = (name.startsWith('meeting_') || name.startsWith('asr_result_')) && name.endsWith('.txt');
                    return isFile && isAsrResult;
                })
                .map(([name]) => {
                    // 从文件名中提取时间戳
                    let timestamp = 0;
                    let timestampMatch;
                    
                    if (name.startsWith('meeting_')) {
                        // 处理meeting_1747828524808_transcript.txt格式
                        timestampMatch = name.match(/meeting_(\d+)_transcript\.txt/);
                        if (timestampMatch) {
                            timestamp = parseInt(timestampMatch[1]);
                        }
                    } else {
                        // 处理asr_result_YYYYMMDD_HHMMSS.txt格式
                        timestampMatch = name.match(/asr_result_(\d{8}_\d{6})\.txt/);
                        if (timestampMatch) {
                            // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                            const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                            timestamp = new Date(dateStr).getTime();
                        }
                    }
                    
                    // 生成格式化时间显示
                    const formattedDate = timestamp ? new Date(timestamp).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    }) : '未知时间';
                    
                    return {
                        name,
                        path: path.join(asrOutputDir, name),
                        timestamp: timestamp,
                        modified: formattedDate
                    };
                });

            console.log(`找到的ASR结果文件数量: ${asrResultFiles.length}`);
            
            // 按时间戳排序，获取最新的文件
            if (asrResultFiles.length > 0) {
                asrResultFiles.sort((a, b) => b.timestamp - a.timestamp);
                const latestFile = asrResultFiles[0];
                console.log(`最新的ASR结果文件: ${latestFile.name} (${latestFile.modified})`);
                return latestFile.path;
            }
            
            return null;
        } catch (error) {
            console.error('获取最新ASR结果文件时出错:', error);
            throw error;
        }
    }

    /**
     * 获取所有的ASR结果文件
     * @returns {Promise<Array<{path: string, name: string, timestamp: number}>>} ASR结果文件列表
     */
    async getAllAsrResultFiles() {
        try {
            // 获取工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                console.error('获取ASR结果文件失败: 未打开工作区');
                throw new Error('未打开工作区');
            }

            // 构建ASR输出目录路径
            const asrOutputDir = path.join(workspaceFolders[0].uri.fsPath, 'yuyin', 'output');
            console.log(`正在查找ASR结果文件，搜索目录: ${asrOutputDir}`);
            
            if (!fs.existsSync(asrOutputDir)) {
                console.error(`ASR输出目录不存在: ${asrOutputDir}`);
                // 尝试创建目录
                fs.mkdirSync(asrOutputDir, { recursive: true });
                console.log(`已创建ASR输出目录: ${asrOutputDir}`);
                throw new Error('ASR输出目录刚刚创建，暂无结果文件');
            }

            // 读取目录中的所有文件
            const dirEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(asrOutputDir));
            console.log(`ASR输出目录中的文件数量: ${dirEntries.length}`);
            
            // 过滤出ASR结果文件（以meeting_开头的.txt文件或以asr_result_开头的.txt文件）
            const asrResultFiles = dirEntries
                .filter(([name, type]) => {
                    const isFile = type === vscode.FileType.File;
                    const isAsrResult = (name.startsWith('meeting_') || name.startsWith('asr_result_')) && name.endsWith('.txt');
                    return isFile && isAsrResult;
                })
                .map(([name]) => {
                    // 从文件名中提取时间戳
                    let timestamp = 0;
                    let timestampMatch;
                    
                    if (name.startsWith('meeting_')) {
                        // 处理meeting_1747828524808_transcript.txt格式
                        timestampMatch = name.match(/meeting_(\d+)_transcript\.txt/);
                        if (timestampMatch) {
                            timestamp = parseInt(timestampMatch[1]);
                        }
                    } else {
                        // 处理asr_result_YYYYMMDD_HHMMSS.txt格式
                        timestampMatch = name.match(/asr_result_(\d{8}_\d{6})\.txt/);
                        if (timestampMatch) {
                            // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                            const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                            timestamp = new Date(dateStr).getTime();
                        }
                    }
                    
                    // 生成格式化时间显示
                    const formattedDate = timestamp ? new Date(timestamp).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    }) : '未知时间';
                    
                    return {
                        name,
                        path: path.join(asrOutputDir, name),
                        timestamp: timestamp,
                        modified: formattedDate
                    };
                });

            console.log(`找到的ASR结果文件数量: ${asrResultFiles.length}`);
            for (const file of asrResultFiles) {
                console.log(`- ${file.name} (${new Date(file.timestamp).toLocaleString()})`);
            }

            // 在工作区中搜索更多的ASR结果文件
            console.log('在整个工作区搜索ASR结果文件...');
            try {
                const asrFiles = await vscode.workspace.findFiles('**/{meeting_*.txt,asr_result_*.txt}', '**/node_modules/**');
                
                if (asrFiles && asrFiles.length > 0) {
                    console.log(`在工作区中找到 ${asrFiles.length} 个ASR结果文件`);
                    
                    // 提取信息并添加到列表中
                    for (const uri of asrFiles) {
                        // 避免重复添加
                        if (!asrResultFiles.some(f => f.path === uri.fsPath)) {
                            try {
                                const fileStats = await vscode.workspace.fs.stat(uri);
                                const fileName = path.basename(uri.fsPath);
                                
                                // 从文件名中提取时间戳
                                let timestamp = fileStats.mtime;
                                let timestampMatch;
                                
                                if (fileName.startsWith('meeting_')) {
                                    // 处理meeting_1747828524808_transcript.txt格式
                                    timestampMatch = fileName.match(/meeting_(\d+)_transcript\.txt/);
                                    if (timestampMatch) {
                                        timestamp = parseInt(timestampMatch[1]);
                                    }
                                } else {
                                    // 处理asr_result_YYYYMMDD_HHMMSS.txt格式
                                    timestampMatch = fileName.match(/asr_result_(\d{8}_\d{6})\.txt/);
                                    if (timestampMatch) {
                                        // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                                        const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                                        timestamp = new Date(dateStr).getTime();
                                    }
                                }
                                
                                // 生成格式化时间显示
                                const formattedDate = new Date(timestamp).toLocaleString('zh-CN', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                });
                                
                                asrResultFiles.push({
                                    path: uri.fsPath,
                                    name: fileName,
                                    timestamp: timestamp,
                                    modified: formattedDate
                                });
                                
                                console.log(`添加额外找到的ASR文件: ${fileName} (${formattedDate})`);
                            } catch (error) {
                                console.error(`处理文件 ${uri.fsPath} 时出错:`, error);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('搜索工作区ASR文件时出错:', error);
            }

            // 按时间戳排序
            asrResultFiles.sort((a, b) => b.timestamp - a.timestamp);
            
            return asrResultFiles;
        } catch (error) {
            console.error('获取所有ASR结果文件时出错:', error);
            throw error;
        }
    }

    /**
     * 添加纪要到画布
     * 让用户从列表中选择一个画布，创建带有纪要的新画布副本
     */
    async addMemoToCanvas() {
        try {
            console.log('开始添加纪要到画布...');
            
            // 获取所有ASR结果文件
            console.log('正在获取所有ASR结果文件...');
            const asrResultFiles = await this.getAllAsrResultFiles();
            
            // 如果找不到ASR结果文件，使用原始的"666"文本
            let asrSentences = [];
            let selectedAsrFile = null;
            
            if (asrResultFiles.length > 0) {
                console.log(`找到 ${asrResultFiles.length} 个ASR结果文件，询问用户选择...`);
                
                // 创建选项列表，让用户选择要使用的ASR文件
                const asrFileItems = asrResultFiles.map(file => ({
                    label: file.name,
                    description: file.modified || '未知时间',
                    detail: file.path,
                    file: file
                }));
                
                // 显示选择列表
                const selectedFileItem = await vscode.window.showQuickPick(asrFileItems, {
                    placeHolder: '选择要使用的ASR结果文件',
                    ignoreFocusOut: true
                });
                
                if (selectedFileItem) {
                    selectedAsrFile = selectedFileItem.file.path;
                    console.log(`用户选择了ASR文件: ${selectedAsrFile}`);
                    
                    // 检查文件名是否以meeting_summarized开头
                    const fileName = path.basename(selectedAsrFile);
                    if (fileName.startsWith('meeting_summarized')) {
                        // 对于meeting_summarized前缀的文件，直接读取全部内容
                        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(selectedAsrFile));
                        const contentText = Buffer.from(content).toString('utf8');
                        // 将整个文件内容作为一个句子
                        asrSentences = [contentText];
                        console.log('检测到meeting_summarized文件，将使用完整内容');
                    } else {
                        // 对于其他文件，使用原有的提取方式
                        asrSentences = await this.extractSentencesFromAsrResult(selectedAsrFile);
                        console.log(`从ASR结果文件中提取了 ${asrSentences.length} 个句子`);
                    }
                } else {
                    console.log('用户取消了选择ASR文件');
                }
            } else {
                console.log('未找到有效的ASR结果文件，将使用默认文本');
                vscode.window.showInformationMessage("未找到ASR结果文件，将使用默认文本");
            }
            
            // 获取画布列表
            const canvasList = await this.loadCanvasList();
            if (!canvasList || canvasList.length === 0) {
                vscode.window.showInformationMessage("未找到画布文件，请先创建一个画布");
                return;
            }

            // 显示画布选择列表
            const items = canvasList.map(canvas => ({
                label: canvas.name,
                description: canvas.path,
                detail: `上次修改: ${canvas.lastModified}`,
                fullPath: canvas.fullPath
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要添加纪要的画布',
                ignoreFocusOut: true
            });

            if (!selected) {
                vscode.window.showInformationMessage("已取消添加纪要");
                return;
            }
            
            // 在处理选中的画布前先保存所有打开的文档
            try {
                await vscode.workspace.saveAll(false);
                console.log('成功保存所有打开的文档');
            } catch (saveError) {
                console.error('保存文档时出错:', saveError);
                // 显示警告但继续执行
                vscode.window.showWarningMessage('保存打开文档时出现问题，可能会导致部分工作未保存');
            }

            // 读取所选画布内容
            const originalFilePath = selected.fullPath;
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(originalFilePath));
            const contentText = Buffer.from(content).toString('utf8');
            
            let canvasJson;
            try {
                canvasJson = JSON.parse(contentText);
            } catch (error) {
                vscode.window.showErrorMessage("解析画布内容失败：" + error.message);
                return;
            }

            // 让用户选择要添加到纪要的文本
            let memoText = "666"; // 默认文本
            
            if (asrSentences.length > 0) {
                // 检查是否来自meeting_summarized文件
                const fileName = path.basename(selectedAsrFile);
                if (fileName.startsWith('meeting_summarized')) {
                    // 对于meeting_summarized文件，直接使用全部内容
                    memoText = asrSentences[0];
                } else {
                    // 对于其他文件，使用原有的选择方式
                    // 创建选项列表，让用户选择要添加的句子
                    const sentenceItems = asrSentences.map((sentence, index) => ({
                        label: `段落 ${index + 1}`,
                        description: sentence.length > 50 ? sentence.substring(0, 50) + '...' : sentence,
                        detail: sentence,
                        picked: true // 默认全选
                    }));
                    
                    // 显示多选框，让用户选择要包含的句子
                    const selectedSentences = await vscode.window.showQuickPick(sentenceItems, {
                        placeHolder: '选择要添加到纪要的内容（可多选）',
                        canPickMany: true, // 启用多选
                        ignoreFocusOut: true
                    });
                    
                    if (!selectedSentences || selectedSentences.length === 0) {
                        // 用户取消选择或未选择任何句子，使用默认文本
                        vscode.window.showInformationMessage("未选择任何内容，将使用默认文本");
                    } else {
                        // 合并选中的句子
                        memoText = selectedSentences.map(item => item.detail).join('\n');
                    }
                }
            } else {
                vscode.window.showInformationMessage("未找到ASR结果文件或文件为空，将使用默认文本");
            }

            // 使用固定ID以便替换而不是添加
            const memoRectId = "lingxi_memo_rect";
            const memoTextId = "lingxi_memo_text";
            
            // 创建一个位于画布左侧的矩形元素，根据文本长度调整大小
            const textLines = memoText.split('\n');
            const lineCount = textLines.length;
            const maxLineLength = Math.max(...textLines.map(line => line.length));
            
            // 根据文本内容计算矩形的宽度和高度
            // 中文字符宽度更大，每个字符大约需要16个单位宽，并添加额外余量确保完全容纳
            const rectWidth = Math.max(300, maxLineLength * 16 + 40); 
            const rectHeight = Math.max(100, lineCount * 25 + 20); // 每行大约25个单位高，并添加额外余量
            
            // 位置：左侧，竖向布局
            const rectX = 50; // 左边距
            const rectY = 100; // 顶部边距
            
            const newRectElement = {
                type: "rectangle",
                id: memoRectId,
                x: rectX,
                y: rectY,
                width: rectWidth,
                height: rectHeight,
                angle: 0,
                strokeColor: "#1e1e1e",
                backgroundColor: "#fff9db",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: Math.floor(Math.random() * 1000000),
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000)
            };

            // 创建一个文本元素，使用选中的内容
            const newTextElement = {
                type: "text",
                id: memoTextId,
                x: rectX + 10, // 文本位置应该在矩形内，左边留出10单位的内边距
                y: rectY + 10, // 文本位置应该在矩形内，顶部留出10单位的内边距
                width: rectWidth - 20, // 留出左右边距
                height: rectHeight - 20, // 留出上下边距
                angle: 0,
                strokeColor: "#000000",
                backgroundColor: "transparent",
                fillStyle: "hachure",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: Math.floor(Math.random() * 1000000),
                version: 1,
                versionNonce: Math.floor(Math.random() * 1000000),
                text: memoText,
                fontSize: 16, // 适中的字体大小
                fontFamily: 1,
                textAlign: "left", // 左对齐更适合多行文本
                verticalAlign: "top", // 顶部对齐，使文本从矩形顶部开始
                baseline: 18
            };

            // 检查元素列表是否已初始化
            if (!canvasJson.elements) {
                canvasJson.elements = [];
            }
            
            // 查找是否已存在相同ID的元素
            const rectIndex = canvasJson.elements.findIndex(elem => elem.id === memoRectId);
            const textIndex = canvasJson.elements.findIndex(elem => elem.id === memoTextId);
            
            // 如果已存在纪要元素，询问用户是否替换
            if (rectIndex !== -1 || textIndex !== -1) {
                const choice = await vscode.window.showQuickPick(
                    [
                        { label: '替换', description: '替换现有纪要' },
                        { label: '保留', description: '保留现有纪要，添加新纪要' },
                        { label: '增加', description: '在现有纪要基础上增加新内容' }
                    ],
                    {
                        placeHolder: '新文件中已存在纪要，请选择操作方式',
                        ignoreFocusOut: true
                    }
                );
                
                if (!choice) {
                    vscode.window.showInformationMessage("已取消添加纪要");
                    return;
                }
                
                if (choice.label === '替换') {
                    // 替换现有纪要
                    if (rectIndex !== -1) {
                        canvasJson.elements[rectIndex] = newRectElement;
                    }
                    if (textIndex !== -1) {
                        canvasJson.elements[textIndex] = newTextElement;
                    }
                } else if (choice.label === '保留') {
                    // 保留现有纪要，将其ID改为永久ID
                    const timestamp = Date.now();
                    
                    if (rectIndex !== -1) {
                        // 将现有矩形改为永久ID
                        canvasJson.elements[rectIndex].id = `lingxi_memo_rect_permanent_${timestamp}`;
                    }
                    
                    if (textIndex !== -1) {
                        // 将现有文本改为永久ID
                        canvasJson.elements[textIndex].id = `lingxi_memo_text_permanent_${timestamp}`;
                    }
                    
                    // 添加新纪要
                    canvasJson.elements.push(newRectElement);
                    canvasJson.elements.push(newTextElement);
                } else if (choice.label === '增加') {
                    // 在现有纪要基础上增加新内容
                    if (textIndex !== -1) {
                        // 获取现有文本内容
                        const existingText = canvasJson.elements[textIndex].text;
                        // 添加分隔线和新内容
                        const newText = existingText + '\n----------\n' + newTextElement.text;
                        // 更新文本元素
                        canvasJson.elements[textIndex].text = newText;
                        
                        // 计算新文本的行数
                        const newLineCount = newText.split('\n').length;
                        const originalLineCount = existingText.split('\n').length;
                        const addedLines = newLineCount - originalLineCount;
                        
                        // 调整矩形大小以适应新内容
                        if (rectIndex !== -1) {
                            // 保持原有的行高（约20像素）
                            const lineHeight = 20;
                            // 计算需要增加的高度
                            const heightIncrease = addedLines * lineHeight;
                            // 增加矩形高度
                            canvasJson.elements[rectIndex].height += heightIncrease;
                            
                            // 保持文本元素的位置和大小不变
                            canvasJson.elements[textIndex].fontSize = canvasJson.elements[textIndex].fontSize || 16;
                            canvasJson.elements[textIndex].lineHeight = canvasJson.elements[textIndex].lineHeight || 1.2;
                        }
                    }
                }
            } else {
                // 不存在纪要元素，直接添加
                canvasJson.elements.push(newRectElement);
                canvasJson.elements.push(newTextElement);
            }
            
            // 创建新文件名：检查原始文件名是否已包含纪要标记
            const pathObj = path.parse(originalFilePath);
            let newFileName;
            
            // 正则表达式匹配"_纪要"或"_纪要数字"模式
            const memoRegex = /_纪要(\d+)?$/;
            const memoMatch = pathObj.name.match(memoRegex);
            
            if (memoMatch) {
                // 如果已经有纪要标记
                const currentDir = pathObj.dir;
                const baseNameWithoutMemo = pathObj.name.replace(memoRegex, '');
                
                // 获取当前目录下所有文件，检查是否有同名的纪要文件
                try {
                    const dirEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentDir));
                    const existingMemoFiles = dirEntries
                        .filter(([name]) => name.endsWith(pathObj.ext)) // 只查找相同扩展名的文件
                        .map(([name]) => name) // 提取文件名
                        .filter(name => name.startsWith(baseNameWithoutMemo) && name.match(/_纪要\d+/)); // 查找具有纪要标记的文件
                    
                    // 找出最大的纪要序号
                    let maxMemoNumber = 0;
                    existingMemoFiles.forEach(fileName => {
                        const match = fileName.match(/_纪要(\d+)/);
                        if (match && match[1]) {
                            const num = parseInt(match[1], 10);
                            if (num > maxMemoNumber) {
                                maxMemoNumber = num;
                            }
                        }
                    });
                    
                    // 创建新的纪要文件名，序号+1
                    newFileName = `${baseNameWithoutMemo}_纪要${maxMemoNumber + 1}${pathObj.ext}`;
                } catch (error) {
                    console.error('读取目录失败:', error);
                    // 如果无法读取目录，使用时间戳作为备选方案
                    newFileName = `${baseNameWithoutMemo}_纪要${Date.now().toString().slice(-4)}${pathObj.ext}`;
                }
            } else {
                // 如果没有纪要标记，添加"_纪要1"
                newFileName = `${pathObj.name}_纪要1${pathObj.ext}`;
            }
            
            // 构建新文件完整路径
            const newFilePath = path.join(pathObj.dir, newFileName);
            
            // 写入新文件
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(newFilePath),
                Buffer.from(JSON.stringify(canvasJson, null, 2), 'utf8')
            );
            
            // 删除原始画布
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(originalFilePath));
                console.log(`已删除原始画布: ${originalFilePath}`);
            } catch (deleteError) {
                console.error('删除原始画布失败:', deleteError);
                vscode.window.showWarningMessage(`删除原始画布失败: ${deleteError.message}`);
            }
            
            // 显示成功消息
            vscode.window.showInformationMessage('纪要添加成功，原始画布已删除');
            
            // 询问用户是否要打开新画布
            const openOptions = [
                { label: '是', description: '打开新画布' },
                { label: '否', description: '稍后手动打开' }
            ];

            const openChoice = await vscode.window.showQuickPick(openOptions, {
                placeHolder: '是否要打开新画布？'
            });

            if (openChoice && openChoice.label === '是') {
                // 打开新画布
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(newFilePath));
            }
            
        } catch (error) {
            console.error('添加纪要到画布失败:', error);
            vscode.window.showErrorMessage(`添加纪要失败: ${error.message}`);
        }
    }

    /**
     * 删除画布文件
     * @param {string} path 画布文件路径
     * @param {string} name 画布文件名
     */
    async deleteCanvas(path, name) {
        try {
            // 确认是否删除
            const answer = await vscode.window.showWarningMessage(
                `确定要删除画布 "${name}" 吗？此操作不可恢复。`,
                { modal: true },
                '确定删除',
                '取消'
            );

            if (answer === '确定删除') {
                // 如果文件当前正在编辑，先关闭它
                const document = vscode.workspace.textDocuments.find(doc => doc.fileName === path);
                if (document) {
                    await vscode.window.showTextDocument(document);
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }

                // 删除文件
                await vscode.workspace.fs.delete(vscode.Uri.file(path));
                
                // 刷新画布列表
                await this.sendCanvasList();
                
                vscode.window.showInformationMessage(`画布 "${name}" 已删除`);
            }
        } catch (error) {
            console.error('删除画布失败:', error);
            vscode.window.showErrorMessage(`删除画布失败: ${error.message}`);
        }
    }

    /**
     * 从ASR结果文件中提取句子，保持原始顺序
     * @param {string} filePath ASR结果文件路径
     * @returns {Promise<string[]>} 提取出的句子列表
     */
    async extractSentencesFromAsrResult(filePath) {
        try {
            console.log(`正在从文件中提取ASR句子: ${filePath}`);
            
            // 检查文件是否存在
            if (!fs.existsSync(filePath)) {
                console.error(`文件不存在: ${filePath}`);
                vscode.window.showErrorMessage(`ASR结果文件不存在: ${path.basename(filePath)}`);
                return [];
            }
            
            // 读取文件内容
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const contentText = Buffer.from(content).toString('utf8');
            
            if (!contentText || contentText.trim().length === 0) {
                console.log('ASR结果文件内容为空');
                vscode.window.showWarningMessage('选择的ASR结果文件内容为空');
                return [];
            }
            
            console.log(`ASR结果文件内容长度: ${contentText.length} 字节`);
            
            // 按行分割
            const lines = contentText.split('\n').filter(line => line.trim().length > 0);
            console.log(`ASR结果文件有效行数: ${lines.length}`);
            
            // 跳过以#开头的注释行
            const contentLines = lines.filter(line => !line.trim().startsWith('#'));
            if (contentLines.length < lines.length) {
                console.log(`忽略了 ${lines.length - contentLines.length} 行注释`);
            }
            
            // 创建一个Set来存储唯一的句子
            const uniqueSentences = new Set();
            
            // 处理每一行
            contentLines.forEach(line => {
                // 跳过文件结束标记行
                if (line.includes('--- 文件') && line.includes('转写结束 ---')) {
                    return;
                }
                
                // 跳过标题行
                if (line.includes('会议') && line.includes('的语音转写记录')) {
                    return;
                }
                
                // 处理包含冒号的行（句子行）
                if (line.includes(':')) {
                    const parts = line.split(':');
                    const text = parts.slice(1).join(':').trim();
                    if (text) {
                        // 只添加唯一的文本内容
                        uniqueSentences.add(text);
                    }
                }
            });
            
            // 将Set转换为数组
            const sentences = Array.from(uniqueSentences);
            
            console.log(`最终提取的唯一句子数量: ${sentences.length}`);
            sentences.forEach((text, index) => {
                console.log(`- 句子 ${index}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
            });
            
            return sentences;
        } catch (error) {
            console.error('从ASR结果文件中提取句子失败:', error);
            vscode.window.showErrorMessage(`从ASR结果文件中提取句子失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 在webview中处理收到的消息
     * @param {*} message 
     */
    _handleMessage(message) {
        // 根据消息类型处理不同的消息
        switch (message.command) {
            case 'sendAgentQuery':
                this._handleAgentQuery(message.query);
                break;
            // ... existing cases ...
        }
    }

    /**
     * 显示Agent消息
     * @param {string} message 消息内容
     */
    displayAgentMessage(message) {
        if (this._webviewView) {
            this._webviewView.webview.postMessage({
                command: 'agentResponse',
                response: message
            });
        }
    }

    /**
     * 更新工具调用状态
     * @param {string} command 命令名称 ('toolCallStarted' 或 'toolCallCompleted')
     * @param {object} data 工具调用相关数据
     */
    updateToolCallStatus(command, data) {
        if (this._webviewView) {
            this._webviewView.webview.postMessage({
                command: command,
                ...data
            });
        }
    }

    /**
     * 更新Agent思考状态
     * @param {boolean} isThinking 是否正在思考
     * @param {string} thinkingId 思考会话ID
     */
    updateAgentThinking(isThinking, thinkingId) {
        if (this._webviewView) {
            this._webviewView.webview.postMessage({
                command: 'agentThinking',
                isThinking: isThinking,
                thinkingId: thinkingId
            });
        }
    }
}

module.exports = LingxiSidebarProvider;