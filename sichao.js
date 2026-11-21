// 「思潮 × Zone」：全球前沿信号采集 → 事实证据包 → A~E 独立判断 + 置信度 → 侦察机会 → 解锁 AI 伙伴视角 → 二次修正 → 7/30/90 天现实复盘与个人判断档案
// 静息零外链请求；仅在用户主动点「拉取今日全球动态」时抓取公开免费接口。

import { aiConfigured, complete } from './ai.js';
import { createNote } from './knowledge.js';

const REC_KEY = 'zone-sichao-records';
const EVENT_KEY = 'zone-sichao-events';
const API_KEY = 'zone-sichao-api';
const DEFAULT_SICHAO_API = 'https://sichao-v2-server.onrender.com';

export function getSichaoApi() {
  try {
    const custom = localStorage.getItem(API_KEY);
    if (custom === 'off' || custom === 'local') return '';
    return (custom || DEFAULT_SICHAO_API).replace(/\/+$/, '');
  } catch { return DEFAULT_SICHAO_API; }
}
export function setSichaoApi(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  try {
    if (clean) localStorage.setItem(API_KEY, clean);
    else localStorage.removeItem(API_KEY);
  } catch {}
  return clean;
}

const VERDICTS = [
  { id: 'A', label: 'A. 噪声', hint: '短期炒作、重复营销或无实质变化' },
  { id: 'B', label: 'B. 弱信号', hint: '值得留意，但证据尚不足以改变判断' },
  { id: 'C', label: 'C. 有价值信号', hint: '具备清晰变化与证据支撑，值得跟踪' },
  { id: 'D', label: 'D. 结构性信号', hint: '可能重塑行业成本、格局或规则' },
  { id: 'E', label: 'E. 暂不判断', hint: '关键变量缺失，保持开放观察' }
];

const BUILTIN_EVENTS = [
  {
    id: 'sc-edge-llm',
    domain: 'AI · 端侧推理',
    title: '开源小模型在消费级手机端实现离线 30 token/s 推理',
    summary: '多家开源团队发布 3B~7B 量化模型与端侧推理框架更新，在主流手机 NPU/GPU 上实现无需联网的流畅本地推理。',
    facts: [
      '4-bit 量化后模型体积降至 2~4 GB，可常驻旗舰机内存。',
      '基础文本摘要、翻译与结构化指令解析延迟已进入秒级。'
    ],
    change: '从“必须依赖云端大模型 API”转向“高频轻量任务可在端侧零成本完成”。',
    unknowns: [
      '中低端手机连续推理的发热与续航衰减幅度尚无统一独立评测。',
      '复杂长程推理与多模态任务是否仍高度依赖云端。'
    ],
    pitfalls: '容易把基准测试的吞吐速度等同于真实复杂场景的可用质量。',
    aiVerdict: 'D',
    aiReason: '端侧推理把单次调用边际成本压到近乎为零，且天然解决隐私合规问题，会改变个人软件与操作系统层的默认交互形态。',
    counterpoints: '若端侧模型幻觉率与工具调用稳定性长期落后云端两代以上，用户仍可能回流云端。',
    source: '公开技术观察包'
  },
  {
    id: 'sc-ai-search',
    domain: '信息生态 · 搜索',
    title: '对话式综合答案正在替代传统十条蓝色链接',
    summary: '越来越多用户直接通过 AI 获取带引用的综合回答，传统内容站点自然搜索流量出现结构性下滑。',
    facts: [
      '主流搜索引擎与 AI 助手均将“直接生成摘要”置顶。',
      '独立博客与中小媒体普遍报告外链点击率下降。'
    ],
    change: '信息获取从“人自己筛选多篇网页”转向“模型代为汇总再由人核验”。',
    unknowns: [
      '当原始创作者激励下降后，高质量一手资料的供给会如何演变。',
      '广告与商业分发机制是否会重新污染 AI 答案的中立性。'
    ],
    pitfalls: '容易高估“效率提升”而忽视“信源同质化与一手证据消失”的二阶效应。',
    aiVerdict: 'C',
    aiReason: '分发格局已确定性迁移，但最终形态取决于版权分成与一手信源生态能否建立新平衡。',
    counterpoints: '垂类社区、付费订阅与一手原始数据（论文/代码/财报）反而可能变得更稀缺昂贵。',
    source: '公开行业观察包'
  },
  {
    id: 'sc-open-weights',
    domain: '产业格局 · 开源权重',
    title: '前沿开源权重模型与闭源旗舰的代差缩短至数月内',
    summary: '新一轮开放权重模型在代码与推理基准上逼近闭源商业模型，企业自部署方案成本大幅下降。',
    facts: [
      '多家实验室以宽松许可发布高性能权重与微调工具链。',
      '云厂商推理托管价格在一年内多次下调。'
    ],
    change: '基础模型能力正从“少数巨头垄断的护城河”快速商品化。',
    unknowns: [
      '下一代超大算力预训练与强化学习范式是否会再次拉开代差。',
      '应用层壁垒究竟落在数据闭环、工作流还是交互体验。'
    ],
    pitfalls: '容易把公开跑分逼近直接等同于真实生产环境可靠性一致。',
    aiVerdict: 'D',
    aiReason: '智能成本的持续塌缩会让价值加速向“贴近用户工作流与私有上下文的产品”转移。',
    counterpoints: '训练前沿底座的资本门槛仍在上升，开源生态高度依赖少数赞助方的持续投入。',
    source: '公开行业观察包'
  }
];

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(REC_KEY) || '[]'); } catch { return []; }
}
function saveRecords(list) {
  try { localStorage.setItem(REC_KEY, JSON.stringify(list)); } catch {}
}
function loadEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(EVENT_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return BUILTIN_EVENTS;
}
function saveEvents(list) {
  try { localStorage.setItem(EVENT_KEY, JSON.stringify(list)); } catch {}
}

export async function fetchLiveSignals() {
  const api = getSichaoApi();
  if (api) {
    const cloudCtrl = new AbortController();
    const cloudTimer = setTimeout(() => cloudCtrl.abort(), 15000);
    try {
      const r = await fetch(`${api}/api/events?limit=12`, { signal: cloudCtrl.signal });
      if (r.ok) {
        const data = await r.json();
        const toList = v => Array.isArray(v) ? v : (v ? [String(v)] : []);
        const list = (data?.events || []).map(ev => ({
          id: ev.event_id,
          domain: ev.domain || '全球前沿 · 云端 24/7',
          title: ev.title,
          summary: ev.summary || '',
          facts: toList(ev.facts),
          change: ev.change || '',
          unknowns: toList(ev.unknowns),
          pitfalls: ev.pitfalls || '',
          evidence: toList(ev.evidence),
          aiVerdict: ev.ai_assessment?.verdict || 'B',
          aiReason: ev.ai_assessment?.reason || '提交初判后由思潮 V2.0 云端引擎解锁 AI 伙伴视角。',
          counterpoints: ev.ai_assessment?.counterpoints || '',
          source: '思潮 V2.0 云端 24/7'
        }));
        if (list.length) { saveEvents(list); return list; }
      }
    } catch {}
    finally { clearTimeout(cloudTimer); }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 14000);
  let ids = [];
  try {
    const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: ctrl.signal });
    if (!r.ok) throw new Error('公开源暂不可达');
    ids = (await r.json()).slice(0, 12);
  } finally { clearTimeout(timer); }

  const items = [];
  await Promise.all(ids.slice(0, 8).map(async id => {
    try {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const it = await r.json();
      if (it?.title) items.push({ title: it.title, url: it.url || '', score: it.score || 0, comments: it.descendants || 0 });
    } catch {}
  }));
  if (!items.length) throw new Error('未拉取到最新动态');

  if (aiConfigured()) {
    try {
      const raw = await complete([
        { role: 'system', content: '你是「思潮」情报分析官。从给定实时科技/AI 动态中精选最值得独立思考的 3 个事件，只输出 JSON 数组，每项含字段：title(中文标题), domain(领域), summary(一句概况), facts(2条已确认事实数组), change(与过去相比的变化), unknowns(2条未知信息数组), pitfalls(易误判点), aiVerdict(A/B/C/D/E之一), aiReason(AI判断依据), counterpoints(反例或替代解释)。' },
        { role: 'user', content: JSON.stringify(items) }
      ]);
      const match = String(raw || '').match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length) {
          const clean = parsed.slice(0, 4).map((e, i) => ({
            id: 'sc-live-' + Date.now().toString(36) + '-' + i,
            domain: e.domain || '全球前沿',
            title: e.title || items[i]?.title || '前沿事件',
            summary: e.summary || '',
            facts: Array.isArray(e.facts) ? e.facts : [],
            change: e.change || '',
            unknowns: Array.isArray(e.unknowns) ? e.unknowns : [],
            pitfalls: e.pitfalls || '',
            aiVerdict: ['A', 'B', 'C', 'D', 'E'].includes(e.aiVerdict) ? e.aiVerdict : 'B',
            aiReason: e.aiReason || '',
            counterpoints: e.counterpoints || '',
            source: '实时公开信号 · AI 拆解'
          }));
          saveEvents(clean);
          return clean;
        }
      }
    } catch {}
  }

  const fallback = items.slice(0, 4).map((it, i) => ({
    id: 'sc-hn-' + Date.now().toString(36) + '-' + i,
    domain: '全球前沿 · 实时信号',
    title: it.title,
    summary: `来自全球科技社区实时讨论（热度 ${it.score} · 讨论 ${it.comments} 条）。`,
    facts: [it.url ? `原始出处：${it.url}` : '来自公开技术社区实时讨论流。', `当前社区关注度：${it.score} 赞 / ${it.comments} 评论。`],
    change: '该事件正在引发一线工程师与研究者的即时讨论，尚未形成共识。',
    unknowns: ['是否有独立第三方复现或长期数据验证。', '商业落地与二阶影响尚待 7~30 天观察。'],
    pitfalls: '社区短期高热度容易放大情绪，需区分“新奇演示”与“结构性变化”。',
    aiVerdict: 'B',
    aiReason: '配置 AI 密钥后可对实时信号自动完成深度证据核验与多视角拆解。',
    counterpoints: '热点事件往往在 7 天后才显现真实含金量。',
    source: 'Hacker News 公开流'
  }));
  saveEvents(fallback);
  return fallback;
}

export function initSichao({ toast, onNoteCreated }) {
  const mask = document.getElementById('sichao-mask');
  const body = document.getElementById('sichao-body');
  if (!mask || !body) return { open() {}, close() { return false; } };

  let tab = 'today'; // 'today' | 'archive'
  let events = loadEvents();
  let activeEvent = null;
  let draft = null;

  function close() {
    if (mask.classList.contains('hidden')) return false;
    mask.classList.add('hidden');
    return true;
  }

  function open() {
    events = loadEvents();
    activeEvent = null;
    tab = 'today';
    mask.classList.remove('hidden');
    render();
  }

  function render() {
    body.replaceChildren();
    const head = document.createElement('div');
    head.className = 'sc-head';
    head.innerHTML = `
      <div class="sc-tabs" role="tablist">
        <button type="button" class="${tab === 'today' ? 'on' : ''}" data-sctab="today">今日思潮</button>
        <button type="button" class="${tab === 'archive' ? 'on' : ''}" data-sctab="archive">判断档案</button>
      </div>
      <div class="sc-head-right">
        ${tab === 'today' && !activeEvent ? '<button type="button" class="sc-ghost" id="sc-fetch">拉取动态</button>' : ''}
        ${activeEvent ? '<button type="button" class="sc-ghost" id="sc-back">返回列表</button>' : ''}
      </div>
    `;
    head.querySelectorAll('[data-sctab]').forEach(b => {
      b.onclick = () => { tab = b.dataset.sctab; activeEvent = null; render(); };
    });
    head.querySelector('#sc-back')?.addEventListener('click', () => { activeEvent = null; render(); });
    head.querySelector('#sc-fetch')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '采集中…';
      try {
        events = await fetchLiveSignals();
        toast(`已采集 ${events.length} 条最新前沿信号`);
        render();
      } catch (err) {
        toast(err?.message || '采集失败，已保留离线事件包');
        btn.disabled = false;
        btn.textContent = '拉取动态';
      }
    });
    body.appendChild(head);

    if (tab === 'archive') {
      renderArchive();
      return;
    }
    if (activeEvent) {
      renderEventGame(activeEvent);
      return;
    }
    renderEventList();
  }

  function renderEventList() {
    const recs = loadRecords();
    const doneSet = new Set(recs.map(r => r.eventId));
    const list = document.createElement('div');
    list.className = 'sc-list';
    for (const ev of events) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'sc-card' + (doneSet.has(ev.id) ? ' done' : '');
      card.innerHTML = `
        <div class="sc-meta"><span>${ev.domain}</span><span>${doneSet.has(ev.id) ? '已判断' : '待判断'}</span></div>
        <strong class="sc-title"></strong>
        <p class="sc-sum"></p>
      `;
      card.querySelector('.sc-title').textContent = ev.title;
      card.querySelector('.sc-sum').textContent = ev.summary;
      card.onclick = () => {
        activeEvent = ev;
        const existing = recs.find(r => r.eventId === ev.id);
        draft = existing ? { ...existing, unlocked: true } : {
          eventId: ev.id, title: ev.title, domain: ev.domain,
          firstVerdict: '', confidence: 70, rationale: '',
          scoutQuery: '', scoutReply: '',
          unlocked: false, finalVerdict: '', revisionNote: '',
          realityStatus: 'pending', createdAt: Date.now()
        };
        render();
      };
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  function renderEventGame(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'sc-game';
    const sec = (k, v) => v ? `<div class="sc-blk"><h4>${k}</h4>${Array.isArray(v) ? '<ul>' + v.map(x => `<li>${x}</li>`).join('') + '</ul>' : `<p>${v}</p>`}</div>` : '';
    wrap.innerHTML = `
      <div class="sc-ev-top"><span>${ev.domain}</span><span>${ev.source || ''}</span></div>
      <h3 class="sc-ev-title"></h3>
      <p class="sc-ev-sum"></p>
      ${sec('已确认事实', ev.facts)}
      ${sec('与过去相比的变化', ev.change)}
      ${sec('仍缺失的关键信息', ev.unknowns)}
      ${sec('容易误判的地方', ev.pitfalls)}
    `;
    wrap.querySelector('.sc-ev-title').textContent = ev.title;
    wrap.querySelector('.sc-ev-sum').textContent = ev.summary;

    // 侦察机会（每局 1 次）
    const scoutBox = document.createElement('div');
    scoutBox.className = 'sc-blk sc-scout';
    scoutBox.innerHTML = `
      <h4>侦察机会（剩余 ${draft.scoutReply ? 0 : 1} 次）</h4>
      ${draft.scoutReply
        ? `<p class="sc-scout-ans"></p>`
        : `<div class="sc-scout-row"><input id="sc-scout-in" type="text" placeholder="指定一个方向让 AI 补充侦察，如「谁在反驳」"><button type="button" id="sc-scout-btn">侦察</button></div>`}
    `;
    if (draft.scoutReply) scoutBox.querySelector('.sc-scout-ans').textContent = draft.scoutReply;
    scoutBox.querySelector('#sc-scout-btn')?.addEventListener('click', async e => {
      const q = (scoutBox.querySelector('#sc-scout-in')?.value || '').trim();
      if (!q) return;
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '侦察中…';
      draft.scoutQuery = q;
      if (aiConfigured()) {
        try {
          draft.scoutReply = await complete([
            { role: 'system', content: '你是客观情报侦察员，只提供补充事实、反例或缺失数据，不要代替用户下最终结论。控制在 150 字内。' },
            { role: 'user', content: `事件：${ev.title}\n背景：${ev.summary}\n用户侦察方向：${q}` }
          ]);
        } catch { draft.scoutReply = '侦察接口暂不可用，可结合「仍缺失的关键信息」先做独立判断。'; }
      } else {
        draft.scoutReply = `关于「${q}」：建议重点核验是否有独立第三方数据、真实采用成本与 30 天后的留存变化（配置 AI 密钥可联网深度侦察）。`;
      }
      render();
    });
    wrap.appendChild(scoutBox);

    // 独立判断区
    const judge = document.createElement('div');
    judge.className = 'sc-blk sc-judge';
    judge.innerHTML = `
      <h4>${draft.unlocked ? '你的判断（可二次修正）' : '第一步：先做你的独立判断'}</h4>
      <div class="sc-opts">
        ${VERDICTS.map(v => `<button type="button" class="sc-opt ${(draft.finalVerdict || draft.firstVerdict) === v.id ? 'on' : ''}" data-v="${v.id}"><strong>${v.label}</strong><span>${v.hint}</span></button>`).join('')}
      </div>
      <div class="sc-conf"><span>置信度 <b id="sc-conf-val">${draft.confidence}%</b></span><input id="sc-conf" type="range" min="50" max="95" step="5" value="${draft.confidence}"></div>
      <textarea id="sc-rationale" rows="2" placeholder="写一句你的判断依据（为什么这么看？）"></textarea>
      <button type="button" class="sc-submit" id="sc-submit">${draft.unlocked ? '保存修正并同步到星海' : '提交判断 · 解锁 AI 伙伴视角'}</button>
    `;
    judge.querySelector('#sc-rationale').value = draft.rationale || '';
    judge.querySelector('#sc-conf').oninput = e => {
      draft.confidence = Number(e.target.value);
      judge.querySelector('#sc-conf-val').textContent = draft.confidence + '%';
    };
    judge.querySelectorAll('.sc-opt').forEach(b => {
      b.onclick = () => {
        if (draft.unlocked) draft.finalVerdict = b.dataset.v;
        else draft.firstVerdict = b.dataset.v;
        judge.querySelectorAll('.sc-opt').forEach(x => x.classList.toggle('on', x === b));
      };
    });
    judge.querySelector('#sc-submit').onclick = async () => {
      const picked = draft.unlocked ? (draft.finalVerdict || draft.firstVerdict) : draft.firstVerdict;
      if (!picked) { toast('先选一个判断选项（A~E）'); return; }
      draft.rationale = (judge.querySelector('#sc-rationale').value || '').trim();
      if (!draft.unlocked) {
        draft.unlocked = true;
        draft.finalVerdict = draft.firstVerdict;
      }
      const list = loadRecords().filter(r => r.eventId !== ev.id);
      const now = Date.now();
      const record = {
        ...draft,
        finalVerdict: draft.finalVerdict || draft.firstVerdict,
        updatedAt: now,
        checkpoints: {
          d7: now + 7 * 86400000,
          d30: now + 30 * 86400000,
          d90: now + 90 * 86400000
        }
      };
      list.unshift(record);
      saveRecords(list);
      // 同步沉淀为 Zone 星海「判断星」
      try {
        const vLabel = VERDICTS.find(x => x.id === record.finalVerdict)?.label || record.finalVerdict;
        await createNote({
          title: `【思潮判断】${ev.title.slice(0, 24)}`,
          body: `## 结论\n${vLabel}（置信度 ${record.confidence}%）\n\n## 判断依据\n${record.rationale || '（待补充）'}\n\n## AI 伙伴视角\n${ev.aiVerdict}：${ev.aiReason}\n\n## 现实复盘节点\n7天 / 30天 / 90天后检验`,
          tags: ['思潮', '判断'],
          concept: true
        });
        await onNoteCreated?.();
      } catch {}
      toast('判断已记录并点亮到星海');
      render();
    };
    wrap.appendChild(judge);

    if (draft.unlocked) {
      const aiBox = document.createElement('div');
      aiBox.className = 'sc-blk sc-ai';
      const aiLabel = VERDICTS.find(x => x.id === ev.aiVerdict)?.label || ev.aiVerdict;
      const diff = draft.firstVerdict === ev.aiVerdict ? '你与 AI 初步判断一致，注意共同盲区。' : `分歧提示：你选了 ${draft.firstVerdict}，AI 倾向 ${ev.aiVerdict}。`;
      aiBox.innerHTML = `
        <h4>已解锁 · AI 伙伴视角</h4>
        <p class="sc-diff">${diff}</p>
        <p><strong>AI 倾向：${aiLabel}</strong> — ${ev.aiReason}</p>
        <p><strong>反例与替代解释：</strong>${ev.counterpoints}</p>
      `;
      wrap.appendChild(aiBox);
    }

    body.appendChild(wrap);
  }

  function renderArchive() {
    const recs = loadRecords();
    const wrap = document.createElement('div');
    wrap.className = 'sc-archive';
    if (!recs.length) {
      wrap.innerHTML = '<p class="sc-empty">还没有判断记录。先在「今日思潮」完成你的第一个独立判断，7 / 30 / 90 天后回来接受现实检验。</p>';
      body.appendChild(wrap);
      return;
    }
    const avgConf = Math.round(recs.reduce((s, r) => s + (r.confidence || 70), 0) / recs.length);
    const revised = recs.filter(r => r.finalVerdict && r.firstVerdict && r.finalVerdict !== r.firstVerdict).length;
    const stats = document.createElement('div');
    stats.className = 'sc-stats';
    stats.innerHTML = `
      <div><b>${recs.length}</b><span>累计判断</span></div>
      <div><b>${avgConf}%</b><span>平均置信度</span></div>
      <div><b>${revised}</b><span>认知修正</span></div>
    `;
    wrap.appendChild(stats);

    for (const r of recs) {
      const card = document.createElement('div');
      card.className = 'sc-rec';
      const d7 = new Date(r.checkpoints?.d7 || (r.createdAt + 7 * 86400000)).toLocaleDateString('zh-CN');
      card.innerHTML = `
        <div class="sc-meta"><span>${r.domain || '思潮'}</span><span>复盘日 ${d7}</span></div>
        <strong class="sc-title"></strong>
        <p class="sc-sum">初判 ${r.firstVerdict} → 终判 ${r.finalVerdict} · 置信度 ${r.confidence}%${r.rationale ? ' · ' + r.rationale : ''}</p>
        <div class="sc-verify">
          ${[['hit', '现实支持'], ['partial', '部分成立'], ['miss', '现实证伪']].map(([k, lbl]) => `<button type="button" class="${r.realityStatus === k ? 'on' : ''}" data-st="${k}">${lbl}</button>`).join('')}
        </div>
      `;
      card.querySelector('.sc-title').textContent = r.title;
      card.querySelectorAll('[data-st]').forEach(b => {
        b.onclick = () => {
          r.realityStatus = b.dataset.st;
          saveRecords(recs);
          toast('已记录现实检验结果');
          render();
        };
      });
      wrap.appendChild(card);
    }
    body.appendChild(wrap);
  }

  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  return { open, close };
}
