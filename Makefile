UUID := ai-usagebar@wilfison

# Default target — list every target with a one-line description.
help:
	@echo "Targets:"
	@echo "  enable   Enable the extension via gnome-extensions"
	@echo "  disable  Disable the extension via gnome-extensions"
	@echo "  reload   Disable then enable in one step"
	@echo "  logs     Tail gnome-shell logs (journalctl -f)"
	@echo "  test     Run the gjs unit-test suite (tests/run.js)"
	@echo "  lint     Check trailing newline + no imports.* in JS files"
	@echo "  pack     Build the upload zip via gnome-extensions pack"
	@echo "  info     Show gnome-extensions info for $(UUID)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: disable enable

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

test:
	gjs -m tests/run.js

lint:
	@./tools/lint.sh

pack:
	gnome-extensions pack . --force

info:
	gnome-extensions info $(UUID)

# TODO(step-12): make watch
.PHONY: help enable disable reload logs test lint pack info
