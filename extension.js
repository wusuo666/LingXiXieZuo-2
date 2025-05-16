const vscode = require('vscode');
const { copyToClipboard, getClipboardHistory, readFromClipboard, filterClipboardHistoryByContext } = require('./clipboard');
const LingxiSidebarProvider = require('./sidebar/sidebarViewProvider');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const agentApi = require('./agent/agentApi');
const { startChatServer, stopChatServer, setSidebarProvider } = require('./chatroom/startServer');
const { createAndOpenDrawio } = require('./createDrawio');
const { runASR } = require('./pyyuyin/ifasr-nodejs');

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
 * 激活插件时的回调函数
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    console.log('灵犀协作插件已激活');
    
    // 插件激活时，尝试从 secrets 加载 API Key 并更新 agentApi 配置
    try {
        const storedApiKey = await context.secrets.get('lingxi.apiKey');
        if (storedApiKey) {
            agentApi.updateConfig({ apiKey: storedApiKey });
            console.log('已加载存储的 API Key。');
        } else {
            console.log('未找到存储的 API Key。');
        }
    } catch (error) {
        console.error('加载 API Key 失败:', error);
    }
    
    // 输出调试信息，帮助诊断命令注册问题
    console.log('正在注册命令...');
    vscode.window.showInformationMessage('灵犀协作插件已激活，正在注册命令...');

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
    const viewProvider = vscode.window.registerWebviewViewProvider('lingxixiezuoView', sidebarProvider);

    // 注册启动聊天室服务器命令
    console.log('注册命令: lingxixiezuo.startChatServer');
    let startChatServerDisposable = vscode.commands.registerCommand('lingxixiezuo.startChatServer', () => {
        startChatServer();
    });

    // 注册运行ASR测试命令
    console.log('注册命令: lingxixiezuo.runAsrTest');
    let runAsrTestDisposable = vscode.commands.registerCommand('lingxixiezuo.runAsrTest', async (params) => {
        // 在VSCode终端显示进度信息
        const terminal = vscode.window.createTerminal('ASR测试');
        terminal.show();
        terminal.sendText('echo 正在启动ASR语音识别...');
        
        // 默认使用音频目录下的测试文件
        let audioFile = path.join(__dirname, 'pyyuyin', 'audio', 'lfasr_涉政.wav');
        let outputPath = null;
        
        try {
            // 获取用户工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('请先打开一个工作区');
            }
            
            // 处理输出文件参数
            if (params && params.outputFile) {
                // 创建统一的输出目录路径
                const outputDir = path.join(workspaceFolders[0].uri.fsPath, 'yuyin', 'output');
                outputPath = path.join(outputDir, params.outputFile);
                
                // 确保输出目录存在
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }
                
                console.log(`ASR输出目录: ${outputDir}`);
                console.log(`ASR输出文件: ${outputPath}`);
                terminal.sendText(`echo 输出文件将保存至: ${outputPath}`);
            }
            
            // 在终端显示正在处理的文件
            terminal.sendText(`echo 正在处理音频文件: ${audioFile}`);
            
            // 调用ASR模块进行语音识别
            const result = await runASR({
                audioFile: audioFile,
                outputFile: outputPath
            });
            
            // 处理结果
            terminal.sendText('echo 语音识别处理完成!');
            
            if (outputPath) {
                vscode.window.showInformationMessage(`ASR测试已完成，结果已保存到: ${params.outputFile}`);
                
                // 检查文件是否创建成功
                if (fs.existsSync(outputPath)) {
                    terminal.sendText(`echo 结果文件已生成: ${outputPath}`);
                } else {
                    terminal.sendText('echo 警告: 结果文件可能未生成，请检查终端输出');
                    vscode.window.showWarningMessage('ASR结果文件可能未生成，请检查终端输出');
                }
            } else {
                vscode.window.showInformationMessage('ASR测试已完成');
            }
        } catch (error) {
            terminal.sendText(`echo 错误: ${error.message}`);
            console.error('ASR执行失败:', error);
            vscode.window.showErrorMessage(`ASR测试失败: ${error.message}`);
        }
    });
    
    // 注册停止聊天室服务器命令
    console.log('注册命令: lingxixiezuo.stopChatServer');
    let stopChatServerDisposable = vscode.commands.registerCommand('lingxixiezuo.stopChatServer', stopChatServer);

    // 注册创建Excalidraw画布的命令
    console.log('注册命令: lingxixiezuo.createExcalidraw');
    let createExcalidrawDisposable = vscode.commands.registerCommand('lingxixiezuo.createExcalidraw', async () => {
        try {
            // 获取当前工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('请先打开一个工作区');
            }
            const workspacePath = workspaceFolders[0].uri.fsPath;

            // 生成新的格式的文件名：年-月-日-时-分-秒-2位编号
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            const hour = now.getHours();
            const minute = now.getMinutes();
            const second = now.getSeconds();
            
            // 获取当前时间戳的最后两位作为编号
            const timestamp = Date.now().toString();
            const sequence = timestamp.slice(-2);
            
            const fileName = `画布_${year}-${month}-${day}-${hour}-${minute}-${second}-${sequence}.excalidraw`;
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
    });
    
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
        runAsrTestDisposable,
        stopChatServerDisposable,
        createExcalidrawDisposable,
        createDrawioDisposable
    );
    
    console.log('所有命令注册完成');
    vscode.window.showInformationMessage('灵犀协作插件命令注册完成');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};