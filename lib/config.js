/**
 * @file Reads the extension's GSettings store into a plain {@link ConfigSnapshot}
 * object so the rest of the code never touches raw setting keys. GSettings is
 * the single source of truth; optional string keys use '' as the "unset"
 * sentinel and are normalized to `null` here.
 */

import {defaultCredsPath} from './oauth/anthropic.js';
import {defaultAuthPath} from './oauth/openai.js';
import {emptyToNull} from './config-resolve.js';

/**
 * @typedef {object} VendorConfig
 * @property {boolean} enabled
 *
 * @typedef {object} ConfigSnapshot
 * @property {string} primaryVendor
 * @property {string} activeVendor
 * @property {number} refreshIntervalSecs
 * @property {string} barFormat
 * @property {?string} tooltipFormat - null when unset.
 * @property {{low: ?string, mid: ?string, high: ?string, critical: ?string}} colors
 * @property {{
 *   anthropic: {enabled: boolean, credentialsPath: ?string},
 *   openai: {enabled: boolean, codexAuthPath: ?string, adminKeyEnv: string},
 *   zai: {enabled: boolean, apiKeyEnv: string, apiKey: ?string, planTier: ?string},
 *   openrouter: {enabled: boolean, apiKeyEnv: string, apiKey: ?string},
 *   deepseek: {enabled: boolean, apiKeyEnv: string, apiKey: ?string},
 * }} vendors
 */

/**
 * Snapshot a {@link Gio.Settings} into a {@link ConfigSnapshot}. Optional
 * strings ('' sentinel) are normalized to `null`.
 * @param {Gio.Settings} settings
 * @returns {ConfigSnapshot}
 */
export function readConfig(settings) {
    const s = key => settings.get_string(key);
    const b = key => settings.get_boolean(key);

    return {
        primaryVendor: s('primary-vendor'),
        activeVendor: s('active-vendor'),
        refreshIntervalSecs: settings.get_int('refresh-interval'),
        barFormat: s('bar-format'),
        tooltipFormat: emptyToNull(s('tooltip-format')),
        colors: {
            low: emptyToNull(s('color-low')),
            mid: emptyToNull(s('color-mid')),
            high: emptyToNull(s('color-high')),
            critical: emptyToNull(s('color-critical')),
        },
        vendors: {
            anthropic: {
                enabled: b('anthropic-enabled'),
                credentialsPath: emptyToNull(s('anthropic-credentials-path')),
            },
            openai: {
                enabled: b('openai-enabled'),
                codexAuthPath: emptyToNull(s('openai-codex-auth-path')),
                adminKeyEnv: s('openai-admin-key-env'),
            },
            zai: {
                enabled: b('zai-enabled'),
                apiKeyEnv: s('zai-api-key-env'),
                apiKey: emptyToNull(s('zai-api-key')),
                planTier: emptyToNull(s('zai-plan-tier')),
            },
            openrouter: {
                enabled: b('openrouter-enabled'),
                apiKeyEnv: s('openrouter-api-key-env'),
                apiKey: emptyToNull(s('openrouter-api-key')),
            },
            deepseek: {
                enabled: b('deepseek-enabled'),
                apiKeyEnv: s('deepseek-api-key-env'),
                apiKey: emptyToNull(s('deepseek-api-key')),
            },
        },
    };
}

/**
 * The Anthropic credentials path to use: the configured override, or the
 * built-in default when unset.
 * @param {ConfigSnapshot} snapshot
 * @returns {string} absolute path.
 */
export function anthropicCredsPath(snapshot) {
    return snapshot.vendors.anthropic.credentialsPath ?? defaultCredsPath();
}

/**
 * The Codex auth.json path to use: the configured override, or the built-in
 * default (`~/.codex/auth.json`) when unset.
 * @param {ConfigSnapshot} snapshot
 * @returns {string} absolute path.
 */
export function codexAuthPath(snapshot) {
    return snapshot.vendors.openai.codexAuthPath ?? defaultAuthPath();
}

/**
 * Obtain the extension's {@link Gio.Settings} (uses the `settings-schema`
 * declared in metadata.json).
 * @param {object} extension - the Extension instance.
 * @returns {Gio.Settings}
 */
export function getSettings(extension) {
    return extension.getSettings();
}
