// Zone 自然语言与语音直控引擎：离线优先（零延迟复合意图解析）+ 可选 AI 回退 + Web Speech 语音 / 前台唤醒词 + 一键撤销
// 严禁执行未白名单化的删除或外部发送操作；无密钥/离线时零网络请求。

import { aiConfigured, complete, transcribeAudio } from './ai.js';

const WAKE_KEY = 'rr-voice-wake';
const WAKE_RE = /^(?:hey\s+|hi\s+|你好\s*)?(?:zone|小域|小雨|小玉|小宇|小余|宗)[，,、。\s]*(.*)$/i;
const RESERVED_OPEN = /^(?:目录|书签|星海|星图|知识|笔记|摘录|护眼|深色|浅色|夜间|日间|双语|对照|翻译|语音|唤醒|立体|全图|设置|整理|搜索|AI|左手|左撇子|右手|右撇子|墨水屏|竖排|横排|舒眼|休息|朗读|听书)/i;

const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

const nativeVoice = () => (typeof window !== 'undefined' ? window.Capacitor?.Plugins?.ZoneVoice || null : null);

export const speechSupported = () => !!(nativeVoice() || SpeechRec);

/**
 * 容错模糊匹配（0 Token / 离线 / 抗语音识别错别字）
 * 例如语音把《黄仁勋传》听成「黄仁勋的再记」「黄仁勋专辑」，仍能高分精准命中。
 */
export function fuzzyScore(candidate, rawQuery) {
  const clean = s => String(s || '').toLowerCase()
    .replace(/[《》「」『』“”"'·•—\-_,，。！？!?\s:：()（）\[\]【】]/g, '');
  const cand = clean(candidate);
  let q = clean(rawQuery)
    .replace(/^(?:那本|这本|一本|关于|叫|名为)/, '')
    .replace(/(?:的(?:传记|再记|传|专辑|自传|小说|原著|电子书|书|那本书|这本书)|这本书|那本书|的书|一下|吧)$/, '');
  if (!cand || !q) return 0;
  if (cand === q) return 1000;
  if (cand.includes(q)) return 400 + q.length * 14 - Math.min(40, cand.length - q.length);
  if (q.includes(cand) && cand.length >= 2) return 320 + cand.length * 12;

  // 2-gram 重叠（极强抗语音尾部错字能力：「黄仁」「仁勋」双命中《黄仁勋传》）
  let biHits = 0;
  const qBi = Math.max(1, q.length - 1);
  for (let i = 0; i < q.length - 1; i++) {
    if (cand.includes(q.slice(i, i + 2))) biHits++;
  }
  // 有序公共子序列 + 单字重叠
  let lcs = 0, ci = 0;
  const candSet = new Set(cand);
  let charHits = 0;
  for (const ch of q) {
    if (candSet.has(ch)) charHits++;
    const idx = cand.indexOf(ch, ci);
    if (idx >= 0) { lcs++; ci = idx + 1; }
  }
  const ratio = charHits / q.length;
  const candRatio = charHits / Math.max(1, cand.length);
  if (biHits === 0 && (charHits < 2 || ratio < 0.5)) return 0;
  if (biHits === 0 && q.length >= 4 && ratio < 0.6) return 0;
  return biHits * 68 + lcs * 24 + ratio * 80 + candRatio * 45;
}

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function parseCnNum(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  const n = total + cur;
  return n > 0 ? n : null;
}

function splitClauses(raw) {
  const s = String(raw || '').trim().replace(/[。！？!?]+$/g, '').trim();
  if (!s) return [];
  // 整句记想法/笔记时保留完整正文，不被句中逗号切碎
  if (/^(?:帮我|请)?(?:记一条?笔记|写一条?笔记|记笔记|记一下|记下来|我有?个?想法|写一条?想法|写个?想法|想法|灵感|批注|记录)[：:，,\s]+/.test(s)) {
    return [s];
  }
  // 引号感知分句：保护「」『』“”""《》内部不被切开
  const parts = [];
  let buf = '', depth = 0;
  const OPEN = new Set(['「', '『', '“', '《']);
  const CLOSE = new Set(['」', '』', '”', '》']);
  let inAsciiQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inAsciiQuote = !inAsciiQuote; buf += ch; continue; }
    if (OPEN.has(ch)) { depth++; buf += ch; continue; }
    if (CLOSE.has(ch)) { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (depth === 0 && !inAsciiQuote && /[，,；;。]/.test(ch)) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  // 进一步按中文连词（并且/并/然后/接着/顺便/同时/再）切分未加逗号的多步指令
  const out = [];
  const connRe = /\s*(?:并且|然后|接着|顺便|同时|以及|and\s+then|\bthen\b|并(?=(?:帮我|给我|打开|翻开|阅读|看|去|调|改|换|关|开|把|给|记|写|搜|找|跳|翻|导入|探索|放大|缩小))|再(?=(?:帮我|给我|打开|翻开|阅读|看|去|调|改|换|关|开|把|给|记|写|搜|找|跳|翻|导入|探索|放大|缩小)))\s*/i;
  for (const part of parts) {
    // 若该片段含批注/想法正文，保持完整（如「把第2行摘抄并批注：很棒」）
    if (/(?:划线|高亮|标记|摘抄|摘录).{0,6}(?:批注|想法|备注|笔记)[：:\s]/.test(part) ||
        /^(?:帮我|请)?(?:记一条?笔记|写一条?笔记|记笔记|记一下|记下来|我有?个?想法|写一条?想法|写个?想法|想法|灵感|批注|记录)[：:\s]/.test(part)) {
      out.push(part);
      continue;
    }
    for (const sub of part.split(connRe)) {
      const clean = sub.trim();
      if (clean) out.push(clean);
    }
  }
  return out;
}

function parseSingleClause(rawClause, ctx = {}) {
  const text = String(rawClause || '').trim()
    .replace(/^(?:请|麻烦|帮我|给我|先|再|然后|并且|并|接着|顺便|同时)\s*/g, '')
    .replace(/^(?:帮我|给我|请)\s*/g, '')
    .trim();
  if (!text) return [];
  const ops = [];
  const reading = !!ctx.reading;
  const inGraph = !reading && ctx.pane === 'graph';

  // 1. 撤销
  if (/^(?:撤销|撤回|恢复刚才|恢复原样|改回去|算了|undo)$/i.test(text)) {
    return [{ op: 'undo' }];
  }

  // 2. 语音唤醒开关
  if (/(?:开|打开|开启|启动).{0,3}(?:语音)?唤醒/.test(text)) { ops.push({ op: 'wake', on: true }); return ops; }
  if (/(?:关|关闭|关掉|停止|取消).{0,3}(?:语音)?唤醒/.test(text)) { ops.push({ op: 'wake', on: false }); return ops; }

  // 3. 语音划线 / 高亮 / 摘抄
  const markVerbRe = /(?:划线|高亮|标记|摘抄|摘录|标出来)/;
  if (markVerbRe.test(text) && !/^(?:看划线|打开划线|看摘录|打开摘录|我的摘录|本章划线|本书划线)$/.test(text)) {
    const kind = /(?:批注|想法|评论)/.test(text) ? 'annotation' : /(?:摘抄|摘录)/.test(text) ? 'excerpt' : 'highlight';
    const notePart = text.match(/(?:并|加|写|记)?(?:批注|想法|备注|笔记)[：:\s]*(.+)$/);
    const note = notePart ? notePart[1].trim() : '';
    const quoted = text.match(/[「『“"《]([^」』”"》]{1,80})[」』”"》]/);
    const lineM = text.match(/第\s*([0-9一二两三四五六七八九十百]+)\s*(?:行|句)/);
    const paraM = text.match(/第\s*([0-9一二两三四五六七八九十百]+)\s*段/);
    const tailM = !quoted && !lineM && !paraM
      ? text.match(/(?:把|给|将)\s*([^，。！？,!?]{1,30}?)\s*(?:标记|划线|高亮|摘抄|摘录|标出来)/)
      : null;
    const targetQuery = quoted ? quoted[1].trim()
      : (tailM && !/^(?:这页|当前页|这段|这句|全部)$/.test(tailM[1].trim()) ? tailM[1].trim() : '');
    const line = lineM ? parseCnNum(lineM[1]) : null;
    const paragraph = paraM ? parseCnNum(paraM[1]) : null;
    const bookPrefix = text.match(/^(?:打开|去|翻开)\s*[《「]?([^，。！？,!?第》」]{1,28})[》」]?/);
    if (bookPrefix && bookPrefix[1].trim() && !RESERVED_OPEN.test(bookPrefix[1].trim())) {
      ops.push({ op: 'openBook', query: bookPrefix[1].trim() });
    }
    const pageM = text.match(/第\s*([0-9一二两三四五六七八九十百]+)\s*页/);
    const chapM = text.match(/第\s*([0-9一二两三四五六七八九十百]+)\s*(?:章|节|回)/);
    if (pageM) { const p = parseCnNum(pageM[1]); if (p) ops.push({ op: 'goPage', page: p }); }
    else if (chapM) { const c = parseCnNum(chapM[1]); if (c) ops.push({ op: 'goChapter', index: c }); }
    ops.push({ op: 'voiceMark', kind, query: targetQuery, line, paragraph, note });
    return ops;
  }

  // 4. 记笔记 / 写想法 / 语音记灵感
  const noteMatch = text.match(/^(?:记一条?笔记|写一条?笔记|记笔记|记一下|记下来|我有?个?想法|写一条?想法|写个?想法|想法|灵感|批注|记录)[：:，,\s]*(.*)$/);
  if (noteMatch) {
    ops.push({ op: 'createNote', text: noteMatch[1].trim() });
    return ops;
  }
  if (/(?:写判断|新建判断|做个?判断|决策笔记)/.test(text)) {
    ops.push({ op: 'newDecision' });
    return ops;
  }

  // 5. 导入书籍 / 文件 / 网页文章 / AI 找书 / 配置书源
  const urlOnly = text.match(/^(?:(?:导入|抓取|收藏|阅读)(?:网页|文章|链接)?\s*)?(https?:\/\/\S+)$/i);
  if (urlOnly) {
    ops.push({ op: 'importUrl', url: urlOnly[1].trim() });
    return ops;
  }
  const opdsSet = text.match(/^(?:配置|设置|绑定)(?:书源|OPDS|个人书库)\s*(https?:\/\/\S+)$/i);
  if (opdsSet) {
    ops.push({ op: 'setOpds', url: opdsSet[1].trim() });
    return ops;
  }
  const findBookM = text.match(/^(?:搜书|找书|帮我找|帮我搜|搜一下|找一本|下载一本?|导入一本?)\s*[《「]?([^，。！？,!?》」]{1,36})[》」]?$/)
    || text.match(/^(?:找|搜)\s*[《「]([^，。！？,!?》」]{1,36})[》」]$/);
  if (findBookM && findBookM[1].trim() && !/^(?:本地|文件|书|书籍|资料|电子书)$/.test(findBookM[1].trim())) {
    ops.push({ op: 'findBook', query: findBookM[1].trim() });
    return ops;
  }
  if (/(?:导入|传一本?|添加).{0,4}(?:书|书籍|文件|资料|电子书|本地)|^导入$/.test(text)) {
    ops.push({ op: 'importBooks' });
    return ops;
  }

  // 6. 星海语音探索
  if (/(?:探索星海|带我逛星海|漫游星海|逛逛星海|随便看看|随机一颗星|随机探索)/.test(text)) {
    ops.push({ op: 'cosmosExplore', mode: 'tour' });
    return ops;
  }
  if (/(?:探索暗域|找孤立|孤立的?笔记|未连接|暗域|孤星)/.test(text)) {
    ops.push({ op: 'cosmosExplore', mode: 'frontier' });
    return ops;
  }
  if (/(?:展开关联|聚焦邻域|看看?航线|看看?关联|看相关|附近有啥|周围有什么)/.test(text)) {
    ops.push({ op: 'cosmosNeighbors' });
    return ops;
  }
  const linkM = text.match(/^(?:把这颗星|把它)?(?:连到|连接到|关联到?|和)\s*[《「]?([^，。！？,!?》」]{1,28})[》」]?(?:建立连接|连起来|关联)?$/);
  if (linkM && inGraph && linkM[1].trim()) {
    ops.push({ op: 'cosmosLink', target: linkM[1].trim() });
    return ops;
  }
  const flyM = text.match(/^(?:飞到|飞向|定位到?|看看关于|去看看?)\s*[《「]?([^，。！？,!?》」]{1,28})[》」]?(?:星域|那颗星|的星)?$/);
  if (flyM && (inGraph || /星/.test(text)) && flyM[1].trim() && !RESERVED_OPEN.test(flyM[1].trim())) {
    ops.push({ op: 'cosmosFocus', query: flyM[1].trim() });
    return ops;
  }
  if (inGraph && /^(?:下一颗|下一个|换一颗|继续探索|再看一颗)$/.test(text)) {
    ops.push({ op: 'cosmosExplore', mode: 'next' });
    return ops;
  }
  if ((inGraph || /星海|星图/.test(text)) && !/字/.test(text)) {
    if (/(?:放大|拉近|近一点)/.test(text)) { ops.push({ op: 'cosmosZoom', factor: 1.48 }); return ops; }
    if (/(?:缩小|拉远|远一点)/.test(text)) { ops.push({ op: 'cosmosZoom', factor: 0.68 }); return ops; }
  }

  // 7. 字号调节
  const exactSize = text.match(/(?:字号|字体大小|字)\s*(?:调到|设为|改成|调成|设置成|为|到)?\s*(\d{2})\b/);
  if (exactSize) {
    ops.push({ op: 'fontSize', value: Math.max(12, Math.min(40, Number(exactSize[1]))) });
  } else if (/(?:默认字号|恢复字号|字号复原)/.test(text)) {
    ops.push({ op: 'fontSize', value: 19 });
  } else if (/(?:字.{0,3}(?:大|放大|增|加)|放大(?:字|一点)|字太小|看不清|larger\s*font|bigger\s*font)/i.test(text)) {
    ops.push({ op: 'fontSize', delta: /(?:很多|大大|两号|多一点)/.test(text) ? 4 : 2 });
  } else if (/(?:字.{0,3}(?:小|缩小|减)|缩小(?:字|一点)|字太大|smaller\s*font)/i.test(text)) {
    ops.push({ op: 'fontSize', delta: /(?:很多|小小|两号|多一点)/.test(text) ? -4 : -2 });
  }

  // 8. 字体切换
  if (/(?:楷体|文楷|楷书|手写体)/.test(text)) ops.push({ op: 'font', value: 'kai' });
  else if (/(?:宋体|衬线|明体)/.test(text)) ops.push({ op: 'font', value: 'serif' });
  else if (/(?:黑体|无衬线)/.test(text)) ops.push({ op: 'font', value: 'sans' });
  else if (/(?:原书字体|原字体)/.test(text)) ops.push({ op: 'font', value: 'original' });

  // 9. 行距
  if (/(?:行距.{0,3}(?:宽|松|大)|宽松|行间距大|松一点)/.test(text)) ops.push({ op: 'lineHeight', value: 2.1 });
  else if (/(?:行距.{0,3}(?:紧|小|窄|密)|紧凑|密一点)/.test(text)) ops.push({ op: 'lineHeight', value: 1.5 });
  else if (/(?:行距.{0,3}(?:适中|默认|正常))/.test(text)) ops.push({ op: 'lineHeight', value: 1.8 });

  // 10. 墨水屏 / 左手模式 / 上下翻页 / 台湾传统竖排 / 护眼 / 阅读主题 / 应用深浅外观
  if (/(?:关|关闭|关掉|取消|退出).{0,4}(?:墨水屏|电子墨水|水墨屏|电纸书|e-?ink)/i.test(text)) {
    ops.push({ op: 'eink', on: false });
  } else if (/(?:墨水屏|电子墨水|水墨屏|电纸书|e-?ink)/i.test(text)) {
    ops.push({ op: 'eink', on: true });
  }

  if (/(?:关|关闭|关掉|取消|退出).{0,4}(?:左手|左撇子)|(?:右手模式|右撇子|右手习惯|右手阅读|右手操作|恢复右手|切换右手|惯用右手|开右手)/.test(text)) {
    ops.push({ op: 'leftHand', on: false });
  } else if (/(?:左手模式|左撇子|左手习惯|左手阅读|左手操作|切换左手|开左手)/.test(text)) {
    ops.push({ op: 'leftHand', on: true });
  }

  // 10b. 缓解视觉疲劳：舒眼一键排版 / 20 秒远眺呼吸小憩 / 闭眼听书朗读
  if (/(?:眼睛累|看累了|视觉疲劳|缓解疲劳|舒眼模式|柔和一点|放松眼睛)/.test(text)) {
    ops.push({ op: 'eyeComfort' });
  }
  if (/(?:休息一下|护眼小憩|远眺休息|歇一会|歇一会儿)/.test(text)) {
    ops.push({ op: 'eyeRest' });
    return ops;
  }
  if (/(?:停止|关闭|关掉|取消|别|不要).{0,3}(?:朗读|听书|读了|语音阅读)/.test(text)) {
    ops.push({ op: 'tts', on: false });
    return ops;
  } else if (/(?:读给我听|开始朗读|朗读这一?页|朗读|听书模式|听书|帮我读)/.test(text)) {
    ops.push({ op: 'tts', on: true });
    return ops;
  }

  if (/(?:上下翻页|上下滚动|竖向翻页|滚动阅读|上下滑动)/.test(text)) {
    ops.push({ op: 'flow', value: 'scrolled' });
  } else if (/(?:左右翻页|横向翻页|分页模式|左右滑动|恢复分页)/.test(text)) {
    ops.push({ op: 'flow', value: 'paginated' });
  }

  if (/(?:关|关闭|关掉|取消|退出).{0,3}竖排|(?:横排|横向排版|恢复横排|从左往右)/.test(text)) {
    ops.push({ op: 'writing', value: 'horizontal' });
  } else if (/(?:竖排|竖向排版|台湾排版|台版|古籍排版|古代排版|繁体竖排|从右往左)/.test(text)) {
    ops.push({ op: 'writing', value: 'vertical-rl' });
  }

  if (/(?:关|关闭|关掉|取消|退出).{0,4}(?:护眼|暖色|羊皮纸)/.test(text)) {
    ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:护眼|暖色|泛黄|米黄|羊皮纸|sepia)/i.test(text)) {
    ops.push({ op: 'readTheme', value: 'sepia' });
  } else if (/(?:纸张|纸色|自然纸)/.test(text)) {
    ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:纯白|白底|白色背景)/.test(text)) {
    ops.push({ op: 'readTheme', value: 'white' });
  }

  if (/(?:关|关闭|关掉|取消|退出).{0,4}(?:深色|暗色|夜间|黑夜|暗黑)/.test(text)) {
    ops.push({ op: 'appearance', value: 'light' });
    if (!ops.some(o => o.op === 'readTheme')) ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:关|关闭|关掉|取消|退出).{0,4}(?:浅色|亮色|日间|白天)/.test(text)) {
    ops.push({ op: 'appearance', value: 'dark' });
    if (reading) ops.push({ op: 'readTheme', value: 'night' });
  } else if (/(?:深色|暗色|夜间|黑夜|暗黑|关灯|dark\s*mode)/i.test(text)) {
    ops.push({ op: 'appearance', value: 'dark' });
    if (reading || /(?:夜间阅读|暗夜阅读|关灯|阅读)/.test(text)) ops.push({ op: 'readTheme', value: 'night' });
  } else if (/(?:浅色|亮色|日间|白天模式|light\s*mode)/i.test(text)) {
    ops.push({ op: 'appearance', value: 'light' });
    if (reading && !ops.some(o => o.op === 'readTheme')) ops.push({ op: 'readTheme', value: 'paper' });
  } else if (/(?:跟随系统|自动外观|系统外观)/.test(text)) {
    ops.push({ op: 'appearance', value: 'system' });
  }

  // 11. 中英对照 / 自动翻译
  if (/(?:关|关闭|关掉|取消|停止|只看原文).{0,4}(?:中英|对照|双语|自动?翻译|翻译)?/.test(text) && /(?:中英|对照|双语|翻译|只看原文)/.test(text)) {
    ops.push({ op: 'bilingual', on: false });
  } else if (/(?:自动翻译|中英对照|双语对照|开启?双语|打开翻译|帮我翻译|翻译一下)/.test(text) || /(?:开|打开|开启).{0,3}(?:中英|对照|双语|翻译)/.test(text)) {
    ops.push({ op: 'bilingual', on: true });
  }

  // 11b. 自适应阅读速度 / 自动翻页（不要太快也不要太慢 / 按我的阅读速度）
  if (/(?:停止|关闭|关掉|取消|暂停).{0,4}(?:自动翻页|自动阅读|自动滚动|自动看)/.test(text)) {
    ops.push({ op: 'autoPace', on: false });
  } else if (/(?:自动翻页|自动阅读|按我的?(?:阅读)?速度|根据我的?(?:阅读)?速度|不要太快|别太快|适中速度)/.test(text)) {
    const speed = /(?:慢一点|稍慢|慢些)/.test(text) ? 'slower' : /(?:快一点|稍快|快些)/.test(text) ? 'faster' : 'auto';
    ops.push({ op: 'autoPace', on: true, speed });
  } else if (reading && /(?:翻页|阅读速度).{0,3}(?:慢一点|放慢|慢些)/.test(text)) {
    ops.push({ op: 'autoPace', on: true, speed: 'slower' });
  } else if (reading && /(?:翻页|阅读速度).{0,3}(?:快一点|加快|快些)/.test(text)) {
    ops.push({ op: 'autoPace', on: true, speed: 'faster' });
  }

  // 12. 复合打开书 + 序数（第一本/第三本/倒数第二本/最后一本）+ 跳页 / 跳章
  if (!ops.length) {
    const openCompound = text.match(/^(?:打开|阅读|继续看|继续读|想看|读一下|读|翻开|看)\s*[《「]?([^，。！？,!?》」]{1,36})[》」]?$/);
    if (openCompound && openCompound[1].trim()) {
      let rawTarget = openCompound[1].trim();
      let page = null, chapter = null;
      const pTail = rawTarget.match(/^(.*?)\s*(?:的)?第\s*([0-9一二两三四五六七八九十百]+)\s*页$/);
      const cTail = !pTail && rawTarget.match(/^(.*?)\s*(?:的)?第\s*([0-9一二两三四五六七八九十百]+)\s*(?:章|节|回)$/);
      if (pTail) { rawTarget = pTail[1].trim(); page = parseCnNum(pTail[2]); }
      else if (cTail) { rawTarget = cTail[1].trim(); chapter = parseCnNum(cTail[2]); }

      const revOrd = rawTarget.match(/^倒数第?\s*([0-9一二两三四五六七八九十百]+)\s*本?书?$/);
      const lastOrd = /^(?:最后一本|最后一本书|最下面那本|最底部那本|末尾那本)$/.test(rawTarget);
      const fwdOrd = !revOrd && rawTarget.match(/^第\s*([0-9一二两三四五六七八九十百]+)\s*本(?:书)?$/);
      if (lastOrd) {
        ops.push({ op: 'openBook', index: -1 });
      } else if (revOrd) {
        const n = parseCnNum(revOrd[1]);
        if (n) ops.push({ op: 'openBook', index: -n });
      } else if (fwdOrd) {
        const n = parseCnNum(fwdOrd[1]);
        if (n) ops.push({ op: 'openBook', index: n });
      } else if (/^(?:一本书|本书|随便一本书|任意一本书|最近(?:看|读)?的?书|上一本书)$/.test(rawTarget)) {
        ops.push({ op: 'openBook', query: '' });
      } else if (rawTarget && !RESERVED_OPEN.test(rawTarget)) {
        ops.push({ op: 'openBook', query: rawTarget });
      }
      if (ops.length) {
        if (page) ops.push({ op: 'goPage', page });
        if (chapter) ops.push({ op: 'goChapter', index: chapter });
        return ops;
      }
    }
  }

  // 13. 阅读翻页 / 跳页 / 跳章 / 百分比 / 书签（含「为第N页添加一个标签」）/ 目录 / 退出阅读
  if (/(?:下一页|往后翻|翻一页|向后翻|翻页|next\s*page)/i.test(text)) ops.push({ op: 'turn', delta: 1 });
  else if (/(?:上一页|往前翻|回上一页|向前翻|prev\s*page)/i.test(text)) ops.push({ op: 'turn', delta: -1 });
  const pct = text.match(/(?:跳到|翻到|去|进度)?\s*第?\s*(\d{1,3})\s*%/);
  const goP = !pct && text.match(/(?:跳到|翻到|去|看|为|给)?\s*第\s*([0-9一二两三四五六七八九十百]+)\s*页/);
  const goC = !pct && !goP && text.match(/(?:跳到|翻到|去|看|为|给)?\s*第\s*([0-9一二两三四五六七八九十百]+)\s*(?:章|节|回)/);
  if (pct) ops.push({ op: 'seek', fraction: Math.max(0, Math.min(1, Number(pct[1]) / 100)) });
  else if (goP) { const p = parseCnNum(goP[1]); if (p) ops.push({ op: 'goPage', page: p }); }
  else if (goC) { const c = parseCnNum(goC[1]); if (c) ops.push({ op: 'goChapter', index: c }); }
  else if (/(?:回到开头|从头看|第一页)/.test(text)) ops.push({ op: 'seek', fraction: 0 });
  if (/(?:加书签|加个?书签|添加(?:一个?)?(?:书签|标签)|打个?(?:书签|标签)|收藏这页|记个?书签|加个?标签)/.test(text)) ops.push({ op: 'bookmark' });
  if (/(?:打开目录|看目录|显示目录|^目录$)/.test(text)) ops.push({ op: 'toc' });
  if (/(?:看书签|打开书签|书签列表)/.test(text)) ops.push({ op: 'bookmarks' });
  if (/(?:看划线|打开划线|本章划线|本书划线)/.test(text)) ops.push({ op: 'highlights' });
  if (/(?:退出阅读|关闭这?本书|返回列表|回到书单|不看了)/.test(text)) ops.push({ op: 'closeBook' });

  // 14. 星海天色与视角
  let graphHint = false;
  if (/(?:2\.5d|立体|三维|倾斜视角)/i.test(text)) { ops.push({ op: 'graphTilt', on: true }); graphHint = true; }
  else if (/(?:平视|平面视角|关闭立体|取消立体|二维)/.test(text)) { ops.push({ op: 'graphTilt', on: false }); graphHint = true; }
  if (/(?:适应全图|看全图|全图|复位星海|星海复位)/.test(text)) { ops.push({ op: 'graphFit' }); graphHint = true; }
  if (/(?:晨曦|印象日出|日出天色|清晨|早晨)/.test(text)) { ops.push({ op: 'graphMood', value: 'dawn' }); graphHint = true; }
  else if (/(?:晴蓝|晴空|睡莲|正午)/.test(text)) { ops.push({ op: 'graphMood', value: 'day' }); graphHint = true; }
  else if (/(?:暮色|黄昏|晚霞|日落)/.test(text)) { ops.push({ op: 'graphMood', value: 'dusk' }); graphHint = true; }
  else if (/(?:星夜|梵高|深夜天色)/.test(text)) { ops.push({ op: 'graphMood', value: 'night' }); graphHint = true; }
  else if (/(?:随时辰|随时间|自动天色|按时间变化)/.test(text)) { ops.push({ op: 'graphMood', value: 'auto' }); graphHint = true; }

  // 15. 空间切换
  if (/(?:去星海|看星海|打开星海|星海|星图)/.test(text)) ops.push({ op: 'pane', value: 'graph' });
  else if (/(?:看知识|去知识|知识库|看笔记|笔记列表)/.test(text)) ops.push({ op: 'pane', value: 'knowledge' });
  else if (/(?:回到流|去流|回首页|看列表|看流)/.test(text)) ops.push({ op: 'pane', value: 'shelf' });
  else if (graphHint && !reading && ctx.pane !== 'graph') ops.unshift({ op: 'pane', value: 'graph' });

  // 16. 整理 / 摘录 / 导出大纲 / AI 设置 / 按需打开手动排版
  if (/(?:打开排版|手动排版|排版设置|调排版)/.test(text)) ops.push({ op: 'openSettings' });
  if (/(?:进入整理|整理列表|多选|建堆)/.test(text)) ops.push({ op: 'selectMode' });
  if (/(?:看摘录|打开摘录|我的摘录)/.test(text)) ops.push({ op: 'excerpts' });
  if (/(?:复制大纲|导出大纲|导出笔记)/.test(text)) ops.push({ op: 'exportOutline' });
  if (/(?:AI\s*设置|配置\s*AI|设置密钥)/i.test(text)) ops.push({ op: 'aiSettings' });

  // 17. 搜索
  if (!ops.length) {
    const findM = text.match(/^(?:搜索|查找|搜一下|搜|找一下|找)\s*(.+)$/);
    if (findM && findM[1].trim()) {
      ops.push({ op: 'search', query: findM[1].trim() });
    }
  }

  return ops;
}

/**
 * 将一句自然中文/英文（支持任意多步串行复合指令）解析为有序原子操作列表。
 * 例如：「关闭护眼模式，并打开一本书」「开护眼，字大一点，再打开砂女第2章，把第1行划线」
 */
export function parseNaturalCommands(raw, ctx = {}) {
  const clauses = splitClauses(raw);
  if (!clauses.length) return [];
  const all = [];
  const vCtx = { reading: !!ctx.reading, pane: ctx.pane || 'shelf' };
  for (const clause of clauses) {
    const part = parseSingleClause(clause, vCtx);
    for (const op of part) {
      all.push(op);
      if (op.op === 'openBook') vCtx.reading = true;
      else if (op.op === 'closeBook') vCtx.reading = false;
      else if (op.op === 'pane') { vCtx.reading = false; vCtx.pane = op.value; }
      else if (op.op === 'cosmosExplore' || op.op === 'cosmosFocus' || op.op === 'graphMood' || op.op === 'graphTilt') {
        vCtx.reading = false; vCtx.pane = 'graph';
      }
    }
  }
  return all;
}

const SAFE_OPS = new Set([
  'undo', 'wake', 'fontSize', 'font', 'lineHeight', 'readTheme', 'appearance',
  'eink', 'leftHand', 'flow', 'writing',
  'bilingual', 'autoPace', 'turn', 'seek', 'goPage', 'goChapter', 'voiceMark', 'bookmark', 'toc', 'bookmarks', 'highlights', 'closeBook', 'openSettings',
  'pane', 'graphTilt', 'graphFit', 'graphMood', 'openBook', 'createNote', 'search', 'exportOutline', 'importBooks',
  'cosmosExplore', 'cosmosNeighbors', 'cosmosFocus', 'cosmosLink', 'cosmosZoom'
]);

async function aiFallbackPlan(text, ctx) {
  if (!aiConfigured()) return [];
  const sys = `你是 Zone 应用的静默意图解析器。把用户的话翻译成严格 JSON 数组（只输出 JSON，不要解释）。
允许的 op：
- {"op":"fontSize","delta":2} 或 {"op":"fontSize","value":22}
- {"op":"font","value":"serif"|"kai"|"sans"|"original"}
- {"op":"lineHeight","value":1.5|1.8|2.1}
- {"op":"readTheme","value":"paper"|"white"|"sepia"|"night"}
- {"op":"appearance","value":"light"|"dark"|"system"}
- {"op":"bilingual","on":true|false}
- {"op":"turn","delta":1|-1} / {"op":"seek","fraction":0..1} / {"op":"goPage","page":12} / {"op":"goChapter","index":3}
- {"op":"voiceMark","kind":"highlight"|"excerpt"|"annotation","query":"关键词","line":2,"paragraph":1,"note":"批注"}
- {"op":"bookmark"} / {"op":"toc"} / {"op":"bookmarks"} / {"op":"highlights"} / {"op":"closeBook"} / {"op":"openSettings"}
- {"op":"pane","value":"shelf"|"knowledge"|"graph"} / {"op":"importBooks"}
- {"op":"graphTilt","on":true|false} / {"op":"graphFit"} / {"op":"graphMood","value":"auto"|"dawn"|"day"|"dusk"|"night"}
- {"op":"cosmosExplore","mode":"tour"|"next"|"frontier"} / {"op":"cosmosFocus","query":"关键词"} / {"op":"cosmosNeighbors"} / {"op":"cosmosLink","target":"目标星"} / {"op":"cosmosZoom","factor":1.45}
- {"op":"openBook","query":"书名"} / {"op":"createNote","text":"内容"} / {"op":"search","query":"词"} / {"op":"exportOutline"} / {"op":"undo"}
若无法映射到上述操作，返回 []。`;
  try {
    const out = await complete([
      { role: 'system', content: sys },
      { role: 'user', content: `当前状态：${ctx.reading ? '阅读中' : '主界面(' + (ctx.pane || 'shelf') + ')'}\n用户说：${text}` }
    ]);
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed.filter(a => a && SAFE_OPS.has(a.op)).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function createCommandController(host) {
  const undoStack = [];
  let wakeOn = false;
  let activeRec = null;
  let wakeRec = null;
  let wakeTimer = null;
  let listening = false;
  let nativeBound = false;

  const setBarListening = on => {
    listening = !!on;
    document.getElementById('command-bar')?.classList.toggle('listening', listening);
    document.getElementById('spatial-bar')?.classList.toggle('listening', listening);
    document.getElementById('reader-cmd-bar')?.classList.toggle('listening', listening);
    const mic = document.getElementById('cmd-mic');
    if (mic) mic.setAttribute('aria-pressed', listening ? 'true' : 'false');
  };

  const syncWakeUi = () => {
    const btn = document.getElementById('cmd-wake');
    if (btn) {
      btn.setAttribute('aria-pressed', wakeOn ? 'true' : 'false');
      btn.textContent = wakeOn ? '唤醒 · 开' : '唤醒';
    }
    document.getElementById('spatial-bar')?.classList.toggle('wake-on', wakeOn);
    document.getElementById('reader-cmd-bar')?.classList.toggle('wake-on', wakeOn);
  };

  const showVoiceError = code => {
    if (code === 'CANCELLED') return;
    if (code === 'NO_PERMISSION' || code === 'not-allowed') {
      host.toast('请在系统设置中允许麦克风权限，或直接打字输入', 3200);
      return;
    }
    if (code === 'NO_SPEECH_SERVICE' || code === 'service-not-allowed') {
      const inp = document.getElementById('cmd-input');
      if (inp) {
        inp.placeholder = '点键盘麦克风直接说话，或配 AI 密钥启用内置麦';
        inp.focus();
      }
      host.toast('请点键盘语音键说话，或在 AI 设置填入密钥启用内置录音', 2800);
      return;
    }
    if (code === 'NETWORK' || code === 'network') {
      host.toast('系统语音识别需要联网，可直接打字执行', 3000);
      return;
    }
    if (code === 'NO_MATCH' || code === 'no-speech') {
      host.toast('没听清，再说一次或直接输入', 2400);
    }
  };

  const bindNativeVoice = () => {
    const nv = nativeVoice();
    if (!nv || nativeBound || typeof nv.addListener !== 'function') return nv;
    nativeBound = true;
    nv.addListener('state', ev => setBarListening(!!ev?.listening));
    nv.addListener('partial', ev => {
      const inp = document.getElementById('cmd-input');
      if (inp && ev?.text) inp.value = ev.text;
    });
    nv.addListener('result', ev => {
      const said = String(ev?.text || '').trim();
      if (!said) return;
      if (ev.wake) {
        const m = said.match(WAKE_RE);
        if (!m) return;
        const rest = (m[1] || '').trim();
        if (rest) run(rest);
        else openBar({ listen: true });
      } else {
        const inp = document.getElementById('cmd-input');
        if (inp) inp.value = said;
        const clean = said.replace(WAKE_RE, '$1').trim() || said;
        run(clean);
      }
    });
    nv.addListener('error', ev => {
      if (ev?.wake && (ev.code === 'NO_PERMISSION' || ev.code === 'NO_SPEECH_SERVICE')) {
        wakeOn = false;
        try { localStorage.setItem(WAKE_KEY, '0'); } catch {}
        syncWakeUi();
      }
      showVoiceError(ev?.code);
    });
    return nv;
  };

  function stopWake() {
    clearTimeout(wakeTimer);
    if (wakeRec) { try { wakeRec.onend = null; wakeRec.stop(); } catch {} wakeRec = null; }
  }

  function startWakeLoop() {
    if (nativeVoice()) return;
    if (!wakeOn || !SpeechRec || listening || document.hidden) return;
    stopWake();
    try {
      const rec = new SpeechRec();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const said = (e.results[i][0]?.transcript || '').trim();
          const m = said.match(WAKE_RE);
          if (!m) continue;
          const rest = (m[1] || '').trim();
          if (rest) {
            run(rest);
          } else {
            openBar({ listen: true });
          }
          break;
        }
      };
      rec.onerror = err => {
        if (err?.error === 'not-allowed' || err?.error === 'service-not-allowed') {
          setWake(false, true);
          showVoiceError(err.error);
        }
      };
      rec.onend = () => {
        wakeRec = null;
        if (wakeOn && !listening && !document.hidden) {
          wakeTimer = setTimeout(startWakeLoop, 450);
        }
      };
      wakeRec = rec;
      rec.start();
    } catch {
      wakeRec = null;
    }
  }

  async function setWake(on, silent = false) {
    const nv = bindNativeVoice();
    if (nv) {
      try {
        const res = await nv.setWake({ on: !!on });
        wakeOn = !!res?.on;
        try { localStorage.setItem(WAKE_KEY, wakeOn ? '1' : '0'); } catch {}
        syncWakeUi();
        if (!wakeOn && on && !silent) showVoiceError(res?.code || 'NO_SPEECH_SERVICE');
        return wakeOn === !!on;
      } catch {
        wakeOn = false;
        syncWakeUi();
        if (on && !silent) showVoiceError('NO_SPEECH_SERVICE');
        return false;
      }
    }
    if (on && !SpeechRec) {
      if (!silent) host.toast('当前环境不支持语音唤醒，可直接点选或输入指令');
      wakeOn = false;
      syncWakeUi();
      return false;
    }
    wakeOn = !!on;
    try { localStorage.setItem(WAKE_KEY, wakeOn ? '1' : '0'); } catch {}
    syncWakeUi();
    if (wakeOn) startWakeLoop(); else stopWake();
    return true;
  }

  let nativeRecActive = false;

  async function stopListening() {
    const nv = nativeVoice();
    if (nv) {
      if (nativeRecActive) {
        nativeRecActive = false;
        setBarListening(false);
        try {
          const rec = await nv.stopRecording();
          if (rec?.ok && rec.base64) {
            host.toast('正在转写语音…', 2400);
            const said = await transcribeAudio(rec.base64, rec.mimeType || 'audio/mp4');
            if (said) {
              const inp = document.getElementById('cmd-input');
              if (inp) inp.value = said;
              const clean = said.replace(WAKE_RE, '$1').trim() || said;
              run(clean);
            } else {
              host.toast('没听清，再说一次吧', 2200);
            }
          }
        } catch (err) {
          host.toast(err?.message || '语音转写失败，可用键盘语音输入', 2800);
        }
        return;
      }
      try { nv.stopListening(); } catch {}
      setBarListening(false);
      return;
    }
    if (activeRec) { try { activeRec.stop(); } catch {} activeRec = null; }
    setBarListening(false);
    if (wakeOn) startWakeLoop();
  }

  async function startListening() {
    const nv = bindNativeVoice();
    if (nv) {
      if (listening || nativeRecActive) { await stopListening(); return false; }
      try {
        const res = await nv.startListening();
        if (res?.started) return true;
        if (res?.code === 'NO_SPEECH_SERVICE' && aiConfigured() && typeof nv.startRecording === 'function') {
          const rec = await nv.startRecording();
          if (rec?.started) {
            nativeRecActive = true;
            setBarListening(true);
            host.toast('正在录音，说完轻点麦克风', 2200);
            return true;
          }
        }
        setBarListening(false);
        showVoiceError(res?.code || 'NO_SPEECH_SERVICE');
        return false;
      } catch {
        setBarListening(false);
        showVoiceError('NO_SPEECH_SERVICE');
        return false;
      }
    }
    if (!SpeechRec) {
      host.toast('当前环境不支持语音，可直接输入指令', 2600);
      document.getElementById('cmd-input')?.focus();
      return false;
    }
    stopWake();
    if (activeRec) { stopListening(); return false; }
    const input = document.getElementById('cmd-input');
    try {
      const rec = new SpeechRec();
      rec.lang = 'zh-CN';
      rec.continuous = false;
      rec.interimResults = true;
      let latest = '';
      rec.onstart = () => setBarListening(true);
      rec.onresult = e => {
        let interim = '', fin = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0]?.transcript || '';
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        latest = (fin || interim).trim();
        if (input && latest) input.value = latest;
        if (fin.trim()) {
          const clean = fin.trim().replace(WAKE_RE, '$1').trim() || fin.trim();
          stopListening();
          run(clean);
        }
      };
      rec.onerror = err => {
        setBarListening(false);
        activeRec = null;
        showVoiceError(err?.error);
        if (wakeOn) startWakeLoop();
      };
      rec.onend = () => {
        activeRec = null;
        setBarListening(false);
        if (wakeOn) startWakeLoop();
      };
      activeRec = rec;
      rec.start();
      return true;
    } catch {
      setBarListening(false);
      return false;
    }
  }

  function openBar({ listen = false, prefill = '' } = {}) {
    const mask = document.getElementById('command-mask');
    const input = document.getElementById('cmd-input');
    if (!mask || !input) return;
    host.closeMenus?.();
    mask.classList.remove('hidden');
    if (prefill) input.value = prefill;
    else if (!listen) input.value = '';
    syncWakeUi();
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
    if (listen) startListening();
  }

  function closeBar(refocus = false) {
    const mask = document.getElementById('command-mask');
    if (!mask || mask.classList.contains('hidden')) return false;
    stopListening();
    mask.classList.add('hidden');
    if (refocus) document.getElementById('spatial-bar')?.focus();
    return true;
  }

  async function undoLast() {
    const fn = undoStack.pop();
    if (!fn) { host.toast('没有可撤销的操作'); return false; }
    await fn();
    host.toast('已恢复刚才的状态');
    return true;
  }

  async function run(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ok: false, count: 0 };
    const ctx = host.context();
    let ops = parseNaturalCommands(text, ctx);
    if (!ops.length && aiConfigured()) {
      host.toast('正在理解…', 1800);
      ops = await aiFallbackPlan(text, ctx);
    }
    if (!ops.length) {
      host.toast('试试说「字大一点、开护眼」「去星海看暮色」或「打开书名」', 3000);
      return { ok: false, count: 0 };
    }
    if (ops.length === 1 && ops[0].op === 'undo') {
      closeBar(false);
      const ok = await undoLast();
      return { ok, count: ok ? 1 : 0, ops };
    }

    const snap = host.snapshot();
    const notes = [];
    let undoable = false;
    for (const a of ops) {
      if (a.op === 'wake') {
        const ok = await setWake(a.on);
        if (ok) notes.push(a.on ? '已开启语音唤醒（说「Zone…」）' : '已关闭语音唤醒');
        continue;
      }
      const res = await host.exec(a);
      if (res?.label) notes.push(res.label);
      if (res?.undoable) undoable = true;
    }
    if (undoable) {
      undoStack.push(() => host.restore(snap));
      if (undoStack.length > 16) undoStack.shift();
    }
    closeBar(false);
    if (notes.length) {
      host.toast(notes.join(' · '), undoable ? 4200 : 2400, undoable ? () => undoLast() : null);
    }
    return { ok: notes.length > 0, count: notes.length, ops, labels: notes };
  }

  // 绑定轻量声控条事件
  bindNativeVoice();
  const mask = document.getElementById('command-mask');
  const form = document.getElementById('command-form');
  const input = document.getElementById('cmd-input');
  mask?.addEventListener('click', e => { if (e.target === mask) closeBar(true); });
  form?.addEventListener('submit', e => { e.preventDefault(); run(input?.value || ''); });
  document.getElementById('cmd-mic')?.addEventListener('click', () => {
    if (listening) stopListening(); else startListening();
  });
  document.getElementById('cmd-wake')?.addEventListener('click', async () => {
    const next = !wakeOn;
    if (await setWake(next)) host.toast(next ? '前台语音唤醒已开，直接说「Zone…」' : '语音唤醒已关');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopWake();
    else if (wakeOn) startWakeLoop();
  });

  // 恢复已保存的唤醒偏好（仅当用户主动开过）
  try {
    if (localStorage.getItem(WAKE_KEY) === '1' && speechSupported()) {
      if (nativeVoice()) setWake(true, true);
      else { wakeOn = true; syncWakeUi(); }
    }
  } catch {}

  return { openBar, closeBar, run, undoLast, startListening, stopListening, setWake, isOpen: () => !mask?.classList.contains('hidden') };
}
