import {distantSkyProjection} from './skybox-orientation.js';
import {
  CustomBlending, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, OneFactor, ShaderMaterial, ZeroFactor,
} from 'three';

// Packed scenes can omit values supplied by the EveStarfield constructor.
const generatorDefaults = {
  minDist: 100, maxDist: 300, minFlashRate: .5, maxFlashRate: 1, minFlashIntensity: 0,
};

// CCP Trinity f644516: TriMath.cpp::TriRand/TriRandInt and EveStarfield.cpp::GenerateStar.
// The generator is reseeded for each field, so a thumbnail never affects another viewer.
export function starfieldGeometry(settings) {
  const count = Math.max(0, settings.numStars ?? 1500);
  const centers = new Float32Array(count * 3), flash = new Float32Array(count * 4);
  const tiles = new Uint8Array(count);
  const f = Math.fround;
  let seed = ((settings.seed ?? 0) >>> 0) % 714025;
  const step = () => (seed = (((seed << 12) + 150889) >>> 0) % 714025);
  const random = () => f(step() / 714025);
  const parameters = {...generatorDefaults, ...settings};
  for (const key of Object.keys(generatorDefaults))
    if (!Number.isFinite(parameters[key])) throw Error('Invalid starfield parameter: ' + key);
  const {minDist: near, maxDist: far, minFlashRate: low, maxFlashRate: high, minFlashIntensity: minimum} = parameters;
  for (let i = 0; i < count; i++) {
    const angle = f(f(random() * 2) * f(Math.PI)), z = f(f(random() - .5) * 2);
    const distance = random();
    const radius = f(near + f(f(distance * distance) * f(far - near)));
    const ring = f(radius * f(Math.sqrt(f(1 - f(z * z)))));
    centers.set([ring * f(Math.cos(angle)), ring * f(Math.sin(angle)), radius * z], i * 3);
    const color = random(), intensity = f(f(random() * f(1 - minimum)) + minimum);
    const phase = random(), rate = f(f(random() * f(high - low)) + low);
    flash.set([color, intensity, phase, rate], i * 4);
    tiles[i] = Math.floor(4 * step() / 714025);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-.5,.5,0, .5,.5,0, .5,-.5,0, -.5,-.5,0], 3));
  geometry.setIndex([0,2,1, 0,3,2]);
  geometry.setAttribute('starPosition', new InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('starFlash', new InstancedBufferAttribute(flash, 4));
  geometry.setAttribute('starTile', new InstancedBufferAttribute(tiles, 1));
  geometry.instanceCount = count;
  return geometry;
}

// The published EveStarfield.fxh specifies vertex inputs. The screen footprint,
// flash waveform and photometric response below are preview choices. A raised
// cosine crossfades from the minimum intensity to each star's individual peak.
// The one-unit camera-facing square lies on the star's authored distance shell.
export function equipmentStarfield(settings = {}, atlas = null, palette = null) {
  const parameters = settings.effect?.parameters || {};
  const material = new ShaderMaterial({
    depthTest:true, depthWrite:false, side:DoubleSide, forceSinglePass:true,
    blending:CustomBlending, blendSrc:OneFactor, blendDst:OneFactor,
    blendSrcAlpha:ZeroFactor, blendDstAlpha:OneFactor,
    uniforms:{
      time:{value:0}, atlas:{value:atlas}, palette:{value:palette},
      minIntensity:{value:parameters.MinIntensity?.[0] ?? 1.5},
      maxIntensity:{value:parameters.MaxIntensity?.[0] ?? 2.5},
    },
    defines: atlas && palette ? {STAR_TEXTURES:1} : {},
    vertexShader:`attribute vec3 starPosition; attribute vec4 starFlash; attribute float starTile;
      uniform float time,minIntensity,maxIntensity; varying vec2 spriteUV,atlasUV; varying float colorIndex,gain;
      ${distantSkyProjection}
      void main(){
        spriteUV=vec2(position.x+.5,.5-position.y);
        atlasUV=(vec2(mod(starTile,2.),floor(starTile/2.))+spriteUV)*.5;
        colorIndex=starFlash.x;
        float wave=.5+.5*cos(6.2831853*(starFlash.z+time*starFlash.w));
        gain=mix(minIntensity,mix(minIntensity,maxIntensity,starFlash.y),wave);
        vec3 center=mat3(viewMatrix)*starPosition;
        gl_Position=projectDistantSky(center+vec3(position.xy,0.));
      }`,
    fragmentShader:`uniform sampler2D atlas,palette; varying vec2 spriteUV,atlasUV; varying float colorIndex,gain;
      void main(){
        #ifdef STAR_TEXTURES
          vec3 light=texture2D(palette,vec2(colorIndex,.5),-1.).rgb*texture2D(atlas,atlasUV,-1.).r;
        #else
          vec2 offset=spriteUV-.5;
          vec3 light=vec3(exp(-dot(offset,offset)*55.));
        #endif
        gl_FragColor=vec4(light*gain,0.);
      }`,
  });
  const stars = new Mesh(starfieldGeometry(settings), material);
  stars.name = 'Equipment preview starfield';
  stars.frustumCulled = false;
  // Native draws background -> additive stars -> scene geometry.
  stars.renderOrder = -1000;
  stars.visible = settings.display !== false && settings.effect !== null && stars.geometry.instanceCount > 0;
  stars.userData.eveBloomEmission = false;
  return stars;
}
