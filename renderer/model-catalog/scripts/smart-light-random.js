// RandomHash in CCP Trinity at f644516, EveSmartLightAttributeModifierExpressionBucket.cpp:28.
// Viewer implementation of the standard seed_seq and minstd_rand0 operations for
// the two input words. A per-bucket Web seed takes the place of the C++ address.
const floatBits = new DataView(new ArrayBuffer(4));
const modulus = 2147483647;
export function randomHash(low, high, value, bucketSeed) {
  floatBits.setFloat32(0, value, true);
  const seeds = [floatBits.getUint32(0, true), bucketSeed];
  // minstd_rand0 requests four seed_seq words and seeds itself with the fourth.
  const words = new Uint32Array(4).fill(0x8b8b8b8b);
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4, second = (k + 2) % 4;
    const x = words[k] ^ words[next] ^ words[(k + 3) % 4];
    const mix = Math.imul(1664525, x ^ (x >>> 27));
    const sum = mix + (k === 0 ? seeds.length : k + (seeds[k - 1] ?? 0));
    words[next] += mix;
    words[second] += sum;
    words[k] = sum;
  }
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4, second = (k + 2) % 4;
    const x = (words[k] + words[next] + words[(k + 3) % 4]) >>> 0;
    const mix = Math.imul(1566083941, x ^ (x >>> 27));
    words[next] ^= mix;
    words[second] ^= mix - k;
    words[k] = mix - k;
  }
  const initial = words[3] % modulus || 1;
  const draw = initial * 16807 % modulus;
  const unit = Math.fround((draw - 1) / (modulus - 1));
  return Math.fround(Math.fround(low) + Math.fround(unit * Math.fround(Math.fround(high) - Math.fround(low))));
}
