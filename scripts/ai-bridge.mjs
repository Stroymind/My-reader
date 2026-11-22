#!/usr/bin/env node
/**
 * Zbot Local AI Subscription Bridge (OpenAI-compatible /v1/chat/completions)
 *
 * Bridges your computer's officially installed & signed-in CLIs:
 *   - model: "codex-cli"  -> `codex exec`  (uses your signed-in ChatGPT / Codex CLI account)
 *   - model: "gemini-cli" -> `gemini -p`   (uses your signed-in Google / Gemini CLI account)
 *   - model: "claude-cli" -> `claude -p`   (uses your signed-in Anthropic / Claude Code CLI account)
 *
 * Usage:
 *   npm run ai:bridge
 *   (Optional: PORT=8787 node scripts/ai-bridge.mjs)
 *
 * In Zbot (PC Browser or Phone on same Wi-Fi):
 *   Base URL: http://<LAN-IP>:8787/v1   (or http://127.0.0.1:8787/v1 on PC)
 *   Model:    codex-cli | gemini-cli | claude-cli
 *   API Key:  local-cli (any non-empty string)
 */

import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const IS_WIN = process.platform === 'win32';

function formatPrompt(messages = []) {
  const parts = [];
  for (const m of messages) {
    const role = m?.role === 'system' ? 'System' : m?.role === 'assistant' ? 'Assistant' : 'User';
    let text = '';
    if (typeof m?.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m?.content)) {
      text = m.content.filter(p => p?.type === 'text').map(p => p.text || '').join('\n');
    }
    if (text.trim()) parts.push(`[${role}]\n${text.trim()}`);
  }
  return parts.join('\n\n') || 'Hello';
}

function runCli(cmd, args, stdinText = '', timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: IS_WIN,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      reject(new Error(`${cmd} 执行超时（>${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => {
      clearTimeout(timer);
      reject(new Error(`未找到本机官方 CLI「${cmd}」：${e.message}`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      const cleanOut = out.trim();
      if (code !== 0 && !cleanOut) {
        reject(new Error(`${cmd} 返回错误 (${code})：${(err || '请确认已在本机登录该 CLI').trim().slice(0, 260)}`));
        return;
      }
      resolve(cleanOut || err.trim());
    });
    if (stdinText) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

async function invokeLocalCli(model, messages) {
  const prompt = formatPrompt(messages);
  const m = String(model || 'codex-cli').trim().toLowerCase();
  if (m.startsWith('claude')) {
    return await runCli('claude', ['-p', '--output-format', 'text'], prompt);
  }
  if (m.startsWith('gemini')) {
    return await runCli('gemini', ['-p', prompt]);
  }
  // Default: OpenAI Codex CLI (`codex exec -`)
  return await runCli('codex', ['exec', '--skip-git-repo-check', '-'], prompt);
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end();
    return;
  }
  const urlPath = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (urlPath === '/v1/models' || urlPath === '/health')) {
    sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'codex-cli', object: 'model', owned_by: 'local-codex' },
        { id: 'gemini-cli', object: 'model', owned_by: 'local-gemini' },
        { id: 'claude-cli', object: 'model', owned_by: 'local-claude' }
      ]
    });
    return;
  }
  if (req.method === 'POST' && (urlPath === '/v1/chat/completions' || urlPath === '/chat/completions')) {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('utf8');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {
      sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
      return;
    }
    const model = String(body.model || 'codex-cli');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    try {
      const content = await invokeLocalCli(model, messages);
      sendJson(res, 200, {
        id: `chatcmpl-zbot-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    } catch (err) {
      sendJson(res, 502, { error: { message: err?.message || String(err) } });
    }
    return;
  }
  sendJson(res, 404, { error: { message: 'Not found' } });
});

function listLanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const ni of (list || [])) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  return ips;
}

server.listen(PORT, HOST, () => {
  const lans = listLanIps();
  console.log(`\nZbot 本地订阅桥接已启动（支持 codex-cli / gemini-cli / claude-cli）：`);
  console.log(`  电脑本机地址：http://127.0.0.1:${PORT}/v1`);
  for (const ip of lans) {
    console.log(`  手机同 Wi-Fi：http://${ip}:${PORT}/v1`);
  }
  console.log(`  在 Zbot「模型与密钥」中填入地址、选择模型（codex-cli / gemini-cli / claude-cli），密钥填 local-cli 即可对话。\n`);
});
