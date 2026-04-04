// ====================== COLOR UTILITIES ======================

export function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
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
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s * 100, l * 100];
}

// ====================== MATH UTILITIES ======================

export function gaussianBlur(src, w, h, radius) {
    if (radius <= 0) return src;
    const sigma = Math.max(radius * 0.6, 0.5);
    const weights = [], halfSize = radius;
    let sum = 0;
    
    for (let k = -halfSize; k <= halfSize; k++) {
        const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
        weights.push(weight);
        sum += weight;
    }
    weights.forEach((w, i) => weights[i] /= sum);
    
    const temp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let val = 0;
            for (let k = -halfSize; k <= halfSize; k++) {
                val += src[y * w + Math.max(0, Math.min(w - 1, x + k))] * weights[k + halfSize];
            }
            temp[y * w + x] = val;
        }
    }
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let val = 0;
            for (let k = -halfSize; k <= halfSize; k++) {
                val += temp[Math.max(0, Math.min(h - 1, y + k)) * w + x] * weights[k + halfSize];
            }
            dst[y * w + x] = val;
        }
    }
    return dst;
}

// ====================== CODE GENERATION ======================

export function makeFractalCode(type, power, escape, rotation, sign, absReal, absImag, useConst, cX, cY) {
    const escSq = escape * escape;
    const cosR = Math.cos((rotation * Math.PI) / 180).toFixed(5);
    const sinR = Math.sin((rotation * Math.PI) / 180).toFixed(5);
    const cxs = useConst ? cX.toFixed(4) + "+cx" : "cx";
    const cys = useConst ? cY.toFixed(4) + "+cy" : "cy";
    
    const body = (emit) => {
        const lines = [];
        if (rotation > 0) lines.push(`    var rx=x*${cosR}-y*${sinR},ry=x*${sinR}+y*${cosR};x=rx;y=ry;`);
        if (sign > 0) lines.push(`    if(i%${sign}===0)a*=-1;`);
        
        if (type === 0 || type === 1) {
            if (power === 2) {
                lines.push(`    var tmp=x*x-y*y+${cxs};`);
                lines.push(`    y=2*x*y${sign > 0 ? "*a" : ""}+${cys};`);
                lines.push("    x=tmp;");
            } else {
                lines.push(`    var r2=x*x+y*y,th=Math.atan2(y,x),rn=Math.pow(r2,${power}/2);`);
                lines.push(`    var nx=rn*Math.cos(${power}*th)+${cxs};`);
                lines.push(`    y=rn*Math.sin(${power}*th)${sign > 0 ? "*a" : ""}+${cys};`);
                lines.push("    x=nx;");
            }
        } else if (type === 2) {
            lines.push(`    var tmp=x*x-y*y+${cxs};y=Math.abs(2*x*y)+${cys};x=Math.abs(tmp);`);
        } else if (type === 3) {
            lines.push(`    var tmp=x*x-y*y+${cxs};y=-2*x*y+${cys};x=tmp;`);
        } else if (type === 4) {
            lines.push(`    var tmp=Math.abs(x*x-y*y)+${cxs};y=2*x*y+${cys};x=tmp;`);
        } else if (type === 5) {
            lines.push(`    var tmp=Math.sin(x)*Math.cosh(y)+${cxs};y=Math.cos(x)*Math.sinh(y)+${cys};x=tmp;`);
        }
        if (absReal) lines.push("    x=Math.abs(x);");
        if (absImag) lines.push("    y=Math.abs(y);");
        if (emit) lines.push("    emit(x,y);");
        return lines.join("\n");
    };
    
    const init = sign > 0 ? "  var a=1;\n" : "";
    const extra = (type === 1 && power !== 2) || type === 5 ? ",r2,th,rn" : "";
    const esc = `x*x+y*y<${escSq.toFixed(1)}`;
    
    const ff = `function filterFunc(cx,cy,iter){\n${init}  var x=cx,y=cy,tmp${extra};\n  for(var i=0;i<iter&&${esc};i++){\n${body(false)}\n  }\n  return i<iter;\n}`;
    const tf = `function tracerFunc(cx,cy,iter,emit){\n${init}  var x=cx,y=cy,tmp${extra};\n  for(var i=0;i<iter&&${esc};i++){\n${body(true)}\n  }\n}`;
    
    return { f: ff, t: tf };
}

// ====================== WORKER CODE ======================

export function makeWorker(filterFunc, tracerFunc) {
    return "data:text/javascript;charset=utf-8," + encodeURIComponent([
        '"use strict";',
        filterFunc,
        tracerFunc,
        "self.onmessage=function(e){",
        "  var d=e.data,W=d.W,H=d.H,buf=new Uint32Array(W*H),hw=W/4;",
        "  for(var x=d.s;x<d.e;x+=d.step){",
        "    for(var y=d.y0;y<d.y1;y+=d.step){",
        "      var ok=false;try{ok=filterFunc(x,y,d.it);}catch(err){}",
        "      if(!ok)continue;",
        "      try{tracerFunc(x,y,d.it,function(px,py){",
        "        var x2=Math.round((px-d.px)*d.z*hw+W/2)-d.ox;",
        "        var y2=Math.round((d.py_-py)*d.z*hw+H/2)-d.oy;",
        "        if(x2>=0&&y2>=0&&x2<d.tw&&y2<d.th)buf[x2+y2*d.tw]++;",
        "      });}catch(err){}",
        "    }",
        '    self.postMessage({t:"p"});',
        "  }",
        '  self.postMessage({t:"d",buf:buf},[buf.buffer]);',
        "};"
    ].join("\n"));
}
