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
	@echo "  watch           Re-run 'make test' on changes under lib/ ui/ tests/"
	@echo "  run             Launch a nested gnome-shell (Wayland) to test the extension"
	@echo "  pot             Extract translatable strings into po/$(UUID).pot"
	@echo "  update-po       Merge each po/*.po against the refreshed template"
	@echo "  compile-locale  Compile po/*.po into locale/<lang>/LC_MESSAGES/*.mo"
	@echo "  i18n-check      Fail on a stale .pot or a malformed po/*.po (CI gate)"
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
		echo "watch: inotifywait not found — install inotify-tools to use 'make watch'"; \
		exit 1; \
	}
	@$(MAKE) --no-print-directory test || true
	@while inotifywait -qq -r -e modify,create,delete,move lib ui tests; do \
		$(MAKE) --no-print-directory test || true; \
	done

run:
	dbus-run-session -- gnome-shell --wayland --devkit

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

# pack bundles only a fixed top-level set, so lib/ and ui/ need --extra-source; --podir=po ships the .mo files.
pack: schemas
	gnome-extensions pack . --extra-source=lib --extra-source=ui --podir=po --force

info:
	gnome-extensions info $(UUID)

.PHONY: help schemas enable disable reload logs test lint eslint validate watch \
	run pot update-po compile-locale i18n-check pack info
