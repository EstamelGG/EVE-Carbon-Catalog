import {
  CompressedTextureLoader, RGBAFormat, RGBA_BPTC_Format, RED_RGTC1_Format,
  RGBA_S3TC_DXT1_Format, RGBA_S3TC_DXT5_Format,
} from 'three';

// BC4 has an eight-entry codebook and sixteen little-endian 3-bit indices.
// https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression
function decodeChannel(data, offset, palette, samples) {
  const a = data[offset], b = data[offset + 1];
  palette[0] = a;
  palette[1] = b;
  const divisor = a > b ? 7 : 5;
  // OpenImageIO 3.0.9.0, src/dds.imageio/bcdec.h, bcdec__smooth_alpha_block.
  // This is the integer interpolation used by the published Blender decode.
  for (let i = 1; i < divisor; i++)
    palette[i + 1] = Math.floor(((divisor - i) * a + i * b + 1) / divisor);
  if (a <= b) {
    palette[6] = 0;
    palette[7] = 255;
  }
  for (let group = 0; group < 2; group++) {
    const p = offset + 2 + group * 3;
    let indices = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16);
    for (let i = 0; i < 8; i++, indices >>>= 3) samples[group * 8 + i] = palette[indices & 7];
  }
}

// The existing material samplers expect luminance as RRR1 and Blender's
// tangent-space normal as XYZ1. Native WebGL RGTC supplies R001 or RG01.
function expandChannels(data, width, height, normal) {
  const rgba = new Uint8Array(width * height * 4);
  const palette = new Uint8Array(8), red = new Uint8Array(16), green = new Uint8Array(16);
  let offset = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      decodeChannel(data, offset, palette, red);
      if (normal) decodeChannel(data, offset + 8, palette, green);
      offset += normal ? 16 : 8;
      for (let row = 0; row < Math.min(4, height - y); row++) {
        for (let col = 0; col < Math.min(4, width - x); col++) {
          const i = row * 4 + col, dst = ((y + row) * width + x + col) * 4;
          rgba[dst] = red[i];
          rgba[dst + 1] = normal ? green[i] : red[i];
          if (normal) {
            // OpenImageIO 3.0.9.0 ddsinput.cpp, ComputeNormalZ: truncate at assignment.
            const nx = red[i] * (2 / 255) - 1, ny = green[i] * (2 / 255) - 1;
            rgba[dst + 2] = (Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + 1) * 127.5;
          } else rgba[dst + 2] = red[i];
          rgba[dst + 3] = 255;
        }
      }
    }
  }
  return rgba;
}

export class SurfaceDDSLoader extends CompressedTextureLoader {
  constructor(manager, redOnly = false) {
    super(manager);
    this.redOnly = redOnly;
  }

  parse(buffer) {
    const bytes = new Uint8Array(buffer), header = new DataView(buffer);
    const uint32 = offset => header.getUint32(offset, true);
    if (bytes.length < 128 || uint32(0) !== 0x20534444 || uint32(4) !== 124 ||
        uint32(76) !== 32 || (uint32(112) & 0x200200))
      throw new Error('Expected a single 2D DDS surface');
    const width = uint32(16), height = uint32(12), mipmapCount = Math.max(1, uint32(28));
    if (!width || !height || mipmapCount > 1 + Math.floor(Math.log2(Math.max(width, height))))
      throw new Error('Invalid DDS dimensions or mip count');
    let code = String.fromCharCode(...bytes.subarray(84, 88)), offset = 128;
    if (code === 'DX10') {
      if (bytes.length < 148 || uint32(132) !== 3 || (uint32(136) & 4) || uint32(140) !== 1)
        throw new Error('Expected a single DX10 2D DDS surface');
      code = ({80:'ATI1', 83:'ATI2', 98:'BC7', 99:'BC7'})[uint32(128)];
      offset += 20;
    }
    const format = ({DXT1:RGBA_S3TC_DXT1_Format, DXT5:RGBA_S3TC_DXT5_Format,
      BC7:RGBA_BPTC_Format, ATI1:this.redOnly ? RED_RGTC1_Format : RGBAFormat, ATI2:RGBAFormat})[code];
    if (!format) throw new Error('Unsupported surface DDS format ' + code);
    const blockBytes = code === 'DXT1' || code === 'ATI1' ? 8 : 16;
    const mipmaps = [];
    let w = width, h = height;
    for (let i = 0; i < mipmapCount; i++) {
      const end = offset + Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
      if (end > bytes.length) throw new Error('Truncated DDS mip ' + i);
      const packed = bytes.subarray(offset, end);
      const data = format === RGBAFormat ? expandChannels(packed, w, h, code === 'ATI2') : packed;
      mipmaps.push({width:w, height:h, data});
      offset = end;
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
    return {width, height, mipmapCount, mipmaps, format, isCubemap:false};
  }
}

export function surfaceDDSPlugin(parser) {
  const name = 'MSFT_texture_dds';
  return {
    name,
    loadTexture(index) {
      const source = parser.json.textures[index].extensions?.[name]?.source;
      if (source === undefined) return null;
      return parser.loadTextureImage(index, source, new SurfaceDDSLoader(parser.options.manager));
    },
  };
}
