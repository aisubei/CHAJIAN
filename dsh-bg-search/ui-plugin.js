/**
 * DSH后台搜索插件 - UI组件
 * 
 * 在DSH Desktop中显示控制面板
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAG = '[dsh-bg-search-ui]';

// 配置文件路径
const CONFIG_FILE = join(__dirname, 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
    silentMode: true,
    lastSearch: null,
    searchHistory: []
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
 * 生成控制面板HTML
 */
function generateControlPanel(config) {
    return `
<div style="font-family: 'Segoe UI', sans-serif; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 15px; color: white;">
    <h2 style="margin-bottom: 20px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">🔍 DSH后台搜索控制面板</h2>
    
    <!-- 状态卡片 -->
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin-bottom: 15px;">
        <h3 style="margin-bottom: 10px;">📊 系统状态</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
            <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                <div style="font-size: 0.9em; opacity: 0.8;">Edge连接</div>
                <div style="font-size: 1.2em; font-weight: bold;">✅ 已连接</div>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                <div style="font-size: 0.9em; opacity: 0.8;">静默模式</div>
                <div style="font-size: 1.2em; font-weight: bold;">${config.silentMode ? '✅ 开启' : '❌ 关闭'}</div>
            </div>
        </div>
    </div>
    
    <!-- 快捷操作 -->
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin-bottom: 15px;">
        <h3 style="margin-bottom: 10px;">⚡ 快捷操作</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            <button onclick="bg_search_status()" style="padding: 10px 20px; border: none; border-radius: 8px; background: #28a745; color: white; cursor: pointer; font-size: 1em;">🔄 检查状态</button>
            <button onclick="bg_search_config({silentMode: ${!config.silentMode}})" style="padding: 10px 20px; border: none; border-radius: 8px; background: #ffc107; color: white; cursor: pointer; font-size: 1em;">⚙️ ${config.silentMode ? '关闭静默' : '开启静默'}</button>
            <button onclick="bg_search({query: '测试搜索', source: 'both'})" style="padding: 10px 20px; border: none; border-radius: 8px; background: #17a2b8; color: white; cursor: pointer; font-size: 1em;">🔍 测试搜索</button>
        </div>
    </div>
    
    <!-- 使用说明 -->
    <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px;">
        <h3 style="margin-bottom: 10px;">💡 使用说明</h3>
        <ol style="padding-left: 20px; line-height: 1.8;">
            <li><strong>首次使用</strong>：点击"关闭静默"按钮</li>
            <li><strong>登录</strong>：在弹出的Edge窗口中登录DeepSeek和豆包</li>
            <li><strong>正常使用</strong>：登录后开启静默模式，即可后台搜索</li>
        </ol>
    </div>
</div>
`;
}

/**
 * 生成快捷命令菜单
 */
function generateQuickCommands() {
    return `
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
}

/**
 * DSH后台搜索UI插件
 */
export const inject = ['tools'];

export const description = 'DSH后台搜索插件：提供控制面板和快捷命令';

/**
 * 插件主函数
 */
export function apply(ctx, config) {
    console.log(`${TAG} 🚀 DSH后台搜索UI插件加载中...`);
    
    // 加载配置
    const pluginConfig = loadConfig();
    
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
                // 返回控制面板HTML
                return [{
                    type: 'text',
                    text: value.message
                }];
            }
        },
        execute: async () => {
            console.log(`${TAG} 显示控制面板`);
            
            // 重新加载配置
            const currentConfig = loadConfig();
            
            // 生成控制面板
            const panelHtml = generateControlPanel(currentConfig);
            
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
            
            const helpText = generateQuickCommands();
            
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
            
            const currentConfig = loadConfig();
            let message = '';
            
            switch (action) {
                case 'login':
                    // 登录模式：关闭静默
                    currentConfig.silentMode = false;
                    saveConfig(currentConfig);
                    message = `✅ 已切换到登录模式\n\n静默模式已关闭，下次启动Edge时将显示窗口。\n\n请执行 \`bg_search_status\` 启动Edge，然后在窗口中登录。`;
                    break;
                    
                case 'normal':
                    // 正常模式：开启静默
                    currentConfig.silentMode = true;
                    saveConfig(currentConfig);
                    message = `✅ 已切换到正常模式\n\n静默模式已开启，Edge将在后台静默运行。`;
                    break;
                    
                case 'status':
                    // 查看状态
                    message = `📊 当前配置状态\n\n静默模式: ${currentConfig.silentMode ? '✅ 开启' : '❌ 关闭'}\n上次搜索: ${currentConfig.lastSearch || '无'}\n搜索历史: ${currentConfig.searchHistory.length} 条`;
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
    
    console.log(`${TAG} ✅ DSH后台搜索UI插件已加载`);
    console.log(`${TAG} 📦 可用工具: bg_search_panel, bg_search_help, bg_search_quick_config`);
    console.log(`${TAG} 💡 提示: 使用 bg_search_panel 显示控制面板`);
}