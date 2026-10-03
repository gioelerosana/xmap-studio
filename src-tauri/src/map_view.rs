//! Vista mappa ad albero interattiva (GTK4 + Cairo + Pango).
//!
//! Visualizza la struttura ad albero orizzontale della mappa con:
//! - Navigazione fluida (pan col drag o rotellina, zoom con Ctrl+rotellina o pulsanti)
//! - Selezione bidirezionale collegata all'outliner e all'editor
//! - Collasso ed espansione dei sotto-alberi (click sull'indicatore o doppio click sul nodo)
//! - Resa tipografica con Pango (wrapping, ellissi e contrasto automatico)
//! - Eredità del colore del ramo e rendering di badge (marker, etichette, note)
//! - Viewport culling per alte prestazioni su mappe grandi

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gtk::glib;
use gtk::prelude::*;

use crate::layout::{self, Layout, MapNode, NodeMetrics};
use crate::state::SheetDto;
use gtk::pango;

/// Palette di colori usati per il disegno della mappa.
struct MapPalette {
    bg_r: f64,
    bg_g: f64,
    bg_b: f64,
    grid_r: f64,
    grid_g: f64,
    grid_b: f64,
    grid_alpha: f64,
    edge_r: f64,
    edge_g: f64,
    edge_b: f64,
    card_bg_r: f64,
    card_bg_g: f64,
    card_bg_b: f64,
    card_border_r: f64,
    card_border_g: f64,
    card_border_b: f64,
    text_r: f64,
    text_g: f64,
    text_b: f64,
}

impl MapPalette {
    fn dark() -> Self {
        Self {
            bg_r: 0.12,
            bg_g: 0.12,
            bg_b: 0.12,
            grid_r: 0.28,
            grid_g: 0.28,
            grid_b: 0.28,
            grid_alpha: 0.45,
            edge_r: 0.38,
            edge_g: 0.38,
            edge_b: 0.38,
            card_bg_r: 0.17,
            card_bg_g: 0.17,
            card_bg_b: 0.17,
            card_border_r: 0.28,
            card_border_g: 0.28,
            card_border_b: 0.28,
            text_r: 0.92,
            text_g: 0.92,
            text_b: 0.92,
        }
    }

    fn light() -> Self {
        Self {
            bg_r: 0.96,
            bg_g: 0.97,
            bg_b: 0.98,
            grid_r: 0.82,
            grid_g: 0.84,
            grid_b: 0.86,
            grid_alpha: 0.55,
            edge_r: 0.72,
            edge_g: 0.75,
            edge_b: 0.78,
            card_bg_r: 1.0,
            card_bg_g: 1.0,
            card_bg_b: 1.0,
            card_border_r: 0.82,
            card_border_g: 0.84,
            card_border_b: 0.86,
            text_r: 0.12,
            text_g: 0.12,
            text_b: 0.12,
        }
    }
}

/// Stato interno della vista mappa.
type SelectCallback = Box<dyn Fn(&str)>;

struct MapViewState {
    sheets: RefCell<Vec<SheetDto>>,
    active_sheet: Cell<usize>,
    collapsed: RefCell<HashSet<String>>,
    selected: RefCell<Option<String>>,
    layout: RefCell<Layout>,
    pan_x: Cell<f64>,
    pan_y: Cell<f64>,
    zoom: Cell<f64>,
    drag_start_pan: Cell<(f64, f64)>,
    dark: Cell<bool>,
    metrics_cache: RefCell<HashMap<String, (f64, f64)>>,
    on_select: RefCell<Option<SelectCallback>>,
}

/// Misuratore di nodi con Pango e cache in memoria.
struct CanvasMetrics<'a> {
    pango_ctx: pango::Context,
    cache: &'a RefCell<HashMap<String, (f64, f64)>>,
}

impl<'a> NodeMetrics for CanvasMetrics<'a> {
    fn measure(&self, node: &MapNode) -> (f64, f64) {
        let text = if !node.display_title.is_empty() {
            &node.display_title
        } else {
            &node.title
        };
        let key = format!(
            "{}:{}:{}:{}:{}",
            node.id,
            text,
            node.markers.len(),
            node.labels.len(),
            node.has_notes
        );
        if let Some(&size) = self.cache.borrow().get(&key) {
            return size;
        }

        let pango_layout = pango::Layout::new(&self.pango_ctx);
        let mut font = pango::FontDescription::from_string("Sans 11");
        if node.depth == 0 {
            font.set_weight(pango::Weight::Bold);
        }
        pango_layout.set_font_description(Some(&font));
        pango_layout.set_text(text);
        pango_layout.set_width((200.0 * pango::SCALE as f64) as i32);
        pango_layout.set_wrap(pango::WrapMode::WordChar);
        pango_layout.set_ellipsize(pango::EllipsizeMode::End);

        let (pixel_w, pixel_h) = pango_layout.pixel_size();
        let mut w = (pixel_w as f64 + 28.0).clamp(110.0, 260.0);
        let mut h = (pixel_h as f64 + 18.0).max(36.0);

        if !node.markers.is_empty() || !node.labels.is_empty() || node.has_notes {
            h += 16.0;
            w = w.max(130.0);
        }

        let size = (w, h);
        self.cache.borrow_mut().insert(key, size);
        size
    }
}

/// Widget principale della vista mappa ad albero.
#[derive(Clone)]
pub struct MapView {
    pub container: gtk::Box,
    area: gtk::DrawingArea,
    sheet_drop: gtk::DropDown,
    sheet_store: gtk::StringList,
    zoom_label: gtk::Label,
    state: Rc<MapViewState>,
}

impl MapView {
    /// Costruisce una nuova istanza di MapView collegata al callback di selezione.
    pub fn new<F: Fn(&str) + 'static>(on_select: F) -> Self {
        let state = Rc::new(MapViewState {
            sheets: RefCell::new(Vec::new()),
            active_sheet: Cell::new(0),
            collapsed: RefCell::new(HashSet::new()),
            selected: RefCell::new(None),
            layout: RefCell::new(Layout::default()),
            pan_x: Cell::new(40.0),
            pan_y: Cell::new(40.0),
            zoom: Cell::new(1.0),
            drag_start_pan: Cell::new((40.0, 40.0)),
            dark: Cell::new(false),
            metrics_cache: RefCell::new(HashMap::new()),
            on_select: RefCell::new(Some(Box::new(on_select))),
        });

        let container = gtk::Box::new(gtk::Orientation::Vertical, 0);

        // Barra degli strumenti superiore
        let toolbar = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        toolbar.set_margin_start(10);
        toolbar.set_margin_end(10);
        toolbar.set_margin_top(6);
        toolbar.set_margin_bottom(6);
        toolbar.add_css_class("map-toolbar");

        // Selettore foglio
        let sheet_store = gtk::StringList::new(&["Foglio 1"]);
        let sheet_drop = gtk::DropDown::builder()
            .model(&sheet_store)
            .tooltip_text("Seleziona foglio da visualizzare")
            .build();
        toolbar.append(&sheet_drop);

        // Separatore flessibile
        let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        spacer.set_hexpand(true);
        toolbar.append(&spacer);

        // Pulsanti Zoom e Controlli
        let zoom_out_btn = gtk::Button::builder()
            .icon_name("zoom-out-symbolic")
            .tooltip_text("Rimpicciolisci (Ctrl -)")
            .build();
        toolbar.append(&zoom_out_btn);

        let zoom_label = gtk::Label::builder()
            .label("100%")
            .width_chars(5)
            .xalign(0.5)
            .build();
        toolbar.append(&zoom_label);

        let zoom_in_btn = gtk::Button::builder()
            .icon_name("zoom-in-symbolic")
            .tooltip_text("Ingrandisci (Ctrl +)")
            .build();
        toolbar.append(&zoom_in_btn);

        let fit_btn = gtk::Button::builder()
            .icon_name("zoom-fit-best-symbolic")
            .tooltip_text("Adatta mappa allo schermo (Ctrl 0)")
            .build();
        toolbar.append(&fit_btn);

        let expand_all_btn = gtk::Button::builder()
            .icon_name("view-fullscreen-symbolic")
            .tooltip_text("Espandi tutti i nodi")
            .build();
        toolbar.append(&expand_all_btn);

        let collapse_all_btn = gtk::Button::builder()
            .icon_name("view-restore-symbolic")
            .tooltip_text("Collassa sotto-alberi")
            .build();
        toolbar.append(&collapse_all_btn);

        container.append(&toolbar);

        // Area di disegno
        let area = gtk::DrawingArea::new();
        area.set_hexpand(true);
        area.set_vexpand(true);
        area.set_focusable(true);
        container.append(&area);

        // Connessione disegno Cairo
        {
            let state = state.clone();
            area.set_draw_func(move |area, cr, width, height| {
                draw_map(area, cr, width as f64, height as f64, &state);
            });
        }

        // Gesture Drag: Pan della mappa
        {
            let drag = gtk::GestureDrag::new();
            let state_begin = state.clone();
            drag.connect_drag_begin(move |_, _, _| {
                state_begin
                    .drag_start_pan
                    .set((state_begin.pan_x.get(), state_begin.pan_y.get()));
            });
            let state_update = state.clone();
            let area_update = area.clone();
            drag.connect_drag_update(move |_, offset_x, offset_y| {
                let (sx, sy) = state_update.drag_start_pan.get();
                state_update.pan_x.set(sx + offset_x);
                state_update.pan_y.set(sy + offset_y);
                area_update.queue_draw();
            });
            area.add_controller(drag);
        }

        // Controller Scroll: Zoom con Ctrl+rotella, Pan con rotella
        {
            let scroll =
                gtk::EventControllerScroll::new(gtk::EventControllerScrollFlags::BOTH_AXES);
            let state_scroll = state.clone();
            let area_scroll = area.clone();
            let zoom_lbl_scroll = zoom_label.clone();
            scroll.connect_scroll(move |scroll, dx, dy| {
                let event_state = scroll.current_event_state();
                let is_ctrl = event_state.contains(gtk::gdk::ModifierType::CONTROL_MASK);

                if is_ctrl {
                    let old_zoom = state_scroll.zoom.get();
                    let factor = if dy < 0.0 { 1.15 } else { 1.0 / 1.15 };
                    let new_zoom = (old_zoom * factor).clamp(0.2, 3.0);

                    let mx = area_scroll.width() as f64 / 2.0;
                    let my = area_scroll.height() as f64 / 2.0;
                    let new_pan_x = mx - (mx - state_scroll.pan_x.get()) * (new_zoom / old_zoom);
                    let new_pan_y = my - (my - state_scroll.pan_y.get()) * (new_zoom / old_zoom);

                    state_scroll.pan_x.set(new_pan_x);
                    state_scroll.pan_y.set(new_pan_y);
                    state_scroll.zoom.set(new_zoom);
                    zoom_lbl_scroll.set_label(&format!("{}%", (new_zoom * 100.0).round() as i64));
                    area_scroll.queue_draw();
                } else {
                    state_scroll.pan_x.set(state_scroll.pan_x.get() - dx * 24.0);
                    state_scroll.pan_y.set(state_scroll.pan_y.get() - dy * 24.0);
                    area_scroll.queue_draw();
                }
                glib::Propagation::Stop
            });
            area.add_controller(scroll);
        }

        // Gesture Click: Selezione con click singolo, Collasso con doppio click o click sull'indicatore
        {
            let click = gtk::GestureClick::new();
            let state_click = state.clone();
            let area_click = area.clone();
            click.connect_pressed(move |_, n_press, x, y| {
                let z = state_click.zoom.get();
                let wx = (x - state_click.pan_x.get()) / z;
                let wy = (y - state_click.pan_y.get()) / z;

                // 1. Controllo click sull'indicatore di collasso
                let l = state_click.layout.borrow();
                if let Some(idx) = l.collapse_handle_at(wx, wy) {
                    let node_id = l.nodes[idx].id.clone();
                    drop(l);
                    toggle_collapse(&state_click, &node_id, &area_click);
                    return;
                }

                // 2. Controllo click sul nodo
                if let Some(idx) = l.node_at(wx, wy) {
                    let node_id = l.nodes[idx].id.clone();
                    drop(l);

                    if n_press == 1 {
                        *state_click.selected.borrow_mut() = Some(node_id.clone());
                        area_click.queue_draw();
                        if let Some(cb) = state_click.on_select.borrow().as_ref() {
                            cb(&node_id);
                        }
                    } else if n_press == 2 {
                        toggle_collapse(&state_click, &node_id, &area_click);
                    }
                }
            });
            area.add_controller(click);
        }

        // Eventi pulsanti barra strumenti
        {
            let state = state.clone();
            let area_clone = area.clone();
            let zoom_lbl = zoom_label.clone();
            zoom_in_btn.connect_clicked(move |_| {
                let old_z = state.zoom.get();
                let new_z = (old_z * 1.2).clamp(0.2, 3.0);
                let cx = area_clone.width() as f64 / 2.0;
                let cy = area_clone.height() as f64 / 2.0;
                state
                    .pan_x
                    .set(cx - (cx - state.pan_x.get()) * (new_z / old_z));
                state
                    .pan_y
                    .set(cy - (cy - state.pan_y.get()) * (new_z / old_z));
                state.zoom.set(new_z);
                zoom_lbl.set_label(&format!("{}%", (new_z * 100.0).round() as i64));
                area_clone.queue_draw();
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            let zoom_lbl = zoom_label.clone();
            zoom_out_btn.connect_clicked(move |_| {
                let old_z = state.zoom.get();
                let new_z = (old_z / 1.2).clamp(0.2, 3.0);
                let cx = area_clone.width() as f64 / 2.0;
                let cy = area_clone.height() as f64 / 2.0;
                state
                    .pan_x
                    .set(cx - (cx - state.pan_x.get()) * (new_z / old_z));
                state
                    .pan_y
                    .set(cy - (cy - state.pan_y.get()) * (new_z / old_z));
                state.zoom.set(new_z);
                zoom_lbl.set_label(&format!("{}%", (new_z * 100.0).round() as i64));
                area_clone.queue_draw();
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            let zoom_lbl = zoom_label.clone();
            fit_btn.connect_clicked(move |_| {
                fit_to_view_internal(&state, &area_clone, &zoom_lbl);
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            expand_all_btn.connect_clicked(move |_| {
                state.collapsed.borrow_mut().clear();
                recompute_layout(&state, &area_clone);
                area_clone.queue_draw();
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            collapse_all_btn.connect_clicked(move |_| {
                collapse_all_nodes(&state, &area_clone);
            });
        }

        // Cambio foglio attivo
        {
            let state = state.clone();
            let area_clone = area.clone();
            let zoom_lbl = zoom_label.clone();
            sheet_drop.connect_selected_notify(move |drop| {
                let idx = drop.selected() as usize;
                if state.active_sheet.get() != idx {
                    state.active_sheet.set(idx);
                    recompute_layout(&state, &area_clone);
                    fit_to_view_internal(&state, &area_clone, &zoom_lbl);
                }
            });
        }

        Self {
            container,
            area,
            sheet_drop,
            sheet_store,
            zoom_label,
            state,
        }
    }

    /// Restituisce il contenitore widget da inserire nello stack dell'interfaccia.
    pub fn widget(&self) -> &gtk::Box {
        &self.container
    }

    /// Aggiorna il modello del workbook visualizzato nella mappa.
    pub fn set_workbook(&self, sheets: &[SheetDto], active_sheet: usize) {
        *self.state.sheets.borrow_mut() = sheets.to_vec();
        self.state.active_sheet.set(active_sheet);

        // Aggiorna elenco sheet nel dropdown
        let mut titles = Vec::new();
        for (i, s) in sheets.iter().enumerate() {
            let t = if !s.title.is_empty() {
                s.title.clone()
            } else {
                format!("Foglio {}", i + 1)
            };
            titles.push(t);
        }
        if titles.is_empty() {
            titles.push("Foglio 1".to_string());
        }

        self.sheet_store.splice(
            0,
            self.sheet_store.n_items(),
            &titles.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        );
        self.sheet_drop.set_selected(active_sheet as u32);

        recompute_layout(&self.state, &self.area);
        self.area.queue_draw();
    }

    /// Seleziona un nodo nella mappa e ne aggiorna l'evidenziazione.
    pub fn set_selected(&self, id: Option<&str>) {
        *self.state.selected.borrow_mut() = id.map(str::to_string);
        self.area.queue_draw();
    }

    /// Scorre e centra la vista sul nodo correntemente selezionato.
    pub fn scroll_to_selected(&self) {
        if let Some(id) = self.state.selected.borrow().clone() {
            scroll_to_node(&self.state, &self.area, &id);
        }
    }

    /// Adatta la mappa intera alla dimensione corrente della finestra.
    pub fn fit_to_view(&self) {
        fit_to_view_internal(&self.state, &self.area, &self.zoom_label);
    }

    /// Imposta il tema scuro o chiaro per la palette della mappa.
    pub fn set_dark(&self, dark: bool) {
        self.state.dark.set(dark);
        self.area.queue_draw();
    }

    /// Richiede un ridisegno dell'area.
    pub fn queue_draw(&self) {
        self.area.queue_draw();
    }
}

/// Ricalcola il layout della sheet attiva con i parametri e le dimensioni correnti.
fn recompute_layout(state: &MapViewState, area: &gtk::DrawingArea) {
    let sheets = state.sheets.borrow();
    let sheet_idx = state.active_sheet.get();
    let Some(sheet) = sheets.get(sheet_idx) else {
        *state.layout.borrow_mut() = Layout::default();
        return;
    };
    let collapsed = state.collapsed.borrow();
    let metrics = CanvasMetrics {
        pango_ctx: area.pango_context(),
        cache: &state.metrics_cache,
    };
    let new_layout =
        layout::layout_single_sheet(sheet, &collapsed, &metrics, layout::LayoutOpts::default());
    *state.layout.borrow_mut() = new_layout;
}

/// Alterna lo stato di espansione/collasso del nodo specificato.
fn toggle_collapse(state: &MapViewState, id: &str, area: &gtk::DrawingArea) {
    {
        let mut coll = state.collapsed.borrow_mut();
        if coll.contains(id) {
            coll.remove(id);
        } else {
            coll.insert(id.to_string());
        }
    }
    recompute_layout(state, area);
    area.queue_draw();
}

/// Collassa tutti i sotto-alberi (lasciando visibili solo i figli di primo livello).
fn collapse_all_nodes(state: &MapViewState, area: &gtk::DrawingArea) {
    let sheets = state.sheets.borrow();
    let sheet_idx = state.active_sheet.get();
    if let Some(sheet) = sheets.get(sheet_idx) {
        let mut coll = state.collapsed.borrow_mut();
        for topic in &sheet.topics {
            if topic.depth >= 1 && topic.child_count > 0 {
                coll.insert(topic.id.clone());
            }
        }
    }
    drop(sheets);
    recompute_layout(state, area);
    area.queue_draw();
}

/// Centra il nodo `id` nella vista.
fn scroll_to_node(state: &MapViewState, area: &gtk::DrawingArea, id: &str) {
    let l = state.layout.borrow();
    let Some(idx) = l.find_node_by_id(id) else {
        return;
    };
    let node = &l.nodes[idx];
    let view_w = area.width() as f64;
    let view_h = area.height() as f64;
    if view_w <= 10.0 || view_h <= 10.0 {
        return;
    }
    let z = state.zoom.get();
    let node_cx = (node.x + node.w / 2.0) * z;
    let node_cy = (node.y + node.h / 2.0) * z;
    state.pan_x.set(view_w / 2.0 - node_cx);
    state.pan_y.set(view_h / 2.0 - node_cy);
    area.queue_draw();
}

/// Adatta zoom e pan della mappa al rettangolo visibile dell'area.
fn fit_to_view_internal(state: &MapViewState, area: &gtk::DrawingArea, zoom_label: &gtk::Label) {
    let l = state.layout.borrow();
    if l.is_empty() {
        return;
    }
    let view_w = area.width() as f64;
    let view_h = area.height() as f64;
    if view_w <= 20.0 || view_h <= 20.0 {
        return;
    }

    let margin = 48.0;
    let scale_x = (view_w - margin * 2.0) / l.width;
    let scale_y = (view_h - margin * 2.0) / l.height;
    let new_zoom = scale_x.min(scale_y).clamp(0.2, 1.4);

    state.zoom.set(new_zoom);
    let target_w = l.width * new_zoom;
    let target_h = l.height * new_zoom;
    state.pan_x.set((view_w - target_w) / 2.0);
    state.pan_y.set((view_h - target_h) / 2.0);
    zoom_label.set_label(&format!("{}%", (new_zoom * 100.0).round() as i64));
    area.queue_draw();
}

/// Traccia un rettangolo con angoli arrotondati in Cairo.
fn rounded_rect(cr: &gtk::cairo::Context, x: f64, y: f64, w: f64, h: f64, r: f64) {
    let r = r.min(w / 2.0).min(h / 2.0);
    cr.new_sub_path();
    cr.arc(x + w - r, y + r, r, -std::f64::consts::FRAC_PI_2, 0.0);
    cr.arc(x + w - r, y + h - r, r, 0.0, std::f64::consts::FRAC_PI_2);
    cr.arc(
        x + r,
        y + h - r,
        r,
        std::f64::consts::FRAC_PI_2,
        std::f64::consts::PI,
    );
    cr.arc(
        x + r,
        y + r,
        r,
        std::f64::consts::PI,
        3.0 * std::f64::consts::FRAC_PI_2,
    );
    cr.close_path();
}

/// Parsifica un colore hex (`#RGB`, `#RRGGBB`, ecc.) in componenti RGB normalizzate (0.0 .. 1.0).
fn parse_hex_color(hex: &str) -> Option<(f64, f64, f64)> {
    let s = hex.strip_prefix('#').unwrap_or(hex);
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).ok()? as f64 / 255.0;
        let g = u8::from_str_radix(&s[2..4], 16).ok()? as f64 / 255.0;
        let b = u8::from_str_radix(&s[4..6], 16).ok()? as f64 / 255.0;
        Some((r, g, b))
    } else if s.len() == 3 {
        let r = u8::from_str_radix(&s[0..1], 16).ok()? as f64 / 15.0;
        let g = u8::from_str_radix(&s[1..2], 16).ok()? as f64 / 15.0;
        let b = u8::from_str_radix(&s[2..3], 16).ok()? as f64 / 15.0;
        Some((r, g, b))
    } else {
        None
    }
}

/// Calcola la luminosità percepita di un colore per garantire il contrasto del testo.
fn is_color_bright(r: f64, g: f64, b: f64) -> bool {
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lum > 0.55
}

/// Funzione di disegno dell'intera mappa su Cairo.
fn draw_map(
    _area: &gtk::DrawingArea,
    cr: &gtk::cairo::Context,
    view_w: f64,
    view_h: f64,
    state: &MapViewState,
) {
    let dark = state.dark.get();
    let pal = if dark {
        MapPalette::dark()
    } else {
        MapPalette::light()
    };

    // 1. Sfondo del canvas
    cr.set_source_rgb(pal.bg_r, pal.bg_g, pal.bg_b);
    let _ = cr.paint();

    let pan_x = state.pan_x.get();
    let pan_y = state.pan_y.get();
    let zoom = state.zoom.get();

    // 2. Griglia a puntini sottile (se zoom sufficiente)
    let grid_spacing = 28.0 * zoom;
    if grid_spacing >= 12.0 {
        let start_x = (pan_x % grid_spacing + grid_spacing) % grid_spacing;
        let start_y = (pan_y % grid_spacing + grid_spacing) % grid_spacing;
        cr.set_source_rgba(pal.grid_r, pal.grid_g, pal.grid_b, pal.grid_alpha);
        let mut gx = start_x;
        while gx < view_w {
            let mut gy = start_y;
            while gy < view_h {
                cr.arc(gx, gy, 1.2, 0.0, std::f64::consts::PI * 2.0);
                let _ = cr.fill();
                gy += grid_spacing;
            }
            gx += grid_spacing;
        }
    }

    let l = state.layout.borrow();
    if l.is_empty() {
        return;
    }

    // 3. Trasformazione dello spazio di disegno (Viewport)
    let _ = cr.save();
    cr.translate(pan_x, pan_y);
    cr.scale(zoom, zoom);

    // Coordinate visibili nel mondo del layout per il culling
    let vx1 = -pan_x / zoom;
    let vy1 = -pan_y / zoom;
    let vx2 = (view_w - pan_x) / zoom;
    let vy2 = (view_h - pan_y) / zoom;

    // 4. Disegno collegamenti (Edge)
    for edge in &l.edges {
        let p = &l.nodes[edge.parent];
        let c = &l.nodes[edge.child];

        // Culling: verifica se l'arco ricade vicino all'area visibile
        let min_x = p.x.min(c.x);
        let max_x = (p.x + p.w).max(c.x + c.w);
        let min_y = p.y.min(c.y);
        let max_y = (p.y + p.h).max(c.y + c.h);
        if max_x < vx1 || min_x > vx2 || max_y < vy1 || min_y > vy2 {
            continue;
        }

        let p1 = (p.x + p.w, p.y + p.h / 2.0);
        let p2 = (c.x, c.y + c.h / 2.0);
        let mid_x = (p1.0 + p2.0) / 2.0;

        cr.set_line_width(2.0);
        if let Some((r, g, b)) = c.fill.as_deref().and_then(parse_hex_color) {
            cr.set_source_rgba(r, g, b, 0.85);
        } else {
            cr.set_source_rgb(pal.edge_r, pal.edge_g, pal.edge_b);
        }

        cr.move_to(p1.0, p1.1);
        cr.curve_to(mid_x, p1.1, mid_x, p2.1, p2.0, p2.1);
        let _ = cr.stroke();
    }

    // 5. Disegno nodi (Cards)
    let selected_id = state.selected.borrow().clone();

    for node in &l.nodes {
        // Culling del nodo
        if node.x + node.w + 24.0 < vx1 || node.x > vx2 || node.y + node.h < vy1 || node.y > vy2 {
            continue;
        }

        let is_selected = selected_id.as_deref() == Some(&node.id);
        let radius = 7.0;

        // Bordo / Sfondo del nodo
        rounded_rect(cr, node.x, node.y, node.w, node.h, radius);

        let custom_color = node.fill.as_deref().and_then(parse_hex_color);
        if let Some((r, g, b)) = custom_color {
            cr.set_source_rgb(r, g, b);
        } else {
            cr.set_source_rgb(pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
        }
        let _ = cr.fill_preserve();

        // Contorno
        if is_selected {
            // Evidenziazione blocco selezionato con contorno blu vivo
            cr.set_source_rgb(0.21, 0.52, 0.89);
            cr.set_line_width(2.8);
        } else if let Some((r, g, b)) = custom_color {
            // Contorno leggermente più scuro del colore del ramo
            cr.set_source_rgb((r * 0.8).max(0.0), (g * 0.8).max(0.0), (b * 0.8).max(0.0));
            cr.set_line_width(1.4);
        } else {
            cr.set_source_rgb(pal.card_border_r, pal.card_border_g, pal.card_border_b);
            cr.set_line_width(1.2);
        }
        let _ = cr.stroke();

        // Testo del nodo con Pango
        let pango_layout = pangocairo::functions::create_layout(cr);
        let mut font = pango::FontDescription::from_string("Sans 11");
        if node.depth == 0 {
            font.set_weight(pango::Weight::Bold);
        }
        pango_layout.set_font_description(Some(&font));

        let title_text = if !node.display_title.is_empty() {
            &node.display_title
        } else {
            &node.title
        };
        pango_layout.set_text(title_text);
        let max_text_w = (node.w - 24.0).max(60.0);
        pango_layout.set_width((max_text_w * pango::SCALE as f64) as i32);
        pango_layout.set_wrap(pango::WrapMode::WordChar);
        pango_layout.set_ellipsize(pango::EllipsizeMode::End);

        // Scelta del colore del testo in base al contrasto
        if let Some((r, g, b)) = custom_color {
            if is_color_bright(r, g, b) {
                cr.set_source_rgb(0.1, 0.1, 0.1);
            } else {
                cr.set_source_rgb(0.96, 0.96, 0.96);
            }
        } else {
            cr.set_source_rgb(pal.text_r, pal.text_g, pal.text_b);
        }

        cr.move_to(node.x + 12.0, node.y + 8.0);
        pangocairo::functions::show_layout(cr, &pango_layout);

        // Badge inferiori (indicatori di note, etichette e marker)
        let mut badge_x = node.x + 12.0;
        let badge_y = node.y + node.h - 14.0;

        if node.has_notes {
            draw_note_badge(cr, badge_x, badge_y);
            badge_x += 16.0;
        }

        for marker in node.markers.iter().take(2) {
            draw_marker_badge(cr, badge_x, badge_y, marker);
            badge_x += 20.0;
        }

        for label in node.labels.iter().take(2) {
            draw_label_badge(cr, badge_x, badge_y, label);
            badge_x += 32.0;
        }

        // Indicatore di collasso / espansione (pillola tonda a destra del nodo)
        if node.child_count > 0 {
            if let Some((bx, by, bw, bh)) = node.collapse_indicator_rect() {
                let cx = bx + bw / 2.0;
                let cy = by + bh / 2.0;
                let r = bw / 2.0;

                cr.arc(cx, cy, r, 0.0, std::f64::consts::PI * 2.0);
                if node.collapsed {
                    cr.set_source_rgb(0.21, 0.52, 0.89);
                    let _ = cr.fill();

                    // Segno "+" all'interno della pillola
                    cr.set_source_rgb(1.0, 1.0, 1.0);
                    cr.set_line_width(1.8);
                    cr.move_to(cx - 3.5, cy);
                    cr.line_to(cx + 3.5, cy);
                    cr.move_to(cx, cy - 3.5);
                    cr.line_to(cx, cy + 3.5);
                    let _ = cr.stroke();
                } else {
                    cr.set_source_rgb(pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
                    let _ = cr.fill_preserve();
                    cr.set_source_rgb(pal.card_border_r, pal.card_border_g, pal.card_border_b);
                    cr.set_line_width(1.2);
                    let _ = cr.stroke();

                    // Segno "-" all'interno della pillola
                    cr.set_source_rgb(pal.text_r, pal.text_g, pal.text_b);
                    cr.set_line_width(1.6);
                    cr.move_to(cx - 3.5, cy);
                    cr.line_to(cx + 3.5, cy);
                    let _ = cr.stroke();
                }
            }
        }
    }

    let _ = cr.restore();
}

/// Disegna un piccolo badge per le note.
fn draw_note_badge(cr: &gtk::cairo::Context, x: f64, y: f64) {
    cr.rectangle(x, y - 6.0, 9.0, 9.0);
    cr.set_source_rgb(0.95, 0.77, 0.2);
    let _ = cr.fill_preserve();
    cr.set_source_rgb(0.7, 0.55, 0.1);
    cr.set_line_width(0.8);
    let _ = cr.stroke();
}

/// Disegna un piccolo badge circolare per un marker.
fn draw_marker_badge(cr: &gtk::cairo::Context, x: f64, y: f64, marker_id: &str) {
    cr.arc(x + 5.0, y - 2.0, 5.0, 0.0, std::f64::consts::PI * 2.0);
    if marker_id.starts_with("priority-1") {
        cr.set_source_rgb(0.9, 0.25, 0.2);
    } else if marker_id.starts_with("priority") {
        cr.set_source_rgb(0.95, 0.65, 0.15);
    } else if marker_id.starts_with("task") {
        cr.set_source_rgb(0.2, 0.7, 0.4);
    } else {
        cr.set_source_rgb(0.4, 0.6, 0.9);
    }
    let _ = cr.fill();
}

/// Disegna una piccola targhetta per un'etichetta.
fn draw_label_badge(cr: &gtk::cairo::Context, x: f64, y: f64, _label: &str) {
    rounded_rect(cr, x, y - 7.0, 24.0, 9.0, 2.5);
    cr.set_source_rgba(0.4, 0.4, 0.4, 0.3);
    let _ = cr.fill();
}
