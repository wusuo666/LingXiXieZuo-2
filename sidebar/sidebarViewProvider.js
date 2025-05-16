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
        this._remoteCanvasDir = path.join(context.globalStoragePath, 'remote_canvas');
        
        // 确保远程画布目录存在
        if (!fs.existsSync(this._remoteCanvasDir)) {
            fs.mkdirSync(this._remoteCanvasDir, { recursive: true });
        }
        
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
                    console.log('收到WebSocket消息:', event.data);
                    const message = JSON.parse(event.data);
                    console.log('解析后的消息:', JSON.stringify(message, null, 2));
                    
                    // 处理所有类型为 'message' 的消息
                    if (message.type === 'message' && message.content) {
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
                        
                        // 将消息显示在聊天界面中
                        if (this._webviewView) {
                            this._webviewView.webview.postMessage({
                                command: 'chatResponse',
                                sender: message.sender.name,
                                content: message.content,
                                time: new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                                canvasData: message.canvasData
                            });
                        }
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
     * 处理聊天消息
     * @param {string} message 消息内容
     */
    async handleChatMessage(message) {
        console.log('收到聊天消息:', message);
        
        // 使用isConnected函数检查连接状态
        if (isConnected()) {
            // 直接发送用户消息，不需要包装
            sendMessage(message);
            console.log('已发送消息:', message);
        } else {
            console.log('聊天室未连接，无法处理消息');
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
                    // 先打开第一个文件
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(version1Path));

                    // 使用 showTextDocument 打开第二个文件，并指定在旁边的编辑器组打开
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(version2Path));
                    await vscode.window.showTextDocument(document, {
                        viewColumn: vscode.ViewColumn.Beside, // 在旁边的编辑器组打开
                        preview: false // 不是预览模式，这样文件不会被其他文件替换
                    });
                    
                    // 显示冲突提示并让用户选择要保存的最终版本
                    vscode.window.showInformationMessage(
                        `检测到 ${conflicts.length} 个ID冲突，已打开两个预览版本供对比。请选择要保存的最终版本：`,
                        '保存本地优先版本',
                        '保存远程优先版本',
                        '取消'
                    ).then(async selected => {
                        let finalJson;
                        if (selected === '保存本地优先版本') {
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
                        
                        // 清理临时文件
                        try {
                            await vscode.workspace.fs.delete(vscode.Uri.file(version1Path), { useTrash: false });
                            await vscode.workspace.fs.delete(vscode.Uri.file(version2Path), { useTrash: false });
                        } catch (deleteError) {
                            console.log('清理临时文件时出错:', deleteError);
                            // 非致命错误，可以忽略
                        }
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
        this.setupMessageListeners();

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
            this._chatClient.onmessage = async (event) => {
                // 调用原始处理函数
                if (originalOnMessage) {
                    originalOnMessage(event);
                }
                
                // 添加我们自己的处理逻辑
                try {
                    console.log('接收到WebSocket消息:', event.data);
                    const message = JSON.parse(event.data);
                    
                    // 检测消息是否包含画布链接
                    if (message.type === 'message' && message.content) {
                        console.log('检查消息是否包含画布链接:', message.content);
                        const canvasLinkPattern = /https?:\/\/([^\/]+)\/canvas\/([^"\s]+)/;
                        const canvasLinkMatch = message.content.match(canvasLinkPattern);
                        console.log('画布链接匹配结果:', canvasLinkMatch);
                        
                        if (canvasLinkMatch) {
                            const serverAddress = canvasLinkMatch[1]; // 第一个捕获组是服务器地址(包含可选端口号)
                            const canvasId = canvasLinkMatch[2]; // 第二个捕获组是画布ID
                            console.log('检测到画布链接，服务器:', serverAddress);
                            console.log('检测到画布链接，ID:', canvasId);
                            
                            // 询问用户是否下载远程画布
                            let senderName = '其他用户';
                            if (message.sender) {
                                if (typeof message.sender === 'object' && message.sender.name) {
                                    senderName = message.sender.name;
                                } else if (typeof message.sender === 'string') {
                                    senderName = message.sender;
                                }
                            }
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
                        }
                    }
                    
                    // 将消息发送到前端
                    if (this._webviewView) {
                        this._webviewView.webview.postMessage({
                            command: 'chatResponse',
                            sender: senderName,
                            content: message.content || '空消息',
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
                case 'addMemoToCanvas':
                    // 向画布添加纪要
                    await this.addMemoToCanvas();
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
            
            // 过滤出ASR结果文件（以asr_result_开头的.txt文件）
            const asrResultFiles = dirEntries
                .filter(([name, type]) => {
                    const isFile = type === vscode.FileType.File;
                    const isAsrResult = name.startsWith('asr_result_') && name.endsWith('.txt');
                    return isFile && isAsrResult;
                })
                .map(([name]) => {
                    // 从文件名中提取时间戳
                    let timestamp = 0;
                    const timestampMatch = name.match(/asr_result_(\d{8}_\d{6})\.txt/);
                    if (timestampMatch) {
                        // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                        const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                        timestamp = new Date(dateStr).getTime();
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

            // 如果没有找到结果文件，返回null
            if (asrResultFiles.length === 0) {
                console.log('未找到任何ASR结果文件');
                return null;
            }

            // 按时间戳降序排序，获取最新的文件
            asrResultFiles.sort((a, b) => b.timestamp - a.timestamp);
            const latestFile = asrResultFiles[0];
            console.log(`选择的最新ASR结果文件: ${latestFile.name} (${new Date(latestFile.timestamp).toLocaleString()})`);
            
            // 检查文件是否存在且非空
            const fileStats = await vscode.workspace.fs.stat(vscode.Uri.file(latestFile.path));
            if (fileStats.size === 0) {
                console.log(`ASR结果文件为空: ${latestFile.path}`);
                throw new Error('ASR结果文件为空');
            }
            
            return latestFile.path;
        } catch (error) {
            console.error('获取最新ASR结果文件失败:', error);
            vscode.window.showErrorMessage(`获取ASR结果文件失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 从ASR结果文件中提取最长的句子
     * @param {string} filePath ASR结果文件路径
     * @returns {Promise<string[]>} 提取出的最长句子列表
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
            
            // 创建一个数组来存储解析出的完整句子
            const sentences = [];
            
            // 当前行可能包含多个段落，我们需要处理这种情况
            const lineRegex = /(\d+):([^0-9]+)(?=\d+:|$)/g;
            
            contentLines.forEach(line => {
                // 重置正则表达式状态
                lineRegex.lastIndex = 0;
                
                let match;
                let parsedAny = false;
                
                // 提取所有匹配的段落
                while ((match = lineRegex.exec(line)) !== null) {
                    parsedAny = true;
                    const segId = match[1];
                    const text = match[2].trim();
                    
                    // 确保这个段落ID在数组范围内
                    const segIdNum = parseInt(segId, 10);
                    while (sentences.length <= segIdNum) {
                        sentences.push('');
                    }
                    
                    // 保存这个段落的最长文本
                    if (text.length > sentences[segIdNum].length) {
                        sentences[segIdNum] = text;
                    }
                }
                
                // 如果当前行包含完整句子（以句号结尾），则直接使用该行
                if (!parsedAny && line.includes(':')) {
                    const parts = line.split(':');
                    const segId = parts[0].trim();
                    if (/^\d+$/.test(segId)) {
                        const segIdNum = parseInt(segId, 10);
                        const text = parts.slice(1).join(':').trim();
                        
                        while (sentences.length <= segIdNum) {
                            sentences.push('');
                        }
                        
                        if (text.length > sentences[segIdNum].length) {
                            sentences[segIdNum] = text;
                        }
                    } else {
                        console.log(`无法解析的行: ${line}`);
                    }
                }
            });
            
            // 过滤掉空句子
            const finalSentences = sentences.filter(sent => sent.length > 0);
            
            console.log(`最终提取的句子数量: ${finalSentences.length}`);
            finalSentences.forEach((text, index) => {
                console.log(`- 段落 ${index}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
            });
            
            return finalSentences;
        } catch (error) {
            console.error('从ASR结果文件中提取句子失败:', error);
            vscode.window.showErrorMessage(`从ASR结果文件中提取句子失败: ${error.message}`);
            return [];
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
            
            // 过滤出ASR结果文件（以asr_result_开头的.txt文件）
            const asrResultFiles = dirEntries
                .filter(([name, type]) => {
                    const isFile = type === vscode.FileType.File;
                    const isAsrResult = name.startsWith('asr_result_') && name.endsWith('.txt');
                    return isFile && isAsrResult;
                })
                .map(([name]) => {
                    // 从文件名中提取时间戳
                    let timestamp = 0;
                    const timestampMatch = name.match(/asr_result_(\d{8}_\d{6})\.txt/);
                    if (timestampMatch) {
                        // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                        const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                        timestamp = new Date(dateStr).getTime();
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
                const asrFiles = await vscode.workspace.findFiles('**/asr_result_*.txt', '**/node_modules/**');
                
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
                                const timestampMatch = fileName.match(/asr_result_(\d{8}_\d{6})\.txt/);
                                if (timestampMatch) {
                                    // 将文件名中的时间戳格式 YYYYMMDD_HHMMSS 转换为正确的日期
                                    const dateStr = timestampMatch[1].replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
                                    timestamp = new Date(dateStr).getTime();
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
                                console.error(`获取文件信息失败: ${uri.fsPath}`, error);
                            }
                        }
                    }
                }
            } catch (searchError) {
                console.error('搜索工作区ASR文件时出错:', searchError);
            }

            // 如果没有找到结果文件，返回空数组
            if (asrResultFiles.length === 0) {
                console.log('未找到任何ASR结果文件');
                return [];
            }

            // 按时间戳降序排序（从新到旧）
            asrResultFiles.sort((a, b) => b.timestamp - a.timestamp);
            console.log('ASR结果文件已按时间从新到旧排序');
            
            return asrResultFiles;
        } catch (error) {
            console.error('获取ASR结果文件列表失败:', error);
            vscode.window.showErrorMessage(`获取ASR结果文件列表失败: ${error.message}`);
            return [];
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
                    
                    // 从选中的文件中提取句子
                    asrSentences = await this.extractSentencesFromAsrResult(selectedAsrFile);
                    console.log(`从ASR结果文件中提取了 ${asrSentences.length} 个句子`);
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
                        { label: '是', description: '替换现有纪要' },
                        { label: '否', description: '保留现有纪要，添加新纪要' }
                    ],
                    {
                        placeHolder: '新文件中已存在纪要，是否替换？',
                        ignoreFocusOut: true
                    }
                );
                
                if (!choice) {
                    vscode.window.showInformationMessage("已取消添加纪要");
                    return;
                }
                
                if (choice.label === '是') {
                    // 替换现有纪要
                    if (rectIndex !== -1) {
                        canvasJson.elements[rectIndex] = newRectElement;
                    }
                    if (textIndex !== -1) {
                        canvasJson.elements[textIndex] = newTextElement;
                    }
                } else {
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
            
            // 等待文件写入完成
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // 打开新创建的文件
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(newFilePath));
            
            // 显示成功消息
            vscode.window.showInformationMessage(`已成功创建带有纪要的画布副本: ${newFileName}`);
            
        } catch (error) {
            console.error('添加纪要到画布失败:', error);
            vscode.window.showErrorMessage(`添加纪要失败: ${error.message}`);
        }
    }
}

module.exports = LingxiSidebarProvider;