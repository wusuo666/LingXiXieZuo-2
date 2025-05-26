const vscode = require('vscode');
const LingxiSidebarProvider = require('./sidebar/sidebarViewProvider');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const agentApi = require('./agent/agentApi');
const { startChatServer, stopChatServer, setSidebarProvider } = require('./chatroom/startServer');
const { createAndOpenDrawio } = require('./createDrawio');
const { setExcalidrawDir } = require('./agent/server.js');
const { spawn } = require('child_process');
const { runASR } = require('./pyyuyin/ifasr-nodejs');

// 创建全局变量以便在其他模块中访问sidebarProvider
global.sidebarProvider = null;

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

    // 注册灵犀协作侧边栏视图
    // 包含协作区(聊天室、Agent、设置)、剪贴板历史和协同画布三个主要功能区域
    const sidebarProvider = new LingxiSidebarProvider(context);
    
    // 设置全局变量，使其他模块可以访问sidebarProvider
    global.sidebarProvider = sidebarProvider;
    
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
    let startChatServerDisposable = vscode.commands.registerCommand('lingxixiezuo.startChatServer', async () => {
        const startServer = require('./chatroom/startServer');
        await startServer.startChatServer();
    });
    
    // 注册运行ASR测试命令
    console.log('注册命令: lingxixiezuo.runAsrTest');
    let runAsrTestDisposable = vscode.commands.registerCommand('lingxixiezuo.runAsrTest', async (params) => {
        // 在VSCode终端显示进度信息
        const terminal = vscode.window.createTerminal('ASR测试');
        terminal.show();
        terminal.sendText('echo 正在启动ASR语音识别...');
        
        try {
            // 获取用户工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('请先打开一个工作区');
            }
            
            // 获取recordings目录下的所有wav文件
            const recordingsDir = path.join(workspaceFolders[0].uri.fsPath, 'recordings');
            if (!fs.existsSync(recordingsDir)) {
                throw new Error('未找到recordings目录，请先进行语音会议');
            }
            
            // 读取recordings目录下的所有wav文件并按会议ID分组
            const files = fs.readdirSync(recordingsDir)
                .filter(file => file.startsWith('stream_') && file.endsWith('.wav'));
            
            if (files.length === 0) {
                throw new Error('未找到会议录音文件，请先进行语音会议');
            }

            // 按会议ID分组文件
            const conferenceGroups = {};
            files.forEach(file => {
                const parts = file.split('_');
                if (parts.length >= 4) { // 确保文件名格式正确：stream_conference_会议ID_时间戳.wav
                    // 会议ID在stream_conference_之后，时间戳之前
                    // 例如：stream_conference_1747827276364_2025-05-21_19-34-36.wav
                    const conferenceId = parts[2]; // 获取会议ID部分
                    if (!conferenceGroups[conferenceId]) {
                        conferenceGroups[conferenceId] = [];
                    }
                    conferenceGroups[conferenceId].push(file);
                }
            });

            // 为每个会议ID创建选项，添加更多信息
            const conferenceOptions = Object.keys(conferenceGroups).map(confId => {
                // 获取该会议的第一个文件的时间戳作为会议开始时间
                const firstFile = conferenceGroups[confId][0];
                const timeParts = firstFile.split('_').slice(-2);
                const meetingTime = timeParts.join(' ').replace('.wav', '');
                
                return {
                    label: `会议 ${confId}`,
                    description: `${conferenceGroups[confId].length} 个录音文件`,
                    detail: `开始时间: ${meetingTime} | 文件数: ${conferenceGroups[confId].length}`,
                    conferenceId: confId
                };
            }).sort((a, b) => {
                // 提取时间戳部分进行比较
                const timeA = a.detail.split('开始时间: ')[1].split(' |')[0];
                const timeB = b.detail.split('开始时间: ')[1].split(' |')[0];
                return timeB.localeCompare(timeA); // 倒序排列，从晚到早
            });

            // 让用户选择会议
            const selectedConference = await vscode.window.showQuickPick(conferenceOptions, {
                placeHolder: '请选择要转写的会议',
                canPickMany: false,
                ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true
            });
            
            if (!selectedConference) {
                terminal.sendText('echo 已取消转写');
                vscode.window.showInformationMessage('已取消转写操作');
                return;
            }

            // 获取选中会议的所有文件并按时间排序
            const selectedFiles = conferenceGroups[selectedConference.conferenceId]
                .sort((a, b) => {
                    // 提取时间戳部分进行比较
                    const timeA = a.split('_').slice(-2).join('_').replace('.wav', '');
                    const timeB = b.split('_').slice(-2).join('_').replace('.wav', '');
                    return timeA.localeCompare(timeB); // 升序排列，从早到晚
                });

            // 创建输出目录
            const outputDir = path.join(workspaceFolders[0].uri.fsPath, 'yuyin', 'output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // 生成输出文件名（使用会议ID）
            const outputFileName = `meeting_${selectedConference.conferenceId}_transcript.txt`;
            const outputPath = path.join(outputDir, outputFileName);
            
            // 创建或清空输出文件
            fs.writeFileSync(outputPath, `会议 ${selectedConference.conferenceId} 的语音转写记录\n\n`);
            
            terminal.sendText(`echo 开始处理会议 ${selectedConference.conferenceId} 的录音文件...`);
            
            // 依次处理每个文件
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                terminal.sendText(`echo 正在处理第 ${i + 1}/${selectedFiles.length} 个文件: ${file}`);
                
                // 构建完整的文件路径
                const audioFile = path.join(recordingsDir, file);
                
                // 为每个文件创建临时输出文件
                const tempOutputPath = path.join(outputDir, `temp_${file.replace('.wav', '.txt')}`);
                
                // 调用ASR模块进行语音识别，输出到临时文件
                const result = await runASR({
                    audioFile: audioFile,
                    outputFile: tempOutputPath
                });
                
                // 读取临时文件内容
                if (fs.existsSync(tempOutputPath)) {
                    const content = fs.readFileSync(tempOutputPath, 'utf8');
                    
                    // 处理内容，确保行号正确
                    const lines = content.split('\n');
                    const processedLines = lines.map((line, index) => {
                        // 如果行以数字开头，更新行号
                        if (/^\d+/.test(line)) {
                            // 计算新的行号：当前文件的行号 + 之前所有文件的总行数
                            const newLineNumber = index + 1;
                            return line.replace(/^\d+/, newLineNumber.toString());
                        }
                        return line;
                    });
                    
                    // 将处理后的内容追加到最终文件
                    fs.appendFileSync(outputPath, processedLines.join('\n') + '\n');
                    
                    // 添加分隔符
                    fs.appendFileSync(outputPath, `\n--- 文件 ${file} 转写结束 ---\n\n`);
                    
                    // 删除临时文件
                    fs.unlinkSync(tempOutputPath);
                }
            }
            
            // 处理完成
            terminal.sendText('echo 所有文件处理完成!');
            vscode.window.showInformationMessage(`会议 ${selectedConference.conferenceId} 的语音转写已完成，结果已保存到: ${outputFileName}`);
            
            // 检查文件是否创建成功
            if (fs.existsSync(outputPath)) {
                terminal.sendText(`echo 结果文件已生成: ${outputPath}`);
            } else {
                terminal.sendText('echo 警告: 结果文件可能未生成，请检查终端输出');
                vscode.window.showWarningMessage('ASR结果文件可能未生成，请检查终端输出');
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
        viewProvider,
        startChatServerDisposable,
        stopChatServerDisposable,
        createDrawioDisposable,
        recordAudioDisposable,
        createExcalidrawDisposable,
        runAsrTestDisposable
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