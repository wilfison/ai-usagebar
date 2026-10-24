import {defaultCredsPath} from './oauth/anthropic.js';
import {defaultAuthPath} from './oauth/openai.js';
import {emptyToNull, normalizeActive, isEnabled} from './config-resolve.js';
import {parseExtraHeaders, parseMapping, providerName} from './vendors/custom/parser.js';
import {parseModelWindows} from './context/parser.js';
import {VENDOR_IDS} from './vendors.js';

export function readConfig(settings) {
    const s = key => settings.get_string(key);
    const b = key => settings.get_boolean(key);

    return {
        primaryVendor: s('primary-vendor'),
        activeVendor: s('active-vendor'),
        refreshIntervalSecs: settings.get_int('refresh-interval'),
        barFormat: s('bar-format'),
        vendorBarFormats: Object.fromEntries(VENDOR_IDS.map(id => [id, s(`bar-format-${id}`)])),
        panelVendorIds: settings.get_strv('panel-vendors'),
        tooltipFormat: emptyToNull(s('tooltip-format')),
        showPaceMarker: b('show-pace-marker'),
        showVendorIcons: b('show-vendor-icons'),
        panel: {
            box: s('panel-box'),
            index: settings.get_int('panel-index'),
        },
        notifications: {
            enabled: b('notify-enabled'),
            threshold: settings.get_int('notify-threshold'),
        },
        updateCheck: {
            enabled: b('update-check-enabled'),
        },
        context: {
            enabled: b('context-enabled'),
            projectsPath: emptyToNull(s('context-projects-path')),
            // 0 means not configured: a session then shows raw tokens, never a guessed %.
            windowTokens: settings.get_int('context-window-tokens') || null,
            modelWindows: parseModelWindows(s('context-model-windows')),
        },
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
            kimi: {
                enabled: b('kimi-enabled'),
                apiKeyEnv: s('kimi-api-key-env'),
                apiKey: emptyToNull(s('kimi-api-key')),
            },
            ollama: {
                enabled: b('ollama-enabled'),
                apiKeyEnv: s('ollama-api-key-env'),
                apiKey: emptyToNull(s('ollama-api-key')),
                plan: emptyToNull(s('ollama-plan')),
            },
            custom: {
                enabled: b('custom-enabled'),
                name: providerName(s('custom-name')),
                url: s('custom-url'),
                allowHttp: b('custom-allow-http'),
                apiKeyEnv: emptyToNull(s('custom-api-key-env')),
                apiKey: emptyToNull(s('custom-api-key')),
                authHeader: s('custom-auth-header').trim() || 'Authorization',
                authScheme: s('custom-auth-scheme').trim(),
                // null means invalid: the adapter refuses to fetch.
                extraHeaders: parseExtraHeaders(s('custom-extra-headers'), s('custom-auth-header').trim() || 'Authorization'),
                mapping: parseMapping(s('custom-mapping')),
            },
        },
    };
}

export function initializePanelVendors(settings) {
    if (settings.get_user_value('panel-vendors') !== null)
        return;
    const config = readConfig(settings);
    const active = normalizeActive(config);
    settings.set_strv('panel-vendors', isEnabled(config, active) ? [active] : []);
}

export function anthropicCredsPath(snapshot) {
    return snapshot.vendors.anthropic.credentialsPath ?? defaultCredsPath();
}

export function codexAuthPath(snapshot) {
    return snapshot.vendors.openai.codexAuthPath ?? defaultAuthPath();
}
