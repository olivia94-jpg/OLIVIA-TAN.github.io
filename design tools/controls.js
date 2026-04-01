/**
 * controls.js — DeepSeek、居中对话、灵感卡片（必显）、树/粒子面板绑定
 */

import gsap from 'gsap';
import { setParticlePhase } from './particles.js';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = `你是一位温和、专业、有同理心的灵感引导师。用户会用语音或文字告诉你突然冒出的灵感。
你的职责是一步步引导用户梳理思路：先倾听，再追问关键细节，帮助用户从模糊想法走向可执行计划。
每次回复控制在 2-4 句话以内，语气温暖但不啰嗦。善用反问来激发更深层思考。`;

const CARD_SYSTEM_PROMPT = `你是「今日灵感卡片」生成器。用户会提供他与 AI 导师之间的完整中文对话。
你必须严格根据对话中真实出现的内容进行总结，不要编造对话里没有的主题或细节。
输出必须是合法 JSON，且仅包含三个字段：
- title: 简短标题（不超过 8 个汉字）
- bullets: 字符串数组，2-4 条，每条概括对话中的关键洞察或情绪转折
- actions: 字符串数组，2-4 条，每条为具体可执行的小行动
不要输出 markdown、代码块或其它文字，只输出一行 JSON。`;

const FALLBACK_REPLIES = [
  '先慢慢说：这个灵感第一次出现时，你最强烈的感受是什么？',
  '如果把它们连成一条线，你觉得中间缺的是哪一步？',
  '有没有一个最小、本周就能做的尝试？',
  '我们试着用一句话概括：这件事对你真正重要的是什么？',
];

const FALLBACK_CARD = {
  title: '今日灵感',
  bullets: ['尚未记录对话，这是一张占位卡片。', '发送几条消息后再结束，即可生成真实总结。'],
  actions: ['写下此刻最想完成的一件事', '给自己 15 分钟安静整理', '明天再打开本页继续聊'],
};

function getApiKey() {
  const el = document.getElementById('ds-key');
  return el ? el.value.trim() : '';
}

function buildLocalCardFromTranscript(transcript) {
  if (!transcript.length) return { ...FALLBACK_CARD };
  const bullets = [];
  const maxPick = Math.min(transcript.length, 8);
  const slice = transcript.slice(-maxPick);
  slice.forEach((m) => {
    const prefix = m.role === 'user' ? '你提到：' : '对话要点：';
    const t = (m.text || '').trim();
    if (t) bullets.push(prefix + t.slice(0, 100) + (t.length > 100 ? '…' : ''));
  });
  while (bullets.length > 4) bullets.shift();
  const firstUser = transcript.find((m) => m.role === 'user');
  let title = firstUser ? String(firstUser.text).replace(/\s/g, '').slice(0, 8) : '今日灵感';
  if (!title) title = '今日灵感';
  return {
    title,
    bullets: bullets.length >= 2 ? bullets.slice(0, 4) : [...bullets, '继续对话可丰富卡片内容。'],
    actions: [
      '从对话里圈出 3 个关键词',
      '为本周安排一个最小可行尝试',
      '用一句话写下「我真正在乎的是…」',
    ],
  };
}

async function fetchDeepSeek(messages) {
  const key = getApiKey();
  if (!key) return null;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 0.35, max_tokens: 520 }),
    });
    if (!res.ok) {
      console.warn('DeepSeek error:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn('DeepSeek fetch failed:', e);
    return null;
  }
}

/**
 * @param {*} api
 * @param {{ angle: number, radius: number, baseY: number, breathe: number, growthNudge: number }} camRig
 */
export function initControls(api, camRig) {
  let state = 'seed';
  const transcript = [];

  const btnVoice = document.getElementById('btn-voice');
  const btnEnd = document.getElementById('btn-end');
  const btnSend = document.getElementById('btn-send');
  const textInput = document.getElementById('text-input');
  const panel = document.getElementById('control-panel');
  const cardDock = document.getElementById('card-dock');
  const statusEl = document.getElementById('status-line');
  const dialogBox = document.getElementById('dialog-box');

  const recognition = createRecognition();

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function showDialog() { dialogBox?.classList.add('visible'); }
  function hideDialog() { dialogBox?.classList.remove('visible'); }

  function appendDialogMsg(role, text) {
    if (!dialogBox) return;
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    const lbl = document.createElement('div');
    lbl.className = 'msg-label';
    lbl.textContent = role === 'user' ? '你' : 'AI';
    el.appendChild(lbl);
    const body = document.createElement('div');
    body.textContent = text;
    el.appendChild(body);
    dialogBox.appendChild(el);
    dialogBox.scrollTop = dialogBox.scrollHeight;
    showDialog();
  }

  function showTypingIndicator() {
    if (!dialogBox) return null;
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.textContent = 'AI 正在思考…';
    dialogBox.appendChild(el);
    dialogBox.scrollTop = dialogBox.scrollHeight;
    return el;
  }

  function pulseTyping() {
    if (!api.simUniforms) return;
    api.simUniforms.uTypingPulse.value = Math.min(api.simUniforms.uTypingPulse.value + 0.32, 1.2);
  }

  function pulseDialogueCamera() {
    gsap.fromTo(camRig, { growthNudge: 0 }, { growthNudge: 0.28, duration: 0.55, yoyo: true, repeat: 1, ease: 'sine.inOut' });
  }

  function runParticleDialogueFX() {
    setParticlePhase('burst');
    gsap.delayedCall(0.4, () => setParticlePhase('attract'));
    gsap.delayedCall(2.5, () => setParticlePhase('idle'));
  }

  function bumpGrowth(step = 0.22) {
    const next = Math.min(1, api.sharedUniforms.uGrowthProgress.value + step);
    api.sharedUniforms.uGrowthProgress.value = next;
    api.treeApi.setGrowthProgress(next);
    state = next >= 0.99 ? 'mature' : 'growing';
  }

  async function assistantReply() {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...transcript.map((m) => ({ role: m.role, content: m.text }))];
    const indicator = showTypingIndicator();
    let text = await fetchDeepSeek(messages);
    if (!text) {
      if (!getApiKey()) setStatus('未填写 API Key，使用本地引导。');
      text = FALLBACK_REPLIES[transcript.length % FALLBACK_REPLIES.length];
    }
    if (indicator) indicator.remove();
    transcript.push({ role: 'assistant', text });
    appendDialogMsg('assistant', text);
    setStatus('AI 已回复，继续说说你的想法…');
    bumpGrowth(0.22);
    runParticleDialogueFX();
    pulseDialogueCamera();
  }

  function handleUserInput(text) {
    if (!text || state === 'card') return;
    transcript.push({ role: 'user', text });
    appendDialogMsg('user', text);
    setStatus('正在请求 DeepSeek…');
    api.simUniforms.uTypingPulse.value = 0.85;
    assistantReply().catch(() => setStatus('生成回复时出错，请重试。'));
  }

  function submitTextInput() {
    if (!textInput) return;
    const text = textInput.value.trim();
    textInput.value = '';
    handleUserInput(text);
  }

  function startVoice() {
    if (!recognition) { setStatus('浏览器不支持语音识别。'); return; }
    if (state === 'card') return;
    try {
      btnVoice?.classList.add('recording');
      recognition.start();
      setStatus('聆听中…');
    } catch { setStatus('无法启动麦克风。'); btnVoice?.classList.remove('recording'); }
  }

  if (textInput) {
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTextInput(); }
      else pulseTyping();
    });
  }
  if (btnSend) btnSend.addEventListener('click', submitTextInput);
  if (btnVoice) btnVoice.addEventListener('click', startVoice);

  if (recognition) {
    recognition.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const text = (last[0]?.transcript || '').trim();
      btnVoice?.classList.remove('recording');
      handleUserInput(text);
    };
    recognition.onerror = () => { btnVoice?.classList.remove('recording'); setStatus('语音识别出错。'); };
    recognition.onend = () => { btnVoice?.classList.remove('recording'); };
  }

  async function requestCardSummary() {
    const local = buildLocalCardFromTranscript(transcript);
    const ctx = transcript.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.text}`).join('\n');
    if (!ctx.trim()) return local;

    const raw = await fetchDeepSeek([
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      { role: 'user', content: `以下为完整对话，请据此生成 JSON 卡片：\n\n${ctx}` },
    ]);

    if (raw) {
      try {
        const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const d = JSON.parse(clean);
        if (d && typeof d.title === 'string' && Array.isArray(d.bullets)) {
          return {
            title: d.title,
            bullets: d.bullets.filter(Boolean).slice(0, 4),
            actions: Array.isArray(d.actions) ? d.actions.filter(Boolean).slice(0, 4) : local.actions,
          };
        }
      } catch { /* 使用本地摘要 */ }
    }
    return local;
  }

  function buildCardDom(card) {
    const wrap = document.createElement('div');
    wrap.className = 'inspiration-card';
    const ts = new Date().toLocaleString('zh-CN', { hour12: false });
    wrap.innerHTML = `
      <header><h2 class="card-title"></h2><time></time></header>
      <section><h4>对话总结</h4><ul class="card-bullets"></ul></section>
      <section><h4>行动</h4><ol class="card-actions"></ol></section>
      <button type="button" class="card-save">保存为文本</button>`;
    wrap.querySelector('.card-title').textContent = card.title || '今日灵感';
    wrap.querySelector('time').textContent = ts;
    const ul = wrap.querySelector('.card-bullets');
    const ol = wrap.querySelector('.card-actions');
    (card.bullets || []).forEach((b) => { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); });
    (card.actions || []).forEach((a) => { const li = document.createElement('li'); li.textContent = a; ol.appendChild(li); });
    wrap.querySelector('.card-save').addEventListener('click', () => {
      const blob = new Blob([wrap.innerText], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `灵感卡片-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    return wrap;
  }

  async function endSession() {
    if (state === 'card') return;
    setStatus('正在根据完整对话生成灵感卡片…');
    hideDialog();

    setParticlePhase('burst');
    gsap.delayedCall(0.45, () => setParticlePhase('attract'));

    const ga = { v: api.sharedUniforms.uGrowthProgress.value };
    gsap.to(ga, {
      v: 1, duration: 2.8, ease: 'power2.inOut',
      onUpdate: () => {
        api.sharedUniforms.uGrowthProgress.value = ga.v;
        api.treeApi.setGrowthProgress(ga.v);
      },
    });

    const cardData = await requestCardSummary();
    const el = buildCardDom(cardData);

    if (cardDock) {
      cardDock.innerHTML = '';
      cardDock.appendChild(el);
      cardDock.classList.add('card-visible');
    }

    gsap.fromTo(el, { scale: 0.86, opacity: 0, y: 32 }, { scale: 1, opacity: 1, y: 0, duration: 0.65, ease: 'back.out(1.2)' });

    state = 'card';
    setStatus('灵感卡片已显示在屏幕中央（可滚动）。点击「保存为文本」可导出。');
    gsap.delayedCall(5.0, () => setParticlePhase('idle'));
  }

  if (btnEnd) btnEnd.addEventListener('click', endSession);

  bindPanel(panel, api);
  setStatus('输入文字或点击语音，诉说你的灵感。');

  return { dispose() { try { recognition?.stop(); } catch { /* */ } } };
}

function bindPanel(panel, api) {
  if (!panel) return;
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => fn(parseFloat(el.value)));
  };
  bind('sl-trunk', (v) => { api.simUniforms.uTrunkThickness.value = v; });
  bind('sl-branch', (v) => { api.simUniforms.uBranchDensity.value = v; });
  bind('sl-leaf', (v) => { api.simUniforms.uLeafDensity.value = v; });
  bind('sl-curve', (v) => { api.simUniforms.uCurvature.value = v; });
  bind('sl-fruit', (v) => { api.simUniforms.uFruitAmount.value = v; });
  bind('sl-hue', (v) => { if (api.uHueShift) api.uHueShift.value = v; });
  bind('sl-noise', (v) => { api.simUniforms.uNoiseScale.value = v; });
  bind('sl-curl', (v) => { api.simUniforms.uCurlStrength.value = v; });
  bind('sl-attract', (v) => { api.simUniforms.uAttractStrength.value = v; });
  bind('sl-damp', (v) => { api.simUniforms.uDamping.value = v; });
  bind('sl-point', (v) => { api.particleMaterial.uniforms.uPointSize.value = v; });
  bind('sl-bloom', (v) => { api.bloomPass.strength = v; });
  bind('sl-after', (v) => { const u = api.afterimagePass.uniforms; if (u?.damp) u.damp.value = v; });
}

function createRecognition() {
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'zh-CN';
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}
