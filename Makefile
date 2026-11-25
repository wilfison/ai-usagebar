UUID := ai-usagebar@wilfison

help:
	@echo "Targets:"
	@echo "  schemas         Compile the GSettings schema (schemas/)"
	@echo "  enable          Enable the extension via gnome-extensions"
	@echo "  disable         Disable the extension via gnome-extensions"
	@echo "  reload          Disable then enable in one step"
	@echo "  logs            Tail gnome-shell logs (journalctl -f)"
	@echo "  test            Run the gjs unit-test suite (tests/run.js)"
	@echo "  lint            Check trailing newline + no imports.* in JS files"
	@echo "  eslint          Run eslint (GNOME Shell style); needs 'npm ci' first"
	@echo "  validate        Validate metadata.json + compile schema with --strict"
	@echo "  watch           Re-run 'make test' on changes under lib/ ui/ prefs/ tests/"
	@echo "  run             Launch a nested gnome-shell (Wayland) to test the extension"
	@echo "  headless        Start an isolated headless gnome-shell (tools/headless.sh; FAKE_PCT, FAKE_PCT_<KIND>, LANG_UNDER_TEST)"
	@echo "  headless-stop   Stop it"
	@echo "  pot             Extract translatable strings into po/$(UUID).pot"
	@echo "  update-po       Merge each po/*.po against the refreshed template"
	@echo "  compile-locale  Compile po/*.po into locale/<lang>/LC_MESSAGES/*.mo"
	@echo "  i18n-check      Fail on a stale .pot or a malformed po/*.po (CI gate)"
	@echo "  i18n-todo       List each catalog's untranslated and fuzzy strings"
	@echo "  upstream-diff   Report upstream changes since FROM=<tag> (tools/upstream-diff.sh)"
	@echo "  pack            Build the upload zip via gnome-extensions pack (--podir=po)"
	@echo "  info            Show gnome-extensions info for $(UUID)"

schemas:
	glib-compile-schemas schemas/

enable: schemas
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: disable enable

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

test: schemas
	gjs -m tests/run.js

lint:
	@./tools/lint.sh

eslint:
	npx eslint .

validate:
	@./tools/validate.sh

# Re-run the test suite whenever a source/test file changes.
watch:
	@command -v inotifywait >/dev/null 2>&1 || { \
		echo "watch: inotifywait not found: install inotify-tools to use 'make watch'"; \
		exit 1; \
	}
	@$(MAKE) --no-print-directory test || true
	@while inotifywait -qq -r -e modify,create,delete,move lib ui prefs tests; do \
		$(MAKE) --no-print-directory test || true; \
	done

# Launch a throwaway nested gnome-shell to test live. Dev overrides:
# AI_USAGEBAR_FAKE_PCT=23 (synthetic snapshot at that percentage),
# AI_USAGEBAR_FAKE_PCT_WEEKLY=95 (one window kind: SESSION, WEEKLY, MONTHLY,
#   SONNET, SCOPED, MCP, CODE_REVIEW, CREDITS; unset kinds take FAKE_PCT, else 0),
# AI_USAGEBAR_FAKE_ERROR=zai,openai:stale or * (fail, or serve stale data),
# AI_USAGEBAR_FAKE_DELAY_MS=3000 (every fetch waits first).
run:
	@fake="$$(env | grep -E '^AI_USAGEBAR_FAKE_PCT(_[A-Z_]+)?=.' | sort | tr '\n' ' ')"; \
	if [ -n "$$fake" ]; then \
		echo "run: $${fake}overriding usage fetch"; \
	fi
	dbus-run-session -- gnome-shell --wayland --devkit

# An isolated headless gnome-shell driven from the command line (eval, probe,
# click, keys, prefs, shot): see tools/headless.sh for every subcommand.
# make headless FAKE_PCT=40 FAKE_PCT_WEEKLY=95 LANG_UNDER_TEST=pt_BR
FAKE_PCT_KINDS := session weekly monthly sonnet scoped mcp code-review credits
fake_pct_var = FAKE_PCT_$(subst -,_,$(shell echo $(1) | tr a-z A-Z))
headless:
	@./tools/headless.sh start $(if $(FAKE_PCT),--fake-pct $(FAKE_PCT)) \
		$(foreach k,$(FAKE_PCT_KINDS),$(if $($(call fake_pct_var,$(k))),--fake-pct-$(k) $($(call fake_pct_var,$(k))))) \
		$(if $(LANG_UNDER_TEST),--lang $(LANG_UNDER_TEST))

headless-stop:
	@./tools/headless.sh stop

# What the upstream Rust widget changed since a tag: make upstream-diff FROM=v1.52.2
upstream-diff:
	@./tools/upstream-diff.sh $(or $(FROM),$(error FROM=<tag> is required, e.g. make upstream-diff FROM=v1.52.2))

# Extract every marked string into the tracked .pot template.
pot:
	@./tools/i18n.sh pot

# Merge the refreshed template into each tracked locale (run 'make pot' first).
update-po:
	@./tools/i18n.sh update-po

# Compile po/*.po into locale/<lang>/LC_MESSAGES/*.mo for live/dev testing (gitignored).
compile-locale:
	@./tools/i18n.sh compile-locale

# CI gate: fail on .pot drift (regenerate + diff), then msgfmt --check every po/*.po.
i18n-check:
	@./tools/i18n.sh check

i18n-todo:
	@./tools/i18n.sh todo

# pack bundles only a fixed top-level set, so lib/, ui/ and prefs/ need --extra-source; --podir=po ships the .mo files.
pack: schemas
	gnome-extensions pack . --extra-source=lib --extra-source=ui --extra-source=prefs --extra-source=icons --podir=po --force

info:
	gnome-extensions info $(UUID)

.PHONY: help schemas enable disable reload logs test lint eslint validate watch \
	run headless headless-stop upstream-diff pot update-po compile-locale i18n-check i18n-todo pack info
