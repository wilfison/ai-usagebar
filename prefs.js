import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {prefsNav, prefsNavItems} from './lib/prefs-nav.js';
import {vendorPageSpec} from './lib/prefs-pages.js';
import {specPage} from './prefs/widgets.js';
import {buildPanelPage, buildPopupPage, buildDisplayPage, buildBehaviorPage} from './prefs/general.js';
import {buildCustomPage} from './prefs/custom.js';

export default class AiUsagebarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cleanups = [];

        this._registerIconPath();

        const builders = {
            panel: () => buildPanelPage(settings, cleanups),
            popup: () => buildPopupPage(settings, cleanups),
            display: () => buildDisplayPage(settings, cleanups),
            behavior: () => buildBehaviorPage(settings),
            custom: () => buildCustomPage(settings, cleanups),
        };
        const nav = prefsNav(_);
        const pages = new Map();
        for (const {id} of prefsNavItems(nav)) {
            const spec = vendorPageSpec(id, _);
            const build = builders[id] ?? (spec && (() => specPage(settings, spec, cleanups)));
            if (!build)
                throw new Error(`No preferences page for "${id}"`);
            pages.set(id, build());
        }

        // The shell rejects a window with no visible_page, so one stays behind our content.
        window.add(new Adw.PreferencesPage());
        window.set_default_size(860, 640);
        // Last: past this point the shell's own error page is no longer on screen.
        window.set_content(this._buildSplitView(window, nav, pages));

        window.connect('close-request', () => {
            for (const disconnect of cleanups)
                disconnect();
            return false;
        });
    }

    _buildSplitView(window, nav, pages) {
        const stack = new Gtk.Stack();
        for (const [id, page] of pages)
            stack.add_named(page, id);
        const content = new Adw.NavigationPage({
            title: window.title,
            child: this._toolbarView(stack),
        });

        const items = prefsNavItems(nav);
        const sectionTitles = new Map();
        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            css_classes: ['navigation-sidebar'],
        });
        for (const section of nav)
            sectionTitles.set(items.indexOf(section.items[0]), section.title);
        for (const item of items)
            list.append(this._navRow(item));
        list.set_header_func(row => {
            const title = sectionTitles.get(row.get_index());
            row.set_header(title ? new Gtk.Label({
                label: title,
                xalign: 0,
                margin_start: 12,
                margin_top: 12,
                margin_bottom: 6,
                css_classes: ['caption-heading', 'dim-label'],
            }) : null);
        });
        const sidebar = new Adw.NavigationPage({
            title: window.title,
            child: this._toolbarView(new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                child: list,
            })),
        });

        const splitView = new Adw.NavigationSplitView({sidebar, content});
        list.connect('row-selected', (_list, row) => {
            if (!row)
                return;
            const item = items[row.get_index()];
            stack.set_visible_child_name(item.id);
            content.set_title(item.title);
        });
        list.connect('row-activated', () => splitView.set_show_content(true));
        list.select_row(list.get_row_at_index(0));

        const narrow = new Adw.Breakpoint({
            condition: Adw.BreakpointCondition.parse('max-width: 560sp'),
        });
        narrow.add_setter(splitView, 'collapsed', true);
        window.add_breakpoint(narrow);

        return splitView;
    }

    _toolbarView(child) {
        const view = new Adw.ToolbarView({content: child});
        view.add_top_bar(new Adw.HeaderBar());
        return view;
    }

    _navRow(item) {
        const box = new Gtk.Box({spacing: 12});
        box.append(new Gtk.Image({icon_name: item.icon}));
        box.append(new Gtk.Label({label: item.title, xalign: 0}));
        return new Gtk.ListBoxRow({child: box});
    }

    _registerIconPath() {
        // The bundled symbolic icons (icons/*.svg) live outside any icon theme, so
        // add the dir to the search path; the sidebar references them by basename.
        const iconDir = `${this.path}/icons`;
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(iconDir))
            iconTheme.add_search_path(iconDir);
    }
}
