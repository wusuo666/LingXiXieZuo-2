const vscode = require('vscode');
const { v4: uuidv4 } = require('uuid');

// 剪贴板历史记录
let clipboardHistory = [];

// 默认配置
const defaultConfig = {
    maxHistory: 20,
    enableCloudSync: false
};

/**
 * 将内容复制到剪贴板并保存到历史记录
 * @param {string|object} content - 待复制的内容
 * @param {'text'|'code'|'image'|'node'|'line'|'freeText'} type - 内容类型
 * @param {object} [metadata={}] - 附加元数据
 * @returns {Promise<void>}
 */
async function copyToClipboard(content, type, metadata = {}) {
    try {
        // 创建新的剪贴板条目
        const newItem = {
            id: uuidv4(),
            type,
            content,
            timestamp: Date.now(),
            metadata
        };

        // 更新历史记录
        clipboardHistory.unshift(newItem);

        // 限制历史记录数量
        if (clipboardHistory.length > defaultConfig.maxHistory) {
            clipboardHistory = clipboardHistory.slice(0, defaultConfig.maxHistory);
        }

        // 根据类型处理内容
        let clipboardContent;
        switch (type) {
            case 'text':
            case 'code':
            case 'freeText':
                clipboardContent = typeof content === 'string' ? content : JSON.stringify(content);
                await vscode.env.clipboard.writeText(clipboardContent);
                break;
            case 'image':
                // Base64图片数据直接写入
                await vscode.env.clipboard.writeText(content);
                break;
            case 'node':
            case 'line':
                // 结构化数据转换为JSON字符串
                clipboardContent = JSON.stringify(content);
                await vscode.env.clipboard.writeText(clipboardContent);
                break;
            default:
                throw new Error(`不支持的内容类型: ${type}`);
        }

        // 如果启用了云同步，这里可以添加同步逻辑
        if (defaultConfig.enableCloudSync) {
            // TODO: 实现云同步逻辑
        }

    } catch (error) {
        console.error('复制到剪贴板失败:', error);
        vscode.window.showErrorMessage(`复制失败: ${error.message}`);
        throw error;
    }
}

/**
 * 从剪贴板读取内容
 * @param {'node'|'text'|'line'|'code'|'image'|'freeText'} context - 操作上下文
 * @returns {Promise<any>} 剪贴板内容
 */
async function readFromClipboard(context) {
    try {
        // 获取剪贴板文本内容
        const clipboardText = await vscode.env.clipboard.readText();

        // 尝试解析最近的历史记录
        const latestItem = clipboardHistory[0];

        if (latestItem && latestItem.type === context) {
            // 如果最近的历史记录类型匹配，直接返回对应内容
            return latestItem.content;
        }

        // 根据上下文处理内容
        switch (context) {
            case 'text':
            case 'freeText':
                return clipboardText;
            case 'code':
                // 对于代码，保留格式返回
                return clipboardText;
            case 'node':
            case 'line':
                // 尝试解析JSON数据
                try {
                    return JSON.parse(clipboardText);
                } catch {
                    throw new Error('剪贴板内容不是有效的结构化数据');
                }
            case 'image':
                // 验证是否为Base64图片数据
                if (clipboardText.startsWith('data:image')) {
                    return clipboardText;
                }
                throw new Error('剪贴板内容不是有效的图片数据');
            default:
                throw new Error(`不支持的上下文类型: ${context}`);
        }
    } catch (error) {
        console.error('从剪贴板读取失败:', error);
        vscode.window.showErrorMessage(`读取失败: ${error.message}`);
        throw error;
    }
}

/**
 * 获取剪贴板历史记录
 * @returns {Array} 历史记录数组
 */
function getClipboardHistory() {
    return [...clipboardHistory];
}

/**
 * 清空剪贴板历史记录
 */
function clearClipboardHistory() {
    clipboardHistory = [];
}

/**
 * 更新剪贴板配置
 * @param {object} newConfig - 新的配置对象
 */
function updateConfig(newConfig) {
    Object.assign(defaultConfig, newConfig);
}

// 导出模块
module.exports = {
    copyToClipboard,
    readFromClipboard,
    getClipboardHistory,
    clearClipboardHistory,
    updateConfig
}; 