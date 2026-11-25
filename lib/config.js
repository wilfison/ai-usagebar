import {defaultCredsPath} from './oauth/anthropic.js';
import {defaultAuthPath} from './oauth/openai.js';
import {emptyToNull} from './config-resolve.js';
import {isVendorId} from './vendors.js';
import {parseExtraHeaders, parseMapping, providerName, authHeaderOf} from './vendors/custom/mapping.js';
import {parseModelWindows} from './context/parser.js';

export function readConfig(settings) {
    const s = key => settings.get_string(key);
    const b = key => settings.get_boolean(key);
    // The fields every API-key vendor shares; a cleared field reads as null.
    const keyed = id => ({
        enabled: b(`${id}-enabled`),
        apiKeyEnv: emptyToNull(s(`${id}-api-key-env`)),
        apiKey: emptyToNull(s(`${id}-api-key`)),
    });
    const authHeader = authHeaderOf(s('custom-auth-header'));

    return {
        primaryVendor: s('primary-vendor'),
        activeVendor: s('active-vendor'),
        refreshIntervalSecs: settings.get_int('refresh-interval'),
        barFormat: s('bar-format'),
        tooltipFormat: emptyToNull(s('tooltip-format')),
        showPaceMarker: b('show-pace-marker'),
        showPaceArrows: b('show-pace-arrows'),
        usageTrend: b('usage-trend'),
        showVendorIcons: b('show-vendor-icons'),
        panelVendors: [...new Set(settings.get_strv('panel-vendors').filter(isVendorId))],
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
        providerStatus: b('provider-status'),
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
            },
            zai: {...keyed('zai'), planTier: emptyToNull(s('zai-plan-tier'))},
            openrouter: {
                ...keyed('openrouter'),
                managementKeyEnv: emptyToNull(s('openrouter-management-key-env')),
                managementKey: emptyToNull(s('openrouter-management-key')),
            },
            deepseek: keyed('deepseek'),
            kimi: keyed('kimi'),
            ollama: {...keyed('ollama'), plan: emptyToNull(s('ollama-plan'))},
            custom: {
                ...keyed('custom'),
                name: providerName(s('custom-name')),
                url: s('custom-url'),
                allowHttp: b('custom-allow-http'),
                authHeader,
                authScheme: s('custom-auth-scheme').trim(),
                // null means invalid: the adapter refuses to fetch.
                extraHeaders: parseExtraHeaders(s('custom-extra-headers'), authHeader),
                mapping: parseMapping(s('custom-mapping')),
            },
        },
    };
}

export function anthropicCredsPath(snapshot) {
    return snapshot.vendors.anthropic.credentialsPath ?? defaultCredsPath();
}

export function codexAuthPath(snapshot) {
    return snapshot.vendors.openai.codexAuthPath ?? defaultAuthPath();
}
