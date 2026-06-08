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

    // Style — matches the existing tree (GNOME Shell GJS conventions)
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

export default [
    {
        ignores: ['node_modules/**', '**/*.compiled', '**/*.shell-extension.zip'],
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
];
