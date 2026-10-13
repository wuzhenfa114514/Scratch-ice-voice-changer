/**
 * ai-demo.js — 给「AI 变声插件」作者的最小接入示例。
 *
 * 场景：你已经有一个 AI 变声器，产出了变声后的音频（AudioBuffer 或 WAV）。
 * 现在想在其后「再叠一层寒冰特效」，做成插件链路：
 *
 *     AI 变声器 → [本库 applyIce()] → 寒冰版
 *
 * 这里演示：读取任意 WAV → 套寒冰 → 写出。浏览器里把 decodeWav/encodeWav
 * 换成 Web Audio 的 decodeAudioData / AudioBuffer 即可（见 index.html 与 API 文档）。
 *
 * 运行：node examples/ai-demo.js <输入.wav> <输出.wav>
 */
const fs = require('fs');
const IceVoice = require('../js/ice-voice-core.js');

function applyIce(buffer, opts) {
    // 浏览器：直接传 AudioBuffer 给 IceVoice.transformBuffer(...)
    // Node：WAV 解码为 {channels, sampleRate} 后走 transformChannels
    const audio = IceVoice.decodeWav(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    const out = IceVoice.transformChannels(audio, opts);
    return IceVoice.encodeWav(out, 16);
}

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
    console.log('用法：node examples/ai-demo.js <输入.wav> <输出.wav>');
    process.exit(0);
}
const wav = fs.readFileSync(inFile);
const ice = applyIce(wav, { layers: 3, pitchSemitones: 0, order: 'pitch-first' });
fs.writeFileSync(outFile, Buffer.from(ice));
console.log('寒冰特效已叠加 → ' + outFile + '（层数 3，不变调）');
