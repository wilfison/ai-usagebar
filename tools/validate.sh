#!/usr/bin/env bash
#
# Pre-packaging validation:
#   1. metadata.json is valid JSON with the EGO-required keys
#   2. the GSettings schema compiles under --strict (warnings are errors)
#
# Run from the repo root (see `make validate`).

set -eu

gjs -m tools/validate-metadata.js

glib-compile-schemas --strict --dry-run schemas/
echo "validate: schema OK"
