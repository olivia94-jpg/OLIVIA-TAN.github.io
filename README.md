# 星空灵感 · Starfield Inspiration

面向设计师的沉浸式 AIGC 对话与星空可视化演示项目。

---

## 视频演示（YouTube）

- [项目演示视频 / Demo Video](https://youtu.be/PXe22EwnslU)

---

## 是否调用 API？

**会，但仅在交互主程序中、且由用户自行配置密钥。**

| 页面 / 模块 | 是否调用外部 API |
|-------------|------------------|
| `index.html`（主交互应用） | **是**。在用户于设置面板中填写密钥后，会通过 HTTPS 请求 [DeepSeek](https://www.deepseek.com/) 的对话接口，用于智能回复与灵感卡片生成。 |
| `wangye.html`（宣传 / 路演页） | **否**。静态展示与本地视频，不向第三方 AI 服务发送请求。 |

**安全规则（请务必遵守）**

- **切勿**将 API 密钥写入任何仓库文件或提交到 Git。
- 密钥仅通过页面内的密码框在浏览器本地使用；本项目代码中不包含真实密钥。

**所用 API 服务链接**

- DeepSeek 官网：[https://www.deepseek.com/](https://www.deepseek.com/)
- DeepSeek API 文档：[https://api-docs.deepseek.com/](https://api-docs.deepseek.com/)

---

## 产品文案（中文）

### 1. Hero 区（首页大标题）

**主标题：**  
你的灵感，不该消失在千篇一律的聊天框里。

**副标题：**  
星空灵感 —— 用语音与 AI 在一片深邃星空中对话，把每一个设计灵感，化作永恒的星座。

### 2. 痛点共鸣段（Problem）

作为设计师，你一定深有体会：

- 突然闪现的灵感，转瞬即逝，来不及记录就消失；
- 和 AI 聊设计方案时，界面冰冷单调，缺少反馈与仪式感；
- 当前大多数 AIGC 工具界面高度雷同，千篇一律的聊天窗口，让原本应该充满创造力的过程变得枯燥乏味；
- 想深入梳理一个模糊想法，却只能在单调的对话框里机械输入，缺乏沉浸感和情感陪伴；
- 过去积累的灵感散落在不同聊天记录中，回顾时既费力又毫无美感。

设计师需要的不只是一个“会回答问题”的 AI，而是一个能真正陪伴思考、让人愿意沉浸其中的创作空间。

### 3. 解决方案与价值（Solution）

星空灵感正是为此而生。

我们把 AIGC 对话从冰冷的聊天框，升级成一片唯美深邃的专属星空：

- **语音输入：**灵感来临时，只需点击语音，说出来即可。无需打字，打断思考流。
- **温和引导：**AI 以专业且富有同理心的提问，一步步帮你把模糊的灵感梳理成清晰的设计方案。
- **沉浸式视觉交互：**每一次对话，都会在星空中优雅地增添一条星座般的连线。结束对话时，一个明亮的发光球体从屏幕中央由大至小投掷到星空中心，化作一颗永恒的「灵感星」。
- **灵感库：**所有历史对话自动生成结构化卡片（标题 + 时间 + 核心总结 + 行动计划），通过检索框即可快速查找，并让对应的星星与连线在星空中高亮显示。

通过星空元素的动态互动，我们大幅提升了设计师在做方案过程中的舒适度与愉悦感。在这里，记录灵感不再是任务，而是一场诗意且治愈的沉浸式体验。

### 4. 核心优势（For Designers）

专为设计师打造的沉浸式 AIGC 工具：

- 告别雷同界面：不再是千篇一律的白色/暗黑聊天框，而是一幅不断生长的梦幻星空。
- 真正的沉浸感：语音 + 星空可视化 + 优雅动画，让你愿意长时间停留并深入思考。
- 灵感永存：每一次对话都变成星空中的一部分，历史灵感以最美的方式被保留和连接。
- 舒适的创作仪式：从语音输入，到连线生成，再到发光球体投掷与卡片生成，整个过程充满仪式感和视觉享受。

### 5. 结束号召（CTA）

把你的设计灵感，交给这片属于自己的星空。  
一键开启语音对话，让每一个闪念，都在星河中闪耀。

---

## Product Copy (English)

### 1. Hero

**Headline:** Your inspiration should not disappear in generic chat windows.

**Subhead:** Starfield Inspiration — Talk to AI with your voice in a deep cosmic sky, and turn every design spark into an eternal constellation.

### 2. Problem

As a designer, you know this well: ideas vanish before you capture them; AI design chats feel cold and flat; look-alike AIGC UIs drain creativity; vague thoughts get stuck in plain text boxes; past ideas scatter across logs with no beauty to revisit. Designers need more than an AI that answers — they need a space that truly accompanies thinking.

### 3. Solution

Starfield Inspiration upgrades chat into a personal starfield: voice input without breaking flow; empathetic AI guidance; constellation-like links per turn and a luminous orb that becomes a lasting inspiration star; a searchable inspiration library with highlighted stars and links. The experience is calmer, more joyful, and poetic.

### 4. Why Us

Built for designers: a living dream sky instead of generic chat; real immersion via voice, visualization, and motion; every session preserved in the sky; a full ritual from voice to links to cards.

### 5. CTA

Give your design inspiration a sky of its own. Start voice dialog in one tap — let every spark shine in the galaxy.

---

## 小组成员 / Team Members

| 中文姓名 | English Name | 学号 / Student ID |
|----------|--------------|-------------------|
| 谭诗宇 | Tan Shiyu | MC569188 |
| 陈依婷 | Chen Yiting | MC569073 |

---

## 本地预览

可使用项目内 `启动本地预览.bat` 或任意静态服务器打开 `index.html` / `wangye.html`（避免 `file://` 下部分模块加载受限时，请用本地 HTTP 服务）。
