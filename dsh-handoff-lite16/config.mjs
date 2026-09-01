// DSH Handoff Lite 默认配置
// 轻量交接文档管理器 - 手动维护，自动创建和重命名同步

export const defaultConfig = {
  // 目录配置
  workbenchRoot: "记忆",                    // 工作台根目录（相对路径）
  handoffPrefix: "（交接）",                 // 交接文档文件名前缀
  
  // 模板配置
  templateVersion: "v3",                    // 模板版本
  maxRecentTurns: 20,                       // 最大记录轮次
  
  // 功能开关
  autoCreateOnSession: true,                // 会话创建时自动创建初始交接文档
  syncOnRename: true,                       // 会话重命名时同步交接文档
  requireManualUpdate: true,                // 需要AI手动调用write_handoff更新（不自动注入）
  ignoreSubagents: true,                    // 子代理会话（裸UUID，无 session- 前缀）不建档不改名
  
  // 交接文档模板 (v3 五节结构)
  template: `# 会话交接文档 v3 - {title}

> 更新时间: {timestamp}  |  会话ID: {sessionId}

---

## 一、会话信息

| 字段 | 值 |
|------|-----|
| 会话标题 | {title} |
| 会话ID | {sessionId} |
| 创建时间 | {createdAt} |
| 最后更新 | {timestamp} |
| 总轮次 | {turnCount} |
| 状态 | 🔄 进行中 |

---

## 二、会话概要

### ✅ 已完成事项
{completedTasks}

### 🔄 进行中事项
{inProgressTasks}

---

## 三、已完成事项

{completedDetails}

---

## 四、未完成/待处理事项

### 核心需求
{coreRequirements}

### 约束条件
{constraints}

### 关键决策
{keyDecisions}

---

## 五、下一步指令（新对话接续用）

### 最近对话摘要
{recentSummary}

### 下一步操作
{nextSteps}

### 上下文摘要
{contextSummary}

---
*由 dsh-handoff-lite 自动生成 | {timestamp}*
`,

  // 默认规则（会记录到交接文档）
  defaultRules: [
    "【项目管理】严格执行按 GIT（已安装）结构管理根项目，保持工作树整洁。",
    "【用户确认】所有需要用户确定的内容，一律以弹窗形式询问。",
    "【会话同步】前端和后端的名字始终保持一致。路径：记忆/{前端名字}/（交接）{前端名字}.md",
    "【交接文档】每回合对话实录需记录到交接文档。",
    "【交接格式】交接文档采用 v3 模板，固定五节结构。"
  ]
}

export default defaultConfig
