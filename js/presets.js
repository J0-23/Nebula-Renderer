// ====================== FRACTAL PRESETS ======================

export const PRESETS = {
    galaxy: {
        name: "Galaxy Cloud",
        desc: "Sinusoidal distortion — nebula",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;\n    y=2*x*y+cy+0.3*Math.sin(x);\n    x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;\n    y=2*x*y+cy+0.3*Math.sin(x);\n    x=tmp;\n    emit(x,y);\n  }\n}"
    },
    twisted: {
        name: "Twisted",
        desc: "Sign-flip — starburst",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,a=1,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    a*=-1;tmp=x*x-y*y+cx;y=2*x*y*a+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,a=1,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    a*=-1;tmp=x*x-y*y+cx;y=2*x*y*a+cy;x=tmp;\n    emit(x,y);\n  }\n}"
    },
    buddhabrot: {
        name: "Buddhabrot",
        desc: "Classic soft figure",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}"
    },
    anti: {
        name: "Anti-Buddhabrot",
        desc: "Bounded paths — inverse",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i>=iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}"
    },
    burning: {
        name: "Burning Ship",
        desc: "Absolute — flame",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=Math.abs(2*x*y)+cy;x=Math.abs(tmp);\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=Math.abs(2*x*y)+cy;x=Math.abs(tmp);\n    emit(x,y);\n  }\n}"
    },
    tricorn: {
        name: "Tricorn",
        desc: "Conjugate — 3-fold",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=-2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=x*x-y*y+cx;y=-2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}"
    },
    celtic: {
        name: "Celtic",
        desc: "|Re(z²)| — knotted",
        f: "function filterFunc(cx,cy,iter){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=Math.abs(x*x-y*y)+cx;y=2*x*y+cy;x=tmp;\n  }\n  return i<iter;\n}",
        t: "function tracerFunc(cx,cy,iter,emit){\n  var x=cx,y=cy,tmp;\n  for(var i=0;i<iter&&x*x+y*y<10;i++){\n    tmp=Math.abs(x*x-y*y)+cx;y=2*x*y+cy;x=tmp;\n    emit(x,y);\n  }\n}"
    }
};

// ====================== QUALITY PRESETS ======================

export const QUALITY_PRESETS = {
    low: { iterations: 300, samples: 200000 },
    med: { iterations: 1500, samples: 800000 },
    high: { iterations: 4000, samples: 4000000 },
    ultra: { iterations: 10000, samples: 8000000 }
};
