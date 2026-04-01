/**
 * vj-io.js — 入口：MediaPipe 捏合、Bezier 曲线、uProgress 双向绑定、VJ 控制台、DeepSeek 对话
 */

import gsap from 'gsap';
import * as THREE from 'three';
import { createEngine, loadPLYNormalizedPositions } from './gpgpu-pipeline.js';
import {
  createCameraRig,
  createFocusTracker,
  updateCameraFromFocus,
  buildCameraMasterTimeline,
} from './cinematography.js';
import { setParticlePhase } from './vector-fields.js';

// —— Bezier（过程调控 uProgress / 运镜权重）——
export function cubicBezierP1(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function cubicBezierVec3(t, a, c1, c2, b) {
  return new THREE.Vector3(
    cubicBezierP1(t, a.x, c1.x, c2.x, b.x),
    cubicBezierP1(t, a.y, c1.y, c2.y, b.y),
    cubicBezierP1(t, a.z, c1.z, c2.z, b.z),
  );
}

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

/** Pinch：拇指尖(4) 与食指尖(8) 归一化标量 */
function pinchStrength(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;
  const a = landmarks[4],
    b = landmarks[8];
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return THREE.MathUtils.clamp((d - 0.02) / (0.22 - 0.02), 0, 1);
}

/** 手腕到中指根为主轴，映射 -1~1 屏空间 NDC 辅助焦点 */
function palmToNdc(landmarks) {
  if (!landmarks || landmarks.length < 21) return { x: 0, y: 0, active: false };
  const wx = landmarks[0].x,
    wy = landmarks[0].y;
  const mx = landmarks[9].x,
    my = landmarks[9].y;
  const vx = mx - wx,
    vy = my - wy;
  const n = Math.hypot(vx, vy) + 1e-5;
  return {
    x: THREE.MathUtils.clamp(((wx - 0.5) * 2.8 + (vx / n) * 0.35) * 0.85, -1, 1),
    y: THREE.MathUtils.clamp(((-wy + 0.5) * 2.8 - (vy / n) * 0.25) * 0.85, -1, 1),
    active: true,
  };
}

function createVjShell(host, api, camRig, bezierState) {
  const root = document.createElement('div');
  root.id = 'vj-console-root';
  root.setAttribute('data-vj-isolated', '1');
  root.innerHTML = `
    <style>
      #vj-console-root { isolation: isolate; contain: layout style; }
      .vj-panel {
        position: fixed; left: 0.75rem; top: 50%; transform: translateY(-50%);
 width: 220px; max-height: 88vh; overflow: auto; z-index: 60;
        padding: 0.65rem 0.75rem; border-radius: 14px;
        background: rgba(22,19,30,0.94); border: 1px solid #3f3755;
        font: 11px/1.45 system-ui, sans-serif; color: #e8ddd0;
        box-shadow: 0 12px 48px rgba(0,0,0,0.55); pointer-events: auto;
      }
      .vj-panel h4 { margin: 0 0 0.35rem 0; font-size: 10px; letter-spacing: 0.06em; color: #e8a060; text-transform: uppercase; }
      .vj-row { display: flex; align-items: center; gap: 0.35rem; margin: 0.3rem 0; }
      .vj-row label { flex: 1; color: #9a8e80; }
      .vj-row input[type="range"] { flex: 1; accent-color: #e8a060; height: 3px; }
      .vj-row .v { min-width: 28px; text-align: right; font-variant-numeric: tabular-nums; }
      .vj-btn { width: 100%; margin-top: 0.25rem; padding: 0.35rem; border-radius: 8px; border: 1px solid #3f3755;
        background: #2a2436; color: #e8ddd0; cursor: pointer; font-size: 11px; }
      .vj-btn:hover { border-color: #c09060; }
      .vj-meta { font-size: 10px; color: #7a7088; margin-top: 0.35rem; line-height: 1.35; }
    </style>
    <div class="vj-panel">
      <h4>VJ · 管线时间轴</h4>
      <div class="vj-row"><label>主时间 scrub</label><span class="v" id="vj-scrub-v">0</span></div>
      <input type="range" id="vj-scrub" min="0" max="1000" value="0" step="1" />
      <div class="vj-row"><label>矢量场 (0–29)</label><span class="v" id="vj-field-v">0</span></div>
      <input type="range" id="vj-field" min="0" max="29" value="0" step="1" />
      <div class="vj-row"><label>Bezier→uProgress</label><span class="v" id="vj-bez-v">0</span></div>
      <input type="range" id="vj-bez-mix" min="0" max="100" value="35" />
      <button type="button" class="vj-btn" id="vj-play">播放 / 暂停 GSAP 运镜</button>
      <button type="button" class="vj-btn" id="vj-reset-tl">重置运镜时间</button>
      <div class="vj-row"><label>捏合驱动</label><span class="v" id="vj-pinch-v">0</span></div>
      <input type="range" id="vj-pinch-gain" min="0" max="100" value="72" />
      <input type="text" id="vj-ply-url" placeholder="PLY URL（可选）" style="width:100%;margin-top:0.35rem;padding:0.3rem;border-radius:8px;border:1px solid #3f3755;background:#1c1826;color:#e8ddd0;font-size:10px;box-sizing:border-box;" />
      <button type="button" class="vj-btn" id="vj-load-ply">载入 PLY → 粒子初值</button>
      <p class="vj-meta">uProgress 绑定：Bezier 曲线插值 + MediaPipe 捏合权重写入 GPU growth。运镜矩阵相对焦点（指针/手掌）。</p>
    </div>
  `;
  host.appendChild(root);

  const scrub = root.querySelector('#vj-scrub');
  const field = root.querySelector('#vj-field');
  const bezMix = root.querySelector('#vj-bez-mix');
  const pinchGain = root.querySelector('#vj-pinch-gain');
  const scrubV = root.querySelector('#vj-scrub-v');
  const fieldV = root.querySelector('#vj-field-v');
  const bezV = root.querySelector('#vj-bez-v');
  const pinchV = root.querySelector('#vj-pinch-v');

  let masterPaused = false;
  bezierState.mix = 0.35;

  root.querySelector('#vj-play').addEventListener('click', () => {
 masterPaused = !masterPaused;
    if (globalThis.__vjMasterTl) globalThis.__vjMasterTl.paused(masterPaused);
  });
  root.querySelector('#vj-reset-tl').addEventListener('click', () => {
    if (globalThis.__vjMasterTl) globalThis.__vjMasterTl.time(0);
  });

  scrub.addEventListener('input', () => {
    const t = scrub.value / 1000;
    scrubV.textContent = t.toFixed(2);
    if (globalThis.__vjMasterTl) globalThis.__vjMasterTl.time(t * globalThis.__vjMasterTl.duration());
  });
  field.addEventListener('input', () => {
    const v = parseInt(field.value, 10);
    fieldV.textContent = String(v);
    api.simUniforms.uFieldMode.value = v;
  });
  bezMix.addEventListener('input', () => {
    bezierState.mix = parseInt(bezMix.value, 10) / 100;
    bezV.textContent = bezierState.mix.toFixed(2);
  });
  pinchGain.addEventListener('input', () => {
    bezierState.pinchGain = parseInt(pinchGain.value, 10) / 100;
  });

  root.querySelector('#vj-load-ply').addEventListener('click', async () => {
    const urlEl = root.querySelector('#vj-ply-url');
    const url = urlEl.value.trim();
    if (!url) {
      setStatus('填写 PLY 的 URL 或使用同源路径。');
      return;
    }
    try {
      const ply = await loadPLYNormalizedPositions(url);
      api.applyPLYToSimulation(ply);
      camRig.boundsRadius = Math.min(2.2, 0.55 + Math.cbrt(ply.vertexCount / 8000) * 0.35);
      setStatus(`已加载 ${ply.vertexCount} 顶点（BBox 归一化）`);
    } catch (e) {
      console.error(e);
      setStatus('PLY 解析失败：' + (e.message || e));
    }
  });

  function setStatus(t) {
    const el = document.getElementById('status-line');
    if (el) el.textContent = t;
  }

  return {
    root,
    updatePinchUi(v) {
      pinchV.textContent = v.toFixed(2);
    },
  };
}

function bindPanel(panel, api) {
  if (!panel) return;
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => fn(parseFloat(el.value)));
  };
  bind('sl-noise', (v) => { api.simUniforms.uNoiseScale.value = v; });
  bind('sl-curl', (v) => { api.simUniforms.uCurlStrength.value = v; });
  bind('sl-attract', (v) => { api.simUniforms.uAttractStrength.value = v; });
  bind('sl-damp', (v) => { api.simUniforms.uDamping.value = v; });
  bind('sl-point', (v) => { api.particleMaterial.uniforms.uPointSize.value = v; });
  bind('sl-bloom', (v) => { api.bloomPass.strength = v; });
  bind('sl-after', (v) => {
    const u = api.afterimagePass.uniforms;
    if (u?.damp) u.damp.value = v;
  });
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

function initControls(api, camRig) {
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
    if (api.simUniforms) api.simUniforms.uTypingPulse.value = Math.min(api.simUniforms.uTypingPulse.value + 0.32, 1.2);
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
    api.sharedUniforms.uProgress.value = next;
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
    } catch {
      setStatus('无法启动麦克风。');
      btnVoice?.classList.remove('recording');
    }
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
      } catch { /* 本地 */ }
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
      v: 1,
      duration: 2.8,
      ease: 'power2.inOut',
      onUpdate: () => {
        api.sharedUniforms.uGrowthProgress.value = ga.v;
        api.sharedUniforms.uProgress.value = ga.v;
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

async function initHandTracker(video, handNdc) {
  try {
    const mod = await import('@mediapipe/tasks-vision');
    const { HandLandmarker, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    );
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    return {
      landmarker,
      detect(timeMs) {
        if (video.readyState < 2) return null;
        return landmarker.detectForVideo(video, timeMs);
      },
    };
  } catch (e) {
    console.warn('MediaPipe 初始化跳过（可仅使用指针焦点）:', e);
    return null;
  }
}

async function main() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  const engine = createEngine(canvas);
  const {
    renderer,
    scene: _scene,
    camera,
    composer,
    gpgpuStep,
    simUniforms,
    sharedUniforms,
    particleMaterial: _pm,
    treeApi,
    bloomPass,
    afterimagePass,
    uHueShift,
    onResize,
  } = engine;

  const camRig = createCameraRig();
  const handNdc = { x: 0, y: 0, active: false };
  const focusTracker = createFocusTracker(canvas, handNdc);

  const bezierState = {
    mix: 0.35,
    pinchGain: 0.72,
    bezT: 0,
    p0: new THREE.Vector3(0, 0, 0),
    c1: new THREE.Vector3(0.2, 0.55, 0),
    c2: new THREE.Vector3(0.65, 0.35, 0),
    p3: new THREE.Vector3(1, 0.2, 0),
  };

  const api = {
    renderer,
    simUniforms,
    sharedUniforms,
    particleMaterial: engine.particleMaterial,
    treeApi,
    camera,
    bloomPass,
    afterimagePass,
    uHueShift,
    applyPLYToSimulation: engine.applyPLYToSimulation,
  };

  const vjUi = createVjShell(document.body, api, camRig, bezierState);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-99px;';
  document.body.appendChild(video);

  let handsApi = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
    handsApi = await initHandTracker(video, handNdc);
  } catch (e) {
    console.warn('摄像头未授权，手势/捏合禁用。', e);
  }

  const masterTl = buildCameraMasterTimeline(camRig);
  globalThis.__vjMasterTl = masterTl;

  let pointerX = window.innerWidth * 0.5,
    pointerY = window.innerHeight * 0.5;
  canvas.addEventListener(
    'pointermove',
    (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
    },
    { passive: true },
  );

  let lastPinch = 0;
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.06);
    const t = clock.elapsedTime;
    const g = sharedUniforms.uGrowthProgress.value;

    simUniforms.uAttractBoost.value = 1;
    if (handsApi && video.readyState >= 2) {
      const res = handsApi.detect(performance.now());
      const lm = res?.landmarks?.[0];
      if (lm) {
        const pinch = pinchStrength(lm);
        lastPinch = pinch;
        const ndcPalm = palmToNdc(lm);
        handNdc.x = ndcPalm.x;
        handNdc.y = ndcPalm.y;
        handNdc.active = ndcPalm.active;
        const bezAlong = cubicBezierP1(pinch, bezierState.p0.x, bezierState.c1.x, bezierState.c2.x, bezierState.p3.x);
        sharedUniforms.uProgress.value = THREE.MathUtils.lerp(pinch, bezAlong, bezierState.mix);
        simUniforms.uAttractBoost.value = 1 + pinch * 0.9 * bezierState.pinchGain;
      } else {
        handNdc.active = false;
      }
      vjUi.updatePinchUi(lastPinch);
    }

    bezierState.bezT = (bezierState.bezT + dt * 0.12) % 1;
    if (!handNdc.active) {
      const envelope = cubicBezierP1(bezierState.bezT, 0.15, 0.45, 0.7, 0.92);
      sharedUniforms.uProgress.value = THREE.MathUtils.lerp(sharedUniforms.uProgress.value, envelope * g, 0.02 * bezierState.mix);
    }

    simUniforms.uSeedRadius.value = THREE.MathUtils.lerp(0.28, 1.15, THREE.MathUtils.smoothstep(g, 0, 1));
    camRig.boundsRadius = THREE.MathUtils.lerp(1.05, 1.55, THREE.MathUtils.smoothstep(g, 0, 1));

    const focusW = focusTracker.sampleFromPointer(camera, pointerX, pointerY, g);
    updateCameraFromFocus(camera, focusW, camRig, 1.25, 14);

    gpgpuStep(dt, t);
    composer.render(dt);
  }

  function playIntroAnimation() {
    simUniforms.uIntroBurst.value = 1.0;
    simUniforms.uCurlStrength.value = 1.35;
    bloomPass.strength = 2.35;
    gsap.to(simUniforms.uIntroBurst, { value: 0, duration: 2.9, ease: 'power2.out' });
    gsap.to(simUniforms.uCurlStrength, { value: 0.48, duration: 3.3, ease: 'power1.out' });
    gsap.to(bloomPass, { strength: 1.12, duration: 3.6, ease: 'power1.out' });
    const overlay = document.getElementById('intro-overlay');
    if (overlay) gsap.delayedCall(1.0, () => overlay.classList.add('fade-out'));
  }

  initControls(api, camRig);
  playIntroAnimation();
  masterTl.play(0);
  animate();
}

main().catch(console.error);
</think>


<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace