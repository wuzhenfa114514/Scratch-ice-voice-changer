/**
 * generate-demos.js — 生成 examples/ 下的演示音频（可复现）。
 * 运行：node examples/generate-demos.js
 */
const fs = require('fs');
const path = require('path');
const IceVoice = require('../js/ice-voice-core.js');

const SR = 44100;
function tone(dur) {
    const n = Math.floor(SR * dur);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        let s = 0.5 * Math.sin(2 * Math.PI * 220 * t);
        s += 0.25 * Math.sin(2 * Math.PI * 440 * t);
        s += 0.15 * Math.sin(2 * Math.PI * 660 * t);
        s *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t);
        ch[i] = s * 0.5;
    }
    return ch;
}
function save(name, channels) {
    const buf = IceVoice.encodeWav({ sampleRate: SR, channels, length: channels[0].length }, 16);
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(buf));
    console.log('已生成 ' + name);
}

const demo = tone(2.0);
save('demo_原声_440hz.wav', [demo]);
save('demo_寒冰3层.wav', IceVoice.transformChannels({ channels: [demo.slice()], sampleRate: SR }, { layers: 3 }).channels);
save('demo_寒冰3层_升5半音.wav', IceVoice.transformChannels({ channels: [demo.slice()], sampleRate: SR }, { layers: 3, pitchSemitones: 5 }).channels);
save('demo_寒冰8层.wav', IceVoice.transformChannels({ channels: [demo.slice()], sampleRate: SR }, { layers: 8 }).channels);
console.log('演示生成完成。');
