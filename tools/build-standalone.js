/**
 * build-standalone.js — 把 index.html 与其引用的 js/ice-voice-core.js 合并成
 * 一个完全离线、可直接双击打开的单文件 HTML（寒冰变声器_单文件版.html）。
 *
 * 用法：node tools/build-standalone.js
 * 依赖：无（仅 Node 内置 fs/path）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const htmlPath = path.join(ROOT, 'index.html');
const corePath = path.join(ROOT, 'js', 'ice-voice-core.js');
const outPath = path.join(ROOT, '寒冰变声器_单文件版.html');

const html = fs.readFileSync(htmlPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

if (!html.includes('js/ice-voice-core.js')) {
    console.error('未在 index.html 中找到 <script src="js/ice-voice-core.js"> 引用，已中止。');
    process.exit(1);
}

const inlined = html.replace(
    /<script\s+src="js\/ice-voice-core\.js"><\/script>/,
    '<script>\n/* ===== ice-voice-core.js (inlined for standalone) ===== */\n' + core + '\n</script>'
);

if (inlined === html) {
    console.error('内联替换未发生，请检查 index.html 的引用写法。');
    process.exit(1);
}

fs.writeFileSync(outPath, inlined, 'utf8');
console.log('已生成单文件版：' + path.relative(ROOT, outPath) +
    '  (' + (inlined.length / 1024).toFixed(1) + ' KB)');
