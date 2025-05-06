const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getClipboardHistory } = require('../clipboard');

/**
 * 灵犀协作侧边栏视图提供者
 * 负责渲染侧边栏Webview内容并处理标签页交互
 */
class LingxiSidebarProvider {
    /**
     * 构造函数
     * @param {vscode.ExtensionContext} context 插件上下文
     */
    constructor(context) {
        this._context = context;
        this._webviewView = null;
    }

    /**
     * 向 Webview 发送剪贴板历史记录
     */
    sendClipboardHistory() {
        if (!this._webviewView) {
            return;
        }

        const history = getClipboardHistory();
        // 格式化时间戳和类型
        const formatted = history.map(item => ({
            id: item.id,
            content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
            type: item.type,
            time: item.timestamp ? new Date(item.timestamp).toLocaleString() : ''
        }));

        this._webviewView.webview.postMessage({ type: 'clipboardHistory', data: formatted });
    }

    /**
     * 扫描并获取工作区中的画布文件列表
     * @returns {Promise<Array<{name: string, path: string, lastModified: string}>>}
     */
    async loadCanvasList() {
        const canvasFiles = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return canvasFiles;
        }
        
        try {
            // 搜索工作区中的.drawio文件
            const drawioFiles = await vscode.workspace.findFiles('**/*.drawio', '**/node_modules/**');
            
            for (const fileUri of drawioFiles) {
                try {
                    const fileStat = await vscode.workspace.fs.stat(fileUri);
                    const fileName = path.basename(fileUri.fsPath);
                    const relativePath = vscode.workspace.asRelativePath(fileUri.fsPath);
                    
                    canvasFiles.push({
                        name: fileName,
                        path: relativePath,
                        fullPath: fileUri.fsPath,
                        lastModified: new Date(fileStat.mtime).toLocaleString()
                    });
                } catch (err) {
                    console.error(`获取文件信息失败: ${fileUri.fsPath}`, err);
                }
            }
            
            // 按修改时间降序排序，最新的在前面
            canvasFiles.sort((a, b) => {
                return new Date(b.lastModified) - new Date(a.lastModified);
            });
            
            return canvasFiles;
        } catch (error) {
            console.error('搜索画布文件失败:', error);
            return [];
        }
    }

    /**
     * 向Webview发送画布文件列表
     */
    async sendCanvasList() {
        if (!this._webviewView) {
            return;
        }
        
        try {
            const canvasList = await this.loadCanvasList();
            this._webviewView.webview.postMessage({ 
                type: 'canvasList', 
                data: canvasList 
            });
        } catch (error) {
            console.error('发送画布列表失败:', error);
        }
    }

    /**
     * Webview 解析入口
     * @param {vscode.WebviewView} webviewView
     */
    resolveWebviewView(webviewView) {
        this._webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.getHtmlForWebview();
        
        // 监听Webview消息
        this.setupMessageListeners();

        // 监听 webview 消息，实现 clipboardHistory 同步
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'getClipboardHistory') {
                this.sendClipboardHistory();
            } else if (message.command === 'switchTab') {
                if (message.tabId === 'history') {
                    // 切换到 History 标签页时刷新数据
                    this.sendClipboardHistory();
                } else if (message.tabId === 'canvas') {
                    // 切换到 Canvas 标签页时加载画布列表
                    this.sendCanvasList();
                }
                this.handleTabSwitch(message.tabId);
            } else if (message.type === 'getCanvasList') {
                // 响应画布列表请求
                this.sendCanvasList();
            } else if (message.command === 'openCanvas') {
                // 打开指定路径的画布文件
                if (message.path) {
                    try {
                        const uri = vscode.Uri.file(message.path);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    } catch (error) {
                        console.error('打开画布文件失败:', error);
                    }
                }
            }
        });

        // 初始加载时主动发送一次剪贴板历史
        setTimeout(() => {
            this.sendClipboardHistory();
        }, 500);
    }

    /**
     * 设置Webview消息监听器
     */
    setupMessageListeners() {
        this._webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'switchTab':
                    this.handleTabSwitch(message.tabId);
                    break;
                case 'createCanvas':
                    // 调用创建Draw.io画布的命令
                    vscode.commands.executeCommand('lingxixiezuo.createDrawio');
                    break;
            }
        });
    }

    /**
     * 处理标签页切换
     * @param {string} tabId 要切换到的标签页ID
     */
    handleTabSwitch(tabId) {
        this._webviewView.webview.postMessage({
            command: 'updateTab',
            activeTab: tabId
        });
    }

    /**
     * 生成侧边栏Webview的HTML内容，读取静态HTML文件并注入脚本
     * @returns {string}
     */
    getHtmlForWebview() {
        const htmlPath = path.join(this._context.extensionPath, 'sidebar', 'sidebar.html');
        try {
            let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            
            // 注入标签页切换脚本
            const scriptTag = `<script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    
                    // 标签切换处理
                    document.querySelectorAll('.tab-button').forEach(button => {
                        button.addEventListener('click', () => {
                            const tabId = button.dataset.tab;
                            vscode.postMessage({
                                command: 'switchTab',
                                tabId: tabId
                            });
                        });
                    });
                    
                    // 监听标签更新
                    window.addEventListener('message', event => {
                        if (event.data.command === 'updateTab') {
                            // 更新按钮状态
                            document.querySelectorAll('.tab-button').forEach(button => {
                                button.classList.toggle('active', button.dataset.tab === event.data.activeTab);
                            });
                            
                            // 更新内容区域
                            document.querySelectorAll('.tab-pane').forEach(pane => {
                                pane.classList.toggle('active', pane.id === event.data.activeTab);
                            });
                        }
                    });
                })();
            </script>`;
            
            return htmlContent.replace('</body>', `${scriptTag}</body>`);
        } catch (e) {
            return `<html><body><h2>灵犀协作侧边栏</h2><p>无法加载页面。</p></body></html>`;
        }
    }
}

module.exports = LingxiSidebarProvider;