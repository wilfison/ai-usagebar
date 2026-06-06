UUID := ai-usagebar@wilfison

# Default target — list every target with a one-line description.
help:
	@echo "Targets:"
	@echo "  schemas  Compile the GSettings schema (schemas/)"
	@echo "  enable   Enable the extension via gnome-extensions"
	@echo "  disable  Disable the extension via gnome-extensions"
	@echo "  reload   Disable then enable in one step"
	@echo "  logs     Tail gnome-shell logs (journalctl -f)"
	@echo "  test     Run the gjs unit-test suite (tests/run.js)"
	@echo "  lint     Check trailing newline + no imports.* in JS files"
	@echo "  eslint   Run eslint (GNOME Shell style); needs 'npm ci' first"
	@echo "  validate Validate metadata.json + compile schema with --strict"
	@echo "  watch    Re-run 'make test' on changes under lib/ ui/ tests/"
	@echo "  pack     Build the upload zip via gnome-extensions pack"
	@echo "  info     Show gnome-extensions info for $(UUID)"

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

# Re-run the test suite whenever a source/test file changes. Requires
# inotify-tools; degrades to a clear message when inotifywait is absent.
watch:
	@command -v inotifywait >/dev/null 2>&1 || { \
		echo "watch: inotifywait not found — install inotify-tools to use 'make watch'"; \
		exit 1; \
	}
	@$(MAKE) --no-print-directory test || true
	@while inotifywait -qq -r -e modify,create,delete,move lib ui tests; do \
		$(MAKE) --no-print-directory test || true; \
	done

pack: schemas
	gnome-extensions pack . --force

info:
	gnome-extensions info $(UUID)

.PHONY: help schemas enable disable reload logs test lint eslint validate watch pack info
