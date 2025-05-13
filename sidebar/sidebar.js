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