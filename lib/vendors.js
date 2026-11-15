// Every vendor, in the gschema enum order (append new ones last). `named`
// reads the name the user gave a vendor, which then labels it; `genericIcon`
// marks a vendor with no mark of its own under icons/.
export const VENDORS = Object.freeze([
    {id: 'anthropic', label: 'Anthropic'},
    {id: 'openai', label: 'OpenAI'},
    {id: 'zai', label: 'Z.AI'},
    {id: 'openrouter', label: 'OpenRouter'},
    {id: 'deepseek', label: 'DeepSeek'},
    {id: 'kimi', label: 'Kimi'},
    {id: 'ollama', label: 'Ollama'},
    {id: 'custom', label: 'Custom', genericIcon: true, named: config => config?.vendors?.custom?.name},
].map(Object.freeze));

export const VENDOR_IDS = Object.freeze(VENDORS.map(v => v.id));
export const VENDOR_LABELS = Object.freeze(VENDORS.map(v => v.label));

export function isVendorId(s) {
    return VENDOR_IDS.includes(s);
}

function vendorOf(id) {
    return VENDORS.find(v => v.id === id) ?? null;
}

export const GENERIC_ICON = 'ai-symbolic';

// The symbolic icon name of a vendor's mark (icons/<name>.svg).
export function vendorIconName(id) {
    const v = vendorOf(id);
    return v && !v.genericIcon ? `${id}-symbolic` : GENERIC_ICON;
}

// A vendor the user named is labelled by that name.
export function vendorLabel(id, config = null) {
    const v = vendorOf(id);
    return v?.named?.(config) || (v?.label ?? id);
}

// The names users gave their vendors: a change to one relabels its badges.
export function configuredNames(config) {
    return VENDORS.filter(v => v.named).map(v => v.named(config) ?? '');
}
