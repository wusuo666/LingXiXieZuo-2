const vscode = require('vscode');
const { copyToClipboard, getClipboardHistory, readFromClipboard, filterClipboardHistoryByContext } = require('./clipboard');
const LingxiSidebarProvider = require('./sidebar/sidebarViewProvider');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const agentApi = require('./agent/agentApi');
const { startChatServer, stopChatServer, setSidebarProvider } = require('./chatroom/startServer');
const { createAndOpenDrawio } = require('./createDrawio');
const { spawn } = require('child_process');
const { setExcalidrawDir } = require('./agent/server.js');

/**
 * 创建并打开Draw.io文件
 * 创建一个新的.drawio文件并使用关联程序打开
 * @param {string} [filePath] 可选的文件路径，如果不提供则在临时目录创建
 * @returns {Promise<void>}
 */
async function createAndOpenDrawioCommand(filePath) {
    try {
        const createdFilePath = await createAndOpenDrawio(filePath);
        vscode.window.showInformationMessage(`成功创建并打开Draw.io文件: ${createdFilePath}`);
    } catch (error) {
        console.error('创建或打开Draw.io文件失败:', error);
        vscode.window.showErrorMessage(`创建或打开Draw.io文件失败: ${error.message}`);
    }
}

/**
 * 处理外部录音命令
 * 使用Node.js子进程调用外部录音脚本
 * @param {number} duration 录音时长（秒）
 * @returns {Promise<Object>} 返回包含base64编码音频数据和文件名的对象
 */
async function handleExternalAudioRecord(duration = 5) {
    return new Promise((resolve, reject) => {
        try {
            // 检查录音脚本是否存在
            const scriptPath = path.join(__dirname, 'chatroom', 'recordAudio.js');
            if (!fs.existsSync(scriptPath)) {
                throw new Error('录音脚本文件不存在: ' + scriptPath);
            }
            
            // 设置录音脚本的执行权限（在Unix系统上）
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(scriptPath, '755');
                } catch (err) {
                    console.warn('设置脚本执行权限失败，可能需要手动设置: ', err);
                }
            }
            
            // 获取工作区路径
            let workspacePath = '';
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                console.log('使用工作区路径:', workspacePath);
            } else {
                console.log('未找到工作区路径，将使用插件默认路径');
            }
            
            // 确保recordings文件夹存在于工作区中
            const workspaceRecordingsDir = path.join(workspacePath, 'recordings');
            if (workspacePath && !fs.existsSync(workspaceRecordingsDir)) {
                try {
                    fs.mkdirSync(workspaceRecordingsDir, { recursive: true });
                    console.log(`在工作区中创建recordings文件夹: ${workspaceRecordingsDir}`);
                } catch (err) {
                    console.warn(`在工作区中创建recordings文件夹失败: ${err.message}, 将使用插件默认路径`);
                }
            }
            
            // 显示录音中状态栏
            const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
            statusBar.text = `$(record) 正在录音 (${duration}秒)...`;
            statusBar.tooltip = '正在录制语音消息';
            statusBar.show();
            
            // 执行录音脚本，传递工作区路径
            const node = process.platform === 'win32' ? 'node.exe' : 'node';
            const recordProcess = spawn(node, [scriptPath, duration.toString(), workspacePath]);
            
            let outputData = '';
            let errorData = '';
            
            recordProcess.stdout.on('data', (data) => {
                outputData += data.toString();
            });
            
            recordProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                console.log('录音脚本输出:', data.toString());
            });
            
            recordProcess.on('close', (code) => {
                statusBar.dispose(); // 隐藏状态栏
                
                if (code !== 0) {
                    reject(new Error(`录音脚本退出，退出码 ${code}: ${errorData}`));
                    return;
                }
                
                if (!outputData) {
                    reject(new Error('未获取到录音数据'));
                    return;
                }
                
                try {
                    // 首先尝试识别是否有JSON输出
                    // 查找JSON开始的花括号位置
                    const jsonStartIndex = outputData.indexOf('{');
                    if (jsonStartIndex >= 0) {
                        // 提取JSON部分
                        const jsonPart = outputData.substring(jsonStartIndex);
                        // 尝试解析JSON输出
                        const resultObject = JSON.parse(jsonPart);
                        
                        // 录音数据已经在recordAudio.js中直接保存到recordings文件夹
                        console.log('录音完成, 文件名:', resultObject.filename);
                        
                        // 显示保存成功的通知
                        vscode.window.showInformationMessage(`录音已保存: ${resultObject.filename}`);
                        
                        // 返回包含音频数据和文件名的对象
                        resolve(resultObject);
                    } else {
                        // 没有找到JSON部分，记录错误
                        console.error('录音脚本输出格式不正确，找不到JSON数据:', outputData);
                        // 尝试从错误信息中提取文件名
                        let filename = null;
                        const filenameMatch = errorData.match(/将保存录音文件: (.+\.wav)/);
                        if (filenameMatch && filenameMatch[1]) {
                            filename = path.basename(filenameMatch[1]);
                            console.log('从错误输出中提取到文件名:', filename);
                        }
                        
                        // 检查录音是否完成的消息
                        if (errorData.includes('录音已完成') && filename) {
                            // 尝试读取保存的文件
                            try {
                                // 构建可能的文件路径
                                const possibleFilePaths = [];
                                if (workspacePath) {
                                    possibleFilePaths.push(path.join(workspacePath, 'recordings', filename));
                                }
                                possibleFilePaths.push(path.join(__dirname, 'recordings', filename));
                                possibleFilePaths.push(path.join(__dirname, '..', 'recordings', filename));
                                
                                // 尝试读取文件
                                for (const filePath of possibleFilePaths) {
                                    if (fs.existsSync(filePath)) {
                                        const audioData = fs.readFileSync(filePath).toString('base64');
                                        vscode.window.showInformationMessage(`录音已保存: ${filename}`);
                                        resolve({ audioData, filename });
                                        return;
                                    }
                                }
                            } catch (readError) {
                                console.error('读取录音文件失败:', readError);
                            }
                        }
                        
                        // 如果所有尝试都失败，则返回错误
                        reject(new Error('录音脚本输出格式不正确，无法解析'));
                    }
                } catch (parseError) {
                    console.error('解析录音脚本输出失败:', parseError, '原始输出:', outputData);
                    
                    // 检查是否包含文件保存信息
                    const filenameMatch = errorData.match(/将保存录音文件: (.+\.wav)/);
                    const completedMatch = errorData.match(/录音已完成，文件保存至: (.+\.wav)/);
                    
                    let audioFile = null;
                    if (completedMatch && completedMatch[1]) {
                        audioFile = completedMatch[1];
                    } else if (filenameMatch && filenameMatch[1]) {
                        audioFile = filenameMatch[1];
                    }
                    
                    if (audioFile) {
                        const filename = path.basename(audioFile);
                        console.log('尝试读取录音文件:', audioFile);
                        
                        // 检查文件是否存在
                        if (fs.existsSync(audioFile)) {
                            try {
                                // 读取文件并转换为base64
                                const audioData = fs.readFileSync(audioFile).toString('base64');
                                vscode.window.showInformationMessage(`录音已保存: ${filename}`);
                                resolve({ audioData, filename });
                                return;
                            } catch (readError) {
                                console.error('读取录音文件失败:', readError);
                            }
                        } else {
                            console.error('录音文件不存在:', audioFile);
                        }
                    }
                    
                    // 如果所有尝试都失败，则返回错误
                    reject(new Error(`解析录音脚本输出失败: ${parseError.message}`));
                }
            });
            
            recordProcess.on('error', (err) => {
                statusBar.dispose();
                reject(err);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 激活插件时的回调函数
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    console.log('灵犀协作插件已激活');
    
    // 不再从secrets加载API Key
    console.log('注意: 此版本需要在每次启动后手动配置API Keys');
    
    // 输出调试信息，帮助诊断命令注册问题
    console.log('正在注册命令...');
    vscode.window.showInformationMessage('灵犀协作插件已激活，正在注册命令...');

    // 检查是否有打开的工作区
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // 获取第一个工作区文件夹的路径
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const workspacePath = workspaceFolder.uri.fsPath;
        
        // 添加调试输出
        console.log(`设置Excalidraw目录: ${workspacePath}`);
        
        // 设置Excalidraw目录路径 - 使用fsPath代替path
        const excalidrawDir = path.join(workspacePath, 'excalidraw_files');
        console.log(`完整Excalidraw目录路径: ${excalidrawDir}`);
        setExcalidrawDir(excalidrawDir);
        
        // 显示通知
        vscode.window.showInformationMessage(`Excalidraw目录已设置: ${excalidrawDir}`);
    } else {
        console.log('未找到工作区，将使用默认目录');
        vscode.window.showWarningMessage('未找到工作区，Excalidraw将使用默认目录');
    }

    // 注册复制文本命令
    console.log('注册命令: lingxixiezuo.testCopyText');
    let copyTextDisposable = vscode.commands.registerCommand('lingxixiezuo.testCopyText', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            const text = editor.document.getText(selection);
            
            if (text) {
                await copyToClipboard(text, 'text');
                vscode.window.showInformationMessage('文本已复制到剪贴板');
                // 通知侧边栏更新剪贴板历史
                sidebarProvider.sendClipboardHistory();
            }
        }
    });

    // 注册复制代码命令
    console.log('注册命令: lingxixiezuo.testCopyCode');
    let copyCodeDisposable = vscode.commands.registerCommand('lingxixiezuo.testCopyCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            const code = editor.document.getText(selection);
            
            if (code) {
                await copyToClipboard(code, 'code');
                vscode.window.showInformationMessage('代码已复制到剪贴板');
                // 通知侧边栏更新剪贴板历史
                sidebarProvider.sendClipboardHistory();
            }
        }
    });

    // 注册读取剪贴板命令
    console.log('注册命令: lingxixiezuo.testRead');
    let readClipboardDisposable = vscode.commands.registerCommand('lingxixiezuo.testRead', async () => {
        try {
            const text = await readFromClipboard('text'); // 使用 'text' 或 'freeText' 上下文
            vscode.window.showInformationMessage(`剪贴板内容: ${text}`);
        } catch (error) {
            vscode.window.showErrorMessage(`读取剪贴板失败: ${error.message}`);
        }
    });

    // 注册显示历史记录命令
    console.log('注册命令: lingxixiezuo.showHistory');
    let showHistoryDisposable = vscode.commands.registerCommand('lingxixiezuo.showHistory', async () => {
        const fullHistory = getClipboardHistory();
        if (fullHistory.length === 0) {
            vscode.window.showInformationMessage('剪贴板历史记录为空');
            return;
        }

        // 获取当前编辑器上下文
        let currentContext = 'freeText'; // 默认上下文
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // 简单判断：如果是常见代码文件类型，则认为是代码上下文
            const languageId = editor.document.languageId;
            // 可以根据需要扩展更多语言 ID
            const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'html', 'css', 'json', 'markdown']; 
            if (codeLanguages.includes(languageId)) {
                currentContext = 'code';
            } else {
                currentContext = 'text';
            }
        }

        // 根据上下文过滤历史记录
        const filteredHistory = filterClipboardHistoryByContext(currentContext, fullHistory);

        if (filteredHistory.length === 0) {
            vscode.window.showInformationMessage(`在当前 '${currentContext}' 上下文中无适用的历史记录`);
            return;
        }

        // 格式化过滤后的历史记录用于 QuickPick
        const items = filteredHistory.map(entry => ({
            label: `${entry.type === 'code' ? '📝 代码' : (entry.type === 'text' ? '📄 文本' : '❓ 其他')} - ${new Date(entry.timestamp).toLocaleString([], {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}`,
            description: typeof entry.content === 'string' && entry.content.length > 50 ? entry.content.substring(0, 50) + '...' : (typeof entry.content === 'string' ? entry.content : '[非文本内容]'),
            entry
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `选择要复制的历史记录 (当前上下文: ${currentContext})`
        });

        if (selected) {
            // 将选中条目的原始文本内容写入系统剪贴板
            const contentToPaste = typeof selected.entry.content === 'string' ? selected.entry.content : JSON.stringify(selected.entry.content);
            await vscode.env.clipboard.writeText(contentToPaste);
            vscode.window.showInformationMessage('已复制到剪贴板');
        }
    });

    // 注册智能粘贴命令
    console.log('注册命令: lingxixiezuo.pasteSmart');
    let pasteSmartDisposable = vscode.commands.registerCommand('lingxixiezuo.pasteSmart', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('没有活动的编辑器');
            return;
        }

        // 获取当前编辑器上下文
        let currentContext = 'freeText'; // 默认上下文
        const languageId = editor.document.languageId;
        const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'html', 'css', 'json', 'markdown'];
        if (codeLanguages.includes(languageId)) {
            currentContext = 'code';
        } else {
            currentContext = 'text';
        }

        try {
            // 从剪贴板读取内容，根据上下文
            const contentToPaste = await readFromClipboard(currentContext);

            // 插入内容到编辑器
            editor.edit(editBuilder => {
                // 如果有选区，则替换选区内容
                if (!editor.selection.isEmpty) {
                    editBuilder.replace(editor.selection, String(contentToPaste));
                } else {
                    // 否则在光标位置插入
                    editBuilder.insert(editor.selection.active, String(contentToPaste));
                }
            });
            vscode.window.showInformationMessage(`已从剪贴板粘贴 (${currentContext} 上下文)`);
        } catch (error) {
            // 从插件剪贴板读取失败，显示错误信息
            console.error('从插件剪贴板读取失败:', error);
            // 修改错误提示，告知用户剪贴板记录为空或无适用内容，并以模态弹窗显示
            vscode.window.showErrorMessage('当前剪贴板记录为空或无适用内容', { modal: true });
        }
    });

    // 注册灵犀协作侧边栏视图
    // 包含协作区(聊天室、Agent、设置)、剪贴板历史和协同画布三个主要功能区域
    const sidebarProvider = new LingxiSidebarProvider(context);
    
    // 将侧边栏提供者实例传递给startServer
    setSidebarProvider(sidebarProvider);
    
    // 确保使用正确的视图ID注册WebviewViewProvider
    const viewProvider = vscode.window.registerWebviewViewProvider('lingxixiezuoView', sidebarProvider, {
        webviewOptions: {
            retainContextWhenHidden: true // 加入此配置以在隐藏时保留Webview上下文
        }
    });

    // 注册启动聊天室服务器命令
    console.log('注册命令: lingxixiezuo.startChatServer');
    let startChatServerDisposable = vscode.commands.registerCommand('lingxixiezuo.startChatServer', startChatServer);
    
    // 注册停止聊天室服务器命令
    console.log('注册命令: lingxixiezuo.stopChatServer');
    let stopChatServerDisposable = vscode.commands.registerCommand('lingxixiezuo.stopChatServer', stopChatServer);

    // 注册外部录音命令
    console.log('注册命令: lingxixiezuo.recordAudio');
    let recordAudioDisposable = vscode.commands.registerCommand('lingxixiezuo.recordAudio', async (duration) => {
        try {
            // 弹出询问录音时长的输入框
            let recordDuration = duration;
            if (!recordDuration) {
                const durationInput = await vscode.window.showInputBox({
                    prompt: '请输入录音时长(秒)',
                    placeHolder: '5',
                    value: '5',
                    validateInput: (value) => {
                        // 验证输入是否为有效数字
                        if (!/^\d+$/.test(value) || parseInt(value) <= 0 || parseInt(value) > 60) {
                            return '请输入1-60之间的整数';
                        }
                        return null; // 返回null表示验证通过
                    }
                });
                
                if (!durationInput) {
                    // 用户取消了操作
                    return null;
                }
                
                recordDuration = parseInt(durationInput);
            }
            
            // 显示开始录音的通知
            vscode.window.showInformationMessage(`开始录音，时长${recordDuration}秒...`);
            
            // 调用外部录音脚本
            const result = await handleExternalAudioRecord(recordDuration);
            
            // 录音完成通知
            vscode.window.showInformationMessage('录音完成');
            
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`录音失败: ${error.message}`);
            return null;
        }
    });

    // 注册创建Excalidraw画布的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('lingxixiezuo.createExcalidraw', async () => {
            try {
                // 获取当前工作区路径
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    throw new Error('请先打开一个工作区');
                }
                const workspacePath = workspaceFolders[0].uri.fsPath;

                // 创建新的Excalidraw文件
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const fileName = `画布_${timestamp}.excalidraw`;
                const filePath = path.join(workspacePath, fileName);

                // 创建基本的Excalidraw文件内容
                const initialContent = {
                    type: "excalidraw",
                    version: 2,
                    source: "vscode-lingxi",
                    elements: [],
                    appState: {
                        viewBackgroundColor: "#ffffff",
                        currentItemStrokeWidth: 1,
                        currentItemFontFamily: 1
                    },
                    settings: {
                        theme: "light",
                        gridSize: 20
                    }
                };

                // 写入文件
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(filePath),
                    Buffer.from(JSON.stringify(initialContent, null, 2), 'utf8')
                );

                // 显示成功消息
                vscode.window.showInformationMessage('Excalidraw画布创建成功');

                // 询问用户是否要打开画布
                const openOptions = [
                    { label: '是', description: '打开Excalidraw画布' },
                    { label: '否', description: '稍后手动打开' }
                ];

                const selected = await vscode.window.showQuickPick(openOptions, {
                    placeHolder: '是否立即打开画布？'
                });

                if (selected && selected.label === '是') {
                    // 使用vscode.open命令打开文件
                    const uri = vscode.Uri.file(filePath);
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`创建Excalidraw画布失败: ${error.message}`);
            }
        })
    );
    
    // 注册创建并打开Drawio命令
    console.log('注册命令: lingxixiezuo.createDrawio');
    let createDrawioDisposable = vscode.commands.registerCommand('lingxixiezuo.createDrawio', createAndOpenDrawioCommand);

    context.subscriptions.push(
        copyTextDisposable,
        copyCodeDisposable,
        readClipboardDisposable,
        showHistoryDisposable,
        pasteSmartDisposable,
        viewProvider,
        startChatServerDisposable,
        stopChatServerDisposable,
        createDrawioDisposable,
        recordAudioDisposable
    );
    
    console.log('所有命令注册完成');
    vscode.window.showInformationMessage('灵犀协作插件命令注册完成');
}

function deactivate() {
    console.log('灵犀协作插件已停用');
}

module.exports = {
    activate,
    deactivate
};