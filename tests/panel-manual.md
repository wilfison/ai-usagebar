# Selectable panel vendors: GNOME 50 manual checks

These checks require a GNOME 50 session. They are a verification checklist,
not a record of completed manual testing.

With this branch installed in the extension's development directory, launch a
throwaway nested Shell and inspect its logs:

```bash
make schemas
AI_USAGEBAR_FAKE_PCT=23 make run
make logs
```

Use the Claude and OpenAI synthetic snapshots to check panel rendering without
vendor credentials. Open preferences using the popup's gear button.

- Before the first enable after an upgrade, set OpenAI as the active vendor and
  leave `panel-vendors` unset. Enabling the extension should retain only OpenAI
  on the panel. Opening preferences before enabling should preserve it too.
- Select Claude and OpenAI under Panel. Both labels should appear in vendor
  order. Clicking either label should open that vendor's popup section.
- Set the default label to `{session_pct}%`, then set only OpenAI's label to
  `{weekly_pct}%`. Claude should inherit the default and OpenAI should use its
  override. Clearing OpenAI's override should restore the default.
- Deselect OpenAI. Its panel item and label editor should disappear while its
  enabled state and popup section remain available. Scroll through enabled
  vendors and check that the panel selection stays unchanged.
- Disable OpenAI on its Vendors page, then select it under Panel. It should
  become enabled and appear on the panel.
- Deselect every vendor. The panel should show "No panel vendors selected" and
  still open its menu and preferences. Re-enable the extension and confirm the
  empty selection is retained.
- Restore a label containing `{session_reset}`, close the popup and wait at
  least a minute. The countdown should update without waiting for a poll.
- Change panel position, vendor logos and colors. Check both panel items and
  popup sections, then disable/re-enable the extension and check for errors.

With real credentials or a controlled fetch fixture, also check that a slow or
failed vendor does not block the other selected vendor, that Refresh all includes
enabled vendors absent from the panel, and that disabling a vendor during a fetch
does not restore its panel item or send a notification for the disabled vendor.

Record the Shell version, commands, observations and any limitations when these
checks are performed.
