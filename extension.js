const vscode = require('vscode');
const { v4: uuidv4 } = require('uuid');

// 剪贴板历史记录
let clipboardHistory = [];

// 最大历史记录数量
const MAX_HISTORY_SIZE = 50;

/**
 * 添加内容到剪贴板历史
 * @param {string} content 内容
 * @param {string} type 类型 ('text' | 'code')
 */
function addToHistory(content, type) {
    const entry = {
        id: uuidv4(),
        content,
        type,
        timestamp: new Date().toISOString()
    };
    
    clipboardHistory.unshift(entry);
    
    // 保持历史记录在最大数量以内
    if (clipboardHistory.length > MAX_HISTORY_SIZE) {
        clipboardHistory = clipboardHistory.slice(0, MAX_HISTORY_SIZE);
    }
}

/**
 * 激活插件时的回调函数
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('灵犀协作插件已激活');
    
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
                await vscode.env.clipboard.writeText(text);
                addToHistory(text, 'text');
                vscode.window.showInformationMessage('文本已复制到剪贴板');
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
                await vscode.env.clipboard.writeText(code);
                addToHistory(code, 'code');
                vscode.window.showInformationMessage('代码已复制到剪贴板');
            }
        }
    });

    // 注册读取剪贴板命令
    console.log('注册命令: lingxixiezuo.testRead');
    let readClipboardDisposable = vscode.commands.registerCommand('lingxixiezuo.testRead', async () => {
        const text = await vscode.env.clipboard.readText();
        vscode.window.showInformationMessage(`剪贴板内容: ${text}`);
    });

    // 注册显示历史记录命令
    console.log('注册命令: lingxixiezuo.showHistory');
    let showHistoryDisposable = vscode.commands.registerCommand('lingxixiezuo.showHistory', async () => {
        if (clipboardHistory.length === 0) {
            vscode.window.showInformationMessage('剪贴板历史记录为空');
            return;
        }

        const items = clipboardHistory.map(entry => ({
            label: `${entry.type === 'code' ? '📝 代码' : '📄 文本'} - ${new Date(entry.timestamp).toLocaleString()}`,
            description: entry.content.length > 50 ? entry.content.substring(0, 50) + '...' : entry.content,
            entry
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要复制的历史记录'
        });

        if (selected) {
            await vscode.env.clipboard.writeText(selected.entry.content);
            vscode.window.showInformationMessage('已复制到剪贴板');
        }
    });

    // 将所有命令添加到订阅列表
    context.subscriptions.push(
        copyTextDisposable,
        copyCodeDisposable,
        readClipboardDisposable,
        showHistoryDisposable
    );
    
    console.log('所有命令注册完成');
    vscode.window.showInformationMessage('灵犀协作插件命令注册完成');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};