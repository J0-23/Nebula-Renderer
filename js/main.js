// ====================== CONTROLLER ======================

import { initRenderer, startRender, stopRender, setDimensions, clearGrid, applyPaint, getCanvas, getCtx } from './renderer.js';
import { hslToRgb, makeFractalCode } from './helpers.js';
import { PRESETS, QUALITY_PRESETS } from './presets.js';

// ====================== STATE ======================

let currentPreset = "galaxy";
let filterSource = "", tracerSource = "";
let customPresets = {};

let lineHSL = [43, 100, 65];

let repaintTimer = null;

// Pan/zoom state
let viewScale = 1, viewX = 0, viewY = 0, isPanning = false;
let panStartX, panStartY, panViewX, panViewY;

const canvasArea = document.getElementById("cv-area");
let canvas;
let ctx;

// ====================== INIT ======================

function init() {
    const canvasEl = document.getElementById("c");
    initRenderer(canvasEl);
    canvas = canvasEl;
    ctx = getCtx();
    selectPreset("galaxy");
    setTimeout(updateFractalBuilder, 150);
}

export { canvas, ctx };

// ====================== UI HELPERS ======================

function lazyRepaint() {
    if (repaintTimer) clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => {
        if (canvas) triggerPaint();
    }, 16);
}

function setPillActive(btn) {
    btn.closest(".pills").querySelectorAll(".pl").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
}

function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}

// ====================== SETTINGS ======================

function setQuality(quality, btn) {
    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;
    document.getElementById("iters").value = preset.iterations;
    document.getElementById("samples").value = preset.samples;
    setPillActive(btn);
}

function setResolution(w, h, btn) {
    document.getElementById("iw").value = w;
    document.getElementById("ih").value = h;
    setPillActive(btn);
}



// ====================== PRESETS ======================

function buildPresetList() {
    const el = document.getElementById("pc-list");
    if (!el) return;
    const all = { ...PRESETS, ...customPresets };
    el.innerHTML = Object.keys(all).map(key => {
        const p = all[key];
        return `<div class="pc${currentPreset === key ? " on" : ""}" onclick="selectPreset('${key}')">
            <div class="pc-name">${p.name}</div>
            <div class="pc-desc">${p.desc}</div>
            ${customPresets[key] ? `<button class="btn dng" style="margin-top:4px;font-size:var(--fs0);height:20px;padding:0 6px" onclick="event.stopPropagation();deleteCustomPreset('${key}')">delete</button>` : ""}
        </div>`;
    }).join("");
}

function selectPreset(key) {
    currentPreset = key;
    const all = { ...PRESETS, ...customPresets };
    const p = all[key];
    if (!p) return;
    filterSource = p.f || p.filter || "";
    tracerSource = p.t || p.tracer || "";
    document.getElementById("filterCode").value = filterSource;
    document.getElementById("tracerCode").value = tracerSource;
    buildPresetList();
}

function deleteCustomPreset(key) {
    delete customPresets[key];
    if (currentPreset === key) selectPreset("galaxy");
    else buildPresetList();
}

function showSaveRow() {
    document.getElementById("save-row").style.display = "flex";
}

function confirmSave() {
    const name = document.getElementById("pname").value.trim();
    if (!name) return;
    const key = "c_" + Date.now();
    customPresets[key] = {
        name,
        desc: "Custom",
        f: document.getElementById("filterCode").value.trim() || filterSource,
        t: document.getElementById("tracerCode").value.trim() || tracerSource
    };
    document.getElementById("save-row").style.display = "none";
    document.getElementById("pname").value = "";
    buildPresetList();
    showToast(`Saved "${name}"`);
}

function validateFunctions() {
    const filterCode = document.getElementById("filterCode");
    const tracerCode = document.getElementById("tracerCode");
    const ferr = document.getElementById("ferr");
    const terr = document.getElementById("terr");
    if (ferr) ferr.textContent = "";
    if (terr) terr.textContent = "";
    
    const fs = filterCode ? filterCode.value.trim() : filterSource;
    const ts = tracerCode ? tracerCode.value.trim() : tracerSource;
    let valid = true;
    
    try { new Function(fs + "\nreturn filterFunc;")(); }
    catch (e) { if (ferr) ferr.textContent = "Filter: " + e.message; valid = false; }
    
    try { new Function(ts + "\nreturn tracerFunc;")(); }
    catch (e) { if (terr) terr.textContent = "Tracer: " + e.message; valid = false; }
    
    if (valid) {
        filterSource = fs;
        tracerSource = ts;
        const debugVal = document.getElementById("dbg-val");
        if (debugVal) debugVal.textContent = "✓ Functions valid";
        showToast("✓ Functions valid");
    }
    return valid;
}

// ====================== COLOR ======================

let wheelDragging = false;

function initColorWheel() {
    const el = document.getElementById("lwheel");
    if (!el || el._init) return;
    el._init = true;
    
    el.addEventListener("mousedown", e => { wheelDragging = true; pickWheelColor(e, el); });
    window.addEventListener("mousemove", e => { if (wheelDragging) pickWheelColor(e, el); });
    window.addEventListener("mouseup", () => { wheelDragging = false; });
    
    drawColorWheel(el);
    updateColorPreview();
}

function drawColorWheel(el) {
    if (!el) return;
    const ctx = el.getContext("2d");
    const size = el.width;
    const cx = size / 2, cy = size / 2, r = cx - 2;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const dx = px - cx, dy = py - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > r) continue;
            const color = hslToRgb(
                ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * 360,
                (dist / r) * 100,
                lineHSL[2]
            );
            const i = (py * size + px) * 4;
            data[i] = color[0];
            data[i + 1] = color[1];
            data[i + 2] = color[2];
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    
    const angle = (lineHSL[0] / 360) * Math.PI * 2;
    const sat = (lineHSL[1] / 100) * r;
    const sx = cx + Math.cos(angle) * sat;
    const sy = cy + Math.sin(angle) * sat;
    
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.fill();
}

function pickWheelColor(e, el) {
    const rect = el.getBoundingClientRect();
    const sx = el.width / rect.width;
    const sy = el.height / rect.height;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    const cx = el.width / 2, r = cx - 2;
    const dx = px - cx, dy = py - cy;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r + 4) return;
    dist = Math.min(dist, r);
    lineHSL[0] = Math.round(((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * 360);
    lineHSL[1] = Math.round((dist / r) * 100);
    syncLineHSL();
    drawColorWheel(el);
    lazyRepaint();
}

function syncLineHSL() {
    lineHSL = [
        +document.getElementById("lH").value,
        +document.getElementById("lS").value,
        +document.getElementById("lL").value
    ];
    updateColorPreview();
    drawColorWheel(document.getElementById("lwheel"));
    lazyRepaint();
}

function updateColorPreview() {
    const lineColor = hslToRgb(lineHSL[0], lineHSL[1], lineHSL[2]);
    ["H", "S", "L"].forEach((c, i) => {
        const input = document.getElementById("l" + c);
        const display = document.getElementById("l" + c + "v");
        if (input) input.value = lineHSL[i];
        if (display) display.textContent = lineHSL[i] + (c === "H" ? "°" : "%");
    });
    const preview = document.getElementById("lcprev");
    if (preview) preview.style.background = `rgb(${lineColor})`;
}

// ====================== FRACTAL BUILDER ======================

function updateFractalBuilder() {
    const code = makeFractalCode(
        +document.getElementById("fb-t").value,
        parseFloat(document.getElementById("fb-p").value),
        parseFloat(document.getElementById("fb-e").value),
        +document.getElementById("fb-r").value,
        +document.getElementById("fb-s").value,
        document.getElementById("fb-ar").checked,
        document.getElementById("fb-ai").checked,
        document.getElementById("fb-uc").checked,
        +(document.getElementById("fb-cx") || { value: 0 }).value,
        +(document.getElementById("fb-cy") || { value: 0.5 }).value
    );
    filterSource = code.f;
    tracerSource = code.t;
    const preview = document.getElementById("fb-prev");
    if (preview) preview.textContent = code.f.split("\n").slice(0, 4).join("\n") + "…";
}

function applyFractalBuilder() {
    updateFractalBuilder();
    document.getElementById("filterCode").value = filterSource;
    document.getElementById("tracerCode").value = tracerSource;
    currentPreset = "custom";
    handleStartRender();
}

function randomFractal() {
    document.getElementById("fb-t").value = Math.floor(Math.random() * 6);
    const p = (Math.random() * 5 + 1.5).toFixed(1);
    document.getElementById("fb-p").value = p;
    document.getElementById("fbpv").textContent = p;
    const e = (Math.random() * 15 + 3).toFixed(1);
    document.getElementById("fb-e").value = e;
    document.getElementById("fbev").textContent = e;
    const r = Math.floor(Math.random() * 360);
    document.getElementById("fb-r").value = r;
    document.getElementById("fbrv").textContent = r;
    const s = Math.floor(Math.random() * 4);
    document.getElementById("fb-s").value = s;
    document.getElementById("fbsv").textContent = s;
    document.getElementById("fb-ar").checked = Math.random() > 0.7;
    document.getElementById("fb-ai").checked = Math.random() > 0.7;
    const uc = Math.random() > 0.5;
    document.getElementById("fb-uc").checked = uc;
    document.getElementById("fb-cr").style.display = uc ? "flex" : "none";
    const cx = document.getElementById("fb-cx");
    const cy = document.getElementById("fb-cy");
    if (cx) cx.value = (Math.random() * 2 - 1).toFixed(3);
    if (cy) cy.value = (Math.random() * 2 - 1).toFixed(3);
    updateFractalBuilder();
    showToast("Random formula ready — click Apply & Render");
}

// ====================== DEBUGGER ======================

function runDebug(trace) {
    const out = document.getElementById("dbg-output");
    const cx = parseFloat(document.getElementById("dbg-cx").value);
    const cy = parseFloat(document.getElementById("dbg-cy").value);
    const steps = parseInt(document.getElementById("dbg-steps").value) || 20;
    const fs = getFilterSource(), ts = getTracerSource();
    const lines = [];
    
    try {
        const ff = new Function(fs + "\nreturn filterFunc;")();
        const tf = new Function(ts + "\nreturn tracerFunc;")();
        lines.push(`▶ Starting at (${cx.toFixed(4)}, ${cy.toFixed(4)})`);
        
        if (!trace) {
            const result = ff(cx, cy, steps);
            lines.push(`filter(${cx.toFixed(4)},${cy.toFixed(4)},${steps}) = ${result}`);
        } else {
            const pts = [];
            tf(cx, cy, steps, (x, y) => pts.push([x, y]));
            lines.push(`${pts.length} path points:`);
            pts.slice(0, 30).forEach((p, i) => {
                lines.push(`  [${i}] (${p[0].toFixed(4)}, ${p[1].toFixed(4)})${isNaN(p[0]) || isNaN(p[1]) ? " ← NaN!" : ""}`);
            });
            if (pts.length > 30) lines.push(`  … ${pts.length - 30} more`);
        }
    } catch (e) {
        lines.push(`Error: ${e.message}`);
    }
    out.innerHTML = lines.join("\n");
}

function clearDebug() {
    const out = document.getElementById("dbg-output");
    if (out) out.textContent = "Cleared.";
}

// ====================== PAN/ZOOM ======================

function applyTransform() {
    canvas.style.transform = `translate(${viewX}px,${viewY}px) scale(${viewScale})`;
    document.getElementById("zbadge").textContent = Math.round(viewScale * 100) + "%";
}

canvasArea.addEventListener("wheel", e => {
    e.preventDefault();
    viewScale = Math.max(0.1, Math.min(40, viewScale * (e.deltaY > 0 ? 0.85 : 1.18)));
    applyTransform();
}, { passive: false });

canvasArea.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panViewX = viewX; panViewY = viewY;
    canvas.style.cursor = "grabbing";
});

window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    viewX = panViewX + (e.clientX - panStartX);
    viewY = panViewY + (e.clientY - panStartY);
    applyTransform();
});

window.addEventListener("mouseup", () => {
    isPanning = false;
    canvas.style.cursor = "crosshair";
});

function resetView() {
    viewScale = 1; viewX = 0; viewY = 0;
    applyTransform();
}

// ====================== RENDER ======================

function getFilterSource() {
    const el = document.getElementById("filterCode");
    return (el && el.value.trim()) || filterSource || PRESETS.galaxy.f;
}

function getTracerSource() {
    const el = document.getElementById("tracerCode");
    return (el && el.value.trim()) || tracerSource || PRESETS.galaxy.t;
}

function setStatus(msg, cls) {
    const s = document.getElementById("bar-status");
    if (s) { s.textContent = msg; s.className = cls; }
}

function setProgress(v) {
    const p = document.getElementById("prog");
    if (p) p.style.width = Math.round(v * 100) + "%";
}

function triggerPaint() {
    const params = {
        gamma: parseFloat(document.getElementById("gamma").value) || 1,
        blur: +document.getElementById("blur").value || 0,
        symH: document.getElementById("symH").checked,
        symV: document.getElementById("symV").checked,
        invert: document.getElementById("invert").checked,
        contrast: parseFloat(document.getElementById("contrast").value) || 1,
        exposure: parseFloat(document.getElementById("exposure").value) || 1,
        hue: +document.getElementById("hue").value || 0,
        vignette: +document.getElementById("vignette").value || 0,
        lineColor: hslToRgb(lineHSL[0], lineHSL[1], lineHSL[2])
    };
    applyPaint(params);
}

function clearAll() {
    stopRender();
    clearGrid();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width || 800, canvas.height || 600);
    setStatus("Cleared", "");
    setProgress(0);
    document.getElementById("thr-info").textContent = "";
}

function saveImage() {
    const a = document.createElement("a");
    a.download = `fractal-${Date.now()}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
}

function handleStartRender() {
    stopRender();
    
    const width = parseInt(document.getElementById("iw").value) || 1920;
    const height = parseInt(document.getElementById("ih").value) || 1080;
    const posX = parseFloat(document.getElementById("cx").value) || 0;
    const posY = parseFloat(document.getElementById("cy").value) || 0;
    const zoom = parseFloat(document.getElementById("zoom").value) || 0.8;
    const iterations = parseInt(document.getElementById("iters").value) || 500;
    const samples = parseInt(document.getElementById("samples").value) || 500000;
    const minX = -2.25, maxX = 2.25, minY = -2.25, maxY = 2.25;
    const step = Math.sqrt(((maxX - minX) * (maxY - minY)) / samples);
    
    const params = {
        width, height,
        filterSource: getFilterSource(),
        tracerSource: getTracerSource(),
        px: posX, py_: posY, z: zoom,
        it: iterations, baseSamples: samples,
        minX, maxX, minY, maxY, step,
        gamma: parseFloat(document.getElementById("gamma").value) || 1,
        blur: +document.getElementById("blur").value || 0,
        symH: document.getElementById("symH").checked,
        symV: document.getElementById("symV").checked,
        invert: document.getElementById("invert").checked,
        contrast: parseFloat(document.getElementById("contrast").value) || 1,
        exposure: parseFloat(document.getElementById("exposure").value) || 1,
        hue: +document.getElementById("hue").value || 0,
        vignette: +document.getElementById("vignette").value || 0,
        lineColor: hslToRgb(lineHSL[0], lineHSL[1], lineHSL[2])
    };

    startRender(params, {
        onStatus: setStatus,
        onProgress: setProgress,
        onThreadInfo: (text) => {
            document.getElementById("thr-info").textContent = text;
        },
        onPaint: triggerPaint
    });
}

// ====================== TABS ======================

function switchTab(pane, el) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("on"));
    document.querySelectorAll(".pane").forEach(p => p.classList.remove("on"));
    el.classList.add("on");
    const target = document.getElementById("p-" + pane);
    if (target) target.classList.add("on");
    if (pane === "color") setTimeout(initColorWheel, 50);
    if (pane === "fractal") buildPresetList();
}

function resizeCanvas() {
    if (!canvas || !canvasArea) return;
    const rect = canvasArea.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    triggerPaint();
}

// ====================== WINDOW ======================

window.addEventListener("resize", resizeCanvas);
window.onload = () => { init(); resizeCanvas(); };

// ====================== EXPORTS ======================

export { init, lazyRepaint, setQuality, setResolution, selectPreset, deleteCustomPreset, showSaveRow, confirmSave, validateFunctions, syncLineHSL, updateFractalBuilder, applyFractalBuilder, randomFractal, runDebug, clearDebug, resetView, triggerPaint, clearAll, saveImage, switchTab, setStatus, setProgress, handleStartRender as startRender, stopRender };
