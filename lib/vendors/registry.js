/**
 * @file Vendor-adapter registry: the shell-side glue that maps a vendor id to a
 * uniform {@link Adapter}. The indicator looks up `getAdapter(primaryVendor)` and
 * drives it without per-vendor branching. Each adapter wraps its orchestrator's
 * `fetchSnapshot` to (a) derive the creds path / resolved API key from config and
 * (b) catch resolution errors into the standard error result so the adapter never
 * throws. Severity / placeholders / section builders are pure references.
 *
 * This module imports `gi://GLib` (for `GLib.getenv`), the shell-side `gettext`
 * (the real translator it injects into every pure `buildSection`), and the
 * per-vendor orchestrators (which transitively import `Gio`); it is therefore not
 * a pure module and has no unit test — the logic it wires is covered by the
 * pure-module suites.
 */

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

/**
 * @typedef {object} AdapterCtx
 * @property {import('../config.js').ConfigSnapshot} config
 * @property {import('../cache.js').Cache} cache
 * @property {(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 * @property {import('gi://Gio').Cancellable} [signal]
 * @property {Date} [now]
 */

/**
 * Uniform vendor adapter. `fetchSnapshot` derives its own creds/key from
 * `ctx.config` and never throws; `severity`/`placeholders`/`buildSection` are the
 * vendor's pure functions (the section builder owns the `title` header).
 * @typedef {object} Adapter
 * @property {string} id - vendor id (matches a {@link import('../vendors.js').VENDOR_IDS} entry).
 * @property {string} cacheId - per-vendor cache directory name.
 * @property {string} icon - panel glyph.
 * @property {string} vendorShort - short tag shown in the bar.
 * @property {(ctx: AdapterCtx) => Promise<import('./types.js').FetchResult>} fetchSnapshot
 * @property {(snapshot: *) => string} severity
 * @property {(snapshot: *, now: Date) => Map<string, string>} placeholders
 * @property {(snapshot: *, meta: *, now: Date, theme: import('../theme.js').Theme) => *} buildSection
 */

/** @type {Adapter} */
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

/** @type {Adapter} */
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

/** @type {Adapter} */
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

/** @type {Adapter} */
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

/** @type {Adapter} */
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

/**
 * Frozen map of vendor id → {@link Adapter}, covering every {@link
 * import('../vendors.js').VENDOR_IDS} entry.
 * @type {Readonly<Record<string, Adapter>>}
 */
export const ADAPTERS = Object.freeze({
    anthropic: anthropicAdapter,
    openai: openaiAdapter,
    zai: zaiAdapter,
    openrouter: openrouterAdapter,
    deepseek: deepseekAdapter,
});

/**
 * Resolve the adapter for a vendor id, falling back to Anthropic (with a warning)
 * for an unregistered id so the panel stays functional during staged rollout.
 * @param {string} id
 * @returns {Adapter}
 */
export function getAdapter(id) {
    const adapter = ADAPTERS[id];
    if (adapter)
        return adapter;
    console.warn(`ai-usagebar: no adapter registered for '${id}', falling back to anthropic`);
    return ADAPTERS.anthropic;
}
