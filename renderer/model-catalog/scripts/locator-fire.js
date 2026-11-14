import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';
import {AdditiveBlending, CanvasTexture, Group, Sprite, SpriteMaterial} from 'three';
import {createDamageToggle} from './damage-toggle.mjs';
import {ambientAnimationLoop} from './page-activity.js';

export function locatorFire(viewer, locators, radius) {
  const scene = viewer[$scene];
  return createDamageToggle(() => {
    const points = locators.slice();
    const count = 1 + Math.floor(Math.random() * points.length);
    const canvas = viewer.ownerDocument.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const glow = ctx.createRadialGradient(32,36,0,32,36,28);
    glow.addColorStop(0,'#fff3ad');
    glow.addColorStop(.22,'#ffbe35');
    glow.addColorStop(.55,'rgba(255,73,4,.78)');
    glow.addColorStop(1,'rgba(170,25,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0,0,64,64);
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({map:texture, transparent:true, depthWrite:false, blending:AdditiveBlending});
    const group = new Group();
    for (let i=0; i<count; i++) {
      const j = i + Math.floor(Math.random() * (points.length-i));
      [points[i],points[j]] = [points[j],points[i]];
      const sprite = new Sprite(material);
      sprite.position.fromArray(points[i].position);
      sprite.userData.phase = Math.random()*Math.PI*2;
      group.add(sprite);
    }
    scene.model.add(group);
    const animate = time => {
      for (const sprite of group.children) {
        const phase = sprite.userData.phase;
        const size = radius * (.058 + .012*Math.sin(time*.009+phase) + .006*Math.cos(time*.017+phase));
        sprite.scale.set(size, size*1.35, 1);
      }
      scene.queueRender();
    };
    const loop = ambientAnimationLoop(scene, animate);
    animate(0);
    return {
      setVisible(value) { group.visible=value; if(value) loop.start(); else loop.stop(); scene.queueRender(); },
      dispose() { loop.stop(); group.removeFromParent(); texture.dispose(); material.dispose(); scene.queueRender(); },
    };
  });
}
