
// ─── Color ────────────────────────────────────────────────────────────────────

export function hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        const g = Math.round(l * 255);
        return [g, g, g];
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
}

// ─── Blur ──────────────────────────────────────────────────────────────────────

export function gaussianBlur(src, width, height, radius) {
    if (radius <= 0) return src;
    const r = Math.max(1, radius);
    const sigma = Math.max(r * 0.6, 0.5);
    const halfSize = Math.ceil(r);

    // Build kernel
    const weights = [];
    let sum = 0;
    for (let k = -halfSize; k <= halfSize; k++) {
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        weights.push(w);
        sum += w;
    }
    weights.forEach((w, i) => weights[i] = w / sum);

    // Horizontal pass
    const temp = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let val = 0;
            for (let k = -halfSize; k <= halfSize; k++) {
                const sx = Math.max(0, Math.min(width - 1, x + k));
                val += src[y * width + sx] * weights[k + halfSize];
            }
            temp[y * width + x] = val;
        }
    }

    // Vertical pass
    const dst = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let val = 0;
            for (let k = -halfSize; k <= halfSize; k++) {
                const sy = Math.max(0, Math.min(height - 1, y + k));
                val += temp[sy * width + x] * weights[k + halfSize];
            }
            dst[y * width + x] = val;
        }
    }

    return dst;
}

// ─── Code generation ─────────────────────────────────────────────────────────

export function makeFractalCode(type, power, escape, rotation, sign, juliaEnabled, cX, cY) {
    const escSq = escape * escape;
    const cosR = Math.cos((rotation * Math.PI) / 180).toFixed(5);
    const sinR = Math.sin((rotation * Math.PI) / 180).toFixed(5);
    const cxStr = juliaEnabled ? `${cX.toFixed(4)}+cx` : 'cx';
    const cyStr = juliaEnabled ? `${cY.toFixed(4)}+cy` : 'cy';

    const buildBody = (emit) => {
        const lines = [];

        if (rotation > 0) {
            lines.push(`    var rx=x*${cosR}-y*${sinR},ry=x*${sinR}+y*${cosR};x=rx;y=ry;`);
        }
        if (sign > 0) {
            lines.push(`    if(i%${sign}===0)a*=-1;`);
        }

        const emitLine = (s) => lines.push(`    ${s}`);
        const sig = sign > 0 ? '*a' : '';

        switch (type) {
            case 0:
            case 1:
                if (power === 2) {
                    emitLine(`var tmp=x*x-y*y+${cxStr};`);
                    emitLine(`y=2*x*y${sig}+${cyStr};`);
                    emitLine('x=tmp;');
                } else {
                    emitLine(`var r2=x*x+y*y,th=Math.atan2(y,x),rn=Math.pow(r2,${power}/2);`);
                    emitLine(`var nx=rn*Math.cos(${power}*th)+${cxStr};`);
                    emitLine(`y=rn*Math.sin(${power}*th)${sig}+${cyStr};x=nx;`);
                }
                break;
            case 2:
                emitLine(`var tmp=x*x-y*y+${cxStr};y=Math.abs(2*x*y)+${cyStr};x=Math.abs(tmp);`);
                break;
            case 3:
                emitLine(`var tmp=x*x-y*y+${cxStr};y=-2*x*y+${cyStr};x=tmp;`);
                break;
            case 4:
                emitLine(`var tmp=Math.abs(x*x-y*y)+${cxStr};y=2*x*y+${cyStr};x=tmp;`);
                break;
            case 5:
                emitLine(`var tmp=Math.sin(x)*Math.cosh(y)+${cxStr};y=Math.cos(x)*Math.sinh(y)+${cyStr};x=tmp;`);
                break;
        }

        if (emit) emitLine('emit(x,y);');

        return lines.join('\n');
    };

    const init = sign > 0 ? '  var a=1;\n' : '';
    const extra = (type === 1 && power !== 2) || type === 5 ? ',r2,th,rn' : '';
    const escCheck = `x*x+y*y<${escSq.toFixed(1)}`;

    const filterFunc = `function filterFunc(cx,cy,iter){\n${init}  var x=cx,y=cy,tmp${extra};\n  for(var i=0;i<iter&&${escCheck};i++){\n${buildBody(false)}\n  }\n  return i<iter;\n}`;
    const tracerFunc = `function tracerFunc(cx,cy,iter,emit){\n${init}  var x=cx,y=cy,tmp${extra};\n  for(var i=0;i<iter&&${escCheck};i++){\n${buildBody(true)}\n  }\n}`;

    return { f: filterFunc, t: tracerFunc };
}
