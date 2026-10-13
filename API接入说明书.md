# 寒冰变声器 · API 接入说明书（给开发者 / AI 用）

本说明书面向**想在你的程序里接入「寒冰特效」的开发者，以及接管任务的 AI 智能体**。
核心算法全部封装在 `js/ice-voice-core.js`（UMD 格式），浏览器和 Node.js 都能直接 `require` / `<script>` 引入。

一句话定位：**它是「AI 变声插件之后的特效插件」** —— 你先产出变声后的音频，再交给它叠 N 层寒冰机械音效。

---

## 1. 引入

浏览器（在 `index.html` 同级放 `js/ice-voice-core.js`）：

```html
<script src="js/ice-voice-core.js"></script>
<script>
  // window.IceVoice 已就绪
</script>
```

Node.js：

```js
const IceVoice = require('./js/ice-voice-core.js');
```

UMD 自适应：`module.exports` 与 `window.IceVoice` 二选一，无需打包工具。

---

## 2. 核心 API

### 2.1 浏览器：`IceVoice.transformBuffer(audioBuffer, opts) => Promise<AudioBuffer>`

对 Web Audio 的 `AudioBuffer` 做寒冰处理。**机械层用 `OfflineAudioContext` 离线渲染，与 Scratch / TurboWarp 实际听到的效果一致。**

```js
const out = await IceVoice.transformBuffer(audioBuffer, {
  layers: 3,            // 寒冰层数 N（1~99，默认 1）
  pitchSemitones: 5,    // 变调半音 -24~24（0 = 不变调；只改音高、不改速度）
  order: 'pitch-first', // 'pitch-first'（先变调后寒冰）| 'ice-first'（先寒冰后变调）
  engine: 'auto',       // 'auto' | 'webaudio' | 'js'；默认纯 JS 引擎（最稳，跨浏览器）
  normalize: true,      // 处理后峰值归一化到 -1 dB（避免过载）
  onProgress: (p) => {  // 可选，进度回调
    // p = { stage:'ice'|'pitch', layer, total } 或 { stage:'pitch', done, total }
  }
});
// out 是 AudioBuffer，可直接播放，或用 encodeWav 导出
```

### 2.2 Node.js：`IceVoice.transformChannels(audio, opts) => { channels, sampleRate }`

纯 JavaScript 引擎（无 Web Audio 依赖），适合服务端 / CLI / CI。

```js
const fs = require('fs');
const IceVoice = require('./js/ice-voice-core.js');

const wav = fs.readFileSync('in.wav');
// decodeWav 接受 ArrayBuffer；Node 的 Buffer 用 .buffer.slice(...) 转
const audio = IceVoice.decodeWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));

const res = IceVoice.transformChannels(audio, {
  layers: 4,
  pitchSemitones: -3,
  order: 'pitch-first',
  normalize: true
});

fs.writeFileSync('out.wav', Buffer.from(IceVoice.encodeWav(res, 16))); // 16/24/32(float)
```

### 2.3 序列式（v2.1 推荐）：`transformScript` / `parseScript`

把「处理顺序」写成一条逗号分隔的指令。**处理顺序 = 你书写的先后顺序**：写在前面的先执行，后面的后执行，
不会自动重排、也不会省略任何一步；机械与变调可任意穿插、无限叠加。

**指令语法**：

- `机械` 或 `机械(<频率Hz>)`：叠加一层机械音效（频率默认 50）。
- `变调(<半音>)` / `升调(<半音>)` / `降调(<半音>)`：变调，半音范围 ±24；`升调` 取正、`降调` 取负。
- 半音可带或不带正负号（`变调(+5)` ≡ `变调(5)`）；支持中英文逗号与空格；全角括号 `（）`、全角数字、全角正负号
  `＋－` 都会被自动归一为半角；连续逗号产生的空段自动忽略。
- 例如 `机械，变调(-5)，机械，变调(-7)`。

```js
// 1) 先解析（校验语法，返回 { steps, error }）
const parsed = IceVoice.parseScript('机械，变调(-5)，机械');
// parsed.steps = [{type:'robot',freq:50},{type:'pitch',semitones:-5},{type:'robot',freq:50}]
// 语法错误时 parsed.error 为字符串，parsed.steps 为空
// 另有 IceVoice.normalizeScriptText(text) 可单独做全角/异体字符归一

// 2) 再执行（同步；输入/输出都是 { channels:Float32Array[], sampleRate }）
const audio = IceVoice.decodeWav(buf);                 // 或从 AudioBuffer 取 channels
const out = IceVoice.transformScript('机械，变调(-12)，机械', audio, {
  preserveDuration: true,   // true（默认）：变调只改音高、不改速度；false：音高+速度同时变
  normalize: true
});
// out = { channels:Float32Array[], sampleRate }
```

> 浏览器里把 `transformBuffer` 换成「取 channels → `transformScript` → 转回 AudioBuffer」即可：
> `IceVoice.channelsToAudioBuffer(ctx, out.channels, out.sampleRate)`。

### 2.4 WAV 编解码

- `IceVoice.decodeWav(arrayBuffer) => { sampleRate, channels: Float32Array[], length, bitDepth }`
  支持 PCM 16/24/32 bit 与 IEEE float 32/64 bit。
- `IceVoice.encodeWav(audio, bitDepth, floatFlag?) => ArrayBuffer`
  `bitDepth` = 16 | 24 | 32；传 `'32f'` 或第三参 `true` 输出 float32 WAV。

### 2.5 工具 / 自检

- `IceVoice.hasWebAudio() => boolean`
- `IceVoice.selfTest() => { ok, checks }`：算法自检（WAV 往返、机械边带、载波抑制、多层递进、变调频率 / 时长）。**发布前跑一遍确认算法没漂。**
- `IceVoice.audioBufferToChannels(buf)` / `IceVoice.channelsToAudioBuffer(ctx, channels, sr)`：AudioBuffer ↔ Float32Array[] 互转。
- `IceVoice.SOURCE`：上游算法出处与记录的 sha256，用于在线校验。
- `IceVoice.parseScript(text)` / `IceVoice.transformScript(text, audio, opts)`：序列式接口（见 2.3）。

---

## 3. 参数速查表

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `layers` | number | 1 | 寒冰（机械音效）叠加层数，1~99。越大越冰冷夸张。 |
| `pitchSemitones` | number | 0 | 变调半音，-24~+24。**只改音高、不改时长**（相位声码器）。 |
| `order` | string | `'pitch-first'` | 处理顺序：`pitch-first` 先变调后寒冰；`ice-first` 先寒冰后变调。两者听感略有差异。 |
| `engine` | string | `'js'` | `'js'`（默认·最稳·跨浏览器）/ `'webaudio'`（浏览器原生·实验性）/ `'auto'`（=纯 JS）。 |
| `preserveDuration` | boolean | `true` | 仅 `transformScript` 用：**变调是否保持原速**。`true`=只改音高不改速度；`false`=音高+速度同时变。 |
| `normalize` | boolean | `true` | 输出峰值归一化到 -1 dB。 |
| `onProgress` | function | — | 进度回调，便于做进度条。 |

---

## 4. 「AI 变声插件 → 寒冰特效」插件链路（推荐模式）

你的 AI 变声器先产出变声结果（AudioBuffer / WAV），再把数据交给本库做后置特效：

```js
// 伪代码：在浏览器里
async function aiVoiceThenIce(rawAudioBuffer, iceOpts) {
  const aiBuffer = await yourAIVoiceChanger(rawAudioBuffer); // 你的 AI 变声插件
  const iceBuffer = await IceVoice.transformBuffer(aiBuffer, iceOpts); // 后置寒冰特效
  return iceBuffer;
}
```

Node 侧同理：先 `decodeWav` 你的 WAV → 你的处理 → `transformChannels` → `encodeWav` 写出。
这样寒冰特效就是**可插拔的最后一段**，不影响你原有变声逻辑，参数（层数 / 变调）完全独立可调。

---

## 5. 错误处理

- 输入不是合法 WAV：`decodeWav` 抛 `Error('不是有效的 WAV 文件…')` / `'WAV 缺少 fmt 块'` 等 —— 捕获后提示用户换文件。
- 引擎选择：默认即纯 JS 引擎（确定可出声、跨浏览器一致）；`webaudio` 为浏览器原生离线渲染实验模式，任一通道渲染失败会自动回退纯 JS，保证一定有输出。
- 变调范围外：参数会被 `clamp` 到 [-24, 24]，不会崩。
- 层数过多导致卡顿：纯 JS 引擎是逐样本 CPU 计算，超长音频 + 高层数会慢；建议先在小段上试。

---

## 6. 校验算法没被改坏

发布前在 Node 跑：

```js
const IceVoice = require('./js/ice-voice-core.js');
const r = IceVoice.selfTest();
console.log(r.ok ? '算法自检通过' : '自检失败', r.checks);
```

或在浏览器点工具里的「🔍 校验上游算法」，它会比对 `IceVoice.SOURCE.robotEffectSha256` 与线上 `robot-effect.js` 的 sha256。