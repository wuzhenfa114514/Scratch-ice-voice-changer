#!/usr/bin/env node
/**
 * ice-cli.js — 命令行版寒冰变声器（Node，纯 JS 引擎，无需浏览器）
 *
 * 把一个音频文件叠上 N 层「寒冰/机械」特效，并可不变速升/降调，输出 WAV。
 * 这是给「AI 变声插件之后再加特效插件」场景的最小可用 CLI。
 *
 * 用法：
 *   node tools/ice-cli.js <输入.wav> [选项]
 *
 * 选项：
 *   -o, --out <文件>      输出路径（默认 <输入名>_ice.wav）
 *   -l, --layers <N>      寒冰层数，1~99，默认 3
 *   -p, --pitch <半音>    变调半音 -24~24，默认 0（不变调、不变速）
 *       --order <顺序>    pitch-first | ice-first，默认 pitch-first
 *       --depth <位>      输出位深 16 | 24 | 32，默认 16
 *   -h, --help            显示帮助
 *
 * 示例：
 *   node tools/ice-cli.js voice.wav -l 4 -p 5 -o voice_ice.wav
 *   node tools/ice-cli.js voice.wav --layers 8 --pitch -3 --depth 24
 */
const fs = require('fs');
const path = require('path');
const IceVoice = require('../js/ice-voice-core.js');

function showHelp() {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*!?/, '').trim());
}

function parseArgs(argv) {
    const a = { layers: 3, pitch: 0, order: 'pitch-first', depth: 16, out: null };
    let i = 0;
    let input = null;
    while (i < argv.length) {
        const t = argv[i];
        if (t === '-h' || t === '--help') { showHelp(); process.exit(0); }
        else if (t === '-o' || t === '--out') a.out = argv[++i];
        else if (t === '-l' || t === '--layers') a.layers = parseInt(argv[++i], 10);
        else if (t === '-p' || t === '--pitch') a.pitch = parseInt(argv[++i], 10);
        else if (t === '--order') a.order = argv[++i];
        else if (t === '--depth') a.depth = parseInt(argv[++i], 10);
        else if (!input) input = t;
        i++;
    }
    return { input, a };
}

function main() {
    const { input, a } = parseArgs(process.argv.slice(2));
    if (!input) { console.error('缺少输入文件。用法见 -h'); process.exit(1); }
    if (!fs.existsSync(input)) { console.error('输入文件不存在：' + input); process.exit(1); }

    const buf = fs.readFileSync(input);
    const audio = IceVoice.decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    console.log('输入：' + path.basename(input) + '  ' + audio.sampleRate + 'Hz ' +
        audio.channels.length + 'ch ' + (audio.length / audio.sampleRate).toFixed(2) + 's');

    const isFloat = a.depth === 32;
    const out = IceVoice.transformChannels(audio, {
        layers: a.layers, pitchSemitones: a.pitch, order: a.order, normalize: true
    });
    const wavBuf = IceVoice.encodeWav(out, a.depth, isFloat);

    const outPath = a.out || (path.basename(input, path.extname(input)) + '_ice.wav');
    fs.writeFileSync(outPath, Buffer.from(wavBuf));
    console.log('输出：' + outPath + '  （层数 ' + a.layers + '，变调 ' +
        (a.pitch > 0 ? '+' : '') + a.pitch + ' 半音，不变速）');
}

try { main(); }
catch (e) { console.error('错误：' + (e.message || e)); process.exit(1); }
