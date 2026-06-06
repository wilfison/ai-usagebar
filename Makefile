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

pack: schemas
	gnome-extensions pack . --force

info:
	gnome-extensions info $(UUID)

.PHONY: help schemas enable disable reload logs test lint eslint pack info
