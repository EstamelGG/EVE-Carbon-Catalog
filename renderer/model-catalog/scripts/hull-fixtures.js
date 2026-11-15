import {DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader} from 'three';

function saturated(color, amount = 1) {
  const luminance = color[0]*0.299 + color[1]*0.587 + color[2]*0.114;
  return color.map((v,i)=>i===3?v:luminance+(v-luminance)*amount);
}

export async function installHullFixtures(data, resources, group, images = {}) {
  const lights=[], meshes=[];
  const visible=new Set(data.fixtureVisibility);
  const textures=new Map();
  const bannerNames=['AllianceLogo','CorpLogo','CeoPortrait','VerticalBanner','HorizontalBanner',
    'TargetSystemAllianceLogo','TargetSystemVerticalBanner','TargetSystemHorizontalBanner','TargetSystemInfo0',
    'TargetSystemInfo1','TargetSystemInfo2','TargetSystemInfo3','TargetSystemInfo4','TargetSystemStatus',
    'CurrentSystemAllianceLogo','CurrentSystemVerticalBanner','CurrentSystemHorizontalBanner','PublicityPoster',
    'PublicityPortrait','RecruitmentInformation0','RecruitmentInformation1','RecruitmentInformation2',
    'RecruitmentInformation3','RecruitmentInformation4'];
  for(const item of data.fixtures||[]){
    if(!visible.has(item.gate))continue;
    const transform={translation:item.position,rotation:item.rotation};
    const bone=item.boneIndex??item.bone;
    if(bone>=0)transform.transformModifiers=[{type:'trinity.EveChildModifierAttachToBone',boneIndex:bone}];
    if(item.field==='lightSets'){
      const color=data.fixtureColors[item.lightColor??0];
      if(color)lights.push({...item,color,spot:item.type===2,position:[0,0,0],transforms:[transform]});
    }else if(item.field==='hazeSets'){
      const color=data.fixtureColors[item.colorType??0];
      if(!color)continue;
      meshes.push({haze:true,name:item.name||'Hull haze',transforms:[{...transform,scaling:item.scaling}],
        material:{shader:'hazespherical.fx',textures:{},parameters:{
          HazeControl:[item.hazeFalloff??6,item.sourceSize??0.2,item.sourceBrightness??2,Number(!!item.boosterGainInfluence)],
          HazeColor:saturated(color,item.saturation).map(v=>v*(item.hazeBrightness??1))}}});
      const scale=Math.max(...(item.scaling||[1,1,1]));
      for(const light of item.lights||[])lights.push({...light,position:light.translation,transforms:[transform],
        color:saturated(color,light.saturation),radius:scale*(light.outerScaleMultiplier??2),
        innerRadius:scale*(light.innerScaleMultiplier??1),brightness:light.intensity??1});
    }else{
      const url=images[bannerNames[item.usage??0]+'ResPath'];
      if(!url)continue;
      if(!textures.has(url))textures.set(url,new TextureLoader().loadAsync(url).then(texture=>{
        texture.colorSpace=SRGBColorSpace;return resources.own(texture);
      }));
      const material=resources.own(new MeshBasicMaterial({map:await textures.get(url),transparent:true,depthWrite:false,side:DoubleSide}));
      const banner=new Mesh(resources.own(new PlaneGeometry(1,1)),material);
      banner.position.fromArray(item.position);if(item.rotation)banner.quaternion.fromArray(item.rotation);
      if(item.scaling)banner.scale.fromArray(item.scaling);
      banner.name=item.name;group.add(banner);
    }
  }
  return {lights,meshes};
}
