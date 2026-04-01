/**
 * controls-ui.js — 星空灵感交互控制
 * 对话加星座连线 / 结束射流星 / 搜索高亮 / 新对话保留历史
 */
import gsap from 'gsap';
import { setParticlePhase } from './particles.js';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT_ZH = `你是一位温和、专业、有同理心的灵感引导师。用户会用语音或文字告诉你突然冒出的灵感。
你的职责是一步步引导用户梳理思路：先倾听，再追问关键细节，帮助用户从模糊想法走向可执行计划。
每次回复控制在 2-4 句话以内，语气温暖但不啰嗦。善用反问来激发更深层思考。`;

const SYSTEM_PROMPT_EN = `You are a warm, professional, and empathetic creativity coach.
The user shares ideas by voice or text. Guide them step by step: listen first, ask key questions, and help turn fuzzy thoughts into actionable plans.
Keep each reply to 2-4 sentences, warm and concise. Use reflective questions to deepen thinking.`;

const CARD_SYSTEM_PROMPT_ZH = `你是「今日灵感卡片」生成器。用户会提供他与 AI 导师之间的完整中文对话。
你必须严格根据对话中真实出现的内容进行总结，不要编造对话里没有的主题或细节。
输出必须是合法 JSON，且仅包含三个字段：
- title: 简短标题（不超过 8 个汉字）
- bullets: 字符串数组，3-8 条，按时间顺序总结主要洞察
- actions: 字符串数组，2-6 条，每条为具体可执行的小行动
不要输出 markdown、代码块或其它文字，只输出一行 JSON。`;

const CARD_SYSTEM_PROMPT_EN = `You generate "Today's Inspiration Card".
The user will provide the full conversation between user and AI.
Summarize only what really appears in the chat and do not fabricate details.
Output valid JSON with exactly three fields:
- title: short title (<= 8 words)
- bullets: string array, 3-8 items in chronological order
- actions: string array, 2-6 concrete next actions
Output one-line JSON only. No markdown, no code fences, no extra text.`;

const FALLBACK_REPLIES_ZH = [
  '先慢慢说：这个灵感第一次出现时，你最强烈的感受是什么？',
  '如果把它们连成一条线，你觉得中间缺的是哪一步？',
  '有没有一个最小、本周就能做的尝试？',
  '我们试着用一句话概括：这件事对你真正重要的是什么？',
];
const FALLBACK_REPLIES_EN = [
  'Take it slow: what feeling was strongest when this idea first appeared?',
  'If these thoughts form a chain, which missing step matters most?',
  'What is one tiny experiment you can do this week?',
  'In one sentence, what makes this idea truly important to you?',
];

const TEXTS = {
  zh: {
    me: '你', ai: 'AI', thinking: '思考中…',
    cardSummary: '完整对话总结', cardActions: '行动计划',
    cardDismiss: '收起', cardSave: '保存', cardNewChat: '新对话',
    cardTitle: '灵感卡片', cardFilePrefix: '灵感卡片',
    detailUser: '你的想法', detailAI: 'AI 回应',
    saveToast: '✨ 已保存！你可以在顶部<span class="toast-hint">「搜索灵感星」</span>框中随时回顾灵感',
  },
  en: {
    me: 'You', ai: 'AI', thinking: 'Thinking...',
    cardSummary: 'Conversation Summary', cardActions: 'Action Plan',
    cardDismiss: 'Hide', cardSave: 'Save', cardNewChat: 'New Chat',
    cardTitle: 'Inspiration Card', cardFilePrefix: 'inspiration-card',
    detailUser: 'Your Thought', detailAI: 'AI Response',
    saveToast: '✨ Saved! Use the <span class="toast-hint">"Search Stars"</span> box above to revisit your inspirations',
  },
};

function getLang() {
  const lang = (typeof window !== 'undefined' && window.__APP_LANG) || localStorage.getItem('app-lang') || 'zh';
  return lang === 'en' ? 'en' : 'zh';
}
function t(key) { return TEXTS[getLang()]?.[key] || TEXTS.zh[key] || key; }

function getApiKey() {
  const el = document.getElementById('ds-key');
  return el ? el.value.trim() : '';
}

async function fetchDeepSeek(messages) {
  const key = getApiKey();
  if (!key) return null;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 0.35, max_tokens: 620 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

function buildLocalCard(transcript) {
  const isEn = getLang() === 'en';
  const bullets = transcript
    .map((m) => `${m.role === 'user' ? (isEn ? 'You' : '你') : 'AI'}: ${m.text}`)
    .slice(-10);
  return {
    title: isEn ? 'Inspiration Growth Log' : '灵感生长记录',
    bullets: bullets.length ? bullets : [isEn ? 'No meaningful conversation yet.' : '尚未形成有效对话。'],
    actions: isEn
      ? ['Pick one resonant idea and test it for 15 minutes today', 'Break the idea into small verifiable steps']
      : ['挑一条最有共鸣的想法，今天做 15 分钟尝试', '把想法拆成可验证的小步骤'],
  };
}

/* ── Save toast ── */
let toastTimer = null;
function showSaveToast() {
  const el = document.getElementById('save-toast');
  if (!el) return;
  el.innerHTML = t('saveToast');
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}

/* ══════════════════════════════════════════════════════ */

export function initControls(api, camRig) {
  const transcript = [];
  let state = 'idle';
  let pendingUserText = '';

  const msgStream = document.getElementById('msg-stream');
  const splash = document.getElementById('splash-text');
  const textInput = document.getElementById('text-input');
  const btnSend = document.getElementById('btn-send');
  const btnVoice = document.getElementById('btn-voice');
  const btnEnd = document.getElementById('btn-end');
  const cardDock = document.getElementById('card-dock');
  const starDetail = document.getElementById('fruit-detail');
  const statusEl = document.getElementById('status-line');
  const searchInput = document.getElementById('search-stars');
  const recognition = createRecognition();

  function setStatus(s) { if (statusEl) statusEl.textContent = s; }

  function addImmMsg(role, text) {
    if (!msgStream) return;
    const el = document.createElement('div');
    el.className = `imm-msg ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    el.innerHTML = `<div class="msg-role">${role === 'user' ? t('me') : t('ai')}</div><div>${text}</div>`;
    msgStream.appendChild(el);
    const all = msgStream.querySelectorAll('.imm-msg');
    if (all.length > 8) {
      const oldest = all[0];
      oldest.style.opacity = '0';
      setTimeout(() => oldest.remove(), 450);
    }
    setTimeout(() => el.classList.add('fading'), 12000);
  }

  /** Dialogue FX: pulse + constellation line */
  function runDialogueFX() {
    setParticlePhase('burst');
    api.simUniforms.uCurlBoost.value = 3.0;
    gsap.to(api.simUniforms.uCurlBoost, { value: 1, duration: 1.6, ease: 'power2.out', delay: 0.1 });
    gsap.delayedCall(0.4, () => setParticlePhase('attract'));
    gsap.delayedCall(2.0, () => setParticlePhase('idle'));
    gsap.fromTo(camRig, { nudge: 0 }, { nudge: 0.25, duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut' });

    const buf = api.readParticlePositions();
    api.constellationSystem.addRandomLine(buf, api.texSize);
  }

  async function assistantReply() {
    const typing = document.createElement('div');
    typing.className = 'imm-msg ai-msg';
    typing.style.opacity = '0.5';
    typing.innerHTML = `<div class="msg-role">${t('ai')}</div><div>${t('thinking')}</div>`;
    msgStream?.appendChild(typing);

    const messages = [
      { role: 'system', content: getLang() === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH },
      ...transcript.map((m) => ({ role: m.role, content: m.text })),
    ];
    let text = await fetchDeepSeek(messages);
    if (!text) {
      const fb = getLang() === 'en' ? FALLBACK_REPLIES_EN : FALLBACK_REPLIES_ZH;
      text = fb[transcript.length % fb.length];
    }
    typing.remove();

    transcript.push({ role: 'assistant', text });
    addImmMsg('assistant', text);
    runDialogueFX();
    setStatus('');
  }

  function handleUserInput(text) {
    const v = (text || '').trim();
    if (!v || state === 'card' || state === 'ending') return;
    if (state === 'idle') {
      state = 'chatting';
      splash?.classList.add('hidden');
    }
    pendingUserText = v;
    transcript.push({ role: 'user', text: v });
    addImmMsg('user', v);
    api.simUniforms.uTypingPulse.value = 0.8;
    assistantReply();
  }

  async function requestSummary() {
    if (!transcript.length) return buildLocalCard(transcript);
    const local = buildLocalCard(transcript);
    const ctx = transcript.map((m) => `${m.role === 'user' ? (getLang() === 'en' ? 'User' : '用户') : 'AI'}: ${m.text}`).join('\n');
    const raw = await fetchDeepSeek([
      { role: 'system', content: getLang() === 'en' ? CARD_SYSTEM_PROMPT_EN : CARD_SYSTEM_PROMPT_ZH },
      { role: 'user', content: getLang() === 'en' ? `Full conversation below, generate card JSON:\n\n${ctx}` : `以下为完整对话，请据此生成 JSON 卡片：\n\n${ctx}` },
    ]);
    if (!raw) return local;
    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const d = JSON.parse(clean);
      if (d?.title && Array.isArray(d?.bullets)) {
        return {
          title: d.title,
          bullets: d.bullets.filter(Boolean).slice(0, 10),
          actions: Array.isArray(d.actions) ? d.actions.filter(Boolean).slice(0, 8) : local.actions,
        };
      }
    } catch { /* ignore */ }
    return local;
  }

  function renderCard(card) {
    const ts = new Date().toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
    const wrap = document.createElement('div');
    wrap.className = 'inspiration-card';
    wrap.innerHTML = `
      <header><h2 class="card-title"></h2><time></time></header>
      <section><h4>${t('cardSummary')}</h4><ul class="card-bullets"></ul></section>
      <section><h4>${t('cardActions')}</h4><ol class="card-actions"></ol></section>
      <div class="card-actions-row">
        <button type="button" class="card-dismiss">${t('cardDismiss')}</button>
        <button type="button" class="card-save">${t('cardSave')}</button>
        <button type="button" class="card-newchat">${t('cardNewChat')}</button>
      </div>`;
    wrap.querySelector('.card-title').textContent = card.title || t('cardTitle');
    wrap.querySelector('time').textContent = ts;
    const ul = wrap.querySelector('.card-bullets');
    const ol = wrap.querySelector('.card-actions');
    card.bullets.forEach((b) => { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); });
    card.actions.forEach((a) => { const li = document.createElement('li'); li.textContent = a; ol.appendChild(li); });
    wrap.querySelector('.card-dismiss').addEventListener('click', () => {
      cardDock?.classList.remove('card-visible');
      cardDock.innerHTML = '';
      state = 'idle';
    });
    wrap.querySelector('.card-save').addEventListener('click', () => {
      const blob = new Blob([wrap.innerText], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t('cardFilePrefix')}-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSaveToast();
    });
    wrap.querySelector('.card-newchat').addEventListener('click', resetChat);
    return wrap;
  }

  function showCard(cardData) {
    const card = renderCard(cardData);
    cardDock.innerHTML = '';
    cardDock.appendChild(card);
    cardDock.classList.add('card-visible');
    gsap.fromTo(card, { opacity: 0, y: 20, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power2.out' });
  }

  /** End session: shoot a star, fade constellation lines, then show card */
  async function endSession() {
    if (!transcript.length || state === 'card' || state === 'ending') return;
    state = 'ending';

    const cardData = await requestSummary();
    cardData.generatedAt = new Date().toISOString();
    await api.inspirationStarSystem.spawnShootingStar(cardData);
    api.constellationSystem.fadeAll(2.0);
    showCard(cardData);
    state = 'card';
    setParticlePhase('idle');
  }

  /** New chat: clear dialogue and constellation lines, keep stars */
  function resetChat() {
    transcript.length = 0;
    state = 'idle';
    if (msgStream) msgStream.innerHTML = '';
    cardDock?.classList.remove('card-visible');
    if (cardDock) cardDock.innerHTML = '';
    starDetail?.classList.remove('visible');
    api.constellationSystem.clearAll();
    setParticlePhase('idle');
    splash?.classList.remove('hidden');
    setStatus('');
  }

  /** Click on an inspiration star → show its card */
  api.inspirationStarSystem.setOnStarClick((cardData) => {
    if (cardData) showCard(cardData);
  });

  /* ── Search: highlight matching stars AND auto-extract their card ── */
  if (searchInput) {
    let searchTimeout;
    let searchCardShown = false;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const kw = searchInput.value.trim();
        if (kw) {
          api.inspirationStarSystem.searchHighlight(kw);
          const matched = api.inspirationStarSystem.getFirstMatch(kw);
          if (matched && !searchCardShown) {
            searchCardShown = true;
            showCard(matched);
          } else if (!matched) {
            if (searchCardShown) {
              cardDock?.classList.remove('card-visible');
              if (cardDock) cardDock.innerHTML = '';
              searchCardShown = false;
            }
          }
        } else {
          api.inspirationStarSystem.clearHighlight();
          if (searchCardShown) {
            cardDock?.classList.remove('card-visible');
            if (cardDock) cardDock.innerHTML = '';
            searchCardShown = false;
          }
        }
      }, 400);
    });
  }

  /* ── UI event bindings ── */
  textInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = textInput.value;
      textInput.value = '';
      handleUserInput(v);
    }
  });
  btnSend?.addEventListener('click', () => {
    const v = textInput?.value || '';
    if (textInput) textInput.value = '';
    handleUserInput(v);
  });
  btnEnd?.addEventListener('click', endSession);
  window.addEventListener('tree:new-chat', resetChat);

  if (recognition) {
    btnVoice?.addEventListener('click', () => {
      try { recognition.start(); btnVoice.classList.add('recording'); } catch { /* noop */ }
    });
    recognition.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const text = (last[0]?.transcript || '').trim();
      btnVoice?.classList.remove('recording');
      handleUserInput(text);
    };
    recognition.onerror = () => btnVoice?.classList.remove('recording');
    recognition.onend = () => btnVoice?.classList.remove('recording');
  }

  /* ── Language sync ── */
  function syncLanguageUI() {
    const u = starDetail?.querySelector('.fd-user .fd-label');
    const a = starDetail?.querySelector('.fd-ai .fd-label');
    if (u) u.textContent = t('detailUser');
    if (a) a.textContent = t('detailAI');
    msgStream?.querySelectorAll('.imm-msg .msg-role').forEach((el) => {
      const p = el.closest('.imm-msg');
      if (!p) return;
      el.textContent = p.classList.contains('user-msg') ? t('me') : t('ai');
    });
  }
  window.addEventListener('app:lang-change', syncLanguageUI);

  bindPanel(api);
  return { resetChat };
}

/* ── Panel bindings ── */
function bindPanel(api) {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = () => fn(parseFloat(el.value));
    el.addEventListener('input', apply);
    apply();
  };
  bind('sl-point', (v) => { if (api.morphUniforms) api.morphUniforms.uPointSize.value = v; });
  bind('sl-spread', (v) => { if (api.morphUniforms) api.morphUniforms.uSpread.value = v; });
  bind('sl-mouse-force', (v) => { api.simUniforms.uAttractBoost.value = v / 2.8; });
  bind('sl-line-op', (v) => { api.simUniforms.uLineOpacityMul.value = v; });
  bind('sl-line-bright', (v) => { api.simUniforms.uLineBrightness.value = v; });
  bind('sl-bloom', (v) => { api.bloomPass.strength = v; });
  bind('sl-after', (v) => { const u = api.afterimagePass.uniforms; if (u?.damp) u.damp.value = v; });

  document.querySelectorAll('.shape-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      api.switchShape?.(btn.dataset.shape);
    });
  });

  const clA = document.getElementById('cl-a');
  const clB = document.getElementById('cl-b');
  if (clA) clA.addEventListener('input', () => { api.morphUniforms?.uColor1.value.set(clA.value); });
  if (clB) clB.addEventListener('input', () => { api.morphUniforms?.uColor2.value.set(clB.value); });
}

function createRecognition() {
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  if (!SR) return null;
  const r = new SR();
  r.lang = getLang() === 'en' ? 'en-US' : 'zh-CN';
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  window.addEventListener('app:lang-change', (e) => {
    r.lang = e?.detail?.lang === 'en' ? 'en-US' : 'zh-CN';
  });
  return r;
}
