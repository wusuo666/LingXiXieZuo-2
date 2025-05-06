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
/**
 * 从插件的剪贴板历史记录中读取内容
 * @param {'node'|'text'|'line'|'code'|'image'|'freeText'} context - 操作上下文
 * @returns {Promise<any>} 剪贴板内容
 * @throws {Error} 如果历史记录中没有找到匹配的内容
 */
async function readFromClipboard(context) {
    try {
        // 查找历史记录中与上下文类型匹配的最新条目
        const latestItem = clipboardHistory.find(item => item.type === context);

        if (latestItem) {
            // 如果找到匹配的历史记录，返回其内容
            return latestItem.content;
        } else {
            // 如果历史记录中没有找到匹配的内容，抛出错误
            throw new Error(`剪贴板历史记录中没有找到类型为 '${context}' 的内容`);
        }
    } catch (error) {
        // 记录错误并向用户显示更友好的消息
        console.error('从剪贴板历史记录读取失败:', error);
        // 不再显示通用错误，让调用者处理特定错误
        // vscode.window.showErrorMessage(`读取失败: ${error.message}`); 
        throw error; // 重新抛出错误，以便调用者可以捕获它
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

/**
 * 根据上下文过滤剪贴板历史记录
 * @param {'node'|'text'|'line'|'code'|'image'|'freeText'|undefined} context - 当前操作上下文，undefined 表示无特定上下文
 * @param {Array} history - 剪贴板历史记录列表
 * @returns {Array} 过滤后的 ClipboardItem 数组
 */
function filterClipboardHistoryByContext(context, history) {
    try {
        if (!Array.isArray(history)) {
            throw new Error('历史记录必须是一个数组');
        }

        // 如果没有提供上下文，或者上下文是 'freeText' 或 'text'，则返回所有文本类内容
        if (!context || context === 'freeText' || context === 'text') {
            return history.filter(item => ['text', 'code', 'freeText'].includes(item.type));
        }

        // 如果上下文是 'code'，允许粘贴 'code' 和 'text' 类型
        if (context === 'code') {
            return history.filter(item => ['code', 'text', 'freeText'].includes(item.type));
        }

        // 对于 'node', 'line', 'image' 等特定类型，只返回完全匹配的类型
        return history.filter(item => item.type === context);

    } catch (error) {
        console.error('过滤剪贴板历史记录失败:', error);
        // 在实际应用中，可能不需要向用户显示错误消息，只需记录日志
        // vscode.window.showErrorMessage(`过滤历史记录失败: ${error.message}`);
        return []; // 返回空数组表示过滤失败或无匹配项
    }
}

// 导出模块
module.exports = {
    copyToClipboard,
    readFromClipboard,
    getClipboardHistory,
    clearClipboardHistory,
    updateConfig,
    filterClipboardHistoryByContext
}; 

// --- 示例调用 ---
/*
async function exampleUsage() {
    // 示例：复制文本
    await handleCopyShortcut('这是一段示例文本', 'text');
    console.log('文本已复制');

    // 示例：复制节点数据
    const nodeData = { id: 'node1', label: '示例节点' };
    await handleCopyShortcut(nodeData, 'node', { source: 'myApp' });
    console.log('节点数据已复制');

    // 示例：获取历史记录并过滤
    const fullHistory = getClipboardHistory();
    console.log('完整历史记录:', fullHistory);
    const textHistory = filterClipboardHistoryByContext('text', fullHistory);
    console.log('文本历史记录:', textHistory);
    const nodeHistory = filterClipboardHistoryByContext('node', fullHistory);
    console.log('节点历史记录:', nodeHistory);

    // 示例：粘贴文本
    console.log('尝试粘贴文本...');
    const pastedText = await handlePasteShortcut('text');
    if (pastedText !== undefined) {
        console.log('粘贴的文本:', pastedText);
    }

    // 示例：粘贴节点数据
    console.log('尝试粘贴节点数据...');
    const pastedNode = await handlePasteShortcut('node');
    if (pastedNode !== undefined) {
        console.log('粘贴的节点数据:', pastedNode);
    }

    // 示例：清空历史记录
    // clearClipboardHistory();
    // console.log('历史记录已清空');
}

// 调用示例函数 (仅用于演示，实际扩展中不需要)
// exampleUsage();
*/