import {WebGLRenderer, Scene, Mesh, PlaneGeometry, ShaderMaterial, OrthographicCamera,
  Matrix3, Matrix4, Euler} from 'three';
import {fileCubeRotation} from './skybox-orientation.js';

// Empirical fits to the accepted icon-background study, not recovered client
// constants. Shared by race/template; no per-TypeID background images.
const views = {
  ship_amarr_cube: [55.4375832312, -25.4393313607, 263.4479871399, 20.3943527107, 1],
  ship_caldari_cube: [119.0363599819, -13.8428448811, 37.4501642589, 22.8046484913, -1],
  ship_gallente_cube: [138.1509058628, -28.3816697835, 331.7254084452, 40.1852878742, -1],
  ship_minmatar_cube: [192.2728397289, -17.8485887428, 5.6224045544, 30.5103054465, -1],
};
const amarrStation = [288.5769809445, 10.0047053837, 7.531543703, 49.379570027, -1];

export async function renderIconBackdrop({entry, texture}, width, height, profile) {
  const key = entry.url.split('/').pop().replace(/\.dds$/i, '');
  const view = key === 'ship_amarr_cube' && profile === 'station' ? amarrStation : views[key];
  const rotation = new Matrix3();
  let fov = 30, mirror = -1;
  if (view) {
    const [yaw, pitch, roll] = view.map(value => value * Math.PI / 180);
    rotation.setFromMatrix4(new Matrix4().makeRotationFromEuler(new Euler(pitch, yaw, roll, 'YXZ')));
    [, , , fov, mirror] = view;
  } else {
    // Uncalibrated templates keep the authored rotation and a fixed lens.
    fileCubeRotation(rotation, entry.rotation);
  }
  const renderer = new WebGLRenderer({antialias:false, preserveDrawingBuffer:true});
  renderer.setSize(width, height, false);
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({toneMapped:false, depthTest:false, depthWrite:false,
    uniforms:{sky:{value:texture}, rotation:{value:rotation},
      lens:{value:Math.tan(fov * Math.PI / 360)}, aspect:{value:width/height}, mirror:{value:mirror}},
    vertexShader:'varying vec2 screen;void main(){screen=uv*2.-1.;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`precision highp float;
      varying vec2 screen;uniform samplerCube sky;uniform mat3 rotation;
      uniform float lens,aspect,mirror;
      void main(){
        vec3 ray=rotation*vec3(screen.x*lens*aspect*mirror,screen.y*lens,-1.);
        vec3 c=max(textureCube(sky,ray).rgb,vec3(0.));
        // The accepted full-resolution HDR reference uses unit gain and only
        // the sRGB transfer function. No hull exposure or tone-map curve.
        c=mix(1.055*pow(c,vec3(1./2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));
        gl_FragColor=vec4(clamp(c,0.,1.),1.);
      }`});
  try {
    const scene = new Scene();scene.add(new Mesh(geometry,material));
    renderer.render(scene,new OrthographicCamera(-1,1,1,-1,0,1));
    return await createImageBitmap(renderer.domElement);
  } finally {
    material.dispose();geometry.dispose();renderer.dispose();renderer.forceContextLoss();
  }
}
