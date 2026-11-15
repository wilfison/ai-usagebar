# Vendors

All vendors plug in through the [vendor adapter](/architecture/vendor-adapters.md). API keys come from the environment variable when set, else from prefs.

# OAuth (CLI credentials)

* [Anthropic (Claude)](anthropic.md) - Session and weekly usage from the Claude OAuth usage endpoint, with auto refresh.
* [OpenAI (Codex)](openai.md) - 5h and weekly Codex usage from the ChatGPT backend.

# API key

* [Z.AI / GLM](zai.md) - Plan usage and reset windows.
* [OpenRouter](openrouter.md) - Credit balance and usage; management key adds recent models.
* [DeepSeek](deepseek.md) - Account balance only.
* [Kimi](kimi.md) - Weekly quota and 5h window.
* [Ollama Cloud](ollama.md) - Usage windows or monthly credits.

# User-mapped

* [Custom provider](/features/custom-provider.md) - Any JSON endpoint mapped through JSON Pointer.
