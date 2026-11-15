import js from '@eslint/js';
import globals from 'globals';

const gjsGlobals = {
    ...globals.es2021,
    console: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    globalThis: 'readonly',
    global: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    ARGV: 'readonly',
    pkg: 'readonly',
};

const rules = {
    ...js.configs.recommended.rules,

    // Correctness
    'no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none'}],
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'smart'],
    'no-implicit-coercion': 'off',

    // Style: matches the existing tree (GNOME Shell GJS conventions)
    'indent': ['error', 4, {
        SwitchCase: 0,
        // GNOME wraps the panel widget in GObject.registerClass(class … {…});
        // the class body is NOT given an extra indent level.
        ignoredNodes: [
            'CallExpression[callee.object.name="GObject"][callee.property.name="registerClass"] > ClassExpression:first-child',
        ],
    }],
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', {avoidEscape: true}],
    'comma-dangle': ['error', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'never',
    }],
    // Allow intentional typographic spaces (narrow NBSP before units, etc.) in
    // string/template content; still flag stray irregular whitespace in code.
    'no-irregular-whitespace': ['error', {skipStrings: true, skipTemplates: true}],
    'comma-spacing': 'error',
    'key-spacing': 'error',
    'keyword-spacing': 'error',
    'space-before-blocks': 'error',
    'space-infix-ops': 'error',
    'arrow-spacing': 'error',
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],
    'no-multiple-empty-lines': ['error', {max: 2, maxBOF: 0, maxEOF: 0}],
};

// lib/ is pure (no gi://, so it runs under plain gjs tests) except these,
// which own the Gio, Soup and GLib edges.
const GI_BOUND_LIB = [
    'lib/active-vendor.js',
    'lib/cache.js',
    'lib/context/scan.js',
    'lib/http.js',
    'lib/oauth/anthropic.js',
    'lib/oauth/creds-file.js',
    'lib/oauth/openai.js',
    'lib/update-store.js',
    'lib/vendors/*/adapter.js',
];

export default [
    {
        // tmp/ holds local scratch (the upstream Rust clone among it), never shipped.
        ignores: ['node_modules/**', 'tmp/**', '**/*.compiled', '**/*.shell-extension.zip'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules,
    },
    {
        files: ['lib/**/*.js'],
        ignores: GI_BOUND_LIB,
        rules: {
            'no-restricted-imports': ['error', {patterns: [{
                group: ['gi://*', 'resource:///*'],
                message: 'lib/ modules stay pure: inject what needs gi (see CLAUDE.md), or list the file in GI_BOUND_LIB.',
            }]}],
        },
    },
    {
        // The prefs process has no Shell: no adapters (they reach Soup and the
        // shell's modules), no ui/.
        files: ['prefs.js', 'prefs/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {patterns: [{
                // Case matters: org/gnome/Shell/Extensions is the prefs side.
                caseSensitive: true,
                group: ['**/vendors/registry.js', '**/vendors/*/adapter.js', '**/ui/*', 'resource:///org/gnome/shell/*'],
                message: 'prefs runs in its own process: import only pure lib/ modules.',
            }]}],
        },
    },
];
