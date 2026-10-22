// A deliberately small GLSL compiler for the expression subset used by this demo.
// It keeps the upstream procedural surfaces, rather than substituting flat materials.
// This is example code, not a general implementation of three.js TSL.
import * as THREE from 'threepipe';

let serial = 0;
let statements = null;
const storageNodes = [];
const width = (type) => Number(type.match(/vec([234])/)?.[1] || 1);
const vectorType = (n) => n === 1 ? 'float' : `vec${n}`;
const scalar = (n) => Number.isInteger(n) ? `${n}.0` : String(n);
const commonType = (a, b) => a.startsWith('mat') ? b : b.startsWith('mat') ? a : vectorType(Math.max(width(a), width(b)));
const wrap = (v) => {
    if (v instanceof Node) return v;
    if (typeof v === 'number') return new Node('constant', 'float', [], scalar(v));
    if (typeof v === 'boolean') return new Node('constant', 'bool', [], String(v));
    throw new Error(`Unsupported city shader value: ${v}`);
};
function capture(callback) {
    const parent = statements;
    statements = [];
    try { const result = callback(); return {body: statements, result}; }
    finally { statements = parent; }
}
class Node {
    constructor(kind, type, args = [], data = null) {
        this.id = serial++;
        this.kind = kind;
        this.type = type;
        this.args = args;
        this.data = data;
    }
    toVar() {
        const n = new Node('variable', this.type, [this]);
        statements?.push({kind: 'declare', node: n});
        return n;
    }
    assign(v) {
        if (!statements) throw new Error('Shader assignment outside Fn');
        statements.push({kind: 'assign', target: this, value: wrap(v)});
        return this;
    }
    addAssign(v) { return this.assign(this.add(v)); }
    subAssign(v) { return this.assign(this.sub(v)); }
    mulAssign(v) { return this.assign(this.mul(v)); }
    divAssign(v) { return this.assign(this.div(v)); }
    setInterpolation() { return this; }
    toReadOnly() { return this; }
    element(index) { return new Node('element', this.data.elementType, [this, wrap(index)]); }
    negate() { return new Node('unary', this.type, [this], '-'); }
    oneMinus() { return wrap(1).sub(this); }
    transformDirection(v) { return TSL.normalize(TSL.vec3(new Node('binary', 'vec4', [this, TSL.vec4(v, 0)], '*'))); }
}
for (const [name, op] of Object.entries({add: '+', sub: '-', mul: '*', div: '/'})) {
    Node.prototype[name] = function (v) {
        const b = wrap(v);
        return new Node('binary', this.type === 'int' && b.type === 'int' ? 'int' : commonType(this.type, b.type), [this, b], op);
    };
}
for (const [name, op] of Object.entries({greaterThan: '>', lessThan: '<', greaterThanEqual: '>=', lessThanEqual: '<=', equal: '=='})) {
    Node.prototype[name] = function (v) { return new Node('compare', 'bool', [this, wrap(v)], op); };
}
for (const c of ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a']) {
    // Swizzles use GLSL's spelling, including repeated components.
    for (let len = 1; len <= 4; len++) {
        const add = (prefix) => {
            if (prefix.length === len) {
                if (!Object.getOwnPropertyDescriptor(Node.prototype, prefix)) Object.defineProperty(Node.prototype, prefix, {
                    get() { return new Node('swizzle', vectorType(prefix.length), [this], prefix); },
                    set(v) { this.assign(v); },
                });
                return;
            }
            for (const s of c === 'r' ? 'rgba' : 'xyzw') add(prefix + s);
        };
        // Define the usual swizzles once per alphabet.
        if (c === 'x' || c === 'r') add('');
    }
}
export const TSL = {};
for (const type of ['float', 'int', 'vec2', 'vec3', 'vec4']) {
    TSL[type] = (...args) => new Node('construct', type, (args.length ? args : [0]).map(wrap), type);
}
TSL.color = (value) => {
    const c = value?.isColor ? value : new THREE.Color(value);
    return TSL.vec3(c.r, c.g, c.b);
};
for (const name of ['sin', 'cos', 'abs', 'floor', 'fract', 'ceil', 'exp', 'sqrt', 'sign', 'fwidth', 'dFdx', 'dFdy', 'normalize', 'pow', 'min', 'max', 'mod', 'clamp', 'mix', 'step', 'smoothstep', 'dot', 'length', 'cross', 'reflect']) {
    TSL[name] = (...values) => {
        const args = values.map(wrap);
        const type = ['min', 'max', 'pow', 'mod'].includes(name) ? args.reduce((t, a) => commonType(t, a.type), args[0].type) : ['dot', 'length'].includes(name) ? 'float' : name === 'mix' ? commonType(args[0].type, args[1].type) : name === 'step' ? args[1].type : name === 'smoothstep' ? args[2].type : args[0].type;
        return new Node('call', type, args, name);
    };
    if (!Node.prototype[name]) Node.prototype[name] = function (...args) { return TSL[name](this, ...args); };
}
TSL.select = (condition, a, b) => new Node('select', commonType(wrap(a).type, wrap(b).type), [wrap(condition), wrap(a), wrap(b)]);
TSL.Fn = (callback) => {
    const variants = new Map();
    return (...values) => {
        const args = values.map(wrap);
        const key = args.map(n => n.type).join(',');
        let spec = variants.get(key);
        if (!spec) {
            const params = args.map((n, i) => new Node('symbol', n.type, [], `p${i}`));
            const {body, result} = capture(() => callback(params));
            spec = {id: serial++, params, body, result: wrap(result), type: wrap(result).type};
            variants.set(key, spec);
        }
        return new Node('function', spec.type, args, spec);
    };
};
TSL.If = (condition, callback) => {
    const block = {kind: 'if', condition: wrap(condition), yes: capture(callback).body, no: []};
    if (!statements) throw new Error('If outside shader Fn');
    statements.push(block);
    return {Else(fn) { block.no = capture(fn).body; }};
};
TSL.uniform = (value) => {
    const type = value?.isColor || value?.isVector3 ? 'vec3' : value?.isVector2 ? 'vec2' : value?.isVector4 ? 'vec4' : 'float';
    const n = new Node('uniform', type);
    n.value = value;
    return n;
};
TSL.attribute = (name, type = 'float') => new Node('attribute', type, [], name);
TSL.varying = (value) => new Node('varying', wrap(value).type, [wrap(value)]);
TSL.uv = () => new Node('uv', 'vec2');
TSL.texture = (texture, uv = TSL.uv()) => {
    const n = new Node('sampler', 'sampler2D'); n.value = texture;
    return new Node('texture', 'vec4', [n, wrap(uv)]);
};
TSL.rotateUV = (p, angle) => {
    const v = p.sub(TSL.vec2(0.5)); const c = TSL.cos(angle), s = TSL.sin(angle);
    return TSL.vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c))).add(TSL.vec2(0.5));
};
TSL.time = TSL.uniform(0);
TSL.screenSize = TSL.uniform(new THREE.Vector2(1, 1));
TSL.screenCoordinate = new Node('symbol', 'vec2', [], 'gl_FragCoord.xy');
TSL.cameraPosition = new Node('symbol', 'vec3', [], 'cameraPosition');
TSL.cameraProjectionMatrix = new Node('symbol', 'mat4', [], 'projectionMatrix');
TSL.cameraViewMatrix = new Node('symbol', 'mat4', [], 'viewMatrix');
TSL.modelNormalMatrix = new Node('modelNormalMatrix', 'mat3');
TSL.frontFacing = new Node('symbol', 'bool', [], 'gl_FrontFacing');
TSL.instanceIndex = new Node('symbol', 'int', [], 'gl_InstanceID');
for (const [name, type] of Object.entries({positionGeometry: 'vec3', positionLocal: 'vec3', positionWorld: 'vec3', positionView: 'vec3', positionViewDirection: 'vec3', normalGeometry: 'vec3', normalLocal: 'vec3', normalWorld: 'vec3', normalWorldGeometry: 'vec3', normalView: 'vec3', normalViewGeometry: 'vec3'})) TSL[name] = new Node('builtin', type, [], name);
// MRT routing is owned by ThreePipe's G-buffer and composer.
TSL.mrt = () => ({});
TSL.specularColor = TSL.vec3(0.04);
TSL.specularColorBlended = TSL.vec3(0.04);
TSL.specularF90 = TSL.float(1);
// Deterministic value noise for the two small MaterialX calls in roof materials.
TSL.mx_noise_float = TSL.Fn(([p]) => TSL.fract(TSL.sin(TSL.dot(p, TSL.vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));
TSL.mx_worley_noise_float = TSL.mx_noise_float;
TSL.attributeArray = (count, elementType) => {
    const textureWidth = Math.min(count, 1024);
    const textureHeight = Math.ceil(count / textureWidth);
    const data = new Float32Array(textureWidth * textureHeight * width(elementType));
    const attr = new THREE.BufferAttribute(data, width(elementType));
    const texture = new THREE.DataTexture(data, textureWidth, textureHeight, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    const n = new Node('storage', 'sampler2D', [], {elementType, count, texture, attr, textureWidth, version: -1});
    n.value = attr;
    storageNodes.push(n);
    return n;
};

class Compiler {
    constructor(stage, shared, locals = new Map()) {
        this.stage = stage;
        this.shared = shared;
        this.locals = locals;
        this.lines = [];
    }
    coerce(node, type) {
        const value = this.expr(node);
        if (node.type === type) return value;
        if (node.type === 'vec4' && type === 'vec3') return `${value}.rgb`;
        if (width(node.type) > width(type)) return `${value}.${'xyzw'.slice(0, width(type))}`;
        return `${type}(${value})`;
    }
    uniform(n, type = n.type, value = n) {
        const name = `nyU${n.id}`;
        this.shared.uniforms[name] = value;
        this.shared[this.stage].add(`uniform ${type} ${name};`);
        return name;
    }
    varying(n, vertexNode, type = n.type) {
        const name = `nyV${n.id}`;
        this.shared.vertex.add(`varying ${type} ${name};`);
        this.shared.fragment.add(`varying ${type} ${name};`);
        this.shared.varyings.set(name, vertexNode);
        return name;
    }
    builtin(n) {
        const key = n.data;
        if (this.stage === 'vertex') {
            return ({positionGeometry: 'position', positionLocal: 'nyLocalPosition', normalGeometry: 'normal', normalLocal: 'nyLocalNormal', positionWorld: '(modelMatrix * vec4(nyLocalPosition, 1.0)).xyz', positionView: '(modelViewMatrix * vec4(nyLocalPosition, 1.0)).xyz', normalView: 'normalize(normalMatrix * nyLocalNormal)', normalViewGeometry: 'normalize(normalMatrix * nyLocalNormal)', normalWorld: 'normalize(mat3(modelMatrix) * nyLocalNormal)', normalWorldGeometry: 'normalize(mat3(modelMatrix) * nyLocalNormal)'})[key];
        }
        if (key === 'positionView') return 'nyViewPosition';
        if (key === 'positionViewDirection') return 'normalize(-nyViewPosition)';
        if (key === 'normalView') return 'nyShadingNormal';
        if (key === 'normalViewGeometry') return 'normalize(nyGeometryNormal)';
        if (key === 'normalWorld' || key === 'normalWorldGeometry') return 'normalize(vec3(vec4(normalize(nyGeometryNormal), 0.0) * viewMatrix))';
        if (key === 'positionWorld') return 'nyWorldPosition';
        return this.varying(n, new Node('symbol', n.type, [], key.startsWith('position') ? 'position' : 'normal'));
    }
    expr(n) {
        n = wrap(n);
        if (this.locals.has(n)) return this.locals.get(n);
        let code;
        switch (n.kind) {
        case 'constant': return n.data;
        case 'symbol': if (this.stage === 'fragment' && n.data === 'gl_InstanceID') return `int(${this.varying(n, new Node('symbol', 'float', [], 'float(gl_InstanceID)'), 'float')})`; if (this.stage === 'fragment' && n.data === 'projectionMatrix') this.shared.fragment.add('uniform mat4 projectionMatrix;'); return n.data;
        case 'builtin': return this.builtin(n);
        case 'modelNormalMatrix': return 'mat3(modelMatrix)';
        case 'uniform': case 'sampler': return this.uniform(n);
        case 'storage': return this.uniform(n, 'sampler2D', {value: n.data.texture});
        case 'attribute': {
            if (this.stage === 'fragment') return this.varying(n, n);
            if (n.data !== 'position' && n.data !== 'normal' && n.data !== 'uv') this.shared.vertex.add(`attribute ${n.type} ${n.data};`);
            return n.data;
        }
        case 'uv': return this.stage === 'vertex' ? 'uv' : 'nyUv';
        case 'varying': return this.stage === 'vertex' ? this.expr(n.args[0]) : this.varying(n, n.args[0]);
        case 'variable': {
            code = this.expr(n.args[0]); break;
        }
        case 'swizzle': return `(${this.expr(n.args[0])}).${n.data}`;
        case 'unary': code = `(${n.data}${this.expr(n.args[0])})`; break;
        case 'binary': {
            const [a, b] = n.args;
            if (a.type.startsWith('mat') || b.type.startsWith('mat')) code = `(${this.expr(a)} ${n.data} ${this.expr(b)})`;
            else code = `(${this.coerce(a, n.type)} ${n.data} ${this.coerce(b, n.type)})`;
            break;
        }
        case 'compare': code = `(${this.expr(n.args[0])} ${n.data} ${this.coerce(n.args[1], n.args[0].type)})`; break;
        case 'construct': code = `${n.type}(${n.args.map(a => this.expr(a)).join(', ')})`; break;
        case 'call': {
            const args = n.args;
            const name = n.data;
            let values;
            if (['dot', 'cross', 'reflect'].includes(name)) values = args.map(a => this.coerce(a, args[0].type));
            else values = args.map(a => this.coerce(a, n.type));
            if (['length', 'normalize'].includes(name)) values = args.map(a => this.expr(a));
            code = values.slice(1).reduce((a, b) => `${name}(${a}, ${b})`, values[0]);
            if (!['min', 'max'].includes(name)) code = `${name}(${values.join(', ')})`; break;
        }
        case 'select': code = `(${this.expr(n.args[0])} ? ${this.coerce(n.args[1], n.type)} : ${this.coerce(n.args[2], n.type)})`; break;
        case 'texture': code = `texture2D(${this.expr(n.args[0])}, ${this.expr(n.args[1])})`; break;
        case 'element': {
            const a = n.args[0];
            const index = `int(${this.expr(n.args[1])})`;
            code = `texelFetch(${this.expr(a)}, ivec2(${index} % ${a.data.textureWidth}, ${index} / ${a.data.textureWidth}), 0)`; break;
        }
        case 'function': {
            const spec = n.data;
            const name = `nyFn${spec.id}_${this.stage}`;
            if (!this.shared.functions[this.stage].has(name)) {
                // Reserve before compiling nested calls.
                this.shared.functions[this.stage].set(name, '');
                const c = new Compiler(this.stage, this.shared);
                c.emit(spec.body);
                const result = c.expr(spec.result);
                this.shared.functions[this.stage].delete(name);
                this.shared.functions[this.stage].set(name, `${spec.type} ${name}(${spec.params.map((p, i) => `${p.type} p${i}`).join(', ')}) {\n${c.lines.join('\n')}\nreturn ${result};\n}`);
            }
            code = `${name}(${n.args.map(a => this.expr(a)).join(', ')})`; break;
        }
        default: throw new Error(`Unsupported city shader expression: ${n.kind}`);
        }
        const name = `nyT${n.id}`;
        this.lines.push(`${n.type} ${name} = ${code};`);
        this.locals.set(n, name);
        return name;
    }
    emit(body) {
        for (const stmt of body) {
            if (stmt.kind === 'declare') this.expr(stmt.node);
            else if (stmt.kind === 'assign') {
                const target = this.expr(stmt.target);
                const value = this.coerce(stmt.value, stmt.target.type);
                this.lines.push(`${target} = ${value};`);
            } else if (stmt.kind === 'if') {
                const cond = this.expr(stmt.condition);
                const yes = new Compiler(this.stage, this.shared, new Map(this.locals)); yes.emit(stmt.yes);
                const no = new Compiler(this.stage, this.shared, new Map(this.locals)); no.emit(stmt.no);
                this.lines.push(`if (${cond}) {\n${yes.lines.join('\n')}\n} else {\n${no.lines.join('\n')}\n}`);
            }
        }
    }
}

export function compileSurface(material, mode = 'surface') {
    const shared = {uniforms: {}, vertex: new Set(), fragment: new Set(), varyings: new Map(), functions: {vertex: new Map(), fragment: new Map()}};
    const fragment = new Compiler('fragment', shared);
    const pieces = {};
    for (const [key, type] of Object.entries({color: 'vec4', opacity: 'float', roughness: 'float', metalness: 'float', emissive: 'vec3', normal: 'vec3', ao: 'float', mask: 'bool'})) {
        if (!material[`${key}Node`]) continue;
        if (mode !== 'surface' && !['color', 'opacity', 'normal', 'mask', ...mode === 'depth' ? ['roughness'] : []].includes(key)) continue;
        if (['shadow', 'velocity'].includes(mode) && key === 'normal') continue;
        if (mode !== 'surface' && key === 'color' && material.colorNode.type !== 'vec4') continue;
        const n = material[`${key}Node`];
        const expr = key === 'color' && n.type === 'vec3' ? `vec4(${fragment.expr(n)}, 1.0)` : fragment.coerce(n, type);
        pieces[key] = {code: fragment.lines.splice(0).join('\n'), expr};
    }
    const vertex = new Compiler('vertex', shared);
    let position;
    if (material.positionNode) position = vertex.coerce(material.positionNode, 'vec3');
    let scale;
    if (material.scaleNode) scale = vertex.coerce(material.scaleNode, 'vec2');
    // A varying can add more varyings while it compiles.
    const varyings = [];
    for (const [name, node] of shared.varyings) varyings.push(`${name} = ${vertex.expr(node)};`);
    const vertexBody = vertex.lines.join('\n');
    const pars = (stage) => [...shared[stage], ...shared.functions[stage].values()].join('\n');
    return {uniforms: shared.uniforms, pieces, position, scale, vertexBody, varyingBody: varyings.join('\n'), vertexPars: pars('vertex'), fragmentPars: pars('fragment')};
}

const hasNodes = (source) => Object.keys(source).some(key => key.endsWith('Node') && source[key] instanceof Node);

const compiledGraphs = new WeakMap();
function compiledGraph(source, mode) {
    let modes = compiledGraphs.get(source);
    if (!modes) compiledGraphs.set(source, modes = new Map());
    if (modes.has(mode)) return modes.get(mode);
    const c = compileSurface(source, mode);
    const names = new Map();
    const counts = {};
    const rename = text => text?.replace(/ny(U|V|T|Fn)(\d+)(_(?:vertex|fragment))?/g, (name, kind, _id, stage = '') => {
        if (!names.has(name)) { counts[kind] = (counts[kind] || 0) + 1; names.set(name, `ny${kind}${counts[kind]}${stage}`); }
        return names.get(name);
    });
    for (const key of ['vertexPars', 'vertexBody', 'varyingBody', 'position', 'scale', 'fragmentPars']) c[key] = rename(c[key]);
    for (const piece of Object.values(c.pieces)) { piece.code = rename(piece.code); piece.expr = rename(piece.expr); }
    c.uniforms = Object.fromEntries(Object.entries(c.uniforms).map(([name, value]) => [rename(name), value]));
    // The program key depends on shader structure, not on the material UUID or uniform values.
    let hash = 2166136261;
    for (const ch of JSON.stringify({...c, uniforms: Object.keys(c.uniforms)})) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    c.key = String(hash >>> 0);
    modes.set(mode, c);
    return c;
}

function patchShader(shader, source, mode = 'surface') {
    if (new URLSearchParams(globalThis.location?.search).has('debug')) console.log('[compile]', mode, source.uuid);
    const c = compiledGraph(source, mode);
    Object.assign(shader.uniforms, c.uniforms);
    shader.vertexShader = `varying vec2 nyUv;\nvarying vec3 nyWorldPosition;\nvarying vec3 nyViewPosition;\nvarying vec3 nyGeometryNormal;\nvec3 nyLocalPosition;\nvec3 nyLocalNormal;\n${c.vertexPars}\n` + shader.vertexShader;
    shader.fragmentShader = `varying vec2 nyUv;\nvarying vec3 nyWorldPosition;\nvarying vec3 nyViewPosition;\nvarying vec3 nyGeometryNormal;\nvec3 nyShadingNormal;\n${c.fragmentPars}\n` + shader.fragmentShader;
    // positionLocal in upstream is after instancing. Apply the instance transform here, exactly once.
    let vertex = `nyUv = uv;\nnyLocalPosition = position;\nnyLocalNormal = normal;\n`;
    if (!source.isCitySprite) vertex += `#ifdef USE_INSTANCING\nnyLocalPosition = (instanceMatrix * vec4(position, 1.0)).xyz;\nnyLocalNormal = mat3(instanceMatrix) * normal;\n#endif\n`;
    vertex += c.vertexBody + '\n' + c.varyingBody + '\n';
    if (c.position) vertex += `nyLocalPosition = ${c.position};\n`;
    vertex += 'nyViewPosition = (modelViewMatrix * vec4(nyLocalPosition, 1.0)).xyz;\nnyWorldPosition = (modelMatrix * vec4(nyLocalPosition, 1.0)).xyz;\nnyGeometryNormal = normalize(normalMatrix * nyLocalNormal);\n';
    shader.vertexShader = shader.vertexShader.replace('void main() {', `void main() {\n${vertex}`);
    if (c.position) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = nyLocalPosition;');
        if (source.isCitySprite) {
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);\nmvPosition.xy += position.xy * ${c.scale || 'vec2(1.0)'};\ngl_Position = projectionMatrix * mvPosition;`);
        } else {
            // The upstream position node already contains the instance transform.
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', 'vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);\ngl_Position = projectionMatrix * mvPosition;');
        }
        shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = nyLocalNormal;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\nnyShadingNormal = normalize(nyGeometryNormal);');
    const p = c.pieces;
    const color = (p.color ? `${p.color.code}\nvec4 nyColor = ${p.color.expr};\ndiffuseColor *= nyColor;\n` : '') + (p.opacity ? `${p.opacity.code}\ndiffuseColor.a *= ${p.opacity.expr};\n` : '') + (p.mask ? `${p.mask.code}\nif (!(${p.mask.expr})) discard;\n` : '') + (source.alphaTestNode ? 'if (diffuseColor.a < 0.5) discard;\n' : '');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `${color}\n#include <alphatest_fragment>`);
    if (mode === 'depth' && p.roughness) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `${p.roughness.code}\n#include <normal_fragment_begin>`);
        shader.fragmentShader = shader.fragmentShader.replace(/gFlags\s*=\s*flags\s*;/, `gFlags = vec4(clamp(${p.roughness.expr}, 0.0525, 1.0), flags.yzw);`);
    }
    if (mode === 'velocity') {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = nyLocalPosition;');
        shader.vertexShader = shader.vertexShader.replace('mvPosition = instanceMatrix * mvPosition;', '');
        shader.vertexShader = 'attribute mat4 nyPreviousMatrix;\nuniform float nyPreviousValid;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('vWorldPositionPrevious = (modelMatrixPrevious * mvPosition).xyz;', `
        vec4 nyPreviousPosition = vec4(nyLocalPosition, 1.0);
        #ifdef USE_INSTANCING
        if (nyPreviousValid > 0.5) nyPreviousPosition = nyPreviousMatrix * inverse(instanceMatrix) * nyPreviousPosition;
        #endif
        vWorldPositionPrevious = (modelMatrixPrevious * nyPreviousPosition).xyz;`);
        shader.fragmentShader = shader.fragmentShader.replace('vec2 velocity = clamp', `vec4 diffuseColor = vec4(1.0);\n${color}\nvec2 velocity = clamp`);
    }
    if (p.normal) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${p.normal.code}\nnormal = normalize(${p.normal.expr});`);
    if (p.roughness) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${p.roughness.code}\nroughnessFactor = clamp(${p.roughness.expr}, 0.04, 1.0);`);
    if (p.metalness) shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${p.metalness.code}\nmetalnessFactor = clamp(${p.metalness.expr}, 0.0, 1.0);`);
    if (p.emissive) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${p.emissive.code}\ntotalEmissiveRadiance += ${p.emissive.expr};`);
    if (p.ao) shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${p.ao.code}\nreflectedLight.indirectDiffuse *= clamp(${p.ao.expr}, 0.0, 1.0);`);
    if (mode === 'surface' && source.isMeshBasicMaterial && !shader.fragmentShader.includes('varying vec3 vViewPosition;')) {
        shader.fragmentShader = 'varying vec3 vViewPosition;\n' + shader.fragmentShader;
        shader.vertexShader = 'varying vec3 vViewPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvViewPosition = -mvPosition.xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\nvec3 normal = normalize(nyGeometryNormal);');
    }
    return c;
}

function cityMaterial(Base, sprite = false) {
    return class extends Base {
        constructor(parameters = {}) {
            super(parameters);
            this.fog = true;
            this.isCityMaterial = true;
            this.isCitySprite = sprite;
            this.registerMaterialExtensions([{
                uuid: `city-surface-${this.uuid}`,
                // The G-buffer gets its own material below; do not attach the surface graph to a shared override.
                isCompatible: (m) => m === this,
                shaderExtender: (shader) => { if (hasNodes(this)) patchShader(shader, this); },
                computeCacheKey: () => hasNodes(this) ? compiledGraph(this, 'surface').key : 'city-plain',
            }]);
        }
    };
}
export const CityStandardMaterial = cityMaterial(THREE.PhysicalMaterial);
export const CityBasicMaterial = cityMaterial(THREE.UnlitMaterial);
export const CitySpriteMaterial = cityMaterial(THREE.UnlitMaterial, true);

// A per-source override keeps the procedural alpha and animated positions identical in the normal/depth buffer.
export function prepareCityBuffers(root, velocityFactory, velocityTemplate) {
    const velocities = new Map();
    const instances = [];
    const buffers = new Map();
    root.traverse((object) => {
        if (!object.isMesh) return;
        const source = Array.isArray(object.material) ? object.material[0] : object.material;
        if (!source?.isCityMaterial || source.transparent) return;
        if (velocityFactory && (hasNodes(source) || object.isInstancedMesh)) {
            let velocity = velocities.get(source);
            if (!velocity) {
                velocity = velocityFactory();
                velocity.allowOverride = false;
                velocity.uniforms.currentProjectionViewMatrix = velocityTemplate.uniforms.currentProjectionViewMatrix;
                velocity.uniforms.lastProjectionViewMatrix = velocityTemplate.uniforms.lastProjectionViewMatrix;
                velocity.extraUniformsToUpload.nyPreviousValid = {value: 0};
                const before = velocity.onBeforeRender.bind(velocity);
                velocity.onBeforeRender = (...args) => { before(...args); velocity.extraUniformsToUpload.nyPreviousValid.value = args[4].userData.cityHasPrevious ? 1 : 0; };
                velocity.onBeforeCompile = shader => patchShader(shader, source, 'velocity');
                velocity.customProgramCacheKey = () => compiledGraph(source, 'velocity').key;
                velocities.set(source, velocity);
            }
            object.userData.cityVelocityMaterial = velocity;
            if (object.isInstancedMesh) {
                const previous = new THREE.InstancedBufferAttribute(object.instanceMatrix.array.slice(), 16);
                object.geometry.setAttribute('nyPreviousMatrix', previous);
                instances.push({object, previous, version: -1});
            }
        }
        if (!(source.positionNode || source.normalNode || source.alphaTestNode || source.opacityNode || source.maskNode || source.roughnessNode || source.colorNode?.type === 'vec4')) return;
        let buffer = buffers.get(source);
        if (!buffer) {
            buffer = new THREE.GBufferMaterial(true, {side: source.side, alphaTest: source.alphaTest || (source.alphaTestNode ? 0.5 : 0)});
            buffer.registerMaterialExtensions([{
                uuid: `city-depth-${source.uuid}`,
                shaderExtender: (shader) => patchShader(shader, source, 'depth'),
                computeCacheKey: () => compiledGraph(source, 'depth').key,
            }]);
            buffers.set(source, buffer);
        }
        object.userData.cityGBufferMaterial = buffer;
        // three.js shadow depth also needs the same vertex and alpha graph.
        const shadow = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking, side: source.side});
        shadow.onBeforeCompile = (shader) => {
            // Depth shaders have no normal chunks, so only evaluate coverage and position.
            patchShader(shader, source, 'shadow');
        };
        shadow.customProgramCacheKey = () => compiledGraph(source, 'shadow').key;
        object.customDepthMaterial = shadow;
    });
    return {buffers, afterFrame() {
        for (const item of instances) {
            if (item.version === item.object.instanceMatrix.version) continue;
            item.previous.array.set(item.object.instanceMatrix.array);
            item.previous.needsUpdate = true;
            item.version = item.object.instanceMatrix.version;
            item.object.userData.cityHasPrevious = true;
        }
    }};
}

export function updateCityUniforms(seconds, renderer) {
    for (const n of storageNodes) {
        if (n.data.version !== n.value.version) { n.data.texture.needsUpdate = true; n.data.version = n.value.version; }
    }
    TSL.time.value = seconds;
    renderer.getDrawingBufferSize(TSL.screenSize.value);
}
