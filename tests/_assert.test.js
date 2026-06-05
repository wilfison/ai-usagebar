import system from 'system';

import {describe, it, assertEqual, assertDeepEqual, assertThrows, summary} from './_assert.js';

function expectThrow(fn) {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected throw');
}

describe('assertEqual', () => {
    it('does not throw on equal primitives', () => {
        assertEqual(1, 1);
        assertEqual('a', 'a');
    });

    it('throws on mismatch with both values in the message', () => {
        const e = expectThrow(() => assertEqual(1, 2));
        if (!e.message.includes('1') || !e.message.includes('2'))
            throw new Error(`message lacks values: ${e.message}`);
    });
});

describe('assertDeepEqual', () => {
    it('passes on shallow-equal objects', () => {
        assertDeepEqual({a: 1}, {a: 1});
    });

    it('throws on object diff', () => {
        const e = expectThrow(() => assertDeepEqual({a: 1}, {a: 2}));
        if (!e.message.includes('1') || !e.message.includes('2'))
            throw new Error(`message lacks values: ${e.message}`);
    });

    it('passes on equal arrays', () => {
        assertDeepEqual([1, 2, 3], [1, 2, 3]);
    });
});

describe('assertThrows', () => {
    it('passes when the function throws', () => {
        assertThrows(() => { throw new Error('x'); });
    });

    it('throws "expected throw" when the function does not throw', () => {
        const e = expectThrow(() => assertThrows(() => {}));
        if (!e.message.includes('expected throw'))
            throw new Error(`unexpected message: ${e.message}`);
    });
});

system.exit(summary());
