const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const vscode = require('vscode');

/**
 * 创建并打开Draw.io文件
 * 生成一个新的.drawio格式文件并在VS Code中打开
 * @param {string} [filePath] 可选的文件路径，如果不提供则在当前工作区创建
 * @returns {Promise<string>} 创建的文件路径
 */
async function createAndOpenDrawio(filePath) {
    return new Promise((resolve, reject) => {
        try {
            // 如果未提供路径，则在当前工作区或文档目录创建
            if (!filePath) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                let savePath;
                
                if (workspaceFolders && workspaceFolders.length > 0) {
                    // 如果有打开的工作区，使用第一个工作区路径
                    savePath = workspaceFolders[0].uri.fsPath;
                } else {
                    // 否则使用用户的文档目录
                    const homeDir = process.env.USERPROFILE || process.env.HOME;
                    savePath = path.join(homeDir, 'Documents');
                }
                
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                filePath = path.join(savePath, `lingxi-diagram-${timestamp}.drawio`);
            }
            
            // 创建基本的 drawio 文件内容
            const drawioContent = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="2024-05-02T00:00:00.000Z" agent="Mozilla/5.0" version="21.1.2" type="device">
  <diagram id="C5RBs43oDa-KdzZeNtuy" name="第 1 页">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

            // 创建文件
            fs.writeFile(filePath, drawioContent, 'utf8', (err) => {
                if (err) {
                    console.error('创建文件时出错:', err);
                    reject(err);
                    return;
                }
                console.log(`文件已创建: ${filePath}`);

                // 使用VS Code打开文件
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath))
                    .then(() => {
                        console.log('文件已在VS Code中打开');
                        resolve(filePath);
                    })
                    .catch((error) => {
                        console.error('在VS Code中打开文件失败:', error);
                        // 尝试使用系统默认程序打开
                        try {
                            if (process.platform === 'win32') {
                                // Windows
                                exec(`start "" "${filePath}"`);
                            } else if (process.platform === 'darwin') {
                                // macOS
                                exec(`open "${filePath}"`);
                            } else {
                                // Linux
                                exec(`xdg-open "${filePath}"`);
                            }
                            resolve(filePath);
                        } catch (execError) {
                            reject(execError);
                        }
                    });
            });
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { createAndOpenDrawio }; 