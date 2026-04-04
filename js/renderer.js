// Non-tiled progressive renderer with persistent worker pool + dynamic load balancing

import { gaussianBlur, rgbToHsl, hslToRgb } from './helpers.js';

// ====================== RENDERER STATE ======================

let canvas, ctx;
let width = 1920, height = 1080;
let accumulationBuffer = null;
let sampleCountBuffer = null;
let running = false;
let startTime = 0;
let workerPool = [];
let pendingTasks = [];
let activeWorkers = new Set();
let currentRenderId = 0;
let completedPixels = 0;
let totalPixels = 0;
let numWorkers = 0;

// Camera precomputed values
let camera = null;

// ====================== GENERIC WORKER SCRIPT ======================

const GENERIC_WORKER_SCRIPT = `
"use strict";

let filterFunc = null;
let tracerFunc = null;

self.onmessage = function(e) {
    const d = e.data;
    
    if (d.cmd === 'setFuncs') {
        try {
            filterFunc = new Function(d.filterSource + "\\nreturn filterFunc;")();
            tracerFunc = new Function(d.tracerSource + "\\nreturn tracerFunc;")();
            console.log('Worker funcs ready');
            self.postMessage({ cmd: 'funcsReady' });
        } catch (err) {
            console.error('Worker func error:', err);
            self.postMessage({ cmd: 'error', message: err.message });
        }
        return;
    }
    
    if (d.cmd === 'stop') {
        return;
    }
    
    if (d.cmd === 'render') {
        const { taskId, startRow, endRow, params, hw, camPx, camPy } = d;
        
        console.log('Worker render:', taskId, 'rows:', startRow, '-', endRow, 'hw:', hw, 'cam:', camPx, camPy);
        
        const buf = new Uint32Array(params.width * (endRow - startRow));
        let hitCount = 0;
        
        for (let y = startRow; y < endRow; y++) {
            for (let x = 0; x < params.width; x++) {
                const cx = camPx + (x - params.width / 2) / hw;
                const cy = camPy - (y - params.height / 2) / hw;
                
                let ok = false;
                try { ok = filterFunc(cx, cy, params.it); } catch (err) {}
                if (!ok) continue;
                
                try {
                    tracerFunc(cx, cy, params.it, function(fx, fy) {
                        const px = Math.round((fx - camPx) * hw + params.width / 2);
                        const py = Math.round((camPy - fy) * hw + params.height / 2);
                        
                        const localY = py - startRow;
                        if (px >= 0 && px < params.width && localY >= 0 && localY < (endRow - startRow)) {
                            buf[px + localY * params.width]++;
                            hitCount++;
                        }
                    });
                } catch (err) {}
            }
        }
        
        console.log('Worker done:', taskId, 'hits:', hitCount, 'bufSum:', buf.reduce((a,b)=>a+b,0));
        
        self.postMessage({ 
            cmd: 'result', 
            taskId, 
            renderId: params.renderId,
            startRow, 
            endRow,
            width: params.width,
            buf,
            hitCount
        }, [buf.buffer]);
    }
};
`;

// ====================== WORKER POOL (PERSISTENT) ======================

function createPersistentWorkerPool() {
    numWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
    workerPool = [];
    
    const blob = new Blob([GENERIC_WORKER_SCRIPT], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    
    for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker(url);
        worker.onerror = (err) => console.error('Worker error:', err);
        workerPool.push({ worker, id: i, ready: false });
    }
    
    URL.revokeObjectURL(url);
}

function updateWorkerFuncs(filterSource, tracerSource, callbacks) {
    workerPool.forEach(({ worker }) => {
        worker.postMessage({
            cmd: 'setFuncs',
            filterSource,
            tracerSource
        });
    });
}

// ====================== RENDERER API ======================

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d", { alpha: false });
    
    createPersistentWorkerPool();
    console.log(`[Renderer] Persistent worker pool ready (${numWorkers} threads)`);
    
    accumulationBuffer = new Uint32Array(width * height);
    sampleCountBuffer = new Uint32Array(width * height);
}

export function getCanvas() { return canvas; }
export function getCtx() { return ctx; }
export function getWidth() { return width; }
export function getHeight() { return height; }
export function getGrid() { return accumulationBuffer; }
export function getSampleCountBuffer() { return sampleCountBuffer; }
export function isRunning() { return running; }

export function setDimensions(w, h) {
    width = w;
    height = h;
    accumulationBuffer = new Uint32Array(width * height);
    sampleCountBuffer = new Uint32Array(width * height);
    if (ctx) {
        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
    }
}

export function clearGrid() {
    accumulationBuffer = new Uint32Array(width * height);
    sampleCountBuffer = new Uint32Array(width * height);
}

export function stopRender() {
    running = false;
    currentRenderId++;
    
    workerPool.forEach(({ worker }) => {
        try { worker.postMessage({ cmd: 'stop' }); } catch (e) {}
    });
    
    activeWorkers.clear();
    pendingTasks = [];
}

// ====================== TASK SETUP ======================

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function setupTasks() {
    // Dynamic row chunks - scales with resolution
    const rowsPerTask = Math.max(32, Math.floor(height / (numWorkers * 8)));
    totalPixels = width * height;
    pendingTasks = [];
    
    for (let y = 0; y < height; y += rowsPerTask) {
        pendingTasks.push({
            taskId: pendingTasks.length,
            startRow: y,
            endRow: Math.min(y + rowsPerTask, height)
        });
    }
    
    // Shuffle for better load balancing
    shuffle(pendingTasks);
}

function assignTask(worker, task, renderId) {
    activeWorkers.add(worker);
    worker.postMessage({
        cmd: 'render',
        taskId: task.taskId,
        startRow: task.startRow,
        endRow: task.endRow,
        hw: camera.hw,
        camPx: camera.camPx,
        camPy: camera.camPy,
        params: camera.params
    });
}

// ====================== MAIN RENDER ======================

export function startRender(params, callbacks = {}) {
    stopRender();
    currentRenderId++;
    const thisRenderId = currentRenderId;
    
    width = params.width;
    height = params.height;
    accumulationBuffer = new Uint32Array(width * height);
    sampleCountBuffer = new Uint32Array(width * height);
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    running = true;
    startTime = Date.now();
    completedPixels = 0;
    
    if (callbacks.onStatus) callbacks.onStatus("Starting…", "run");
    if (callbacks.onProgress) callbacks.onProgress(0);
    if (callbacks.onThreadInfo) callbacks.onThreadInfo(`${numWorkers} threads`);
    
    const statsEl = document.getElementById('render-stats');
    if (statsEl) statsEl.style.display = 'inline';

    // Precompute camera values
    const hw = (params.z || 1) * width / 2;
    camera = {
        hw,
        camPx: params.px,
        camPy: params.py_,
        params: {
            renderId: thisRenderId,
            width,
            height,
            it: params.it
        }
    };

    // Setup tasks
    setupTasks();
    
    // Setup handlers and send funcs
    let funcsReady = 0;
    workerPool.forEach(({ worker }) => {
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.cmd === 'funcsReady') {
                funcsReady++;
                if (funcsReady === workerPool.length) {
                    // All funcs ready, start rendering
                    startWorkersRendering(callbacks, thisRenderId);
                }
                return;
            }
            handleWorkerMessage(e, callbacks, thisRenderId);
        };
        worker.postMessage({
            cmd: 'setFuncs',
            filterSource: params.filterSource,
            tracerSource: params.tracerSource
        });
    });
}

function startWorkersRendering(callbacks, renderId) {
    workerPool.forEach(({ worker }) => {
        const task = pendingTasks.shift();
        if (task) assignTask(worker, task, renderId);
    });
}

function handleWorkerMessage(e, callbacks, renderId) {
    if (!running) return;
    
    const msg = e.data;
    const worker = e.target;
    
    if (msg.cmd === 'funcsReady') return;
    
    if (msg.cmd === 'error') {
        if (callbacks.onStatus) callbacks.onStatus("Worker error: " + msg.message, "");
        return;
    }
    
    if (msg.cmd === 'result') {
        if (msg.renderId !== renderId) return;
        
        const { startRow, endRow, buf, width: w, hitCount } = msg;
        const numRows = endRow - startRow;
        
        console.log('Merge result:', startRow, '-', endRow, 'hits:', hitCount, 'bufSum:', buf.reduce((a,b)=>a+b,0));
        
        // Merge into accumulation buffer
        for (let localY = 0; localY < numRows; localY++) {
            const globalY = startRow + localY;
            const rowOffset = globalY * w;
            const bufRowOffset = localY * w;
            for (let x = 0; x < w; x++) {
                accumulationBuffer[rowOffset + x] += buf[bufRowOffset + x];
                sampleCountBuffer[rowOffset + x]++;
            }
        }
        
        completedPixels += numRows * w;
        
        if (callbacks.onProgress) callbacks.onProgress(completedPixels / totalPixels);
        if (callbacks.onStatus) callbacks.onStatus(`${Math.round(completedPixels / totalPixels * 100)}%`, "run");
        if (callbacks.onPaint) callbacks.onPaint();
        
        // Update stats display
        const statsEl = document.getElementById('render-stats');
        if (statsEl) {
            const totalHits = accumulationBuffer.reduce((a,b)=>a+b,0);
            statsEl.textContent = `Hits: ${totalHits.toLocaleString()} | Tasks: ${pendingTasks.length + activeWorkers.size}/${totalPixels / (w * numRows)}`;
        }
        
        // Worker pulls next task
        const nextTask = pendingTasks.shift();
        if (nextTask && running) {
            assignTask(worker, nextTask, renderId);
        } else {
            activeWorkers.delete(worker);
            if (activeWorkers.size === 0) {
                console.log('Render complete. Total hits:', accumulationBuffer.reduce((a,b)=>a+b,0));
                finishRender(callbacks);
            }
        }
    }
}

// ====================== FINISH ======================

function finishRender(callbacks) {
    running = false;
    if (callbacks.onProgress) callbacks.onProgress(1);
    if (callbacks.onStatus) callbacks.onStatus(`Done — ${((Date.now() - startTime) / 1000).toFixed(1)}s`, "");
    if (callbacks.onPaint) callbacks.onPaint();
    
    const statsEl = document.getElementById('render-stats');
    if (statsEl) statsEl.style.display = 'none';
}

// ====================== PAINTING ======================

export function applyPaint(params) {
    if (!accumulationBuffer || !ctx) return;
    
    let src = accumulationBuffer;
    
    if (params.blur > 0) src = gaussianBlur(src, width, height, params.blur);
    
    if (params.symH || params.symV) {
        const sym = new Float32Array(src.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const val = src[y * width + x];
                const mx = params.symH ? width - 1 - x : x;
                const my = params.symV ? height - 1 - y : y;
                sym[y * width + x] = Math.max(val, src[my * width + mx]);
            }
        }
        src = sym;
    }
    
    let max = 0;
    for (let i = 0; i < src.length; i++) if (src[i] > max) max = src[i];
    
    console.log('Paint:', width, 'x', height, 'max:', max, 'sum:', src.reduce((a,b)=>a+b,0));

    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    for (let i = 0; i < width * height; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        let t = max > 0 ? Math.sqrt(src[y * width + x] / (max + 1)) : 0;
        t = Math.pow(Math.min(1, t), params.gamma);
        t = (t - 0.5) * params.contrast + 0.5;
        t = t * params.exposure;
        t = Math.min(1, Math.max(0, t));

        let r = params.lineColor[0] * t;
        let g = params.lineColor[1] * t;
        let b = params.lineColor[2] * t;

        if (params.hue !== 0) {
            const hsl = rgbToHsl(r, g, b);
            hsl[0] = (hsl[0] + params.hue + 360) % 360;
            const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
            [r, g, b] = rgb;
        }
        
        if (params.vignette > 0) {
            const vx = (x / (width - 1)) * 2 - 1;
            const vy = (y / (height - 1)) * 2 - 1;
            const vm = 1 - Math.pow(vx * vx + vy * vy, 1) * params.vignette;
            r *= vm; g *= vm; b *= vm;
        }
        
        if (params.invert) {
            r = 255 - r; g = 255 - g; b = 255 - b;
        }
        
        pixels[i * 4] = Math.max(0, Math.min(255, Math.round(r)));
        pixels[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
        pixels[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
        pixels[i * 4 + 3] = 255;
    }
    
    ctx.putImageData(imageData, 0, 0);
}
