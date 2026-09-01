/**
 * DSH后台搜索插件（完整版）
 * 
 * 功能：使用独立的Edge分身，自动化搜索DeepSeek和豆包网页版
 * 特点：
 * 1. 完全独立的Edge用户数据目录
 * 2. 可控制的静默模式（支持登录）
 * 3. 并发控制（防止冲突）
 * 4. 自动化搜索并返回结果文本
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { spawn, exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAG = '[dsh-bg-search]';

// 配置文件路径
const CONFIG_FILE = join(__dirname, 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
    edgePath: findEdgePath(),
    profileDir: join(process.env.USERPROFILE || '', '.dsh-edge-search'),
    debugPort: 9222,
    silentMode: true,  // 默认静默模式
    searchTimeout: 30000,
    concurrentLock: false  // 并发锁
};

// 搜索配置
const SEARCH_CONFIG = {
    deepseek: {
        name: 'DeepSeek',
        url: 'https://chat.deepseek.com/',
        searchUrl: (query) => `https://chat.deepseek.com/?q=${encodeURIComponent(query)}`
    },
    doubao: {
        name: '豆包',
        url: 'https://www.doubao.com/chat/',
        searchUrl: (query) => `https://www.doubao.com/chat/?q=${encodeURIComponent(query)}`
    }
};

/**
 * 加载配置
 */
function loadConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            const configData = readFileSync(CONFIG_FILE, 'utf8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
        }
    } catch (error) {
        console.error(`${TAG} 加载配置失败:`, error.message);
    }
    return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置
 */
function saveConfig(config) {
    try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`${TAG} 保存配置失败:`, error.message);
        return false;
    }
}

/**
 * 读取HTTP请求体
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString()));
            } catch {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

/**
 * 查找Edge可执行文件路径
 */
function findEdgePath() {
    const possiblePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    
    for (const path of possiblePaths) {
        if (existsSync(path)) {
            return path;
        }
    }
    
    return 'msedge.exe';
}

/**
 * 并发控制器
 */
class ConcurrencyController {
    constructor() {
        this.lock = false;
        this.queue = [];
    }
    
    /**
     * 获取锁
     */
    async acquire() {
        // 如果锁被占用，等待
        while (this.lock) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 获取锁
        this.lock = true;
        return true;
    }
    
    /**
     * 释放锁
     */
    release() {
        this.lock = false;
        
        // 处理队列中的下一个任务
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next.resolve();
        }
    }
    
    /**
     * 等待锁
     */
    async wait() {
        return new Promise((resolve) => {
            if (!this.lock) {
                resolve();
            } else {
                this.queue.push({ resolve });
            }
        });
    }
}

/**
 * 通过CDP WebSocket执行JavaScript表达式
 * @param {string} wsUrl - WebSocket调试地址
 * @param {string} expression - 要执行的JS表达式
 * @param {number} timeout - 超时毫秒数
 * @returns {Promise<any>} 执行结果
 */
function cdpEvaluate(wsUrl, expression, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let msgId = 1;
        let settled = false;
        
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                try { ws.close(); } catch {}
                reject(new Error('CDP执行超时'));
            }
        }, timeout);
        
        ws.onopen = () => {
            const id = msgId++;
            ws.send(JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: {
                    expression,
                    returnByValue: true,
                    awaitPromise: true,
                    timeout: timeout - 1000
                }
            }));
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
                if (data.id !== undefined && !settled) {
                    settled = true;
                    clearTimeout(timer);
                    try { ws.close(); } catch {}
                    if (data.error) {
                        reject(new Error(data.error.message || 'CDP错误'));
                    } else if (data.result?.exceptionDetails) {
                        reject(new Error(data.result.exceptionDetails.text || 'CDP执行异常'));
                    } else {
                        resolve(data.result?.result?.value ?? null);
                    }
                }
            } catch {}
        };
        
        ws.onerror = () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error('WebSocket连接失败'));
            }
        };
        
        ws.onclose = () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error('WebSocket已关闭'));
            }
        };
    });
}

/**
 * 通过CDP发送真实按键事件
 */
function cdpSendKey(wsUrl, key, code, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let msgId = 1;
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('CDP key timeout')); }
        }, timeout);
        ws.onopen = () => {
            // keyDown
            ws.send(JSON.stringify({ id: msgId++, method: 'Input.dispatchKeyEvent', params: {
                type: 'keyDown', key, code, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
            }}));
            // keyUp
            ws.send(JSON.stringify({ id: msgId++, method: 'Input.dispatchKeyEvent', params: {
                type: 'keyUp', key, code, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
            }}));
            // 等一下确认发送完成
            setTimeout(() => { if (!settled) { settled = true; clearTimeout(timer); ws.close(); resolve(true); } }, 500);
        };
        ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('CDP key error')); } };
    });
}

/**
 * 后台Edge管理器
 */
class BackgroundEdgeManager {
    constructor() {
        this.process = null;
        this.isConnected = false;
        this.config = loadConfig();
        this.concurrency = new ConcurrencyController();
        
        // 确保配置目录存在
        if (!existsSync(this.config.profileDir)) {
            mkdirSync(this.config.profileDir, { recursive: true });
        }
    }
    
    /**
     * 启动后台Edge
     */
    async startBackgroundEdge(silent = null) {
        console.log(`${TAG} 🚀 启动后台Edge分身...`);
        
        try {
            // 重新加载配置，确保读取最新的silentMode等设置
            this.config = loadConfig();
            
            // 使用传入的silent参数，否则使用配置（在config重载之后）
            const useSilent = silent !== null ? silent : this.config.silentMode;
            
            console.log(`${TAG} 🚀 启动后台Edge分身 (静默模式: ${useSilent ? '是' : '否'})...`);
            
            // 启动Edge
            const args = [
                `--remote-debugging-port=${this.config.debugPort}`,
                '--remote-allow-origins=*',
                `--user-data-dir=${this.config.profileDir}`,
                '--no-first-run',
                '--hide-crash-restore',
                '--disable-session-crashed-bubble',
                '--disable-features=msEdgeSidebarV2,msEdgeTaskbar,msEdgeWelcomePage',
                '--no-default-browser-check'
            ];
            
            // 根据静默模式决定窗口状态
            if (useSilent) {
                args.push('--start-minimized');
                args.push('--window-position=-32000,-32000');
            } else {
                // 非静默模式：正常显示窗口，方便用户登录
                args.push('--start-maximized');
            }
            
            this.process = spawn(this.config.edgePath, args, {
                detached: true,
                stdio: 'ignore'
            });
            
            this.process.unref();
            
            console.log(`${TAG} 后台Edge进程已启动 (PID: ${this.process.pid})`);
            
            // 等待调试端口可用
            const connected = await this.waitForDebugPort();
            
            if (connected) {
                console.log(`${TAG} ✅ 后台Edge调试模式已启动 (端口: ${this.config.debugPort})`);
                return true;
            } else {
                console.error(`${TAG} ❌ 后台Edge启动超时`);
                return false;
            }
            
        } catch (error) {
            console.error(`${TAG} ❌ 启动后台Edge失败:`, error.message);
            return false;
        }
    }
    
    /**
     * 检查Edge是否正在运行
     */
    async checkEdgeRunning() {
        return new Promise((resolve) => {
            exec('tasklist /FI "IMAGENAME eq msedge.exe" /NH', (error, stdout) => {
                if (error) {
                    resolve(false);
                    return;
                }
                
                const lines = stdout.split('\n');
                const edgeLines = lines.filter(line => line.includes('msedge.exe'));
                resolve(edgeLines.length > 0);
            });
        });
    }
    
    /**
     * 等待调试端口可用
     */
    async waitForDebugPort(timeout = 15000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                const connected = await this.checkDebugPort();
                if (connected) {
                    this.isConnected = true;
                    return true;
                }
            } catch (error) {
                // 继续等待
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        return false;
    }
    
    /**
     * 检查调试端口
     */
    async checkDebugPort() {
        try {
            const response = await fetch(`http://127.0.0.1:${this.config.debugPort}/json/version`);
            if (response.ok) {
                this.isConnected = true;
                return true;
            }
            return false;
        } catch (error) {
            this.isConnected = false;
            return false;
        }
    }
    
    /**
     * 打开URL在后台Edge中
     */
    async openUrl(url) {
        try {
            // Edge调试端口API要求使用PUT方法
            const response = await fetch(`http://127.0.0.1:${this.config.debugPort}/json/new?${encodeURIComponent(url)}`, {
                method: 'PUT'
            });
            if (response.ok) {
                const tabInfo = await response.json();
                return {
                    success: true,
                    tabId: tabInfo.id,
                    url
                };
            }
            return { success: false, error: '无法创建新标签页' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 通过CDP在指定tab中提交查询并等待AI回复
     * @param {string} wsUrl - tab的WebSocket调试URL
     * @param {string} query - 搜索查询
     * @param {string} source - 来源 'deepseek' 或 'doubao'
     * @returns {Promise<{status: string, content: string}>}
     */
    async cdpSearch(wsUrl, query, source, debugPort) {
        // 等待页面加载（豆包需要更长时间）
        const waitTime = source === 'doubao' ? 6000 : 3000;
        await new Promise(r => setTimeout(r, waitTime));
        
        // 构建输入脚本：找到输入框，填入查询，按回车
        const escapedQuery = JSON.stringify(query);
        const inputScript = `
            (function() {
                var ta = null;
                var selectors = [
                    '.ProseMirror',              // 豆包ProseMirror编辑器
                    'textarea[placeholder]',
                    'textarea',
                    '[contenteditable="true"]',
                    '[role="textbox"]',
                    'input[type="text"]'
                ];
                for (var i = 0; i < selectors.length; i++) {
                    ta = document.querySelector(selectors[i]);
                    if (ta) break;
                }
                if (!ta) return 'NO_INPUT_FOUND';
                
                ta.focus();
                
                // ProseMirror/contenteditable 用 execCommand
                if (ta.contentEditable === 'true' || ta.classList.contains('ProseMirror')) {
                    ta.innerHTML = '';
                    document.execCommand('insertText', false, ${escapedQuery});
                } else {
                    // textarea/input 用原生setter
                    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype, 'value')?.set
                        || Object.getOwnPropertyDescriptor(window.HTMLInputElement?.prototype, 'value')?.set;
                    if (setter) {
                        setter.call(ta, ${escapedQuery});
                    } else {
                        ta.value = ${escapedQuery};
                    }
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // 模拟回车键（用execCommand插入文本后，按钮可能出现）
                ta.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
                ta.dispatchEvent(new KeyboardEvent('keypress', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
                ta.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
                return 'SUBMITTED';
            })()
        `;
        
        const submitResult = await cdpEvaluate(wsUrl, inputScript, 10000);
        
        if (submitResult === 'NO_INPUT_FOUND') {
            return { status: '未找到输入框', content: '请在Edge浏览器中手动输入搜索' };
        }
        
        console.log(`${TAG} ✅ 查询已提交到 ${source}，等待AI回复...`);
        
        // 用真实CDP按键发送Enter（合成事件在ProseMirror里不触发发送）
        try {
            await cdpSendKey(wsUrl, 'Enter', 'Enter');
        } catch (e) {
            console.log(`${TAG} CDP按键失败，尝试点击发送按钮...`);
            // 降级：尝试点击发送按钮
            await cdpEvaluate(wsUrl, `
                (function() {
                    var btns = document.querySelectorAll('button');
                    for (var i = 0; i < btns.length; i++) {
                        var svg = btns[i].querySelector('svg path');
                        if (svg && svg.getAttribute('d')?.startsWith('M12.0005')) {
                            btns[i].click();
                            return 'CLICKED';
                        }
                    }
                    return 'NO_SEND_BTN';
                })()
            `, 5000);
        }
        
        // 等待AI开始生成回复（豆包发消息后URL会变，需要刷新tab列表）
        await new Promise(r => setTimeout(r, 5000));
        
        // URL-change detection: 豆包导航到新URL后WebSocket失效，刷新tab列表
        if (debugPort) {
            try {
                const freshResp = await fetch(`http://127.0.0.1:${debugPort}/json`);
                const freshTabs = await freshResp.json();
                const matching = freshTabs.filter(t =>
                    t.url && t.url.includes(source) && t.webSocketDebuggerUrl && t.type === 'page'
                );
                if (matching.length > 0) wsUrl = matching[matching.length - 1].webSocketDebuggerUrl;
            } catch (_) {}
        }
        
        // 轮询等待回复完成（最多60秒）
        let lastText = '';
        let stableCount = 0;
        let currentWsUrl = wsUrl;
        
        for (let i = 0; i < 30; i++) {
            // 每次轮询刷新tab列表（豆包发消息后URL会变，WebSocket失效）
            if (debugPort && i > 0) {
                try {
                    const freshResp = await fetch(`http://127.0.0.1:${debugPort}/json`);
                    const freshTabs = await freshResp.json();
                    const matching = freshTabs.filter(t =>
                        t.url && t.url.includes(source) && t.webSocketDebuggerUrl && t.type === 'page'
                    );
                    if (matching.length > 0) currentWsUrl = matching[matching.length - 1].webSocketDebuggerUrl;
                } catch (_) {}
            }
            const extractScript = `
                (function() {
                    // 获取页面全部文本（简单可靠）
                    var bodyText = document.body.innerText || '';
                    // 检查loading状态
                    var loading = document.querySelector(
                        '[class*="loading"], [class*="typing"], [class*="generating"], ' +
                        '[class*="cursor-blink"], .stop-generating, [class*="thinking"]'
                    );
                    return JSON.stringify({ text: bodyText, loading: !!loading });
                })()
            `;
            
            const rawResult = await cdpEvaluate(currentWsUrl, extractScript, 10000);
            
            if (rawResult) {
                try {
                    const parsed = JSON.parse(rawResult);
                    let currentText = parsed.text || '';
                    const isLoading = parsed.loading;

                    // For doubao, extract only the AI response from the full page text
                    if (source === 'doubao' && currentText.length > 200) {
                        const queryIdx = currentText.indexOf(query);
                        if (queryIdx > 0) {
                            // Take everything after the user's query
                            let extracted = currentText.substring(queryIdx + query.length);
                            // Trim leading/trailing noise (navigation, whitespace)
                            extracted = extracted.replace(/^[\s\S]{0,200}?(搜索\d+|搜索结果|相关搜索)/, '').trim();
                            if (extracted.length > 50) {
                                currentText = extracted;
                            }
                        }
                    }

                    // 文本有实质内容且不再变化时认为完成
                    if (currentText.length > 50 && currentText === lastText && !isLoading) {
                        stableCount++;
                        if (stableCount >= 3) {
                            // 连续3次文本相同且无loading标记 → 完成
                            return { status: '搜索完成', content: currentText.trim() };
                        }
                    } else {
                        stableCount = 0;
                        lastText = currentText;
                    }
                } catch {}
            }
            
            await new Promise(r => setTimeout(r, 2000));
        }
        
        // 超时但有内容则返回
        if (lastText && lastText.length > 20) {
            return { status: '搜索完成（超时）', content: lastText.trim() };
        }
        
        return { status: '响应超时', content: 'AI响应超时，请在Edge浏览器中查看结果' };
    }
    
    /**
     * 执行搜索（带并发控制）
     */
    async search(query, source = 'both') {
        // 等待并发锁
        await this.concurrency.wait();
        
        // 获取锁
        await this.concurrency.acquire();
        
        try {
            console.log(`${TAG} 🔍 执行搜索: ${query}`);
            
            const results = [];
            const port = this.config.debugPort;
            
            // 决定搜索哪些来源
            const sources = [];
            if (source === 'both' || source === 'deepseek') sources.push('deepseek');
            if (source === 'both' || source === 'doubao') sources.push('doubao');
            
            // 第一步：打开基础页面（不带查询参数）
            for (const src of sources) {
                const baseUrl = SEARCH_CONFIG[src].url;
                const openResult = await this.openUrl(baseUrl);
                if (openResult.success) {
                    results.push({
                        source: SEARCH_CONFIG[src].name,
                        sourceKey: src,
                        url: baseUrl,
                        status: '已打开',
                        tabId: openResult.tabId,
                        content: ''
                    });
                } else {
                    results.push({
                        source: SEARCH_CONFIG[src].name,
                        sourceKey: src,
                        url: baseUrl,
                        status: '打开失败',
                        content: openResult.error || '无法创建标签页'
                    });
                }
            }
            
            // 第二步：通过CDP与每个tab交互（带重试）
            try {
                // 等待一下让tab稳定
                await new Promise(r => setTimeout(r, 2000));
                
                const resp = await fetch(`http://127.0.0.1:${port}/json`);
                if (!resp.ok) throw new Error('无法获取tab列表');
                const tabs = await resp.json();
                console.log(`${TAG} 获取到 ${tabs.length} 个tab`);
                
                for (const result of results) {
                    if (result.status !== '已打开') continue;
                    
                    // 重试最多3次
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            // 重新获取tab列表（每次重试都刷新）
                            const freshResp = await fetch(`http://127.0.0.1:${port}/json`);
                            const freshTabs = await freshResp.json();
                            
                            // 找到对应的tab（按URL域名匹配，取最新的）
                            const urlDomain = result.sourceKey === 'deepseek' ? 'deepseek' : 'doubao';
                            const matchingTabs = freshTabs.filter(t =>
                                t.url && t.url.includes(urlDomain) && t.webSocketDebuggerUrl && t.type === 'page'
                            );
                            const tab = matchingTabs.length > 0 ? matchingTabs[matchingTabs.length - 1] : null;
                            
                            if (!tab) {
                                console.log(`${TAG} ${result.source} 未找到tab，等待重试 (${attempt}/3)`);
                                await new Promise(r => setTimeout(r, 3000));
                                continue;
                            }
                            
                            console.log(`${TAG} ${result.source} 找到tab: ${tab.url}`);
                            // 执行CDP搜索交互
                            const searchResult = await this.cdpSearch(tab.webSocketDebuggerUrl, query, result.sourceKey, port);
                            result.status = searchResult.status;
                            result.content = searchResult.content;
                            break; // 成功，不再重试
                            
                        } catch (cdpError) {
                            console.error(`${TAG} CDP交互失败 (${result.source}, 尝试${attempt}/3):`, cdpError.message);
                            if (attempt === 3) {
                                result.status = '已打开（CDP失败）';
                                result.content = `CDP连接失败: ${cdpError.message}`;
                            } else {
                                await new Promise(r => setTimeout(r, 3000));
                            }
                        }
                    }
                }
            } catch (listError) {
                console.error(`${TAG} 获取tab列表失败:`, listError.message);
                // 降级：所有结果标记为仅打开
                for (const result of results) {
                    if (result.status === '已打开') {
                        result.status = '已打开（CDP不可用）';
                        result.content = '请在Edge浏览器中查看搜索结果';
                    }
                }
            }
            
            return results;
            
        } catch (error) {
            console.error(`${TAG} ❌ 搜索失败:`, error.message);
            return [];
        } finally {
            // 释放锁
            this.concurrency.release();
        }
    }
    
    /**
     * 更新配置
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        saveConfig(this.config);
        return this.config;
    }
    
    /**
     * 获取状态
     */
    getStatus() {
        return {
            edgePath: this.config.edgePath,
            profileDir: this.config.profileDir,
            debugPort: this.config.debugPort,
            silentMode: this.config.silentMode,
            isConnected: this.isConnected,
            processId: this.process?.pid || null
        };
    }
}

/**
 * DSH后台搜索插件
 */
export const inject = ['tools'];

export const description = 'DSH后台搜索插件：使用独立Edge分身，支持手动控制静默模式和并发控制';

/**
 * 插件主函数
 */
export function apply(ctx, config) {
    console.log(`${TAG} 🚀 DSH后台搜索插件加载中...`);
    
    // 初始化后台Edge管理器
    const edgeManager = new BackgroundEdgeManager();
    
    // 注册工具
    ctx.tools.register(defineTool({
        name: 'bg_search_status',
        description: '检查后台Edge连接状态',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    edgeConnected: { type: 'boolean', description: '后台Edge是否已连接' },
                    debugPort: { type: 'number', description: '调试端口' },
                    silentMode: { type: 'boolean', description: '是否静默模式' },
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                // 返回DSH框架期望的格式
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async () => {
            console.log(`${TAG} 检查后台Edge状态`);
            
            try {
                const isConnected = await edgeManager.checkDebugPort();
                const status = edgeManager.getStatus();
                
                let message = '';
                if (isConnected) {
                    message = `✅ 后台Edge已连接 (端口: ${status.debugPort})\n静默模式: ${status.silentMode ? '是' : '否'}\n可以使用bg_search工具`;
                } else {
                    message = `❌ 后台Edge未连接\n端口: ${status.debugPort}\n静默模式: ${status.silentMode ? '是' : '否'}\n建议：插件将自动尝试启动后台Edge`;
                    
                    // 尝试自动启动
                    console.log(`${TAG} 尝试启动后台Edge...`);
                    const started = await edgeManager.startBackgroundEdge();
                    if (started) {
                        message = `✅ 后台Edge已自动启动并连接 (端口: ${status.debugPort})\n静默模式: ${status.silentMode ? '是' : '否'}`;
                    }
                }
                
                return {
                    edgeConnected: isConnected,
                    debugPort: status.debugPort,
                    silentMode: status.silentMode,
                    content: [{
                        type: 'text',
                        text: message
                    }],
                    message
                };
                
            } catch (error) {
                console.error(`${TAG} ❌ bg_search_status工具执行异常:`, error.message);
                return {
                    edgeConnected: false,
                    debugPort: edgeManager.config.debugPort,
                    silentMode: edgeManager.config.silentMode,
                    content: [{
                        type: 'text',
                        text: `状态检查异常: ${error.message}`
                    }],
                    message: `❌ 状态检查异常: ${error.message}`
                };
            }
        }
    }));
    
    ctx.tools.register(defineTool({
        name: 'bg_search',
        description: '后台搜索：在后台Edge中打开DeepSeek或豆包搜索页面',
        parameters: {
            query: {
                type: 'string',
                description: '要搜索的问题或关键词',
                required: true
            },
            source: {
                type: 'string',
                description: '搜索来源：deepseek、doubao、both（默认both）'
            }
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', description: '搜索是否成功' },
                    results: { type: 'array', description: '搜索结果' },
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                // 返回DSH框架期望的格式
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async ({ query, source = 'both' }) => {
            console.log(`${TAG} 🔍 后台搜索: ${query}`);
            
            try {
                // 检查并发锁
                if (edgeManager.concurrency.lock) {
                    return {
                        success: false,
                        results: [],
                        content: [{
                            type: 'text',
                            text: `⚠️ 搜索正在执行中，请稍后再试`
                        }],
                        message: `⚠️ 搜索正在执行中，请稍后再试`
                    };
                }
                
                // 确保Edge正在运行
                const isConnected = await edgeManager.checkDebugPort();
                if (!isConnected) {
                    console.log(`${TAG} ⚠️ 后台Edge未运行，尝试启动...`);
                    await edgeManager.startBackgroundEdge();
                }
                
                // 执行搜索
                const results = await edgeManager.search(query, source);
                
                // 生成结果信息
                let resultText = '';
                if (results.length > 0) {
                    resultText = results.map(r => {
                        let text = `【${r.source}】\nURL: ${r.url}\n状态: ${r.status}`;
                        if (r.content) {
                            // 截取前2000字符避免过长
                            const preview = r.content.length > 2000
                                ? r.content.substring(0, 2000) + '\n...(内容已截断)'
                                : r.content;
                            text += `\n\n抓取内容:\n${preview}`;
                        }
                        return text;
                    }).join('\n\n---\n\n');
                } else {
                    resultText = '未成功打开搜索页面';
                }
                
                const hasContent = results.some(r => r.content && r.content.length > 50);
                const message = hasContent
                    ? `✅ 后台搜索完成\n查询: ${query}\n来源: ${source}\n\n${resultText}`
                    : `⚠️ 后台搜索已打开页面\n查询: ${query}\n来源: ${source}\n\n${resultText}\n\n请在后台Edge浏览器中查看搜索结果`;
                
                return {
                    success: results.length > 0,
                    results,
                    content: [{
                        type: 'text',
                        text: message
                    }],
                    message
                };
                
            } catch (error) {
                console.error(`${TAG} ❌ bg_search工具执行异常:`, error.message);
                return {
                    success: false,
                    results: [],
                    content: [{
                        type: 'text',
                        text: `搜索异常: ${error.message}`
                    }],
                    message: `❌ 后台搜索异常: ${error.message}`
                };
            }
        }
    }));
    
    ctx.tools.register(defineTool({
        name: 'bg_search_config',
        description: '配置后台搜索插件：控制静默模式等设置',
        parameters: {
            silentMode: {
                type: 'boolean',
                description: '是否静默模式（true=静默启动，false=显示窗口用于登录）'
            }
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', description: '配置是否成功' },
                    config: { type: 'object', description: '当前配置', additionalProperties: true },
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                // 返回DSH框架期望的格式
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async ({ silentMode }) => {
            console.log(`${TAG} 配置后台搜索插件`);
            
            try {
                // 更新配置
                const newConfig = edgeManager.updateConfig({ silentMode });
                
                const message = `✅ 配置已更新\n静默模式: ${newConfig.silentMode ? '是' : '否'}\n\n${newConfig.silentMode ? '下次启动Edge时将静默启动' : '下次启动Edge时将显示窗口，方便登录'}`;
                
                return {
                    success: true,
                    config: newConfig,
                    content: [{
                        type: 'text',
                        text: message
                    }],
                    message
                };
                
            } catch (error) {
                console.error(`${TAG} ❌ bg_search_config工具执行异常:`, error.message);
                return {
                    success: false,
                    config: edgeManager.config,
                    content: [{
                        type: 'text',
                        text: `配置失败: ${error.message}`
                    }],
                    message: `❌ 配置失败: ${error.message}`
                };
            }
        }
    }));
    
    // 注册显示控制面板的工具
    ctx.tools.register(defineTool({
        name: 'bg_search_panel',
        description: '显示后台搜索控制面板',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async () => {
            console.log(`${TAG} 显示控制面板`);
            
            const status = await edgeManager.checkDebugPort();
            const config = edgeManager.config;
            
            const panelHtml = `
<div style="font-family: 'Segoe UI', sans-serif; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 15px; color: white;">
    <h2 style="margin-bottom: 20px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">🔍 DSH后台搜索控制面板</h2>
    
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin-bottom: 15px;">
        <h3 style="margin-bottom: 10px;">📊 系统状态</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
            <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                <div style="font-size: 0.9em; opacity: 0.8;">Edge连接</div>
                <div style="font-size: 1.2em; font-weight: bold;">${status ? '✅ 已连接' : '❌ 未连接'}</div>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                <div style="font-size: 0.9em; opacity: 0.8;">静默模式</div>
                <div style="font-size: 1.2em; font-weight: bold;">${config.silentMode ? '✅ 开启' : '❌ 关闭'}</div>
            </div>
        </div>
    </div>
    
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin-bottom: 15px;">
        <h3 style="margin-bottom: 10px;">💡 使用说明</h3>
        <ol style="padding-left: 20px; line-height: 1.8;">
            <li><strong>首次使用</strong>：执行 \`bg_search_config({silentMode: false})\` 关闭静默模式</li>
            <li><strong>登录</strong>：执行 \`bg_search_status\` 启动Edge，在窗口中登录</li>
            <li><strong>正常使用</strong>：登录后执行 \`bg_search_config({silentMode: true})\` 开启静默模式</li>
        </ol>
    </div>
    
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px;">
        <h3 style="margin-bottom: 10px;">⚡ 快捷命令</h3>
        <div style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
            <div>检查状态: \`bg_search_status\`</div>
            <div>执行搜索: \`bg_search({query: "关键词", source: "both"})\`</div>
            <div>关闭静默: \`bg_search_config({silentMode: false})\`</div>
            <div>开启静默: \`bg_search_config({silentMode: true})\`</div>
        </div>
    </div>
</div>
`;
            
            return {
                content: [{
                    type: 'text',
                    text: panelHtml
                }],
                message: '🔍 DSH后台搜索控制面板'
            };
        }
    }));
    
    // 注册显示快捷命令的工具
    ctx.tools.register(defineTool({
        name: 'bg_search_help',
        description: '显示后台搜索快捷命令和使用说明',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async () => {
            console.log(`${TAG} 显示快捷命令`);
            
            const helpText = `
## 🔍 DSH后台搜索快捷命令

### 状态检查
\`await bg_search_status()\` - 检查后台Edge状态

### 执行搜索
\`await bg_search({query: "关键词", source: "both"})\` - 搜索DeepSeek和豆包

### 配置设置
\`await bg_search_config({silentMode: false})\` - 关闭静默模式（用于登录）
\`await bg_search_config({silentMode: true})\` - 开启静默模式（后台运行）

### 使用流程
1. 首次使用：关闭静默模式 → 启动Edge → 登录 → 开启静默模式
2. 日常使用：直接执行 \`bg_search\` 即可
`;
            
            return {
                content: [{
                    type: 'text',
                    text: helpText
                }],
                message: '💡 DSH后台搜索快捷命令'
            };
        }
    }));
    
    // 注册快速配置工具
    ctx.tools.register(defineTool({
        name: 'bg_search_quick_config',
        description: '快速配置后台搜索插件',
        parameters: {
            action: {
                type: 'string',
                description: '操作：login（登录模式）、normal（正常模式）、status（查看状态）'
            }
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    content: { type: 'array', description: '内容数组' },
                    message: { type: 'string', description: '状态描述消息' }
                },
                additionalProperties: false
            },
            render: (args, value) => {
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async ({ action }) => {
            console.log(`${TAG} 快速配置: ${action}`);
            
            const currentConfig = edgeManager.config;
            let message = '';
            
            switch (action) {
                case 'login':
                    currentConfig.silentMode = false;
                    saveConfig(currentConfig);
                    message = `✅ 已切换到登录模式\n\n静默模式已关闭，下次启动Edge时将显示窗口。\n\n请执行 \`bg_search_status\` 启动Edge，然后在窗口中登录。`;
                    break;
                    
                case 'normal':
                    currentConfig.silentMode = true;
                    saveConfig(currentConfig);
                    message = `✅ 已切换到正常模式\n\n静默模式已开启，Edge将在后台静默运行。`;
                    break;
                    
                case 'status':
                    message = `📊 当前配置状态\n\n静默模式: ${currentConfig.silentMode ? '✅ 开启' : '❌ 关闭'}\n调试端口: ${currentConfig.debugPort}\nEdge路径: ${currentConfig.edgePath}`;
                    break;
                    
                default:
                    message = `❌ 未知操作: ${action}\n\n可用操作:\n- login: 切换到登录模式\n- normal: 切换到正常模式\n- status: 查看当前状态`;
            }
            
            return {
                content: [{
                    type: 'text',
                    text: message
                }],
                message
            };
        }
    }));
    
    console.log(`${TAG} ✅ DSH后台搜索插件已加载`);
    console.log(`${TAG} 📦 可用工具: bg_search_status, bg_search, bg_search_config, bg_search_panel, bg_search_help, bg_search_quick_config`);
    console.log(`${TAG} 💡 提示: 使用 bg_search_panel 显示控制面板`);
    
    // 注册HTTP路由供客户端UI调用
    if (ctx.webServer) {
        ctx.webServer.register({
            kind: "prefix",
            path: "/bg-search",
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url ?? "/", "http://dsh.internal");
                    const rel = url.pathname.slice("/bg-search".length);
                    const segments = rel.split("/").filter(Boolean);
                    const method = (req.method ?? "GET").toUpperCase();
                    const body = method === "GET" ? undefined : await readBody(req);
                    
                    let result;
                    const action = segments[0] || "status";
                    
                    if (action === "status") {
                        const config = loadConfig();
                        result = {
                            connected: false,
                            running: false,
                            silentMode: config.silentMode,
                            debugPort: config.debugPort,
                            edgePath: config.edgePath
                        };
                    } else if (action === "config") {
                        if (method === "PUT" || method === "POST") {
                            const config = loadConfig();
                            if (body.silentMode !== undefined) config.silentMode = body.silentMode;
                            if (body.debugPort !== undefined) config.debugPort = body.debugPort;
                            saveConfig(config);
                            result = { ok: true, message: "配置已更新" };
                        } else {
                            result = loadConfig();
                        }
                    } else if (action === "quick-config") {
                        const config = loadConfig();
                        const actionParam = body.action || segments[1];
                        let message = "";
                        switch (actionParam) {
                            case 'login':
                                config.silentMode = false;
                                saveConfig(config);
                                try {
                                    const edgePath = config.edgePath || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
                                    const profileDir = config.profileDir || join(process.env.USERPROFILE || '', '.dsh-edge-search');
                                    const port = config.debugPort || 9222;
                                    
                                    // 杀掉占用调试端口的Edge进程
                                    try {
                                        const { execSync } = await import('child_process');
                                        const result = execSync(`netstat -aon | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 5000 });
                                        const pids = [...new Set(result.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
                                        for (const pid of pids) {
                                            try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
                                        }
                                        console.log(`${TAG} 已杀掉端口${port}占用进程: ${pids.join(',')}`);
                                    } catch (_) {
                                        console.log(`${TAG} 端口${port}无占用进程`);
                                    }
                                    
                                    // 等1秒让端口释放
                                    await new Promise(r => setTimeout(r, 1000));
                                    
                                    // 启动新Edge（显示窗口）
                                    const edgeProc = spawn(edgePath, [
                                        `--remote-debugging-port=${port}`,
                                        '--remote-allow-origins=*',
                                        `--user-data-dir=${profileDir}`,
                                        '--no-first-run',
                                        '--start-maximized'
                                    ], { detached: true, stdio: 'ignore' });
                                    edgeProc.unref();
                                    message = `✅ 已切换到登录模式\n\nEdge窗口正在弹出`;
                                } catch (e) {
                                    message = `✅ 配置已更新，但Edge启动失败: ${e.message}`;
                                }
                                break;
                            case 'normal':
                                config.silentMode = true;
                                saveConfig(config);
                                message = "✅ 已切换到正常模式\n\n静默模式已开启。";
                                break;
                            case 'start':
                                try {
                                    await edgeManager.startBackgroundEdge(null);
                                    message = "✅ Edge分身已启动";
                                } catch (e) {
                                    message = "❌ Edge启动失败: " + e.message;
                                }
                                break;
                            case 'status':
                                message = `静默模式: ${config.silentMode ? '开启' : '关闭'}`;
                                break;
                            default:
                                message = `未知操作: ${actionParam}`;
                        }
                        result = { ok: true, message };
                    } else {
                        res.writeHead(404, { "content-type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }));
                        return;
                    }
                    
                    res.writeHead(200, { "content-type": "application/json" });
                    res.end(JSON.stringify({ ok: true, value: result }));
                } catch (err) {
                    res.writeHead(500, { "content-type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err.message }));
                }
            }
        });
        console.log(`${TAG} 🌐 HTTP路由已注册: /bg-search/*`);
    }
}