import {anthropicAdapter} from './anthropic/adapter.js';
import {openaiAdapter} from './openai/adapter.js';
import {zaiAdapter} from './zai/adapter.js';
import {openrouterAdapter} from './openrouter/adapter.js';
import {deepseekAdapter} from './deepseek/adapter.js';

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
