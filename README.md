# ❄ 寒冰变声器 · Ice Voice Changer

此项目纯由AI生成，斟酌使用！

把任意音频叠上 **N 层 Scratch / TurboWarp「机械」音效**，并可**不变速**地升 / 降调 —— 寒冰动画同款搞笑音频特效。

> 「寒冰声音」是什么？是作者在做 Scratch 动画时用的机械化音效（Scratch 声音编辑器里的「机械」效果），
> 一般叠 N 层制造冰冷、机器人的搞笑感。本工具把这套效果做成了**可自定义层数 + 可调音调**的本地变声器。

## ✨ 特性

- **序列式任意叠加（v2.1 新）**：不再只「先变调后寒冰」二选一。只有一条「自定义序列」输入框——**你怎么写就按从上到下的顺序依次处理**，顺序完全由你决定，可任意顺序无限叠加。例如
  `机械，机械，变调(-5)，机械，变调(-7)` 或 `变调(-12)，机械`。机械可带频率（`机械(50)`）。
- **一键堆叠按钮**：`＋机械` `＋变调` `＋升调` `＋降调` 点一下就把这一步追加到序列末尾，想叠多深点多少；`清空` 重来。
- **指令容错**：逗号中英文都行，半音可带或不带 `+` / `-` 号（`变调(+5)` 与 `变调(5)` 等价），全角括号 / 全角数字 / 全角正负号都能识别，多打的空逗号自动忽略。
- **保持音频原速（v2.1 新）**：新增「保持音频原速」开关（**默认勾选**）。勾选时变调只改音高、不改语速；
  取消后变调会同时改变音高与速度（松鼠 / 慢放效果）。
- **N 层寒冰特效**：层数越多机械 / 冰冷感越强（1 层已明显，3~6 层是日常搞笑档，10+ 层非常夸张）。
- **前后对比预览**：同一页面播放「原声」与「寒冰版」——两者**互相打断**（播原声会停寒冰版，反之亦然），方便对比。
- **自动下载默认关闭（v2.1 调整）**：「处理完成后自动下载」默认**不勾选**，需要时再勾，避免误下载。
- **本地工作区缓存 + 保存**：可连接任意本地文件夹（建议 E 盘）作为工作区，结果自动存「保存路径 / 输出 /」并备份到「保存路径 / backups /」。
- **本地优先、零上传**：所有处理在浏览器 / 本机完成，音频不上传任何服务器。
- **给开发者 / AI 的 API**：核心算法封装在 `js/ice-voice-core.js`（UMD），可当「AI 变声插件之后的特效插件」接入，并新增 `transformScript` / `parseScript` 序列接口。

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
# 序列式：--script "机械，机械，变调(-12)，机械"（任意顺序无限叠加，变调默认保持原速）
```

### 方式 C：作为 API 接入你的程序

见 `API接入说明书.md`，浏览器 / Node 两段示例，以及「AI 变声插件之后再加寒冰特效」的插件链路写法。

## 📁 仓库结构

```
github最终上传库/
├─ index.html                  # 完整工具（引用 js/ice-voice-core.js）
├─ 寒冰变声器_单文件版.html      # 单文件离线版（由 tools/build-standalone.js 生成）
├─ js/
│  └─ ice-voice-core.js        # 核心库 UMD（WAV编解码 / 机械音效 / 相位声码器变调 / 自检）
├─ tools/
│  ├─ ice-cli.js               # 命令行版
│  ├─ build-standalone.js      # 生成单文件版
│  └─ push-github.bat          # Windows 一键把整个目录推送到 GitHub
├─ examples/
│  ├─ generate-demos.js        # 生成演示 WAV
│  ├─ ai-demo.js               # AI 接入最小示例
│  └─ demo_*.wav               # 演示音频
├─ API接入说明书.md            # 给开发者 / AI 的接入文档（根目录）
├─ LICENSE                     # MIT
└─ README.md
```

## ⚠️ 克隆/下载本仓库后必读

`index.html` 是**模块化版**，它通过 `<script src="js/ice-voice-core.js">` 加载核心库。所以：

- **要保证能跑，`js/` 文件夹必须和 `index.html` 放在一起。** 如果你在 GitHub 网页上只上传了根目录那几个文件，在线打开 `index.html` 会因为找不到核心库而无法运行（页面会给出明确提示）。
- **最省心的办法：下载 `寒冰变声器_单文件版.html`。** 它已把核心库内联进页面，是真正的单文件，双击即用、也能直接发给朋友，Release 附件就是它。
- 用 git 克隆本仓库则无需担心，文件夹结构是完整的。

验证仓库是否完整，在线访问下面这个地址应该返回 200 而不是 404：

```
https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/js/ice-voice-core.js
```

## 📜 许可证


MIT License。算法移植自 Scratch / TurboWarp（BSD 风格），可自由用于开源或商业项目。