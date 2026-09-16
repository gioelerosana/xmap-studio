//! Interfaccia nativa GTK4 + libadwaita.
//!
//! Nessun webview: la lista dei blocchi è una `gtk::ListView`, l'editor è un
//! `gtk::TextView`, l'anteprima è una `gtk::Picture` alimentata con una texture
//! GDK prodotta dal backend (SVG MathJax → PNG con resvg). Le operazioni pesanti
//! (rendering MathJax, salvataggio, apertura) girano su un thread di lavoro e
//! rientrano nel main loop con `glib::MainContext::spawn_local`.

use crate::controller::{AppController, StatusDto, DEFAULT_EM_PX};
use crate::equation::TitleMode;
use crate::error::{ErrorPayload, CODE_CONFLICT, CODE_XMIND_RUNNING};
use crate::raster;
use crate::state::{TopicView, WorkbookDto};

use adw::prelude::*;
use gtk::gio;
use gtk::glib;
use gtk::{gdk, pango};

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

const CSS: &str = r#"
.eq-preview { padding: 14px; border-radius: 8px; }
.eq-preview-light { background: #ffffff; }
.eq-preview-dark { background: #1e1e1e; }
.kind-badge { padding: 1px 8px; border-radius: 20px; background: alpha(currentColor, 0.08); font-size: 12px; }
.badge { padding: 1px 8px; border-radius: 20px; font-size: 12px; }
.badge.warning { background: alpha(@warning_color, 0.2); color: @warning_color; }
.badge.error { background: alpha(@error_color, 0.2); color: @error_color; }
.mono { font-family: monospace; }
.eq-row { color: @accent_color; }
"#;

const SNIPPETS: &[(&str, &str)] = &[
    ("⊆", "\\subseteq "),
    ("⊂", "\\subset "),
    ("×", "\\times "),
    ("⇔", "\\iff "),
    ("⇒", "\\implies "),
    ("∅", "\\varnothing "),
    ("∀", "\\forall "),
    ("∃", "\\exists "),
    ("∄", "\\nexists "),
    ("∈", "\\in "),
    ("∉", "\\notin "),
    ("∣", "\\mid "),
    ("∪", "\\cup "),
    ("∩", "\\cap "),
    ("→", "\\to "),
    ("↦", "\\mapsto "),
    ("𝔸", "\\mathbb{A}"),
    ("ℝ", "\\mathbb{R}"),
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    All,
    Equation,
    Text,
    Image,
}

impl Filter {
    fn kind(self) -> Option<&'static str> {
        match self {
            Filter::All => None,
            Filter::Equation => Some("equation"),
            Filter::Text => Some("text"),
            Filter::Image => Some("image"),
        }
    }
}

struct State {
    controller: Arc<Mutex<AppController>>,
    rows: RefCell<Vec<TopicView>>,
    by_id: RefCell<HashMap<String, TopicView>>,
    selected: RefCell<Option<String>>,
    filter: Cell<Filter>,
    query: RefCell<String>,
    dark: Cell<bool>,
    preview_source: RefCell<Option<glib::SourceId>>,
    rebuilding: Cell<bool>,
}

#[derive(Clone)]
struct Ui {
    window: adw::ApplicationWindow,
    toast: adw::ToastOverlay,
    header_title: adw::WindowTitle,
    store: gio::ListStore,
    selection: gtk::SingleSelection,
    summary: gtk::Label,
    editor_stack: gtk::Stack,
    topic_title: gtk::Label,
    crumb: gtk::Label,
    kind_label: gtk::Label,
    latex_view: gtk::TextView,
    preview_box: gtk::Box,
    preview_picture: gtk::Picture,
    preview_dims: gtk::Label,
    preview_error: gtk::Label,
    title_mode: gtk::DropDown,
    custom_title: gtk::Entry,
    apply_btn: gtk::Button,
    remove_btn: gtk::Button,
    export_svg: gtk::Button,
    export_png: gtk::Button,
    open_btn: gtk::Button,
    save_btn: gtk::Button,
    undo_btn: gtk::Button,
    redo_btn: gtk::Button,
    status_path: gtk::Label,
    status_badges: gtk::Box,
}

pub fn run() -> glib::ExitCode {
    let app = adw::Application::builder()
        .application_id(crate::APP_ID)
        .build();
    app.connect_startup(|_| load_css());
    app.connect_activate(build_ui);
    app.run()
}

fn load_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_data(CSS);
    if let Some(display) = gdk::Display::default() {
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}

fn build_ui(app: &adw::Application) {
    let style_manager = adw::StyleManager::default();
    let dark = style_manager.is_dark();

    let state = Rc::new(State {
        controller: Arc::new(Mutex::new(AppController::new())),
        rows: RefCell::new(Vec::new()),
        by_id: RefCell::new(HashMap::new()),
        selected: RefCell::new(None),
        filter: Cell::new(Filter::All),
        query: RefCell::new(String::new()),
        dark: Cell::new(dark),
        preview_source: RefCell::new(None),
        rebuilding: Cell::new(false),
    });

    // ---------------------------------------------------------------- finestra
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("XMind Equation Studio")
        .default_width(1240)
        .default_height(820)
        .build();

    let header = adw::HeaderBar::new();
    let header_title = adw::WindowTitle::new("XMind Equation Studio", "Nessun file aperto");
    header.set_title_widget(Some(&header_title));

    let open_btn = gtk::Button::from_icon_name("document-open-symbolic");
    open_btn.set_tooltip_text(Some("Apri un file .xmind (Ctrl+O)"));
    let save_btn = gtk::Button::with_label("Salva");
    save_btn.add_css_class("suggested-action");
    save_btn.set_tooltip_text(Some("Salva (Ctrl+S)"));
    let undo_btn = gtk::Button::from_icon_name("edit-undo-symbolic");
    undo_btn.set_tooltip_text(Some("Annulla (Ctrl+Z)"));
    let redo_btn = gtk::Button::from_icon_name("edit-redo-symbolic");
    redo_btn.set_tooltip_text(Some("Ripeti (Ctrl+Shift+Z)"));

    let menu = gio::Menu::new();
    let sec_file = gio::Menu::new();
    sec_file.append(Some("Salva con nome"), Some("win.save-as"));
    menu.append_section(None, &sec_file);
    let sec_topic = gio::Menu::new();
    sec_topic.append(Some("Esporta SVG"), Some("win.export-svg"));
    sec_topic.append(Some("Esporta PNG"), Some("win.export-png"));
    sec_topic.append(Some("Rimuovi equazione"), Some("win.remove"));
    menu.append_section(None, &sec_topic);
    let sec_app = gio::Menu::new();
    sec_app.append(Some("Tema chiaro/scuro"), Some("win.theme-toggle"));
    sec_app.append(Some("Informazioni"), Some("win.about"));
    menu.append_section(None, &sec_app);
    let menu_btn = gtk::MenuButton::builder()
        .icon_name("open-menu-symbolic")
        .menu_model(&menu)
        .build();

    header.pack_start(&open_btn);
    header.pack_end(&menu_btn);
    header.pack_end(&redo_btn);
    header.pack_end(&undo_btn);
    header.pack_end(&save_btn);

    // ------------------------------------------------------------ pannello sx
    let search = gtk::SearchEntry::new();
    search.set_placeholder_text(Some("Cerca un blocco…"));

    let filter_box = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    filter_box.add_css_class("linked");
    filter_box.set_halign(gtk::Align::Start);
    let mut filter_buttons: Vec<gtk::ToggleButton> = Vec::new();
    for (f, label) in [
        (Filter::All, "Tutti"),
        (Filter::Equation, "Equazioni"),
        (Filter::Text, "Testo"),
        (Filter::Image, "Immagini"),
    ] {
        let b = gtk::ToggleButton::with_label(label);
        if let Some(first) = filter_buttons.first() {
            b.set_group(Some(first));
        }
        if f == Filter::All {
            b.set_active(true);
        }
        filter_box.append(&b);
        filter_buttons.push(b);
    }

    let summary = gtk::Label::new(Some("0 blocchi"));
    summary.set_xalign(0.0);
    summary.add_css_class("dim-label");
    summary.add_css_class("caption");

    let store = gio::ListStore::new::<gtk::StringObject>();
    let selection = gtk::SingleSelection::new(Some(store.clone()));
    selection.set_autoselect(false);
    selection.set_can_unselect(true);

    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, item| {
        let Some(li) = item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        let label = gtk::Label::new(None);
        label.set_xalign(0.0);
        label.set_ellipsize(pango::EllipsizeMode::End);
        li.set_child(Some(&label));
    });
    {
        let state = state.clone();
        factory.connect_bind(move |_, item| {
            let Some(li) = item.downcast_ref::<gtk::ListItem>() else {
                return;
            };
            let Some(label) = li.child().and_then(|c| c.downcast::<gtk::Label>().ok()) else {
                return;
            };
            let Some(obj) = li.item().and_then(|o| o.downcast::<gtk::StringObject>().ok()) else {
                return;
            };
            let id = obj.string().to_string();
            let by_id = state.by_id.borrow();
            let Some(tv) = by_id.get(&id) else {
                label.set_label("");
                return;
            };
            let marker = match tv.kind {
                "equation" => "ƒ",
                "image" => "▣",
                _ => "•",
            };
            let group = if tv.group != "attached" && tv.group != "root" {
                format!("   [{}]", tv.group)
            } else {
                String::new()
            };
            label.set_label(&format!("{marker}  {}{}", tv.display_title, group));
            label.set_margin_start(tv.depth as i32 * 16);
            label.set_tooltip_text(Some(&if tv.path.is_empty() {
                tv.display_title.clone()
            } else {
                tv.path.join(" › ")
            }));
            if tv.kind == "equation" {
                label.add_css_class("eq-row");
            } else {
                label.remove_css_class("eq-row");
            }
        });
    }

    let list = gtk::ListView::new(Some(selection.clone()), Some(factory));
    list.add_css_class("navigation-sidebar");
    let list_scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&list)
        .build();

    let left = gtk::Box::new(gtk::Orientation::Vertical, 8);
    left.set_size_request(300, -1);
    left.set_margin_top(8);
    left.set_margin_bottom(8);
    left.set_margin_start(8);
    left.set_margin_end(8);
    left.append(&search);
    left.append(&filter_box);
    left.append(&summary);
    left.append(&list_scroll);

    // ------------------------------------------------------------ pannello dx
    let topic_title = gtk::Label::new(None);
    topic_title.set_xalign(0.0);
    topic_title.set_wrap(true);
    topic_title.add_css_class("title-3");
    let crumb = gtk::Label::new(None);
    crumb.set_xalign(0.0);
    crumb.add_css_class("dim-label");
    crumb.add_css_class("caption");
    let kind_label = gtk::Label::new(None);
    kind_label.add_css_class("kind-badge");
    kind_label.set_valign(gtk::Align::Start);

    let titles = gtk::Box::new(gtk::Orientation::Vertical, 2);
    titles.set_hexpand(true);
    titles.append(&topic_title);
    titles.append(&crumb);
    let head = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    head.append(&titles);
    head.append(&kind_label);

    let latex_label = gtk::Label::new(Some("Formula LaTeX"));
    latex_label.set_xalign(0.0);
    latex_label.add_css_class("dim-label");
    latex_label.add_css_class("caption");

    let latex_view = gtk::TextView::new();
    latex_view.set_monospace(true);
    latex_view.set_wrap_mode(gtk::WrapMode::WordChar);
    latex_view.set_top_margin(8);
    latex_view.set_bottom_margin(8);
    latex_view.set_left_margin(8);
    latex_view.set_right_margin(8);
    let latex_scroll = gtk::ScrolledWindow::builder()
        .min_content_height(96)
        .child(&latex_view)
        .build();
    latex_scroll.add_css_class("card");

    let snippets = gtk::FlowBox::new();
    snippets.set_selection_mode(gtk::SelectionMode::None);
    snippets.set_max_children_per_line(20);
    snippets.set_column_spacing(4);
    snippets.set_row_spacing(4);
    for &(label, tex) in SNIPPETS.iter() {
        let b = gtk::Button::with_label(label);
        b.add_css_class("flat");
        b.set_tooltip_text(Some(tex));
        let view = latex_view.clone();
        let tex = tex.to_string();
        b.connect_clicked(move |_| {
            let buf = view.buffer();
            let mut iter = buf.iter_at_mark(&buf.get_insert());
            buf.insert(&mut iter, &tex);
            view.grab_focus();
        });
        snippets.append(&b);
    }

    let preview_title = gtk::Label::new(Some("Anteprima"));
    preview_title.set_xalign(0.0);
    preview_title.set_hexpand(true);
    preview_title.add_css_class("dim-label");
    preview_title.add_css_class("caption");
    let preview_dims = gtk::Label::new(None);
    preview_dims.add_css_class("dim-label");
    preview_dims.add_css_class("caption");
    preview_dims.add_css_class("mono");
    let preview_head = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    preview_head.append(&preview_title);
    preview_head.append(&preview_dims);

    let preview_error = gtk::Label::new(None);
    preview_error.set_xalign(0.0);
    preview_error.set_wrap(true);
    preview_error.set_visible(false);
    preview_error.add_css_class("error");

    let preview_picture = gtk::Picture::new();
    preview_picture.set_can_shrink(true);
    preview_picture.set_halign(gtk::Align::Start);

    let preview_box = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    preview_box.add_css_class("eq-preview");
    preview_box.add_css_class(if dark {
        "eq-preview-dark"
    } else {
        "eq-preview-light"
    });
    preview_box.set_visible(false);
    preview_box.append(&preview_picture);

    let preview_frame = gtk::Box::new(gtk::Orientation::Vertical, 8);
    preview_frame.add_css_class("card");
    preview_frame.append(&preview_head);
    preview_frame.append(&preview_error);
    preview_frame.append(&preview_box);

    let tm_label = gtk::Label::new(Some("Titolo del blocco"));
    tm_label.set_xalign(0.0);
    tm_label.add_css_class("dim-label");
    tm_label.add_css_class("caption");
    let title_mode = gtk::DropDown::from_strings(&[
        "Solo formula (nasconde il testo)",
        "Mantieni il titolo attuale",
        "Titolo personalizzato",
    ]);
    title_mode.set_selected(0);
    let custom_title = gtk::Entry::new();
    custom_title.set_placeholder_text(Some("Nuovo titolo"));
    custom_title.set_sensitive(false);
    let tm_row = gtk::Box::new(gtk::Orientation::Vertical, 6);
    tm_row.append(&tm_label);
    tm_row.append(&title_mode);
    tm_row.append(&custom_title);

    let apply_btn = gtk::Button::with_label("Applica");
    apply_btn.add_css_class("suggested-action");
    apply_btn.set_tooltip_text(Some("Applica (Ctrl+Enter)"));
    let remove_btn = gtk::Button::with_label("Rimuovi equazione");
    remove_btn.add_css_class("destructive-action");
    let export_svg = gtk::Button::with_label("Esporta SVG");
    let export_png = gtk::Button::with_label("Esporta PNG");
    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    actions.append(&apply_btn);
    actions.append(&remove_btn);
    let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    actions.append(&spacer);
    actions.append(&export_svg);
    actions.append(&export_png);

    let note = gtk::Label::new(Some(
        "«Applica» modifica solo in memoria: usa Salva per scrivere il file. \
         Puoi applicare più formule di seguito prima di salvare.",
    ));
    note.set_xalign(0.0);
    note.set_wrap(true);
    note.add_css_class("dim-label");
    note.add_css_class("caption");

    let editor = gtk::Box::new(gtk::Orientation::Vertical, 12);
    editor.set_margin_top(14);
    editor.set_margin_bottom(14);
    editor.set_margin_start(16);
    editor.set_margin_end(16);
    editor.append(&head);
    editor.append(&latex_label);
    editor.append(&latex_scroll);
    editor.append(&snippets);
    editor.append(&preview_frame);
    editor.append(&tm_row);
    editor.append(&actions);
    editor.append(&note);

    let editor_scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&editor)
        .build();

    let empty = gtk::Box::new(gtk::Orientation::Vertical, 6);
    empty.set_valign(gtk::Align::Center);
    empty.set_halign(gtk::Align::Center);
    empty.set_vexpand(true);
    let empty1 = gtk::Label::new(Some(
        "Seleziona un blocco a sinistra per inserire o modificare una formula LaTeX.",
    ));
    empty1.set_wrap(true);
    empty1.set_justify(gtk::Justification::Center);
    empty1.set_max_width_chars(46);
    let empty2 = gtk::Label::new(Some(
        "La formula viene scritta nel formato nativo di XMind: resta modificabile \
         cliccandoci sopra dentro XMind.",
    ));
    empty2.set_wrap(true);
    empty2.set_justify(gtk::Justification::Center);
    empty2.set_max_width_chars(52);
    empty2.add_css_class("dim-label");
    empty.append(&empty1);
    empty.append(&empty2);

    let editor_stack = gtk::Stack::new();
    editor_stack.set_transition_type(gtk::StackTransitionType::Crossfade);
    editor_stack.add_named(&empty, Some("empty"));
    editor_stack.add_named(&editor_scroll, Some("editor"));
    editor_stack.set_visible_child_name("empty");

    let paned = gtk::Paned::new(gtk::Orientation::Horizontal);
    paned.set_start_child(Some(&left));
    paned.set_end_child(Some(&editor_stack));
    paned.set_position(360);
    paned.set_resize_start_child(false);
    paned.set_shrink_start_child(false);
    paned.set_hexpand(true);
    paned.set_vexpand(true);

    // --------------------------------------------------------------- statusbar
    let status_path = gtk::Label::new(Some("Nessun file aperto"));
    status_path.set_xalign(0.0);
    status_path.set_ellipsize(pango::EllipsizeMode::Middle);
    status_path.add_css_class("dim-label");
    status_path.add_css_class("caption");
    let status_badges = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let status_left = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    status_left.append(&status_path);
    status_left.append(&status_badges);
    let status_spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    status_spacer.set_hexpand(true);
    let status_bar = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    status_bar.set_margin_top(4);
    status_bar.set_margin_bottom(4);
    status_bar.set_margin_start(10);
    status_bar.set_margin_end(10);
    status_bar.append(&status_left);
    status_bar.append(&status_spacer);
    status_bar.add_css_class("dim-label");

    let toast = adw::ToastOverlay::new();
    let toolbar_view = adw::ToolbarView::new();
    toolbar_view.add_top_bar(&header);
    toolbar_view.set_content(Some(&paned));
    toolbar_view.add_bottom_bar(&status_bar);
    toast.set_child(Some(&toolbar_view));
    window.set_content(Some(&toast));
    window.present();

    let ui = Rc::new(Ui {
        window,
        toast,
        header_title,
        store,
        selection: selection.clone(),
        summary,
        editor_stack,
        topic_title,
        crumb,
        kind_label,
        latex_view: latex_view.clone(),
        preview_box,
        preview_picture,
        preview_dims,
        preview_error,
        title_mode: title_mode.clone(),
        custom_title: custom_title.clone(),
        apply_btn: apply_btn.clone(),
        remove_btn: remove_btn.clone(),
        export_svg: export_svg.clone(),
        export_png: export_png.clone(),
        open_btn: open_btn.clone(),
        save_btn: save_btn.clone(),
        undo_btn: undo_btn.clone(),
        redo_btn: redo_btn.clone(),
        status_path,
        status_badges,
    });

    // --------------------------------------------------------------- segnali
    {
        let ui = ui.clone();
        let state = state.clone();
        selection.connect_selected_notify(move |sel| {
            if state.rebuilding.get() {
                return;
            }
            let id = sel
                .selected_item()
                .and_then(|o| o.downcast::<gtk::StringObject>().ok())
                .map(|s| s.string().to_string());
            *state.selected.borrow_mut() = id;
            update_editor(&ui, &state);
            schedule_preview(&ui, &state);
        });
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        search.connect_search_changed(move |e| {
            *state.query.borrow_mut() = e.text().to_string();
            let wb = state.controller.lock().unwrap().workbook();
            rebuild_list(&ui, &state, wb.as_ref());
        });
    }
    for (b, f) in filter_buttons.iter().zip([
        Filter::All,
        Filter::Equation,
        Filter::Text,
        Filter::Image,
    ]) {
        let ui = ui.clone();
        let state = state.clone();
        b.connect_toggled(move |btn| {
            if !btn.is_active() {
                return;
            }
            state.filter.set(f);
            let wb = state.controller.lock().unwrap().workbook();
            rebuild_list(&ui, &state, wb.as_ref());
        });
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        latex_view.buffer().connect_changed(move |_| {
            schedule_preview(&ui, &state);
        });
    }
    {
        let ui = ui.clone();
        title_mode.connect_selected_notify(move |dd| {
            ui.custom_title.set_sensitive(dd.selected() == 2);
        });
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        apply_btn.connect_clicked(move |_| do_apply(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        remove_btn.connect_clicked(move |_| do_remove(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        export_svg.connect_clicked(move |_| do_export(&ui, &state, "svg"));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        export_png.connect_clicked(move |_| do_export(&ui, &state, "png"));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        open_btn.connect_clicked(move |_| choose_open(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        save_btn.connect_clicked(move |_| do_save(&ui, &state, false));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        undo_btn.connect_clicked(move |_| do_undo(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        redo_btn.connect_clicked(move |_| do_redo(&ui, &state));
    }

    // ------------------------------------------------------------- azioni/accel
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "open", &["<Control>o"], move || {
            choose_open(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "save", &["<Control>s"], move || {
            do_save(&ui, &state, false)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "save-as", &["<Control><Shift>s"], move || {
            choose_save_as(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "undo", &["<Control>z"], move || {
            do_undo(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(
            app,
            &win,
            "redo",
            &["<Control><Shift>z", "<Control>y"],
            move || do_redo(&ui, &state),
        );
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "apply", &["<Control>Return"], move || {
            do_apply(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "remove", &[], move || do_remove(&ui, &state));
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "export-svg", &[], move || {
            do_export(&ui, &state, "svg")
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "export-png", &[], move || {
            do_export(&ui, &state, "png")
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "theme-toggle", &[], move || {
            toggle_theme(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        add_action(app, &win, "about", &[], move || show_about(&ui));
    }

    refresh(&ui, &state);

    // Preparazione del renderer fuori dal main loop (estrazione una tantum).
    {
        let controller = state.controller.clone();
        let ui = ui.clone();
        let state = state.clone();
        spawn_blocking(
            move || controller.lock().unwrap().prepare_renderer(),
            move |_| refresh(&ui, &state),
        );
    }
}

fn add_action<F>(app: &adw::Application, window: &adw::ApplicationWindow, name: &str, accels: &[&str], f: F)
where
    F: Fn() + 'static,
{
    let action = gio::SimpleAction::new(name, None);
    action.connect_activate(move |_, _| f());
    window.add_action(&action);
    app.set_accels_for_action(&format!("win.{name}"), accels);
}

// -------------------------------------------------------------------- helpers

fn editor_text(view: &gtk::TextView) -> String {
    let buf = view.buffer();
    buf.text(&buf.start_iter(), &buf.end_iter(), false).to_string()
}

fn spawn_blocking<T, F, D>(work: F, done: D)
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
    D: FnOnce(T) + 'static,
{
    let (tx, rx) = async_channel::bounded(1);
    std::thread::spawn(move || {
        let _ = tx.send_blocking(work());
    });
    glib::MainContext::default().spawn_local(async move {
        if let Ok(value) = rx.recv().await {
            done(value);
        }
    });
}

fn badge(text: &str, class: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("badge");
    label.add_css_class(class);
    label
}

fn toast(ui: &Ui, text: &str) {
    ui.toast.add_toast(adw::Toast::new(text));
}

// -------------------------------------------------------------------- refresh

fn refresh(ui: &Rc<Ui>, state: &Rc<State>) {
    let (wb, status) = {
        let controller = state.controller.lock().unwrap();
        (controller.workbook(), controller.status())
    };
    rebuild_list(ui, state, wb.as_ref());
    update_editor(ui, state);
    update_status(ui, &status);
}

fn rebuild_list(ui: &Rc<Ui>, state: &Rc<State>, wb: Option<&WorkbookDto>) {
    let all: Vec<TopicView> = wb
        .map(|w| {
            w.sheets
                .iter()
                .flat_map(|s| s.topics.iter().cloned())
                .collect()
        })
        .unwrap_or_default();

    let query = state.query.borrow().to_lowercase();
    let filter = state.filter.get();
    let matches = |t: &TopicView| {
        if let Some(kind) = filter.kind() {
            if t.kind != kind {
                return false;
            }
        }
        if query.is_empty() {
            return true;
        }
        t.display_title.to_lowercase().contains(&query)
            || t.title.to_lowercase().contains(&query)
            || t.latex.as_deref().unwrap_or("").to_lowercase().contains(&query)
            || t.path.join(" › ").to_lowercase().contains(&query)
    };

    let by_id: HashMap<&str, &TopicView> = all.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut visible: HashSet<String> = HashSet::new();
    for t in &all {
        if !matches(t) {
            continue;
        }
        let mut cur = Some(t);
        while let Some(c) = cur {
            visible.insert(c.id.clone());
            cur = c.parent_id.as_deref().and_then(|p| by_id.get(p).copied());
        }
    }
    let rows: Vec<TopicView> = all
        .iter()
        .filter(|t| visible.contains(&t.id))
        .cloned()
        .collect();

    *state.rows.borrow_mut() = rows.clone();
    *state.by_id.borrow_mut() = all.iter().map(|t| (t.id.clone(), t.clone())).collect();

    let previous = state.selected.borrow().clone();
    state.rebuilding.set(true);
    ui.store.remove_all();
    for row in &rows {
        ui.store.append(&gtk::StringObject::new(&row.id));
    }
    match previous {
        Some(id) => match rows.iter().position(|r| r.id == id) {
            Some(index) => ui.selection.set_selected(index as u32),
            None => {
                ui.selection.set_selected(gtk::INVALID_LIST_POSITION);
                *state.selected.borrow_mut() = None;
            }
        },
        None => ui.selection.set_selected(gtk::INVALID_LIST_POSITION),
    }
    state.rebuilding.set(false);

    ui.summary
        .set_label(&format!("{} / {} blocchi", rows.len(), all.len()));
}

fn update_editor(ui: &Rc<Ui>, state: &Rc<State>) {
    let selected = state.selected.borrow().clone();
    let topic = selected.and_then(|id| state.by_id.borrow().get(&id).cloned());

    let Some(topic) = topic else {
        ui.editor_stack.set_visible_child_name("empty");
        return;
    };

    ui.editor_stack.set_visible_child_name("editor");
    ui.topic_title.set_label(if topic.title.is_empty() {
        "(titolo vuoto)"
    } else {
        &topic.title
    });
    ui.crumb.set_label(&if topic.path.is_empty() {
        "Radice".to_string()
    } else {
        topic.path.join(" › ")
    });
    ui.kind_label.set_label(topic.kind);
    ui.kind_label.remove_css_class("eq-row");
    if topic.kind == "equation" {
        ui.kind_label.add_css_class("eq-row");
    }

    let buf = ui.latex_view.buffer();
    let desired = topic.latex.clone().unwrap_or_default();
    if editor_text(&ui.latex_view) != desired {
        buf.set_text(&desired);
    }

    let has_equation = topic.kind == "equation";
    ui.remove_btn.set_sensitive(has_equation);
    ui.export_svg.set_sensitive(has_equation);
    ui.export_png.set_sensitive(has_equation);
}

fn update_status(ui: &Rc<Ui>, status: &StatusDto) {
    ui.header_title
        .set_subtitle(status.file_name.as_deref().unwrap_or("Nessun file aperto"));
    ui.status_path
        .set_label(status.path.as_deref().unwrap_or("Nessun file aperto"));

    while let Some(child) = ui.status_badges.first_child() {
        ui.status_badges.remove(&child);
    }
    if status.dirty {
        ui.status_badges.append(&badge("modifiche non salvate", "warning"));
    }
    if !status.xmind_running.is_empty() {
        let b = badge("XMind è aperto — salvataggio bloccato", "error");
        b.set_tooltip_text(Some(&status.xmind_running.join("\n")));
        ui.status_badges.append(&b);
    }
    if status.conflict {
        ui.status_badges.append(&badge("file modificato su disco", "error"));
    }
    if status.renderer_checked && !status.renderer_ready {
        let b = badge("renderer MathJax assente", "error");
        b.set_tooltip_text(status.renderer_error.as_deref());
        ui.status_badges.append(&b);
    }

    ui.save_btn.set_sensitive(status.has_workbook);
    ui.undo_btn.set_sensitive(status.can_undo);
    ui.redo_btn.set_sensitive(status.can_redo);
}

// -------------------------------------------------------------------- preview

#[derive(Default)]
struct PreviewRender {
    png: Option<Vec<u8>>,
    width: f64,
    height: f64,
    error: Option<String>,
}

fn clear_preview(ui: &Ui) {
    ui.preview_picture.set_paintable(None::<&gdk::Texture>);
    ui.preview_error.set_visible(false);
    ui.preview_dims.set_label("");
}

fn schedule_preview(ui: &Rc<Ui>, state: &Rc<State>) {
    if let Some(source) = state.preview_source.borrow_mut().take() {
        source.remove();
    }
    let ui_run = ui.clone();
    let state_run = state.clone();
    let state_clear = state.clone();
    let id = glib::timeout_add_local_once(std::time::Duration::from_millis(220), move || {
        *state_clear.preview_source.borrow_mut() = None;
        run_preview(&ui_run, &state_run);
    });
    *state.preview_source.borrow_mut() = Some(id);
}

fn run_preview(ui: &Rc<Ui>, state: &Rc<State>) {
    let latex = editor_text(&ui.latex_view);
    if latex.trim().is_empty() {
        ui.preview_box.set_visible(false);
        clear_preview(ui);
        return;
    }
    ui.preview_box.set_visible(true);

    let color = if state.dark.get() { "#ffffff" } else { "#000000" }.to_string();
    let controller = state.controller.clone();
    let ui = ui.clone();
    spawn_blocking(
        move || -> Result<PreviewRender, ErrorPayload> {
            let mut controller = controller.lock().unwrap();
            let preview = controller.preview(&latex, Some(DEFAULT_EM_PX))?;
            if let Some(err) = preview.error {
                return Ok(PreviewRender {
                    error: Some(err),
                    ..Default::default()
                });
            }
            let png = raster::svg_to_png(&preview.svg, preview.width, preview.height, 2.0, &color)
                .map_err(|e| ErrorPayload::new(crate::error::CODE_LATEX, format!("{e:#}")))?;
            Ok(PreviewRender {
                png: Some(png),
                width: preview.width,
                height: preview.height,
                error: None,
            })
        },
        move |result| match result {
            Ok(render) if render.error.is_some() => {
                ui.preview_picture.set_paintable(None::<&gdk::Texture>);
                ui.preview_error
                    .set_label(&format!("Errore LaTeX: {}", render.error.unwrap()));
                ui.preview_error.set_visible(true);
                ui.preview_dims.set_label("");
            }
            Ok(render) if render.png.is_some() => {
                let bytes = glib::Bytes::from_owned(render.png.unwrap());
                match gdk::Texture::from_bytes(&bytes) {
                    Ok(texture) => ui.preview_picture.set_paintable(Some(&texture)),
                    Err(_) => ui.preview_picture.set_paintable(None::<&gdk::Texture>),
                }
                ui.preview_error.set_visible(false);
                ui.preview_dims
                    .set_label(&format!("{} × {} px", render.width.round(), render.height.round()));
            }
            Ok(_) => clear_preview(&ui),
            Err(e) => {
                ui.preview_picture.set_paintable(None::<&gdk::Texture>);
                ui.preview_error.set_label(&e.message);
                ui.preview_error.set_visible(true);
                ui.preview_dims.set_label("");
            }
        },
    );
}

// ----------------------------------------------------------------- operazioni

fn set_busy(ui: &Ui, busy: bool, label: &str) {
    ui.apply_btn.set_sensitive(!busy);
    ui.apply_btn.set_label(label);
    ui.open_btn.set_sensitive(!busy);
    ui.save_btn.set_sensitive(!busy);
    if !busy {
        ui.remove_btn.set_sensitive(false);
    }
}

fn do_apply(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let latex = editor_text(&ui.latex_view);
    if latex.trim().is_empty() {
        toast(ui, "La formula è vuota.");
        return;
    }
    let title_mode = match ui.title_mode.selected() {
        1 => TitleMode::KeepTitle,
        2 => TitleMode::Custom {
            title: ui.custom_title.text().to_string(),
        },
        _ => TitleMode::FormulaOnly,
    };

    set_busy(ui, true, "Rendering…");
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().apply(&topic_id, &latex, title_mode),
        move |result| {
            set_busy(&ui, false, "Applica");
            match result {
                Ok(_) => {
                    refresh(&ui, &state);
                    toast(&ui, "Equazione applicata");
                }
                Err(e) => show_error(&ui, "Impossibile applicare l'equazione", &e.message),
            }
        },
    );
}

fn do_remove(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        return;
    };
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().remove_equation(&topic_id, None),
        move |result| match result {
            Ok(_) => {
                refresh(&ui, &state);
                toast(&ui, "Equazione rimossa");
            }
            Err(e) => show_error(&ui, "Rimozione non riuscita", &e.message),
        },
    );
}

fn do_undo(ui: &Rc<Ui>, state: &Rc<State>) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().undo(),
        move |result| match result {
            Ok(_) => refresh(&ui, &state),
            Err(e) => show_error(&ui, "Annullamento non riuscito", &e.message),
        },
    );
}

fn do_redo(ui: &Rc<Ui>, state: &Rc<State>) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().redo(),
        move |result| match result {
            Ok(_) => refresh(&ui, &state),
            Err(e) => show_error(&ui, "Ripetizione non riuscita", &e.message),
        },
    );
}

fn do_save(ui: &Rc<Ui>, state: &Rc<State>, force: bool) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().save(force),
        move |result| match result {
            Ok(outcome) => {
                refresh(&ui, &state);
                toast(&ui, &format!("Salvato — {} byte", outcome.bytes));
            }
            Err(e) if e.code == CODE_XMIND_RUNNING || e.code == CODE_CONFLICT => {
                confirm_force(&ui, &state, &e);
            }
            Err(e) => show_error(&ui, "Salvataggio non riuscito", &e.message),
        },
    );
}

fn confirm_force(ui: &Rc<Ui>, state: &Rc<State>, err: &ErrorPayload) {
    let dialog = adw::MessageDialog::builder()
        .transient_for(&ui.window)
        .heading("Procedere comunque?")
        .body(err.message.as_str())
        .build();
    dialog.add_response("cancel", "Annulla");
    dialog.add_response("force", "Forza salvataggio");
    dialog.set_response_appearance("force", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");
    let ui = ui.clone();
    let state = state.clone();
    dialog.connect_response(None, move |_dialog, response| {
        if response == "force" {
            do_save(&ui, &state, true);
        }
    });
    dialog.present();
}

fn choose_open(ui: &Rc<Ui>, state: &Rc<State>) {
    let dialog = gtk::FileDialog::builder()
        .title("Apri mappa XMind")
        .modal(true)
        .build();
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("File XMind"));
    filter.add_pattern("*.xmind");
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    dialog.set_filters(Some(&filters));
    dialog.set_default_filter(Some(&filter));

    let win = ui.window.clone();
    let ui = ui.clone();
    let state = state.clone();
    dialog.open(Some(&win), None::<&gio::Cancellable>, move |result| {
        if let Ok(file) = result {
            if let Some(path) = file.path() {
                open_path(&ui, &state, path);
            }
        }
    });
}

fn open_path(ui: &Rc<Ui>, state: &Rc<State>, path: PathBuf) {
    let path = path.display().to_string();
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().open(&path),
        move |result| match result {
            Ok(_) => {
                *state.selected.borrow_mut() = None;
                refresh(&ui, &state);
                toast(&ui, "File aperto");
            }
            Err(e) => show_error(&ui, "Apertura non riuscita", &e.message),
        },
    );
}

fn choose_save_as(ui: &Rc<Ui>, state: &Rc<State>) {
    let dialog = gtk::FileDialog::builder()
        .title("Salva con nome")
        .initial_name("mappa.equation-studio.xmind")
        .modal(true)
        .build();
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("File XMind"));
    filter.add_pattern("*.xmind");
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    dialog.set_filters(Some(&filters));
    dialog.set_default_filter(Some(&filter));

    let win = ui.window.clone();
    let ui = ui.clone();
    let state = state.clone();
    dialog.save(Some(&win), None::<&gio::Cancellable>, move |result| {
        let Ok(file) = result else {
            return;
        };
        let Some(path) = file.path() else {
            return;
        };
        let path = path.display().to_string();
        let controller = state.controller.clone();
        let ui = ui.clone();
        let state = state.clone();
        spawn_blocking(
            move || controller.lock().unwrap().save_as(&path, false),
            move |result| match result {
                Ok(outcome) => {
                    refresh(&ui, &state);
                    toast(&ui, &format!("Salvato in {}", outcome.path));
                }
                Err(e) if e.code == CODE_XMIND_RUNNING || e.code == CODE_CONFLICT => {
                    confirm_force(&ui, &state, &e);
                }
                Err(e) => show_error(&ui, "Salvataggio non riuscito", &e.message),
            },
        );
    });
}

fn do_export(ui: &Rc<Ui>, state: &Rc<State>, format: &str) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let dialog = gtk::FileDialog::builder()
        .title(if format == "svg" {
            "Esporta SVG"
        } else {
            "Esporta PNG"
        })
        .initial_name(format!("equazione.{format}"))
        .modal(true)
        .build();
    let filter = gtk::FileFilter::new();
    filter.set_name(Some(if format == "svg" { "SVG" } else { "PNG" }));
    filter.add_pattern(&format!("*.{format}"));
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    dialog.set_filters(Some(&filters));
    dialog.set_default_filter(Some(&filter));

    let format = format.to_string();
    let win = ui.window.clone();
    let ui = ui.clone();
    let state = state.clone();
    dialog.save(Some(&win), None::<&gio::Cancellable>, move |result| {
        let Ok(file) = result else {
            return;
        };
        let Some(path) = file.path() else {
            return;
        };
        let path = path.display().to_string();
        let controller = state.controller.clone();
        let ui = ui.clone();
        let topic_id = topic_id.clone();
        let format = format.clone();
        spawn_blocking(
            move || controller.lock().unwrap().export(&topic_id, &format, &path),
            move |result| match result {
                Ok(out) => toast(&ui, &format!("Esportato in {out}")),
                Err(e) => show_error(&ui, "Esportazione non riuscita", &e.message),
            },
        );
    });
}

fn toggle_theme(ui: &Rc<Ui>, state: &Rc<State>) {
    let manager = adw::StyleManager::default();
    let dark = !manager.is_dark();
    manager.set_color_scheme(if dark {
        adw::ColorScheme::ForceDark
    } else {
        adw::ColorScheme::ForceLight
    });
    state.dark.set(dark);
    if dark {
        ui.preview_box.add_css_class("eq-preview-dark");
        ui.preview_box.remove_css_class("eq-preview-light");
    } else {
        ui.preview_box.remove_css_class("eq-preview-dark");
        ui.preview_box.add_css_class("eq-preview-light");
    }
    schedule_preview(ui, state);
}

fn show_about(ui: &Ui) {
    let dialog = adw::MessageDialog::builder()
        .transient_for(&ui.window)
        .heading("XMind Equation Studio")
        .body(format!(
            "Versione {}\n\nEditor nativo (GTK4) per equazioni LaTeX in formato \
             XMind. Rendering MathJax identico a XMind, scrittura atomica e validata.",
            env!("CARGO_PKG_VERSION")
        ))
        .build();
    dialog.add_response("close", "Chiudi");
    dialog.set_default_response(Some("close"));
    dialog.set_close_response("close");
    dialog.present();
}

fn show_error(ui: &Ui, heading: &str, body: &str) {
    let dialog = adw::MessageDialog::builder()
        .transient_for(&ui.window)
        .heading(heading)
        .body(body)
        .build();
    dialog.add_response("close", "Chiudi");
    dialog.set_default_response(Some("close"));
    dialog.set_close_response("close");
    dialog.present();
}
