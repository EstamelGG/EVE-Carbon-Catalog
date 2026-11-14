import { previewRandom } from './preview-random.js';

/*! Particle turbulence. CCP ccpwgl supplies the lookup and XYZ accumulator.
Trinity Noise4D and CarbonEngineJS identify the two upper-y/upper-z corners.
https://github.com/ccpgames/ccpwgl/blob/c31632d0fb7d9f0be19a5eb5452e5d5f74a914c5/src/math/noise.js
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2ParticleTurbulenceForce.cpp
https://github.com/carbonenginejs/runtime/blob/d605cf6281ca9e1bcbe5195f83a16378d8812947/src/global/math/noise.js
Copyright © 2015 CCP hf.
Copyright © 2011 CCP ehf.
Copyright (c) 2026 Fenris Creations
Copyright (c) 2026 CarbonEngineJS contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
THERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.

*/
// Local array adapter for the public JS vec3.lerp operation. Each intermediate
// is stored in a Float32Array, as in the upstream gl-matrix implementation.
function lerp3(out, a, b, t)
{
    for (let axis = 0; axis < 3; axis++) out[axis] = a[axis] + t * (b[axis] - a[axis]);
    return out;
}
export const noise = {};

/**
 * Generates turbulent noise
 *
 * @param {vec4} out
 * @param {number} pos_0
 * @param {number} pos_1
 * @param {number} pos_2
 * @param {number} pos_3
 * @param {number} power
 * @returns {vec4} out
 */
noise.turbulence = (function()
{
    const
        s_noiseLookup = [],
        s_permutations = [],
        s_globalNoiseTemps = [];

    let s_initialized = false;

    /**
     * Initializes noise
     */
    function initialize()
    {
        // The original catalog supplied this private sequence to ccpwgl's
        // Math.random call sites. Keep its seed and x/y/z/w draw order.
        const random = previewRandom(7391);
        for (let i = 0; i < 256; i++)
        {
            s_noiseLookup[i] = new Float32Array([random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5]);
            s_permutations[i] = i;
        }

        let i = 256;
        while (--i)
        {
            const
                tmp = s_permutations[i],
                index = Math.floor(random() * 256);

            s_permutations[i] = s_permutations[index];
            s_permutations[index] = tmp;
        }

        for (let i = 0; i < 256; i++)
        {
            s_permutations[256 + i] = s_permutations[i];
            s_noiseLookup[256 + i] = s_noiseLookup[i];
            s_noiseLookup[256 * 2 + i] = s_noiseLookup[i];
        }

        for (let i = 0; i < 15; ++i)
        {
            s_globalNoiseTemps[i] = new Float32Array(3);
        }

        s_initialized = true;
    }

    return function turbulence(out, pos_0, pos_1, pos_2, pos_3, power)
    {
        if (!s_initialized) initialize();

        pos_0 += 4096;
        pos_1 += 4096;
        pos_2 += 4096;
        pos_3 += 4096;

        let a_0 = Math.floor(pos_0),
            a_1 = Math.floor(pos_1),
            a_2 = Math.floor(pos_2),
            a_3 = Math.floor(pos_3);

        const
            t_0 = pos_0 - a_0,
            t_1 = pos_1 - a_1,
            t_2 = pos_2 - a_2,
            t_3 = pos_3 - a_3;

        a_0 &= 255;
        a_1 &= 255;
        a_2 &= 255;
        a_3 &= 255;

        const
            b_0 = a_0 + 1,
            b_1 = a_1 + 1,
            b_2 = a_2 + 1,
            b_3 = a_3 + 1;

        const
            i = s_permutations[a_0],
            j = s_permutations[b_0];

        const
            b00 = s_permutations[i + a_1],
            b10 = s_permutations[j + a_1],
            b01 = s_permutations[i + b_1],
            b11 = s_permutations[j + b_1];

        let c00 = lerp3(s_globalNoiseTemps[0], s_noiseLookup[b00 + a_2 + a_3], s_noiseLookup[b10 + a_2 + a_3], t_0);
        let c10 = lerp3(s_globalNoiseTemps[1], s_noiseLookup[b01 + a_2 + a_3], s_noiseLookup[b11 + a_2 + a_3], t_0);
        let c01 = lerp3(s_globalNoiseTemps[2], s_noiseLookup[b00 + b_2 + a_3], s_noiseLookup[b10 + b_2 + a_3], t_0);
        let c11 = lerp3(s_globalNoiseTemps[3], s_noiseLookup[b01 + b_2 + a_3], s_noiseLookup[b11 + b_2 + a_3], t_0);
        let c0 = lerp3(s_globalNoiseTemps[4], c00, c10, t_1);
        let c1 = lerp3(s_globalNoiseTemps[5], c01, c11, t_1);
        const c = lerp3(s_globalNoiseTemps[6], c0, c1, t_2);

        c00 = lerp3(s_globalNoiseTemps[7], s_noiseLookup[b00 + a_2 + b_3], s_noiseLookup[b10 + a_2 + b_3], t_0);
        c10 = lerp3(s_globalNoiseTemps[8], s_noiseLookup[b01 + a_2 + b_3], s_noiseLookup[b11 + a_2 + b_3], t_0);
        c01 = lerp3(s_globalNoiseTemps[9], s_noiseLookup[b00 + b_2 + b_3], s_noiseLookup[b10 + b_2 + b_3], t_0);
        c11 = lerp3(s_globalNoiseTemps[10], s_noiseLookup[b01 + b_2 + b_3], s_noiseLookup[b11 + b_2 + b_3], t_0);
        c0 = lerp3(s_globalNoiseTemps[11], c00, c10, t_1);
        c1 = lerp3(s_globalNoiseTemps[12], c01, c11, t_1);
        const d = lerp3(s_globalNoiseTemps[13], c0, c1, t_2);
        const r = lerp3(s_globalNoiseTemps[14], c, d, t_3);

        out[0] += r[0] * power;
        out[1] += r[1] * power;
        out[2] += r[2] * power;
        return out;
    };
})();
