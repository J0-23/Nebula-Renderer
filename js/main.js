
// ─── Imports ──────────────────────────────────────────────────────────────────

import { initRenderer, startRender, stopRender, clearGrid, applyPaint, getCtx } from "./renderer.js";
import { hslToRgb, makeFractalCode } from "./helpers.js";
import { PRESETS, QUALITY_PRESETS } from "./presets.js";
import { getAdaptiveParams, onAdaptiveChange, atVarPreset, atChunkPreset, resetAdaptive } from "./adaptive-tuning.js";

export { onAdaptiveChange, atVarPreset, atChunkPreset, resetAdaptive };

// ─── State ───────────────────────────────────────────────────────────────────

let currentPreset = "galaxy";
let filterSource = "";
let tracerSource = "";
let customPresets = {};
let lineHSL = [33, 100, 60];
let repaintTimer = null;
let uiMode = "basic";

let viewScale = 1;
let viewX = 0;
let viewY = 0;
let isPanning = false;
let panStartX, panStartY, panViewX, panViewY;
let activePanel = null;
let dragOffset = { x: 0, y: 0 };

const canvasArea = document.getElementById("cv-area");
let canvas;
let ctx;

const panelState = {
    stats: { visible: true, minimized: false },
    quick: { visible: true, minimized: false },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
    const canvasEl = document.getElementById("c");
    initRenderer(canvasEl);
    canvas = canvasEl;
    ctx = getCtx();
    customPresets = JSON.parse(localStorage.getItem("fractalCustomPresets") || "{}");
    selectPreset("galaxy");
    setQuality("med", null);
    initPanels();
    initUIMode();
}

export { canvas, ctx };

// ─── Thread control ────────────────────────────────────────────────────────────

window.updateThreads = function (value) {
    const limit = parseInt(value);
    window.threadLimit = limit;
    document.getElementById("threads-value").textContent = limit === 0 ? "auto" : limit;
    const autoCheckbox = document.getElementById("threads-auto");
    if (autoCheckbox) autoCheckbox.checked = limit === 0;
};

// ─── Section toggle ───────────────────────────────────────────────────────────

function toggleAdvanced(sectionId) {
    const body = document.getElementById(sectionId + "-body");
    const icon = document.getElementById(sectionId + "-icon");
    if (!body) return;

    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "";
    if (icon) icon.style.transform = isOpen ? "" : "rotate(180deg)";
}

function toggleSection(slElement) {
    const sec = slElement.closest(".sec");
    if (!sec) return;
    const content = sec.querySelector(".sec-content");
    if (!content) return;

    const isCollapsed = slElement.classList.contains("collapsed");
    slElement.classList.toggle("collapsed", !isCollapsed);
    content.style.display = isCollapsed ? "" : "none";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lazyRepaint() {
    if (repaintTimer) clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => {
        if (canvas) triggerPaint();
    }, 16);
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

function setPillActive(btn) {
    btn.closest(".pills").querySelectorAll(".pl").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
}

function setSymmetry(mode, btn) {
    const symH = document.getElementById("symH");
    const symV = document.getElementById("symV");
    const symOrder = document.getElementById("symOrder");

    document.querySelectorAll(".sym-btn, .qm-sym").forEach((b) => b.classList.remove("on"));
    if (btn) btn.classList.add("on");

    const setSym = (h, v, order) => {
        symH.value = h;
        symV.value = v;
        symOrder.value = order;
    };

    switch (mode) {
        case "none":  setSym("false", "false", "none"); break;
        case "h":     setSym("true", "false", "h"); document.getElementById("qm-sym-h")?.classList.add("on"); break;
        case "v":     setSym("false", "true", "v"); document.getElementById("qm-sym-v")?.classList.add("on"); break;
        case "hv":    setSym("true", "true", "hv"); break;
        case "4way": setSym("true", "true", "4way"); document.getElementById("qm-sym-4way")?.classList.add("on"); break;
        case "alt4way": setSym("true", "true", "alt4way"); document.getElementById("qm-sym-alt4way")?.classList.add("on"); break;
    }
    lazyRepaint();
}

// ─── Quality & Resolution ─────────────────────────────────────────────────────

function setQuality(quality, btn) {
    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;

    document.getElementById("iters").value = preset.iterations;
    document.getElementById("samples").value = preset.samples;

    const ad = preset.adaptive;
    document.getElementById("at-enabled").checked = !!ad;

    if (ad) {
        document.getElementById("at-var").value = ad.variance;
        document.getElementById("at-var-v").textContent = ad.variance.toFixed(3);

        document.querySelectorAll(".at-scale").forEach((b) => b.classList.remove("on"));
        const idx = ad.variance <= 0.001 ? 0 : ad.variance <= 0.025 ? 1 : 2;
        document.querySelector(`.at-scale:nth-child(${idx + 1})`)?.classList.add("on");

        document.getElementById("at-agg").value = ad.passes;
        document.getElementById("at-agg-v").textContent = ad.passes + "×";
        document.getElementById("at-hit").value = ad.hitDensity;
        document.getElementById("at-hit-v").textContent = (ad.hitDensity * 100).toFixed(1) + "%";

        document.querySelectorAll("#at-chunk-pills .pl").forEach((b) => {
            const chunkVal = parseFloat(b.textContent);
            b.classList.toggle("on", Math.abs(chunkVal - ad.chunkSize) < 0.01);
        });
    }
    onAdaptiveChange();

    if (btn) {
        setPillActive(btn);
    }
}

function setResolution(w, h, btn) {
    document.getElementById("iw").value = w;
    document.getElementById("ih").value = h;
    setPillActive(btn);
}

// ─── Presets ─────────────────────────────────────────────────────────────────

function buildPresetList() {
    const el = document.getElementById("preset-select");
    if (!el) return;
    const all = { ...PRESETS, ...customPresets };
    el.innerHTML = '<option value="">-- Select Preset --</option>' +
        Object.keys(all).map((key) =>
            `<option value="${key}"${currentPreset === key ? " selected" : ""}>${all[key].name}</option>`
        ).join("");
}

function selectPreset(key) {
    if (!key) return;
    currentPreset = key;
    const p = { ...PRESETS, ...customPresets }[key];
    if (!p) return;

    filterSource = p.f || p.filter || "";
    tracerSource = p.t || p.tracer || "";

    const filterEl = document.getElementById("filterCode");
    const tracerEl = document.getElementById("tracerCode");
    if (filterEl) filterEl.value = filterSource;
    if (tracerEl) tracerEl.value = tracerSource;
    buildPresetList();
}

function deleteCustomPreset(key) {
    delete customPresets[key];
    localStorage.setItem("fractalCustomPresets", JSON.stringify(customPresets));
    if (currentPreset === key) selectPreset("galaxy");
    else buildPresetList();
}

function deleteCurrentPreset() {
    if (!currentPreset.startsWith("c_")) {
        showToast("Only custom presets can be deleted");
        return;
    }
    const name = customPresets[currentPreset]?.name || "Preset";
    if (!confirm(`Delete "${name}"?`)) return;
    deleteCustomPreset(currentPreset);
    showToast(`Deleted "${name}"`);
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
        t: document.getElementById("tracerCode").value.trim() || tracerSource,
    };
    localStorage.setItem("fractalCustomPresets", JSON.stringify(customPresets));
    document.getElementById("save-row").style.display = "none";
    document.getElementById("pname").value = "";
    buildPresetList();
    showToast(`Saved "${name}"`);
}

function validateFunctions() {
    const fs = (document.getElementById("filterCode")?.value.trim()) || filterSource;
    const ts = (document.getElementById("tracerCode")?.value.trim()) || tracerSource;

    const ferr = document.getElementById("ferr");
    const terr = document.getElementById("terr");
    if (ferr) ferr.textContent = "";
    if (terr) terr.textContent = "";

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

// ─── Color ────────────────────────────────────────────────────────────────────

function syncLineHSL() {
    lineHSL = [
        +document.getElementById("lH").value,
        +document.getElementById("lS").value,
        +document.getElementById("lL").value,
    ];
    updateColorPreview();
    lazyRepaint();
}

function updateColorSaturation(value) {
    const sat = parseInt(value);
    document.getElementById("color-sat-val").textContent = sat + "%";
    lazyRepaint();
}

function setToneMap(type, btn) {
    document.getElementById("toneMap").value = type;
    if (btn) setPillActive(btn);
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

// ─── Fractal Builder ─────────────────────────────────────────────────────────

function updateFractalBuilder() {
    const code = makeFractalCode(
        +document.getElementById("fb-t").value,
        parseFloat(document.getElementById("fb-p").value),
        parseFloat(document.getElementById("fb-e").value),
        +document.getElementById("fb-r").value,
        +document.getElementById("fb-s").value,
        false,
        document.getElementById("fb-ai")?.checked ?? false,
        false,
        +(document.getElementById("fb-cx")?.value ?? 0),
        +(document.getElementById("fb-cy")?.value ?? 0.5),
    );
    filterSource = code.f;
    tracerSource = code.t;
}

function applyFractalBuilder() {
    const filterEl = document.getElementById("filterCode");
    const tracerEl = document.getElementById("tracerCode");
    if (filterEl) filterEl.value = filterSource;
    if (tracerEl) tracerEl.value = tracerSource;
    handleStartRender();
}

function resetFractalBuilder() {
    const set = (id, val) => { document.getElementById(id).value = val; };
    set("fb-t", 0); set("fb-p", 2); set("fb-e", 10); set("fb-r", 0); set("fb-s", 0);
    set("fb-cx", 0); set("fb-cy", 0.5);
    document.getElementById("fbpv").textContent = "2.0";
    document.getElementById("fbev").textContent = "10.0";
    document.getElementById("fbrv").textContent = "0";
    document.getElementById("fbsv").textContent = "0";
    const fbAi = document.getElementById("fb-ai");
    if (fbAi) fbAi.checked = false;
    const fbCr = document.getElementById("fb-cr");
    if (fbCr) fbCr.style.display = "none";
    selectPreset("galaxy");
    showToast("Form reset to defaults");
}

function randomFractal() {
    const set = (id, val) => { document.getElementById(id).value = val; };
    set("fb-t", Math.floor(Math.random() * 6));
    const p = (Math.random() * 5 + 1.5).toFixed(1);
    set("fb-p", p); document.getElementById("fbpv").textContent = p;
    const e = (Math.random() * 15 + 3).toFixed(1);
    set("fb-e", e); document.getElementById("fbev").textContent = e;
    const r = Math.floor(Math.random() * 360);
    set("fb-r", r); document.getElementById("fbrv").textContent = r;
    const s = Math.floor(Math.random() * 4);
    set("fb-s", s); document.getElementById("fbsv").textContent = s;
    const juliaEnabled = Math.random() > 0.7;
    const fbAi = document.getElementById("fb-ai");
    if (fbAi) fbAi.checked = juliaEnabled;
    const fbCr = document.getElementById("fb-cr");
    if (fbCr) fbCr.style.display = juliaEnabled ? "flex" : "none";
    const cx = document.getElementById("fb-cx");
    const cy = document.getElementById("fb-cy");
    if (cx) cx.value = (Math.random() * 2 - 1).toFixed(3);
    if (cy) cy.value = (Math.random() * 2 - 1).toFixed(3);

    updateFractalBuilder();
    const filterEl = document.getElementById("filterCode");
    const tracerEl = document.getElementById("tracerCode");
    if (filterEl) filterEl.value = filterSource;
    if (tracerEl) tracerEl.value = tracerSource;
    showToast("Random formula ready — click Apply & Render");
}

// ─── Debugger ────────────────────────────────────────────────────────────────

function runDebug(trace) {
    const out = document.getElementById("dbg-output");
    const cx = parseFloat(document.getElementById("dbg-cx").value);
    const cy = parseFloat(document.getElementById("dbg-cy").value);
    const steps = parseInt(document.getElementById("dbg-steps").value) || 20;
    const lines = [];

    try {
        const ff = new Function(getFilterSource() + "\nreturn filterFunc;")();
        const tf = new Function(getTracerSource() + "\nreturn tracerFunc;")();
        lines.push(`▶ Starting at (${cx.toFixed(4)}, ${cy.toFixed(4)})`);

        if (!trace) {
            const t0 = performance.now();
            const result = ff(cx, cy, steps);
            document.getElementById("dbg-filter-time").textContent = (performance.now() - t0).toFixed(2) + "ms";
            lines.push(`filter(${cx.toFixed(4)},${cy.toFixed(4)},${steps}) = ${result}`);
        } else {
            const pts = [];
            const t0 = performance.now();
            tf(cx, cy, steps, (x, y) => pts.push([x, y]));
            document.getElementById("dbg-trace-time").textContent = (performance.now() - t0).toFixed(2) + "ms";
            document.getElementById("dbg-points").textContent = pts.length;
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
    document.getElementById("dbg-filter-time").textContent = "—";
    document.getElementById("dbg-trace-time").textContent = "—";
    document.getElementById("dbg-points").textContent = "—";
}

// ─── Pan/Zoom ─────────────────────────────────────────────────────────────────

function applyTransform() {
    canvas.style.transform = `translate(${viewX}px,${viewY}px) scale(${viewScale})`;
    document.getElementById("zbadge").textContent = Math.round(viewScale * 100) + "%";
}

canvasArea.addEventListener("wheel", (e) => {
    e.preventDefault();
    viewScale = Math.max(0.1, Math.min(40, viewScale * (e.deltaY > 0 ? 0.85 : 1.18)));
    applyTransform();
}, { passive: false });

canvasArea.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panViewX = viewX;
    panViewY = viewY;
    canvas.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (e) => {
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
    viewScale = 1;
    viewX = 0;
    viewY = 0;
    applyTransform();
}

// ─── Render ──────────────────────────────────────────────────────────────────

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

function readPaintParams() {
    const id = (name) => document.getElementById(name);
    const val = (name, fallback = 0) => parseFloat(id(name)?.value) || fallback;
    const check = (name) => id(name)?.checked ?? false;

    return {
        toneMap: id("toneMap")?.value || "aces",
        toneStrength: val("toneStrength", 1),
        exposure: val("exposure", 1),
        bloomEnabled: check("bloomEnabled"),
        bloomThreshold: val("bloomThreshold", 0.5),
        bloomIntensity: val("bloomIntensity", 0.5),
        bloomRadius: parseInt(id("bloomRadius")?.value) || 16,
        microEnabled: check("microEnabled"),
        microStrength: val("microStrength", 0.3),
        microRadius: parseInt(id("microRadius")?.value) || 4,
        gamma: val("gamma", 1),
        contrast: val("contrast", 1),
        vignette: val("vignette", 0),
        invert: check("invert"),
        blur: val("blur", 0),
        saturation: parseInt(id("color-sat-val")?.textContent) || 100,
        symH: id("symH")?.value === "true",
        symV: id("symV")?.value === "true",
        symOrder: id("symOrder")?.value,
        lineColor: hslToRgb(lineHSL[0], lineHSL[1], lineHSL[2]),
    };
}

function triggerPaint() {
    applyPaint(readPaintParams());
}

function clearAll() {
    stopRender();
    clearGrid();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width || 800, canvas.height || 600);
    setStatus("Cleared");
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
    const range = 2.25;
    const step = Math.sqrt((range * 2) * (range * 2) / samples);

    const params = {
        width,
        height,
        filterSource: getFilterSource(),
        tracerSource: getTracerSource(),
        px: posX,
        py_: posY,
        z: zoom / 2.2,
        it: iterations,
        baseSamples: samples,
        minX: -range,
        maxX: range,
        minY: -range,
        maxY: range,
        step,
        ...readPaintParams(),
        ...getAdaptiveParams(),
    };

    startRender(params, {
        onStatus: setStatus,
        onProgress: setProgress,
        onThreadInfo: (text) => { document.getElementById("thr-info").textContent = text; },
        onPaint: triggerPaint,
    });
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function switchTab(pane, el) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("on"));
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("on"));
    el.classList.add("on");
    const target = document.getElementById("p-" + pane);
    if (target) target.classList.add("on");
    if (pane === "fractal") buildPresetList();
}

function resizeCanvas() {
    if (!canvas || !canvasArea) return;
    const rect = canvasArea.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    triggerPaint();
}

window.addEventListener("resize", resizeCanvas);
window.onload = () => { init(); resizeCanvas(); };

// ─── Floating Panels ──────────────────────────────────────────────────────────

function savePanelState() {
    try { localStorage.setItem("fractal-panel-state", JSON.stringify(panelState)); }
    catch (e) { console.warn("Could not save panel state:", e); }
}

function loadPanelState() {
    try {
        const saved = localStorage.getItem("fractal-panel-state");
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(panelState.stats, parsed.stats || {});
            Object.assign(panelState.quick, parsed.quick || {});
        }
    }
    catch (e) { console.warn("Could not load panel state:", e); }
}

function initPanels() {
    loadPanelState();

    document.querySelectorAll(".floating-panel").forEach((panel) => {
        const panelId = panel.dataset.panel;
        const state = panelState[panelId];
        if (!state) return;

        if (panelId === "stats") {
            panel.style.display = "";
            panel.classList.add("show");
            return;
        }

        if (state.minimized) panel.classList.add("minimized");
        panel.style.display = state.visible ? "" : "none";
        panel.classList.toggle("show", state.visible);
    });

    document.querySelectorAll(".panel-drag-handle").forEach((handle) => {
        handle.addEventListener("mousedown", (e) => {
            if (e.target.closest(".panel-btn")) return;
            startPanelDrag(handle.closest(".floating-panel"), e);
        });
    });
}

function startPanelDrag(panel, e) {
    activePanel = panel;
    const rect = panel.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    panel.classList.add("dragging");
    document.addEventListener("mousemove", onPanelDrag);
    document.addEventListener("mouseup", endPanelDrag);
}

function onPanelDrag(e) {
    if (!activePanel) return;
    activePanel.style.left = e.clientX - dragOffset.x + "px";
    activePanel.style.top = e.clientY - dragOffset.y + "px";
    activePanel.style.right = "auto";
}

function endPanelDrag() {
    if (!activePanel) return;
    activePanel.classList.remove("dragging");
    activePanel = null;
    document.removeEventListener("mousemove", onPanelDrag);
    document.removeEventListener("mouseup", endPanelDrag);
}

function togglePanelMinimize(panelId) {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (!panel) return;
    panel.classList.toggle("minimized");
    if (panelState[panelId]) {
        panelState[panelId].minimized = panel.classList.contains("minimized");
        savePanelState();
    }
}

function closePanel(panelId) {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (!panel) return;
    panel.style.display = "none";
    panel.classList.remove("show");
    if (panelState[panelId]) {
        panelState[panelId].visible = false;
        savePanelState();
    }
    document.getElementById(panelId + "-toggle")?.classList.remove("on");
}

function toggleStats() {
    const panel = document.getElementById("render-stats-panel");
    const btn = document.getElementById("stats-toggle");
    if (!panel) return;

    const isShown = panel.style.display !== "none" || panel.classList.contains("show");

    if (isShown) {
        panel.style.display = "none";
        panel.classList.remove("show");
        btn.classList.remove("on");
        panelState.stats.visible = false;
    } else {
        panel.style.display = "";
        panel.classList.add("show");
        btn.classList.add("on");
        panelState.stats.visible = true;
    }
    savePanelState();
}

// ─── UI Mode ─────────────────────────────────────────────────────────────────

function setUIMode(mode) {
    uiMode = mode;
    document.querySelectorAll(".adv-body, .adv-toggle").forEach((el) => {
        el.style.display = mode === "basic" ? "none" : "";
    });
    document.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    try { localStorage.setItem("fractal-ui-mode", mode); }
    catch (e) {}
}

function initUIMode() {
    try {
        setUIMode(localStorage.getItem("fractal-ui-mode") === "advanced" ? "advanced" : "basic");
    }
    catch (e) { setUIMode("basic"); }
}

// ─── Quick Controls ───────────────────────────────────────────────────────────

function updateQuickSlider(mainId, qmId, qmValId, parse) {
    const input = document.getElementById(mainId);
    if (input) {
        input.value = qmId;
        input.dispatchEvent(new Event("input"));
    }
    const display = document.getElementById(qmValId);
    if (display) display.textContent = parse(qmId);
    lazyRepaint();
}

function updateQuickGamma(value) {
    updateQuickSlider("gamma", value, "qm-gamma-v", (v) => parseFloat(v).toFixed(2));
}

function updateQuickExposure(value) {
    updateQuickSlider("exposure", value, "qm-exposure-v", (v) => parseFloat(v).toFixed(2));
}

function updateQuickContrast(value) {
    updateQuickSlider("contrast", value, "qm-contrast-v", (v) => parseFloat(v).toFixed(2));
}

function updateQuickHue(value) {
    const hue = parseInt(value);
    lineHSL[0] = hue;
    const hueInput = document.getElementById("lH");
    if (hueInput) hueInput.value = hue;
    document.getElementById("lHv").textContent = hue + "°";
    const display = document.getElementById("qm-hue-v");
    if (display) display.textContent = hue + "°";
    lazyRepaint();
}

function toggleQuickSymmetry(type, btn) {
    const symH = document.getElementById("symH");
    const symV = document.getElementById("symV");
    const symOrder = document.getElementById("symOrder");
    const isActive = btn.classList.contains("on");

    if (isActive) {
        btn.classList.remove("on");
        symH.value = "false";
        symV.value = "false";
        symOrder.value = "none";
    } else {
        document.querySelectorAll(".qm-sym").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        switch (type) {
            case "h": symH.value = "true"; symV.value = "false"; symOrder.value = "h"; break;
            case "v": symH.value = "false"; symV.value = "true"; symOrder.value = "v"; break;
            case "4way": symH.value = "true"; symV.value = "true"; symOrder.value = "4way"; break;
            case "alt4way": symH.value = "true"; symV.value = "true"; symOrder.value = "alt4way"; break;
        }
    }

    document.querySelectorAll(".sym-btn").forEach((b) => b.classList.remove("on"));
    if (isActive) {
        document.getElementById("sym-none")?.classList.add("on");
    } else {
        document.getElementById("sym-" + type)?.classList.add("on");
    }
    lazyRepaint();
}

function syncQuickMenuFromMain() {
    const sync = (mainId, qmId, qmValId) => {
        const main = document.getElementById(mainId);
        const qm = document.getElementById(qmId);
        const qmVal = document.getElementById(qmValId);
        if (main) { if (qm) qm.value = main.value; if (qmVal) qmVal.textContent = parseFloat(main.value).toFixed(2); }
    };
    sync("gamma", "qm-gamma", "qm-gamma-v");
    sync("exposure", "qm-exposure", "qm-exposure-v");
    sync("contrast", "qm-contrast", "qm-contrast-v");
    const qmHue = document.getElementById("qm-hue");
    const qmHueV = document.getElementById("qm-hue-v");
    if (qmHue) qmHue.value = lineHSL[0];
    if (qmHueV) qmHueV.textContent = lineHSL[0] + "°";
}

function syncMainFromQuickMenu(qmId, mainId, mainValId) {
    const qm = document.getElementById(qmId);
    const main = document.getElementById(mainId);
    const mainVal = document.getElementById(mainValId);
    if (qm && main) {
        main.value = qm.value;
        if (mainVal) mainVal.textContent = parseFloat(qm.value).toFixed(2);
    }
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
    if (e.key === "q" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

        const panel = document.getElementById("quick-controls-panel");
        if (!panel) return;

        const isHidden = panel.style.display === "none" || !panel.classList.contains("show");
        if (isHidden) {
            panel.style.display = "";
            panel.classList.add("show");
            syncQuickMenuFromMain();
            panelState.quick.visible = true;
        } else {
            panel.style.display = "none";
            panel.classList.remove("show");
            panelState.quick.visible = false;
        }
        savePanelState();
    }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
    init, lazyRepaint, setQuality, setResolution, selectPreset,
    deleteCustomPreset, deleteCurrentPreset, showSaveRow, confirmSave,
    validateFunctions, syncLineHSL, updateFractalBuilder, applyFractalBuilder,
    randomFractal, resetFractalBuilder, runDebug, clearDebug, resetView,
    triggerPaint, clearAll, saveImage, switchTab, setStatus, setProgress,
    handleStartRender as startRender, stopRender, toggleStats, setSymmetry,
    setToneMap, updateColorSaturation, toggleSection, toggleAdvanced,
    togglePanelMinimize, closePanel, initPanels, setUIMode,
    updateQuickGamma, updateQuickExposure, updateQuickContrast, updateQuickHue,
    toggleQuickSymmetry, syncMainFromQuickMenu,
};
