// 角色材质（接近 3D 动画电影的质感）：
//  - 包裹光照（明暗交界柔和）+ 交界处暖色透光（仿次表面散射）
//  - 菲涅尔轮廓光、柔和高光
//  - 毛发：多层外壳（shell fur）+ 发丝明暗条纹；衣物：织物纹理；金属：高光
import * as THREE from 'three';

const WRAP_PHONG = THREE.ShaderChunk.lights_phong_pars_fragment
  .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', `float rawNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( ( rawNL + uWrap ) / ( 1.0 + uWrap ) );`)
  .replace('vec3 irradiance = dotNL * directLight.color;', `vec3 irradiance = dotNL * directLight.color;
	irradiance += directLight.color * uSSS * smoothstep( 0.45, 0.0, abs( rawNL + 0.05 ) ) * 0.6;`);

const NOISE = `
float hash13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
vec3 hash33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
`;

const RIM = new THREE.Color(0xffd8b0);

// kind: 'fur' | 'shell' | 'cloth' | 'metal' | 'bone' | 'rock' | 'slime' | 'ghost' | 'skin'
const SPEC = { metal: [0x9aa4ae, 70], cloth: [0x151515, 8], bone: [0x3a3630, 24], rock: [0x121212, 5], slime: [0xffffff, 110], ghost: [0x88aaff, 40], skin: [0x3a2a24, 30] };
function make(kind, layer = 0) {
  const sp = SPEC[kind] || [0x221a14, 16];
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: new THREE.Color(sp[0]), shininess: sp[1] });
  if (kind === 'slime') { m.transparent = true; m.opacity = 0.84; }
  if (kind === 'ghost') { m.transparent = true; m.opacity = 0.6; m.depthWrite = false; m.side = THREE.DoubleSide; m.emissive = new THREE.Color(0x1a2a4a); }
  m.userData.shared = true;
  const warm = kind === 'fur' || kind === 'shell' || kind === 'skin';
  const uni = {
    uWrap: { value: kind === 'metal' || kind === 'rock' ? 0.15 : kind === 'slime' ? 0.7 : 0.45 },
    uSSS: { value: warm ? new THREE.Color(0.32, 0.12, 0.05) : kind === 'slime' ? new THREE.Color(0.1, 0.35, 0.1) : kind === 'bone' ? new THREE.Color(0.14, 0.1, 0.05) : new THREE.Color(0.08, 0.05, 0.04) },
    uLayer: { value: layer },
    uLen: { value: 0.022 },
    uRim: { value: RIM },
    uRimK: { value: kind === 'metal' ? 0.25 : kind === 'ghost' ? 0.6 : kind === 'slime' ? 0.9 : kind === 'rock' ? 0.2 : 0.4 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute vec3 aRest;\nattribute float aFur;\nuniform float uLayer;\nuniform float uLen;\nvarying vec3 vRest;\nvarying float vFur;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vRest = aRest; vFur = aFur;
        ${kind === 'shell' ? 'transformed += normalize( objectNormal ) * uLayer * uLen * aFur; transformed.y -= uLayer * uLayer * 0.006 * aFur;' : ''}`);
    sh.fragmentShader = 'uniform float uWrap;\nuniform vec3 uSSS;\nuniform float uLayer;\nuniform vec3 uRim;\nuniform float uRimK;\nvarying vec3 vRest;\nvarying float vFur;\n' + NOISE +
      sh.fragmentShader
        .replace('#include <lights_phong_pars_fragment>', WRAP_PHONG)
        .replace('#include <color_fragment>', `#include <color_fragment>
        ${kind === 'fur' ? `{
          // 发丝明暗：沿竖直方向拉长的噪声条纹
          vec3 q = vRest * vec3( 140.0, 45.0, 140.0 );
          float n = hash13( floor( q ) ) * 0.6 + hash13( floor( q * 0.5 ) ) * 0.4;
          diffuseColor.rgb *= mix( 1.0, 0.86 + 0.24 * n, vFur );
        }` : ''}
        ${kind === 'shell' ? `{
          // 外壳毛发：每层只保留发丝截面，越外层越细，根部更暗
          vec3 p = vRest * 115.0;
          vec3 c = floor( p );
          vec3 r = hash33( c ) * 0.6 + 0.2;
          float d = length( fract( p ) - r );
          if ( d > 0.62 * ( 1.0 - uLayer ) || vFur < uLayer * 0.95 ) discard;
          diffuseColor.rgb *= mix( 0.8, 1.12, uLayer );
        }` : ''}
        ${kind === 'rock' ? `{
          vec3 q = vRest * 9.0;
          float n = hash13( floor( q ) ) * 0.5 + hash13( floor( q * 2.7 ) ) * 0.3 + hash13( floor( q * 7.0 ) ) * 0.2;
          diffuseColor.rgb *= 0.78 + 0.35 * n;
        }` : ''}
        ${kind === 'bone' ? `{
          vec3 q = vRest * 60.0;
          diffuseColor.rgb *= 0.92 + 0.1 * hash13( floor( q ) );
        }` : ''}
        ${kind === 'cloth' ? `{
          vec3 q = vRest * 260.0;
          float w = sin( q.x + q.z ) * sin( q.y * 1.3 );
          diffuseColor.rgb *= 0.94 + 0.06 * w;
        }` : ''}`)
        .replace('#include <opaque_fragment>', `{
          vec3 V = normalize( vViewPosition );
          float fr = pow( 1.0 - clamp( dot( normal, V ), 0.0, 1.0 ), 3.0 );
          outgoingLight += uRim * fr * uRimK * ( 0.5 + 0.5 * diffuseColor.rgb );
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'char_' + kind + (kind === 'shell' ? '' : '');
  if (kind === 'shell') { m.userData.layer = uni.uLayer; }
  return m;
}

const cache = {};
export function charMat(kind) { return cache[kind] || (cache[kind] = make(kind)); }
// 每个实例独立的材质（需要单独改透明度，如怨灵隐身）
export function charMatOwn(kind) { const m = make(kind); m.userData.shared = false; return m; }
// 毛发外壳材质：每层一个（层号用 uniform，共享同一个 shader 程序）
const shells = [];
export function shellMats(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const key = i + '/' + n;
    if (!shells[key]) shells[key] = make('shell', i / (n + 0.5));
    out.push(shells[key]);
  }
  return out;
}
let eyeM = null;
export function eyeMat() {
  if (!eyeM) { eyeM = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 120 }); eyeM.userData.shared = true; }
  return eyeM;
}
let rigidM = null;
export function rigidMat() {
  if (!rigidM) {
    rigidM = make('metal');
    rigidM.specular.setHex(0x6a6a6a); rigidM.shininess = 40;
  }
  return rigidM;
}
