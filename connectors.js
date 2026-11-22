// Zbot 全屏「连接应用 (Connect Apps)」中心
// 优先支持全球主流开放接口与标准 MCP（无需厂商合作，用户自有 Token / MCP 端点即插即用）：
// 1) 官方直连 API / Webhook / MCP 应用（Notion / Obsidian / Google Workspace / GitHub / Figma / Canva / Linear / Todoist / Slack / Telegram / Discord / Resend / Airtable / Trello）
// 2) 通用远程 MCP 与 OAuth 网关（Composio 1000+ OAuth / Zapier MCP / 任意 Streamable HTTP MCP / 公开 SKILL.md）
// 3) Android 本机内置能力（阅读器 / 手机控屏 / 连接电脑 / 联网检索）与外观主题

import { nativePostJson } from './ai.js';
import { applyThemePlugin, getActiveThemePlugin, listPlugins, savePlugins } from './bots.js';

const CONN_KEY = 'zone-connected-apps-v1';
const SKILLS_KEY = 'zone-curated-skills-v1';

const THEME_LIST = [
  { id: 'apple-light', name: '纯净瓷白', desc: '纯白实面与深邃黑底自适应', color: '#111111' },
  { id: 'warm-linen', name: '暖白亚麻', desc: '温润书卷纸感浅暖色调', color: '#9a5b2f' },
  { id: 'mist-sage', name: '雾绿工作室', desc: '柔和低疲劳森林灰绿调', color: '#2e7d52' },
  { id: 'slate-pro', name: '冷灰工坊', desc: '冷静利落的效率蓝灰配色', color: '#2563eb' }
];

const CURATED_SKILLS = [
  {
    id: 'skill-caveman',
    name: '极简精炼模式 (Caveman)',
    desc: '超高密度输出，去废话，省 60% Token',
    instructions: '请采用超高信息密度、极简利落的回答风格：省略寒暄与铺垫，直接给核心结论、步骤或代码，用短句和要点列表，尽可能节省字数但保持完全准确。'
  },
  {
    id: 'skill-code-audit',
    name: '架构与代码审查',
    desc: '自动识别边界 Bug、性能与安全风险',
    instructions: '当用户讨论代码或系统设计时，按「关键风险 → 根因定位 → 最小改动修复方案」三段式给出具体可落地建议，优先指出安全、并发与边界条件缺陷。'
  },
  {
    id: 'skill-research-pro',
    name: '深度研报与信源核验',
    desc: '区分事实与推断，附公开可追溯链接',
    instructions: '调研分析时严格区分「已核实事实」「二手报道」与「个人推断」，优先交叉核验多方一手公开来源，并列出清晰参考链接与反例视角。'
  }
];

export const APP_CATALOG = [
  {
    id: 'notion', name: 'Notion', cat: 'office', color: '#111111', glyph: 'N',
    desc: '搜索工作区页面与数据库、自动新建笔记（官方 API / MCP）',
    fieldLabel: 'Internal Integration Token', placeholder: 'ntn_... 或 secret_...',
    guideUrl: 'https://www.notion.so/my-integrations', guideText: '前往 Notion Integrations 创建并共享页面'
  },
  {
    id: 'obsidian', name: 'Obsidian Vault', cat: 'office', color: '#7C3AED', glyph: 'Ob',
    desc: '连接本机 Obsidian 双向链接库（Local REST API / MCP 插件，无需合作）',
    isMcpGateway: true, defaultUrl: 'http://127.0.0.1:27123/mcp',
    urlPlaceholder: 'Obsidian MCP 或 Local REST API 地址 (http://127.0.0.1:27123/...)',
    fieldLabel: 'Obsidian API Key / Token', placeholder: '在 Obsidian 插件设置中复制 API Key',
    guideUrl: 'https://obsidian.md/plugins', guideText: '在 Obsidian 社区插件市场安装 MCP / Local REST API 插件'
  },
  {
    id: 'google-workspace', name: 'Google Workspace', cat: 'mcp', color: '#4285F4', glyph: 'G',
    desc: '打通 Gmail / Google Calendar / Drive / Docs（通过个人 MCP 或 Composio OAuth）',
    isMcpGateway: true, defaultUrl: 'https://connect.composio.dev/mcp',
    urlPlaceholder: 'Google Workspace MCP 端点或 Composio MCP 地址',
    fieldLabel: 'API Key / Bearer Token', placeholder: '粘贴你的 MCP Token 或 Composio Key',
    guideUrl: 'https://app.composio.dev', guideText: '无需自建 OAuth 审核，通过标准 MCP 连接 Gmail / 日历 / Drive'
  },
  {
    id: 'github', name: 'GitHub', cat: 'dev', color: '#181717', glyph: 'GH',
    desc: '读取仓库、查看与创建 Issue / PR',
    fieldLabel: 'Personal Access Token', placeholder: 'ghp_... 或 github_pat_...',
    guideUrl: 'https://github.com/settings/tokens', guideText: '前往 GitHub 生成 Token（勾选 repo 权限）'
  },
  {
    id: 'figma', name: 'Figma MCP', cat: 'dev', color: '#0ACF83', glyph: 'Fg',
    desc: '连接官方 Figma MCP，直接读取设计稿与组件规范',
    isMcpGateway: true, defaultUrl: 'https://mcp.figma.com/mcp',
    urlPlaceholder: 'https://mcp.figma.com/mcp',
    fieldLabel: 'Figma Token（可选）', placeholder: '粘贴 Figma Personal Access Token',
    guideUrl: 'https://www.figma.com/developers/api', guideText: '获取 Figma 官方 MCP 接入说明'
  },
  {
    id: 'canva', name: 'Canva MCP', cat: 'office', color: '#00C4CC', glyph: 'Cv',
    desc: '连接官方 Canva MCP，自动检索与协作编辑设计稿',
    isMcpGateway: true, defaultUrl: 'https://mcp.canva.com/mcp',
    urlPlaceholder: 'https://mcp.canva.com/mcp',
    fieldLabel: 'Canva Token（可选）', placeholder: '粘贴 Canva 授权 Token',
    guideUrl: 'https://www.canva.dev', guideText: '查看 Canva MCP 开放接口文档'
  },
  {
    id: 'composio', name: 'Composio · 1000+ OAuth', cat: 'mcp', color: '#4F46E5', glyph: 'C',
    desc: '一站式 OAuth 授权 Gmail / Calendar / Drive / Jira / Linear 等千款海外应用',
    isMcpGateway: true, defaultUrl: 'https://connect.composio.dev/mcp',
    fieldLabel: 'Composio API Key / Token', placeholder: '粘贴你的 Composio Key（留空按端点探测）',
    guideUrl: 'https://app.composio.dev', guideText: '获取 Composio MCP 授权密钥'
  },
  {
    id: 'zapier', name: 'Zapier MCP', cat: 'mcp', color: '#FF4F00', glyph: 'Z',
    desc: '通过个人 Zapier MCP 链接联动 7000+ 海外自动化工作流',
    isMcpGateway: true, defaultUrl: '',
    urlPlaceholder: '粘贴你的专属 Zapier MCP 地址 (https://mcp.zapier.com/...)',
    fieldLabel: '可选 Bearer Token', placeholder: '如地址已自带鉴权可留空',
    guideUrl: 'https://mcp.zapier.com', guideText: '打开 Zapier MCP 复制你的个人端点链接'
  },
  {
    id: 'linear', name: 'Linear', cat: 'dev', color: '#5E6AD2', glyph: 'L',
    desc: '查询指派任务与一键创建研发 Issue',
    fieldLabel: 'Personal API Key', placeholder: 'lin_api_...',
    guideUrl: 'https://linear.app/settings/api', guideText: '前往 Linear Settings → API 生成密钥'
  },
  {
    id: 'todoist', name: 'Todoist', cat: 'office', color: '#E44332', glyph: '✓',
    desc: '查看每日待办清单与语音快速添任务',
    fieldLabel: 'API Token', placeholder: '粘贴 Todoist Integrations API Token',
    guideUrl: 'https://app.todoist.com/app/settings/integrations/developer', guideText: '在 Todoist 设置 → 集成 → 开发者中复制 Token'
  },
  {
    id: 'slack', name: 'Slack', cat: 'msg', color: '#4A154B', glyph: '#',
    desc: '通过 Bot Token 或 Webhook 向频道发送消息',
    fieldLabel: 'Bot Token (xoxb-...) 或 Incoming Webhook', placeholder: 'xoxb-... 或 https://hooks.slack.com/services/...',
    extraKey: 'channel', extraLabel: '默认频道 ID（用 Bot Token 时可选）', extraPlaceholder: '如 C0123456789',
    guideUrl: 'https://api.slack.com/apps', guideText: '在 Slack API 创建 App 获取 Token 或 Webhook'
  },
  {
    id: 'telegram', name: 'Telegram Bot', cat: 'msg', color: '#26A5E4', glyph: 'TG',
    desc: '用自己的 Telegram 机器人推送通知与报告',
    fieldLabel: 'Bot Token（来自 @BotFather）', placeholder: '123456789:AAH...',
    extraKey: 'chatId', extraLabel: '默认 Chat ID（可选）', extraPlaceholder: '你的 Telegram 数字 Chat ID',
    guideUrl: 'https://t.me/BotFather', guideText: '通过 @BotFather 创建并复制 Token'
  },
  {
    id: 'discord', name: 'Discord', cat: 'msg', color: '#5865F2', glyph: 'D',
    desc: '向 Discord 频道自动发布动态与摘要',
    fieldLabel: '频道 Webhook 地址', placeholder: 'https://discord.com/api/webhooks/...',
    guideUrl: 'https://support.discord.com/hc/en-us/articles/228383668', guideText: '在 Discord 频道设置 → 整合 → Webhook 复制'
  },
  {
    id: 'resend', name: 'Resend 邮件', cat: 'office', color: '#111111', glyph: '✉',
    desc: '通过你的 Resend 账号让 Bot 自动发送邮件',
    fieldLabel: 'Resend API Key', placeholder: 're_...',
    extraKey: 'fromEmail', extraLabel: '发件人邮箱（可选）', extraPlaceholder: 'Zbot <onboarding@resend.dev>',
    guideUrl: 'https://resend.com/api-keys', guideText: '在 Resend 控制台创建 API Key'
  },
  {
    id: 'airtable', name: 'Airtable', cat: 'office', color: '#18BFFF', glyph: 'A',
    desc: '读取你的 Airtable 数据库与项目表格',
    fieldLabel: 'Personal Access Token', placeholder: 'pat...',
    guideUrl: 'https://airtable.com/create/tokens', guideText: '在 Airtable 创建 Personal Access Token'
  },
  {
    id: 'trello', name: 'Trello', cat: 'office', color: '#0079BF', glyph: 'T',
    desc: '查看 Trello 看板与项目卡片',
    fieldLabel: 'Trello Token', placeholder: '粘贴 Trello Token',
    extraKey: 'apiKey', extraLabel: 'Trello API Key（必填）', extraPlaceholder: '粘贴 Trello API Key',
    guideUrl: 'https://trello.com/power-ups/admin', guideText: '在 Trello Power-Ups Admin 获取 API Key 与 Token'
  }
];

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function listConnectedApps() {
  try {
    const arr = JSON.parse(localStorage.getItem(CONN_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(x => x && x.id && x.token) : [];
  } catch { return []; }
}

function saveConnectedApps(list) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(list)); } catch {}
}

export function listEnabledCuratedSkills() {
  try {
    const ids = JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]');
    if (!Array.isArray(ids)) return [];
    return CURATED_SKILLS.filter(s => ids.includes(s.id));
  } catch { return []; }
}

function toggleCuratedSkill(id) {
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]'); } catch {}
  if (!Array.isArray(ids)) ids = [];
  const on = !ids.includes(id);
  const next = on ? [...ids, id] : ids.filter(x => x !== id);
  try { localStorage.setItem(SKILLS_KEY, JSON.stringify(next)); } catch {}
  return on;
}

export function buildEnabledSkillsPrompt() {
  const skills = listEnabledCuratedSkills();
  if (!skills.length) return '';
  return skills.map(s => `[已启用技能「${s.name}」]\n${s.instructions}`).join('\n\n');
}

export function listAllConnectedMcpPlugins() {
  return listPlugins()
    .filter(p => p && p.enabled && p.id.startsWith('ext-') && p.verified)
    .map(p => ({
      name: p.name,
      url: p.url || '',
      token: p.token || '',
      protocol: p.protocol || '',
      tools: Array.isArray(p.tools) ? p.tools : [],
      instructions: p.instructions || ''
    }));
}

export function closeConnectAppsView() {
  const v = document.getElementById('zone-connect-view');
  if (!v || v.classList.contains('hidden')) return false;
  v.classList.add('hidden');
  return true;
}

export function openConnectAppsView({ cloudApi = '', onInspectPlugin, onChanged, onToast } = {}) {
  let view = document.getElementById('zone-connect-view');
  if (!view) {
    view = document.createElement('section');
    view.id = 'zone-connect-view';
    view.className = 'conn-full-view hidden';
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-modal', 'true');
    view.setAttribute('aria-label', '连接应用');
    document.body.appendChild(view);
  }

  let cat = 'all'; // all | connected | android | office | dev | msg | mcp | theme
  let query = '';
  let authTarget = null; // catalog item or 'custom-mcp'
  let busy = false;
  let authErr = '';

  const totalConnectedCount = () => {
    const apps = listConnectedApps().length;
    const plugs = listPlugins().filter(p => p.enabled).length;
    const skills = listEnabledCuratedSkills().length;
    return apps + plugs + skills;
  };

  const draw = () => {
    const connectedApps = listConnectedApps();
    const connMap = new Map(connectedApps.map(c => [c.id, c]));
    const plugins = listPlugins();
    const builtinPlugs = plugins.filter(p => !p.id.startsWith('ext-'));
    const customPlugs = plugins.filter(p => p.id.startsWith('ext-'));
    const enabledSkills = new Set(listEnabledCuratedSkills().map(s => s.id));
    const curTheme = getActiveThemePlugin();
    const q = query.trim().toLowerCase();

    if (authTarget) {
      const isCustom = authTarget === 'custom-mcp';
      const existing = !isCustom ? connMap.get(authTarget.id) : null;
      const isMcp = isCustom || !!authTarget.isMcpGateway;
      view.innerHTML = `
        <div class="conn-head">
          <div class="conn-head-l">
            <button type="button" class="cb-close-btn" data-c-act="auth-back" aria-label="返回">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
            </button>
            <h3>${isCustom ? '添加远程 MCP / 技能' : `连接 ${esc(authTarget.name)}`}</h3>
          </div>
        </div>
        <div class="conn-auth-body">
          ${!isCustom ? `
            <div class="conn-auth-hero">
              <div class="conn-ico lg" style="background:${authTarget.color}">${esc(authTarget.glyph)}</div>
              <h4>${esc(authTarget.name)}</h4>
              <p>${esc(authTarget.desc)}</p>
              ${existing ? `<span class="conn-verified-tag">已实测授权 · ${esc(existing.account || '已连通')}</span>` : ''}
            </div>
          ` : `
            <p class="conn-auth-note">实测连通远程 Streamable HTTP MCP（自动发现 tools/list）或公开 SKILL.md；凭据仅保存在本机。</p>
          `}
          <div class="bots-form">
            ${isMcp ? `<input id="conn-f-url" type="text" inputmode="url" placeholder="${esc(authTarget.urlPlaceholder || '远程 MCP 地址 (https://.../mcp) 或 SKILL.md 链接')}" value="${esc(existing?.url || authTarget.defaultUrl || '')}">` : ''}
            <input id="conn-f-token" type="password" placeholder="${esc(isCustom ? '可选：Bearer Token / API Key' : authTarget.placeholder)}" value="${esc(existing?.token || '')}">
            ${!isCustom && authTarget.extraKey ? `<input id="conn-f-extra" type="text" placeholder="${esc(authTarget.extraPlaceholder || '')}" value="${esc(existing?.extra?.[authTarget.extraKey] || '')}">` : ''}
            ${isCustom ? `<input id="conn-f-name" type="text" placeholder="可选：自定义名称（留空自动识别）">` : ''}
            ${!isCustom && authTarget.guideUrl ? `<a class="conn-guide-link" href="${esc(authTarget.guideUrl)}" target="_blank" rel="noopener noreferrer">${esc(authTarget.guideText)} ↗</a>` : ''}
            ${authErr ? `<p class="conn-err">${esc(authErr)}</p>` : ''}
            <button type="button" class="bots-primary" data-c-act="auth-submit" ${busy ? 'disabled' : ''}>${busy ? '正在真实校验连通…' : (existing ? '重新验证并更新' : '验证并连接')}</button>
            ${existing ? `<button type="button" class="bots-danger" data-c-act="auth-disconnect">断开授权</button>` : ''}
          </div>
        </div>`;

      view.querySelector('[data-c-act="auth-back"]').onclick = () => { authTarget = null; authErr = ''; busy = false; draw(); };
      const disc = view.querySelector('[data-c-act="auth-disconnect"]');
      if (disc) disc.onclick = () => {
        saveConnectedApps(listConnectedApps().filter(x => x.id !== authTarget.id));
        if (authTarget.isMcpGateway) {
          savePlugins(listPlugins().filter(p => p.id !== `ext-gw-${authTarget.id}`));
        }
        onToast?.(`已断开「${authTarget.name}」授权`);
        onChanged?.();
        authTarget = null; authErr = ''; draw();
      };
      view.querySelector('[data-c-act="auth-submit"]').onclick = async () => {
        if (busy) return;
        const tok = (view.querySelector('#conn-f-token')?.value || '').trim();
        const url = (view.querySelector('#conn-f-url')?.value || '').trim();
        const extraVal = (view.querySelector('#conn-f-extra')?.value || '').trim();
        const customName = (view.querySelector('#conn-f-name')?.value || '').trim();
        authErr = '';

        if (isMcp) {
          if (!/^https?:\/\//i.test(url)) { authErr = '请输入以 https:// 开头的远程 MCP 或 SKILL.md 链接'; draw(); return; }
          busy = true; draw();
          try {
            const res = await onInspectPlugin?.({ url, token: tok });
            busy = false;
            if (!res?.ok) { authErr = res?.error || '远端探测失败，请检查地址或密钥'; draw(); return; }
            const finalName = isCustom ? (customName || res.name || '外部 MCP') : authTarget.name;
            const pid = isCustom ? `ext-${Date.now().toString(36)}` : `ext-gw-${authTarget.id}`;
            const nextP = listPlugins().filter(p => p.id !== pid);
            const tNames = (res.tools || []).map(t => t.name).slice(0, 4).join(' / ');
            nextP.push({
              id: pid,
              name: finalName,
              short: finalName.slice(0, 10),
              desc: res.protocol === 'mcp' ? `已连通 · ${(res.tools || []).length} 个工具${tNames ? `（${tNames}）` : ''}` : (res.summary || '已连通 SKILL.md'),
              url, token: tok, protocol: res.protocol, tools: res.tools || [], instructions: res.instructions || '',
              verified: true, enabled: true, launchable: false
            });
            savePlugins(nextP);
            if (!isCustom) {
              const nextC = listConnectedApps().filter(x => x.id !== authTarget.id);
              nextC.unshift({ id: authTarget.id, name: authTarget.name, url, token: tok || 'mcp', account: `${(res.tools || []).length} 个 MCP 工具`, verifiedAt: Date.now() });
              saveConnectedApps(nextC);
            }
            onToast?.(`已实测连接「${finalName}」`, 2600);
            onChanged?.();
            authTarget = null; draw();
          } catch (e) {
            busy = false; authErr = e?.message || '连接异常'; draw();
          }
          return;
        }

        if (!tok) { authErr = `请填写 ${authTarget.fieldLabel}`; draw(); return; }
        const extra = authTarget.extraKey && extraVal ? { [authTarget.extraKey]: extraVal } : {};
        busy = true; draw();
        try {
          const api = String(cloudApi || '').replace(/\/+$/, '');
          const r = await nativePostJson(`${api}/api/connectors/verify`, {}, { connector_id: authTarget.id, token: tok, extra }, 25000);
          busy = false;
          if (!r.ok || !r.data?.ok) {
            authErr = r.data?.error || r.data?.detail || `验证失败（HTTP ${r.status || '超时'}）`;
            draw();
            return;
          }
          const next = listConnectedApps().filter(x => x.id !== authTarget.id);
          next.unshift({
            id: authTarget.id,
            name: authTarget.name,
            token: tok,
            extra,
            account: r.data.account || '已授权',
            tools: r.data.tools || [],
            verifiedAt: Date.now()
          });
          saveConnectedApps(next);
          onToast?.(`已授权连接「${authTarget.name}」(${r.data.account || '已连通'})`, 2600);
          onChanged?.();
          authTarget = null; draw();
        } catch (e) {
          busy = false; authErr = e?.message || '网络异常，请稍后再试'; draw();
        }
      };
      return;
    }

    const matchQ = (...fields) => !q || fields.some(f => String(f || '').toLowerCase().includes(q));
    const filteredApps = APP_CATALOG.filter(a => {
      if (cat === 'connected' && !connMap.has(a.id)) return false;
      if (['office', 'dev', 'msg', 'mcp'].includes(cat) && a.cat !== cat) return false;
      if (cat === 'android' || cat === 'theme') return false;
      return matchQ(a.name, a.desc, a.id);
    });
    const showAndroid = (cat === 'all' || cat === 'android' || cat === 'connected') && builtinPlugs.some(p => (cat !== 'connected' || p.enabled) && matchQ(p.name, p.desc));
    const visibleAndroid = builtinPlugs.filter(p => (cat !== 'connected' || p.enabled) && matchQ(p.name, p.desc));
    const visibleSkills = (cat === 'all' || cat === 'mcp' || cat === 'connected')
      ? CURATED_SKILLS.filter(s => (cat !== 'connected' || enabledSkills.has(s.id)) && matchQ(s.name, s.desc))
      : [];
    const visibleCustom = (cat === 'all' || cat === 'mcp' || cat === 'connected')
      ? customPlugs.filter(p => (cat !== 'connected' || p.enabled) && matchQ(p.name, p.desc, p.url))
      : [];
    const showThemes = (cat === 'theme' || (cat === 'all' && !q));

    const cats = [
      { id: 'all', label: '全部' },
      { id: 'android', label: 'Android' },
      { id: 'office', label: '办公效率' },
      { id: 'dev', label: '开发协作' },
      { id: 'msg', label: '消息通知' },
      { id: 'mcp', label: 'MCP 与技能' },
      { id: 'theme', label: '外观主题' }
    ];

    view.innerHTML = `
      <div class="conn-head">
        <div class="conn-head-l">
          <button type="button" class="cb-close-btn" data-c-act="close" aria-label="关闭">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
          </button>
          <h3>连接应用</h3>
        </div>
        <button type="button" class="conn-count-pill ${cat === 'connected' ? 'on' : ''}" data-c-cat="${cat === 'connected' ? 'all' : 'connected'}">${totalConnectedCount()} 个已连接</button>
      </div>
      <div class="conn-cats" role="tablist">
        ${cats.map(c => `<button type="button" class="conn-cat-pill ${cat === c.id ? 'on' : ''}" data-c-cat="${c.id}">${c.label}</button>`).join('')}
      </div>
      <div class="conn-scroll">
        ${filteredApps.length ? `
          <div class="conn-sec-title">为你推荐 · 官方接口与 OAuth 网关 ›</div>
          <div class="conn-list">
            ${filteredApps.map(a => {
              const info = connMap.get(a.id);
              return `
                <div class="conn-row" data-c-app="${a.id}">
                  <div class="conn-ico" style="background:${a.color}">${esc(a.glyph)}</div>
                  <div class="conn-meta">
                    <strong>${esc(a.name)}</strong>
                    <span>${info ? `已授权 · ${esc(info.account || '已连通')}` : esc(a.desc)}</span>
                  </div>
                  <button type="button" class="conn-btn ${info ? 'on' : ''}" data-c-app="${a.id}">${info ? '已连接 ✓' : '连接'}</button>
                </div>`;
            }).join('')}
          </div>
        ` : ''}

        ${showAndroid && visibleAndroid.length ? `
          <div class="conn-sec-title">Android 本机能力 ›</div>
          <div class="conn-list">
            ${visibleAndroid.map(pl => `
              <div class="conn-row">
                <div class="conn-ico soft">${pl.id === 'reading-cosmos' ? '书' : pl.id === 'phone-use' ? '屏' : pl.id === 'computer-use' ? '电' : pl.id === 'sichao' ? '潮' : '网'}</div>
                <div class="conn-meta">
                  <strong>${esc(pl.name)}</strong>
                  <span>${esc(pl.desc)}</span>
                </div>
                <label class="ios-switch" aria-label="开关 ${esc(pl.name)}">
                  <input type="checkbox" data-toggle="${esc(pl.id)}" ${pl.enabled ? 'checked' : ''}>
                  <span></span>
                </label>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${(visibleSkills.length || visibleCustom.length || cat === 'all' || cat === 'mcp') ? `
          <div class="conn-sec-title">技能插件与自定义 MCP ›</div>
          <div class="conn-list">
            ${visibleSkills.map(sk => {
              const on = enabledSkills.has(sk.id);
              return `
                <div class="conn-row" data-c-skill="${sk.id}">
                  <div class="conn-ico soft">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 11h-1.2a2.2 2.2 0 1 1 0-4.4H19V5a1 1 0 0 0-1-1h-3.6v1.2a2.2 2.2 0 1 1-4.4 0V4H6a1 1 0 0 0-1 1v3.6h1.2a2.2 2.2 0 1 1 0 4.4H5V18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z"/></svg>
                  </div>
                  <div class="conn-meta">
                    <strong>${esc(sk.name)}</strong>
                    <span>${esc(sk.desc)}</span>
                  </div>
                  <button type="button" class="conn-btn ${on ? 'on' : ''}" data-c-skill="${sk.id}">${on ? '已启用 ✓' : '连接'}</button>
                </div>`;
            }).join('')}
            ${visibleCustom.map(pl => `
              <div class="conn-row">
                <div class="conn-ico soft">M</div>
                <div class="conn-meta">
                  <strong>${esc(pl.name)}</strong>
                  <span>${esc(pl.desc)}</span>
                </div>
                <button type="button" class="conn-btn danger" data-c-rm-ext="${esc(pl.id)}">移除</button>
              </div>
            `).join('')}
            <div class="conn-row" data-c-act="add-custom">
              <div class="conn-ico soft">+</div>
              <div class="conn-meta">
                <strong>添加自定义远程 MCP / Skill</strong>
                <span>粘贴任意 Streamable HTTP MCP 或 SKILL.md 链接</span>
              </div>
              <button type="button" class="conn-btn" data-c-act="add-custom">添加</button>
            </div>
          </div>
        ` : ''}

        ${showThemes ? `
          <div class="conn-sec-title">外观主题 ›</div>
          <div class="theme-plug-list" style="margin-bottom:20px">
            ${THEME_LIST.map(t => `<button type="button" class="theme-plug-chip ${curTheme === t.id ? 'on' : ''}" data-c-theme="${t.id}"><i style="background:${t.color}"></i>${t.name}</button>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="conn-search-dock">
        <label class="agent-search-pill">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.4"/><path d="M20 20l-4.2-4.2"/></svg>
          <input id="conn-search-inp" type="search" placeholder="搜索应用与技能" value="${esc(query)}" autocomplete="off">
        </label>
      </div>`;

    view.querySelector('[data-c-act="close"]').onclick = () => closeConnectAppsView();
    view.querySelectorAll('[data-c-cat]').forEach(b => {
      b.onclick = () => { cat = b.dataset.cCat; draw(); };
    });
    view.querySelectorAll('[data-c-app]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const item = APP_CATALOG.find(x => x.id === el.dataset.cApp);
        if (item) { authTarget = item; authErr = ''; draw(); }
      };
    });
    view.querySelectorAll('[data-c-act="add-custom"]').forEach(el => {
      el.onclick = e => { e.stopPropagation(); authTarget = 'custom-mcp'; authErr = ''; draw(); };
    });
    view.querySelectorAll('[data-toggle]').forEach(chk => {
      chk.onchange = () => {
        const pid = chk.dataset.toggle;
        const next = listPlugins();
        const hit = next.find(p => p.id === pid);
        if (hit) {
          hit.enabled = chk.checked;
          savePlugins(next);
          onChanged?.();
          onToast?.(`${hit.name}已${hit.enabled ? '开启' : '关闭'}`);
          draw();
        }
      };
    });
    view.querySelectorAll('[data-c-skill]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const sid = el.dataset.cSkill;
        const sk = CURATED_SKILLS.find(x => x.id === sid);
        const nowOn = toggleCuratedSkill(sid);
        onToast?.(nowOn ? `已启用技能「${sk?.name || sid}」` : `已停用技能「${sk?.name || sid}」`);
        onChanged?.();
        draw();
      };
    });
    view.querySelectorAll('[data-c-rm-ext]').forEach(btn => {
      btn.onclick = () => {
        savePlugins(listPlugins().filter(p => p.id !== btn.dataset.cRmExt));
        onToast?.('已移除该远程 MCP / 技能');
        onChanged?.();
        draw();
      };
    });
    view.querySelectorAll('[data-c-theme]').forEach(btn => {
      btn.onclick = () => {
        const th = applyThemePlugin(btn.dataset.cTheme);
        onToast?.(`已切换主题「${th.name}」`);
        draw();
      };
    });
    const sInp = view.querySelector('#conn-search-inp');
    if (sInp) {
      sInp.oninput = () => {
        query = sInp.value;
        draw();
        const nextInp = view.querySelector('#conn-search-inp');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(nextInp.value.length, nextInp.value.length); }
      };
    }
  };

  draw();
  view.classList.remove('hidden');
}
