import system from 'system';

import {rgbToHex} from '../lib/color.js';
import {describe, it, assertEqual, summary} from './_assert.js';

describe('rgbToHex', () => {
    it('all-zero → #000000', () => {
        assertEqual(rgbToHex(0, 0, 0), '#000000');
    });

    it('all-one → #ffffff', () => {
        assertEqual(rgbToHex(1, 1, 1), '#ffffff');
    });

    it('0.5 rounds to 80 (128)', () => {
        assertEqual(rgbToHex(0.5, 0.5, 0.5), '#808080');
    });

    it('mixes channels independently', () => {
        assertEqual(rgbToHex(1, 0, 0), '#ff0000');
        assertEqual(rgbToHex(0, 1, 0), '#00ff00');
        assertEqual(rgbToHex(0, 0, 1), '#0000ff');
    });

    it('matches an Adwaita default (green #2ec27e)', () => {
        // 0x2e=46, 0xc2=194, 0x7e=126 as 0–1 floats round-trip back to hex.
        assertEqual(rgbToHex(46 / 255, 194 / 255, 126 / 255), '#2ec27e');
    });

    it('pads single-hex-digit channels', () => {
        // 1/255 → 1 → '01'
        assertEqual(rgbToHex(1 / 255, 1 / 255, 1 / 255), '#010101');
    });

    it('clamps out-of-range inputs to [0,1]', () => {
        assertEqual(rgbToHex(-0.5, 2, 1.0001), '#00ffff');
    });
});

system.exit(summary());
