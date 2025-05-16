// 初始加载时请求 API Key 状态
if (vscode) {
    vscode.postMessage({ command: 'getApiKeyStatus' });
}

// 语音录制变量
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let isRecording = false;
let currentAudio = null; // 当前播放的音频元素

// 初始化语音录制按钮和定时器显示
const voiceRecordBtn = document.getElementById('voice-record-btn');
let voiceRecordTimer = document.querySelector('.voice-record-timer');
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
        console.error('启动语音录制失败:', error);
        voiceRecordBtn.classList.remove('recording');
        voiceRecordTimer.style.display = 'none';
        isRecording = false;
        
        if (vscode) {
            vscode.postMessage({
                command: 'showError',
                text: `语音录制失败: ${error.message}`
            });
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

// 更新录制时间计时器
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
    } else if (message.command === 'audioRecordResult') {
        // 处理录音结果
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
            
            // 发送语音消息，包含录音文件名和消息ID
            vscode.postMessage({
                command: 'sendAudioMessage',
                audioData: audioData,
                duration: duration || Math.round((Date.now() - recordingStartTime) / 1000),
                audioFilename: audioFilename,
                messageId: window.lastRecordedMessageId
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
    } else if (message.command === 'playAudioData') {
        // 播放音频数据
        if (message.audioData) {
            // 停止当前正在播放的音频
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
            }
            
            // 创建新的音频元素并尝试不同的MIME类型
            let audio;
            
            // 首先尝试使用更通用的MIME类型
            try {
                console.log('尝试使用audio/mpeg播放');
                audio = new Audio(`data:audio/mpeg;base64,${message.audioData}`);
                
                // 添加事件监听器检测音频是否可以播放
                audio.addEventListener('canplaythrough', () => {
                    console.log('音频可以播放了 (audio/mpeg)');
                });
                
                audio.addEventListener('error', () => {
                    console.log('audio/mpeg格式无法播放，尝试audio/wav格式');
                    
                    // 如果mpeg格式失败，尝试wav格式
                    const audioWav = new Audio(`data:audio/wav;base64,${message.audioData}`);
                    
                    audioWav.addEventListener('canplaythrough', () => {
                        console.log('音频可以播放了 (audio/wav)');
                    });
                    
                    audioWav.onended = function() {
                        currentAudio = null;
                        // 通知后端播放完成
                        vscode.postMessage({
                            command: 'audioPlaybackEnded'
                        });
                    };
                    
                    audioWav.onerror = function(e) {
                        console.error('WAV格式播放失败，尝试最后方案', e);
                        
                        // 最后尝试使用通用二进制格式
                        const audioGeneric = new Audio(`data:audio/mp3;base64,${message.audioData}`);
                        
                        audioGeneric.onended = function() {
                            currentAudio = null;
                            vscode.postMessage({
                                command: 'audioPlaybackEnded'
                            });
                        };
                        
                        audioGeneric.onerror = function(finalError) {
                            console.error('所有格式都播放失败', finalError);
                            currentAudio = null;
                            vscode.postMessage({
                                command: 'audioPlaybackError',
                                error: '尝试了多种格式但都失败'
                            });
                            
                            vscode.postMessage({
                                command: 'showError',
                                text: `音频播放失败：${finalError.message || '不支持的音频格式'}`
                            });
                        };
                        
                        // 尝试播放通用格式
                        audioGeneric.play()
                            .then(() => {
                                currentAudio = audioGeneric;
                            })
                            .catch(finalPlayError => {
                                console.error('通用格式播放失败:', finalPlayError);
                                vscode.postMessage({
                                    command: 'showError',
                                    text: `音频播放失败: ${finalPlayError.message}`
                                });
                            });
                    };
                    
                    // 尝试播放wav格式
                    audioWav.play()
                        .then(() => {
                            currentAudio = audioWav;
                        })
                        .catch(wavPlayError => {
                            console.error('wav格式播放失败:', wavPlayError);
                            // 错误处理在onerror中
                        });
                });
                
                // 设置播放完成事件
                audio.onended = function() {
                    currentAudio = null;
                    // 通知后端播放完成
                    vscode.postMessage({
                        command: 'audioPlaybackEnded'
                    });
                };
                
                // 播放mpeg格式
                audio.play()
                    .then(() => {
                        console.log('开始播放mpeg格式音频');
                        currentAudio = audio;
                    })
                    .catch(mpegPlayError => {
                        console.error('mpeg格式播放失败:', mpegPlayError);
                        // 错误处理在onerror中已包含
                    });
                    
            } catch (e) {
                console.error('创建音频元素失败:', e);
                vscode.postMessage({
                    command: 'showError',
                    text: `创建音频元素失败: ${e.message}`
                });
            }
        }
    } else if (message.command === 'stopAudioPlayback') {
        // 停止音频播放
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
            
            // 通知后端播放已停止
            vscode.postMessage({
                command: 'audioPlaybackEnded'
            });
        }
    } else if (message.command === 'audioPlaybackError') {
        // 显示音频播放错误
        console.error('音频播放错误:', message.error);
        vscode.postMessage({
            command: 'showError',
            text: `音频播放错误: ${message.error}`
        });
    }
});

// 语音会议相关变量
let currentConference = null; // 当前会议ID
let isInConference = false; // 是否正在会议中
let isMuted = false; // 是否静音
let audioStreamProcess = null; // 音频流进程
let conferenceParticipants = []; // 会议参与者
let currentUserId = null; // 当前用户ID，初始为null

// 初始化语音会议UI组件
function initVoiceConference() {
    // 获取DOM元素
    const createBtn = document.getElementById('create-conference-btn');
    const joinBtn = document.getElementById('join-conference-btn');
    const leaveBtn = document.getElementById('leave-conference-btn');
    const joinForm = document.querySelector('.conference-join-form');
    const conferenceIdInput = document.getElementById('conference-id-input');
    const confirmJoinBtn = document.getElementById('confirm-join-btn');
    const cancelJoinBtn = document.getElementById('cancel-join-btn');
    const toggleMicBtn = document.getElementById('toggle-mic-btn');
    const conferenceStatus = document.querySelector('.voice-conference-status');
    const activeConferenceInfo = document.querySelector('.active-conference-info');
    const currentConferenceIdSpan = document.getElementById('current-conference-id');
    const micStatus = document.querySelector('.mic-status');
    
    // 创建会议按钮点击事件
    createBtn.addEventListener('click', () => {
        if (isInConference) {
            showErrorMessage('您已经在会议中');
            return;
        }
        
        // 生成唯一会议ID
        const conferenceId = `conference_${Date.now()}`;
        createConference(conferenceId);
    });
    
    // 加入会议按钮点击事件
    joinBtn.addEventListener('click', () => {
        if (isInConference) {
            showErrorMessage('您已经在会议中');
            return;
        }
        
        // 显示加入会议表单
        joinForm.style.display = 'flex';
        conferenceIdInput.focus();
    });
    
    // 确认加入会议
    confirmJoinBtn.addEventListener('click', () => {
        const conferenceId = conferenceIdInput.value.trim();
        if (!conferenceId) {
            showErrorMessage('请输入会议ID');
            return;
        }
        
        joinConference(conferenceId);
        joinForm.style.display = 'none';
        conferenceIdInput.value = '';
    });
    
    // 取消加入会议
    cancelJoinBtn.addEventListener('click', () => {
        joinForm.style.display = 'none';
        conferenceIdInput.value = '';
    });
    
    // 离开会议按钮点击事件
    leaveBtn.addEventListener('click', () => {
        if (!isInConference) {
            return;
        }
        
        leaveConference();
    });
    
    // 麦克风开关按钮点击事件
    toggleMicBtn.addEventListener('click', () => {
        if (!isInConference) {
            return;
        }
        
        toggleMicrophone();
    });
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
}

// 离开语音会议
function leaveConference() {
    if (!isInConference || !currentConference) {
        return;
    }
    
    // 发送离开会议请求
    vscode.postMessage({
        command: 'sendWebSocketMessage',
        message: JSON.stringify({
            type: 'voiceConference',
            action: 'leave'
        })
    });
    
    // 停止音频流
    stopAudioStream();
    
    // 更新UI状态
    updateConferenceUI(false);
}

// 切换麦克风状态
function toggleMicrophone() {
    if (!isInConference) {
        return;
    }
    
    isMuted = !isMuted;
    
    // 发送静音状态更新
    vscode.postMessage({
        command: 'sendWebSocketMessage',
        message: JSON.stringify({
            type: 'voiceConference',
            action: 'mute',
            muted: isMuted
        })
    });
    
    // 更新UI状态
    updateMicrophoneUI();
    
    // 如果已经有音频流运行，需要停止或重启
    if (isMuted) {
        stopAudioStream();
    } else if (currentConference) {
        startAudioStream(currentConference);
    }
}

// 开始音频流传输
function startAudioStream(conferenceId) {
    if (!conferenceId || isMuted) {
        return;
    }
    
    // 通过VSCode命令调用外部录音脚本，开启流模式
    vscode.postMessage({
        command: 'executeStreamCommand',
        script: 'chatroom/recordAudio.js',
        args: ['-stream', '-conferenceId', conferenceId]
    });
}

// 停止音频流传输
function stopAudioStream() {
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
        
        // 清空参与者列表
        document.getElementById('participants-list').innerHTML = '';
    } else {
        // 更新为非活跃状态
        createBtn.disabled = false;
        joinBtn.disabled = false;
        leaveBtn.disabled = true;
        
        conferenceStatus.textContent = '未连接';
        conferenceStatus.style.color = '#aaa';
        
        activeConferenceInfo.style.display = 'none';
        currentConferenceIdSpan.textContent = '';
        
        // 清空参与者列表
        document.getElementById('participants-list').innerHTML = '';
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
        micStatus.textContent = '麦克风已静音';
        micStatus.style.color = '#cc3333';
    } else {
        toggleMicBtn.textContent = '静音';
        toggleMicBtn.classList.remove('muted');
        micStatus.textContent = '麦克风已开启';
        micStatus.style.color = '#4CAF50';
    }
}

// 更新参与者列表
function updateParticipantsList(participants) {
    if (!Array.isArray(participants)) {
        return;
    }
    
    conferenceParticipants = participants;
    const listElement = document.getElementById('participants-list');
    listElement.innerHTML = '';
    
    participants.forEach(participant => {
        const listItem = document.createElement('li');
        
        // 创建参与者名称元素
        const nameSpan = document.createElement('span');
        nameSpan.className = 'participant-name';
        nameSpan.textContent = participant.name;
        
        // 创建参与者状态元素
        const statusSpan = document.createElement('span');
        statusSpan.className = 'participant-status';
        statusSpan.textContent = participant.isMuted ? '已静音' : '发言中';
        statusSpan.style.color = participant.isMuted ? '#aaa' : '#4CAF50';
        
        // 将元素添加到列表项
        listItem.appendChild(nameSpan);
        listItem.appendChild(statusSpan);
        
        // 添加到参与者列表
        listElement.appendChild(listItem);
    });
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
            
            // 更新参与者列表
            if (message.participants) {
                updateParticipantsList(message.participants);
            }
            break;
            
        case 'left':
            // 成功离开会议
            updateConferenceUI(false);
            break;
            
        case 'participantJoined':
        case 'participantLeft':
        case 'participantMuted':
            // 更新参与者列表
            if (message.participants) {
                updateParticipantsList(message.participants);
            }
            break;
            
        case 'error':
            // 会议操作错误
            showErrorMessage(`会议操作失败: ${message.message}`);
            break;
    }
}

// 初始化语音会议组件
document.addEventListener('DOMContentLoaded', () => {
    initVoiceConference();
});

// 扩展原有的消息处理函数，处理会议相关消息
window.addEventListener('message', event => {
    const message = event.data;
    
    // 更新当前用户ID (在websocket连接成功后由VSCode扩展发送)
    if (message.command === 'updateCurrentUser') {
        currentUserId = message.userId;
        console.log('[调试] 更新当前用户ID:', currentUserId);
    }
    
    // 处理API Key状态等现有逻辑...
    
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
});

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
        
        // 直接使用WebAudio API播放，增强兼容性
        console.log('[调试-播放] 使用WebAudio API播放...');
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
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
        audioContext.decodeAudioData(
            audioBuffer,
            function(buffer) {
                console.log('[调试-播放] 音频解码成功, 样本率:', buffer.sampleRate);
                
                // 创建音频源
                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                
                // 增加音量节点
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 3.0; // 增加音量到300%，使音频更容易听到
                
                // 连接节点
                source.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // 播放音频
                console.log('[调试-播放] 使用Web Audio API开始播放音频');
                source.start(0);
                
                // 播放完成事件
                source.onended = function() {
                    console.log('[调试-播放] 音频播放完成');
                };
            },
            function(error) {
                console.error('[调试-播放] Web Audio API解码失败，尝试使用备用方法:', error);
                fallbackToAllMethods(message.audioData);
            }
        );
    } catch (error) {
        console.error('[调试-播放] 播放音频流主方法失败:', error);
        
        try {
            // 尝试所有可能的播放方法
            fallbackToAllMethods(message.audioData);
        } catch (backupError) {
            console.error('[调试-播放] 所有播放方法都失败:', backupError);
            vscode.postMessage({
                command: 'showError',
                text: '无法播放音频：' + backupError.message
            });
        }
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
    const audio = new Audio(`data:audio/wav;base64,${audioData}`);
    audio.volume = 1.0; // 确保音量最大
    
    audio.oncanplaythrough = () => {
        console.log('[调试-直接播放] 音频加载完成，准备播放');
        audio.play()
            .then(() => console.log('[调试-直接播放] 播放开始'))
            .catch(e => console.error('[调试-直接播放] 播放失败:', e));
    };
    
    audio.onerror = (e) => {
        console.error('[调试-直接播放] 加载失败:', e);
    };
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
        
        // 创建音频上下文
        console.log('[调试-WebAudio] 创建AudioContext');
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        console.log('[调试-WebAudio] 音频数据长度:', len, '字节');
        console.log('[调试-WebAudio] 音频上下文创建成功, 状态:', audioContext.state);
        
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
        audioContext.decodeAudioData(
            bytes.buffer,
            function(buffer) {
                console.log('[调试-WebAudio] 音频解码成功, 样本率:', buffer.sampleRate);
                console.log('[调试-WebAudio] 音频通道数:', buffer.numberOfChannels);
                console.log('[调试-WebAudio] 音频长度:', buffer.duration, '秒');
                
                // 创建音频源
                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                
                // 增加音量节点
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 1.5; // 增加音量到150%
                
                // 连接节点
                source.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // 播放音频
                console.log('[调试-WebAudio] 开始播放音频');
                source.start(0);
                console.log('[调试-WebAudio] 音频播放命令已发送');
                
                // 播放完成事件
                source.onended = function() {
                    console.log('[调试-WebAudio] 音频播放完成');
                };
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
                const audio = new Audio(`data:${mimeType};base64,${base64AudioData}`);
                
                // 添加加载事件监听
                audio.addEventListener('loadstart', () => {
                    console.log(`[调试-多格式] ${mimeType} 开始加载`);
                });
                
                audio.oncanplaythrough = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式可以播放`);
                };
                
                audio.onplay = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式开始播放`);
                    playedAny = true;
                };
                
                audio.onended = () => {
                    console.log(`[调试-多格式] ${mimeType} 格式播放完成`);
                };
                
                audio.onerror = (e) => {
                    console.log(`[调试-多格式] ${mimeType} 格式播放失败:`, e.target.error);
                    failures++;
                    
                    // 如果所有格式都失败
                    if (failures === mimeTypes.length && !playedAny) {
                        console.error('[调试-多格式] 所有音频格式都播放失败');
                        
                        // 最后的尝试：直接播放PCM数据
                        try {
                            console.log('[调试-多格式] 尝试使用原始PCM数据播放');
                            const rawPcmData = atob(base64AudioData);
                            const pcmBuffer = new ArrayBuffer(rawPcmData.length);
                            const view = new Uint8Array(pcmBuffer);
                            for (let i = 0; i < rawPcmData.length; i++) {
                                view[i] = rawPcmData.charCodeAt(i);
                            }
                            
                            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                            const buffer = audioContext.createBuffer(1, pcmBuffer.byteLength / 2, 44100);
                            const channel = buffer.getChannelData(0);
                            
                            // 复制PCM数据到通道中
                            const dataView = new DataView(pcmBuffer);
                            for (let i = 0; i < channel.length; i++) {
                                channel[i] = dataView.getInt16(i * 2, true) / 32768.0;
                            }
                            
                            const source = audioContext.createBufferSource();
                            source.buffer = buffer;
                            source.connect(audioContext.destination);
                            source.start(0);
                            console.log('[调试-多格式] 原始PCM数据播放已启动');
                        } catch (pcmError) {
                            console.error('[调试-多格式] 原始PCM播放尝试失败:', pcmError);
                            vscode.postMessage({
                                command: 'showError',
                                text: '无法播放音频：所有格式均不兼容'
                            });
                        }
                    }
                };
                
                // 添加loadedmetadata事件监听
                audio.addEventListener('loadedmetadata', () => {
                    console.log(`[调试-多格式] ${mimeType} 元数据已加载，时长:`, audio.duration);
                });
                
                // 尝试播放
                audio.volume = 1.0; // 确保音量最大
                const playPromise = audio.play();
                
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log(`[调试-多格式] ${mimeType} 格式播放开始`);
                        })
                        .catch(e => {
                            console.log(`[调试-多格式] ${mimeType} 格式播放失败:`, e);
                            failures++;
                        });
                }
            } catch (error) {
                console.error(`[调试-多格式] ${mimeType} 格式尝试失败:`, error);
                failures++;
            }
        }, index * 300); // 每种格式间隔300毫秒尝试，避免冲突
    });
} 