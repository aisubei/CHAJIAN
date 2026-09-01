// DSH Handoff Lite — 轻量交接文档管理器 v2.2
// 工具：write_handoff / read_handoff（跟随会话工作区落盘）
// 防串档：文档目录名 = {标题}-{会话ID前3位}（剥离 session- 前缀），
//   同名会话各占各家；改名同步时后缀不变，身份稳定。
// 自动化：session/created + flush 观察器 → 首见标题建骨架、标题变化安全改名；
//   发现同名无后缀的遗留文档且无冲突时自动收编。
// 命令家族（全拼，v2.5.0）：交接(/jiaojie)、看(/kan)、定位(/dingwei)、列表(/liebiao)。
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from './config.mjs';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TAG = '[dsh-handoff-lite]';

function sanitizeTitle(raw) {
  let t = String(raw ?? '').trim();
  t = t.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/\s+/g, ' ').slice(0, 80).trim();
  return t || '未命名会话';
}

/** 会话短 ID：剥掉 session- 前缀取前 3 位，作防重名后缀 */
function id3(sessionId) {
  const s = String(sessionId ?? '').replace(/^session-/, '');
  return /^[A-Za-z0-9_-]{3}$/.test(s.slice(0, 3)) ? s.slice(0, 3) : '';
}

function nowStamp() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{([a-zA-Z]+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : '');
}

/** 按中文章节切分 v3 文档 */
function splitSections(doc) {
  const map = { full: doc };
  const re = /^## ([一二三四五])、.*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(doc)) !== null) marks.push({ sec: m[1], start: m.index, end: re.lastIndex });
  const keyOf = { 一: 'info', 二: 'summary', 三: 'details', 四: 'pending', 五: 'next' };
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : doc.length;
    map[keyOf[marks[i].sec]] = doc.slice(marks[i].start, end).trim();
  }
  return map;
}

function resolveBase(config, cwd) {
  const base = (typeof cwd === 'string' && cwd.length > 0)
    ? cwd
    : (process.env.DSH_HOME ? path.dirname(process.env.DSH_HOME) : process.cwd());
  return path.isAbsolute(config.workbenchRoot)
    ? config.workbenchRoot
    : path.resolve(base, config.workbenchRoot);
}

/** 工具路径：从执行上下文解析记忆根目录 */
function resolveRoot(config, exec) {
  return resolveBase(config, exec?.agent?.session?.header?.cwd ?? exec?.agent?.session?.cwd);
}

/** 事件路径：从会话对象解析记忆根目录 */
function rootFromSession(config, session) {
  return resolveBase(config, session?.header?.cwd ?? session?.cwd);
}

/** 折叠会话日志里最新的标题（落盘结构 e.data.title，兼容 e.title） */
function foldTitle(session) {
  const logArr = Array.isArray(session?.log) ? session.log : [];
  for (let i = logArr.length - 1; i >= 0; i--) {
    const e = logArr[i];
    if (e && e.type === 'session/title') {
      const t = e.data?.title ?? e.title;
      if (t) return String(t);
    }
  }
  return '';
}

class HandoffStore {
  constructor(config) {
    this.cfg = config;
  }

  /** 物理文档名：{标题}-{id3}（id3 缺省时退化为纯标题；标题已带同后缀则先剥掉，保证幂等） */
  docKey(title, sid) {
    const sfx = id3(sid);
    let t = sanitizeTitle(title);
    if (sfx && t.toLowerCase().endsWith(`-${sfx.toLowerCase()}`)) t = t.slice(0, -(sfx.length + 1)).trimEnd();
    return sfx ? `${t}-${sfx}` : t;
  }

  docPaths(root, key) {
    return { key, dir: path.join(root, key), file: path.join(root, key, `${this.cfg.handoffPrefix}${key}.md`) };
  }

  rel(root, file) {
    return path.relative(root, file).split(path.sep).join('/');
  }

  async exists(p) {
    try { await fsp.access(p); return true; } catch { return false; }
  }

  async list(root) {
    let names = [];
    try { names = await fsp.readdir(root); } catch { return []; }
    const out = [];
    for (const name of names) {
      const { file } = this.docPaths(root, name);
      try {
        const st = await fsp.stat(file);
        out.push({
          title: name,
          relPath: this.rel(root, file),
          updatedAt: st.mtime.toLocaleString('zh-CN', { hour12: false }),
          sizeBytes: st.size
        });
      } catch { /* 目录无交接文档，跳过 */ }
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  stampDoc(doc, ts) {
    return doc.replace(/> 更新时间:.*/u, `> 更新时间: ${ts}`);
  }

  /** 刷新会话信息表中的 ID 与最后更新字段 */
  async stampInfoTable(file, sid, ts) {
    try {
      const doc = await fsp.readFile(file, 'utf8');
      const patched = doc
        .replace(/\|\s*会话ID\s*\|[^|]*\|/, `| 会话ID | ${sid || '-'} |`)
        .replace(/\|\s*最后更新\s*\|[^|]*\|/, `| 最后更新 | ${ts} |`)
        .replace(/^>\s*更新时间:.*/m, `> 更新时间: ${ts}`);
      if (patched !== doc) await fsp.writeFile(file, patched, 'utf8');
    } catch { /* 信息表刷新失败不影响建档 */ }
  }

  /**
   * 确保骨架存在：
   * 1) 目标 {标题}-{id3} 已存在 → 仅刷新信息表
   * 2) 无后缀的同名遗留目录存在且目标不存在 → 收编（整目录改名）
   * 3) 都没有 → 新建骨架
   */
  async ensureSkeleton(root, rawTitle, sid) {
    const ts = nowStamp();
    const key = this.docKey(rawTitle, sid);
    const dst = this.docPaths(root, key);
    if (!(await this.exists(dst.file))) {
      const legacy = this.docPaths(root, sanitizeTitle(rawTitle));
      if (id3(sid) && (await this.exists(legacy.dir))) {
        try {
          await fsp.rename(legacy.dir, dst.dir);
          console.log(`${TAG} 收编遗留 ← ${this.rel(root, dst.dir)}`);
        } catch { /* 收编失败则走新建 */ }
      }
    }
    if (!(await this.exists(dst.file))) {
      const doc = fillTemplate(this.cfg.template, {
        title: key, sessionId: sid || '-', createdAt: ts, timestamp: ts, turnCount: 0
      });
      await fsp.mkdir(dst.dir, { recursive: true });
      await fsp.writeFile(dst.file, doc.endsWith('\n') ? doc : `${doc}\n`, 'utf8');
      console.log(`${TAG} 自动建档 ← ${this.rel(root, dst.file)}`);
    }
    await this.stampInfoTable(dst.file, sid, ts);
    return { created: true, key, path: dst.file };
  }

  /** 标题变化：同后缀整体迁移（目标已存在则跳过，防冲突） */
  async rename(root, oldTitle, newTitle, sid) {
    const src = this.docPaths(root, this.docKey(oldTitle, sid));
    const dst = this.docPaths(root, this.docKey(newTitle, sid));
    if (!(await this.exists(src.dir))) return { renamed: false, reason: '源不存在' };
    if (await this.exists(dst.dir)) return { renamed: false, reason: '目标已存在，跳过防冲突' };
    await fsp.rename(src.dir, dst.dir);
    const movedFile = path.join(dst.dir, path.basename(src.file));
    if ((await this.exists(movedFile)) && movedFile.toLowerCase() !== dst.file.toLowerCase()) {
      await fsp.rename(movedFile, dst.file);
    }
    try {
      const doc = await fsp.readFile(dst.file, 'utf8');
      const patched = doc
        .replace(/^#\s*会话交接文档.*$/m, `# 会话交接文档 ${this.cfg.templateVersion || 'v3'} - ${dst.key}`)
        .replace(/\|\s*会话标题\s*\|[^|]*\|/, `| 会话标题 | ${dst.key} |`)
        .replace(/^>\s*更新时间:.*/m, `> 更新时间: ${nowStamp()}`);
      await fsp.writeFile(dst.file, patched, 'utf8');
    } catch { /* 内容刷新失败不影响改名 */ }
    console.log(`${TAG} 改名同步 ← 「${src.key}」→「${dst.key}」`);
    return { renamed: true, to: dst.file };
  }

  /** 解析读取目标：支持完整键名 / 本会话自动补全 / 唯一前缀匹配 */
  async resolveReadTarget(root, rawTitle, sid) {
    const want = sanitizeTitle(rawTitle);
    const direct = this.docPaths(root, want);
    if (await this.exists(direct.file)) return direct;
    const mine = this.docPaths(root, this.docKey(rawTitle, sid));
    if (id3(sid) && (await this.exists(mine.file))) return mine;
    const items = await this.list(root);
    const hits = items.filter(i => i.title === want || i.title.startsWith(`${want}-`));
    if (hits.length === 1) return this.docPaths(root, hits[0].title);
    if (hits.length > 1) return { ambiguous: hits.map(h => h.title) };
    return null;
  }

  /** 一会话一档：按 ID 后缀找本会话现有文档键（list 已按时间倒序，取最新；无则 null） */
  async findKeyBySid(root, sid) {
    const sfx = id3(sid);
    if (!sfx) return null;
    const items = await this.list(root);
    const mine = items.filter(i => i.title.toLowerCase().endsWith(`-${sfx.toLowerCase()}`));
    return mine.length ? mine[0].title : null;
  }

  /** 写入/创建交接文档（一会话一档：会话已有档时旧标题/别名一律归位，防影子文档与跨档误写） */
  async write(root, args, sid) {
    let key = this.docKey(args.title, sid);
    const mineKey = await this.findKeyBySid(root, sid);
    const origKey = key;
    if (mineKey && mineKey !== key) {
      console.log(`${TAG} write 归位 ← 「${key}」→「${mineKey}」（一会话一档）`);
      key = mineKey;
    }
    const { dir, file } = this.docPaths(root, key);
    await fsp.mkdir(dir, { recursive: true });
    const have = await this.exists(file);
    const ts = nowStamp();
    const turnCount = Number.isFinite(args.turnCount) ? Math.trunc(args.turnCount) : null;
    const content = String(args.content ?? '');

    if (!have) {
      const tpl = fillTemplate(this.cfg.template, {
        title: key, sessionId: sid || '-', createdAt: ts, timestamp: ts, turnCount: turnCount ?? 0
      });
      let doc;
      if (/^\s*#\s*会话交接文档|## 五、/.test(content)) {
        doc = this.stampDoc(content, ts);
      } else {
        doc = tpl.replace(/^---\r?\n\r?\n## 二、会话概要([\s\S]*)$/m,
          `---\n\n${content.trim()}\n\n---\n\n## 二、会话概要$1`);
      }
      await fsp.writeFile(file, doc.endsWith('\n') ? doc : `${doc}\n`, 'utf8');
      const tw = origKey !== key ? { titleWarning: `title「${args.title}」已忽略，绑定目标为「${key}」` } : {};
      return { created: true, docKey: key, path: file, relPath: this.rel(root, file), bytes: (await fsp.stat(file)).size, updatedAt: ts, ...tw };
    }

    const old = await fsp.readFile(file, 'utf8');
    // P0-1: 覆盖即销毁三律·第二律——先留副本
    try { await fsp.writeFile(file + '.bak', old, 'utf8'); } catch { /* 备份失败不阻塞主流程 */ }
    let doc;
    if (args.section === 'append') {
      doc = `${old.replace(/\s*$/, '')}\n\n### 追加 · ${ts}\n\n${content.trim()}\n`;
    } else if (/^\s*#\s*会话交接文档|## 五、/.test(content)) {
      doc = this.stampDoc(content, ts);
    } else {
      const cut = old.search(/^---\r?\n\r?\n## 二、会话概要/m);
      const head = cut > 0 ? old.slice(0, cut) : `# 会话交接文档 v3 - ${key}\n\n> 更新时间: ${ts}\n\n---\n`;
      doc = head.replace(/> 更新时间:.*/, `> 更新时间: ${ts}`)
        + (head.includes('---') ? '' : '\n---\n')
        + `\n${content.trim()}\n`;
      if (turnCount !== null) doc = doc.replace(/\|\s*总轮次\s*\|.*/, `| 总轮次 | ${turnCount} |`);
      doc = doc.replace(/\|\s*最后更新\s*\|.*/, `| 最后更新 | ${ts} |`);
    }
    await fsp.writeFile(file, doc.endsWith('\n') ? doc : `${doc}\n`, 'utf8');
    const tw2 = origKey !== key ? { titleWarning: `title「${args.title}」已忽略，绑定目标为「${key}」` } : {};
    return { created: false, docKey: key, path: file, relPath: this.rel(root, file), bytes: (await fsp.stat(file)).size, overwrittenBytes: old.length, updatedAt: ts, ...tw2 };
  }

  /** 定位文档内容：按章节名（一~五/info/summary/details/pending/next 及中文别名）或关键词检索 */
  async locate(root, key, rawQuery) {
    const { file } = this.docPaths(root, key);
    if (!(await this.exists(file))) {
      const items = await this.list(root);
      return { found: false, error: `未找到「${key}」的交接文档`, available: items.map(i => i.title) };
    }
    const q = String(rawQuery ?? '').trim();
    if (!q) return { found: false, usage: 'query 传章节名（一~五 / info/summary/details/pending/next / 待处理 等）或关键词' };
    const doc = await fsp.readFile(file, 'utf8');

    // —— 章节模式
    const aliasOf = {
      '一': 'info', '1': 'info', 'info': 'info',
      '二': 'summary', '2': 'summary', 'summary': 'summary', '概要': 'summary',
      '三': 'details', '3': 'details', 'details': 'details', '已完成': 'details',
      '四': 'pending', '4': 'pending', 'pending': 'pending', '待处理': 'pending',
      '五': 'next', '5': 'next', 'next': 'next', '下一步': 'next'
    };
    const secKey = aliasOf[q.toLowerCase()];
    if (secKey) {
      const secs = splitSections(doc);
      const zh = { info: '一', summary: '二', details: '三', pending: '四', next: '五' }[secKey];
      const lines = doc.split(/\r?\n/);
      const idx = lines.findIndex(l => new RegExp(`^## ${zh}、`).test(l));
      return {
        found: true, docKey: key, mode: 'section', section: secKey,
        fromLine: idx >= 0 ? idx + 1 : 1,
        content: secs[secKey] ?? '(该节为空)',
        path: file
      };
    }

    // —— 关键词模式：逐行不区分大小写扫描，标注所在章节
    const needle = q.toLowerCase();
    const zhOf = { info: '一、会话信息', summary: '二、会话概要', details: '三、已完成', pending: '四、待处理', next: '五、下一步指令' };
    const keyOfZh = { '一': 'info', '二': 'summary', '三': 'details', '四': 'pending', '五': 'next' };
    const lines = doc.split(/\r?\n/);
    let curSec = '(导语)';
    let total = 0;
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const sm = /^## ([一二三四五])、/.exec(lines[i]);
      if (sm) curSec = zhOf[keyOfZh[sm[1]]];
      if (lines[i].toLowerCase().includes(needle)) {
        total++;
        if (hits.length < 20) hits.push({ line: i + 1, section: curSec, text: lines[i].trim().slice(0, 120) });
      }
    }
    return {
      found: total > 0, docKey: key, mode: 'keyword', query: q, total, hits,
      hint: hits.length < total ? `仅显示前 ${hits.length} 条` : undefined,
      path: file
    };
  }

  /** 读取指定文档或列出全部 */
  async read(root, args, sid) {
    const wantSection = args.section || 'full';
    if (!args.title) {
      const items = await this.list(root);
      return {
        found: items.length > 0,
        root,
        listing: items,
        hint: items.length ? '传 title 读取指定文档（支持纯标题，本会话优先）' : '当前工作区尚无交接文档，可用 write_handoff 创建'
      };
    }
    const target = await this.resolveReadTarget(root, args.title, sid);
    if (!target) {
      const items = await this.list(root);
      return { found: false, error: `未找到「${sanitizeTitle(args.title)}」的交接文档`, available: items.map(i => i.title) };
    }
    if (target.ambiguous) {
      return { found: false, error: '多个同名候选，请用带后缀的完整名称指定', candidates: target.ambiguous };
    }
    const doc = await fsp.readFile(target.file, 'utf8');
    if (wantSection === 'full') return { found: true, docKey: target.key, path: target.file, relPath: this.rel(root, target.file), content: doc };
    const secs = splitSections(doc);
    return { found: true, docKey: target.key, path: target.file, relPath: this.rel(root, target.file), section: wantSection, content: secs[wantSection] ?? '(该节为空)' };
  }
}

export const name = 'dsh-handoff-lite';
export const version = '2.6.0';
export const description = '轻量交接文档管理器：write/read 工具 + 自动建档/改名同步 + 命令家族（更新/读取/定位/列表）；一会话一档防影子；子代理免建档';
export const inject = ['tools', 'commands'];

export function apply(ctx, config) {
  const cfg = { ...defaultConfig, ...(config || {}) };
  const store = new HandoffStore(cfg);

  // —— 工具 1：write_handoff（锁定调用会话自己的文档）
  ctx.tools.register(defineTool({
    name: 'write_handoff',
    description: '写入/更新【当前会话】的交接文档（落在会话工作区的 记忆/{标题}-{会话ID前3位}/ 下，v3 五节模板）。任务阶段性完成、或用户要求沉淀交接时调用。title 传纯标题即可，工具自动绑定本会话。',
    parameters: {
      content: { type: 'string', required: true, description: 'Markdown 正文。给完整 v3 内容则整篇写入；只给正文段落则嵌入骨架' },
      title: { type: 'string', description: '会话标题；缺省=自动取当前会话标题' },
      section: { type: 'string', enum: ['full', 'append'], description: 'full=替换正文（默认）；append=追加为新的“追加”小节' },
      turnCount: { type: 'number', description: '当前总轮次，写入会话信息表' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          created: { type: 'boolean', required: true },
          docKey: { type: 'string' },
          path: { type: 'string', required: true },
          relPath: { type: 'string' },
          updatedAt: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    execute: async (rawArgs, exec) => {
      const args = rawArgs || {};
      const session = exec?.agent?.session;
      const root = resolveRoot(cfg, exec);
      const title = args.title || foldTitle(session) || '未命名会话';
      console.log(`${TAG} write ← ${root} 键=${store.docKey(title, session?.id)}`);
      return store.write(root, { ...args, title }, session?.id);
    }
  }));

  // —— 工具 2：read_handoff（本会话优先，防串读）
  ctx.tools.register(defineTool({
    name: 'read_handoff',
    description: '读取当前工作区的交接文档以接续历史上下文。不带 title 时列出本工作区全部交接文档；带纯标题时优先命中当前会话自己的文档，多候选时会提示消歧。',
    parameters: {
      title: { type: 'string', description: '要读取的会话标题或完整键名；缺省=列出本工作区全部' },
      section: { type: 'string', enum: ['full', 'info', 'summary', 'details', 'pending', 'next'], description: 'full=全文（默认）；info=会话信息；summary=概要；details=已完成；pending=待处理；next=下一步指令' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          found: { type: 'boolean', required: true },
          docKey: { type: 'string' },
          path: { type: 'string' },
          relPath: { type: 'string' },
          section: { type: 'string' },
          content: { type: 'string' },
          listing: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string' }
        }
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    execute: async (rawArgs, exec) => {
      const args = rawArgs || {};
      const session = exec?.agent?.session;
      const root = resolveRoot(cfg, exec);
      console.log(`${TAG} read ← ${root}`);
      return store.read(root, args, session?.id);
    }
  }));

  // —— 心跳诊断日志（记录到插件目录下的 logs 目录）
  const diagDir = path.join(__dirname, 'logs');
  function diag(msg) {
    if (!diagDir) return;
    try {
      fsp.mkdir(diagDir, { recursive: true })
        .then(() => fsp.appendFile(path.join(diagDir, 'observer.log'),
          `${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}\n`, 'utf8'))
        .catch(() => {});
    } catch { /* 诊断失败不影响主流程 */ }
  }

  // —— 会话观察器：自动建档 + 改名同步（后缀身份稳定）
  const seen = new Map(); // sessionId -> 已同步标题
  const bus = ctx.events && typeof ctx.events.on === 'function' ? ctx.events : null;

  async function observe(session, kind) {
    try {
      if (!session || typeof session !== 'object' || typeof session.id !== 'string') return;
      if (cfg.ignoreSubagents && !session.id.startsWith('session-')) return; // 子代理（裸UUID）不建档不改名
      const root = rootFromSession(cfg, session);
      if (!root) return;
      const title = foldTitle(session);
      diag(`[${kind}] ${session.id} root=${root} title=${title ? `「${title}」` : '(未生成)'}`);
      if (!title) return;
      const prev = seen.get(session.id);
      if (prev === title) return;
      if (prev && cfg.syncOnRename !== false) {
        const r = await store.rename(root, prev, title, session.id);
        diag(`  → 改名 ${JSON.stringify(r)}`);
      } else if (!prev && cfg.autoCreateOnSession !== false) {
        const r = await store.ensureSkeleton(root, title, session.id);
        diag(`  → 建档: ${JSON.stringify(r)}`);
      }
      seen.set(session.id, title);
    } catch (e) {
      diag(`[${kind}] 异常: ${e?.message ?? e}`);
      console.warn(`${TAG} 会话观察异常(${kind}): ${e?.message ?? e}`);
    }
  }

  if (!bus) {
    diag('events 总线不可达，观察器停用');
    console.warn(`${TAG} events 总线不可达，自动建档停用（两工具不受影响）`);
  } else {
    for (const ev of ['session/created', 'session/flush']) {
      try {
        bus.on(ev, (...a) => {
          const s = a.find(x => x && typeof x === 'object' && typeof x.id === 'string') ?? a[0];
          void observe(s, ev);
        });
        diag(`已订阅 ${ev}`);
      } catch (e) {
        diag(`订阅 ${ev} 失败: ${e?.message ?? e}`);
      }
    }
    console.log(`${TAG} 会话观察器已挂载：session/created + session/flush`);
  }

  // —— 前端命令：/jiaojie [更新]
  if (ctx.commands && typeof ctx.commands.register === 'function') {
    const handoffHandler = async (invocation) => {
      try {
        const session = invocation?.agent?.session;
        if (!session) return { kind: 'error', text: '找不到当前会话上下文' };
        const sub = String(invocation.rawInput ?? '').trim().toLowerCase();
        if (sub && !['更新', 'update'].includes(sub)) {
          return { kind: 'error', text: '用法：/jiaojie 或 /jiaojie 更新（确保本文档存在并唤醒 AI 实质更新）' };
        }
        const root = rootFromSession(cfg, session);
        if (!root) return { kind: 'error', text: '当前会话没有工作区信息，无法定位 记忆 目录' };
        const title = foldTitle(session);
        if (!title) return { kind: 'error', text: '会话标题尚未生成，稍等几秒再试' };
        const res = await store.ensureSkeleton(root, title, session.id);
        const agent = invocation?.agent;
        if (!agent || typeof agent.followup !== 'function') {
          return { kind: 'success', text: `交接文档已就绪：${res.path}\n（当前无活跃 agent 可唤醒，仅完成建档）` };
        }
        agent.followup(createUserMessage({
          content: [{ type: 'text', text:
            '【/jiaojie 交接更新】用户请求立即对本会话交接文档做实质性更新。请执行：' +
            '1) 用 read_handoff 查看本文档现状；' +
            '2) 按 v3 五节模板用 write_handoff 写入实质内容——一、会话信息；二、会话概要；三、已完成（本会话关键成果）；四、待处理（未竟与阻塞）；五、下一步指令（接续者最需要的一句话）。' +
            '禁止交空壳文档；完成后用一两句话向我汇报更新要点。' }],
          source: { kind: 'plugin', plugin: 'dsh-handoff-lite' }
        }));
        return {
          kind: 'success',
          text: `已唤醒 AI 执行交接更新：${res.path}\n稍候它的汇报即可。`
        };
      } catch (e) {
        return { kind: 'error', text: `/jiaojie 失败：${e?.message ?? e}` };
      }
    };
    // 读取：全文输出（超4000字截断提示）
    const readHandler = async (invocation) => {
      try {
        const session = invocation?.agent?.session;
        if (!session) return { kind: 'error', text: '找不到当前会话上下文' };
        const root = rootFromSession(cfg, session);
        if (!root) return { kind: 'error', text: '当前会话没有工作区信息，无法定位 记忆 目录' };
        const titleArg = String(invocation.rawInput ?? '').trim() || foldTitle(session);
        if (!titleArg) return { kind: 'error', text: '会话标题尚未生成，稍等几秒再试，或用 /kan 标题 指定要读的文档' };
        const res = await store.read(root, { title: titleArg }, session.id);
        if (!res.found) return { kind: 'error', text: `${res.error}\n现有：${(res.available ?? []).join('、') || '（无）'}` };
        let out = res.content ?? '';
        if (out.length > 4000) out = `${out.slice(0, 4000)}\n…（已截断，共 ${res.content.length} 字符，全文见 ${res.relPath}）`;
        return { kind: 'success', text: `📄 ${res.docKey}${res.section ? ` · ${res.section}` : ' · 全文'}\n${out}` };
      } catch (e) {
        return { kind: 'error', text: `/kan 失败：${e?.message ?? e}` };
      }
    };

    // 定位：章节名或关键词，锁定本会话文档
    const locateHandler = async (invocation) => {
      try {
        const session = invocation?.agent?.session;
        if (!session) return { kind: 'error', text: '找不到当前会话上下文' };
        const root = rootFromSession(cfg, session);
        if (!root) return { kind: 'error', text: '当前会话没有工作区信息' };
        const q = String(invocation.rawInput ?? '').trim();
        if (!q) return { kind: 'error', text: '用法：/dingwei 章节名|关键词（如 /dingwei 待处理、/dingwei BOM、/dingwei 五）' };
        const title = foldTitle(session);
        if (!title) return { kind: 'error', text: '会话标题尚未生成，稍等几秒再试' };
        const r = await store.locate(root, store.docKey(title, session.id), q);
        if (!r.found && r.error) return { kind: 'error', text: `${r.error}\n现有：${(r.available ?? []).join('、') || '（无）'}` };
        if (!r.found && r.usage) return { kind: 'error', text: r.usage };
        if (r.mode === 'section') {
          return { kind: 'success', text: `🎯 ${r.docKey} · 章节「${q}」（第 ${r.fromLine} 行起）\n${r.content}` };
        }
        if (!r.total) return { kind: 'success', text: `「${q}」在 ${r.docKey} 中无命中` };
        const body = r.hits.map(h => `L${h.line} [${h.section}] ${h.text}`).join('\n');
        return { kind: 'success', text: `🎯 「${q}」在 ${r.docKey} 命中 ${r.total} 处（${r.hint ?? '全部显示'}）：\n${body}` };
      } catch (e) {
        return { kind: 'error', text: `/dingwei 失败：${e?.message ?? e}` };
      }
    };

    // 列表：本工作区全部交接文档
    const listHandler = async (invocation) => {
      try {
        const session = invocation?.agent?.session;
        if (!session) return { kind: 'error', text: '找不到当前会话上下文' };
        const root = rootFromSession(cfg, session);
        if (!root) return { kind: 'error', text: '当前会话没有工作区信息' };
        const items = await store.list(root);
        if (!items.length) return { kind: 'success', text: `📭 ${root} 下尚无交接文档（AI 写一条即自动建档）` };
        const rows = items.map((it, i) => `${i + 1}. ${it.title}　· ${it.updatedAt} · ${(it.sizeBytes / 1024).toFixed(1)}KB`).join('\n');
        return { kind: 'success', text: `📚 ${root} 共 ${items.length} 篇：\n${rows}` };
      } catch (e) {
        return { kind: 'error', text: `/liebiao 失败：${e?.message ?? e}` };
      }
    };

    const groups = [
      { names: ['jiaojie'], description: '交接：确保本会话交接文档存在并唤醒 AI 做实质性更新', input: '更新（可省略）', handler: handoffHandler },
      { names: ['kan'], description: '看：读取交接文档（缺省读本会话；可传标题读别篇）', input: '[标题]', handler: readHandler },
      { names: ['dingwei'], description: '定位：在本会话交接文档中定位章节或关键词', input: '章节名|关键词', handler: locateHandler },
      { names: ['liebiao'], description: '列表：列出本工作区全部交接文档', input: '无需参数', handler: listHandler }
    ];
    for (const g of groups) {
      for (const cmdName of g.names) {
        try {
          ctx.commands.register({
            name: cmdName,
            description: g.description,
            input: { hint: g.input },
            handler: g.handler
          });
          diag(`已注册命令 /${cmdName}`);
          console.log(`${TAG} 命令 /${cmdName} 已注册`);
        } catch (e) {
          diag(`注册命令 /${cmdName} 失败: ${e?.message ?? e}`);
        }
      }
    }
  } else {
    diag('commands 服务不可达，命令家族未注册（两工具与观察器不受影响）');
    console.warn(`${TAG} commands 服务不可达，命令家族未注册`);
  }

  console.log(`${TAG} v${version} 就绪：write/read 工具 + 观察器 + 命令家族 /jiaojie /kan /dingwei /liebiao（ID后缀防串档）`);
}
