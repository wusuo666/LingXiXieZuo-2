// 语音录制与会议相关全局变量
var voiceRecordBtn = null;           // 语音录制按钮
var voiceRecordTimer = null;         // 录音计时器显示
var isInConference = false;          // 是否在会议中
var currentConference = null;        // 当前会议ID
var isMuted = false;                 // 是否静音
var conferenceParticipants = [];     // 会议参与者列表
var audioSourceNodes = new Map();    // 音频源节点（Web Audio API播放用）
var isRecording = false;             // 是否正在录音
var recordingStartTime = 0;          // 录音开始时间
var recordingTimer = null;           // 录音计时器
var currentUserId = 'unknown_user';  // 当前用户ID
var currentlyPlayingAudio = null;    // 当前正在播放的音频
var globalAudioContext = null;       // 全局音频上下文
let echoCancellationEnabled = true; // 默认启用回声消除
var isStreamingAudio = false;      // 音频流状态
var audioSourceNodes = new Map();  // 活动音频源映射
var conferenceParticipants = [];   // 内部状态数组（不再显示）

/**
 * 侧边栏主逻辑初始化
 * 包含tab切换、AI、剪贴板、MCP、聊天室等所有功能
 */
document.addEventListener('DOMContentLoaded', function() {

    console.log(1111111111);
    // ========== 侧边栏主逻辑迁移自 sidebar.html <script> ========== //
    // tab页切换
    //全局变量 
    //语音消息全局变量
    // 使用全局的currentUserId变量，不再重新定义
    let currentlyPlayingAudio = null; // 当前正在播放的音频元素
    // 语音录制变量
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingStartTime = 0;
    let recordingTimer = null;
    let isRecording = false;
    let currentAudio = null; // 当前播放的音频元素

    // 初始化语音录制按钮和定时器显示
    voiceRecordBtn = document.getElementById('voice-record-btn');
    voiceRecordTimer = document.querySelector('.voice-record-timer');
    if (voiceRecordTimer) voiceRecordTimer.style.display = 'none';
    console.log(222222222222);


    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('收到消息:', message);
        
        if (message.command === 'memoFilesList') {
            const files = message.files || [];
            if (files.length === 0) {
                if (window.vscode) {
                    window.vscode.postMessage({ command: 'showError', text: '未找到任何会议纪要文件！' });
                }
                return;
            }
            // 让 extension 弹出选择框
            window.vscode.postMessage({ command: 'requestMemoFilePick', files });
        }
        // 新增监听，收到 extension 选中的文件后再发 aiSummaryMemo
        if (message.command === 'memoFilePicked') {
            if (message.file) {
                window.vscode.postMessage({ command: 'aiSummaryMemo', file: message.file });
            }
        }

        if (message.command === 'memoSummaryResult') {
            // 展示AI总结结果
            if (window.vscode) {
                window.vscode.postMessage({ command: 'showInfo', text: 'AI总结结果：\n' + message.summary });
            }
        }

        if (message.command === 'apiKeyStatus') {
            const statusElement = document.getElementById('zhipuai-api-key-status');
            if (statusElement) {
                if (message.isSet) {
                    statusElement.textContent = '已设置';
                    statusElement.style.color = '#4CAF50'; // 绿色表示已设置
                } else {
                    statusElement.textContent = '未设置';
                    statusElement.style.color = '#aaa'; // 默认灰色
                }
            }
        }
        
        if (message.command === 'deepseekApiKeyStatus') {
            const statusElement = document.getElementById('deepseek-api-key-status');
            if (statusElement) {
                if (message.isSet) {
                    statusElement.textContent = '已设置';
                    statusElement.style.color = '#4CAF50'; // 绿色表示已设置
                } else {
                    statusElement.textContent = '未设置';
                    statusElement.style.color = '#aaa'; // 默认灰色
                }
            }
        }
        
        if (message.command === 'chatServerStatus') {
            // 处理服务器状态更新
            updateServerStatus(message);
        }

        // 处理ASR测试启动消息
        if (message.command === 'asrTestStarted') {
            const messagesContainer = document.getElementById('chat-messages');
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const systemMessageHtml = `
                <div class="chat-row system">
                    <div class="system-message">
                        <div class="system-message-content">ASR测试程序已在终端中启动${message.outputFile ? '<br>结果将保存到文件: ' + message.outputFile : ''}</div>
                        <div class="chat-time">${time}</div>
                    </div>
                </div>
            `;
            
            messagesContainer.insertAdjacentHTML('beforeend', systemMessageHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // 聊天消息响应
        if (message.command === 'chatResponse') {
            // 添加助手响应到聊天界面
            
            console.log(message);
            const messagesContainer = document.querySelector('.chat-messages');
            console.log(message.content);
            let messageContent = message.content;
            console.log(message.canvasData);
            
            // 如果是画布消息,添加预览按钮
            if (message.canvasData) {
                messageContent += `<button class="preview-canvas-btn" data-canvas='${JSON.stringify(message.canvasData)}'>预览画布</button>`;
            }
            
            const botMessageHtml = `
                <div class="chat-row left">
                    <div class="chat-avatar-group">
                        <div class="avatar">A</div>
                        <div class="sender">${message.sender}</div>
                    </div>
                    <div class="chat-bubble-group">
                        <div class="chat-bubble left">${messageContent}</div>
                        <div class="chat-time">${message.time}</div>
                    </div>
                </div>
            `;
            
            messagesContainer.insertAdjacentHTML('beforeend', botMessageHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            // 为新添加的预览按钮绑定事件
            const previewBtn = messagesContainer.querySelector('.preview-canvas-btn:last-child');
            if (previewBtn) {
                previewBtn.addEventListener('click', function() {
                    const canvasData = JSON.parse(this.dataset.canvas);
                    if (window.vscode) {
                        window.vscode.postMessage({
                            command: 'previewCanvas',
                            fileName: canvasData.fileName,
                            content: canvasData.content
                        });
                    }
                });
            }
        } 

        // 处理语音消息
        if (message.command === 'addAudioMessage') {
            handleAudioMessage(message.message);
        }
        
        // 处理私聊语音消息
        if (message.command === 'addPrivateAudioMessage') {
            // 类似handleAudioMessage，但标记为私聊
            const privateMessage = message.message;
            privateMessage.isPrivate = true;
            handleAudioMessage(privateMessage);
        }
        
        // 处理音频播放错误
        if (message.command === 'audioPlaybackError') {
            console.error('音频播放错误:', message.error);
            // 重置所有语音消息的播放状态
            document.querySelectorAll('.voice-message.playing').forEach(el => {
                el.classList.remove('playing');
                const icon = el.querySelector('.voice-message-icon');
                if (icon) icon.textContent = '🔊';
            });
            currentlyPlayingAudio = null;
            
            if (message.error) {
                vscode.postMessage({
                    command: 'showError',
                    text: '播放失败: ' + message.error
                });
            }
        }
        
        // 更新当前用户ID
        if (message.command === 'updateCurrentUser') {
            currentUserId = message.userId;
            console.log('[调试] 更新当前用户ID:', currentUserId);
        }
        
        // 处理音频播放完成
        if (message.command === 'audioPlaybackEnded') {
            // 重置所有语音消息的播放状态
            document.querySelectorAll('.voice-message.playing').forEach(el => {
                el.classList.remove('playing');
                const icon = el.querySelector('.voice-message-icon');
                if (icon) icon.textContent = '🔊';
            });
            currentlyPlayingAudio = null;
        }
        
        // 处理停止音频播放
        if (message.command === 'stopAudioPlayback') {
            if (currentlyPlayingAudio) {
                currentlyPlayingAudio.pause();
                currentlyPlayingAudio.currentTime = 0;
                currentlyPlayingAudio = null;
                
                // 重置所有语音消息的播放状态
                document.querySelectorAll('.voice-message.playing').forEach(el => {
                    el.classList.remove('playing');
                    const icon = el.querySelector('.voice-message-icon');
                    if (icon) icon.textContent = '🔊';
                });
                // 通知后端播放已停止
                vscode.postMessage({
                    command: 'audioPlaybackEnded'
                });
            }
        }

        // 处理录音结果
        if (message.command === 'audioRecordResult') {
            const { success, audioData, duration, error } = message;
            
            if (success && audioData) {
                // 获取语音文件名
                let audioFilename = null;
                if (message.audioFilename) {
                    audioFilename = message.audioFilename;
                    // 创建或更新全局audioFileMap，用于保存语音消息ID和文件名的映射
                    if (!window.audioFileMap) {
                        window.audioFileMap = {};
                    }
                    
                    // 创建具有唯一性的消息ID，使用文件名的一部分确保唯一性
                    // 从文件名中提取唯一部分 (格式为 recording_YYYY-MM-DDThh-mm-ss-mmmZ_uniqueId.wav)
                    const uniquePart = audioFilename.split('_').slice(2).join('_').replace('.wav', '');
                    const messageId = `audio_${uniquePart}`;
                    
                    // 将文件名与生成的消息ID一起保存，确保一一对应
                    window.audioFileMap[messageId] = audioFilename;
                    
                    // 将文件名和消息ID暂存，当消息发送后会与消息一起使用
                    window.lastRecordedAudioFilename = audioFilename;
                    window.lastRecordedMessageId = messageId;
                    
                    console.log('记录语音文件映射:', {
                        messageId,
                        filename: audioFilename,
                        时间: new Date().toLocaleTimeString()
                    });
                }
                
                // 发送语音消息，包含录音文件名和消息ID，确保包含当前用户ID
                vscode.postMessage({
                    command: 'sendAudioMessage',
                    audioData: audioData,
                    duration: duration || Math.round((Date.now() - recordingStartTime) / 1000),
                    audioFilename: audioFilename,
                    messageId: window.lastRecordedMessageId,
                    userId: currentUserId // 确保包含当前用户ID
                });
            } else if (error) {
                console.error('录音失败:', error);
                vscode.postMessage({
                    command: 'showError',
                    text: `录音失败: ${error}`
                });
            }
            
            // 确保UI处于非录制状态
            isRecording = false;
            clearTimeout(recordingTimer);
            voiceRecordBtn.classList.remove('recording');
            voiceRecordTimer.style.display = 'none';
        }

        // 处理后端发来的音频数据
        if (message.command === 'playAudioData') {
            if (message.audioData) {
                console.log('收到音频数据，准备播放', message.filename ? `文件名: ${message.filename}` : '');
                playAudio(message.audioData, message.mimeType || 'audio/wav');
            }
        }

        // 处理会议相关消息
        if (message.type === 'voiceConference') {
            console.log('[调试] 收到会议消息:', message);
            handleConferenceMessage(message);
        }
        
        // 处理从VSCode扩展转发的WebSocket消息
        if (message.command === 'forwardWebSocketMessage') {
            const wsMessage = message.wsMessage;
            console.log('[调试] 收到转发的WebSocket消息, 类型:', wsMessage?.type);
            
            // 确保是一个有效的消息对象
            if (wsMessage && typeof wsMessage === 'object') {
                // 处理音频流消息
                if (wsMessage.type === 'audioStream') {
                    console.log('[调试] 收到音频流消息:', {
                        发送者ID: wsMessage.senderId, 
                        发送者名称: wsMessage.senderName,
                        会议ID: wsMessage.conferenceId,
                        当前用户ID: currentUserId,
                        数据长度: wsMessage.audioData ? wsMessage.audioData.length : 0,
                        序列号: wsMessage.sequence
                    });
                    playAudioStream(wsMessage);
                }
                // 处理会议相关消息
                else if (wsMessage.type === 'voiceConference') {
                    handleConferenceMessage(wsMessage);
                }
            }
        }
        
        // 直接处理音频流消息（从WebSocket直接传来的，不经过扩展转发）
        if (message.type === 'audioStream') {
            console.log('[调试] 直接收到音频流消息');
            playAudioStream(message);
        }
        
        if (message.command === 'addSystemMessage') {
            // 处理系统消息（如用户加入/离开）
            const msg = message.message;
            const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            
            // 系统消息居中显示
            const chatMessages = document.querySelector('.chat-messages');
            const systemMessageHtml = `
                <div class="chat-system-message">
                    <div class="system-message-content">${msg.content}</div>
                    <div class="system-message-time">${time}</div>
                </div>
            `;
            
            chatMessages.insertAdjacentHTML('beforeend', systemMessageHtml);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        if (message.command === 'addChatMessage') {
            handleTextChatMessage(message.message);
        }
    });



    // 初始化语音录制按钮和定时器显示
    voiceRecordBtn = document.getElementById('voice-record-btn');
    voiceRecordTimer = document.querySelector('.voice-record-timer');
    // 确保元素存在后再操作
    if (voiceRecordBtn && voiceRecordTimer) {
        // 初始化语音录制元素状态
        voiceRecordTimer.style.display = 'none';
        
        // 语音录制按钮事件监听
        voiceRecordBtn.addEventListener('click', () => {
            if (isRecording) {
                stopVoiceRecording();
            } else {
                startVoiceRecording();
            }
        });
    }

    // 开始录制语音消息
    async function startVoiceRecording() {
        try {
            isRecording = true;
            voiceRecordBtn.classList.add('recording');
            voiceRecordTimer.style.display = 'block';
            recordingStartTime = Date.now();
            
            // 更新计时器显示
            updateRecordingTimer();
            
            // 通过VSCode命令调用外部录音脚本
            vscode.postMessage({
                command: 'executeCommand',
                commandId: 'lingxixiezuo.recordAudio'
            });
            
        } catch (error) {
            console.error('启动录音失败:', error);
            isRecording = false;
            voiceRecordBtn.classList.remove('recording');
            voiceRecordTimer.style.display = 'none';
            if (recordingTimer) {
                clearInterval(recordingTimer);
                recordingTimer = null;
            }
        }
    }

    // 停止录制语音消息
    function stopVoiceRecording() {
        // 不需要实际停止录音，因为外部脚本会自动停止
        isRecording = false;
        
        // 停止计时器
        clearTimeout(recordingTimer);
        recordingTimer = null;
        
        // 更新UI
        voiceRecordBtn.classList.remove('recording');
        voiceRecordTimer.style.display = 'none';
    }

    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            // 通知主进程标签切换
            if (window.vscode) {
                window.vscode.postMessage({
                    command: 'switchTab',
                    tabId: tabId
                });
            }
        });
    });
    // 内部tab切换
    document.querySelectorAll('.inner-tab-button').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.innerTab;
            document.querySelectorAll('.inner-tab-button').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.inner-tab-pane').forEach(pane => pane.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });
    // 兼容 VSCode API
    window.vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;
    // AI提供商显示/隐藏状态
    document.getElementById('deepseek-settings').style.display = 'block';
    if (window.vscode) {
        window.vscode.postMessage({ command: 'getDeepSeekApiKeyStatus' });
        window.vscode.postMessage({ command: 'getMcpServerStatus' });
    }
    // 问号帮助弹窗
    const helpBtn = document.getElementById('agent-help-btn');
    const toolsModal = document.getElementById('tools-modal');
    const closeModal = document.querySelector('.tools-modal-close');
    if (helpBtn) helpBtn.addEventListener('click', () => { toolsModal.style.display = 'block'; });
    if (closeModal) closeModal.addEventListener('click', () => { toolsModal.style.display = 'none'; });
    window.addEventListener('click', function(event) {
        if (event.target === toolsModal) toolsModal.style.display = 'none';
    });
    const modalContent = document.querySelector('.tools-modal-content');
    if (modalContent) modalContent.addEventListener('click', e => e.stopPropagation());
    // 新建画布按钮
    document.getElementById('canvas-action-btn').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ command: 'createCanvas' });
        }
    });
    // 添加纪要按钮事件处理
    document.getElementById('add-memo-btn').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({
                command: 'addMemoToCanvas'
            });
        }
    });
    // 剪贴板历史相关
    // 画布列表相关
    let canvasListData = [];
    const canvasListEl = document.querySelector('.canvas-list');
    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('收到消息:', message);
        if (message.type === 'canvasList') {
            canvasListData = message.data || [];
            renderCanvasList(canvasListData);
        } else if (message.command === 'agentResponse') {
            // Agent响应
            if (message.thinkingId) {
                const thinkingElement = document.getElementById(message.thinkingId);
                if (thinkingElement) thinkingElement.remove();
            }
            const agentMessagesContainer = document.getElementById('agent-messages');
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            if (message.result) {
                const formattedContent = marked.parse(message.result);
                const assistantMessageHtml = `
                    <div class="agent-message agent-message-assistant">
                        <div class="agent-avatar">AI</div>
                        <div class="agent-message-bubble">
                            <div class="agent-message-content markdown-content">${formattedContent}</div>
                            <div class="agent-message-time">${time}</div>
                        </div>
                    </div>
                `;
                agentMessagesContainer.insertAdjacentHTML('beforeend', assistantMessageHtml);
                agentMessagesContainer.scrollTop = agentMessagesContainer.scrollHeight;
            }
        } else if (message.command === 'restoreState') {
            // 恢复状态
            const state = message.state;
            if (state.activeTab) {
                const tabButton = document.querySelector(`.tab-button[data-tab="${state.activeTab}"]`);
                if (tabButton) tabButton.click();
            }
            if (state.activeInnerTab) {
                const innerTabButton = document.querySelector(`.inner-tab-button[data-inner-tab="${state.activeInnerTab}"]`);
                if (innerTabButton) innerTabButton.click();
            }
            if (state.mcpServerStatus) {
                const statusElement = document.getElementById('mcp-server-status');
                if (statusElement) {
                    statusElement.textContent = state.mcpServerStatus;
                    const enableMcpServerSwitch = document.getElementById('enable-mcp-server');
                    if (enableMcpServerSwitch) enableMcpServerSwitch.checked = state.mcpServerStatus === '运行中';
                }
            }
            if (state.chatServerConnected) {
                document.getElementById('chat-server-status').textContent = '已连接';
                document.getElementById('chat-server-status').classList.remove('status-offline');
                document.getElementById('chat-server-status').classList.add('status-online');
                document.getElementById('start-chat-server').disabled = true;
                document.getElementById('stop-chat-server').disabled = false;
                document.getElementById('server-connection-info').style.display = 'block';
            }
        } else if (message.command === 'chatServerStatus') {
            const statusElement = document.getElementById('chat-server-status');
            if (statusElement) {
                if (message.status === 'connected') {
                    statusElement.textContent = '已连接';
                    statusElement.classList.remove('status-offline');
                    statusElement.classList.add('status-online');
                    if (window.vscode) {
                        window.vscode.postMessage({
                            command: 'saveViewState',
                            key: 'chatServerConnected',
                            value: true
                        });
                    }
                } else if (message.status === 'disconnected') {
                    statusElement.textContent = '离线';
                    statusElement.classList.remove('status-online');
                    statusElement.classList.add('status-offline');
                    if (window.vscode) {
                        window.vscode.postMessage({
                            command: 'saveViewState',
                            key: 'chatServerConnected',
                            value: false
                        });
                    }
                }
            }
        } else if (message.command === 'mcpServerStatus') {
            const statusElement = document.getElementById('mcp-server-status');
            if (statusElement) {
                statusElement.textContent = message.status;
                if (window.vscode) {
                    window.vscode.postMessage({
                        command: 'saveViewState',
                        key: 'mcpServerStatus',
                        value: message.status
                    });
                }
                const enableMcpServerSwitch = document.getElementById('enable-mcp-server');
                if (enableMcpServerSwitch) enableMcpServerSwitch.checked = message.status === '运行中';
            }
        }
        // 记录标签页切换以便保存到状态
        document.querySelectorAll('.inner-tab-button').forEach(btn => {
            btn.addEventListener('click', function() {
                const innerTabId = this.dataset.innerTab;
                if (window.vscode) {
                    window.vscode.postMessage({
                        command: 'switchInnerTab',
                        innerTabId: innerTabId
                    });
                }
            });
        });
    });
    function getTypeIcon(type) {
        switch(type) {
            case 'code': return '📝';
            case 'text': return '📄';
            case 'image': return '🖼️';
            default: return '❓';
        }
    }
    // 画布列表渲染
    function renderCanvasList(canvasList) {
        canvasListEl.innerHTML = '';
        if (!canvasList || canvasList.length === 0) {
            canvasListEl.innerHTML = '<div class="canvas-list-empty">暂无画布文件，点击"新建画布"创建</div>';
            return;
        }
        canvasList.forEach(item => {
            const div = document.createElement('div');
            div.className = 'canvas-item';
            div.title = item.fullPath || item.path;
            div.innerHTML = `
                <div class="canvas-item-icon">📊</div>
                <div class="canvas-item-content">
                    <div class="canvas-item-title">${item.name}</div>
                    <div class="canvas-item-path">${item.path}</div>
                </div>
            `;
            div.onclick = function() {
                if (window.vscode) {
                    window.vscode.postMessage({
                        command: 'openCanvas',
                        path: item.fullPath
                    });
                }
            };
            div.oncontextmenu = function(e) {
                e.preventDefault();
                if (window.vscode) {
                    window.vscode.postMessage({
                        command: 'showCanvasContextMenu',
                        path: item.fullPath,
                        name: item.name
                    });
                }
            };
            canvasListEl.appendChild(div);
        });
    }
    // 打开Canvas标签时请求画布列表
    document.querySelector('.tab-button[data-tab="canvas"]').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ type: 'getCanvasList' });
        }
    });
    // 初始加载时请求 API Key 状态
    if (vscode) {
        console.log('页面加载完成，请求API Key状态');
        // 请求智谱API Key状态
        vscode.postMessage({ command: 'getApiKeyStatus' });
        // 请求DeepSeek API Key状态
        vscode.postMessage({ command: 'getDeepSeekApiKeyStatus' });
    }
    // Agent工具项点击事件
    document.querySelectorAll('.agent-tool-item').forEach(item => {
        item.addEventListener('click', function() {
            const toolName = this.querySelector('.agent-tool-name').textContent;
            const agentInput = document.getElementById('agent-input');
            switch(toolName) {
                case '创建画布':
                    agentInput.value = '创建一个名为my_diagram的画布，使用流程图模板';
                    break;
                case '添加形状':
                    agentInput.value = '在my_diagram画布上添加一个矩形，位置坐标(100, 100)，颜色蓝色';
                    break;
                case '添加文本':
                    agentInput.value = '在my_diagram画布上添加文本"开始"，位置坐标(150, 150)';
                    break;
                case '查看画布':
                    agentInput.value = '获取my_diagram画布的详细信息';
                    break;
            }
            agentInput.focus();
        });
    });
    // Agent输入处理
    document.getElementById('agent-send').addEventListener('click', function() {
        const input = document.getElementById('agent-input');
        if (input.value.trim() && window.vscode) {
            const query = input.value.trim();
            const agentMessagesContainer = document.getElementById('agent-messages');
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            const userMessageHtml = `
                <div class="agent-message agent-message-user">
                    <div class="agent-avatar">我</div>
                    <div class="agent-message-bubble">
                        <div class="agent-message-content">${query}</div>
                        <div class="agent-message-time">${time}</div>
                    </div>
                </div>
            `;
            agentMessagesContainer.insertAdjacentHTML('beforeend', userMessageHtml);
            const thinkingId = 'thinking-' + Date.now();
            const thinkingHtml = `
                <div class="agent-thinking" id="${thinkingId}">
                    <span>AI助手思考中</span>
                    <div class="agent-thinking-dots">
                        <div class="agent-thinking-dot"></div>
                        <div class="agent-thinking-dot"></div>
                        <div class="agent-thinking-dot"></div>
                    </div>
                </div>
            `;
            agentMessagesContainer.insertAdjacentHTML('beforeend', thinkingHtml);
            agentMessagesContainer.scrollTop = agentMessagesContainer.scrollHeight;
            window.vscode.postMessage({
                command: 'agentQuery',
                query: query,
                thinkingId: thinkingId
            });
            input.value = '';
        }
    });
    // 聊天输入处理
    document.getElementById('chat-send').addEventListener('click', function() {
        const input = document.getElementById('chat-input');
        if (input.value.trim() && window.vscode) {
            const message = input.value.trim();
            const messagesContainer = document.querySelector('.chat-messages');
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            const userName = document.getElementById('user-name').value.trim() || '我';
            const userMessageHtml = `
                <div class="chat-row right">
                    <div class="chat-avatar-group">
                        <div class="avatar">我</div>
                        <div class="sender">${userName}</div>
                    </div>
                    <div class="chat-bubble-group">
                        <div class="chat-bubble right">${message}</div>
                        <div class="chat-time">${time}</div>
                    </div>
                </div>
            `;
            messagesContainer.insertAdjacentHTML('beforeend', userMessageHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            window.vscode.postMessage({
                command: 'sendChatMessage',
                message: message
            });
            input.value = '';
        }
    });
    // 聊天室服务器控制
    document.getElementById('start-chat-server').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ command: 'startChatServer' });
        }
    });
    document.getElementById('stop-chat-server').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ command: 'stopChatServer' });
        }
    });
    // 主机/从机模式切换
    document.getElementById('host-mode-btn').addEventListener('click', function() {
        document.getElementById('host-mode-btn').classList.add('active');
        document.getElementById('client-mode-btn').classList.remove('active');
        document.getElementById('host-mode-panel').style.display = 'flex';
        document.getElementById('client-mode-panel').style.display = 'none';
    });
    document.getElementById('client-mode-btn').addEventListener('click', function() {
        document.getElementById('client-mode-btn').classList.add('active');
        document.getElementById('host-mode-btn').classList.remove('active');
        document.getElementById('client-mode-panel').style.display = 'flex';
        document.getElementById('host-mode-panel').style.display = 'none';
    });
    // 从机模式连接/断开
    document.getElementById('connect-to-server').addEventListener('click', function() {
        const serverAddress = document.getElementById('server-address').value.trim();
        const serverPort = document.getElementById('server-port').value.trim();
        if (!serverAddress) {
            const statusElement = document.getElementById('chat-server-status');
            statusElement.textContent = '错误: 请输入服务器地址';
            statusElement.className = 'status-offline';
            return;
        }
        const port = parseInt(serverPort, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            const statusElement = document.getElementById('chat-server-status');
            statusElement.textContent = '错误: 请输入有效端口 (1-65535)';
            statusElement.className = 'status-offline';
            return;
        }
        if (window.vscode) {
            window.vscode.postMessage({ command: 'connectToChatServer', port: serverPort, ipAddress: serverAddress });
            document.getElementById('connect-to-server').disabled = true;
            document.getElementById('disconnect-from-server').disabled = false;
            const statusElement = document.getElementById('chat-server-status');
            statusElement.textContent = '正在连接...';
            statusElement.className = 'status-online';
        }
    });
    document.getElementById('disconnect-from-server').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ command: 'disconnectFromChatServer' });
            document.getElementById('connect-to-server').disabled = false;
            document.getElementById('disconnect-from-server').disabled = true;
            // 移除对room-control的引用
        }
    });
    // 移除leave-room按钮的事件监听器
    
    // 复制连接信息
    document.getElementById('copy-connection').addEventListener('click', function() {
        const connectionUrl = document.getElementById('server-connection-url').textContent;
        if (connectionUrl && connectionUrl !== '未连接') {
            window.vscode.postMessage({
                command: 'copyToClipboard',
                text: `灵犀协作聊天室连接信息: ${connectionUrl}`
            });
            const copyBtn = document.getElementById('copy-connection');
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '已复制!';
            setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
        }
    });
    // 设置用户名
    document.getElementById('set-username').addEventListener('click', function() {
        const userNameInput = document.getElementById('user-name');
        const userName = userNameInput.value.trim();
        if (userName && window.vscode) {
            window.vscode.postMessage({ command: 'setUserName', userName: userName });
            const userDisplayElements = document.querySelectorAll('.chat-row.right .sender');
            userDisplayElements.forEach(element => { element.textContent = userName; });
        }
    });
    // ASR测试按钮事件
    document.getElementById('run-asr-test').addEventListener('click', function() {
        if (window.vscode) {
            // 生成当前时间作为文件名的一部分
            const now = new Date();
            const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
            const outputFileName = `asr_result_${timestamp}.txt`;
            
            window.vscode.postMessage({
                command: 'runAsrTest',
                outputFile: outputFileName
            });
            
            // 显示正在运行的提示
            const messagesContainer = document.getElementById('chat-messages');
            const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const systemMessageHtml = `
                <div class="chat-row system">
                    <div class="system-message">
                        <div class="system-message-content">正在运行语音识别测试...<br>结果将保存到文件: ${outputFileName}</div>
                        <div class="chat-time">${time}</div>
                    </div>
                </div>
            `;
            
            messagesContainer.insertAdjacentHTML('beforeend', systemMessageHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });
    // 聊天输入框回车支持
    document.getElementById('chat-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('chat-send').click();
        }
    });
    // Agent输入框回车支持
    document.getElementById('agent-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                e.preventDefault();
                const start = this.selectionStart;
                const end = this.selectionEnd;
                this.value = this.value.substring(0, start) + '\n' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 1;
            } else {
                e.preventDefault();
                document.getElementById('agent-send').click();
            }
        }
    });
    // 添加预览按钮样式
    const style = document.createElement('style');
    style.textContent = `
        .preview-canvas-btn {
            background: #3794ff;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
            margin-left: 8px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }
        
        .preview-canvas-btn:hover {
            background: #2176c7;
        }
    `;
    document.head.appendChild(style);
    // 保存DeepSeek API Key
    document.getElementById('save-deepseek-api-key-btn').addEventListener('click', function() {
        const apiKey = document.getElementById('deepseek-api-key-input').value.trim();
        if (apiKey) {
            if (window.vscode) {
                window.vscode.postMessage({ command: 'saveDeepSeekApiKey', apiKey });
                // 显示正在保存状态
                document.getElementById('deepseek-api-key-status').textContent = '正在保存...';
                document.getElementById('deepseek-api-key-status').style.color = '#FFA500';
            }
        } else {
            document.getElementById('deepseek-api-key-status').textContent = '请输入有效的API Key';
            document.getElementById('deepseek-api-key-status').style.color = '#ff0000';
        }
    });
    // DeepSeek模型选择
    document.getElementById('deepseek-model-select').addEventListener('change', function() {
        const model = this.value;
        if (window.vscode) {
            window.vscode.postMessage({ command: 'setDeepSeekModel', model });
        }
    });
    // MCP服务器相关
    document.getElementById('enable-mcp-server').addEventListener('change', function() {
        const isEnabled = this.checked;
        const serverPath = 'server/server.js'; // 修正服务器路径
        if (window.vscode) {
            window.vscode.postMessage({ command: 'toggleMcpServer', isEnabled: isEnabled, serverPath: serverPath });
            const statusElement = document.getElementById('mcp-server-status');
            if (isEnabled) {
                statusElement.textContent = '正在启动...';
                statusElement.style.color = '#FFA500';
            } else {
                statusElement.textContent = '已停止';
                statusElement.style.color = '#aaa';
            }
        }
    });
    // 监听MCP服务器状态
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'mcpServerStatus') {
            const statusElement = document.getElementById('mcp-server-status');
            const toggleSwitch = document.getElementById('enable-mcp-server');
            statusElement.textContent = message.status;
            if (message.status === '运行中') {
                statusElement.style.color = '#4CAF50';
                toggleSwitch.checked = true;
            } else if (message.status === '已停止') {
                statusElement.style.color = '#aaa';
                toggleSwitch.checked = false;
            } else if (message.status === '启动失败') {
                statusElement.style.color = '#f44336';
                toggleSwitch.checked = false;
            }
        }
    });
    // 输入框高度自适应
    const textarea = document.getElementById('agent-input');
    if (textarea) {
        function adjustHeight() {
            const scrollTop = textarea.scrollTop;
            textarea.style.height = 'auto';
            const contentHeight = textarea.scrollHeight;
            if (contentHeight <= 150) {
                textarea.style.height = contentHeight + 'px';
                textarea.style.overflowY = 'hidden';
            } else {
                textarea.style.height = '150px';
                textarea.style.overflowY = 'auto';
            }
            textarea.scrollTop = scrollTop;
        }
        textarea.addEventListener('input', adjustHeight);
        textarea.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    this.value = this.value.substring(0, start) + '\n' + this.value.substring(end);
                    this.selectionStart = this.selectionEnd = start + 1;
                    setTimeout(adjustHeight, 0);
                } else {
                    e.preventDefault();
                    document.getElementById('agent-send').click();
                }
            }
        });
        setTimeout(adjustHeight, 0);
    }
    // ========== 侧边栏主逻辑迁移结束 ==========

    // 封装会议相关按钮事件绑定
    function bindMeetingButtons() {
        [
            'create-conference-btn',
            'join-conference-btn',
            'leave-conference-btn',
            'toggle-mic-btn',
            'confirm-join-btn',
            'cancel-join-btn'
        ].forEach(id => {
            const btn = document.getElementById(id);
            if (btn && !btn._meetingBind) {
                btn.addEventListener('click', handleMeetingClick);
                btn._meetingBind = true;
            }
        });
    }
    // 页面初次加载时绑定一次
    bindMeetingButtons();
    // 在tab切换到协作区时重新绑定
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            if (tabId === 'collab-area') {
                setTimeout(bindMeetingButtons, 0); // 等待DOM渲染后再绑定
            }
        });
    });

    // AI总结纪要按钮事件监听
    document.getElementById('ai-summary-memo-btn').addEventListener('click', function() {
        // 请求后端列出所有纪要文件
        if (window.vscode) {
            window.vscode.postMessage({ command: 'listMemoFiles' });
        }
    });
}); 


function updateServerStatus(statusData) {
    const statusElement = document.getElementById('chat-server-status');
    const startButton = document.getElementById('start-chat-server');
    const stopButton = document.getElementById('stop-chat-server');
    const connectButton = document.getElementById('connect-to-server');
    const disconnectButton = document.getElementById('disconnect-from-server');
    const connectionInfoDiv = document.getElementById('server-connection-info');
    const connectionUrlElement = document.getElementById('server-connection-url');
    // 移除对room-control相关元素的引用
    
if (statusData.status === 'running' || statusData.status === 'connected') {
    statusElement.textContent = statusData.status === 'connected' ? '已连接' : '运行中';
        statusElement.className = 'status-online';
        
        // 保存服务器地址到dataset，供音频流功能使用
        if (statusData.ipAddress) {
            statusElement.dataset.ipAddress = statusData.ipAddress;
            statusElement.dataset.port = statusData.port;
        }
        
        // 主机模式下的UI状态
    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.disabled = false;
        
        // 从机模式下的UI状态
    if (connectButton) connectButton.disabled = true;
    if (disconnectButton) disconnectButton.disabled = false;
        
        // 移除显示房间信息的代码
        
        // 显示连接信息
    if (statusData.port && connectionInfoDiv && connectionUrlElement) {
            connectionInfoDiv.style.display = 'flex';
        const ipAddress = statusData.ipAddress || 'localhost';
        connectionUrlElement.textContent = `ws://${ipAddress}:${statusData.port}`;
        }
        
        // 如果服务器运行中但客户端未连接，自动连接
    if (statusData.status === 'running' && statusData.port && window.vscode) {
            window.vscode.postMessage({
                command: 'connectToChatServer',
            port: statusData.port,
            ipAddress: statusData.ipAddress || 'localhost'
            });
        }
} else if (statusData.status === 'stopped' || statusData.status === 'disconnected') {
        statusElement.textContent = '离线';
        statusElement.className = 'status-offline';
        
        // 移除服务器地址信息
        delete statusElement.dataset.ipAddress;
        delete statusElement.dataset.port;
        
        // 主机模式下的UI状态
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
        
        // 从机模式下的UI状态
    if (connectButton) connectButton.disabled = false;
    if (disconnectButton) disconnectButton.disabled = true;
        
        // 移除隐藏房间控制界面的代码
        
        // 隐藏连接信息
    if (connectionInfoDiv) connectionInfoDiv.style.display = 'none';
    if (connectionUrlElement) connectionUrlElement.textContent = '未连接';
} else if (statusData.status === 'error') {
    statusElement.textContent = '错误: ' + (statusData.error || '未知错误');
        statusElement.className = 'status-offline';
        
        // 移除服务器地址信息
        delete statusElement.dataset.ipAddress;
        delete statusElement.dataset.port;
        
        // 主机模式下的UI状态
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
        
        // 从机模式下的UI状态
    if (connectButton) connectButton.disabled = false;
    if (disconnectButton) disconnectButton.disabled = true;
        
        // 移除隐藏房间控制界面的代码
        
        // 隐藏连接信息
    if (connectionInfoDiv) connectionInfoDiv.style.display = 'none';
    if (connectionUrlElement) connectionUrlElement.textContent = '未连接';
}
}

/**
 * 处理接收到的语音消息
 * @param {Object} message 聊天消息对象
 */
function handleAudioMessage(message) {
    const chatMessages = document.querySelector('.chat-messages');
    const isCurrentUser = (message.userId === currentUserId);
    
    // 创建消息容器，确保当前用户消息显示在右侧，其他用户消息显示在左侧
    const messageRow = document.createElement('div');
    messageRow.className = isCurrentUser ? 'chat-row right' : 'chat-row left';
    
    // 创建头像和发送者信息
    const avatarGroup = document.createElement('div');
    avatarGroup.className = 'chat-avatar-group';
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = isCurrentUser ? '我' : (message.sender && message.sender.name ? message.sender.name.charAt(0) : 'U');
    
    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = isCurrentUser ? '我' : (message.sender && message.sender.name ? message.sender.name : '用户');
    
    avatarGroup.appendChild(avatar);
    avatarGroup.appendChild(sender);
    
    // 创建消息气泡组
    const bubbleGroup = document.createElement('div');
    bubbleGroup.className = 'chat-bubble-group';
    
    // 创建语音消息气泡
    const bubble = document.createElement('div');
    bubble.className = isCurrentUser ? 'chat-bubble right' : 'chat-bubble left';
    
    // 创建语音消息内容
    const voiceMessage = document.createElement('div');
    voiceMessage.className = 'voice-message';
    
    // 保存原始音频数据
    if (message.audioData) {
        voiceMessage.dataset.audio = message.audioData;
    }
    
    // 如果消息中包含文件名，保存到映射中并设置到元素
    if (message.audioFilename) {
        console.log('收到语音消息包含文件名:', message.audioFilename);
        voiceMessage.dataset.filename = message.audioFilename;
        
        // 使用消息中的ID，或者根据文件名生成一个唯一ID
        let messageId = message.id;
        
        // 如果消息没有ID但有文件名，则从文件名生成ID
        if (!messageId && message.audioFilename.includes('_')) {
            // 从文件名中提取唯一部分 (格式为 recording_YYYY-MM-DDThh-mm-ss-mmmZ_uniqueId.wav)
            const parts = message.audioFilename.split('_');
            if (parts.length >= 3) {
                const uniquePart = parts.slice(2).join('_').replace('.wav', '');
                messageId = `audio_${uniquePart}`;
            } else {
                messageId = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            }
        }
        
        // 确保audioFileMap存在
        if (!window.audioFileMap) {
            window.audioFileMap = {};
        }
        
        // 存储映射关系
        audioFileMap[messageId] = message.audioFilename;
        console.log(`保存语音文件映射: ${messageId} => ${message.audioFilename}`);
        
        // 将消息ID保存到元素中，便于后续检索
        voiceMessage.dataset.messageId = messageId;
    } else if (isCurrentUser && window.lastRecordedAudioFilename && window.lastRecordedMessageId) {
        // 对于自己发送的消息，如果没有文件名但有最后录制的文件名，则使用它
        const messageId = window.lastRecordedMessageId;
        
        // 确保audioFileMap存在
        if (!window.audioFileMap) {
            window.audioFileMap = {};
        }
        
        // 存储映射关系
        audioFileMap[messageId] = window.lastRecordedAudioFilename;
        console.log(`使用lastRecordedAudioFilename保存映射: ${messageId} => ${window.lastRecordedAudioFilename}`);
        
        // 记录到元素属性
        voiceMessage.dataset.filename = window.lastRecordedAudioFilename;
        voiceMessage.dataset.messageId = messageId;
        
        // 清除临时变量，避免影响下一条消息
        window.lastRecordedAudioFilename = null;
        window.lastRecordedMessageId = null;
    }
    
    const voiceIcon = document.createElement('div');
    voiceIcon.className = 'voice-message-icon';
    voiceIcon.textContent = '🔊';
    
    const voiceLine = document.createElement('div');
    voiceLine.className = 'voice-message-line';
    
    const voiceDuration = document.createElement('div');
    voiceDuration.className = 'voice-message-duration';
    voiceDuration.textContent = formatDuration(message.duration || 0);
    
    voiceMessage.appendChild(voiceIcon);
    voiceMessage.appendChild(voiceLine);
    voiceMessage.appendChild(voiceDuration);
    
    // 添加点击播放功能
    voiceMessage.addEventListener('click', function(event) {
        handleVoiceMessageClick(event, message);
    });
    
    bubble.appendChild(voiceMessage);
    
    // 创建时间戳
    const timeElement = document.createElement('div');
    timeElement.className = 'chat-time';
    timeElement.textContent = formatTime(message.timestamp);
    
    bubbleGroup.appendChild(bubble);
    bubbleGroup.appendChild(timeElement);
    
    messageRow.appendChild(avatarGroup);
    messageRow.appendChild(bubbleGroup);
    
    chatMessages.appendChild(messageRow);
    
    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 处理语音消息点击事件
function handleVoiceMessageClick(event, message) {
    event.stopPropagation();
    console.log('语音消息点击事件，收到消息:', message);
    // 播放前确保AudioContext在用户手势下resume
    if (globalAudioContext && globalAudioContext.state === 'suspended') {
        globalAudioContext.resume().then(() => {
            console.log('[AudioContext] 已在用户点击下resume');
        });
    }
    
    // 停止当前正在播放的音频
    if (currentlyPlayingAudio) {
        currentlyPlayingAudio.pause();
        currentlyPlayingAudio.currentTime = 0;
        
        // 重置所有语音消息图标和动画
        document.querySelectorAll('.voice-message.playing').forEach(el => {
            el.classList.remove('playing');
            const icon = el.querySelector('.voice-message-icon');
            if (icon) icon.textContent = '🔊';
        });
    }
    
    // 获取当前点击的语音消息元素
    const voiceMessage = event.currentTarget;
    
    // 如果已经是播放状态，则停止播放
    if (voiceMessage.classList.contains('playing')) {
        voiceMessage.classList.remove('playing');
        const icon = voiceMessage.querySelector('.voice-message-icon');
        if (icon) icon.textContent = '🔊';
        return;
    }
    
    // 标记正在播放
    voiceMessage.classList.add('playing');
    const icon = voiceMessage.querySelector('.voice-message-icon');
    if (icon) icon.textContent = '⏸️';
    
    // 检查消息对象中的音频数据
    if (message && message.audioData) {
        console.log('使用消息对象中的音频数据播放');
        playAudio(message.audioData, message.mimeType);
        return;
    }
    
    // 检查元素数据集中的音频数据
    if (voiceMessage.dataset && voiceMessage.dataset.audio) {
        console.log('使用元素数据集中的音频数据播放');
        playAudio(voiceMessage.dataset.audio, voiceMessage.dataset.mimeType);
        return;
    }
    
    console.log('未找到音频数据，无法播放');
    voiceMessage.classList.remove('playing');
    if (icon) icon.textContent = '🔊';
    
    if (vscode) {
        vscode.postMessage({
            command: 'showError',
            text: '播放失败：未找到语音数据'
        });
    }
}

// 格式化语音消息时长
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 格式化时间显示
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// 播放音频
function playAudio(base64AudioData, providedMimeType = null) {
    try {
        // 使用提供的MIME类型或尝试确定音频格式
        let mimeType = providedMimeType || 'audio/wav'; // 默认格式
        
        // 如果没有提供MIME类型，尝试从数据中推断
        if (!providedMimeType) {
            if (base64AudioData.startsWith('/9j/')) {
                mimeType = 'audio/mp3'; // 可能是MP3格式
            } else if (base64AudioData.startsWith('UklGR')) {
                mimeType = 'audio/wav'; // 可能是WAV格式
            } else if (base64AudioData.startsWith('SUQz')) {
                mimeType = 'audio/mpeg'; // 可能是MP3格式
            }
        }
        
        console.log('尝试播放音频，MIME类型:', mimeType);
        
        // 直接使用data URL创建音频元素
        const audio = new Audio();
        audio.src = `data:${mimeType};base64,${base64AudioData}`;
        
        // 停止当前正在播放的音频
        if (currentlyPlayingAudio) {
            currentlyPlayingAudio.pause();
            currentlyPlayingAudio.currentTime = 0;
        }
        
        // 添加错误处理
        audio.onerror = function(e) {
            console.error('音频播放错误:', e);
            const errorCode = e.target.error ? e.target.error.code : '未知';
            const errorMessage = e.target.error ? 
                `错误代码: ${errorCode}` : 
                '未知错误';
            
            console.log('详细错误信息:', {
                code: errorCode,
                message: e.target.error?.message || '无详细信息',
                dataLength: base64AudioData ? base64AudioData.length : 0
            });
            
            if (vscode) {
                vscode.postMessage({
                    command: 'showError',
                    text: `播放音频失败: ${errorMessage}`
                });
            }
            
            // 重置UI
            document.querySelectorAll('.voice-message.playing').forEach(el => {
                el.classList.remove('playing');
                const icon = el.querySelector('.voice-message-icon');
                if (icon) icon.textContent = '🔊';
            });
            
            currentlyPlayingAudio = null;
        };
        
        // 添加播放结束处理
        audio.onended = function() {
            // 重置UI
            document.querySelectorAll('.voice-message.playing').forEach(el => {
                el.classList.remove('playing');
                const icon = el.querySelector('.voice-message-icon');
                if (icon) icon.textContent = '🔊';
            });
            
            currentlyPlayingAudio = null;
        };
        
        // 播放音频
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.error('播放音频失败:', e);
                
                if (vscode) {
                    vscode.postMessage({
                        command: 'showError',
                        text: '播放音频失败: ' + (e.message || '未知错误')
                    });
                }
                
                // 重置UI
                document.querySelectorAll('.voice-message.playing').forEach(el => {
                    el.classList.remove('playing');
                    const icon = el.querySelector('.voice-message-icon');
                    if (icon) icon.textContent = '🔊';
                });
            });
        }
        
        currentlyPlayingAudio = audio;
    } catch (e) {
        console.error('处理音频数据时出错:', e);
        
        if (vscode) {
            vscode.postMessage({
                command: 'showError',
                text: '播放音频失败: ' + (e.message || '无法处理音频数据')
            });
        }
        
        // 重置UI
        document.querySelectorAll('.voice-message.playing').forEach(el => {
            el.classList.remove('playing');
            const icon = el.querySelector('.voice-message-icon');
            if (icon) icon.textContent = '🔊';
        });
    }
}

// 会议点击事件处理函数
function handleMeetingClick(event) {
    const target = event.target;
    
    // 检查目标元素是否是会议相关按钮
    if (!isConferenceButton(target.id)) {
        return;
    }

    // 使用switch语句处理不同按钮的点击事件
    switch(target.id) {
        case 'create-conference-btn':
            handleCreateConference();
            break;
        case 'join-conference-btn':
            handleJoinConference();
            break;
        case 'confirm-join-btn':
            handleConfirmJoin();
            break;
        case 'cancel-join-btn':
            handleCancelJoin();
            break;
        case 'leave-conference-btn':
            handleLeaveConference();
            break;
        case 'toggle-mic-btn':
            handleToggleMicrophone();
            break;
    }
}

// 检查是否是会议相关按钮
function isConferenceButton(id) {
    const conferenceButtonIds = [
        'create-conference-btn',
        'join-conference-btn',
        'confirm-join-btn',
        'cancel-join-btn',
        'leave-conference-btn',
        'toggle-mic-btn'
    ];
    return conferenceButtonIds.includes(id);
}

// 创建会议处理函数
function handleCreateConference() {

    if (isInConference) {
        showErrorMessage('您已经在会议中');
        return;
    }
    
    // 生成唯一会议ID
    const conferenceId = `conference_${Date.now()}`;
    createConference(conferenceId);
}

// 加入会议处理函数
function handleJoinConference() {
    if (isInConference) {
        showErrorMessage('您已经在会议中');
        return;
    }
    
    // 显示加入会议表单
    const joinForm = document.querySelector('.conference-join-form');
    const conferenceIdInput = document.getElementById('conference-id-input');
    if (joinForm && conferenceIdInput) {
        joinForm.style.display = 'flex';
        conferenceIdInput.focus();
    }
}

// 确认加入会议处理函数
function handleConfirmJoin() {
    const conferenceIdInput = document.getElementById('conference-id-input');
    const joinForm = document.querySelector('.conference-join-form');
    
    if (!conferenceIdInput || !joinForm) {
        console.error('找不到会议加入表单元素');
        return;
    }

    const conferenceId = conferenceIdInput.value.trim();
    if (!conferenceId) {
        showErrorMessage('请输入会议ID');
        return;
    }
    
    joinConference(conferenceId);
    joinForm.style.display = 'none';
    conferenceIdInput.value = '';
}

// 取消加入会议处理函数
function handleCancelJoin() {
    const joinForm = document.querySelector('.conference-join-form');
    const conferenceIdInput = document.getElementById('conference-id-input');
    
    if (joinForm && conferenceIdInput) {
        joinForm.style.display = 'none';
        conferenceIdInput.value = '';
    }
}

// 离开会议处理函数
function handleLeaveConference() {
    if (!isInConference) {
        return;
    }
    
    leaveConference();
}

// 切换麦克风处理函数
function handleToggleMicrophone() {
    if (!isInConference) {
        return;
    }
    
    toggleMicrophone();
}

// 创建语音会议
function createConference(conferenceId) {
    if (!vscode) {
        showErrorMessage('无法访问VSCode API');
        return;
    }
    
    if (!isConnectedToServer()) {
        showErrorMessage('您尚未连接到聊天服务器');
        return;
    }
    
    // 发送创建会议请求
    vscode.postMessage({
        command: 'sendWebSocketMessage',
        message: JSON.stringify({
            type: 'voiceConference',
            action: 'create',
            conferenceId: conferenceId
        })
    });
    
    // 更新UI状态
    updateConferenceUI(true, conferenceId);
    
    // 开始音频流传输
    startAudioStream(conferenceId);
}

// 加入语音会议
function joinConference(conferenceId) {
    if (!vscode) {
        showErrorMessage('无法访问VSCode API');
        return;
    }
    
    if (!isConnectedToServer()) {
        showErrorMessage('您尚未连接到聊天服务器');
        return;
    }
    
    // 先初始化回声消除功能
    setupAudioWithEchoCancellation()
        .then(() => {
            console.log('[会议] 回声消除初始化成功，正在加入会议...');
            
            // 发送加入会议请求
            vscode.postMessage({
                command: 'sendWebSocketMessage',
                message: JSON.stringify({
                    type: 'voiceConference',
                    action: 'join',
                    conferenceId: conferenceId
                })
            });
            
            // 更新UI状态
            updateConferenceUI(true, conferenceId);
            
            // 开始音频流传输
            startAudioStream(conferenceId);
        })
        .catch(error => {
            console.error('[会议] 回声消除初始化失败:', error);
            
            // 即使回声消除初始化失败，仍然尝试加入会议
            vscode.postMessage({
                command: 'sendWebSocketMessage',
                message: JSON.stringify({
                    type: 'voiceConference',
                    action: 'join',
                    conferenceId: conferenceId
                })
            });
            
            // 更新UI状态
            updateConferenceUI(true, conferenceId);
            
            // 开始音频流传输，但可能会有回声
            startAudioStream(conferenceId);
            
            // 显示回声消除初始化失败的提示
            showWarningMessage('回声消除功能初始化失败，可能会有回声');
        });
}

// 离开语音会议
function leaveConference() {
    if (!vscode) {
        showErrorMessage('无法访问VSCode API');
        return;
    }
    
    if (!isInConference) {
        showErrorMessage('您当前未在任何会议中');
        return;
    }
    
    // 停止音频流传输
    stopAudioStream();
    
    // 发送离开会议请求
    vscode.postMessage({
        command: 'sendWebSocketMessage',
        message: JSON.stringify({
            type: 'voiceConference',
            action: 'leave',
            conferenceId: currentConference
        })
    });
    
    // 停止所有正在播放的音频
    stopAllAudioPlayback();
    
    // 更新UI状态
    updateConferenceUI(false);
}

// 停止所有正在播放的音频
function stopAllAudioPlayback() {
    console.log('[调试-停止] 正在停止所有音频播放');
    
    // 停止所有的Web Audio源
    if (audioSourceNodes && audioSourceNodes.size > 0) {
        console.log(`[调试-停止] 停止 ${audioSourceNodes.size} 个Web Audio源`);
        for (const [key, node] of audioSourceNodes.entries()) {
            try {
                if (node.source) {
                    node.source.stop();
                    console.log(`[调试-停止] 已停止音频源: ${key}`);
                }
            } catch (error) {
                console.log(`[调试-停止] 停止音频源错误 (可能已经停止): ${key}`, error);
            }
        }
        audioSourceNodes.clear();
    }
    
    // 停止所有的Audio元素
    if (window.audioElements && window.audioElements.size > 0) {
        console.log(`[调试-停止] 停止 ${window.audioElements.size} 个Audio元素`);
        for (const [key, audio] of window.audioElements.entries()) {
            try {
                audio.pause();
                audio.currentTime = 0;
                console.log(`[调试-停止] 已暂停音频元素: ${key}`);
            } catch (error) {
                console.log(`[调试-停止] 暂停音频元素错误: ${key}`, error);
            }
        }
        window.audioElements.clear();
    }
    
    // 如果有全局AudioContext，先暂停它（不要关闭，以便后续复用）
    if (globalAudioContext) {
        try {
            if (globalAudioContext.state === 'running') {
                console.log('[调试-停止] 暂停全局AudioContext');
                globalAudioContext.suspend().then(() => {
                    console.log('[调试-停止] 全局AudioContext已暂停');
                });
            }
        } catch (error) {
            console.error('[调试-停止] 暂停AudioContext错误:', error);
        }
    }
}

// 切换麦克风状态
function toggleMicrophone() {
    if (!isInConference) {
        showErrorMessage('您必须先加入会议才能使用麦克风');
        return;
    }
    
    // 切换静音状态
    isMuted = !isMuted;
    
    if (isMuted) {
        // 停止音频流
        stopAudioStream();
        
        console.log('[麦克风] 麦克风已静音');
        
        // 通知其他参与者此用户已静音
        vscode.postMessage({
            command: 'sendWebSocketMessage',
            message: JSON.stringify({
                type: 'voiceConference',
                action: 'mute',
                conferenceId: currentConference,
                muted: true
            })
        });
    } else {
        console.log('[麦克风] 麦克风已取消静音');
        
        // 确保全局音频上下文是活跃的
        if (globalAudioContext && globalAudioContext.state === 'suspended') {
            globalAudioContext.resume().then(() => {
                console.log('[麦克风] 全局AudioContext已恢复');
            });
        }
        
        // 启动音频流
        startAudioStream(currentConference);
        
        // 通知其他参与者此用户已取消静音
        vscode.postMessage({
            command: 'sendWebSocketMessage',
            message: JSON.stringify({
                type: 'voiceConference',
                action: 'mute',
                conferenceId: currentConference,
                muted: false
            })
        });
    }
    
    // 更新UI
    updateMicrophoneUI();
}

// 开始音频流传输
function startAudioStream(conferenceId) {
    if (!conferenceId || isMuted) {
        return;
    }
    
    // 获取当前连接的服务器地址
    let serverAddress = 'localhost'; // 默认值
    
    // 尝试从服务器状态中获取IP地址
    const serverStatus = document.getElementById('chat-server-status');
    if (serverStatus && serverStatus.dataset.ipAddress) {
        serverAddress = serverStatus.dataset.ipAddress;
        console.log(`[音频流] 使用当前连接的服务器地址: ${serverAddress}`);
    } else {
        console.warn('[音频流] 无法获取当前连接的服务器地址，使用默认值localhost');
    }

    // 检查回声消除是否已初始化
    if (window.echoCancellationStream && window.echoCancellationNodes) {
        console.log('[音频流] 回声消除已初始化，直接启动音频流');
        
        // 通过VSCode命令调用外部录音脚本，开启流模式
        vscode.postMessage({
            command: 'executeStreamCommand',
            script: 'chatroom/recordAudio.js',
            args: ['-stream', '-address', serverAddress, '-conferenceId', conferenceId]
        });
    } else {
        // 先设置音频约束，启用回声消除
        setupAudioWithEchoCancellation()
            .then(() => {
                // 通过VSCode命令调用外部录音脚本，开启流模式
                vscode.postMessage({
                    command: 'executeStreamCommand',
                    script: 'chatroom/recordAudio.js',
                    args: ['-stream', '-address', serverAddress, '-conferenceId', conferenceId]
                });
            })
            .catch(error => {
                console.error('[音频流] 设置回声消除失败:', error);
                // 出错时也尝试启动音频流，但可能会有回声
                vscode.postMessage({
                    command: 'executeStreamCommand',
                    script: 'chatroom/recordAudio.js',
                    args: ['-stream', '-address', serverAddress, '-conferenceId', conferenceId]
                });
            });
    }
}

// 设置带回声消除的音频处理
async function setupAudioWithEchoCancellation() {
    try {
        console.log('[音频] 正在设置回声消除...');
        
        // 创建或使用全局AudioContext
        if (!globalAudioContext) {
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // 请求麦克风访问权限，并明确启用回声消除
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,       // 启用回声消除
                noiseSuppression: true,       // 启用噪声抑制
                autoGainControl: true,        // 启用自动增益控制
                channelCount: 1,              // 单声道
                sampleRate: 44100,            // 采样率
            }
        });
        
        console.log('[音频] 成功获取麦克风，已启用回声消除');
        
        // 创建媒体流源节点
        const micSource = globalAudioContext.createMediaStreamSource(stream);
        
        // 创建处理节点
        const processorNode = globalAudioContext.createScriptProcessor(4096, 1, 1);
        
        // 连接节点，但不直接连接到destination以避免重复播放
        micSource.connect(processorNode);
        
        // 保存流和节点以便后续使用或清理
        window.echoCancellationStream = stream;
        window.echoCancellationNodes = {
            source: micSource,
            processor: processorNode
        };
        
        console.log('[音频] 回声消除设置完成');
        return true;
    } catch (error) {
        console.error('[音频] 设置回声消除失败:', error);
        throw error;
    }
}

// 清理回声消除相关资源
function cleanupEchoCancellation() {
    try {
        if (window.echoCancellationNodes) {
            // 断开节点连接
            if (window.echoCancellationNodes.processor) {
                window.echoCancellationNodes.processor.disconnect();
            }
            if (window.echoCancellationNodes.source) {
                window.echoCancellationNodes.source.disconnect();
            }
            
            // 清除节点引用
            window.echoCancellationNodes = null;
        }
        
        // 停止所有音频轨道
        if (window.echoCancellationStream) {
            window.echoCancellationStream.getTracks().forEach(track => {
                track.stop();
            });
            window.echoCancellationStream = null;
        }
        
        console.log('[音频] 回声消除资源已清理');
    } catch (error) {
        console.error('[音频] 清理回声消除资源失败:', error);
    }
}

// 停止音频流传输
function stopAudioStream() {
    // 清理回声消除资源
    cleanupEchoCancellation();
    
    // 通知扩展终止音频流进程
    vscode.postMessage({
        command: 'terminateStreamProcess'
    });
}

// 更新会议UI状态
function updateConferenceUI(isActive, conferenceId = null) {
    const createBtn = document.getElementById('create-conference-btn');
    const joinBtn = document.getElementById('join-conference-btn');
    const leaveBtn = document.getElementById('leave-conference-btn');
    const conferenceStatus = document.querySelector('.voice-conference-status');
    const activeConferenceInfo = document.querySelector('.active-conference-info');
    const currentConferenceIdSpan = document.getElementById('current-conference-id');
    
    isInConference = isActive;
    currentConference = conferenceId;
    
    if (isActive && conferenceId) {
        // 更新为活跃状态
        createBtn.disabled = true;
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
        
        conferenceStatus.textContent = '已连接';
        conferenceStatus.style.color = '#4CAF50';
        
        activeConferenceInfo.style.display = 'block';
        currentConferenceIdSpan.textContent = conferenceId;
        
        // 重置麦克风状态
        isMuted = false;
        updateMicrophoneUI();
        
        // 移除清空参与者列表的代码
        // document.getElementById('participants-list').innerHTML = '';
    } else {
        // 更新为非活跃状态
        createBtn.disabled = false;
        joinBtn.disabled = false;
        leaveBtn.disabled = true;
        
        conferenceStatus.textContent = '未连接';
        conferenceStatus.style.color = '#aaa';
        
        activeConferenceInfo.style.display = 'none';
        currentConferenceIdSpan.textContent = '';
        
        // 移除清空参与者列表的代码
        // document.getElementById('participants-list').innerHTML = '';
        conferenceParticipants = [];
    }
}

// 更新麦克风UI状态
function updateMicrophoneUI() {
    const toggleMicBtn = document.getElementById('toggle-mic-btn');
    const micStatus = document.querySelector('.mic-status');
    
    if (isMuted) {
        toggleMicBtn.textContent = '取消静音';
        toggleMicBtn.classList.add('muted');
        if (micStatus) micStatus.textContent = '已静音';
    } else {
        toggleMicBtn.textContent = '静音';
        toggleMicBtn.classList.remove('muted');
        if (micStatus) micStatus.textContent = '已启用' + (echoCancellationEnabled ? ' (回声消除已开启)' : '');
    }
}

// 检查是否连接到聊天服务器
function isConnectedToServer() {
    const serverStatus = document.getElementById('chat-server-status');
    return serverStatus && serverStatus.classList.contains('status-online');
}

// 显示错误消息
function showErrorMessage(message) {
    if (vscode) {
        vscode.postMessage({
            command: 'showError',
            text: message
        });
    } else {
        console.error(message);
    }
}

// 处理来自服务器的会议消息
function handleConferenceMessage(message) {
    switch (message.action) {
        case 'created':
        case 'joined':
            // 成功创建或加入会议
            updateConferenceUI(true, message.conferenceId);
            
            // 移除更新参与者列表的代码
            // if (message.participants) {
            //     updateParticipantsList(message.participants);
            // }
            break;
            
        case 'left':
            // 成功离开会议
            updateConferenceUI(false);
            break;
            
        case 'participantJoined':
        case 'participantLeft':
        case 'participantMuted':
            // 移除更新参与者列表的代码
            // if (message.participants) {
            //     updateParticipantsList(message.participants);
            // }
            break;
            
        case 'error':
            // 会议操作错误
            showErrorMessage(`会议操作失败: ${message.message}`);
            break;
    }
}

// 播放音频流
function playAudioStream(message) {
    try {
        console.log('[调试-播放] 收到音频流数据详情:', {
            senderId: message.senderId,
            senderName: message.senderName,
            currentUserId: currentUserId, // 输出当前用户ID以便对比
            sequenceNumber: message.sequence,
            dataLength: message.audioData ? message.audioData.length : 0,
            conferenceId: message.conferenceId,
            ID相同: message.senderId === currentUserId
        });
        
        // 如果发送者是自己，不需要播放
        if (message.senderId && currentUserId && message.senderId === currentUserId) {
            console.log('[调试-播放] 跳过自己发送的音频');
            return;
        } else {
            console.log('[调试-播放] 准备播放来自其他用户的音频');
        }
        
        if (!message.audioData || typeof message.audioData !== 'string') {
            console.error('[调试-播放] 无效的音频数据', message);
            return;
        }
        
        // 检查音频数据是否为有效的Base64
        try {
            // 尝试解码前几个字符以验证Base64有效性
            const testSample = message.audioData.substring(0, 10); 
            atob(testSample);
            console.log('[调试-播放] Base64验证成功');
        } catch (e) {
            console.error('[调试-播放] 无效的Base64编码:', e);
            return;
        }
        
        // 预先检查音频数据的大小
        const decodedSize = Math.ceil(message.audioData.length * 0.75); // Base64解码后大约是原大小的3/4
        console.log('[调试-播放] 预计解码后数据大小约为:', decodedSize, '字节');
        
        // 使用全局AudioContext，如果不存在则创建一个
        if (!globalAudioContext) {
            console.log('[调试-播放] 创建全局AudioContext');
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else {
            console.log('[调试-播放] 使用现有的AudioContext');
            // 如果AudioContext被暂停，则恢复它
            if (globalAudioContext.state === 'suspended') {
                globalAudioContext.resume();
            }
        }
        
        // 转换Base64为二进制数据
        const binaryString = atob(message.audioData);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        console.log('[调试-播放] 已解码二进制数据，大小:', bytes.length, '字节');
        
        // 尝试识别WAV格式并添加正确的WAV头
        const hasRiffHeader = bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70; // "RIFF"
        
        // 如果缺少WAV头部，添加一个标准的WAV头部
        let audioBuffer;
        
        if (!hasRiffHeader) {
            console.log('[调试-播放] 数据缺少RIFF头，尝试添加WAV头部');
            
            // 创建带WAV头的新数组
            const sampleRate = 44100; // 假设采样率
            const numChannels = 1;    // 单声道
            const bitsPerSample = 16; // 16位深度
            
            // WAV头大小为44字节
            const headerBytes = new Uint8Array(44);
            
            // RIFF头
            headerBytes.set([82, 73, 70, 70]); // "RIFF"
            
            // 文件大小 (未知，暂设为0)
            const fileSize = bytes.length + 36; // 文件大小减去8字节
            headerBytes[4] = (fileSize & 0xff);
            headerBytes[5] = ((fileSize >> 8) & 0xff);
            headerBytes[6] = ((fileSize >> 16) & 0xff);
            headerBytes[7] = ((fileSize >> 24) & 0xff);
            
            // WAVE标记
            headerBytes.set([87, 65, 86, 69], 8); // "WAVE"
            
            // fmt 子区块
            headerBytes.set([102, 109, 116, 32], 12); // "fmt "
            
            // 子区块1大小
            headerBytes[16] = 16; // 16字节
            headerBytes[17] = 0;
            headerBytes[18] = 0;
            headerBytes[19] = 0;
            
            // 音频格式 (1为PCM)
            headerBytes[20] = 1;
            headerBytes[21] = 0;
            
            // 声道数
            headerBytes[22] = numChannels;
            headerBytes[23] = 0;
            
            // 采样率
            headerBytes[24] = (sampleRate & 0xff);
            headerBytes[25] = ((sampleRate >> 8) & 0xff);
            headerBytes[26] = ((sampleRate >> 16) & 0xff);
            headerBytes[27] = ((sampleRate >> 24) & 0xff);
            
            // 字节率 = 采样率 * 声道数 * 每样本字节数
            const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
            headerBytes[28] = (byteRate & 0xff);
            headerBytes[29] = ((byteRate >> 8) & 0xff);
            headerBytes[30] = ((byteRate >> 16) & 0xff);
            headerBytes[31] = ((byteRate >> 24) & 0xff);
            
            // 每帧字节数 = 声道数 * 每样本字节数
            const blockAlign = numChannels * (bitsPerSample / 8);
            headerBytes[32] = (blockAlign & 0xff);
            headerBytes[33] = ((blockAlign >> 8) & 0xff);
            
            // 每样本位数
            headerBytes[34] = (bitsPerSample & 0xff);
            headerBytes[35] = ((bitsPerSample >> 8) & 0xff);
            
            // data子区块
            headerBytes.set([100, 97, 116, 97], 36); // "data"
            
            // 数据大小
            const dataSize = bytes.length;
            headerBytes[40] = (dataSize & 0xff);
            headerBytes[41] = ((dataSize >> 8) & 0xff);
            headerBytes[42] = ((dataSize >> 16) & 0xff);
            headerBytes[43] = ((dataSize >> 24) & 0xff);
            
            // 合并头部和数据
            const wavBytes = new Uint8Array(headerBytes.length + bytes.length);
            wavBytes.set(headerBytes);
            wavBytes.set(bytes, headerBytes.length);
            
            audioBuffer = wavBytes.buffer;
        } else {
            // 已经有WAV头部
            console.log('[调试-播放] 数据包含有效的RIFF头');
            audioBuffer = bytes.buffer;
        }
        
        // 解码音频数据
        globalAudioContext.decodeAudioData(
            audioBuffer,
            function(buffer) {
                console.log('[调试-播放] 音频解码成功, 样本率:', buffer.sampleRate);
                
                const senderId = message.senderId || 'unknown';
                
                // 创建音频源
                const source = globalAudioContext.createBufferSource();
                source.buffer = buffer;
                
                // 增加音量节点
                const gainNode = globalAudioContext.createGain();
                gainNode.gain.value = 3.0; // 增加音量到300%，使音频更容易听到
                
                // 连接节点
                source.connect(gainNode);
                gainNode.connect(globalAudioContext.destination);
                
                // 播放音频
                console.log('[调试-播放] 使用Web Audio API开始播放音频');
                source.start(0);
                
                // 保存音频源节点，以便后续可能的管理操作
                audioSourceNodes.set(senderId + '_' + message.sequence, {
                    source: source,
                    gainNode: gainNode,
                    startTime: Date.now()
                });
                
                // 播放完成时从Map中移除
                source.onended = function() {
                    console.log('[调试-播放] 音频片段播放完成');
                    audioSourceNodes.delete(senderId + '_' + message.sequence);
                };
                
                // 清理10秒前的音频节点，防止内存泄漏
                const currentTime = Date.now();
                for (const [key, node] of audioSourceNodes.entries()) {
                    if (currentTime - node.startTime > 10000) {
                        try {
                            // 尝试停止可能仍在播放的节点
                            node.source.stop();
                        } catch (e) {
                            // 节点可能已经停止，忽略错误
                        }
                        audioSourceNodes.delete(key);
                    }
                }
            },
            function(e) {
                console.error('[调试-播放] 音频解码失败:', e);
            }
        );
    } catch (error) {
        console.error('[调试-播放] 处理音频流出错:', error);
    }
}

// 使用所有可能的方法尝试播放
function fallbackToAllMethods(audioData) {
    try {
        console.log('[调试-备用] 尝试所有可能的播放方法...');
        
        // 1. 先尝试直接使用Audio元素播放
        fallbackToDirectPlay(audioData);
        
        // 2. 如果直接播放失败，尝试Web Audio API
        setTimeout(() => {
            try {
                playWithWebAudio(audioData);
            } catch (webAudioError) {
                console.error('[调试-备用] Web Audio方法失败:', webAudioError);
                
                // 3. 如果Web Audio API失败，尝试多种格式
                setTimeout(() => {
                    playAudioWithMultipleFormats(audioData);
                }, 500);
            }
        }, 500);
    } catch (error) {
        console.error('[调试-备用] 所有备用方法调用失败:', error);
    }
}

// 使用直接播放方法
function fallbackToDirectPlay(audioData) {
    console.log('[调试-直接播放] 使用Audio元素播放');
    
    // 使用全局变量存储Audio元素，确保不会被GC回收
    if (!window.audioElements) {
        window.audioElements = new Map();
    }
    
    const audioId = Date.now().toString();
    const audio = new Audio(`data:audio/wav;base64,${audioData}`);
    audio.volume = 1.0; // 确保音量最大
    
    // 存储到全局Map中
    window.audioElements.set(audioId, audio);
    
    audio.oncanplaythrough = () => {
        console.log('[调试-直接播放] 音频加载完成，准备播放');
        audio.play()
            .then(() => console.log('[调试-直接播放] 播放开始'))
            .catch(e => console.error('[调试-直接播放] 播放失败:', e));
    };
    
    audio.onended = () => {
        console.log('[调试-直接播放] 播放完成，移除音频元素');
        window.audioElements.delete(audioId);
    };
    
    audio.onerror = (e) => {
        console.error('[调试-直接播放] 加载失败:', e);
        window.audioElements.delete(audioId);
    };
    
    // 防止内存泄漏，20秒后自动清理
    setTimeout(() => {
        if (window.audioElements.has(audioId)) {
            console.log('[调试-直接播放] 超时清理未完成的音频元素');
            window.audioElements.delete(audioId);
        }
    }, 20000);
}

// 使用Web Audio API播放
function playWithWebAudio(base64AudioData) {
    try {
        console.log('[调试-WebAudio] 尝试使用Web Audio API播放...');
        // 将Base64音频数据转换回二进制
        console.log('[调试-WebAudio] 开始解码Base64数据');
        const binaryString = atob(base64AudioData);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // 分析数据的前几个字节以检查WAV头
        if (len > 44) {
            const header = Array.from(bytes.slice(0, 44)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            console.log('[调试-WebAudio] WAV头部数据:', header);
            // 检查RIFF和WAVE标记
            const hasRiffHeader = bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70; // "RIFF"
            const hasWaveFormat = bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69; // "WAVE"
            console.log('[调试-WebAudio] 数据头部检查:', {
                包含RIFF标记: hasRiffHeader,
                包含WAVE标记: hasWaveFormat
            });
        }
        
        // 使用全局AudioContext，如果不存在则创建
        if (!globalAudioContext) {
            console.log('[调试-WebAudio] 创建全局AudioContext');
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else {
            console.log('[调试-WebAudio] 使用现有的AudioContext');
            // 如果AudioContext被暂停，则恢复它
            if (globalAudioContext.state === 'suspended') {
                globalAudioContext.resume();
            }
        }
        
        console.log('[调试-WebAudio] 音频数据长度:', len, '字节');
        console.log('[调试-WebAudio] 音频上下文状态:', globalAudioContext.state);
        
        // 检查浏览器音频支持情况
        console.log('[调试-WebAudio] 浏览器音频支持情况:', {
            AudioContext: !!window.AudioContext,
            webkitAudioContext: !!window.webkitAudioContext,
            Audio元素: !!window.Audio,
            支持的音频类型: {
                WAV: new Audio().canPlayType('audio/wav'),
                MP3: new Audio().canPlayType('audio/mpeg'),
                OGG: new Audio().canPlayType('audio/ogg')
            }
        });
        
        // 解码音频数据
        console.log('[调试-WebAudio] 开始解码音频数据');
        globalAudioContext.decodeAudioData(
            bytes.buffer,
            function(buffer) {
                console.log('[调试-WebAudio] 音频解码成功, 样本率:', buffer.sampleRate);
                console.log('[调试-WebAudio] 音频通道数:', buffer.numberOfChannels);
                console.log('[调试-WebAudio] 音频长度:', buffer.duration, '秒');
                
                // 生成唯一ID
                const audioId = 'backup_' + Date.now();
                
                // 创建音频源
                const source = globalAudioContext.createBufferSource();
                source.buffer = buffer;
                
                // 增加音量节点
                const gainNode = globalAudioContext.createGain();
                gainNode.gain.value = 1.5; // 增加音量到150%
                
                // 连接节点
                source.connect(gainNode);
                gainNode.connect(globalAudioContext.destination);
                
                // 保存到全局变量
                audioSourceNodes.set(audioId, {
                    source: source,
                    gainNode: gainNode,
                    startTime: Date.now()
                });
                
                // 播放音频
                console.log('[调试-WebAudio] 开始播放音频');
                source.start(0);
                console.log('[调试-WebAudio] 音频播放命令已发送');
                
                // 播放完成事件
                source.onended = function() {
                    console.log('[调试-WebAudio] 音频播放完成');
                    audioSourceNodes.delete(audioId);
                };
                
                // 超时安全措施：20秒后清理，防止内存泄漏
                setTimeout(() => {
                    if (audioSourceNodes.has(audioId)) {
                        console.log('[调试-WebAudio] 超时清理未完成的音频节点');
                        try {
                            audioSourceNodes.get(audioId).source.stop();
                        } catch (e) {
                            // 可能已经结束，忽略错误
                        }
                        audioSourceNodes.delete(audioId);
                    }
                }, 20000);
            },
            function(error) {
                console.error('[调试-WebAudio] 解码音频数据失败:', error);
                console.log('[调试-WebAudio] 尝试使用多种格式播放');
                playAudioWithMultipleFormats(base64AudioData);
            }
        );
    } catch (error) {
        console.error('[调试-WebAudio] Web Audio API播放失败:', error);
        console.log('[调试-WebAudio] 尝试使用多种格式播放');
        playAudioWithMultipleFormats(base64AudioData);
    }
}

// 尝试多种格式播放
function playAudioWithMultipleFormats(base64AudioData) {
    console.log('[调试-多格式] 尝试使用多种格式播放...');
    
    // 确保全局音频元素存储存在
    if (!window.audioElements) {
        window.audioElements = new Map();
    }
    
    // 尝试不同的MIME类型
    const mimeTypes = [
        'audio/wav',
        'audio/mpeg',
        'audio/mp3',
        'audio/ogg',
        'audio/webm',
        'audio/aac',
        'audio/x-wav', // 一些浏览器使用这个
        'audio/pcm'    // 另一种可能的格式
    ];
    
    let failures = 0;
    let playedAny = false;
    
    // 尝试每种格式
    mimeTypes.forEach((mimeType, index) => {
        setTimeout(() => {
            try {
                console.log(`[调试-多格式] 尝试使用 ${mimeType} 格式播放...`);
                const audioId = `format_${mimeType}_${Date.now()}_${index}`;
                const audio = new Audio(`data:${mimeType};base64,${base64AudioData}`);
                
                // 存储到全局Map中
                window.audioElements.set(audioId, audio);
                
                // 添加加载事件监听
                audio.addEventListener('loadstart', () => {
                    console.log(`[调试-多格式] ${mimeType} 开始加载`);
                });
                
                audio.oncanplaythrough = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式可以播放`);
                    audio.play().catch(e => console.error(`[调试-多格式] ${mimeType} 播放失败:`, e));
                };
                
                audio.onplay = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式开始播放`);
                    playedAny = true;
                };
                
                audio.onended = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式播放完成`);
                    window.audioElements.delete(audioId);
                };
                
                audio.onerror = (e) => {
                    console.log(`[调试-多格式] ${mimeType} 格式播放失败:`, e.target.error);
                    window.audioElements.delete(audioId);
                    failures++;
                    
                    // 如果所有格式都失败
                    if (failures === mimeTypes.length && !playedAny) {
                        console.error('[调试-多格式] 所有音频格式都播放失败');
                        
                        // 最后的尝试：直接播放PCM数据
                        try {
                            console.log('[调试-多格式] 尝试使用原始PCM数据播放');
                            // 使用全局AudioContext，如果不存在则创建
                            if (!globalAudioContext) {
                                globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                            } else if (globalAudioContext.state === 'suspended') {
                                globalAudioContext.resume();
                            }
                            
                            const rawPcmData = atob(base64AudioData);
                            const pcmBuffer = new ArrayBuffer(rawPcmData.length);
                            const view = new Uint8Array(pcmBuffer);
                            for (let i = 0; i < rawPcmData.length; i++) {
                                view[i] = rawPcmData.charCodeAt(i);
                            }
                            
                            const buffer = globalAudioContext.createBuffer(1, pcmBuffer.byteLength / 2, 44100);
                            const channel = buffer.getChannelData(0);
                            
                            // 复制PCM数据到通道中
                            const dataView = new DataView(pcmBuffer);
                            for (let i = 0; i < channel.length; i++) {
                                channel[i] = dataView.getInt16(i * 2, true) / 32768.0;
                            }
                            
                            const pcmId = 'pcm_' + Date.now();
                            const source = globalAudioContext.createBufferSource();
                            source.buffer = buffer;
                            source.connect(globalAudioContext.destination);
                            
                            // 保存到全局变量
                            audioSourceNodes.set(pcmId, {
                                source: source,
                                startTime: Date.now()
                            });
                            
                            source.start(0);
                            console.log('[调试-多格式] 原始PCM数据播放已启动');
                            
                            // 播放完成时清理
                            source.onended = function() {
                                console.log('[调试-多格式] PCM音频播放完成');
                                audioSourceNodes.delete(pcmId);
                            };
                            
                            // 超时安全清理
                            setTimeout(() => {
                                if (audioSourceNodes.has(pcmId)) {
                                    console.log('[调试-多格式] PCM超时清理');
                                    try {
                                        audioSourceNodes.get(pcmId).source.stop();
                                    } catch (e) {
                                        // 忽略错误
                                    }
                                    audioSourceNodes.delete(pcmId);
                                }
                            }, 20000);
                        } catch (pcmError) {
                            console.error('[调试-多格式] 原始PCM播放尝试失败:', pcmError);
                            vscode.postMessage({
                                command: 'showError',
                                text: '无法播放音频：所有格式均不兼容'
                            });
                        }
                    }
                };
                
                // 安全清理：20秒后移除音频元素，防止内存泄漏
                setTimeout(() => {
                    if (window.audioElements.has(audioId)) {
                        console.log(`[调试-多格式] ${mimeType} 超时清理`);
                        window.audioElements.delete(audioId);
                    }
                }, 20000);
            } catch (e) {
                console.error(`[调试-多格式] ${mimeType} 格式初始化失败:`, e);
                failures++;
            }
        }, index * 100); // 每种格式间隔100ms尝试，避免浏览器过载
    });
} 

function updateRecordingTimer() {
    if (!isRecording) return;
    
    const elapsedTime = Date.now() - recordingStartTime;
    const seconds = Math.floor(elapsedTime / 1000);
    const minutes = Math.floor(seconds / 60);
    
    const formattedTime = 
        `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    
    voiceRecordTimer.textContent = formattedTime;
    
    // 如果录制时间超过1分钟，自动停止
    if (seconds >= 60) {
        stopVoiceRecording();
        return;
    }
    
    // 每100毫秒更新一次计时器
    recordingTimer = setTimeout(updateRecordingTimer, 100);
}

/**
 * 渲染文字聊天消息到页面
 * @param {Object} message 聊天消息对象
 */
function handleTextChatMessage(message) {
    const chatMessages = document.querySelector('.chat-messages');
    const isCurrentUser = message.userId === currentUserId;
    // 创建消息容器
    const messageRow = document.createElement('div');
    messageRow.className = isCurrentUser ? 'chat-row right' : 'chat-row left';
    // 创建头像和发送者信息
    const avatarGroup = document.createElement('div');
    avatarGroup.className = 'chat-avatar-group';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = isCurrentUser ? '我' : (message.sender && message.sender.name ? message.sender.name.charAt(0) : 'U');
    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = isCurrentUser ? '我' : (message.sender && message.sender.name ? message.sender.name : '用户');
    avatarGroup.appendChild(avatar);
    avatarGroup.appendChild(sender);
    // 创建消息气泡组
    const bubbleGroup = document.createElement('div');
    bubbleGroup.className = 'chat-bubble-group';
    // 创建文字消息气泡
    const bubble = document.createElement('div');
    bubble.className = isCurrentUser ? 'chat-bubble right' : 'chat-bubble left';
    bubble.textContent = message.content;
    // 创建时间戳
    const timeElement = document.createElement('div');
    timeElement.className = 'chat-time';
    timeElement.textContent = formatTime(message.timestamp);
    bubbleGroup.appendChild(bubble);
    bubbleGroup.appendChild(timeElement);
    messageRow.appendChild(avatarGroup);
    messageRow.appendChild(bubbleGroup);
    chatMessages.appendChild(messageRow);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示警告消息
function showWarningMessage(message) {
    const msgContainer = document.querySelector('.message-container');
    if (!msgContainer) return;
    
    const msgElement = document.createElement('div');
    msgElement.className = 'message warning';
    msgElement.textContent = message;
    
    msgContainer.appendChild(msgElement);
    
    // 自动清除消息
    setTimeout(() => {
        msgElement.classList.add('fade-out');
        setTimeout(() => {
            if (msgElement.parentNode === msgContainer) {
                msgContainer.removeChild(msgElement);
            }
        }, 500);
    }, 5000);
}

// 当收到来自VSCode的消息
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'agentResponse':
            console.log('收到Agent响应');
            handleAgentResponse(message);
            break;
        case 'agentThinking':
            console.log('Agent正在思考...');
            updateAgentThinking(message.isThinking, message.thinkingId);
            break;
        case 'toolCallStarted':
            console.log('工具调用开始:', message.toolName);
            displayToolCallStarted(message.toolName, message.toolArgs, message.thinkingId);
            break;
        case 'toolCallCompleted':
            console.log('工具调用完成:', message.toolName, message.success);
            displayToolCallCompleted(message.toolName, message.success, message.result, message.thinkingId);
            break;
        case 'chatServerStatus':
            console.log('聊天服务器状态更新:', message.status);
            updateChatServerStatus(message.status, message.info);
            break;
        // ... existing message handlers ...
    }
});

/**
 * 显示工具调用开始的UI提示
 * @param {string} toolName 工具名称
 * @param {object} toolArgs 工具参数
 * @param {string} thinkingId 思考ID，用于链接到特定的思考状态
 */
function displayToolCallStarted(toolName, toolArgs, thinkingId) {
    // 获取消息容器
    const messagesContainer = document.getElementById('agent-messages');
    if (!messagesContainer) return;
    
    // 查找或创建当前思考状态的容器
    let thinkingElement = document.getElementById(`agent-thinking-${thinkingId}`);
    
    // 如果没有找到思考元素，则创建一个
    if (!thinkingElement) {
        thinkingElement = document.createElement('div');
        thinkingElement.id = `agent-thinking-${thinkingId}`;
        thinkingElement.className = 'agent-thinking';
        thinkingElement.innerHTML = '思考中...';
        messagesContainer.appendChild(thinkingElement);
    }
    
    // 创建工具调用元素
    const toolCallElement = document.createElement('div');
    toolCallElement.id = `tool-call-${toolName}-${Date.now()}`;
    toolCallElement.className = 'agent-tool-call';
    
    // 格式化参数以便更好地显示
    let formattedArgs = '';
    try {
        formattedArgs = JSON.stringify(toolArgs, null, 2);
    } catch (e) {
        formattedArgs = '参数解析错误';
    }
    
    // 设置工具调用元素的内容
    toolCallElement.innerHTML = `
        <div class="tool-call-header">
            <span class="tool-call-icon">🔧</span>
            <span class="tool-call-name">正在调用: ${toolName}</span>
            <span class="tool-call-status pending">处理中...</span>
        </div>
        <div class="tool-call-args">
            <pre>${formattedArgs}</pre>
        </div>
    `;
    
    // 将工具调用元素添加到思考元素之后
    thinkingElement.appendChild(toolCallElement);
    
    // 滚动到底部
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * 更新工具调用完成的UI状态
 * @param {string} toolName 工具名称
 * @param {boolean} success 是否成功
 * @param {string} result 调用结果
 * @param {string} thinkingId 思考ID
 */
function displayToolCallCompleted(toolName, success, result, thinkingId) {
    // 查找所有工具调用元素
    const toolCallElements = document.querySelectorAll('.agent-tool-call');
    
    // 找到最后一个匹配的工具调用元素
    let lastMatchingElement = null;
    for (const element of toolCallElements) {
        if (element.querySelector('.tool-call-name').textContent.includes(toolName)) {
            lastMatchingElement = element;
        }
    }
    
    if (lastMatchingElement) {
        // 更新状态
        const statusElement = lastMatchingElement.querySelector('.tool-call-status');
        if (statusElement) {
            statusElement.textContent = success ? '✓ 成功' : '✗ 失败';
            statusElement.className = `tool-call-status ${success ? 'success' : 'error'}`;
        }
        
        // 如果有结果，则显示结果
        if (result) {
            const resultElement = document.createElement('div');
            resultElement.className = 'tool-call-result';
            resultElement.innerHTML = `<pre>${result}</pre>`;
            lastMatchingElement.appendChild(resultElement);
        }
    }
    
    // 获取消息容器并滚动到底部
    const messagesContainer = document.getElementById('agent-messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}