import { CompressedCubeTexture, RGBAFormat, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace } from 'three';

// DDS_HEADER with the legacy D3DFMT_A16B16G16R16F numeric FourCC.
// DDS face order is +X,-X,+Y,-Y,+Z,-Z, with one mip chain per face.
export function parseNativeHDR(buffer) {
  if (buffer.byteLength < 128) throw new Error('Truncated HDR DDS header');
  const header = new DataView(buffer);
  const word = offset => header.getUint32(offset, true);
  if (word(0) !== 0x20534444 || word(4) !== 124 || word(76) !== 32 ||
      !(word(80) & 4) || word(84) !== 113 || (word(112) & 0xfe00) !== 0xfe00 ||
      (word(112) & 0x200000)) throw new Error('Expected six-face RGBA16F DDS cube');

  const size = word(16);
  const levels = word(8) & 0x20000 ? word(28) : 1;
  if (!size || size !== word(12) || levels < 1 || levels > Math.floor(Math.log2(size)) + 1) {
    throw new Error('Invalid HDR DDS dimensions or mip count');
  }
  const faces = [];
  let offset = 128;
  for (let face = 0; face < 6; face++) {
    let width = size;
    const mipmaps = [];
    for (let level = 0; level < levels; level++) {
      const length = width * width * 4;
      if (length > (buffer.byteLength - offset) / 2) throw new Error('Truncated HDR DDS payload');
      mipmaps.push({width, height: width, data: new Uint16Array(buffer, offset, length)});
      offset += length * 2;
      width = Math.max(1, Math.floor(width / 2));
    }
    faces.push({width: size, height: size, mipmaps, format: RGBAFormat});
  }
  if (offset !== buffer.byteLength) throw new Error('Unexpected bytes after HDR DDS cube');

  // Three r183's authored cube-mip upload accepts uncompressed RGBA in this
  // container and calls texSubImage2D with HALF_FLOAT for every face/level.
  const cube = new CompressedCubeTexture(faces, RGBAFormat, HalfFloatType);
  cube.minFilter = levels === 1 ? LinearFilter : LinearMipmapLinearFilter;
  cube.colorSpace = LinearSRGBColorSpace;
  cube.needsUpdate = true;
  return cube;
}
