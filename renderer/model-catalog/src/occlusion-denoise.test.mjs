import assert from 'node:assert/strict';
import test from 'node:test';
import {occlusionDenoiseShader} from './occlusion-denoise.mjs';

const ssao = 'uniform sampler2D aoBuffer;\nvoid mainImage(){float aoLinear=texture2D(aoBuffer,uv).r;}';

test('SSAO denoise keeps depth and normal edge weights', () => {
  const shader = occlusionDenoiseShader(ssao);
  assert.ok(shader.indexOf('uniform sampler2D eveOcclusionGeometry;') > shader.indexOf('uniform sampler2D aoBuffer;'));
  assert.ok(shader.indexOf('eveFilteredOcclusion') < shader.indexOf('void mainImage'));
  assert.match(shader, /eveFilteredOcclusion\(uv\)/);
  assert.match(shader, /smoothstep\(0\.72,0\.98,dot\(centerNormal,sampleNormal\)\)/);
  assert.match(shader, /texture2D\(eveOcclusionGeometry,uv\)/);
  assert.match(shader, /cameraNear\*cameraFar/);
  assert.match(shader, /depthDx=dFdx\(centerDepth\)/);
  assert.match(shader, /expectedDepth=centerDepth\+depthDx\*float\(x\)\+depthDy\*float\(y\)/);
  assert.match(shader, /for\(int y=-4;y<=4;\+\+y\)/);
});

test('SSAO denoise is idempotent and leaves unknown shaders untouched', () => {
  const shader = occlusionDenoiseShader(ssao);
  assert.equal(occlusionDenoiseShader(shader), shader);
  assert.equal(occlusionDenoiseShader('unknown'), 'unknown');
});
