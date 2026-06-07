import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {anthropicCredsPath, codexAuthPath} from '../config.js';
import {resolveApiKey} from '../config-resolve.js';
import {fetchSnapshot as anthropicFetch} from './anthropic.js';
import {
    ICON as ANTHROPIC_ICON,
    VENDOR_SHORT as ANTHROPIC_SHORT,
    placeholders as anthropicPlaceholders,
    anthropicSeverity,
} from './anthropic-parse.js';
import {buildSection as anthropicBuildSection} from './anthropic-section.js';
import {fetchSnapshot as openaiFetch} from './openai.js';
import {
    ICON as OPENAI_ICON,
    VENDOR_SHORT as OPENAI_SHORT,
    placeholders as openaiPlaceholders,
    openaiSeverity,
} from './openai-parse.js';
import {buildSection as openaiBuildSection} from './openai-section.js';
import {fetchSnapshot as zaiFetch} from './zai.js';
import {
    ICON as ZAI_ICON,
    VENDOR_SHORT as ZAI_SHORT,
    placeholders as zaiPlaceholders,
    zaiSeverity,
} from './zai-parse.js';
import {buildSection as zaiBuildSection} from './zai-section.js';
import {fetchSnapshot as openrouterFetch} from './openrouter.js';
import {
    ICON as OPENROUTER_ICON,
    VENDOR_SHORT as OPENROUTER_SHORT,
    placeholders as openrouterPlaceholders,
    openrouterSeverity,
} from './openrouter-parse.js';
import {buildSection as openrouterBuildSection} from './openrouter-section.js';
import {fetchSnapshot as deepseekFetch} from './deepseek.js';
import {
    ICON as DEEPSEEK_ICON,
    VENDOR_SHORT as DEEPSEEK_SHORT,
    placeholders as deepseekPlaceholders,
    deepseekSeverity,
} from './deepseek-parse.js';
import {buildSection as deepseekBuildSection} from './deepseek-section.js';

const anthropicAdapter = {
    id: 'anthropic',
    cacheId: 'anthropic',
    icon: ANTHROPIC_ICON,
    vendorShort: ANTHROPIC_SHORT,
    fetchSnapshot(ctx) {
        let credsPath;
        try {
            credsPath = anthropicCredsPath(ctx.config);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return anthropicFetch({
            cache: ctx.cache,
            http: ctx.http,
            credsPath,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: anthropicSeverity,
    placeholders: anthropicPlaceholders,
    buildSection: (snapshot, meta, now, theme) => anthropicBuildSection(snapshot, meta, now, theme, _),
};

const openaiAdapter = {
    id: 'openai',
    cacheId: 'openai',
    icon: OPENAI_ICON,
    vendorShort: OPENAI_SHORT,
    fetchSnapshot(ctx) {
        let credsPath;
        try {
            credsPath = codexAuthPath(ctx.config);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return openaiFetch({
            cache: ctx.cache,
            http: ctx.http,
            credsPath,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: openaiSeverity,
    placeholders: openaiPlaceholders,
    buildSection: (snapshot, meta, now, theme) => openaiBuildSection(snapshot, meta, now, theme, _),
};

const zaiAdapter = {
    id: 'zai',
    cacheId: 'zai',
    icon: ZAI_ICON,
    vendorShort: ZAI_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.zai;
        let apiKey;
        try {
            apiKey = resolveApiKey('Z.AI', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return zaiFetch({
            cache: ctx.cache,
            http: ctx.http,
            apiKey,
            configPlanTier: cfg.planTier,
            signal: ctx.signal,
            now: ctx.now,
        });
    },
    severity: zaiSeverity,
    placeholders: zaiPlaceholders,
    buildSection: (snapshot, meta, now, theme) => zaiBuildSection(snapshot, meta, now, theme, _),
};

const openrouterAdapter = {
    id: 'openrouter',
    cacheId: 'openrouter',
    icon: OPENROUTER_ICON,
    vendorShort: OPENROUTER_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.openrouter;
        let apiKey;
        try {
            apiKey = resolveApiKey('OpenRouter', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return openrouterFetch({cache: ctx.cache, http: ctx.http, apiKey, signal: ctx.signal});
    },
    severity: openrouterSeverity,
    placeholders: openrouterPlaceholders,
    buildSection: (snapshot, meta, now, theme) => openrouterBuildSection(snapshot, meta, now, theme, _),
};

const deepseekAdapter = {
    id: 'deepseek',
    cacheId: 'deepseek',
    icon: DEEPSEEK_ICON,
    vendorShort: DEEPSEEK_SHORT,
    fetchSnapshot(ctx) {
        const cfg = ctx.config.vendors.deepseek;
        let apiKey;
        try {
            apiKey = resolveApiKey('DeepSeek', cfg.apiKeyEnv, cfg.apiKey, GLib.getenv);
        } catch (e) {
            return Promise.resolve({ok: false, kind: 'error', message: e?.message ?? String(e)});
        }
        return deepseekFetch({cache: ctx.cache, http: ctx.http, apiKey, signal: ctx.signal});
    },
    severity: deepseekSeverity,
    placeholders: deepseekPlaceholders,
    buildSection: (snapshot, meta, now, theme) => deepseekBuildSection(snapshot, meta, now, theme, _),
};

export const ADAPTERS = Object.freeze({
    anthropic: anthropicAdapter,
    openai: openaiAdapter,
    zai: zaiAdapter,
    openrouter: openrouterAdapter,
    deepseek: deepseekAdapter,
});

export function getAdapter(id) {
    const adapter = ADAPTERS[id];
    if (adapter)
        return adapter;
    console.warn(`ai-usagebar: no adapter registered for '${id}', falling back to anthropic`);
    return ADAPTERS.anthropic;
}
