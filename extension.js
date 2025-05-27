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
const os = require('os');

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
 * @returns {Promise<Object>} 返回包含base64编码音频数据和文件名的对象
 */
async function handleExternalAudioRecord() {
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
            statusBar.text = `$(record) 正在录音...`;
            statusBar.tooltip = '正在录制语音消息，点击结束录音';
            statusBar.command = 'lingxixiezuo.stopRecordAudio';
            statusBar.show();
            
            // 执行录音脚本，使用start模式
            const node = process.platform === 'win32' ? 'node.exe' : 'node';
            
            // 获取当前工作区路径，确保路径正确
            const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            
            console.log('当前工作区路径:', currentWorkspacePath);
            
            // 检查是否已存在录音状态文件
            const statusFilePath = path.join(os.tmpdir(), 'audio_recording_status.json');
            if (fs.existsSync(statusFilePath)) {
                try {
                    const statusData = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
                    if (statusData.pid) {
                        // 尝试检查进程是否仍在运行
                        try {
                            process.kill(statusData.pid, 0); // 测试进程是否存在
                            throw new Error(`有正在进行的录音进程(PID: ${statusData.pid})，请先停止它`);
                        } catch (e) {
                            if (e.code !== 'ESRCH') {
                                throw new Error(`有正在进行的录音进程，但无法访问: ${e.message}`);
                            }
                            // 如果进程不存在，则可以继续启动新的录音
                            console.log(`旧录音进程 ${statusData.pid} 已不存在，将删除状态文件`);
                            fs.unlinkSync(statusFilePath);
                        }
                    }
                } catch (e) {
                    if (e.message.startsWith('有正在进行的录音进程')) {
                        throw e; // 重新抛出验证错误
                    }
                    // 其他错误，如文件读取或解析错误，则删除文件
                    console.error('读取录音状态文件失败，将删除并重新开始:', e);
                    try {
                        fs.unlinkSync(statusFilePath);
                    } catch (unlinkErr) {
                        console.error('删除状态文件失败:', unlinkErr);
                    }
                }
            }
            
            // 使用数组传递参数，正确处理路径中的空格
            const recordProcess = spawn(node, [
                scriptPath, 
                'start', 
                currentWorkspacePath,
                '-workspace', // 添加-workspace参数
                currentWorkspacePath  // 同时通过参数和命令行选项传递工作区路径
            ]);
            
            console.log(`启动录音进程，命令: ${node} ${scriptPath} start "${currentWorkspacePath}", PID: ${recordProcess.pid}`);
            
            // 将进程ID保存在全局变量中，以便停止录音时使用
            global.currentRecordingProcess = {
                process: recordProcess,
                statusBar: statusBar,
                startTime: Date.now(),
                resolve: resolve,
                reject: reject
            };
            
            let outputData = '';
            let errorData = '';
            
            recordProcess.stdout.on('data', (data) => {
                outputData += data.toString();
                console.log('录音脚本标准输出:', data.toString().trim());
            });
            
            recordProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                console.log('录音脚本错误输出:', data.toString().trim());
            });
            
            recordProcess.on('close', (code) => {
                console.log(`录音进程已关闭，退出码: ${code}`);
                
                // 进程关闭时，清除全局变量
                if (global.currentRecordingProcess && 
                    global.currentRecordingProcess.process === recordProcess) {
                    global.currentRecordingProcess = null;
                }
                
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
                    // 改进的JSON解析逻辑
                    // 1. 尝试直接解析整个输出
                    // 2. 如果失败，尝试提取JSON部分
                    // 3. 确保错误处理更完善

                    let resultObject = null;
                    try {
                        // 直接尝试解析整个输出
                        resultObject = JSON.parse(outputData.trim());
                        console.log('成功解析录音结果(直接解析)');
                    } catch (directParseError) {
                        console.log('直接解析JSON失败，尝试提取JSON部分:', directParseError);
                        
                        // 查找JSON开始的花括号位置
                        const jsonStartIndex = outputData.indexOf('{');
                        const jsonEndIndex = outputData.lastIndexOf('}') + 1;
                        
                        if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
                            // 提取可能的JSON部分
                            const jsonPart = outputData.substring(jsonStartIndex, jsonEndIndex);
                            try {
                                // 尝试解析提取的JSON部分
                                resultObject = JSON.parse(jsonPart);
                                console.log('成功解析录音结果(提取JSON部分)');
                            } catch (extractParseError) {
                                throw new Error(`解析录音输出JSON失败: ${extractParseError.message}, JSON片段: ${jsonPart.substring(0, 100)}...`);
                            }
                        } else {
                            throw new Error(`录音输出中未找到有效的JSON数据，输出内容: ${outputData.substring(0, 100)}...`);
                        }
                    }
                    
                    // 确认resultObject不为空并且包含必要字段
                    if (!resultObject || (typeof resultObject !== 'object')) {
                        throw new Error('解析后的录音结果格式无效');
                    }
                    
                    // 检查录音是否成功
                    if (resultObject.success === false) {
                        throw new Error(`录音脚本返回错误: ${resultObject.error || '未知错误'}`);
                    }
                    
                    // 录音数据已经在recordAudio.js中直接保存到recordings文件夹
                    console.log('录音完成, 文件名:', resultObject.filename);
                    
                    // 显示保存成功的通知
                    vscode.window.showInformationMessage(`录音已保存: ${resultObject.filename}`);
                    
                    // 确保结果中包含必要的字段
                    const finalResult = {
                        success: true,
                        filename: resultObject.filename || `recording_${Date.now()}.wav`,
                        audioData: resultObject.audioData || '',
                        duration: resultObject.duration || resultObject.durationMs / 1000 || 0
                    };
                    
                    // 在发送消息前检查是否已发送
                    let audioMessageSent = false;
                    
                    if (!audioMessageSent && finalResult.audioData && global.chatWebSocketServer) {
                        try {
                            // 获取用户ID和名称
                            const userId = global.chatSettings?.userId || 'unknown_user';
                            const userName = global.chatSettings?.userName || '未知用户';
                            
                            // 创建语音消息对象
                            const audioMessage = {
                                type: 'audio',
                                userId: userId,
                                sender: {
                                    id: userId,
                                    name: userName
                                },
                                timestamp: Date.now(),
                                audioData: finalResult.audioData,
                                audioFilename: finalResult.filename,
                                duration: finalResult.duration,
                                mimeType: 'audio/wav'
                            };
                            
                            // 发送消息到所有连接的客户端
                            global.chatWebSocketServer.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify(audioMessage));
                                }
                            });
                            
                            console.log('已向聊天服务器发送语音消息');
                        } catch (sendError) {
                            console.error('发送语音消息到服务器失败:', sendError);
                            // 这里不抛出异常，因为录音功能本身已经成功了
                        }
                        
                        audioMessageSent = true; // 设置标志
                    }
                    
                    // 返回处理后的结果对象
                    resolve(finalResult);
                    
                } catch (parseError) {
                    console.error('解析录音脚本输出失败:', parseError, '原始输出:', outputData);
                    
                    // 尝试从错误输出中提取文件名和路径信息
                    let audioFile = null;
                    let filename = null;
                    
                    // 检查是否包含文件保存信息
                    const filenameMatch = errorData.match(/将保存录音文件: (.+\.wav)/);
                    const completedMatch = errorData.match(/录音已完成，文件保存至: (.+\.wav)/);
                    
                    if (completedMatch && completedMatch[1]) {
                        audioFile = completedMatch[1];
                        filename = path.basename(audioFile);
                    } else if (filenameMatch && filenameMatch[1]) {
                        audioFile = filenameMatch[1];
                        filename = path.basename(audioFile);
                    }
                    
                    // 尝试读取文件作为最后的恢复手段
                    if (filename && audioFile && fs.existsSync(audioFile)) {
                        try {
                            const audioData = fs.readFileSync(audioFile).toString('base64');
                            console.log('成功从文件读取音频数据:', filename);
                            vscode.window.showInformationMessage(`录音已保存: ${filename}`);
                            
                            // 新增: 如果通过文件恢复了音频数据，同样发送到服务器
                            if (audioData && global.chatWebSocketServer) {
                                try {
                                    // 获取用户ID和名称
                                    const userId = global.chatSettings?.userId || 'unknown_user';
                                    const userName = global.chatSettings?.userName || '未知用户';
                                    
                                    // 创建语音消息对象
                                    const audioMessage = {
                                        type: 'audio',
                                        userId: userId,
                                        sender: {
                                            id: userId,
                                            name: userName
                                        },
                                        timestamp: Date.now(),
                                        audioData: audioData,
                                        audioFilename: filename,
                                        duration: 0, // 从文件恢复时无法获取准确时长
                                        mimeType: 'audio/wav'
                                    };
                                    
                                    // 发送消息到所有连接的客户端
                                    global.chatWebSocketServer.clients.forEach(client => {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(JSON.stringify(audioMessage));
                                        }
                                    });
                                    
                                    console.log('已从文件中恢复并发送语音消息到服务器');
                                } catch (sendError) {
                                    console.error('从文件恢复后发送语音消息到服务器失败:', sendError);
                                }
                            }
                            
                            resolve({ audioData, filename, success: true });
                            return;
                        } catch (readError) {
                            console.error('读取音频文件失败:', readError);
                        }
                    }
                    
                    // 如果所有尝试都失败，则返回错误
                    reject(new Error(`解析录音结果失败: ${parseError.message}`));
                }
            });
            
            recordProcess.on('error', (err) => {
                // 发生错误时，清除全局变量
                if (global.currentRecordingProcess && 
                    global.currentRecordingProcess.process === recordProcess) {
                    global.currentRecordingProcess = null;
                }
                
                statusBar.dispose();
                reject(err);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 处理停止录音的函数
 * @returns {Promise<Object>} 包含录音结果的Promise
 */
async function handleStopAudioRecording() {
    return new Promise((resolve, reject) => {
        try {
            // 检查是否有正在进行的录音
            let processToStop = null;
            let statusBar = null;
            let startTime = null;
            let resolveCallback = null;
            
            // 录音状态文件路径
            const statusFilePath = path.join(os.tmpdir(), 'audio_recording_status.json');
            // 停止命令文件路径
            const stopCommandFile = path.join(os.tmpdir(), 'audio_recording_stop_command');
            
            // 1. 首先检查全局变量中是否有正在进行的录音进程
            if (global.currentRecordingProcess) {
                processToStop = global.currentRecordingProcess.process;
                statusBar = global.currentRecordingProcess.statusBar;
                startTime = global.currentRecordingProcess.startTime;
                resolveCallback = global.currentRecordingProcess.resolve; // 保存原始Promise的resolve回调
                console.log('从全局变量获取到录音进程:', processToStop.pid);
            } else {
                // 2. 如果全局变量中没有，则尝试从状态文件中读取
                try {
                    const statusData = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
                    if (statusData.pid) {
                        console.log('从状态文件获取到录音进程PID:', statusData.pid);
                        // 创建状态栏
                        statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
                        statusBar.text = `$(sync~spin) 正在结束录音...`;
                        statusBar.show();
                        startTime = statusData.startTime;
                    } else {
                        throw new Error('状态文件中没有有效的进程ID');
                    }
                } catch (parseErr) {
                    console.error('读取状态文件失败:', parseErr);
                    throw new Error(`读取状态文件失败: ${parseErr.message}`);
                }
            }
            
            // 录音时长（毫秒）
            const recordDuration = startTime ? (Date.now() - startTime) : 0;
            
            // 更新状态栏显示
            if (statusBar) {
                statusBar.text = `$(sync~spin) 正在结束录音...`;
                statusBar.tooltip = '正在处理录音数据';
                statusBar.command = undefined;
            }
            
            console.log('正在结束录音...');
            
            // 记录录音输出数据
            let recordingOutputData = '';
            let recordingErrorData = '';
            
            if (processToStop) {
                // 如果有进程句柄，添加数据收集
                processToStop.stdout.on('data', (data) => {
                    recordingOutputData += data.toString();
                    console.log('录音脚本输出:', data.toString().trim());
                });
                
                processToStop.stderr.on('data', (data) => {
                    recordingErrorData += data.toString();
                    console.log('录音脚本错误:', data.toString().trim());
                });
            }
            
            // 创建停止命令文件
            try {
                fs.writeFileSync(stopCommandFile, `stop_command_${Date.now()}`);
                console.log(`已创建停止命令文件: ${stopCommandFile}`);
                
                // 设置超时检查，确保录音确实停止
                let attempts = 0;
                const maxAttempts = 10; // 最多等待5秒(10次 * 500ms)
                
                const checkRecordingStopped = () => {
                    attempts++;
                    try {
                        // 检查状态文件是否已被删除（录音进程正常退出时会删除该文件）
                        if (!fs.existsSync(statusFilePath)) {
                            console.log('录音已成功停止（状态文件已删除）');
                            
                            // 解析录音结果
                            let recordingResult = null;
                            try {
                                // 查找JSON输出
                                const jsonStartIndex = recordingOutputData.indexOf('{');
                                if (jsonStartIndex >= 0) {
                                    // 提取JSON部分
                                    const jsonPart = recordingOutputData.substring(jsonStartIndex);
                                    recordingResult = JSON.parse(jsonPart);
                                    console.log('成功解析录音结果:', recordingResult);
                                    
                                    // 新增: 如果有音频数据，发送到聊天服务器
                                    if (recordingResult && recordingResult.audioData && global.chatWebSocketServer) {
                                        try {
                                            // 获取用户ID和名称
                                            const userId = global.chatSettings?.userId || 'unknown_user';
                                            const userName = global.chatSettings?.userName || '未知用户';
                                            
                                            // 创建语音消息对象
                                            const audioMessage = {
                                                type: 'audio',
                                                userId: userId,
                                                sender: {
                                                    id: userId,
                                                    name: userName
                                                },
                                                timestamp: Date.now(),
                                                audioData: recordingResult.audioData,
                                                audioFilename: recordingResult.filename,
                                                duration: recordingResult.duration || 0,
                                                mimeType: 'audio/wav'
                                            };
                                            
                                            // 发送消息到所有连接的客户端
                                            global.chatWebSocketServer.clients.forEach(client => {
                                                if (client.readyState === WebSocket.OPEN) {
                                                    client.send(JSON.stringify(audioMessage));
                                                }
                                            });
                                            
                                            console.log('已向聊天服务器发送语音消息');
                                        } catch (sendError) {
                                            console.error('发送语音消息到服务器失败:', sendError);
                                        }
                                    }
                                }
                            } catch (parseErr) {
                                console.error('解析录音结果失败:', parseErr);
                            }
                            
                            // 清理状态
                            if (statusBar) statusBar.dispose();
                            
                            // 清理停止命令文件
                            if (fs.existsSync(stopCommandFile)) {
                                fs.unlinkSync(stopCommandFile);
                                console.log('已删除停止命令文件');
                            }
                            
                            // 如果有原始Promise的resolve回调，传递结果
                            if (resolveCallback && recordingResult) {
                                resolveCallback(recordingResult);
                            }
                            
                            // 清理全局变量
                            global.currentRecordingProcess = null;
                            
                            // 返回结果
                            resolve(recordingResult || { success: true, message: '录音已成功结束' });
                            return;
                        }
                        
                        // 如果状态文件仍然存在，可能录音进程没有正确响应停止命令
                        if (attempts < maxAttempts) {
                            console.log(`等待录音停止中... (${attempts}/${maxAttempts})`);
                            setTimeout(checkRecordingStopped, 500);
                        } else {
                            console.log('等待录音停止超时，尝试备用方法');
                            
                            // 尝试通过命令行直接调用stop命令
                            try {
                                const scriptPath = path.join(__dirname, 'chatroom', 'recordAudio.js');
                                const node = process.platform === 'win32' ? 'node.exe' : 'node';
                                
                                // 执行脚本stop命令
                                const stopProcess = spawn(node, [scriptPath, 'stop']);
                                
                                console.log('已执行stop命令脚本');
                                
                                stopProcess.on('close', (code) => {
                                    console.log(`停止命令脚本执行完成，退出码: ${code}`);
                                    
                                    // 清理状态
                                    if (statusBar) statusBar.dispose();
                                    global.currentRecordingProcess = null;
                                    
                                    // 尝试删除状态文件和停止命令文件
                                    try {
                                        if (fs.existsSync(statusFilePath)) fs.unlinkSync(statusFilePath);
                                        if (fs.existsSync(stopCommandFile)) fs.unlinkSync(stopCommandFile);
                                    } catch (unlinkErr) {
                                        console.error('删除状态文件失败:', unlinkErr);
                                    }
                                    
                                    resolve({ success: true, message: '录音已结束（通过stop命令）' });
                                });
                            } catch (stopCommandError) {
                                console.error('执行stop命令失败:', stopCommandError);
                                
                                // 最后尝试强制结束进程
                                try {
                                    const statusData = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
                                    if (statusData.pid) {
                                        process.kill(statusData.pid, 'SIGKILL');
                                        console.log('已发送SIGKILL信号');
                                    }
                                } catch (killError) {
                                    console.error('强制终止进程失败:', killError);
                                }
                                
                                // 清理状态
                                if (statusBar) statusBar.dispose();
                                global.currentRecordingProcess = null;
                                
                                // 尝试删除状态文件和停止命令文件
                                try {
                                    if (fs.existsSync(statusFilePath)) fs.unlinkSync(statusFilePath);
                                    if (fs.existsSync(stopCommandFile)) fs.unlinkSync(stopCommandFile);
                                } catch (unlinkErr) {
                                    console.error('删除状态文件失败:', unlinkErr);
                                }
                                
                                resolve({ success: true, message: '录音已结束（强制终止）' });
                            }
                        }
                    } catch (err) {
                        console.error('检查录音状态时出错:', err);
                        
                        // 清理状态
                        if (statusBar) statusBar.dispose();
                        global.currentRecordingProcess = null;
                        
                        // 尝试删除状态文件和停止命令文件
                        try {
                            if (fs.existsSync(statusFilePath)) fs.unlinkSync(statusFilePath);
                            if (fs.existsSync(stopCommandFile)) fs.unlinkSync(stopCommandFile);
                        } catch (unlinkErr) {
                            console.error('删除状态文件失败:', unlinkErr);
                        }
                        
                        reject(err);
                    }
                };
                
                // 启动检查
                checkRecordingStopped();
                
            } catch (error) {
                console.error('创建停止命令文件失败:', error);
                
                // 尝试使用进程信号终止
                if (processToStop) {
                    try {
                        processToStop.kill('SIGTERM');
                        console.log('已发送SIGTERM信号');
                    } catch (killError) {
                        console.error('发送SIGTERM信号失败:', killError);
                    }
                }
                
                // 清理状态
                if (statusBar) statusBar.dispose();
                global.currentRecordingProcess = null;
                
                reject(error);
            }
        } catch (error) {
            console.error('停止录音时出错:', error);
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
    const appName = vscode.env.appName;
    if(appName === 'Visual Studio Code'){
        // 检查是否安装了 Excalidraw 编辑器插件
        try {
            const extensionsJsonPath = path.join(process.env.USERPROFILE, '.vscode', 'extensions', 'extensions.json');
            console.log('检查插件配置文件:', extensionsJsonPath);

            if (fs.existsSync(extensionsJsonPath)) {
                const extensionsJson = JSON.parse(fs.readFileSync(extensionsJsonPath, 'utf8'));
                console.log('已安装的插件列表:', extensionsJson);

                // 检查是否包含 Excalidraw 插件
                const hasExcalidraw = extensionsJson.some(ext => 
                    ext.identifier && (
                        ext.identifier.id === 'pomdtr.excalidraw-editor' ||
                        ext.identifier.id.includes('excalidraw-editor')
                    )
                );

                if (!hasExcalidraw) {
                    vscode.window.showWarningMessage(
                        '未检测到 Excalidraw 编辑器插件，部分功能可能无法正常使用。请安装 pomdtr.excalidraw-editor 插件。',
                        '打开插件市场'
                    ).then(selection => {
                        if (selection === '打开插件市场') {
                            vscode.commands.executeCommand('workbench.extensions.search', 'pomdtr.excalidraw-editor');
                        }
                    });
                } else {
                    console.log('已找到 Excalidraw 插件');
                }
            } else {
                console.error('插件配置文件不存在:', extensionsJsonPath);
            }
        } catch (error) {
            console.error('检查 Excalidraw 插件时出错:', error);
        }
    }
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
            console.log(11111111111);
            console.log(outputFileName);
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
            // 显示开始录音的通知
            vscode.window.showInformationMessage('正在录音...');
            
            // 调用外部录音脚本
            const result = await handleExternalAudioRecord();
            
            // 录音完成通知
            vscode.window.showInformationMessage('录音完成');
            
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`录音失败: ${error.message}`);
            return null;
        }
    });

    // 注册停止录音命令
    console.log('注册命令: lingxixiezuo.stopRecordAudio');
    let stopRecordAudioDisposable = vscode.commands.registerCommand('lingxixiezuo.stopRecordAudio', async () => {
        try {
            // 显示停止录音的通知
            vscode.window.showInformationMessage('正在停止录音...');
            
            // 调用停止录音函数
            const result = await handleStopAudioRecording();
            
            // 显示结果通知
            if (result && result.success) {
                vscode.window.showInformationMessage('录音已停止');
            } else {
                vscode.window.showErrorMessage(`停止录音失败: ${result?.error || '未知错误'}`);
            }
            
            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`停止录音失败: ${error.message}`);
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
        stopRecordAudioDisposable,
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