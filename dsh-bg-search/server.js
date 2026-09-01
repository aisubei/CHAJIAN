/**
 * DSH后台搜索插件 - Web UI服务器
 * 
 * 提供简单的Web界面来控制插件
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAG = '[dsh-bg-search-server]';
const PORT = 8888;

// 模拟的插件状态
let pluginState = {
    edgeConnected: false,
    silentMode: true,
    searchInProgress: false,
    lastSearch: null
};

/**
 * 创建Web服务器
 */
function createWebServer() {
    const server = createServer((req, res) => {
        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // 路由处理
        if (req.url === '/' || req.url === '/index.html') {
            // 返回UI页面
            const uiPath = join(__dirname, 'ui.html');
            if (existsSync(uiPath)) {
                const content = readFileSync(uiPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('UI页面未找到');
            }
        } else if (req.url === '/api/status') {
            // 返回插件状态
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(pluginState));
        } else if (req.url === '/api/start-edge' && req.method === 'POST') {
            // 启动Edge
            console.log(`${TAG} 启动Edge...`);
            pluginState.edgeConnected = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Edge已启动' }));
        } else if (req.url === '/api/toggle-silent' && req.method === 'POST') {
            // 切换静默模式
            pluginState.silentMode = !pluginState.silentMode;
            console.log(`${TAG} 静默模式: ${pluginState.silentMode ? '开启' : '关闭'}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                silentMode: pluginState.silentMode,
                message: `静默模式已${pluginState.silentMode ? '开启' : '关闭'}`
            }));
        } else if (req.url === '/api/search' && req.method === 'POST') {
            // 执行搜索
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const { query, source } = data;
                    
                    console.log(`${TAG} 执行搜索: ${query} (${source})`);
                    
                    pluginState.searchInProgress = true;
                    pluginState.lastSearch = { query, source, time: new Date() };
                    
                    // 模拟搜索执行
                    setTimeout(() => {
                        pluginState.searchInProgress = false;
                        console.log(`${TAG} 搜索完成`);
                    }, 2000);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: `搜索已启动: ${query}`,
                        searchId: Date.now()
                    }));
                    
                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: error.message }));
                }
            });
        } else {
            // 404
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('页面未找到');
        }
    });
    
    return server;
}

/**
 * 启动服务器
 */
function startServer() {
    console.log(`${TAG} 🚀 启动Web UI服务器...`);
    
    const server = createWebServer();
    
    server.listen(PORT, '127.0.0.1', () => {
        console.log(`${TAG} ✅ Web UI服务器已启动`);
        console.log(`${TAG} 🌐 访问地址: http://127.0.0.1:${PORT}`);
        console.log(`${TAG} 📱 可以在浏览器中打开控制面板`);
    });
    
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`${TAG} ❌ 端口 ${PORT} 已被占用`);
            console.log(`${TAG} 💡 请关闭占用端口 ${PORT} 的程序，或修改端口号`);
        } else {
            console.error(`${TAG} ❌ 服务器启动失败:`, error.message);
        }
    });
}

// 启动服务器
startServer();