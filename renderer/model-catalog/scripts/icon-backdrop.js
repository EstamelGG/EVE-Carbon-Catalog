import {WebGLRenderer, Scene, Mesh, PlaneGeometry, ShaderMaterial, OrthographicCamera,
  Matrix3, Matrix4, Euler} from 'three';
import {fileCubeRotation} from './skybox-orientation.js';

export async function renderIconBackdrop({entry, texture}, width, height, profile = 'ship') {
  const sampling = entry.iconSampling?.[profile];
  if (!sampling || sampling.version !== 1 || sampling.transfer !== 'linear-to-srgb' || sampling.gain !== 1)
    throw Error('Missing or unsupported icon background sampling profile');
  const view = sampling.view;
  const rotation = new Matrix3();
  let fov = sampling.fov ?? 30, mirror = sampling.mirror ?? -1;
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
