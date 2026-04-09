
import { adaptiveTuning, adaptiveDefaults } from './renderer.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _chunkSize = adaptiveDefaults.chunkSize;
let _debounceTimer = null;
const DEBOUNCE_MS = 320;

// ─── UI helpers ──────────────────────────────────────────────────────────────

function readParams() {
    return {
        enabled: document.getElementById('at-enabled')?.checked ?? false,
        varianceThreshold: parseFloat(document.getElementById('at-var').value),
        passMultiplier: parseInt(document.getElementById('at-agg').value, 10),
        hitDensityThreshold: parseFloat(document.getElementById('at-hit').value),
        chunkSize: _chunkSize,
    };
}

function setStatus(text, cls = '') {
    const el = document.getElementById('at-status');
    if (!el) return;

    el.textContent = text;
    el.className = cls;

    if (text && cls !== 'busy') {
        clearTimeout(el._timer);
        el._timer = setTimeout(() => {
            el.textContent = '';
            el.className = '';
        }, 3000);
    }
}

function applyNow() {
    const params = readParams();

    adaptiveTuning.update({
        enabled: params.enabled,
        varianceThreshold: params.varianceThreshold,
        passMultiplier: params.passMultiplier,
        hitDensityThreshold: params.hitDensityThreshold,
        chunkSize: params.chunkSize,
    });

    setStatus('Saved — applies on next render');
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Debounced handler for slider input.
 */
export function onAdaptiveChange() {
    clearTimeout(_debounceTimer);
    setStatus('…');
    _debounceTimer = setTimeout(applyNow, DEBOUNCE_MS);
}

/**
 * Set variance preset and update button states.
 * @param {number} value
 * @param {HTMLElement} btn
 */
export function atVarPreset(value, btn) {
    document.getElementById('at-var').value = value;
    document.getElementById('at-var-v').textContent = value.toFixed(2);

    document.querySelectorAll('.at-scale').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');

    onAdaptiveChange();
}

/**
 * Set chunk size preset and update button states.
 * @param {number} value
 * @param {HTMLElement} btn
 */
export function atChunkPreset(value, btn) {
    _chunkSize = value;

    const container = document.getElementById('at-chunk-pills');
    if (container) {
        container.querySelectorAll('.pl').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
    }

    onAdaptiveChange();
}

/**
 * Reset all controls to defaults.
 */
export function resetAdaptive() {
    const d = adaptiveDefaults;
    _chunkSize = d.chunkSize;

    // Toggle
    const enEl = document.getElementById('at-enabled');
    if (enEl) enEl.checked = d.enabled;

    // Variance
    document.getElementById('at-var').value = d.varianceThreshold;
    document.getElementById('at-var-v').textContent = d.varianceThreshold.toFixed(2);

    // Scale preset buttons (fast/balanced/fine)
    document.querySelectorAll('.at-scale').forEach(b => b.classList.remove('on'));
    document.querySelector('.at-scale:nth-child(2)')?.classList.add('on');

    // Aggressiveness
    document.getElementById('at-agg').value = d.passMultiplier;
    document.getElementById('at-agg-v').textContent = d.passMultiplier + '×';

    // Hit density
    document.getElementById('at-hit').value = d.hitDensityThreshold;
    document.getElementById('at-hit-v').textContent = (d.hitDensityThreshold * 100).toFixed(1) + '%';

    // Chunk pills
    const chunkContainer = document.getElementById('at-chunk-pills');
    if (chunkContainer) {
        chunkContainer.querySelectorAll('.pl').forEach(btn => {
            const val = parseFloat(btn.textContent);
            btn.classList.toggle('on', Math.abs(val - d.chunkSize) < 0.001);
        });
    }

    clearTimeout(_debounceTimer);
    applyNow();
    setStatus('Reset to defaults', 'ok');
}

/**
 * Get params for render start. Consumed by main.js.
 */
export function getAdaptiveParams() {
    const p = readParams();
    return {
        adaptiveEnabled: p.enabled,
        adaptiveVarianceThreshold: p.varianceThreshold,
        adaptivePassMultiplier: p.passMultiplier,
        adaptiveHitThreshold: p.hitDensityThreshold,
        chunkSize: p.chunkSize,
    };
}
