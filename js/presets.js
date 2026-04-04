
// ─── Fractal presets ─────────────────────────────────────────────────────────────
// Each preset has a name, description, and filter/tracer functions.
// Filter: returns true if point should be traced.
// Tracer: iterates and emits (x, y) positions along the escape path.

export const PRESETS = {
    galaxy: {
        name: "Galaxy Cloud",
        desc: "Sinusoidal distortion — nebula",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;\n    y=2*x*y+cy+0.3*Math.sin(x);\n    x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;\n    y=2*x*y+cy+0.3*Math.sin(x);\n    x=tmp;\n    emit(x,y);\n  }\n}",
    },
    twisted: {
        name: "Twisted",
        desc: "Sign-flip — starburst",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,a=1,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    a*=-1;tmp=x*x-y*y+cx;y=2*x*y*a+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,a=1,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    a*=-1;tmp=x*x-y*y+cx;y=2*x*y*a+cy;x=tmp;\n    emit(x,y);\n  }\n}",
    },
    buddhabrot: {
        name: "Buddhabrot",
        desc: "Classic soft figure",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}",
    },
    anti: {
        name: "Anti-Buddhabrot",
        desc: "Bounded paths — inverse",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i>=iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}",
    },
    burning: {
        name: "Burning Ship",
        desc: "Absolute — flame",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=Math.abs(2*x*y)+cy;x=Math.abs(tmp);\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=Math.abs(2*x*y)+cy;x=Math.abs(tmp);\n    emit(x,y);\n  }\n}",
    },
    tricorn: {
        name: "Tricorn",
        desc: "Conjugate — 3-fold",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=-2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=-2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}",
    },
    celtic: {
        name: "Celtic",
        desc: "|Re(z²)| — knotted",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=Math.abs(x*x-y*y)+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=Math.abs(x*x-y*y)+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}",
    },
};

// ─── Quality presets ────────────────────────────────────────────────────────────
// Determines render quality settings: iterations (detail), samples (smoothness), and adaptive sampling.

export const QUALITY_PRESETS = {
    low: {
        iterations: 8000,
        samples: 3000000,
        adaptive: null,
    },
    med: {
        iterations: 12000,
        samples: 5000000,
        adaptive: { variance: 0.025, passes: 1, hitDensity: 0.1, chunk: 0.15 },
    },
    high: {
        iterations: 20000,
        samples: 8000000,
        adaptive: { variance: 0.001, passes: 4, hitDensity: 0.05, chunk: 0.1 },
    },
    ultra: {
        iterations: 80000,
        samples: 25000000,
        adaptive: { variance: 0.001, passes: 8, hitDensity: 0.005, chunk: 0.05 },
    },
};
