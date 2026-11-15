// The built-in vendor pages of the preferences window, as data: groups of
// rows bound to GSettings keys. The custom provider's page has JSON editors
// and stays hand-built in prefs.

export const RowType = Object.freeze({
    SWITCH: 'switch',
    ENTRY: 'entry',
    PASSWORD: 'password',
    SPIN: 'spin',
});

// The schema is the one source of a key's bounds and choices; `schema` is
// the Gio.SettingsSchema (injected, so this stays gi-free).
export function schemaRange(schema, key) {
    const [kind, value] = schema.get_key(key).get_range().recursiveUnpack();
    return kind === 'range' ? {lower: value[0], upper: value[1]} : {};
}

export function schemaChoices(schema, key) {
    const [kind, value] = schema.get_key(key).get_range().recursiveUnpack();
    return kind === 'enum' ? value : [];
}

const sw = (key, title) => ({type: RowType.SWITCH, key, title});
const entry = (key, title) => ({type: RowType.ENTRY, key, title});
const password = (key, title) => ({type: RowType.PASSWORD, key, title});

// Enabled + env var + inline key: the API-key vendors' first rows.
function keyRows(id, _) {
    return [sw(`${id}-enabled`, _('Enabled')), entry(`${id}-api-key-env`, _('API key env var')), password(`${id}-api-key`, _('API key (inline)'))];
}

// An API-key vendor's group; `optIn` vendors are off until a key is set.
function keyGroup(id, title, _, {optIn = false, extra = []} = {}) {
    const description = optIn
        ? _('Disabled by default; requires an API key (env var or inline).')
        : _('Set the API key inline or via the environment variable (env wins).');
    return {title, description, rows: [...keyRows(id, _), ...extra]};
}

const PAGES = {
    anthropic: _ => [
        {
            // Translators: "Anthropic" is a brand name, usually keep untranslated.
            title: _('Anthropic'),
            description: _('Credentials path: empty uses ~/.claude/.credentials.json.'),
            rows: [sw('anthropic-enabled', _('Enabled')), entry('anthropic-credentials-path', _('Credentials path'))],
        },
        {
            title: _('Context monitor'),
            description: _('Lists recent Claude Code sessions in the Claude section, with how much of the context window each one used. Transcripts are read only while this is on.'),
            rows: [
                sw('context-enabled', _('Show session context')),
                entry('context-projects-path', _('Projects directory (empty: ~/.claude/projects)')),
                {
                    type: RowType.SPIN,
                    key: 'context-window-tokens',
                    title: _('Default context window (tokens)'),
                    subtitle: _('0 shows raw token counts instead of a percentage'),
                    step: 1000,
                    page: 100000,
                },
                entry('context-model-windows', _('Window per model (JSON, e.g. {"claude-opus-5": 1000000})')),
            ],
        },
    ],
    openai: _ => [{
        // Translators: "OpenAI" is a brand name, usually keep untranslated.
        title: _('OpenAI'),
        description: _('Codex auth path: empty uses ~/.codex/auth.json.'),
        rows: [sw('openai-enabled', _('Enabled')), entry('openai-codex-auth-path', _('Codex auth path'))],
    }],
    // Translators: "Z.AI" is a brand name, usually keep untranslated.
    zai: _ => [keyGroup('zai', _('Z.AI'), _, {extra: [entry('zai-plan-tier', _('Plan tier (lite/pro/max)'))]})],
    openrouter: _ => [
        // Translators: "OpenRouter" is a brand name, usually keep untranslated.
        keyGroup('openrouter', _('OpenRouter'), _),
        {
            title: _('Recent models'),
            description: _('Optional. A management key lists the two most recently used models; it is sent only to the activity endpoint, never with usage requests.'),
            rows: [
                entry('openrouter-management-key-env', _('Management key env var')),
                password('openrouter-management-key', _('Management key (inline)')),
            ],
        },
    ],
    // Translators: "DeepSeek" is a brand name, usually keep untranslated.
    deepseek: _ => [keyGroup('deepseek', _('DeepSeek'), _, {optIn: true})],
    // Translators: "Kimi" is a brand name, usually keep untranslated.
    kimi: _ => [keyGroup('kimi', _('Kimi'), _, {optIn: true})],
    ollama: _ => [
        // Translators: "Ollama" is a brand name, usually keep untranslated.
        keyGroup('ollama', _('Ollama Cloud'), _, {optIn: true, extra: [entry('ollama-plan', _('Plan name (optional)'))]}),
    ],
};

// The page of a built-in vendor, or null for one built by hand.
export function vendorPageSpec(id, _ = s => s) {
    const groups = PAGES[id];
    return groups ? {groups: groups(_)} : null;
}
