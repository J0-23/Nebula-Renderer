
// Progressive renderer — worker pool with task queue, adaptive sampling,
// SharedArrayBuffer accumulation, and dirty-rect progressive paint.

import { gaussianBlur } from "./helpers.js";

// ─── State ───────────────────────────────────────────────────────────────────

let canvas, ctx;
let width = 1920;
let height = 1080;
let accumulationBuffer = null;
let sab = null;
let useSAB = false;
let running = false;
let startTime = 0;
let currentRenderId = 0;
let numWorkers = 0;

let workerPool = [];
let cellQueue = [];
let queueHead = 0;

let workerStats = {};
let cellsDone = 0;
let cellsTotal = 0;

let dirtyRect = null;
let rafHandle = null;
let paintWorker = null;

// ─── Constants ────────────────────────────────────────────────────────────────

const WORLD_RANGE = 2.25;

// ─── Adaptive tuning ────────────────────────────────────────────────────────────

export const adaptiveDefaults = {
    enabled: false,
    varianceThreshold: 0.3,
    passMultiplier: 3,
    hitDensityThreshold: 0.1,
    chunkSize: 0.1,
};

let _adaptive = { ...adaptiveDefaults };

export const adaptiveTuning = {
    get() { return { ..._adaptive }; },
    update(patch) { _adaptive = { ..._adaptive, ...patch }; },
    reset() { _adaptive = { ...adaptiveDefaults }; },
};

// ─── Camera ───────────────────────────────────────────────────────────────────

function buildCamera(w, h, px, py, zoom) {
    const hw = w / 2;
    const scale = zoom * hw;
    return {
        scaleX: scale,
        scaleY: -scale,
        offsetX: -px * scale + w / 2,
        offsetY: py * scale + h / 2,
        W: w,
        H: h,
    };
}

// ─── Cell queue ──────────────────────────────────────────────────────────────

function buildCellQueue(chunkSize) {
    const cells = [];
    const worldMin = -WORLD_RANGE;
    const worldMax = WORLD_RANGE;

    for (let cx = worldMin; cx < worldMax; cx += chunkSize) {
        for (let cy = worldMin; cy < worldMax; cy += chunkSize) {
            cells.push({ x0: cx, x1: cx + chunkSize, y0: cy, y1: cy + chunkSize });
        }
    }

    // Fisher-Yates shuffle
    for (let i = cells.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells;
}

// ─── Worker source ───────────────────────────────────────────────────────────

function makeWorkerSource(filterSource, tracerSource) {
    return `"use strict";
${filterSource}
${tracerSource}

// Exploration settings
var EXPLORATION_RATE = 0.15;  // 15% of samples are random exploration
var EXPLORATION_BOOST = 2.0;   // Exploration hits count 2x to compensate for lower hit rate

function traceCell(cell, cam, step, buf, useSAB, countHits, sampleStats) {
    var W = cam.W, H = cam.H;
    var hits = 0, samples = 0, accepted = 0;
    var cellW = cell.x1 - cell.x0;
    var cellH = cell.y1 - cell.y0;
    var pixelHitCounts = [];
    
    function addHit(px, py) {
        if (px >= 0 && py >= 0 && px < W && py < H) {
            var idx = px + py * W;
            if (useSAB) {
                Atomics.add(buf, idx, 1);
            } else {
                buf[idx]++;
            }
            hits++;
            if (sampleStats) sampleStats.hits++;
        }
    }
    
    // Primary grid sampling (exploitation)
    for (var x = cell.x0; x < cell.x1; x += step) {
        for (var y = cell.y0; y < cell.y1; y += step) {
            samples++;
            var localHits = 0;
            
            var ok = false;
            try { ok = filterFunc(x, y, cam.it); } catch(e) {}
            if (!ok) continue;
            
            accepted++;
            try {
                tracerFunc(x, y, cam.it, function(fx, fy) {
                    var px = (fx * cam.scaleX + cam.offsetX + 0.5) | 0;
                    var py = (fy * cam.scaleY + cam.offsetY + 0.5) | 0;
                    addHit(px, py);
                    localHits++;
                });
            } catch(e) {}
            
            if (localHits > 0) pixelHitCounts.push(localHits);
        }
    }
    
    // Random exploration sampling - find rare trajectories
    // Only do this if filter found something (cell has detail)
    if (accepted > 0) {
        var exploreSamples = Math.max(3, Math.floor(accepted * EXPLORATION_RATE));
        for (var e = 0; e < exploreSamples; e++) {
            samples++;
            // Random point within cell - biased toward center
            var rx = cell.x0 + Math.random() * cellW;
            var ry = cell.y0 + Math.random() * cellH;
            
            var ok = false;
            try { ok = filterFunc(rx, ry, cam.it); } catch(e) {}
            if (!ok) continue;
            
            accepted++;
            try {
                tracerFunc(rx, ry, cam.it, function(fx, fy) {
                    var px = (fx * cam.scaleX + cam.offsetX + 0.5) | 0;
                    var py = (fy * cam.scaleY + cam.offsetY + 0.5) | 0;
                    addHit(px, py);
                });
            } catch(e) {}
        }
    }
    
    // Calculate variance (coefficient of variation)
    var density = samples > 0 ? hits / samples : 0;
    var variance = 0;
    if (pixelHitCounts.length > 1 && hits > 0) {
        var mean = hits / pixelHitCounts.length;
        var sumSqDiff = 0;
        for (var i = 0; i < pixelHitCounts.length; i++) {
            var diff = pixelHitCounts[i] - mean;
            sumSqDiff += diff * diff;
        }
        var stddev = Math.sqrt(sumSqDiff / pixelHitCounts.length);
        variance = stddev / (mean + 0.001);
    }
    
    if (countHits) _cellHits += hits;
    if (sampleStats) {
        sampleStats.totalSamples += samples;
        sampleStats.accepted += accepted;
    }
    return { density, variance, hits, samples };
}

self.onmessage = function(e) {
    var d = e.data;
    if (d.type === 'init') {
        self._cam = d.cam;
        self._baseStep = d.baseStep;
        self._useSAB = d.useSAB;
        self._coarseScale = d.coarseScale || 4;
        self._hitDensityThreshold = d.hitDensityThreshold || 0.1;
        self._varianceThreshold = d.varianceThreshold || 0.3;
        self._passMultiplier = d.passMultiplier || 3;
        if (d.useSAB) self._buf = new Uint32Array(d.sab);
        return;
    }

    if (d.type === 'cell') {
        var cam = self._cam;
        var baseStep = self._baseStep;
        var useSAB = self._useSAB;
        var cell = d.cell;
        var t0 = performance.now();

        var coarseScale = d.coarseScale || self._coarseScale;
        var hitDensityThreshold = d.hitDensityThreshold || self._hitDensityThreshold;
        var varianceThreshold = d.varianceThreshold || self._varianceThreshold || 0.3;
        var passMultiplier = d.passMultiplier || self._passMultiplier;

        var localBuf = useSAB ? self._buf : new Uint32Array(cam.W * cam.H);
        var coarseStep = baseStep * coarseScale;
        self._cellHits = 0;

        var sampleStats = { totalSamples: 0, hits: 0, accepted: 0 };

        var coarseResult = traceCell(cell, cam, coarseStep, localBuf, useSAB, true, sampleStats);
        var density = coarseResult.density;
        var variance = coarseResult.variance;

        // Score-based refinement: density = location, variance = detail priority
        // Higher score = more passes needed
        if (density > hitDensityThreshold && variance > varianceThreshold) {
            var score = density * (1 + variance);
            var extraPasses = Math.min(Math.floor(score * 20), passMultiplier * 3);
            for (var p = 0; p < extraPasses; p++) {
                traceCell(cell, cam, baseStep, localBuf, useSAB, true, sampleStats);
            }
        }

        var elapsed = performance.now() - t0;
        var totalHits = self._cellHits;

        if (useSAB) {
            self.postMessage({ type: 'done', cell: cell, elapsed: elapsed, hits: totalHits, variance: variance, stats: sampleStats });
        } else {
            var idxArr = [], valArr = [];
            for (var i = 0; i < localBuf.length; i++) {
                if (localBuf[i] > 0) { idxArr.push(i); valArr.push(localBuf[i]); }
            }
            self.postMessage({
                type: 'done', cell: cell, elapsed: elapsed, hits: totalHits, variance: variance, stats: sampleStats,
                indices: new Uint32Array(idxArr), values: new Uint32Array(valArr)
            }, [new Uint32Array(idxArr).buffer, new Uint32Array(valArr).buffer]);
        }
    }
};`;
}

// ─── Paint worker source ──────────────────────────────────────────────────────

function acesToneMap(x) {
    const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

function filmicToneMap(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const toe = 0.01, shoulder = 0.97, linearLength = 0.2;
    const linearStart = 1 - linearLength;

    if (x < toe) {
        const t = x / toe;
        return toe * t * t * (3 - 2 * t);
    } else if (x > linearStart) {
        const t = (x - linearStart) / linearLength;
        return 1 - Math.pow(1 - shoulder, 1 + t * 3);
    }
    return toe + (x - toe) / (linearStart - toe);
}

function reinhardToneMap(x) {
    return x / (1 + x);
}

function getToneFn(type) {
    if (type === 'aces') return acesToneMap;
    if (type === 'reinhard') return reinhardToneMap;
    return filmicToneMap;
}

function makePaintWorkerSource() {
    return `"use strict";

function acesToneMap(x) {
    var a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

function filmicToneMap(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var toe = 0.01, shoulder = 0.97, linearLength = 0.2;
    var linearStart = 1 - linearLength;
    if (x < toe) {
        var t = x / toe;
        return toe * t * t * (3 - 2 * t);
    } else if (x > linearStart) {
        var t = (x - linearStart) / linearLength;
        return 1 - Math.pow(1 - shoulder, 1 + t * 3);
    }
    return toe + (x - toe) / (linearStart - toe);
}

function reinhardToneMap(x) {
    return x / (1 + x);
}

function getToneFn(type) {
    if (type === 'aces') return acesToneMap;
    if (type === 'reinhard') return reinhardToneMap;
    return filmicToneMap;
}

function gaussianBlur(src, W, H, radius) {
    if (radius <= 1) return src;
    var sigma = radius / 3;
    var kernelSize = Math.ceil(sigma * 6) | 1;
    var half = (kernelSize - 1) / 2;
    var kernel = new Float32Array(kernelSize);
    var sum = 0;
    for (var k = 0; k < kernelSize; k++) {
        var x = k - half;
        kernel[k] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[k];
    }
    for (k = 0; k < kernelSize; k++) kernel[k] /= sum;

    var temp = new Float32Array(src.length);
    for (var y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            var val = 0;
            for (k = 0; k < kernelSize; k++) {
                var sx = Math.max(0, Math.min(W - 1, x + k - half));
                val += src[y * W + sx] * kernel[k];
            }
            temp[y * W + x] = val;
        }
    }

    var out = new Float32Array(src.length);
    for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            val = 0;
            for (k = 0; k < kernelSize; k++) {
                var sy = Math.max(0, Math.min(H - 1, y + k - half));
                val += temp[sy * W + x] * kernel[k];
            }
            out[y * W + x] = val;
        }
    }
    return out;
}

function applyBloom(hdr, W, H, params) {
    if (!params.enabled || params.intensity <= 0) return hdr;
    var threshold = params.threshold || 0.5;
    var intensity = params.intensity || 1.0;
    var radius = params.radius || 16;

    var bright = new Float32Array(hdr.length);
    var maxVal = 0;
    for (var i = 0; i < hdr.length; i++) {
        if (hdr[i] > maxVal) maxVal = hdr[i];
    }
    var threshVal = threshold * maxVal;

    for (i = 0; i < hdr.length; i++) {
        bright[i] = hdr[i] > threshVal ? hdr[i] - threshVal : 0;
    }

    var blurred = gaussianBlur(bright, W, H, radius);
    var out = new Float32Array(hdr.length);
    for (i = 0; i < hdr.length; i++) {
        out[i] = hdr[i] + blurred[i] * intensity;
    }
    return out;
}

function applyMicrocontrast(src, W, H, params) {
    if (!params.enabled || params.strength <= 0) return src;
    var strength = params.strength || 0.3;
    var radius = params.radius || 4;
    var blurred = gaussianBlur(src, W, H, radius);
    var out = new Float32Array(src.length);
    for (var i = 0; i < src.length; i++) {
        out[i] = Math.max(0, src[i] + (src[i] - blurred[i]) * strength);
    }
    return out;
}

function applySymmetry(src, W, H, symH, symV, order) {
    if (!symH && !symV) return src;

    var sym = new Float32Array(src.length);
    for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
            if (order === "h") {
                sym[y * W + x] = Math.max(src[y * W + x], src[y * W + (W - 1 - x)]);
            } else if (order === "v") {
                sym[y * W + x] = Math.max(src[y * W + x], src[(H - 1 - y) * W + x]);
            } else if (order === "4way") {
                var mx = symH ? W - 1 - x : x;
                var my = symV ? H - 1 - y : y;
                sym[y * W + x] = src[y * W + x] + src[my * W + mx];
            } else if (order === "alt4way") {
                var hMirror = src[y * W + (W - 1 - x)];
                var vMirror = src[(H - 1 - y) * W + x];
                var diagMirror = src[(H - 1 - y) * W + (W - 1 - x)];
                sym[y * W + x] = Math.max(src[y * W + x], hMirror, vMirror, diagMirror);
            } else {
                sym[y * W + x] = src[y * W + x];
            }
        }
    }
    return sym;
}

function applyColor(t, r, g, b, contrast, gamma, sat, vignette, invert, px, py, W, H) {
    if (contrast !== 1.0) {
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;
    }

    if (gamma !== 1.0) {
        r = Math.pow(Math.max(0, r / 255), 1 / gamma) * 255;
        g = Math.pow(Math.max(0, g / 255), 1 / gamma) * 255;
        b = Math.pow(Math.max(0, b / 255), 1 / gamma) * 255;
    }

    if (sat !== 100) {
        var rn = r / 255, gn = g / 255, bn = b / 255;
        var cmax = Math.max(rn, gn, bn);
        var cmin = Math.min(rn, gn, bn);
        var delta = cmax - cmin;
        var h = 0, s = 0, l = (cmax + cmin) / 2;
        if (delta > 0) {
            s = delta / (1 - Math.abs(2 * l - 1));
            if (cmax === rn) h = ((gn - bn) / delta % 6) * 60;
            else if (cmax === gn) h = ((bn - rn) / delta + 2) * 60;
            else h = ((rn - gn) / delta + 4) * 60;
        }
        var newS = s * sat / 100;
        var c2 = (1 - Math.abs(2 * l - 1)) * newS;
        var x2 = c2 * (1 - Math.abs((h / 60) % 2 - 1));
        var m = l - c2 / 2;
        var rr, gg, bb;
        if (h < 60) { rr = c2; gg = x2; bb = 0; }
        else if (h < 120) { rr = x2; gg = c2; bb = 0; }
        else if (h < 180) { rr = 0; gg = c2; bb = x2; }
        else if (h < 240) { rr = 0; gg = x2; bb = c2; }
        else if (h < 300) { rr = x2; gg = 0; bb = c2; }
        else { rr = c2; gg = 0; bb = x2; }
        r = (rr + m) * 255;
        g = (gg + m) * 255;
        b = (bb + m) * 255;
    }

    if (vignette > 0) {
        var vx = (px / (W - 1)) * 2 - 1;
        var vy = (py / (H - 1)) * 2 - 1;
        var vm = 1 - (vx * vx + vy * vy) * vignette;
        r *= vm; g *= vm; b *= vm;
    }

    if (invert) {
        r = 255 - r; g = 255 - g; b = 255 - b;
    }

    return [r, g, b];
}

self.onmessage = function(e) {
    var d = e.data;
    var src = d.src;
    var W = d.W, H = d.H;
    var p = d.params;

    // Find global max
    var max = 0;
    for (var i = 0; i < src.length; i++) if (src[i] > max) max = src[i];

    // Symmetry
    var symSrc = applySymmetry(src, W, H, p.symH, p.symV, p.symOrder);

    // Normalize to HDR
    var depthBoost = p.depthBoost !== undefined ? p.depthBoost : 1.0;
    var hdr = new Float32Array(W * H);
    for (i = 0; i < W * H; i++) {
        var t = max > 0 ? Math.sqrt(symSrc[i] / (max + 1)) : 0;
        if (depthBoost !== 1.0) t = Math.min(1, t * depthBoost);
        hdr[i] = t;
    }

    // Exposure
    var exposure = p.exposure !== undefined ? p.exposure : 1.0;
    if (exposure !== 1.0) {
        for (i = 0; i < hdr.length; i++) hdr[i] *= exposure;
    }

    // Tone mapping
    var toneFn = getToneFn(p.toneMap);
    var toneStrength = p.toneStrength !== undefined ? p.toneStrength : 1.0;
    var toneMapped = new Float32Array(hdr.length);
    for (i = 0; i < hdr.length; i++) {
        toneMapped[i] = toneStrength < 1.0
            ? hdr[i] * (1 - toneStrength) + toneFn(hdr[i]) * toneStrength
            : toneFn(hdr[i]);
    }

    // Bloom
    var afterBloom = p.bloomEnabled
        ? applyBloom(toneMapped, W, H, { enabled: true, threshold: p.bloomThreshold, intensity: p.bloomIntensity, radius: p.bloomRadius })
        : toneMapped;

    // Microcontrast
    var afterMicro = p.microEnabled
        ? applyMicrocontrast(afterBloom, W, H, { enabled: true, strength: p.microStrength, radius: p.microRadius })
        : afterBloom;

    // Convert to RGB
    var pixels = new Uint8ClampedArray(W * H * 4);
    var lc0 = p.lineColor ? p.lineColor[0] : 255;
    var lc1 = p.lineColor ? p.lineColor[1] : 255;
    var lc2 = p.lineColor ? p.lineColor[2] : 255;

    for (var py = 0; py < H; py++) {
        for (var px = 0; px < W; px++) {
            var idx = py * W + px;
            var pidx = idx * 4;
            var t = Math.max(0, Math.min(1, afterMicro[idx]));
            var r = lc0 * t, g = lc1 * t, b = lc2 * t;

            var rgb = applyColor(t, r, g, b,
                p.contrast, p.gamma, p.saturation, p.vignette, p.invert, px, py, W, H);
            r = rgb[0]; g = rgb[1]; b = rgb[2];

            pixels[pidx] = Math.max(0, Math.min(255, r + 0.5));
            pixels[pidx + 1] = Math.max(0, Math.min(255, g + 0.5));
            pixels[pidx + 2] = Math.max(0, Math.min(255, b + 0.5));
            pixels[pidx + 3] = 255;
        }
    }

    self.postMessage({ pixels: pixels, W: W, H: H }, [pixels.buffer]);
};`;
}

function makeDataUrl(src) {
    return "data:text/javascript;charset=utf-8," + encodeURIComponent(src);
}

function applyBloom(hdr, W, H, params) {
    if (!params.enabled || params.intensity <= 0) return hdr;
    const threshold = params.threshold ?? 0.5;
    const intensity = params.intensity ?? 1.0;
    const radius = params.radius ?? 16;

    let maxVal = 0;
    for (let i = 0; i < hdr.length; i++) if (hdr[i] > maxVal) maxVal = hdr[i];
    const threshVal = threshold * maxVal;

    const bright = new Float32Array(hdr.length);
    for (let i = 0; i < hdr.length; i++) {
        bright[i] = hdr[i] > threshVal ? hdr[i] - threshVal : 0;
    }

    const blurred = gaussianBlur(bright, W, H, radius);
    const out = new Float32Array(hdr.length);
    for (let i = 0; i < hdr.length; i++) {
        out[i] = hdr[i] + blurred[i] * intensity;
    }
    return out;
}

function applyMicrocontrast(src, W, H, params) {
    if (!params.enabled || params.strength <= 0) return src;
    const blurred = gaussianBlur(src, W, H, params.radius ?? 4);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
        out[i] = Math.max(0, src[i] + (src[i] - blurred[i]) * (params.strength ?? 0.3));
    }
    return out;
}

// ─── Paint helpers ─────────────────────────────────────────────────────────────

function applySymmetry(src, W, H, symH, symV, order) {
    if (!symH && !symV) return src;
    const sym = new Float32Array(src.length);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (order === "h") {
                sym[y * W + x] = Math.max(src[y * W + x], src[y * W + (W - 1 - x)]);
            } else if (order === "v") {
                sym[y * W + x] = Math.max(src[y * W + x], src[(H - 1 - y) * W + x]);
            } else if (order === "4way") {
                const mx = symH ? W - 1 - x : x;
                const my = symV ? H - 1 - y : y;
                sym[y * W + x] = src[y * W + x] + src[my * W + mx];
            } else if (order === "alt4way") {
                const hMirror = src[y * W + (W - 1 - x)];
                const vMirror = src[(H - 1 - y) * W + x];
                const diagMirror = src[(H - 1 - y) * W + (W - 1 - x)];
                sym[y * W + x] = Math.max(src[y * W + x], hMirror, vMirror, diagMirror);
            } else {
                sym[y * W + x] = src[y * W + x];
            }
        }
    }
    return sym;
}

function applyColor(t, r, g, b, contrast, gamma, sat, vignette, invert, px, py, W, H) {
    if (contrast !== 1.0) {
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;
    }
    if (gamma !== 1.0) {
        r = Math.pow(Math.max(0, r / 255), 1 / gamma) * 255;
        g = Math.pow(Math.max(0, g / 255), 1 / gamma) * 255;
        b = Math.pow(Math.max(0, b / 255), 1 / gamma) * 255;
    }
    if (sat !== 100) {
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const cmax = Math.max(rn, gn, bn);
        const cmin = Math.min(rn, gn, bn);
        const delta = cmax - cmin;
        let h = 0, s = 0, l = (cmax + cmin) / 2;
        if (delta > 0) {
            s = delta / (1 - Math.abs(2 * l - 1));
            if (cmax === rn) h = ((gn - bn) / delta % 6) * 60;
            else if (cmax === gn) h = ((bn - rn) / delta + 2) * 60;
            else h = ((rn - gn) / delta + 4) * 60;
        }
        const newS = s * sat / 100;
        const c2 = (1 - Math.abs(2 * l - 1)) * newS;
        const x2 = c2 * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c2 / 2;
        let rr, gg, bb;
        if (h < 60) { rr = c2; gg = x2; bb = 0; }
        else if (h < 120) { rr = x2; gg = c2; bb = 0; }
        else if (h < 180) { rr = 0; gg = c2; bb = x2; }
        else if (h < 240) { rr = 0; gg = x2; bb = c2; }
        else if (h < 300) { rr = x2; gg = 0; bb = c2; }
        else { rr = c2; gg = 0; bb = c2; }
        r = (rr + m) * 255;
        g = (gg + m) * 255;
        b = (bb + m) * 255;
    }
    if (vignette > 0) {
        const vx = (px / (W - 1)) * 2 - 1;
        const vy = (py / (H - 1)) * 2 - 1;
        const vm = 1 - (vx * vx + vy * vy) * vignette;
        r *= vm; g *= vm; b *= vm;
    }
    if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    return [r, g, b];
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function formatNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return n.toString();
}

function updateStatsPanel(callbacks) {
    const timeEl = document.getElementById("rst-time");
    const progressEl = document.getElementById("rst-progress");
    const hitsEl = document.getElementById("rst-hits");
    const workersEl = document.getElementById("rst-workers");
    const samplesEl = document.getElementById("rst-samples");
    const acceptedEl = document.getElementById("rst-accepted");
    if (!timeEl) return;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = cellsTotal > 0 ? Math.round((cellsDone / cellsTotal) * 100) : 0;
    const totalHits = accumulationBuffer
        ? accumulationBuffer.reduce((a, b) => a + b, 0)
        : 0;

    timeEl.textContent = `Time: ${elapsed}s`;
    progressEl.textContent = `Progress: ${progress}% (${cellsDone}/${cellsTotal} cells)`;
    hitsEl.textContent = `Total hits: ${formatNum(totalHits)}`;

    let totalSamples = 0, totalAccepted = 0, totalHitsVal = 0;
    for (const i in workerStats) {
        totalSamples += workerStats[i].totalSamples || 0;
        totalAccepted += workerStats[i].accepted || 0;
        totalHitsVal += workerStats[i].hits || 0;
    }
    const hitsPerSec = elapsed > 0 ? formatNum(Math.round(totalHitsVal / elapsed)) : 0;

    if (samplesEl) samplesEl.textContent = `Samples: ${formatNum(totalSamples)}`;
    if (acceptedEl) acceptedEl.textContent = `Hits/s: ${hitsPerSec}`;

    if (workersEl) {
        let html = "";
        for (let i = 0; i < numWorkers; i++) {
            const ws = workerStats[i] || {};
            const col = ws.status === "active" ? "#c9a84c"
                : ws.status === "done" ? "#55cc88" : "#555";
            const statusText = ws.status === "done" ? "DONE"
                : ws.status === "active" ? "RUN" : "IDLE";
            const hits = ws.hits || 0;
            const time = ws.elapsed || 1;
            const avgSpeed = Math.round((hits / time) * 1000);
            const spd = time > 0 ? formatNum(avgSpeed) + "/s" : "-";
            const accRate = ws.totalSamples > 0 ? (ws.accepted / ws.totalSamples * 100).toFixed(1) : 0;
            html += `<div class="worker-stat">
                <span class="worker-stat-id" style="color:${col}">W${i + 1}</span>
                <span class="worker-stat-info">${statusText} | ${formatNum(hits)}h | ${spd} | ${accRate}%</span>
            </div>`;
        }
        workersEl.innerHTML = html;
    }

    if (callbacks?.onStatus) {
        callbacks.onStatus(running ? `${progress}%` : `Done — ${elapsed}s`, running ? "run" : "");
    }
    if (callbacks?.onProgress) {
        callbacks.onProgress(cellsTotal > 0 ? cellsDone / cellsTotal : 0);
    }
}

// ─── Dirty rect ───────────────────────────────────────────────────────────────

function expandDirty(cell, cam) {
    const px0 = Math.max(0, Math.floor(cell.x0 * cam.scaleX + cam.offsetX));
    const px1 = Math.min(width, Math.ceil(cell.x1 * cam.scaleX + cam.offsetX));
    const py0 = Math.max(0, Math.floor(cell.y1 * cam.scaleY + cam.offsetY));
    const py1 = Math.min(height, Math.ceil(cell.y0 * cam.scaleY + cam.offsetY));

    if (!dirtyRect) {
        dirtyRect = { x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
    } else {
        dirtyRect = {
            x: Math.min(dirtyRect.x, px0),
            y: Math.min(dirtyRect.y, py0),
            w: Math.max(dirtyRect.x + dirtyRect.w, px1) - Math.min(dirtyRect.x, px0),
            h: Math.max(dirtyRect.y + dirtyRect.h, py1) - Math.min(dirtyRect.y, py0),
        };
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d", { alpha: false });
    const limit = window.threadLimit || 0;
    const autoWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
    numWorkers = limit > 0 ? Math.min(limit, 16) : autoWorkers;
    useSAB = typeof SharedArrayBuffer !== "undefined" && crossOriginIsolated;
    accumulationBuffer = new Uint32Array(width * height);
    console.log(`[Renderer] ${numWorkers} workers | SAB: ${useSAB}`);
}

export function getCtx() { return ctx; }
export function isRunning() { return running; }

function resetAccumBuffer() {
    const byteLen = width * height * 4;
    if (useSAB) {
        sab = new SharedArrayBuffer(byteLen);
        accumulationBuffer = new Uint32Array(sab);
    } else {
        sab = null;
        accumulationBuffer = new Uint32Array(width * height);
    }
}

export function clearGrid() {
    resetAccumBuffer();
}

export function stopRender() {
    running = false;
    currentRenderId++;
    if (rafHandle) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
    workerPool.forEach(({ worker }) => { try { worker.terminate(); } catch (e) {} });
    workerPool = [];
    if (paintWorker) { try { paintWorker.terminate(); } catch (e) {} }
    paintWorker = null;
}

export function startRender(params, callbacks = {}) {
    stopRender();
    currentRenderId++;

    const limit = window.threadLimit || 0;
    const autoWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
    numWorkers = limit > 0 ? Math.min(limit, 16) : autoWorkers;
    console.log(`[Renderer] ${numWorkers} threads | auto: ${autoWorkers}`);

    width = params.width;
    height = params.height;
    resetAccumBuffer();

    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Validate at startup
    try {
        new Function(params.filterSource + "\nreturn filterFunc;")();
        new Function(params.tracerSource + "\nreturn tracerFunc;")();
    } catch (err) {
        callbacks.onStatus?.("Error: " + err.message, "");
        return;
    }

    running = true;
    startTime = Date.now();
    workerStats = {};
    dirtyRect = null;

    const cam = buildCamera(width, height, params.px, params.py_, params.z || 1);
    cam.it = params.it;
    const baseStep = params.step || 0.001;

    // Adaptive params
    const adaptiveEnabled = params.adaptiveEnabled ?? _adaptive.enabled ?? false;
    const adaptiveChunk = adaptiveEnabled ? (params.chunkSize ?? _adaptive.chunkSize) : 0.2;
    const adaptiveCoarseScale = adaptiveEnabled
        ? Math.max(1, Math.round(8 / (params.adaptivePassMultiplier ?? _adaptive.passMultiplier)))
        : 999;
    const adaptiveHitThreshold = params.adaptiveHitThreshold ?? _adaptive.hitDensityThreshold;
    const adaptivePassMult = params.adaptivePassMultiplier ?? _adaptive.passMultiplier;

    cellQueue = buildCellQueue(adaptiveChunk);
    queueHead = 0;
    cellsDone = 0;
    cellsTotal = cellQueue.length;

    callbacks.onStatus?.("Starting…", "run");
    callbacks.onProgress?.(0);
    callbacks.onThreadInfo?.(`${numWorkers} threads`);

    // Paint worker
    paintWorker = new Worker(makeDataUrl(makePaintWorkerSource()));
    let paintPending = false;
    let lastPaintParams = null;

    paintWorker.onmessage = (e) => {
        paintPending = false;
        const { pixels, W, H } = e.data;
        const imageData = new ImageData(new Uint8ClampedArray(pixels), W, H);
        ctx.putImageData(imageData, 0, 0);
        if (lastPaintParams) {
            const p = lastPaintParams;
            lastPaintParams = null;
            triggerPaint(p);
        }
    };

    const defaultToneParams = {
        toneMap: params.toneMap || 'aces',
        toneStrength: params.toneStrength ?? 1,
        exposure: params.exposure ?? 1,
        bloomEnabled: params.bloomEnabled ?? false,
        bloomThreshold: params.bloomThreshold ?? 0.5,
        bloomIntensity: params.bloomIntensity ?? 0.5,
        bloomRadius: params.bloomRadius ?? 16,
        microEnabled: params.microEnabled ?? false,
        microStrength: params.microStrength ?? 0.3,
        microRadius: params.microRadius ?? 4,
        gamma: params.gamma ?? 1,
        contrast: params.contrast ?? 1,
        vignette: params.vignette ?? 0,
        invert: params.invert ?? false,
        blur: params.blur ?? 0,
        saturation: params.saturation ?? 100,
        lineColor: params.lineColor || [255, 255, 255],
        symH: params.symH || false,
        symV: params.symV || false,
        symOrder: params.symOrder || "none",
    };

    function triggerPaint(toneParams) {
        if (paintPending) { lastPaintParams = toneParams; return; }
        paintPending = true;
        const snapshot = accumulationBuffer.slice();
        paintWorker.postMessage(
            { src: snapshot, W: width, H: height, params: toneParams },
            [snapshot.buffer],
        );
    }

    const renderId = currentRenderId;
    let lastStats = 0;

    function frame(ts) {
        if (!running || renderId !== currentRenderId) return;
        rafHandle = requestAnimationFrame(frame);
        if (dirtyRect) { triggerPaint(defaultToneParams); dirtyRect = null; }
        if (ts - lastStats > 100) { lastStats = ts; updateStatsPanel(callbacks); }
    }
    rafHandle = requestAnimationFrame(frame);

    // Workers
    const workerSrc = makeWorkerSource(params.filterSource, params.tracerSource);
    const workerUrl = makeDataUrl(workerSrc);

    function dispatchNext(worker, id) {
        if (queueHead >= cellQueue.length) {
            workerStats[id] = { ...workerStats[id], status: "idle" };
            return;
        }
        const cell = cellQueue[queueHead++];
        workerStats[id] = { status: "active", hits: 0, elapsed: 0, totalSamples: 0, accepted: 0 };
        worker.postMessage({ type: "cell", cell });
    }

    for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker(workerUrl);

        worker.onerror = (err) => console.error(`[Worker ${i}] error:`, err);

        worker.onmessage = (e) => {
            if (!running || renderId !== currentRenderId) { worker.terminate(); return; }
            const msg = e.data;
            if (msg.type !== "done") return;

            if (!useSAB && msg.indices) {
                for (let k = 0; k < msg.indices.length; k++) {
                    accumulationBuffer[msg.indices[k]] += msg.values[k];
                }
            }

            const prev = workerStats[i];
            const stats = msg.stats || {};
            workerStats[i] = {
                status: "done",
                hits: (prev?.hits || 0) + (msg.hits || 0),
                elapsed: (prev?.elapsed || 0) + (msg.elapsed || 1),
                totalSamples: (prev?.totalSamples || 0) + (stats.totalSamples || 0),
                accepted: (prev?.accepted || 0) + (stats.accepted || 0),
            };

            cellsDone++;
            expandDirty(msg.cell, cam);

            if (cellsDone === cellsTotal) {
                running = false;
                cancelAnimationFrame(rafHandle);
                rafHandle = null;
                triggerPaint(defaultToneParams);
                updateStatsPanel(callbacks);
                callbacks.onProgress?.(1);
                callbacks.onPaint?.();
            } else {
                dispatchNext(worker, i);
            }
        };

        const initMsg = {
            type: "init", cam, baseStep, useSAB,
            coarseScale: adaptiveCoarseScale,
            hitDensityThreshold: adaptiveHitThreshold,
            varianceThreshold: params.adaptiveVarianceThreshold ?? _adaptive.varianceThreshold,
            passMultiplier: adaptivePassMult,
        };
        if (useSAB) initMsg.sab = sab;
        worker.postMessage(initMsg, useSAB ? [] : []);

        dispatchNext(worker, i);
        workerPool.push({ worker, id: i });
    }
}

// ─── applyPaint — synchronous repaint ─────────────────────────────────────────

export function applyPaint(params) {
    if (!accumulationBuffer || !ctx) return;

    let src = params.blur > 0
        ? gaussianBlur(accumulationBuffer, width, height, params.blur)
        : accumulationBuffer;

    src = applySymmetry(src, width, height, params.symH, params.symV, params.symOrder);

    let maxVal = 0;
    for (let i = 0; i < src.length; i++) if (src[i] > maxVal) maxVal = src[i];

    const exposure = params.exposure ?? 1;
    const depthBoost = params.depthBoost ?? 1;
    const toneMap = params.toneMap || 'aces';
    const toneStrength = params.toneStrength ?? 1;
    const toneFn = getToneFn(toneMap);

    const hdr = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        let t = maxVal > 0 ? Math.sqrt(src[i] / (maxVal + 1)) : 0;
        if (depthBoost !== 1.0) t = Math.min(1, t * depthBoost);
        hdr[i] = t;
    }

    if (exposure !== 1.0) {
        for (let i = 0; i < hdr.length; i++) hdr[i] *= exposure;
    }

    const toneMapped = new Float32Array(hdr.length);
    for (let i = 0; i < hdr.length; i++) {
        toneMapped[i] = toneStrength < 1.0
            ? hdr[i] * (1 - toneStrength) + toneFn(hdr[i]) * toneStrength
            : toneFn(hdr[i]);
    }

    const afterBloom = params.bloomEnabled
        ? applyBloom(toneMapped, width, height, { enabled: true, threshold: params.bloomThreshold, intensity: params.bloomIntensity, radius: params.bloomRadius })
        : toneMapped;

    const afterMicro = params.microEnabled
        ? applyMicrocontrast(afterBloom, width, height, { enabled: true, strength: params.microStrength, radius: params.microRadius })
        : afterBloom;

    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;
    const lc0 = params.lineColor?.[0] ?? 255;
    const lc1 = params.lineColor?.[1] ?? 255;
    const lc2 = params.lineColor?.[2] ?? 255;
    const contrast = params.contrast ?? 1;
    const gamma = params.gamma ?? 1;
    const saturation = params.saturation ?? 100;
    const vignette = params.vignette ?? 0;
    const invert = params.invert ?? false;

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const idx = py * width + px;
            const pidx = idx * 4;
            const t = Math.max(0, Math.min(1, afterMicro[idx]));
            const [r, g, b] = applyColor(t, lc0 * t, lc1 * t, lc2 * t, contrast, gamma, saturation, vignette, invert, px, py, width, height);
            pixels[pidx] = Math.max(0, Math.min(255, r + 0.5));
            pixels[pidx + 1] = Math.max(0, Math.min(255, g + 0.5));
            pixels[pidx + 2] = Math.max(0, Math.min(255, b + 0.5));
            pixels[pidx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
}
