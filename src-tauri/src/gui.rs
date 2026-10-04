//! Interfaccia nativa GTK4 + libadwaita.
//!
//! Nessun webview: la lista dei blocchi è una `gtk::ListView`, l'editor è un
//! `gtk::TextView`, l'anteprima è una `gtk::Picture` alimentata con una texture
//! GDK prodotta dal backend (SVG MathJax → PNG con resvg). Le operazioni pesanti
//! (rendering MathJax, salvataggio, apertura) girano su un thread di lavoro e
//! rientrano nel main loop con `glib::MainContext::spawn_local`.

use crate::controller::{AppController, StatusDto, DEFAULT_EM_PX};
use crate::edit::MovePlacement;
use crate::equation::TitleMode;
use crate::error::{ErrorPayload, CODE_CONFLICT, CODE_XMIND_RUNNING};
use crate::markers;
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
.eq-preview { padding: 8px 10px; border-radius: 6px; }
.eq-preview-light { background: #ffffff; }
.eq-preview-dark { background: #1e1e1e; }
.kind-badge { padding: 1px 8px; border-radius: 20px; background: alpha(currentColor, 0.08); font-size: 12px; }
.badge { padding: 1px 8px; border-radius: 20px; font-size: 12px; }
.badge.warning { background: alpha(@warning_color, 0.2); color: @warning_color; }
.badge.error { background: alpha(@error_color, 0.2); color: @error_color; }
.mono { font-family: monospace; }
.eq-row { color: @accent_color; }
.delete-topic { color: @error_color; }
/* Feedback del trascinamento nell'albero: riannida o riordina. */
.drop-into { background: alpha(@accent_color, 0.22); border-radius: 6px; }
.drop-before { box-shadow: inset 0 2px 0 0 @accent_color; }
.drop-after { box-shadow: inset 0 -2px 0 0 @accent_color; }
"#;

/// Altezza minima della striscia di anteprima. Serve a riservare lo spazio
/// mentre il render è ancora in corso: la striscia viene mostrata subito, la
/// texture arriva ~220 ms dopo, e senza questo minimo l'altezza salterebbe.
const PREVIEW_MIN_HEIGHT: i32 = 56;

/// Altezza massima della striscia: oltre questa la formula viene ridotta per
/// stare nello spazio, così una matrice non si mangia mezza finestra.
const PREVIEW_MAX_HEIGHT: i32 = 160;

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
    /// Id del topic per ogni riga (widget) dell'albero, per il drag & drop: il
    /// `ListItem` non è un widget e non si risale dalla label. La chiave è il
    /// puntatore del widget, aggiornato a ogni bind (le righe sono riciclate).
    row_ids: RefCell<HashMap<usize, String>>,
    selected: RefCell<Option<String>>,
    filter: Cell<Filter>,
    query: RefCell<String>,
    dark: Cell<bool>,
    preview_source: RefCell<Option<glib::SourceId>>,
    rebuilding: Cell<bool>,
    /// Id del blocco in trascinamento; `None` fuori da un drag.
    dragging: RefCell<Option<String>>,
    /// Vero quando la finestra può chiudersi senza richiedere il salvataggio.
    closing: Cell<bool>,
    /// `Ui` è costruito dopo la lista (che ne ha bisogno per il drag & drop):
    /// il riferimento debole evita il ciclo `Ui → State → Ui`.
    ui: RefCell<Option<std::rc::Weak<Ui>>>,
}

#[derive(Clone)]
struct Ui {
    window: adw::ApplicationWindow,
    toast: adw::ToastOverlay,
    header_title: adw::WindowTitle,
    store: gio::ListStore,
    selection: gtk::SingleSelection,
    summary: gtk::Label,
    main_view_stack: gtk::Stack,
    map_view: crate::map_view::MapView,
    view_toggle_map: gtk::ToggleButton,
    view_toggle_text: gtk::ToggleButton,
    editor_stack: gtk::Stack,
    topic_title: gtk::Label,
    crumb: gtk::Label,
    kind_label: gtk::Label,
    latex_view: gtk::TextView,
    /// Divisore + striscia di anteprima: spariscono insieme a formula vuota.
    preview_section: gtk::Box,
    /// La striscia: porta le classi di tema scambiate da `toggle_theme`.
    preview_box: gtk::Box,
    preview_picture: gtk::Picture,
    preview_error: gtk::Label,
    title_mode: adw::ComboRow,
    custom_title: adw::EntryRow,
    options_row: adw::ExpanderRow,
    apply_btn: gtk::Button,
    add_topic_btn: gtk::Button,
    delete_btn: gtk::Button,
    topic_text: adw::EntryRow,
    // Contenuto ricco del blocco (Fase 1): note, etichette, marker, link.
    notes_view: gtk::TextView,
    notes_switch: adw::SwitchRow,
    notes_apply: gtk::Button,
    labels_entry: adw::EntryRow,
    href_entry: adw::EntryRow,
    markers_row: adw::ExpanderRow,
    markers_flow: gtk::FlowBox,
    marker_drop: gtk::DropDown,
    marker_add: gtk::Button,
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
        // `HANDLES_OPEN`: quando l'app viene lanciata con un file (doppio clic
        // nel file manager, `Exec=… %f` del .desktop) GApplication emette
        // `open` invece di `activate`, anche a istanza già avviata.
        .flags(gio::ApplicationFlags::HANDLES_OPEN)
        .build();
    app.connect_startup(|_| load_css());
    app.connect_activate(|app| {
        build_ui(app);
    });
    app.connect_open(|app, files, _hint| open_files(app, files));
    app.run()
}

/// Apre i file ricevuti dal file manager (uno per finestra).
///
/// Ogni file ottiene una finestra indipendente: così un'apertura esterna non
/// sovrascrive un lavoro con modifiche non salvate già presente in un'altra
/// finestra (regola: mai distruggere dati dell'utente).
fn open_files(app: &adw::Application, files: &[gio::File]) {
    let paths: Vec<PathBuf> = files.iter().filter_map(|file| file.path()).collect();
    if paths.is_empty() {
        // Percorso non locale (es. risorsa remota): nessun file da caricare,
        // ma almeno una finestra va mostrata.
        build_ui(app);
        return;
    }
    for path in paths {
        let (ui, state) = build_ui(app);
        open_path(&ui, &state, path);
    }
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

fn build_ui(app: &adw::Application) -> (Rc<Ui>, Rc<State>) {
    let style_manager = adw::StyleManager::default();
    let dark = style_manager.is_dark();

    let state = Rc::new(State {
        controller: Arc::new(Mutex::new(AppController::new())),
        rows: RefCell::new(Vec::new()),
        by_id: RefCell::new(HashMap::new()),
        row_ids: RefCell::new(HashMap::new()),
        selected: RefCell::new(None),
        filter: Cell::new(Filter::All),
        query: RefCell::new(String::new()),
        dark: Cell::new(dark),
        preview_source: RefCell::new(None),
        rebuilding: Cell::new(false),
        dragging: RefCell::new(None),
        closing: Cell::new(false),
        ui: RefCell::new(None),
    });

    // ---------------------------------------------------------------- finestra
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("XMap Studio")
        .default_width(1240)
        .default_height(820)
        .build();

    let header = adw::HeaderBar::new();
    let header_title = adw::WindowTitle::new("XMap Studio", "Nessun file aperto");
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
    let sec_io = gio::Menu::new();
    sec_io.append(Some("Esporta Markdown…"), Some("win.export-markdown"));
    sec_io.append(Some("Esporta OPML…"), Some("win.export-opml"));
    sec_io.append(Some("Importa Markdown/OPML…"), Some("win.import-outline"));
    menu.append_section(None, &sec_io);
    let sec_view = gio::Menu::new();
    sec_view.append(Some("Visualizza mappa (Ctrl+M)"), Some("win.map-preview"));
    menu.append_section(None, &sec_view);
    let sec_topic = gio::Menu::new();
    sec_topic.append(Some("Esporta SVG"), Some("win.export-svg"));
    sec_topic.append(Some("Esporta PNG"), Some("win.export-png"));
    sec_topic.append(Some("Rimuovi equazione"), Some("win.remove-equation"));
    menu.append_section(None, &sec_topic);
    // Sezione a parte: `gio::Menu` non sa marcare una voce come distruttiva, e
    // l'eliminazione non deve stare attaccata alle esportazioni.
    let sec_danger = gio::Menu::new();
    sec_danger.append(Some("Elimina blocco"), Some("win.delete-topic"));
    menu.append_section(None, &sec_danger);
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
    {
        let state = state.clone();
        factory.connect_setup(move |_, item| {
            let Some(li) = item.downcast_ref::<gtk::ListItem>() else {
                return;
            };
            let label = gtk::Label::new(None);
            label.set_xalign(0.0);
            label.set_ellipsize(pango::EllipsizeMode::End);
            // Riempi la riga: serve sia a un bersaglio di drop ampio, sia a un
            // rientro leggibile sui livelli profondi.
            label.set_hexpand(true);
            setup_topic_dnd(&label, &state);
            li.set_child(Some(&label));
        });
    }
    {
        let state = state.clone();
        factory.connect_bind(move |_, item| {
            let Some(li) = item.downcast_ref::<gtk::ListItem>() else {
                return;
            };
            let Some(label) = li.child().and_then(|c| c.downcast::<gtk::Label>().ok()) else {
                return;
            };
            // La riga può essere riciclata: via il feedback di drop precedente.
            label.remove_css_class("drop-into");
            label.remove_css_class("drop-before");
            label.remove_css_class("drop-after");
            let Some(obj) = li
                .item()
                .and_then(|o| o.downcast::<gtk::StringObject>().ok())
            else {
                return;
            };
            let id = obj.string().to_string();
            state
                .row_ids
                .borrow_mut()
                .insert(label.as_ptr() as usize, id.clone());
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
            let mut meta = String::new();
            if !tv.notes.is_empty() {
                meta.push_str("  ✎");
            }
            if !tv.labels.is_empty() {
                meta.push_str(&format!("  #{}", tv.labels.len()));
            }
            if !tv.markers.is_empty() {
                meta.push_str(&format!("  ⚑{}", tv.markers.len()));
            }
            if tv.href.is_some() {
                meta.push_str("  ↗");
            }
            label.set_label(&format!("{marker}  {}{}{}", tv.display_title, meta, group));
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

    // Unico comando strutturale che resta nella colonna: «Aggiungi sotto-blocco».
    // L'eliminazione, come le esportazioni e la rimozione dell'equazione, sta nel
    // menu ☰, dove non compete visivamente con il lavoro sulla formula.
    let add_topic_btn = gtk::Button::from_icon_name("list-add-symbolic");
    add_topic_btn.add_css_class("flat");
    add_topic_btn.set_valign(gtk::Align::Start);
    add_topic_btn.set_tooltip_text(Some("Aggiungi sotto-blocco (Ctrl+Shift+N)"));

    // L'eliminazione resta anche nel menu ☰, ma qui è a portata di mano e
    // colorata di rosso: è distruttiva, deve vedersi prima di premere.
    let delete_btn = gtk::Button::from_icon_name("user-trash-symbolic");
    delete_btn.add_css_class("flat");
    delete_btn.add_css_class("delete-topic");
    delete_btn.set_valign(gtk::Align::Start);
    delete_btn.set_tooltip_text(Some("Elimina il blocco e i suoi sotto-blocchi"));
    delete_btn.set_sensitive(false);

    let titles = gtk::Box::new(gtk::Orientation::Vertical, 2);
    titles.set_hexpand(true);
    titles.append(&topic_title);
    titles.append(&crumb);
    let head = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    head.append(&titles);
    head.append(&kind_label);
    head.append(&add_topic_btn);
    head.append(&delete_btn);

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
    latex_view.set_tooltip_text(Some("Formula LaTeX (MathJax). Ctrl+Enter per applicare."));
    let latex_scroll = gtk::ScrolledWindow::builder()
        .min_content_height(96)
        .child(&latex_view)
        .build();

    let preview_error = gtk::Label::new(None);
    preview_error.set_xalign(0.0);
    preview_error.set_wrap(true);
    preview_error.set_visible(false);
    preview_error.add_css_class("error");

    let preview_picture = gtk::Picture::new();
    preview_picture.set_can_shrink(true);
    // `ScaleDown` = rimpicciolisce per stare nello spazio, mai ingrandisce: con
    // il fit predefinito (`Contain`) la Picture si allargava a riempire la card
    // e si portava dietro un'altezza enorme per una formula minuscola.
    preview_picture.set_content_fit(gtk::ContentFit::ScaleDown);
    preview_picture.set_halign(gtk::Align::Center);
    preview_picture.set_valign(gtk::Align::Center);
    preview_picture.set_visible(false);

    // La striscia vive dentro la card della formula, subito sotto al testo che
    // si sta scrivendo: si aggiorna da sola ~220 ms dopo l'ultimo tasto
    // (`schedule_preview`). L'altezza la detta la formula, entro `PREVIEW_MAX_HEIGHT`:
    // il tetto lo applica `run_preview` scegliendo la scala di rasterizzazione,
    // così una matrice non si mangia mezza schermata e una formula piccola non
    // riempie la striscia di vuoto.
    let preview_box = gtk::Box::new(gtk::Orientation::Vertical, 4);
    preview_box.add_css_class("eq-preview");
    preview_box.add_css_class(if dark {
        "eq-preview-dark"
    } else {
        "eq-preview-light"
    });
    preview_box.set_visible(false);
    preview_box.set_size_request(-1, PREVIEW_MIN_HEIGHT);
    preview_box.set_valign(gtk::Align::Start);
    preview_box.set_margin_top(6);
    preview_box.set_margin_bottom(8);
    preview_box.set_margin_start(8);
    preview_box.set_margin_end(8);
    preview_box.append(&preview_error);
    preview_box.append(&preview_picture);

    // Il separatore sta dentro la sezione: a formula vuota sparisce con la
    // striscia, senza lasciare una riga orfana in fondo alla card.
    let preview_section = gtk::Box::new(gtk::Orientation::Vertical, 0);
    preview_section.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
    preview_section.append(&preview_box);
    preview_section.set_visible(false);

    let formula_card = gtk::Box::new(gtk::Orientation::Vertical, 0);
    formula_card.add_css_class("card");
    formula_card.append(&latex_scroll);
    formula_card.append(&preview_section);

    let topic_text = adw::EntryRow::new();
    topic_text.set_title("Testo del blocco");
    topic_text.set_show_apply_button(true);

    let title_mode = adw::ComboRow::new();
    title_mode.set_title("Titolo mostrato");
    title_mode.set_model(Some(&gtk::StringList::new(&[
        "Solo formula (nasconde il testo)",
        "Mantieni il titolo attuale",
        "Titolo personalizzato",
    ])));
    title_mode.set_selected(0);

    let custom_title = adw::EntryRow::new();
    custom_title.set_title("Titolo personalizzato");
    custom_title.set_sensitive(false);

    let options_row = adw::ExpanderRow::new();
    options_row.set_title("Testo e titolo del blocco");
    options_row.set_subtitle("Testo mostrato nel blocco e gestione del titolo");
    options_row.set_expanded(false);
    options_row.add_row(&topic_text);
    options_row.add_row(&title_mode);
    options_row.add_row(&custom_title);

    let options_group = adw::PreferencesGroup::new();
    options_group.set_margin_start(0);
    options_group.set_margin_end(0);
    options_group.add(&options_row);

    // ------------------------------------------------ contenuto ricco (Fase 1)
    // Note: XMind salva `plain` + `realHTML`; qui si scrive testo semplice e il
    // backend genera l'HTML escapato. Il testo resta nell'editor finché non si
    // preme «Salva note», perché scrivere a ogni tasto farebbe uno snapshot di
    // undo per battuta.
    let notes_view = gtk::TextView::new();
    notes_view.set_wrap_mode(gtk::WrapMode::WordChar);
    notes_view.set_top_margin(8);
    notes_view.set_bottom_margin(8);
    notes_view.set_left_margin(8);
    notes_view.set_right_margin(8);
    notes_view.set_tooltip_text(Some("Note del blocco (testo semplice)."));
    let notes_scroll = gtk::ScrolledWindow::builder()
        .min_content_height(96)
        .child(&notes_view)
        .build();

    let notes_switch = adw::SwitchRow::new();
    notes_switch.set_title("Mostra le note come blocco");
    notes_switch.set_subtitle("Spento: icona accanto al blocco (predefinito di XMind)");

    let notes_apply = gtk::Button::with_label("Salva note");
    notes_apply.add_css_class("flat");

    let notes_row = adw::ExpanderRow::new();
    notes_row.set_title("Note");
    notes_row.set_subtitle("Appunti estesi del blocco, visibili in XMind");
    notes_row.set_expanded(false);
    notes_row.add_row(&notes_scroll);
    notes_row.add_row(&notes_switch);
    notes_row.add_row(&notes_apply);

    let labels_entry = adw::EntryRow::new();
    labels_entry.set_title("Etichette");
    labels_entry.set_show_apply_button(true);
    labels_entry.set_tooltip_text(Some("Separate da virgola. Invio per confermare."));

    let href_entry = adw::EntryRow::new();
    href_entry.set_title("Link");
    href_entry.set_show_apply_button(true);
    href_entry.set_tooltip_text(Some(
        "https://… , mailto:… , file:… oppure #id di un blocco. Vuoto per rimuovere.",
    ));

    // Marker: catalogo completo in un menu a tendina + chip di quelli attivi.
    let mut marker_ids: Vec<String> = Vec::new();
    let mut marker_names: Vec<String> = Vec::new();
    for group in markers::GROUPS {
        for (id, name) in group.markers {
            marker_ids.push((*id).to_string());
            marker_names.push(format!("{} — {}", group.label, name));
        }
    }
    let marker_names_ref: Vec<&str> = marker_names.iter().map(String::as_str).collect();
    let marker_drop = gtk::DropDown::new(
        Some(gtk::StringList::new(&marker_names_ref)),
        None::<gtk::Expression>,
    );
    marker_drop.set_hexpand(true);
    marker_drop.set_tooltip_text(Some("Scegli un marker dal catalogo di XMind."));
    let marker_add = gtk::Button::with_label("Aggiungi");
    marker_add.add_css_class("flat");
    let marker_picker = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    marker_picker.append(&marker_drop);
    marker_picker.append(&marker_add);

    let markers_flow = gtk::FlowBox::new();
    markers_flow.set_selection_mode(gtk::SelectionMode::None);
    markers_flow.set_max_children_per_line(6);
    markers_flow.set_row_spacing(4);
    markers_flow.set_column_spacing(4);
    markers_flow.set_halign(gtk::Align::Start);

    let markers_row = adw::ExpanderRow::new();
    markers_row.set_title("Marker");
    markers_row.set_subtitle("Nessun marker");
    markers_row.set_expanded(false);
    markers_row.add_row(&marker_picker);
    markers_row.add_row(&markers_flow);

    let meta_group = adw::PreferencesGroup::new();
    meta_group.set_title("Contenuto del blocco");
    meta_group.add(&notes_row);
    meta_group.add(&labels_entry);
    meta_group.add(&markers_row);
    meta_group.add(&href_entry);

    let marker_ids = Rc::new(marker_ids);

    let apply_btn = gtk::Button::with_label("Applica");
    apply_btn.add_css_class("suggested-action");
    apply_btn.set_tooltip_text(Some(
        "Applica (Ctrl+Enter) — solo in memoria: usa Salva per scrivere il file",
    ));

    // Affordance di sicurezza dei dati: resta visibile, non solo nel tooltip.
    let note = gtk::Label::new(Some(
        "Modifica solo in memoria: usa Salva per scrivere il file.",
    ));
    note.set_xalign(0.0);
    note.set_wrap(true);
    note.set_hexpand(true);
    note.set_valign(gtk::Align::Center);
    note.add_css_class("dim-label");
    note.add_css_class("caption");
    note.set_tooltip_text(Some(
        "«Applica» non scrive il file: puoi applicare più formule di seguito prima di salvare.",
    ));

    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    actions.append(&apply_btn);
    actions.append(&note);

    let editor = gtk::Box::new(gtk::Orientation::Vertical, 12);
    // Contenuto di una ScrolledWindow: il viewport tende ad allungare il figlio
    // fino alla propria altezza, e l'anteprima si gonfiava con lui.
    editor.set_valign(gtk::Align::Start);
    editor.set_margin_top(14);
    editor.set_margin_bottom(14);
    editor.set_margin_start(16);
    editor.set_margin_end(16);
    editor.append(&head);
    editor.append(&latex_label);
    editor.append(&formula_card);
    editor.append(&actions);
    editor.append(&options_group);
    editor.append(&meta_group);

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

    // ------------------------------------------------------------ vista mappa
    let view_toggle_map = gtk::ToggleButton::builder()
        .label("Mappa")
        .icon_name("view-grid-symbolic")
        .active(true)
        .tooltip_text("Visualizza la mappa ad albero (Ctrl+M)")
        .build();
    let view_toggle_text = gtk::ToggleButton::builder()
        .label("Dettagli")
        .icon_name("document-properties-symbolic")
        .group(&view_toggle_map)
        .tooltip_text("Visualizza editor e dettagli del blocco")
        .build();
    let view_switcher = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    view_switcher.add_css_class("linked");
    view_switcher.append(&view_toggle_map);
    view_switcher.append(&view_toggle_text);
    header.pack_end(&view_switcher);

    let store_for_map = store.clone();
    let selection_for_map = selection.clone();
    let map_view = crate::map_view::MapView::new(move |id| {
        let n = store_for_map.n_items();
        for i in 0..n {
            if let Some(obj) = store_for_map
                .item(i)
                .and_then(|o| o.downcast::<gtk::StringObject>().ok())
            {
                if obj.string() == id {
                    selection_for_map.set_selected(i);
                    break;
                }
            }
        }
    });
    map_view.set_dark(dark);

    let main_view_stack = gtk::Stack::new();
    main_view_stack.set_transition_type(gtk::StackTransitionType::Crossfade);
    main_view_stack.add_named(map_view.widget(), Some("map"));
    main_view_stack.add_named(&editor_stack, Some("text"));
    main_view_stack.set_visible_child_name("map");

    {
        let stack = main_view_stack.clone();
        let map_v = map_view.clone();
        view_toggle_map.connect_toggled(move |btn| {
            if btn.is_active() {
                stack.set_visible_child_name("map");
                map_v.queue_draw();
            } else {
                stack.set_visible_child_name("text");
            }
        });
    }

    let paned = gtk::Paned::new(gtk::Orientation::Horizontal);
    paned.set_start_child(Some(&left));
    paned.set_end_child(Some(&main_view_stack));
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
        main_view_stack,
        map_view,
        view_toggle_map,
        view_toggle_text,
        editor_stack,
        topic_title,
        crumb,
        kind_label,
        latex_view: latex_view.clone(),
        preview_section,
        preview_box,
        preview_picture,
        preview_error,
        title_mode: title_mode.clone(),
        custom_title: custom_title.clone(),
        options_row: options_row.clone(),
        apply_btn: apply_btn.clone(),
        add_topic_btn: add_topic_btn.clone(),
        delete_btn: delete_btn.clone(),
        topic_text: topic_text.clone(),
        notes_view: notes_view.clone(),
        notes_switch: notes_switch.clone(),
        notes_apply: notes_apply.clone(),
        labels_entry: labels_entry.clone(),
        href_entry: href_entry.clone(),
        markers_row: markers_row.clone(),
        markers_flow: markers_flow.clone(),
        marker_drop: marker_drop.clone(),
        marker_add: marker_add.clone(),
        open_btn: open_btn.clone(),
        save_btn: save_btn.clone(),
        undo_btn: undo_btn.clone(),
        redo_btn: redo_btn.clone(),
        status_path,
        status_badges,
    });
    // Il drag & drop nella lista è armato prima che `Ui` esista: si registra
    // ora il riferimento debole usato da `perform_drop`.
    *state.ui.borrow_mut() = Some(Rc::downgrade(&ui));

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
            *state.selected.borrow_mut() = id.clone();
            ui.map_view.set_selected(id.as_deref());
            ui.map_view.scroll_to_selected();
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
    for (b, f) in
        filter_buttons
            .iter()
            .zip([Filter::All, Filter::Equation, Filter::Text, Filter::Image])
    {
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
        topic_text.connect_apply(move |_| do_save_text(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        notes_apply.connect_clicked(move |_| do_save_notes(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        labels_entry.connect_apply(move |_| do_save_labels(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        href_entry.connect_apply(move |_| do_save_href(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        let ids = marker_ids.clone();
        marker_add.connect_clicked(move |_| do_add_marker(&ui, &state, &ids));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        add_topic_btn.connect_clicked(move |_| do_add_topic(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        delete_btn.connect_clicked(move |_| confirm_delete_topic(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        let window = ui.window.clone();
        window.connect_close_request(move |window| confirm_close(window, &ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        open_btn.connect_clicked(move |_| choose_open(&ui, &state));
    }
    {
        let ui = ui.clone();
        let state = state.clone();
        save_btn.connect_clicked(move |_| do_save(&ui, &state, false, CloseAfter::No));
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
            do_save(&ui, &state, false, CloseAfter::No)
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
        add_action(app, &win, "add-topic", &["<Control><Shift>n"], move || {
            do_add_topic(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "remove-equation", &[], move || {
            do_remove(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "delete-topic", &[], move || {
            confirm_delete_topic(&ui, &state)
        });
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
        add_action(app, &win, "export-markdown", &[], move || {
            do_export_outline(&ui, &state, "markdown")
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "export-opml", &[], move || {
            do_export_outline(&ui, &state, "opml")
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        let state = state.clone();
        add_action(app, &win, "import-outline", &[], move || {
            do_import_outline(&ui, &state)
        });
    }
    {
        let win = ui.window.clone();
        let ui = ui.clone();
        add_action(app, &win, "map-preview", &["<Control>m"], move || {
            show_map_preview(&ui)
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

    (ui, state)
}

fn add_action<F>(
    app: &adw::Application,
    window: &adw::ApplicationWindow,
    name: &str,
    accels: &[&str],
    f: F,
) where
    F: Fn() + 'static,
{
    let action = gio::SimpleAction::new(name, None);
    action.connect_activate(move |_, _| f());
    window.add_action(&action);
    app.set_accels_for_action(&format!("win.{name}"), accels);
}

/// Attiva/disattiva una voce del menu ☰ legata al blocco selezionato.
///
/// L'azione si recupera per nome dalla action map della finestra, la stessa in
/// cui `add_action` la registra e da cui il menu risolve `win.*`: `Ui` viene
/// costruito prima delle azioni (che ne catturano il `Rc`), quindi non può
/// tenerne gli handle senza creare un ciclo.
fn set_action_enabled(ui: &Ui, name: &str, enabled: bool) {
    if let Some(action) = ui
        .window
        .lookup_action(name)
        .and_then(|a| a.downcast::<gio::SimpleAction>().ok())
    {
        action.set_enabled(enabled);
    }
}

// ------------------------------------------------------------------ drag&drop

/// Arma una riga dell'albero per il trascinamento: sorgente (sposta il blocco)
/// e bersaglio (decide se riannidare o riordinare in base a dove si rilascia).
fn setup_topic_dnd(label: &gtk::Label, state: &Rc<State>) {
    let drag = gtk::DragSource::new();
    drag.set_actions(gdk::DragAction::MOVE);
    {
        let state = state.clone();
        drag.connect_prepare(move |source, _, _| {
            let id = source
                .widget()
                .as_ref()
                .and_then(|w| list_item_id(w, &state))?;
            // La radice di una sheet non si sposta.
            if state.by_id.borrow().get(&id).map(|t| t.group.as_str()) == Some("root") {
                return None;
            }
            *state.dragging.borrow_mut() = Some(id.clone());
            Some(gdk::ContentProvider::for_value(&id.to_value()))
        });
    }
    {
        let state = state.clone();
        drag.connect_drag_end(move |_, _, _| {
            *state.dragging.borrow_mut() = None;
        });
    }
    label.add_controller(drag);

    let drop = gtk::DropTarget::new(glib::Type::STRING, gdk::DragAction::MOVE);
    {
        let state = state.clone();
        drop.connect_enter(move |target, _, y| drop_hover(target, y, &state));
    }
    {
        let state = state.clone();
        drop.connect_motion(move |target, _, y| drop_hover(target, y, &state));
    }
    drop.connect_leave(|target| set_drop_feedback(target, None));
    {
        let state = state.clone();
        drop.connect_drop(move |target, _value, _, y| perform_drop(target, y, &state));
    }
    label.add_controller(drop);
}

/// Id del topic associato a una riga dell'albero, via la mappa compilata in
/// fase di bind (`ListItem` non è un widget, quindi non si risale dalla label).
fn list_item_id(widget: &gtk::Widget, state: &State) -> Option<String> {
    state
        .row_ids
        .borrow()
        .get(&(widget.as_ptr() as usize))
        .cloned()
}

/// Vero se `candidate_id` discende da `ancestor_id`.
fn is_descendant(state: &State, ancestor_id: &str, candidate_id: &str) -> bool {
    let by_id = state.by_id.borrow();
    let mut current = by_id.get(candidate_id).and_then(|t| t.parent_id.clone());
    while let Some(parent) = current {
        if parent == ancestor_id {
            return true;
        }
        current = by_id.get(&parent).and_then(|t| t.parent_id.clone());
    }
    false
}

/// Terzo superiore = prima, terzo inferiore = dopo, centro = dentro.
fn drop_placement(y: f64, height: f64) -> MovePlacement {
    let edge = height.max(1.0) / 3.0;
    if y < edge {
        MovePlacement::Before
    } else if y > height - edge {
        MovePlacement::After
    } else {
        MovePlacement::Into
    }
}

/// Punto di rilascio valido per il drag in corso, o `None` se va rifiutato.
fn drop_plan(target: &gtk::DropTarget, y: f64, state: &State) -> Option<MovePlacement> {
    let target_id = target
        .widget()
        .as_ref()
        .and_then(|w| list_item_id(w, state))?;
    let source_id = state.dragging.borrow().clone()?;
    if source_id == target_id || is_descendant(state, &source_id, &target_id) {
        return None;
    }
    let group = state.by_id.borrow().get(&target_id)?.group.clone();
    let height = target.widget().map(|w| w.height() as f64).unwrap_or(1.0);
    let placement = drop_placement(y, height);
    if group == "root" && placement != MovePlacement::Into {
        return None;
    }
    Some(placement)
}

fn set_drop_feedback(target: &gtk::DropTarget, placement: Option<MovePlacement>) {
    let Some(widget) = target.widget() else {
        return;
    };
    widget.remove_css_class("drop-into");
    widget.remove_css_class("drop-before");
    widget.remove_css_class("drop-after");
    match placement {
        Some(MovePlacement::Into) => widget.add_css_class("drop-into"),
        Some(MovePlacement::Before) => widget.add_css_class("drop-before"),
        Some(MovePlacement::After) => widget.add_css_class("drop-after"),
        None => {}
    }
}

fn drop_hover(target: &gtk::DropTarget, y: f64, state: &Rc<State>) -> gdk::DragAction {
    let placement = drop_plan(target, y, state);
    set_drop_feedback(target, placement);
    if placement.is_some() {
        gdk::DragAction::MOVE
    } else {
        gdk::DragAction::empty()
    }
}

fn perform_drop(target: &gtk::DropTarget, y: f64, state: &Rc<State>) -> bool {
    let Some(placement) = drop_plan(target, y, state) else {
        set_drop_feedback(target, None);
        return false;
    };
    let Some(source_id) = state.dragging.borrow().clone() else {
        return false;
    };
    let Some(target_id) = target
        .widget()
        .as_ref()
        .and_then(|w| list_item_id(w, state))
    else {
        return false;
    };
    let Some(ui) = state.ui.borrow().as_ref().and_then(std::rc::Weak::upgrade) else {
        return false;
    };
    set_drop_feedback(target, None);

    let controller = state.controller.clone();
    let ui_cb = ui.clone();
    let state_cb = state.clone();
    let work_source = source_id.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .move_topic(&work_source, &target_id, placement)
        },
        move |result| match result {
            Ok(_) => {
                *state_cb.selected.borrow_mut() = Some(source_id);
                refresh(&ui_cb, &state_cb);
                toast(&ui_cb, "Blocco spostato");
            }
            Err(e) => show_error(&ui_cb, "Spostamento non riuscito", &e.message),
        },
    );
    true
}

// -------------------------------------------------------------------- helpers

fn editor_text(view: &gtk::TextView) -> String {
    let buf = view.buffer();
    buf.text(&buf.start_iter(), &buf.end_iter(), false)
        .to_string()
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
    let (wb, images, status) = {
        let mut controller = state.controller.lock().unwrap();
        let wb = controller.workbook();
        // Byte delle immagini/equazioni da mostrare nella mappa: la UI è l'unica
        // a poter leggere l'archivio del controller.
        let mut images: HashMap<String, Vec<u8>> = HashMap::new();
        if let Some(w) = wb.as_ref() {
            for sheet in &w.sheets {
                for topic in &sheet.topics {
                    if let Some(src) = topic.image_src.as_deref() {
                        if !images.contains_key(src) {
                            if let Some(bytes) = controller.resource_bytes(src) {
                                images.insert(src.to_string(), bytes);
                            }
                        }
                    }
                    // Se il topic porta una formula LaTeX ma l'immagine manca o è esterna,
                    // la generiamo al volo con MathJax per un rendering sempre impeccabile.
                    if let Some(latex) = topic.latex.as_deref() {
                        let key = topic
                            .image_src
                            .clone()
                            .unwrap_or_else(|| format!("latex:{}", latex));
                        if !images.contains_key(&key) {
                            if let Ok(preview) = controller.preview(latex, None) {
                                if let Ok(png) = crate::raster::svg_to_png(
                                    &preview.svg,
                                    preview.width,
                                    preview.height,
                                    2.0,
                                    "#000000",
                                ) {
                                    images.insert(key, png);
                                }
                            }
                        }
                    }
                }
            }
        }
        (wb, images, controller.status())
    };
    if let Some(w) = wb.as_ref() {
        ui.map_view.set_images(images);
        ui.map_view.set_workbook(&w.sheets, None);
        let sel = state.selected.borrow().clone();
        ui.map_view.set_selected(sel.as_deref());
    }
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
            || t.latex
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
            || t.notes.to_lowercase().contains(&query)
            || t.labels.iter().any(|l| l.to_lowercase().contains(&query))
            || t.href
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
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

    let previous_rows = state.rows.borrow().clone();
    // Stesso ordine di prima (nessun blocco aggiunto, eliminato o spostato): si
    // sostituiscono solo le righe cambiate, senza svuotare lo store. Così
    // «Applica» aggiorna la lista senza riportarla in cima e lo scroll resta
    // dov'era. La ricostruzione distruttiva serve solo quando cambia l'insieme
    // delle righe (filtro, ricerca, aggiunta/eliminazione, annulla/ripeti).
    let same_rows = rows_have_same_order(&previous_rows, &rows);

    *state.by_id.borrow_mut() = all.iter().map(|t| (t.id.clone(), t.clone())).collect();

    if same_rows {
        for (index, (old, new)) in previous_rows.iter().zip(&rows).enumerate() {
            if old != new {
                ui.store
                    .splice(index as u32, 1, &[gtk::StringObject::new(&new.id)]);
            }
        }
        // Sostituire una riga può far cadere la selezione: la si riafferma, se
        // il blocco selezionato è ancora presente.
        if let Some(id) = state.selected.borrow().clone() {
            if let Some(index) = rows.iter().position(|r| r.id == id) {
                if ui.selection.selected() != index as u32 {
                    state.rebuilding.set(true);
                    ui.selection.set_selected(index as u32);
                    state.rebuilding.set(false);
                }
            }
        }
    } else {
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
    }

    *state.rows.borrow_mut() = rows.clone();

    ui.summary
        .set_label(&format!("{} / {} blocchi", rows.len(), all.len()));
}

/// Vero se le due liste di righe hanno gli stessi id nello stesso ordine: in
/// quel caso aggiornare la lista non deve azzerarne lo scroll.
fn rows_have_same_order(old: &[TopicView], new: &[TopicView]) -> bool {
    old.len() == new.len() && old.iter().zip(new).all(|(a, b)| a.id == b.id)
}

/// Stato dei comandi di menu che agiscono sul blocco selezionato.
#[derive(Debug, PartialEq, Eq)]
struct TopicActionState {
    selected: bool,
    equation: bool,
    deletable: bool,
}

/// Predicato puro sullo stato dei comandi: la radice della mappa non è
/// eliminabile (il backend la rifiuta comunque, vedi `edit::remove_topic`).
fn topic_action_state(topic: Option<&TopicView>) -> TopicActionState {
    match topic {
        None => TopicActionState {
            selected: false,
            equation: false,
            deletable: false,
        },
        Some(t) => TopicActionState {
            selected: true,
            equation: t.kind == "equation",
            deletable: t.group != "root",
        },
    }
}

fn update_editor(ui: &Rc<Ui>, state: &Rc<State>) {
    let selected = state.selected.borrow().clone();
    let topic = selected.and_then(|id| state.by_id.borrow().get(&id).cloned());

    // Le voci del menu ☰ agiscono sul blocco selezionato: senza selezione
    // restano spente (prima erano sempre attive e non facevano nulla).
    let actions = topic_action_state(topic.as_ref());
    set_action_enabled(ui, "remove-equation", actions.equation);
    set_action_enabled(ui, "export-svg", actions.equation);
    set_action_enabled(ui, "export-png", actions.equation);
    set_action_enabled(ui, "delete-topic", actions.deletable);
    ui.delete_btn.set_sensitive(actions.deletable);
    ui.add_topic_btn.set_sensitive(actions.selected);

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

    if ui.topic_text.text().as_str() != topic.title {
        ui.topic_text.set_text(&topic.title);
    }

    // Note: non sovrascrivere il buffer mentre l'utente lo sta modificando.
    let notes = topic.notes.clone();
    if !ui.notes_view.has_focus() && editor_text(&ui.notes_view) != notes {
        ui.notes_view.buffer().set_text(&notes);
    }
    let as_block = topic.notes_display.as_deref() == Some("block");
    if ui.notes_switch.is_active() != as_block {
        ui.notes_switch.set_active(as_block);
    }

    let labels = topic.labels.join(", ");
    if ui.labels_entry.text().as_str() != labels {
        ui.labels_entry.set_text(&labels);
    }

    let href = topic.href.clone().unwrap_or_default();
    if ui.href_entry.text().as_str() != href {
        ui.href_entry.set_text(&href);
    }

    rebuild_markers(ui, state, &topic);
}

/// Ridisegna i chip dei marker attivi sul blocco selezionato.
fn rebuild_markers(ui: &Rc<Ui>, state: &Rc<State>, topic: &TopicView) {
    while let Some(child) = ui.markers_flow.first_child() {
        ui.markers_flow.remove(&child);
    }
    ui.markers_row.set_subtitle(&if topic.markers.is_empty() {
        "Nessun marker".to_string()
    } else {
        topic
            .markers
            .iter()
            .map(|m| markers::display_name(m))
            .collect::<Vec<_>>()
            .join(", ")
    });
    for id in &topic.markers {
        let chip = gtk::Button::with_label(&format!("{} ✕", markers::display_name(id)));
        chip.add_css_class("flat");
        chip.set_tooltip_text(Some("Rimuovi questo marker"));
        let ui_cb = ui.clone();
        let state_cb = state.clone();
        let topic_id = topic.id.clone();
        let marker_id = id.clone();
        chip.connect_clicked(move |_| {
            do_toggle_marker(&ui_cb, &state_cb, &topic_id, &marker_id);
        });
        ui.markers_flow.append(&chip);
    }
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
        ui.status_badges
            .append(&badge("modifiche non salvate", "warning"));
    }
    if !status.xmind_running.is_empty() {
        let b = badge("XMind è aperto — salvataggio bloccato", "error");
        b.set_tooltip_text(Some(&status.xmind_running.join("\n")));
        ui.status_badges.append(&b);
    }
    if status.conflict {
        ui.status_badges
            .append(&badge("file modificato su disco", "error"));
    }
    if status.renderer_checked && !status.renderer_ready {
        let b = badge("renderer MathJax assente", "error");
        b.set_tooltip_text(status.renderer_error.as_deref());
        ui.status_badges.append(&b);
    }

    ui.save_btn.set_sensitive(status.has_workbook);
    ui.undo_btn.set_sensitive(status.can_undo);
    ui.redo_btn.set_sensitive(status.can_redo);
    set_action_enabled(ui, "map-preview", status.has_workbook);
    ui.view_toggle_map.set_sensitive(status.has_workbook);
    ui.view_toggle_text.set_sensitive(status.has_workbook);
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
    ui.preview_picture.set_visible(false);
    ui.preview_error.set_visible(false);
    ui.preview_box.set_tooltip_text(None);
}

/// Errore di rendering dentro la striscia: niente immagine, solo il messaggio.
fn show_preview_error(ui: &Ui, message: &str) {
    ui.preview_picture.set_paintable(None::<&gdk::Texture>);
    ui.preview_picture.set_visible(false);
    ui.preview_error.set_label(message);
    ui.preview_error.set_visible(true);
    ui.preview_box.set_tooltip_text(None);
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
        ui.preview_section.set_visible(false);
        clear_preview(ui);
        return;
    }
    ui.preview_section.set_visible(true);
    ui.preview_box.set_visible(true);

    let color = if state.dark.get() {
        "#ffffff"
    } else {
        "#000000"
    }
    .to_string();
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
            // La texture è mostrata 1:1 in pixel logici: si rasterizza a 2× per
            // nitidezza, ma senza superare `PREVIEW_MAX_HEIGHT`, così una formula
            // alta rimpicciolisce invece di far crescere la striscia.
            let scale =
                (2.0 * f64::from(PREVIEW_MAX_HEIGHT) / preview.height.max(1.0)).min(2.0) as f32;
            let png =
                raster::svg_to_png(&preview.svg, preview.width, preview.height, scale, &color)
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
                show_preview_error(&ui, &format!("Errore LaTeX: {}", render.error.unwrap()));
            }
            Ok(render) if render.png.is_some() => {
                let bytes = glib::Bytes::from_owned(render.png.unwrap());
                match gdk::Texture::from_bytes(&bytes) {
                    Ok(texture) => {
                        ui.preview_picture.set_paintable(Some(&texture));
                        ui.preview_picture.set_visible(true);
                        ui.preview_error.set_visible(false);
                        // Le dimensioni restano a portata di tooltip: utili per
                        // capire come la formula finirà dentro XMind.
                        ui.preview_box.set_tooltip_text(Some(&format!(
                            "Anteprima: {} × {} px",
                            render.width.round(),
                            render.height.round()
                        )));
                    }
                    Err(_) => clear_preview(&ui),
                }
            }
            Ok(_) => clear_preview(&ui),
            Err(e) => show_preview_error(&ui, &e.message),
        },
    );
}

// ----------------------------------------------------------------- operazioni

fn set_busy(ui: &Ui, busy: bool, label: &str) {
    ui.apply_btn.set_sensitive(!busy);
    ui.apply_btn.set_label(label);
    ui.open_btn.set_sensitive(!busy);
    ui.save_btn.set_sensitive(!busy);
    ui.notes_apply.set_sensitive(!busy);
    ui.marker_add.set_sensitive(!busy);
    // Le voci del menu ☰ non si toccano qui: ogni callback di completamento
    // chiama `refresh` → `update_editor`, che le riallinea al blocco selezionato.
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
        move || {
            controller
                .lock()
                .unwrap()
                .apply(&topic_id, &latex, title_mode)
        },
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

fn do_save_text(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let title = ui.topic_text.text().to_string();
    let current = state
        .by_id
        .borrow()
        .get(&topic_id)
        .map(|t| t.title.clone())
        .unwrap_or_default();
    if current == title {
        toast(ui, "Nessuna modifica al testo.");
        return;
    }
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .set_topic_title(&topic_id, &title)
        },
        move |result| match result {
            Ok(_) => {
                refresh(&ui, &state);
                toast(&ui, "Testo aggiornato");
            }
            Err(e) => show_error(&ui, "Modifica non riuscita", &e.message),
        },
    );
}

/// Salva note e modo di visualizzazione. Testo vuoto rimuove le note.
fn do_save_notes(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let text = editor_text(&ui.notes_view);
    let display = ui.notes_switch.is_active().then_some("block");
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .set_topic_notes(&topic_id, &text, display)
        },
        move |result| match result {
            Ok(_) => {
                refresh(&ui, &state);
                toast(&ui, "Note aggiornate");
            }
            Err(e) => show_error(&ui, "Salvataggio note non riuscito", &e.message),
        },
    );
}

/// Salva le etichette scritte nell'EntryRow (separate da virgola).
fn do_save_labels(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let labels: Vec<String> = ui
        .labels_entry
        .text()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .set_topic_labels(&topic_id, labels)
        },
        move |result| match result {
            Ok(_) => {
                refresh(&ui, &state);
                toast(&ui, "Etichette aggiornate");
            }
            Err(e) => show_error(&ui, "Salvataggio etichette non riuscito", &e.message),
        },
    );
}

/// Salva (o rimuove, con campo vuoto) il link del blocco.
fn do_save_href(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let text = ui.href_entry.text().to_string();
    let href = (!text.trim().is_empty()).then_some(text);
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .set_topic_href(&topic_id, href.as_deref())
        },
        move |result| match result {
            Ok(_) => {
                refresh(&ui, &state);
                toast(&ui, "Link aggiornato");
            }
            Err(e) => show_error(&ui, "Salvataggio link non riuscito", &e.message),
        },
    );
}

/// Aggiunge il marker scelto nel menu a tendina al blocco selezionato.
fn do_add_marker(ui: &Rc<Ui>, state: &Rc<State>, marker_ids: &Rc<Vec<String>>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let Some(marker_id) = marker_ids.get(ui.marker_drop.selected() as usize).cloned() else {
        toast(ui, "Scegli un marker dall'elenco.");
        return;
    };
    let already = state
        .by_id
        .borrow()
        .get(&topic_id)
        .map(|t| t.markers.iter().any(|m| m == &marker_id))
        .unwrap_or(false);
    if already {
        toast(ui, "Marker già presente sul blocco.");
        return;
    }
    do_toggle_marker(ui, state, &topic_id, &marker_id);
}

/// Aggiunge o rimuove un marker dal blocco indicato.
fn do_toggle_marker(ui: &Rc<Ui>, state: &Rc<State>, topic_id: &str, marker_id: &str) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    let topic_id = topic_id.to_string();
    let marker_id = marker_id.to_string();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .toggle_topic_marker(&topic_id, &marker_id)
        },
        move |result| match result {
            Ok(_) => refresh(&ui, &state),
            Err(e) => show_error(&ui, "Marker non modificato", &e.message),
        },
    );
}

fn do_add_topic(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(parent_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona il blocco a cui aggiungere un sotto-blocco.");
        return;
    };
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || {
            controller
                .lock()
                .unwrap()
                .add_topic(&parent_id, "Nuovo blocco")
        },
        move |result| match result {
            Ok(outcome) => {
                *state.selected.borrow_mut() = Some(outcome.topic_id);
                refresh(&ui, &state);
                ui.options_row.set_expanded(true);
                ui.topic_text.grab_focus();
                ui.topic_text.select_region(0, -1);
                toast(&ui, "Sotto-blocco aggiunto");
            }
            Err(e) => show_error(&ui, "Aggiunta non riuscita", &e.message),
        },
    );
}

fn confirm_delete_topic(ui: &Rc<Ui>, state: &Rc<State>) {
    let Some(topic_id) = state.selected.borrow().clone() else {
        toast(ui, "Seleziona prima un blocco.");
        return;
    };
    let display = state
        .by_id
        .borrow()
        .get(&topic_id)
        .map(|t| t.display_title.clone())
        .unwrap_or_default();
    let dialog = adw::MessageDialog::builder()
        .transient_for(&ui.window)
        .heading("Eliminare il blocco?")
        .body(format!(
            "«{display}» e tutti i suoi sotto-blocchi verranno rimossi dalla mappa. \
             Puoi annullare con Ctrl+Z finché non salvi."
        ))
        .build();
    dialog.add_response("cancel", "Annulla");
    dialog.add_response("delete", "Elimina");
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");
    let ui = ui.clone();
    let state = state.clone();
    dialog.connect_response(None, move |_dialog, response| {
        if response == "delete" {
            do_delete_topic(&ui, &state, &topic_id);
        }
    });
    dialog.present();
}

fn do_delete_topic(ui: &Rc<Ui>, state: &Rc<State>, topic_id: &str) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    let topic_id = topic_id.to_string();
    spawn_blocking(
        move || controller.lock().unwrap().remove_topic(&topic_id),
        move |result| match result {
            Ok(_) => {
                *state.selected.borrow_mut() = None;
                refresh(&ui, &state);
                toast(&ui, "Blocco eliminato");
            }
            Err(e) => show_error(&ui, "Eliminazione non riuscita", &e.message),
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

/// Se dopo un salvataggio riuscito la finestra va chiusa (uscita con modifiche
/// pendenti) oppure no (salvataggio normale).
#[derive(Clone, Copy, PartialEq, Eq)]
enum CloseAfter {
    No,
    Yes,
}

/// Chiusura della finestra: se ci sono modifiche non salvate chiede prima cosa
/// farne. Restituisce `Stop` finché la decisione non è presa.
fn confirm_close(
    window: &adw::ApplicationWindow,
    ui: &Rc<Ui>,
    state: &Rc<State>,
) -> glib::Propagation {
    // Rientro dopo "Non salvare" o dopo un salvataggio: si chiude davvero.
    if state.closing.get() {
        return glib::Propagation::Proceed;
    }
    let dirty = state.controller.lock().unwrap().status().dirty;
    if !dirty {
        return glib::Propagation::Proceed;
    }

    let dialog = adw::MessageDialog::builder()
        .transient_for(window)
        .heading("Salvare le modifiche?")
        .body("Ci sono modifiche non salvate. Se chiudi senza salvare andranno perse.")
        .build();
    dialog.add_response("cancel", "Annulla");
    dialog.add_response("discard", "Non salvare");
    dialog.add_response("save", "Salva");
    dialog.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    dialog.set_response_appearance("discard", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("save"));
    dialog.set_close_response("cancel");
    let ui = ui.clone();
    let state = state.clone();
    dialog.connect_response(None, move |_dialog, response| match response {
        "save" => do_save(&ui, &state, false, CloseAfter::Yes),
        "discard" => {
            state.closing.set(true);
            ui.window.close();
        }
        _ => {}
    });
    dialog.present();
    glib::Propagation::Stop
}

fn do_save(ui: &Rc<Ui>, state: &Rc<State>, force: bool, close_after: CloseAfter) {
    let controller = state.controller.clone();
    let ui = ui.clone();
    let state = state.clone();
    spawn_blocking(
        move || controller.lock().unwrap().save(force),
        move |result| match result {
            Ok(outcome) => {
                refresh(&ui, &state);
                if close_after == CloseAfter::Yes {
                    state.closing.set(true);
                    ui.window.close();
                } else {
                    toast(&ui, &format!("Salvato — {} byte", outcome.bytes));
                }
            }
            Err(e) if e.code == CODE_XMIND_RUNNING || e.code == CODE_CONFLICT => {
                confirm_force(&ui, &state, &e, close_after);
            }
            Err(e) => show_error(&ui, "Salvataggio non riuscito", &e.message),
        },
    );
}

fn confirm_force(ui: &Rc<Ui>, state: &Rc<State>, err: &ErrorPayload, close_after: CloseAfter) {
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
            do_save(&ui, &state, true, close_after);
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
                ui.map_view.reset_sheet();
                refresh(&ui, &state);
                ui.map_view.fit_to_view();
                toast(&ui, "File aperto");
            }
            Err(e) => show_error(&ui, "Apertura non riuscita", &e.message),
        },
    );
}

fn choose_save_as(ui: &Rc<Ui>, state: &Rc<State>) {
    let dialog = gtk::FileDialog::builder()
        .title("Salva con nome")
        .initial_name("mappa.xmap-studio.xmind")
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
                    confirm_force(&ui, &state, &e, CloseAfter::No);
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

/// Nome file (senza estensione) ricavato dal titolo della mappa: sostituisce i
/// separatori di percorso e i caratteri di controllo, e ripiega su "mappa".
fn filename_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' {
                '-'
            } else if c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        "mappa".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

/// Esporta l'intera mappa in Markdown o OPML (file scelto dall'utente).
fn do_export_outline(ui: &Rc<Ui>, state: &Rc<State>, format: &str) {
    let (has_workbook, map_title) = {
        let controller = state.controller.lock().unwrap();
        (controller.status().has_workbook, controller.map_title())
    };
    if !has_workbook {
        toast(ui, "Apri prima una mappa.");
        return;
    }
    let stem = filename_stem(map_title.as_deref().unwrap_or("mappa"));
    let (title, ext, filter_name) = match format {
        "markdown" => ("Esporta Markdown", "md", "Markdown"),
        _ => ("Esporta OPML", "opml", "OPML"),
    };
    let dialog = gtk::FileDialog::builder()
        .title(title)
        .initial_name(format!("{stem}.{ext}"))
        .modal(true)
        .build();
    let filter = gtk::FileFilter::new();
    filter.set_name(Some(filter_name));
    filter.add_pattern(&format!("*.{ext}"));
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
        let format = format.clone();
        spawn_blocking(
            move || controller.lock().unwrap().export_outline(&format, &path),
            move |result| match result {
                Ok(out) => toast(&ui, &format!("Esportato in {out}")),
                Err(e) => show_error(&ui, "Esportazione non riuscita", &e.message),
            },
        );
    });
}

/// Importa un file Markdown/OPML come nuova sheet della mappa aperta.
fn do_import_outline(ui: &Rc<Ui>, state: &Rc<State>) {
    if !state.controller.lock().unwrap().status().has_workbook {
        toast(ui, "Apri prima una mappa: l'import aggiunge una sheet.");
        return;
    }
    let dialog = gtk::FileDialog::builder()
        .title("Importa Markdown o OPML")
        .modal(true)
        .build();
    let md = gtk::FileFilter::new();
    md.set_name(Some("Markdown"));
    md.add_pattern("*.md");
    md.add_pattern("*.markdown");
    let opml = gtk::FileFilter::new();
    opml.set_name(Some("OPML"));
    opml.add_pattern("*.opml");
    opml.add_pattern("*.xml");
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&md);
    filters.append(&opml);
    dialog.set_filters(Some(&filters));

    let win = ui.window.clone();
    let ui = ui.clone();
    let state = state.clone();
    dialog.open(Some(&win), None::<&gio::Cancellable>, move |result| {
        let Ok(file) = result else {
            return;
        };
        let Some(path) = file.path() else {
            return;
        };
        let format = match path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref()
        {
            Some("md" | "markdown") => "markdown",
            Some("opml" | "xml") => "opml",
            _ => {
                show_error(
                    &ui,
                    "Formato non riconosciuto",
                    "Usa un file .md, .markdown o .opml.",
                );
                return;
            }
        };
        let path = path.display().to_string();
        let controller = state.controller.clone();
        let ui = ui.clone();
        let state = state.clone();
        spawn_blocking(
            move || controller.lock().unwrap().import_outline(format, &path),
            move |result| match result {
                Ok(outcome) => {
                    refresh(&ui, &state);
                    let count = outcome.sheets.last().map(|s| s.topics.len()).unwrap_or(0);
                    toast(&ui, &format!("Importati {count} blocchi"));
                }
                Err(e) => show_error(&ui, "Import non riuscito", &e.message),
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
    ui.map_view.set_dark(dark);
    if dark {
        ui.preview_box.add_css_class("eq-preview-dark");
        ui.preview_box.remove_css_class("eq-preview-light");
    } else {
        ui.preview_box.remove_css_class("eq-preview-dark");
        ui.preview_box.add_css_class("eq-preview-light");
    }
    schedule_preview(ui, state);
}

fn show_map_preview(ui: &Ui) {
    ui.view_toggle_map.set_active(true);
    ui.main_view_stack.set_visible_child_name("map");
    ui.map_view.fit_to_view();
}

fn show_about(ui: &Ui) {
    let dialog = adw::MessageDialog::builder()
        .transient_for(&ui.window)
        .heading("XMap Studio")
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Blocco minimo per i predicati: contano solo `kind` e `group`.
    fn topic(kind: &'static str, group: &str) -> TopicView {
        TopicView {
            id: "t1".into(),
            sheet_index: 0,
            parent_id: None,
            depth: 0,
            group: group.into(),
            title: String::new(),
            display_title: String::new(),
            kind,
            latex: None,
            image_src: None,
            image_w: None,
            image_h: None,
            notes: String::new(),
            notes_display: None,
            labels: Vec::new(),
            markers: Vec::new(),
            href: None,
            path: Vec::new(),
            child_count: 0,
            task: None,
            fill_color: None,
            position: None,
            custom_width: None,
            boundaries: Vec::new(),
            summaries: Vec::new(),
        }
    }

    #[test]
    fn menu_actions_follow_the_selected_block() {
        let none = topic_action_state(None);
        assert_eq!(
            none,
            TopicActionState {
                selected: false,
                equation: false,
                deletable: false
            }
        );

        let equation = topic_action_state(Some(&topic("equation", "attached")));
        assert!(equation.selected && equation.equation && equation.deletable);

        // Un blocco di testo non ha equazione da esportare o rimuovere.
        let text = topic_action_state(Some(&topic("text", "attached")));
        assert!(!text.equation && text.deletable);

        // La radice della mappa non è eliminabile.
        let root = topic_action_state(Some(&topic("text", "root")));
        assert!(!root.deletable && !root.equation);
    }

    #[test]
    fn same_order_only_when_ids_match_in_sequence() {
        let a = topic("text", "attached");
        let mut b = a.clone();
        b.id = "t2".into();
        let mut c = a.clone();
        c.id = "t3".into();

        // stessi id, stesso ordine: aggiornamento in place (scroll preservato)
        assert!(rows_have_same_order(
            &[a.clone(), b.clone()],
            &[a.clone(), b.clone()]
        ));

        // ordine diverso o insieme diverso: serve la ricostruzione
        assert!(!rows_have_same_order(
            &[a.clone(), b.clone()],
            &[b.clone(), a.clone()]
        ));
        assert!(!rows_have_same_order(
            &[a.clone(), b.clone()],
            &[a.clone(), c]
        ));
        assert!(!rows_have_same_order(
            std::slice::from_ref(&a),
            &[a.clone(), b]
        ));
    }

    #[test]
    fn export_name_comes_from_map_title_sanitized() {
        assert_eq!(filename_stem("Algebra di Boole"), "Algebra di Boole");
        assert_eq!(filename_stem("  A / B \n"), "A - B");
        assert_eq!(filename_stem("   "), "mappa");
        assert_eq!(filename_stem("..."), "mappa");
    }

    #[test]
    fn drop_placement_splits_row_into_three_bands() {
        let height = 30.0;
        assert_eq!(drop_placement(0.0, height), MovePlacement::Before);
        assert_eq!(drop_placement(9.9, height), MovePlacement::Before);
        assert_eq!(drop_placement(10.0, height), MovePlacement::Into);
        assert_eq!(drop_placement(20.0, height), MovePlacement::Into);
        assert_eq!(drop_placement(20.1, height), MovePlacement::After);
        assert_eq!(drop_placement(29.9, height), MovePlacement::After);
    }
}
