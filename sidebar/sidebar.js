// 初始加载时请求 API Key 状态
if (vscode) {
    vscode.postMessage({ command: 'getApiKeyStatus' });
}

// 保存 API Key 按钮事件
document.getElementById('save-api-key-btn').addEventListener('click', function() {
    const apiKeyInput = document.getElementById('api-key-input');
    const apiKey = apiKeyInput.value.trim();
    
    if (apiKey && vscode) {
        vscode.postMessage({
            command: 'updateApiKey',
            apiKey: apiKey
        });
        // 保存后清空输入框（可选）
        apiKeyInput.value = ''; 
        // 可以加一个提示，比如 "API Key已保存"
    }
});

// 监听来自扩展的消息，更新 API Key 状态显示
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'apiKeyStatus') {
        const statusElement = document.getElementById('api-key-status');
        if (message.isSet) {
            statusElement.textContent = '已设置';
            statusElement.style.color = '#4CAF50'; // 绿色表示已设置
        } else {
            statusElement.textContent = '未设置';
            statusElement.style.color = '#aaa'; // 默认灰色
        }
    }
    // ... 其他消息处理保持不变
}); 