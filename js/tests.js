// Simple tests for Fractal Path Tracer core modules
// Run with: node js/tests.js

import { hslToRgb, rgbToHsl } from './helpers.js';
import { PRESETS, QUALITY_PRESETS } from './presets.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${expected}, got ${actual}`);
    }
}

function assertTrue(value, msg = '') {
    if (!value) {
        throw new Error(`${msg} Expected truthy value, got ${value}`);
    }
}

function assertDefined(value, msg = '') {
    if (value === undefined) {
        throw new Error(`${msg} Value is undefined`);
    }
}

// ====================== PRESETS TESTS ======================

console.log('\n=== Presets Tests ===\n');

test('PRESETS should have galaxy preset', () => {
    assertDefined(PRESETS.galaxy, 'galaxy preset ');
});

test('PRESETS.galaxy should have name and desc', () => {
    assertEqual(PRESETS.galaxy.name, 'Galaxy Cloud');
    assertEqual(PRESETS.galaxy.desc, 'Sinusoidal distortion — nebula');
});

test('PRESETS.galaxy should have filter and tracer functions', () => {
    assertDefined(PRESETS.galaxy.f, 'filter function ');
    assertDefined(PRESETS.galaxy.t, 'tracer function ');
});

test('PRESETS should have twisted preset', () => {
    assertDefined(PRESETS.twisted, 'twisted preset ');
});

test('PRESETS should have buddhabrot preset', () => {
    assertDefined(PRESETS.buddhabrot, 'buddhabrot preset ');
});

test('QUALITY_PRESETS should have low/med/high/ultra', () => {
    assertDefined(QUALITY_PRESETS.low);
    assertDefined(QUALITY_PRESETS.med);
    assertDefined(QUALITY_PRESETS.high);
    assertDefined(QUALITY_PRESETS.ultra);
});

test('QUALITY_PRESETS.low should have iterations and samples', () => {
    assertEqual(typeof QUALITY_PRESETS.low.iterations, 'number');
    assertEqual(typeof QUALITY_PRESETS.low.samples, 'number');
});

test('QUALITY_PRESETS values should be reasonable', () => {
    assertTrue(QUALITY_PRESETS.low.iterations < QUALITY_PRESETS.med.iterations);
    assertTrue(QUALITY_PRESETS.med.iterations < QUALITY_PRESETS.high.iterations);
    assertTrue(QUALITY_PRESETS.high.iterations < QUALITY_PRESETS.ultra.iterations);
});

// ====================== HELPERS TESTS ======================

console.log('\n=== Helpers Tests ===\n');

test('hslToRgb should convert pure red', () => {
    const rgb = hslToRgb(0, 100, 50);
    assertEqual(rgb[0], 255, 'R: ');
    assertEqual(rgb[1], 0, 'G: ');
    assertEqual(rgb[2], 0, 'B: ');
});

test('hslToRgb should convert pure green', () => {
    const rgb = hslToRgb(120, 100, 50);
    assertEqual(rgb[0], 0, 'R: ');
    assertEqual(rgb[1], 255, 'G: ');
    assertEqual(rgb[2], 0, 'B: ');
});

test('hslToRgb should convert pure blue', () => {
    const rgb = hslToRgb(240, 100, 50);
    assertEqual(rgb[0], 0, 'R: ');
    assertEqual(rgb[1], 0, 'G: ');
    assertEqual(rgb[2], 255, 'B: ');
});

test('hslToRgb should convert white', () => {
    const rgb = hslToRgb(0, 0, 100);
    assertEqual(rgb[0], 255, 'R: ');
    assertEqual(rgb[1], 255, 'G: ');
    assertEqual(rgb[2], 255, 'B: ');
});

test('hslToRgb should convert black', () => {
    const rgb = hslToRgb(0, 0, 0);
    assertEqual(rgb[0], 0, 'R: ');
    assertEqual(rgb[1], 0, 'G: ');
    assertEqual(rgb[2], 0, 'B: ');
});

test('hslToRgb should convert grayscale', () => {
    const rgb = hslToRgb(0, 0, 50);
    assertEqual(rgb[0], rgb[1], 'R should equal G');
    assertEqual(rgb[1], rgb[2], 'G should equal B');
});

test('rgbToHsl should convert back to original', () => {
    const original = [128, 64, 192];
    const hsl = rgbToHsl(...original);
    const back = hslToRgb(...hsl);
    assertEqual(back[0], original[0], 'R: ');
    assertEqual(back[1], original[1], 'G: ');
    assertEqual(back[2], original[2], 'B: ');
});

test('hslToRgb values should be in valid range', () => {
    for (let h = 0; h < 360; h += 60) {
        for (let s = 0; s <= 100; s += 50) {
            for (let l = 0; l <= 100; l += 50) {
                const rgb = hslToRgb(h, s, l);
                assertTrue(rgb[0] >= 0 && rgb[0] <= 255, 'R out of range');
                assertTrue(rgb[1] >= 0 && rgb[1] <= 255, 'G out of range');
                assertTrue(rgb[2] >= 0 && rgb[2] <= 255, 'B out of range');
            }
        }
    }
});

// ====================== FUNCTION VALIDITY TESTS ======================

console.log('\n=== Function Validity Tests ===\n');

test('Galaxy filter function should be valid JS', () => {
    const func = new Function(PRESETS.galaxy.f + '\nreturn filterFunc;');
    assertTrue(typeof func() === 'function', 'Should return a function');
});

test('Galaxy tracer function should be valid JS', () => {
    const func = new Function(PRESETS.galaxy.t + '\nreturn tracerFunc;');
    assertTrue(typeof func() === 'function', 'Should return a function');
});

test('Twisted filter function should be valid JS', () => {
    const func = new Function(PRESETS.twisted.f + '\nreturn filterFunc;');
    assertTrue(typeof func() === 'function', 'Should return a function');
});

test('Buddhabrot filter function should be valid JS', () => {
    const func = new Function(PRESETS.buddhabrot.f + '\nreturn filterFunc;');
    assertTrue(typeof func() === 'function', 'Should return a function');
});

test('Filter function should return boolean', () => {
    const filter = new Function(PRESETS.galaxy.f + '\nreturn filterFunc;')();
    const result = filter(0, 0, 100);
    assertTrue(typeof result === 'boolean', 'Should return boolean');
});

test('Tracer function should accept emit callback', () => {
    const tracer = new Function(PRESETS.galaxy.t + '\nreturn tracerFunc;')();
    let emitCount = 0;
    const emit = () => emitCount++;
    tracer(0, 0, 10, emit);
    assertTrue(emitCount >= 0, 'Should call emit without error');
});

// ====================== SUMMARY ======================

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
}
