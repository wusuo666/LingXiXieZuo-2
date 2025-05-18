// 初始加载时请求 API Key 状态
document.addEventListener('DOMContentLoaded', function() {
    if (vscode) {
        console.log('页面加载完成，请求API Key状态');
        // 请求智谱API Key状态
        vscode.postMessage({ command: 'getApiKeyStatus' });
        // 请求DeepSeek API Key状态
        vscode.postMessage({ command: 'getDeepSeekApiKeyStatus' });
    }
});

// 监听来自扩展的消息，更新 API Key 状态显示
window.addEventListener('message', event => {
    const message = event.data;
    console.log('收到消息:', message);
    
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
    } else if (message.command === 'deepseekApiKeyStatus') {
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
    // ... 其他消息处理保持不变
});

/**
 * 侧边栏主逻辑初始化
 * 包含tab切换、AI、剪贴板、画布、MCP、聊天室等所有功能
 */
document.addEventListener('DOMContentLoaded', function() {
    // ========== 侧边栏主逻辑迁移自 sidebar.html <script> ========== //
    // tab页切换
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
            // 如果切换到 history 标签，主动请求最新历史记录
            if (tabId === 'history' && window.vscode) {
                window.vscode.postMessage({ type: 'getClipboardHistory' });
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
    // 剪贴板历史相关
    let historyData = [];
    // 画布列表相关
    let canvasListData = [];
    const canvasListEl = document.querySelector('.canvas-list');
    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('收到消息:', message);
        if (message.type === 'clipboardHistory') {
            historyData = message.data || [];
            renderHistoryList(historyData);
        } else if (message.type === 'canvasList') {
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
    // 剪贴板历史渲染
    const listEl = document.getElementById('clip-history-list');
    const previewEl = document.getElementById('clip-preview');
    const previewContentEl = previewEl.querySelector('.preview-content');
    const previewPlaceholderEl = previewEl.querySelector('.preview-placeholder');
    function getTypeIcon(type) {
        switch(type) {
            case 'code': return '📝';
            case 'text': return '📄';
            case 'image': return '🖼️';
            default: return '❓';
        }
    }
    function renderHistoryList(history) {
        listEl.innerHTML = '';
        if (!history || history.length === 0) {
            listEl.innerHTML = '<div class="empty-history">暂无历史记录</div>';
            previewContentEl.textContent = '';
            previewContentEl.classList.remove('active');
            previewPlaceholderEl.style.display = 'block';
            return;
        }
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'clip-history-item';
            div.title = item.content;
            div.innerHTML = `
                <span class="clip-type">${getTypeIcon(item.type)}</span>
                <span class="clip-content">${item.content.length > 30 ? item.content.slice(0, 30) + '...' : item.content}</span>
                <span class="clip-time">${item.time || ''}</span>
            `;
            div.onclick = function() {
                document.querySelectorAll('.clip-history-item').forEach(i => i.classList.remove('selected'));
                div.classList.add('selected');
                previewContentEl.textContent = item.content;
                previewContentEl.classList.add('active');
                previewPlaceholderEl.style.display = 'none';
            };
            listEl.appendChild(div);
        });
    }
    // 页面加载后请求剪贴板历史数据
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getClipboardHistory' });
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
            window.vscode.postMessage({
                command: 'connectToChatServer',
                ipAddress: serverAddress,
                port: port
            });
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
            document.getElementById('room-control').style.display = 'none';
        }
    });
    document.getElementById('leave-room').addEventListener('click', function() {
        if (window.vscode) {
            window.vscode.postMessage({ command: 'leaveRoom' });
            document.getElementById('room-control').style.display = 'none';
        }
    });
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
    // 预览按钮样式
    const style = document.createElement('style');
    style.textContent = `
        .preview-canvas-btn { background: #3794ff; color: white; border: none; border-radius: 4px; padding: 4px 8px; margin-left: 8px; cursor: pointer; font-size: 12px; transition: background 0.2s; }
        .preview-canvas-btn:hover { background: #2176c7; }
    `;
    document.head.appendChild(style);
    // 保存DeepSeek API Key
    document.getElementById('save-deepseek-api-key-btn').addEventListener('click', function() {
        const apiKey = document.getElementById('deepseek-api-key-input').value.trim();
        if (apiKey) {
            window.vscode.postMessage({ command: 'saveDeepSeekApiKey', apiKey });
        } else {
            document.getElementById('deepseek-api-key-status').textContent = '请输入有效的API Key';
            document.getElementById('deepseek-api-key-status').style.color = '#ff0000';
        }
    });
    // DeepSeek模型选择
    document.getElementById('deepseek-model-select').addEventListener('change', function() {
        const model = this.value;
        window.vscode.postMessage({ command: 'setDeepSeekModel', model });
    });
    // MCP服务器相关
    document.getElementById('enable-mcp-server').addEventListener('change', function() {
        const isEnabled = this.checked;
        const serverPath = 'server.js';
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
}); 