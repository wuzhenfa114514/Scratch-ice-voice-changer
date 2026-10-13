# ❄ 寒冰变声器 · Ice Voice Changer

把任意音频叠上 **N 层 Scratch / TurboWarp「机械」音效**，并可**不变速**地升 / 降调 —— 寒冰动画同款搞笑音频特效。

> 「寒冰声音」是什么？是作者在做 Scratch 动画时用的机械化音效（Scratch 声音编辑器里的「机械」效果），
> 一般叠 N 层制造冰冷、机器人的搞笑感。本工具把这套效果做成了**可自定义层数 + 可调音调**的本地变声器。

## ✨ 特性

- **N 层寒冰特效**：层数 1–20 可调，层数越多机械 / 冰冷感越强（1 层已明显，3~6 层是日常搞笑档，10+ 层非常夸张）。
- **不变速变调**：用相位声码器实现升 / 降半音（-12 ~ +12），**只改音高、不改语速**，与 Scratch 自带「更快 / 更慢」不同。
- **前后对比预览**：同一页面播放「原声」与「寒冰版」，斟酌后再下载。
- **处理完成自动下载**：勾选后处理完直接落盘 WAV。
- **E 盘工作区缓存 + 备份**：可连接 `E:\wuzhenfapack\下载\Scratch寒冰html动画编辑器\寒冰变声器AI工作区`，
  结果自动存 `工具默认保存输出音频路径/` 并额外备份到 `backups/`（需 Edge / Chrome 的文件夹访问权限；不支持则降级为浏览器下载，**不写 C 盘**）。
- **本地优先、零上传**：所有处理在浏览器 / 本机完成，音频不上传任何服务器。
- **给开发者 / AI 的 API**：核心算法封装在 `js/ice-voice-core.js`（UMD），可当「AI 变声插件之后的特效插件」接入。

## 🧊 算法来源（权威、可校验）

「寒冰声音」= Scratch / TurboWarp 声音编辑器里的「机械」音效，本质是 **BBC Dalek 风格的环形调制器**：

- 50 Hz 正弦载波 + 4 个「二极管」WaveShaper 非线性（Parker, DAFx11 论文分段函数）
- 与 1 kHz 高通支路相加，再经动态压缩器（threshold −5 dB / knee 15 dB / ratio 12:1 / release 0.25 s）。

上游代码（Scratch 与 TurboWarp 共用同一份）：

- `scratchfoundation/scratch-gui · src/lib/audio/effects/robot-effect.js`
  <https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/audio/effects/robot-effect.js>
- TurboWarp 仓库：<https://github.com/TurboWarp/desktop>

工具内「🔍 校验上游算法」按钮会联网拉取该文件并比对 sha256（记录值见 `IceVoice.SOURCE.robotEffectSha256`），
确认本库与上游 1:1 一致。

## 🚀 用法

### 方式 A：浏览器打开（最简单）

直接双击 `index.html`（或 `寒冰变声器_单文件版.html`，后者已把核心库内联，可离线单文件分发），拖入音频即可。
推荐用 **Edge / Chrome**（文件夹缓存功能需要 Chromium 内核）。

### 方式 B：命令行（Node，纯 JS 引擎）

```bash
node tools/ice-cli.js 输入.wav -l 4 -p 5 -o 输出.wav
# -l 层数(默认3)  -p 变调半音(默认0)  --depth 16|24|32  --order pitch-first|ice-first
```

### 方式 C：作为 API 接入你的程序

见 `docs/API接入说明书.md`，浏览器 / Node 两段示例，以及「AI 变声插件之后再加寒冰特效」的插件链路写法。

## 📁 仓库结构

```
github最终上传库/
├─ index.html                  # 完整工具（引用 js/ice-voice-core.js）
├─ 寒冰变声器_单文件版.html      # 单文件离线版（由 tools/build-standalone.js 生成）
├─ js/
│  └─ ice-voice-core.js        # 核心库 UMD（WAV编解码 / 机械音效 / 相位声码器变调 / 自检）
├─ tools/
│  ├─ ice-cli.js               # 命令行版
│  └─ build-standalone.js      # 生成单文件版
├─ examples/
│  ├─ generate-demos.js        # 生成演示 WAV
│  ├─ ai-demo.js               # AI 接入最小示例
│  └─ demo_*.wav               # 演示音频
├─ docs/
│  ├─ API接入说明书.md          # 给开发者 / AI 的接入文档
│  └─ GITHUB上传教程.md         # 开源发布到 GitHub 的步骤
├─ LICENSE                     # MIT
└─ README.md
```

## 📜 许可证

MIT License。算法移植自 Scratch / TurboWarp（BSD 风格），可自由用于开源或商业项目。