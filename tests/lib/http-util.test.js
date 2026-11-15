import system from 'system';

import {isSuccess, bodyText} from '../../lib/http-util.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';
import {res} from '../_harness.js';

describe('isSuccess', () => {
    it('is 2xx only', () => assertDeepEqual([199, 200, 204, 299, 300, 404].map(isSuccess), [false, true, true, true, false, false]));
});

describe('bodyText', () => {
    it('decodes the body', () => assertEqual(bodyText(res(500, 'oops')), 'oops'));
    it('is empty when the body is absent', () => {
        assertEqual(bodyText({bodyBytes: null}), '');
        assertEqual(bodyText({}), '');
    });
});

system.exit(summary());
