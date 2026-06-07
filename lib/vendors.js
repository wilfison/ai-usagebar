export const VENDOR_IDS = Object.freeze([
    'anthropic',
    'openai',
    'zai',
    'openrouter',
    'deepseek',
]);

export const VENDOR_LABELS = Object.freeze([
    'Anthropic',
    'OpenAI',
    'Z.AI',
    'OpenRouter',
    'DeepSeek',
]);

export function isVendorId(s) {
    return VENDOR_IDS.includes(s);
}

export function vendorLabel(id) {
    const i = VENDOR_IDS.indexOf(id);
    return i === -1 ? id : VENDOR_LABELS[i];
}
