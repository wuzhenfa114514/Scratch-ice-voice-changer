/*!
 * ice-voice-core.js — 寒冰变声核心库 v1.0.0
 * ============================================================
 * 「寒冰声音」= Scratch / TurboWarp 声音编辑器里的「机械」音效，
 * 反复叠加 N 层后得到的机械化搞笑音频特效。
 *
 * 算法权威出处（本库即按其 1:1 移植）：
 *   scratchfoundation/scratch-gui · src/lib/audio/effects/robot-effect.js
 *   https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/audio/effects/robot-effect.js
 *   sha256: c9d914e5942699c355364cfc113474775aa34c1507ea9638d015c48fa08b3c68
 *   （TurboWarp 桌面版/编辑器沿用同一份 scratch-gui 音频特效代码，
 *     TurboWarp 仓库: https://github.com/TurboWarp/desktop ）
 *
 * 该效果是一个 BBC Dalek 风格的环形调制器（Dalek voice）：
 *   50Hz 正弦载波 Vc 与输入 Vin 一起送入 4 个「二极管」WaveShaper
 *   非线性节点（Parker, DAFx11 论文给出的分段函数），
 *   与 1kHz 高通支路相加后经过动态压缩器
 *   （threshold -5dB / knee 15dB / ratio 12:1 / attack 0 / release 0.25s）。
 *   叠加 N 层 = 把整张图完整跑 N 遍，机械感指数级加深。
 *
 * 两种引擎：
 *   - 'webaudio'：浏览器内用 OfflineAudioContext 复刻上游节点图，
 *     与 Scratch/TurboWarp 实际听到的效果完全一致（默认，仅浏览器可用）。
 *   - 'js'：纯 JavaScript 逐样本实现，Node.js 与无 WebAudio 环境可用；
 *     压缩器按 Web Audio 规范语义实现，与浏览器内置存在极小样本级差异。
 *
 * 变调：相位声码器（phase vocoder）时间拉伸 + 重采样，
 *       只改音高、不改速度（与 Scratch 的「更快/更慢」不同，那两个会同时变速）。
 *
 * UMD：浏览器挂 window.IceVoice；Node 用 require('ice-voice-core')。
 * MIT License.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.IceVoice = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var VERSION = '1.0.0';

    /* ---------------------------------------------------------
     * 一、算法常量（与上游 robot-effect.js 逐值对应）
     * --------------------------------------------------------- */

    var ROBOT = {
        carrierFreq: 50,          // oscillator.frequency.value
        diode: {                  // Parker 论文分段函数参数
            vb: 0.2,
            vl: 0.4,
            h: 0.65,
            curveLength: 1024     // WaveShaper curve 长度
        },
        highpass: { freq: 1000, q: 1 },   // biquadFilter (gain 1.25 对 highpass 无效，上游原样保留)
        compressor: {
            threshold: -5,        // dB
            knee: 15,             // dB
            ratio: 12,
            attack: 0,            // s
            release: 0.25         // s
        }
    };

    var SOURCE = {
        repo: 'https://github.com/scratchfoundation/scratch-gui',
        robotEffectFile: 'https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/audio/effects/robot-effect.js',
        robotEffectRaw: 'https://raw.githubusercontent.com/scratchfoundation/scratch-gui/develop/src/lib/audio/effects/robot-effect.js',
        audioEffectsFile: 'https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/audio/audio-effects.js',
        audioEffectsRaw: 'https://raw.githubusercontent.com/scratchfoundation/scratch-gui/develop/src/lib/audio/audio-effects.js',
        turbowarp: 'https://github.com/TurboWarp/desktop',
        robotEffectSha256: 'c9d914e5942699c355364cfc113474775aa34c1507ea9638d015c48fa08b3c68',
        retrievedAt: '2026-10-13'
    };

    /* ---------------------------------------------------------
     * 二、WAV 编解码（纯 JS，无依赖）
     * --------------------------------------------------------- */

    function decodeWav(arrayBuffer) {
        if (!arrayBuffer || arrayBuffer.byteLength < 44) {
            throw new Error('WAV 数据太短或为空');
        }
        var view = new DataView(arrayBuffer);
        var riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        var wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
        if (riff !== 'RIFF' || wave !== 'WAVE') {
            throw new Error('不是有效的 WAV 文件（缺少 RIFF/WAVE 头）');
        }
        var pos = 12;
        var fmt = null;
        var dataOffset = -1;
        var dataSize = 0;
        while (pos + 8 <= view.byteLength) {
            var id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
            var size = view.getUint32(pos + 4, true);
            var body = pos + 8;
            if (id === 'fmt ') {
                fmt = {
                    audioFormat: view.getUint16(body, true),
                    numChannels: view.getUint16(body + 2, true),
                    sampleRate: view.getUint32(body + 4, true),
                    bitsPerSample: view.getUint16(body + 14, true)
                };
                if (fmt.audioFormat === 0xFFFE && size >= 40) {
                    // EXTENSIBLE：真正格式在 SubFormat GUID 前 2 字节
                    fmt.audioFormat = view.getUint16(body + 24, true);
                }
            } else if (id === 'data') {
                dataOffset = body;
                dataSize = Math.min(size, view.byteLength - body);
            }
            pos = body + size + (size % 2); // 块按 2 字节对齐
        }
        if (!fmt) throw new Error('WAV 缺少 fmt 块');
        if (dataOffset < 0) throw new Error('WAV 缺少 data 块');

        var channels = [];
        var ch;
        for (ch = 0; ch < fmt.numChannels; ch++) channels.push(new Float32Array(0));
        var frames = Math.floor(dataSize / (fmt.numChannels * (fmt.bitsPerSample / 8)));
        for (ch = 0; ch < fmt.numChannels; ch++) channels[ch] = new Float32Array(frames);

        var i, c, v;
        if (fmt.audioFormat === 1 && fmt.bitsPerSample === 16) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < fmt.numChannels; c++) {
                    v = view.getInt16(dataOffset + (i * fmt.numChannels + c) * 2, true);
                    channels[c][i] = v / 32768;
                }
            }
        } else if (fmt.audioFormat === 1 && fmt.bitsPerSample === 24) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < fmt.numChannels; c++) {
                    var o = dataOffset + (i * fmt.numChannels + c) * 3;
                    v = (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16));
                    channels[c][i] = v / 8388608;
                }
            }
        } else if (fmt.audioFormat === 1 && fmt.bitsPerSample === 32) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < fmt.numChannels; c++) {
                    v = view.getInt32(dataOffset + (i * fmt.numChannels + c) * 4, true);
                    channels[c][i] = v / 2147483648;
                }
            }
        } else if (fmt.audioFormat === 3 && fmt.bitsPerSample === 32) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < fmt.numChannels; c++) {
                    channels[c][i] = view.getFloat32(dataOffset + (i * fmt.numChannels + c) * 4, true);
                }
            }
        } else if (fmt.audioFormat === 3 && fmt.bitsPerSample === 64) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < fmt.numChannels; c++) {
                    channels[c][i] = view.getFloat64(dataOffset + (i * fmt.numChannels + c) * 8, true);
                }
            }
        } else {
            throw new Error('不支持的 WAV 格式: audioFormat=' + fmt.audioFormat + ', bits=' + fmt.bitsPerSample +
                '（支持 PCM 16/24/32bit 与 IEEE float 32/64bit）');
        }
        return {
            sampleRate: fmt.sampleRate,
            channels: channels,
            length: frames,
            bitDepth: fmt.bitsPerSample
        };
    }

    function encodeWav(audio, bitDepth, floatFlag) {
        if (bitDepth === '32f') { bitDepth = 32; floatFlag = true; }
        bitDepth = bitDepth || 16;
        var channels = audio.channels;
        var numChannels = channels.length;
        var frames = (audio.length != null) ? audio.length
            : (channels[0] ? channels[0].length : 0);
        var sampleRate = audio.sampleRate;
        if (numChannels === 0 || frames === 0) throw new Error('没有可编码的音频数据');

        var bytesPerSample = bitDepth / 8;
        var isFloat = !!floatFlag;
        var blockAlign = numChannels * bytesPerSample;
        var dataSize = frames * blockAlign;
        var buffer = new ArrayBuffer(44 + dataSize);
        var view = new DataView(buffer);

        function writeStr(off, s) {
            for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
        }
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, isFloat ? 3 : 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        var i, c, s;
        if (isFloat) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < numChannels; c++) {
                    view.setFloat32(44 + (i * numChannels + c) * 4, clamp(channels[c][i], -1, 1), true);
                }
            }
        } else if (bitDepth === 16) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < numChannels; c++) {
                    s = clamp(channels[c][i], -1, 1);
                    view.setInt16(44 + (i * numChannels + c) * 2, s < 0 ? s * 32768 : s * 32767, true);
                }
            }
        } else if (bitDepth === 24) {
            for (i = 0; i < frames; i++) {
                for (c = 0; c < numChannels; c++) {
                    s = clamp(channels[c][i], -1, 1);
                    v = s < 0 ? s * 8388608 : s * 8388607;
                    var iv = Math.max(-8388608, Math.min(8388607, Math.round(v)));
                    var off = 44 + (i * numChannels + c) * 3;
                    view.setUint8(off, iv & 0xFF);
                    view.setUint8(off + 1, (iv >> 8) & 0xFF);
                    view.setUint8(off + 2, (iv >> 16) & 0xFF);
                }
            }
        } else {
            throw new Error('encodeWav 仅支持 16 / 24 / 32(float) 位');
        }
        return buffer;
    }

    /* ---------------------------------------------------------
     * 三、纯 JS 引擎：Dalek 环形调制（robot-effect.js 移植）
     * --------------------------------------------------------- */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // 上游 Parker 论文分段函数：二极管电压传输曲线
    function diodeTransform(v, vb, vl, h) {
        if (v <= vb) return 0;
        if (v <= vl) return h * (Math.pow(v - vb, 2) / ((2 * vl) - (2 * vb)));
        return (h * v) - (h * vl) + (h * (Math.pow(v - vb, 2) / ((2 * vl) - (2 * vb))));
    }

    // 与 WebAudio WaveShaperNode 行为一致：[-1,1] 之外钳位，中间线性插值
    function buildDiodeCurve() {
        var n = ROBOT.diode.curveLength;
        var curve = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var voltage = (2 * (i / n)) - 1;
            curve[i] = diodeTransform(voltage, ROBOT.diode.vb, ROBOT.diode.vl, ROBOT.diode.h);
        }
        return curve;
    }

    function makeWaveShaper(curve) {
        var n = curve.length;
        return function (x) {
            if (x >= 1) return curve[n - 1];
            if (x <= -1) return curve[0];
            var pos = (x + 1) * 0.5 * (n - 1);
            var i0 = Math.floor(pos);
            var frac = pos - i0;
            if (i0 >= n - 1) return curve[n - 1];
            return curve[i0] * (1 - frac) + curve[i0 + 1] * frac;
        };
    }

    // 载波整流支路 S(t) = -(D(+0.5·Vc) + D(-0.5·Vc))，只跟时间有关，与输入无关，
    // 整条处理链（任意层数）只需算一次。返回一个载波周期的表。
    function buildCarrierTable(sampleRate, freq) {
        var curve = buildDiodeCurve();
        var shape = makeWaveShaper(curve);
        var period = Math.max(2, Math.round(sampleRate / freq));
        var table = new Float32Array(period);
        for (var i = 0; i < period; i++) {
            var vc = Math.sin(2 * Math.PI * freq * i / sampleRate);
            table[i] = -(shape(0.5 * vc) + shape(-0.5 * vc));
        }
        return table;
    }

    // RBJ  cookbook 二阶高通（与 WebAudio BiquadFilterNode highpass 一致的系数）
    function highpassCoeffs(sampleRate, f0, q) {
        var w0 = 2 * Math.PI * f0 / sampleRate;
        var cos = Math.cos(w0);
        var alpha = Math.sin(w0) / (2 * q);
        var b0 = (1 + cos) / 2, b1 = -(1 + cos), b2 = (1 + cos) / 2;
        var a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
        return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
    }

    // 按 Web Audio 规范语义实现的动态压缩器（峰值包络 + attack/release 单极点 + 软膝曲线）
    function makeCompressor(sampleRate) {
        var c = ROBOT.compressor;
        var attackCoef = c.attack <= 0 ? 1 : 1 - Math.exp(-1 / (c.attack * sampleRate));
        var releaseCoef = c.release <= 0 ? 1 : 1 - Math.exp(-1 / (c.release * sampleRate));
        var k = c.knee / 2;
        var env = 0;
        return function (x) {
            var ax = x < 0 ? -x : x;
            var coef = ax > env ? attackCoef : releaseCoef;
            env += (ax - env) * coef;
            if (env < 1e-8) return x;
            var envDb = 20 * Math.log10(env);
            var over = envDb - c.threshold;
            var outDb;
            if (over <= -k) {
                outDb = envDb;
            } else if (over >= k) {
                outDb = c.threshold + over / c.ratio;
            } else {
                outDb = envDb + (1 / c.ratio - 1) * (over + k) * (over + k) / (4 * k);
            }
            var gain = Math.pow(10, (outDb - envDb) / 20);
            return x * gain;
        };
    }

    /**
     * 纯 JS 单层「机械/寒冰」音效。
     * @param {Float32Array} x 输入（单声道，-1..1）
     * @param {number} sampleRate
     * @param {object} [opts] {freq=50, curve, carrier, hp, comp}
     * @returns {Float32Array} 新缓冲（不修改入参）
     */
    function applyRobotLayer(x, sampleRate, opts) {
        opts = opts || {};
        var freq = opts.freq || ROBOT.carrierFreq;
        var shape = opts.shape || makeWaveShaper(opts.curve || buildDiodeCurve());
        var carrier = opts.carrier || buildCarrierTable(sampleRate, freq);
        var hp = opts.hp || highpassCoeffs(sampleRate, ROBOT.highpass.freq, ROBOT.highpass.q);
        var comp = opts.comp || makeCompressor(sampleRate);
        var period = carrier.length;
        var w = 2 * Math.PI * freq / sampleRate;
        var len = x.length;
        var y = new Float32Array(len);
        // biquad 直 II 型状态（跨整轨连续，与 WebAudio 一致）
        var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (var n = 0; n < len; n++) {
            var vin = x[n];
            var vc = Math.sin(w * n);
            var halfVc = 0.5 * vc;
            var s = carrier[n % period];
            var u = shape(vin + halfVc) + shape(-(vin + halfVc)) + s;
            // highpass(vin)
            var hpOut = hp.b0 * vin + hp.b1 * x1 + hp.b2 * x2 - hp.a1 * y1 - hp.a2 * y2;
            x2 = x1; x1 = vin; y2 = y1; y1 = hpOut;
            y[n] = comp(u + hpOut);
        }
        return y;
    }

    /* ---------------------------------------------------------
     * 四、WebAudio 引擎：按上游节点图 1:1 复刻（仅浏览器）
     * --------------------------------------------------------- */

    function hasWebAudio() {
        return typeof window !== 'undefined' &&
            (window.OfflineAudioContext || window.webkitOfflineAudioContext);
    }

    /**
     * 在给定的 OfflineAudioContext 上搭建 RobotEffect 节点图（与上游连接方式逐条对应）。
     * 整轨生效模式：passthrough 增益为 0（上游仅在裁剪区外才走干路）。
     */
    function buildRobotGraph(ctx, freq) {
        var input = ctx.createGain();
        var output = ctx.createGain();
        var passthrough = ctx.createGain();   // 上游干路；整段处理时置 0
        var effectInput = ctx.createGain();
        effectInput.gain.value = 1;           // 整段生效：effectInput 常开、passthrough 常关
        passthrough.gain.value = 0;

        function createDiodeNode() {
            var node = ctx.createWaveShaper();
            var n = ROBOT.diode.curveLength;
            var curve = new Float32Array(n);
            for (var i = 0; i < n; i++) {
                var voltage = (2 * (i / n)) - 1;
                curve[i] = diodeTransform(voltage, ROBOT.diode.vb, ROBOT.diode.vl, ROBOT.diode.h);
            }
            node.curve = curve;
            return node;
        }

        var oscillator = ctx.createOscillator();
        oscillator.frequency.value = freq || ROBOT.carrierFreq;
        oscillator.start(0);

        var vInGain = ctx.createGain(); vInGain.gain.value = 0.5;
        var vInInverter1 = ctx.createGain(); vInInverter1.gain.value = -1;
        var vInInverter2 = ctx.createGain(); vInInverter2.gain.value = -1;
        var vInDiode1 = createDiodeNode();
        var vInDiode2 = createDiodeNode();
        var vInInverter3 = ctx.createGain(); vInInverter3.gain.value = -1;
        var vcInverter1 = ctx.createGain(); vcInverter1.gain.value = -1;
        var vcDiode3 = createDiodeNode();
        var vcDiode4 = createDiodeNode();

        var compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = ROBOT.compressor.threshold;
        compressor.knee.value = ROBOT.compressor.knee;
        compressor.ratio.value = ROBOT.compressor.ratio;
        compressor.attack.value = ROBOT.compressor.attack;
        compressor.release.value = ROBOT.compressor.release;

        var biquadFilter = ctx.createBiquadFilter();
        biquadFilter.type = 'highpass';
        biquadFilter.frequency.value = ROBOT.highpass.freq;
        biquadFilter.gain.value = 1.25; // 上游原值（对 highpass 无实际作用）

        input.connect(effectInput);
        input.connect(passthrough);
        passthrough.connect(output);

        effectInput.connect(vcInverter1);
        effectInput.connect(vcDiode4);

        oscillator.connect(vInGain);
        vInGain.connect(vInInverter1);
        vInGain.connect(vcInverter1);
        vInGain.connect(vcDiode4);

        vInInverter1.connect(vInInverter2);
        vInInverter1.connect(vInDiode2);
        vInInverter2.connect(vInDiode1);

        vInDiode1.connect(vInInverter3);
        vInDiode2.connect(vInInverter3);

        vInInverter3.connect(compressor);
        vcDiode3.connect(compressor);
        vcDiode4.connect(compressor);

        effectInput.connect(biquadFilter);
        biquadFilter.connect(compressor);

        compressor.connect(output);

        return { input: input, output: output };
    }

    /**
     * WebAudio 单层渲染：输入 AudioBuffer（按声道逐个处理，与上游单声道行为一致）。
     */
    function applyRobotLayerWebAudio(channelData, sampleRate, freq) {
        var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        var len = channelData.length;
        var ctx = new OfflineCtx(1, Math.max(2, len), sampleRate);
        var srcBuf = ctx.createBuffer(1, len, sampleRate);
        srcBuf.copyToChannel(channelData, 0);
        var src = ctx.createBufferSource();
        src.buffer = srcBuf;
        var graph = buildRobotGraph(ctx, freq);
        src.connect(graph.input);
        graph.output.connect(ctx.destination);
        src.start(0);
        return ctx.startRendering();
    }

    /* ---------------------------------------------------------
     * 五、相位声码器变调（只改音高，不改速度）
     * --------------------------------------------------------- */

    function princarg(p) {
        return p - 2 * Math.PI * Math.round(p / (2 * Math.PI));
    }

    // 迭代基-2 FFT（原地）
    function fft(re, im) {
        var n = re.length;
        var i, j, k;
        for (i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr = re[i]; re[i] = re[j]; re[j] = tr;
                var ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var ang = -2 * Math.PI / len;
            var wr = Math.cos(ang), wi = Math.sin(ang);
            for (i = 0; i < n; i += len) {
                var cr = 1, ci = 0;
                for (k = 0; k < len / 2; k++) {
                    var ur = re[i + k], ui = im[i + k];
                    var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                    var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                    re[i + k] = ur + vr; im[i + k] = ui + vi;
                    re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                    var ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = ncr;
                }
            }
        }
    }

    function ifft(re, im) {
        var n = re.length;
        for (var i = 0; i < n; i++) im[i] = -im[i];
        fft(re, im);
        for (i = 0; i < n; i++) {
            re[i] /= n;
            im[i] = -im[i] / n;
        }
    }

    /**
     * 单声道相位声码器变调。
     * @param {Float32Array} x
     * @param {number} sampleRate
     * @param {number} semitones -24..+24
     * @param {object} [opts] {fftSize=2048, onProgress}
     */
    function pitchShiftMono(x, sampleRate, semitones, opts) {
        opts = opts || {};
        if (!semitones || Math.abs(semitones) < 1e-9) return x.slice();
        var N = opts.fftSize || 2048;
        if (N < 256) N = 256;
        var H = N / 4;
        var ratio = Math.pow(2, semitones / 12);
        var len = x.length;
        var stretchedLen = Math.max(Math.ceil(len * ratio), N + H);
        var Hs = H * ratio;
        var bins = N / 2 + 1;

        var w = new Float32Array(N);
        for (var i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));

        var nAna = Math.max(1, Math.floor((len - N) / H) + 1);
        var nSyn = Math.max(1, Math.floor((stretchedLen - N) / Hs) + 1);
        var expectedAna = 2 * Math.PI * H / N;   // 每 bin 每分析帧的预期相位推进 ×k
        var expectedSyn = 2 * Math.PI * Hs / N;  // 每 bin 每合成帧的预期相位推进 ×k

        var out = new Float32Array(stretchedLen);
        var winSum = new Float32Array(stretchedLen);
        var re = new Float32Array(N);
        var im = new Float32Array(N);
        var sumPhase = new Float32Array(bins);
        var frameCache = new Map();

        function getFrame(idx) {
            var f = frameCache.get(idx);
            if (f) return f;
            if (idx < 0 || idx >= nAna) {
                f = { mag: new Float32Array(bins), ph: new Float32Array(bins) };
            } else {
                re.fill(0); im.fill(0);
                var off = idx * H;
                for (var j = 0; j < N; j++) {
                    var s = (off + j < len) ? x[off + j] : 0;
                    re[j] = s * w[j];
                }
                fft(re, im);
                var mag = new Float32Array(bins), ph = new Float32Array(bins);
                for (var k = 0; k < bins; k++) {
                    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                    ph[k] = Math.atan2(im[k], re[k]);
                }
                f = { mag: mag, ph: ph };
            }
            frameCache.set(idx, f);
            if (frameCache.size > 4) {
                var minKey = Infinity;
                frameCache.forEach(function (v, kk) { if (kk < minKey) minKey = kk; });
                frameCache.delete(minKey);
            }
            return f;
        }

        for (var jj = 0; jj < nSyn; jj++) {
            var t = jj * Hs / H;
            var i0 = Math.floor(t);
            var frac = t - i0;
            var f0 = getFrame(i0);
            var f1 = getFrame(i0 + 1);
            var fm = i0 > 0 ? getFrame(i0 - 1) : null;
            for (var kk = 0; kk < bins; kk++) {
                var magI = f0.mag[kk] * (1 - frac) + f1.mag[kk] * frac;
                var dPhase = 0;
                if (fm) dPhase = princarg(f0.ph[kk] - fm.ph[kk] - expectedAna * kk);
                if (jj === 0) sumPhase[kk] = f0.ph[kk];
                else sumPhase[kk] += expectedSyn * kk + dPhase;
                var sr = Math.cos(sumPhase[kk]) * magI;
                var si = Math.sin(sumPhase[kk]) * magI;
                re[kk] = sr; im[kk] = si;
                if (kk > 0 && kk < N / 2) { re[N - kk] = sr; im[N - kk] = -si; }
            }
            ifft(re, im);
            var off2 = Math.round(jj * Hs);
            for (var n2 = 0; n2 < N; n2++) {
                var idx2 = off2 + n2;
                if (idx2 < stretchedLen) {
                    var s2 = re[n2] * w[n2];
                    out[idx2] += s2;
                    winSum[idx2] += w[n2] * w[n2];
                }
            }
            if (opts.onProgress && (jj & 63) === 0) {
                opts.onProgress({ stage: 'pitch', done: jj, total: nSyn });
            }
        }
        for (i = 0; i < stretchedLen; i++) {
            if (winSum[i] > 1e-8) out[i] /= winSum[i];
        }
        // 重采样回原始长度（读快 ratio 倍 → 时长不变、音高 ×ratio）
        var y = new Float32Array(len);
        for (var m = 0; m < len; m++) {
            var pos = m * ratio;
            var i3 = Math.floor(pos);
            var f3 = pos - i3;
            var a = out[Math.min(i3, stretchedLen - 1)];
            var b = out[Math.min(i3 + 1, stretchedLen - 1)];
            y[m] = a + (b - a) * f3;
        }
        return y;
    }

    /* ---------------------------------------------------------
     * 六、工具函数
     * --------------------------------------------------------- */

    function rms(data) {
        var s = 0;
        for (var i = 0; i < data.length; i++) s += data[i] * data[i];
        return Math.sqrt(s / Math.max(1, data.length));
    }

    function peakOf(channels) {
        var p = 0;
        for (var c = 0; c < channels.length; c++) {
            var d = channels[c];
            for (var i = 0; i < d.length; i++) {
                var a = d[i] < 0 ? -d[i] : d[i];
                if (a > p) p = a;
            }
        }
        return p;
    }

    function normalizePeak(channels, targetDb) {
        targetDb = (targetDb === undefined) ? -1 : targetDb;
        var p = peakOf(channels);
        if (p <= 0 || p >= Math.pow(10, targetDb / 20)) return channels;
        var g = Math.pow(10, targetDb / 20) / p;
        for (var c = 0; c < channels.length; c++) {
            var d = channels[c];
            for (var i = 0; i < d.length; i++) d[i] *= g;
        }
        return channels;
    }

    // Goertzel：测指定频率的能量（自检/测试用）
    function goertzel(data, sampleRate, freq) {
        var n = data.length;
        var w = 2 * Math.PI * freq / sampleRate;
        var coeff = 2 * Math.cos(w);
        var s1 = 0, s2 = 0;
        for (var i = 0; i < n; i++) {
            var s0 = data[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n;
    }

    function dominantFrequency(data, sampleRate, minFreq, maxFreq) {
        var best = minFreq, bestE = -1;
        var step = Math.max(1, (maxFreq - minFreq) / 400);
        for (var f = minFreq; f <= maxFreq; f += step) {
            var e = goertzel(data, sampleRate, f);
            if (e > bestE) { bestE = e; best = f; }
        }
        return best;
    }

    function audioBufferToChannels(buf) {
        var channels = [];
        for (var c = 0; c < buf.numberOfChannels; c++) channels.push(new Float32Array(buf.getChannelData(c)));
        return channels;
    }

    function channelsToAudioBuffer(ctx, channels, sampleRate) {
        var buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
        for (var c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c);
        return buf;
    }

    /* ---------------------------------------------------------
     * 七、主处理链
     * --------------------------------------------------------- */

    /**
     * 纯 JS 处理链（Node / 无 WebAudio 环境）。
     * @param {object} audio {channels: [Float32Array], sampleRate}
     * @param {object} opts {layers=1, pitchSemitones=0, robotFreq=50,
     *                       order='pitch-first'|'ice-first',
     *                       monoOnly=false, normalize=true, fftSize=2048,
     *                       onProgress}
     * @returns {object} {channels, sampleRate}
     */
    function transformChannels(audio, opts) {
        opts = opts || {};
        var layers = Math.max(1, Math.min(99, opts.layers || 1));
        var semitones = clamp(opts.pitchSemitones || 0, -24, 24);
        var freq = opts.robotFreq || ROBOT.carrierFreq;
        var order = opts.order || 'pitch-first';
        var monoOnly = !!opts.monoOnly;
        var sampleRate = audio.sampleRate;
        var channels = audio.channels.map(function (d) { return new Float32Array(d); });
        if (monoOnly && channels.length > 1) {
            var mixed = new Float32Array(channels[0].length);
            for (var c = 0; c < channels.length; c++) {
                for (var i = 0; i < mixed.length; i++) mixed[i] += channels[c][i] / channels.length;
            }
            channels = [mixed];
        }

        function report(stage, layer, total) {
            if (opts.onProgress) opts.onProgress({ stage: stage, layer: layer, total: total });
        }

        var shape = makeWaveShaper(buildDiodeCurve());
        var carrier = buildCarrierTable(sampleRate, freq);
        var hp = highpassCoeffs(sampleRate, ROBOT.highpass.freq, ROBOT.highpass.q);

        function icePass() {
            for (var L = 0; L < layers; L++) {
                report('ice', L + 1, layers);
                for (var ch = 0; ch < channels.length; ch++) {
                    channels[ch] = applyRobotLayer(channels[ch], sampleRate, {
                        freq: freq, shape: shape, carrier: carrier, hp: hp,
                        comp: makeCompressor(sampleRate)
                    });
                }
            }
        }

        function pitchPass() {
            if (Math.abs(semitones) < 1e-9) return;
            report('pitch', 0, 1);
            for (var ch = 0; ch < channels.length; ch++) {
                channels[ch] = pitchShiftMono(channels[ch], sampleRate, semitones, {
                    fftSize: opts.fftSize,
                    onProgress: function (p) { report('pitch', p.done, p.total); }
                });
            }
        }

        if (order === 'ice-first') { icePass(); pitchPass(); }
        else { pitchPass(); icePass(); }

        if (opts.normalize !== false) normalizePeak(channels, -1);
        return { channels: channels, sampleRate: sampleRate };
    }

    /**
     * 浏览器处理链：机械层走 OfflineAudioContext（与 Scratch 一致的节点图），
     * 变调走相位声码器。输入输出都是 AudioBuffer（采样率/长度/声道数不变）。
     */
    function transformBuffer(audioBuffer, opts) {
        opts = opts || {};
        var layers = Math.max(1, Math.min(99, opts.layers || 1));
        var semitones = clamp(opts.pitchSemitones || 0, -24, 24);
        var freq = opts.robotFreq || ROBOT.carrierFreq;
        var order = opts.order || 'pitch-first';
        var monoOnly = !!opts.monoOnly;
        var engine = opts.engine || (hasWebAudio() ? 'webaudio' : 'js');
        var sampleRate = audioBuffer.sampleRate;

        function report(stage, layer, total) {
            if (opts.onProgress) opts.onProgress({ stage: stage, layer: layer, total: total });
        }

        var channels = audioBufferToChannels(audioBuffer);
        if (monoOnly && channels.length > 1) {
            var mixed = new Float32Array(channels[0].length);
            for (var c = 0; c < channels.length; c++) {
                for (var i = 0; i < mixed.length; i++) mixed[i] += channels[c][i] / channels.length;
            }
            channels = [mixed];
        }

        function pitchPass() {
            if (Math.abs(semitones) < 1e-9) return Promise.resolve();
            report('pitch', 0, 1);
            var ch = 0;
            function next() {
                if (ch >= channels.length) return Promise.resolve();
                var idx = ch++;
                return Promise.resolve(pitchShiftMono(channels[idx], sampleRate, semitones, {
                    fftSize: opts.fftSize,
                    onProgress: function (p) { report('pitch', p.done, p.total); }
                })).then(function (out) { channels[idx] = out; return next(); });
            }
            return next();
        }

        function icePass() {
            if (engine !== 'webaudio') {
                var shape = makeWaveShaper(buildDiodeCurve());
                var carrier = buildCarrierTable(sampleRate, freq);
                var hp = highpassCoeffs(sampleRate, ROBOT.highpass.freq, ROBOT.highpass.q);
                for (var L = 0; L < layers; L++) {
                    report('ice', L + 1, layers);
                    for (var ch = 0; ch < channels.length; ch++) {
                        channels[ch] = applyRobotLayer(channels[ch], sampleRate, {
                            freq: freq, shape: shape, carrier: carrier, hp: hp,
                            comp: makeCompressor(sampleRate)
                        });
                    }
                }
                return Promise.resolve();
            }
            var L2 = 0;
            function nextLayer() {
                if (L2 >= layers) return Promise.resolve();
                report('ice', L2 + 1, layers);
                var ch2 = 0;
                function nextCh() {
                    if (ch2 >= channels.length) return Promise.resolve();
                    var idx = ch2++;
                    return applyRobotLayerWebAudio(channels[idx], sampleRate, freq)
                        .then(function (rendered) {
                            channels[idx] = new Float32Array(rendered.getChannelData(0));
                            return nextCh();
                        });
                }
                return nextCh().then(nextLayer);
            }
            return nextLayer();
        }

        var chain = (order === 'ice-first') ? icePass().then(pitchPass) : pitchPass().then(icePass);
        return chain.then(function () {
            if (opts.normalize !== false) normalizePeak(channels, -1);
            var ctx = audioBuffer.context || new (window.AudioContext || window.webkitAudioContext)();
            return channelsToAudioBuffer(ctx, channels, sampleRate);
        });
    }

    /* ---------------------------------------------------------
     * 八、自检
     * --------------------------------------------------------- */

    function selfTest() {
        var checks = [];
        function check(name, ok, detail) {
            checks.push({ name: name, ok: !!ok, detail: detail || '' });
        }
        var fs = 44100;

        // 1) WAV 编解码往返
        try {
            var t = new Float32Array(fs / 10);
            for (var i = 0; i < t.length; i++) t[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / fs);
            var wav = encodeWav({ sampleRate: fs, channels: [t] }, 16);
            var back = decodeWav(wav);
            var maxErr = 0;
            for (i = 0; i < t.length; i++) maxErr = Math.max(maxErr, Math.abs(back.channels[0][i] - t[i]));
            check('WAV 编解码往返', maxErr < 0.001, '最大误差 ' + maxErr.toExponential(2));
        } catch (e) {
            check('WAV 编解码往返', false, e.message);
        }

        // 2) 单层机械音效：1kHz 正弦应出现 ±50Hz 边带（环形调制特征）
        try {
            var s = new Float32Array(fs); // 1 秒
            for (i = 0; i < s.length; i++) s[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / fs);
            var out1 = applyRobotLayer(s, fs, {});
            var carrier = goertzel(s, fs, 1000);
            var side1 = goertzel(out1, fs, 950);
            var side2 = goertzel(out1, fs, 1050);
            var carrierAfter = goertzel(out1, fs, 1000);
            check('机械音效边带(950/1050Hz)', side1 > carrier * 0.02 && side2 > carrier * 0.02,
                '边带能量 ' + side1.toFixed(4) + '/' + side2.toFixed(4) + ' vs 载波 ' + carrier.toFixed(4));
            check('机械音效改变原始信号', rms(out1) > 0.001 && Math.abs(rms(out1) - rms(s)) > 0.001,
                'RMS ' + rms(s).toFixed(4) + ' → ' + rms(out1).toFixed(4));
            check('载波被抑制', carrierAfter < carrier * 0.9, '1kHz 能量 ' + carrier.toFixed(4) + ' → ' + carrierAfter.toFixed(4));
        } catch (e) {
            check('机械音效边带(950/1050Hz)', false, e.message);
        }

        // 3) 多层叠加：层数越多，与原始信号差异越大
        try {
            var base = new Float32Array(fs / 2);
            for (i = 0; i < base.length; i++) base[i] = 0.4 * Math.sin(2 * Math.PI * 600 * i / fs) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * i / fs));
            var l1 = applyRobotLayer(base, fs, {});
            var l2 = applyRobotLayer(l1, fs, {});
            var l4 = l2;
            for (var k = 0; k < 2; k++) l4 = applyRobotLayer(l4, fs, {});
            var d12 = rms(sub(l1, l2));
            var d24 = rms(sub(l4, l2));
            check('多层叠加产生递进变化', d12 > 0 && d24 > 0 && Math.abs(d24 - d12) > 0,
                '相邻层差异 RMS: 1→2 ' + d12.toFixed(4) + ', 2→4 ' + d24.toFixed(4));
        } catch (e) {
            check('多层叠加产生递进变化', false, e.message);
        }

        // 4) 变调：440Hz +12 半音 → 约 880Hz，且时长不变
        try {
            var p = new Float32Array(fs);
            for (i = 0; i < p.length; i++) p[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / fs);
            var shifted = pitchShiftMono(p, fs, 12, {});
            var dom = dominantFrequency(shifted, fs, 600, 1200);
            check('变调 +12 半音 (440→880Hz)', Math.abs(dom - 880) / 880 < 0.05,
                '实测主频 ' + dom.toFixed(1) + ' Hz');
            check('变调不改时长', shifted.length === p.length, p.length + ' → ' + shifted.length + ' 样本');
            var shiftedDown = pitchShiftMono(p, fs, -12, {});
            var domDown = dominantFrequency(shiftedDown, fs, 150, 400);
            check('变调 -12 半音 (440→220Hz)', Math.abs(domDown - 220) / 220 < 0.05,
                '实测主频 ' + domDown.toFixed(1) + ' Hz');
        } catch (e) {
            check('变调 440→880Hz', false, e.message);
        }

        return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
    }

    function sub(a, b) {
        var r = new Float32Array(Math.min(a.length, b.length));
        for (var i = 0; i < r.length; i++) r[i] = a[i] - b[i];
        return r;
    }

    /* ---------------------------------------------------------
     * 导出
     * --------------------------------------------------------- */

    return {
        version: VERSION,
        SOURCE: SOURCE,
        ROBOT: ROBOT,
        // WAV
        decodeWav: decodeWav,
        encodeWav: encodeWav,
        // 纯 JS 引擎
        buildDiodeCurve: buildDiodeCurve,
        makeWaveShaper: makeWaveShaper,
        buildCarrierTable: buildCarrierTable,
        highpassCoeffs: highpassCoeffs,
        makeCompressor: makeCompressor,
        applyRobotLayer: applyRobotLayer,
        pitchShiftMono: pitchShiftMono,
        transformChannels: transformChannels,
        // WebAudio 引擎
        hasWebAudio: hasWebAudio,
        buildRobotGraph: buildRobotGraph,
        applyRobotLayerWebAudio: applyRobotLayerWebAudio,
        transformBuffer: transformBuffer,
        // 工具
        rms: rms,
        peakOf: peakOf,
        normalizePeak: normalizePeak,
        goertzel: goertzel,
        dominantFrequency: dominantFrequency,
        audioBufferToChannels: audioBufferToChannels,
        channelsToAudioBuffer: channelsToAudioBuffer,
        selfTest: selfTest
    };
});
