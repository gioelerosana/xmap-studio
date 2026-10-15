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
    /// Bordo del topic centrale: più marcato per staccarlo dai figli.
    root_border_r: f64,
    root_border_g: f64,
    root_border_b: f64,
}

impl MapPalette {
    fn dark() -> Self {
        Self {
            bg_r: 0.082,
            bg_g: 0.094,
            bg_b: 0.125,
            grid_r: 0.345,
            grid_g: 0.380,
            grid_b: 0.443,
            grid_alpha: 0.20,
            edge_r: 0.451,
            edge_g: 0.494,
            edge_b: 0.561,
            card_bg_r: 0.133,
            card_bg_g: 0.153,
            card_bg_b: 0.192,
            card_border_r: 0.231,
            card_border_g: 0.263,
            card_border_b: 0.314,
            text_r: 0.914,
            text_g: 0.929,
            text_b: 0.953,
            root_border_r: 0.663,
            root_border_g: 0.749,
            root_border_b: 0.910,
        }
    }

    fn light() -> Self {
        Self {
            bg_r: 0.973,
            bg_g: 0.976,
            bg_b: 0.988,
            grid_r: 0.722,
            grid_g: 0.757,
            grid_b: 0.812,
            grid_alpha: 0.22,
            edge_r: 0.604,
            edge_g: 0.647,
            edge_b: 0.710,
            card_bg_r: 1.0,
            card_bg_g: 1.0,
            card_bg_b: 1.0,
            card_border_r: 0.804,
            card_border_g: 0.827,
            card_border_b: 0.871,
            text_r: 0.125,
            text_g: 0.141,
            text_b: 0.173,
            root_border_r: 0.180,
            root_border_g: 0.204,
            root_border_b: 0.251,
        }
    }
}

/// Larghezza massima del contenuto testuale prima di andare a capo.
const TEXT_MAX_W: f64 = 400.0;
/// Dimensioni massime dell'immagine/equazione disegnata dentro una card.
const IMG_MAX_W: f64 = 400.0;
const IMG_MAX_H: f64 = 260.0;

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
    /// Byte grezzi delle immagini/equazioni per `image_src` (forniti dalla UI,
    /// che è l'unica a poter leggere l'archivio).
    images: RefCell<HashMap<String, Vec<u8>>>,
    /// Cache delle superfici Cairo decodificate (immagini/equazioni), per non
    /// ridecodificare il PNG a ogni frame.
    surfaces: RefCell<HashMap<String, Option<gtk::cairo::ImageSurface>>>,
    on_select: RefCell<Option<SelectCallback>>,
    pending_fit: Cell<bool>,
    /// Etichetta della percentuale di zoom, aggiornata anche dalle animazioni.
    zoom_label: RefCell<Option<gtk::Label>>,
    /// Ultima posizione del puntatore sull'area (àncora di Ctrl+rotella).
    pointer: Cell<Option<(f64, f64)>>,
    /// Zoom iniziale e punto del mondo sotto le dita all'inizio del pinch.
    pinch_origin: Cell<(f64, f64, f64)>,
    /// Vero se l'ultimo scorrimento era uno zoom (niente inerzia al termine).
    scroll_zooming: Cell<bool>,
    /// Ultimi campioni del trascinamento (tempo µs, offset) per l'inerzia.
    drag_samples: RefCell<Vec<(i64, f64, f64)>>,
    /// Animazione di vista in corso e flag del tick callback attivo.
    anim: RefCell<Option<ViewAnim>>,
    ticking: Cell<bool>,
}

/// Limiti dello zoom.
const ZOOM_MIN: f64 = 0.1;
const ZOOM_MAX: f64 = 4.0;
/// Sensibilità dello zoom con Ctrl+scorrimento continuo (touchpad): fattore
/// `exp(-dy · rate)` per pixel di scorrimento.
const SMOOTH_ZOOM_RATE: f64 = 0.012;
/// Fattore per scatto di rotella e per i pulsanti +/−.
const WHEEL_ZOOM_STEP: f64 = 1.18;
const BUTTON_ZOOM_STEP: f64 = 1.25;
/// Pixel di pan per scatto di rotella.
const WHEEL_PAN_STEP: f64 = 48.0;
/// Durate delle animazioni (µs).
const ZOOM_ANIM_US: i64 = 170_000;
const VIEW_ANIM_US: i64 = 260_000;
/// Attrito dell'inerzia (1/s) e velocità sotto cui si ferma (px/s).
const KINETIC_FRICTION: f64 = 4.5;
const KINETIC_STOP: f64 = 15.0;

/// Animazione della vista, avanzata dal tick callback del frame clock così da
/// muoversi alla frequenza dello schermo.
#[derive(Debug, Clone, Copy)]
enum ViewAnim {
    /// Zoom verso `to` tenendo fermo il punto del mondo `world` sotto `anchor`.
    Zoom {
        anchor: (f64, f64),
        world: (f64, f64),
        from: f64,
        to: f64,
        start: i64,
    },
    /// Passaggio a zoom e pan dati (adatta, centra nodo).
    View {
        from_zoom: f64,
        to_zoom: f64,
        from_pan: (f64, f64),
        to_pan: (f64, f64),
        start: i64,
    },
    /// Scorrimento inerziale con velocità in px/s.
    Kinetic { velocity: (f64, f64), last: i64 },
}

/// Misuratore di nodi con Pango e cache in memoria.
struct CanvasMetrics<'a> {
    pango_ctx: pango::Context,
    cache: &'a RefCell<HashMap<String, (f64, f64)>>,
    images: &'a RefCell<HashMap<String, Vec<u8>>>,
    surfaces: &'a RefCell<HashMap<String, Option<gtk::cairo::ImageSurface>>>,
}

/// Font del titolo in base alla profondità: il topic centrale è più grande.
fn title_font(depth: usize) -> pango::FontDescription {
    let mut font = pango::FontDescription::new();
    font.set_family("Sans");
    let (size, weight) = if depth == 0 {
        (16.0, pango::Weight::Semibold)
    } else if depth == 1 {
        (13.0, pango::Weight::Semibold)
    } else {
        (11.5, pango::Weight::Normal)
    };
    font.set_weight(weight);
    font.set_size((size * pango::SCALE as f64) as i32);
    font
}

/// Padding e dimensioni minime coerenti fra misura e disegno.
fn node_insets(depth: usize, boxed: bool) -> (f64, f64, f64, f64) {
    if depth == 0 {
        (18.0, 12.0, 132.0, 46.0)
    } else if depth == 1 {
        (14.0, 9.0, 116.0, 38.0)
    } else if boxed {
        (10.0, 7.0, 72.0, 32.0)
    } else {
        (6.0, 3.0, 0.0, 21.0)
    }
}

fn mix_rgb(a: (f64, f64, f64), b: (f64, f64, f64), amount: f64) -> (f64, f64, f64) {
    let amount = amount.clamp(0.0, 1.0);
    (
        a.0 * amount + b.0 * (1.0 - amount),
        a.1 * amount + b.1 * (1.0 - amount),
        a.2 * amount + b.2 * (1.0 - amount),
    )
}

/// Decodifica un PNG in una superficie Cairo, con cache per non ripetere il
/// lavoro a ogni frame. `None` (e memorizzato) se i byte non sono un PNG valido.
fn surface_for(
    src: &str,
    images: &RefCell<HashMap<String, Vec<u8>>>,
    surfaces: &RefCell<HashMap<String, Option<gtk::cairo::ImageSurface>>>,
) -> Option<gtk::cairo::ImageSurface> {
    if !surfaces.borrow().contains_key(src) {
        let decoded = images.borrow().get(src).and_then(|bytes| {
            gtk::cairo::ImageSurface::create_from_png(&mut bytes.as_slice()).ok()
        });
        surfaces.borrow_mut().insert(src.to_string(), decoded);
    }
    surfaces.borrow().get(src).and_then(|s| s.clone())
}

/// Opzioni font senza hinting: con l'hinting le larghezze dei glifi si
/// agganciano ai pixel del dispositivo e, durante uno zoom continuo, il testo
/// "trema" e cambia larghezza. Misura e disegno devono usare le stesse opzioni.
fn apply_smooth_font_options(ctx: &pango::Context) {
    if let Ok(mut options) = gtk::cairo::FontOptions::new() {
        options.set_hint_metrics(gtk::cairo::HintMetrics::Off);
        options.set_hint_style(gtk::cairo::HintStyle::None);
        pangocairo::functions::context_set_font_options(ctx, Some(&options));
    }
}

/// Porta `(w, h)` dentro i limiti `(max_w, max_h)` conservando le proporzioni.
/// Non ingrandisce mai: un'immagine più piccola resta alla sua dimensione.
fn fit_size(w: f64, h: f64, max_w: f64, max_h: f64) -> (f64, f64) {
    let w = w.max(1.0);
    let h = h.max(1.0);
    let scale = (max_w / w).min(max_h / h).min(1.0);
    (w * scale, h * scale)
}

/// Vero se il nodo va disegnato come box (topic centrale, ramo di primo livello,
/// oppure nodo con un fill esplicito o un'immagine). Gli altri livelli sono testo
/// nudo, come nelle Logic Chart di XMind.
fn node_is_boxed(node: &MapNode) -> bool {
    node.depth <= 1 || node.fill_color.is_some() || node.image_src.is_some()
}

impl<'a> NodeMetrics for CanvasMetrics<'a> {
    fn measure(&self, node: &MapNode) -> (f64, f64) {
        let text = if !node.display_title.is_empty() {
            &node.display_title
        } else {
            &node.title
        };
        let boxed = node_is_boxed(node);
        let max_text_w = node.custom_width.unwrap_or(TEXT_MAX_W);
        let key = format!(
            "{}:{}:{}:{}:{}:{}:{}:{:?}:{:?}:{}:{:?}",
            node.id,
            text,
            node.depth,
            node.markers.len(),
            node.labels.len(),
            node.image_src.as_deref().unwrap_or(""),
            boxed,
            node.image_w,
            node.image_h,
            node.has_notes,
            node.custom_width,
        );
        if let Some(&size) = self.cache.borrow().get(&key) {
            return size;
        }

        // Equazioni e immagini si dimensionano sull'immagine, non sul testo.
        if let Some(src) = node.image_src.as_deref() {
            // Le dimensioni logiche dichiarate nel file sono la fonte primaria;
            // se mancano si usa la dimensione intrinseca del PNG.
            let intrinsic = node.image_w.zip(node.image_h).or_else(|| {
                surface_for(src, self.images, self.surfaces)
                    .map(|s| (s.width() as f64, s.height() as f64))
            });
            if let Some((iw, ih)) = intrinsic {
                let (max_w, max_h) = if node.kind == "equation" || node.latex.is_some() {
                    (650.0, 250.0)
                } else {
                    (IMG_MAX_W, IMG_MAX_H)
                };
                let (dw, dh) = fit_size(iw, ih, max_w, max_h);
                let (pad_x, pad_y, min_w, min_h) = node_insets(node.depth, true);
                let w = (dw + pad_x * 2.0).max(min_w);
                let mut h = (dh + pad_y * 2.0).max(min_h);
                if !node.markers.is_empty() || !node.labels.is_empty() || node.has_notes {
                    h += 18.0;
                }
                let size = (w, h);
                self.cache.borrow_mut().insert(key, size);
                return size;
            }
        }

        let layout = pango::Layout::new(&self.pango_ctx);
        layout.set_font_description(Some(&title_font(node.depth)));
        layout.set_text(text);
        layout.set_wrap(pango::WrapMode::WordChar);

        // Prima passata alla larghezza massima per conoscere la larghezza reale
        // del testo; poi si ri-impagina alla larghezza effettiva scelta, così
        // misura e disegno coincidono riga per riga.
        layout.set_width((max_text_w * pango::SCALE as f64) as i32);
        // Larghezza in unità Pango arrotondata per eccesso (+1 px di margine):
        // `pixel_size` arrotonda al pixel più vicino e, reimpaginando a quella
        // larghezza, l'ultima lettera può finire a capo ("Binari-e").
        let pw = (layout.size().0 as f64 / pango::SCALE as f64).ceil() + 1.0;
        let (pad_x, pad_y, min_w, min_h) = node_insets(node.depth, boxed);
        let min_content = (min_w - pad_x * 2.0).max(0.0);
        let content_w = pw.clamp(min_content, max_text_w);
        layout.set_width((content_w * pango::SCALE as f64) as i32);
        let (_pw2, ph) = layout.pixel_size();

        let mut w = content_w + pad_x * 2.0;
        let mut h = (ph as f64 + pad_y * 2.0).max(min_h);
        if !node.markers.is_empty() || !node.labels.is_empty() || node.has_notes {
            h += if boxed { 16.0 } else { 14.0 };
            if boxed {
                w = w.max(min_w);
            }
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
            images: RefCell::new(HashMap::new()),
            surfaces: RefCell::new(HashMap::new()),
            on_select: RefCell::new(Some(Box::new(on_select))),
            pending_fit: Cell::new(false),
            zoom_label: RefCell::new(None),
            pointer: Cell::new(None),
            pinch_origin: Cell::new((1.0, 0.0, 0.0)),
            scroll_zooming: Cell::new(false),
            drag_samples: RefCell::new(Vec::new()),
            anim: RefCell::new(None),
            ticking: Cell::new(false),
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
        *state.zoom_label.borrow_mut() = Some(zoom_label.clone());

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
            let area_weak = area.downgrade();
            area.set_draw_func(move |_area, cr, width, height| {
                if state.pending_fit.get() && width > 20 && height > 20 {
                    state.pending_fit.set(false);
                    if let Some(a) = area_weak.upgrade() {
                        fit_to_view_internal(&state, &a, false);
                    }
                }
                draw_map(cr, width as f64, height as f64, &state);
            });
        }

        // Trascinamento col mouse: pan, con inerzia al rilascio.
        {
            let drag = gtk::GestureDrag::new();
            let state_begin = state.clone();
            drag.connect_drag_begin(move |_, _, _| {
                stop_animation(&state_begin);
                state_begin
                    .drag_start_pan
                    .set((state_begin.pan_x.get(), state_begin.pan_y.get()));
                state_begin.drag_samples.borrow_mut().clear();
            });
            let state_update = state.clone();
            let area_update = area.clone();
            drag.connect_drag_update(move |_, offset_x, offset_y| {
                let (sx, sy) = state_update.drag_start_pan.get();
                state_update.pan_x.set(sx + offset_x);
                state_update.pan_y.set(sy + offset_y);
                push_drag_sample(&state_update, offset_x, offset_y);
                area_update.queue_draw();
            });
            let state_end = state.clone();
            let area_end = area.clone();
            drag.connect_drag_end(move |_, _, _| {
                if let Some(velocity) = drag_release_velocity(&state_end) {
                    start_kinetic(&state_end, &area_end, velocity);
                }
            });
            area.add_controller(drag);
        }

        // Posizione del puntatore: àncora dello zoom con Ctrl+rotella.
        {
            let motion = gtk::EventControllerMotion::new();
            let state_motion = state.clone();
            motion.connect_motion(move |_, x, y| state_motion.pointer.set(Some((x, y))));
            let state_leave = state.clone();
            motion.connect_leave(move |_| state_leave.pointer.set(None));
            area.add_controller(motion);
        }

        // Rotella e touchpad: pan con lo scorrimento (inerziale sul touchpad),
        // zoom con Ctrl. Il touchpad invia delta continui in pixel e va seguito
        // 1:1; la rotella del mouse invia scatti e si anima verso il bersaglio.
        {
            let scroll = gtk::EventControllerScroll::new(
                gtk::EventControllerScrollFlags::BOTH_AXES
                    | gtk::EventControllerScrollFlags::KINETIC,
            );
            let state_scroll = state.clone();
            let area_scroll = area.clone();
            scroll.connect_scroll(move |scroll, dx, dy| {
                let is_ctrl = scroll
                    .current_event_state()
                    .contains(gtk::gdk::ModifierType::CONTROL_MASK);
                let smooth = scroll.unit() == gtk::gdk::ScrollUnit::Surface;
                state_scroll.scroll_zooming.set(is_ctrl);

                if is_ctrl {
                    let anchor = pointer_or_center(&state_scroll, &area_scroll);
                    if smooth {
                        stop_animation(&state_scroll);
                        let target = state_scroll.zoom.get() * (-dy * SMOOTH_ZOOM_RATE).exp();
                        set_zoom_at(&state_scroll, target, anchor);
                        sync_zoom_label(&state_scroll);
                        area_scroll.queue_draw();
                    } else {
                        animate_zoom_by(
                            &state_scroll,
                            &area_scroll,
                            WHEEL_ZOOM_STEP.powf(-dy),
                            anchor,
                        );
                    }
                } else {
                    stop_animation(&state_scroll);
                    let k = if smooth { 1.0 } else { WHEEL_PAN_STEP };
                    state_scroll.pan_x.set(state_scroll.pan_x.get() - dx * k);
                    state_scroll.pan_y.set(state_scroll.pan_y.get() - dy * k);
                    area_scroll.queue_draw();
                }
                glib::Propagation::Stop
            });
            let state_dec = state.clone();
            let area_dec = area.clone();
            scroll.connect_decelerate(move |_, vx, vy| {
                if !state_dec.scroll_zooming.get() {
                    start_kinetic(&state_dec, &area_dec, (-vx, -vy));
                }
            });
            area.add_controller(scroll);
        }

        // Pinch-to-zoom (touchpad e touchscreen): gesto nativo di GTK, continuo e
        // ancorato al punto fra le dita, che può anche spostarsi durante il gesto.
        {
            let pinch = gtk::GestureZoom::new();
            let state_begin = state.clone();
            let area_begin = area.clone();
            pinch.connect_begin(move |gesture, _| {
                stop_animation(&state_begin);
                let (cx, cy) = gesture
                    .bounding_box_center()
                    .unwrap_or_else(|| pointer_or_center(&state_begin, &area_begin));
                let z = state_begin.zoom.get();
                state_begin.pinch_origin.set((
                    z,
                    (cx - state_begin.pan_x.get()) / z,
                    (cy - state_begin.pan_y.get()) / z,
                ));
            });
            let state_scale = state.clone();
            let area_scale = area.clone();
            pinch.connect_scale_changed(move |gesture, scale| {
                let (z0, wx, wy) = state_scale.pinch_origin.get();
                let (cx, cy) = gesture
                    .bounding_box_center()
                    .unwrap_or_else(|| pointer_or_center(&state_scale, &area_scale));
                let z = (z0 * scale).clamp(ZOOM_MIN, ZOOM_MAX);
                state_scale.zoom.set(z);
                state_scale.pan_x.set(cx - wx * z);
                state_scale.pan_y.set(cy - wy * z);
                sync_zoom_label(&state_scale);
                area_scale.queue_draw();
            });
            area.add_controller(pinch);
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
            zoom_in_btn.connect_clicked(move |_| {
                let center = view_center(&area_clone);
                animate_zoom_by(&state, &area_clone, BUTTON_ZOOM_STEP, center);
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            zoom_out_btn.connect_clicked(move |_| {
                let center = view_center(&area_clone);
                animate_zoom_by(&state, &area_clone, 1.0 / BUTTON_ZOOM_STEP, center);
            });
        }

        {
            let state = state.clone();
            let area_clone = area.clone();
            fit_btn.connect_clicked(move |_| {
                fit_to_view_internal(&state, &area_clone, true);
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
            sheet_drop.connect_selected_notify(move |drop| {
                let idx = drop.selected() as usize;
                if state.active_sheet.get() != idx {
                    state.active_sheet.set(idx);
                    recompute_layout(&state, &area_clone);
                    fit_to_view_internal(&state, &area_clone, false);
                }
            });
        }

        Self {
            container,
            area,
            sheet_drop,
            sheet_store,
            state,
        }
    }

    /// Restituisce il contenitore widget da inserire nello stack dell'interfaccia.
    pub fn widget(&self) -> &gtk::Box {
        &self.container
    }

    /// Aggiorna il modello del workbook visualizzato nella mappa.
    ///
    /// `active_sheet` a `None` mantiene il foglio corrente (limitato al numero di
    /// fogli disponibili): un refresh non deve riportare la vista al primo foglio.
    pub fn set_workbook(&self, sheets: &[SheetDto], active_sheet: Option<usize>) {
        *self.state.sheets.borrow_mut() = sheets.to_vec();
        self.state.metrics_cache.borrow_mut().clear();
        let current = self.state.active_sheet.get();
        let idx = active_sheet
            .unwrap_or(current)
            .min(sheets.len().saturating_sub(1));
        self.state.active_sheet.set(idx);

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
        self.sheet_drop.set_selected(idx as u32);

        recompute_layout(&self.state, &self.area);
        self.state.pending_fit.set(true);
        self.fit_to_view();
        self.area.queue_draw();
    }

    /// Il foglio attualmente visualizzato.
    pub fn active_sheet(&self) -> usize {
        self.state.active_sheet.get()
    }

    /// Torna al primo foglio (usato all'apertura di un nuovo file).
    pub fn reset_sheet(&self) {
        if self.state.active_sheet.get() != 0 {
            self.state.active_sheet.set(0);
            if self.state.sheets.borrow().len() > 1 {
                self.sheet_drop.set_selected(0);
            }
            recompute_layout(&self.state, &self.area);
            self.state.pending_fit.set(true);
            self.fit_to_view();
            self.area.queue_draw();
        }
    }

    /// Fornisce i byte delle immagini/equazioni (per `image_src`) da disegnare
    /// nei blocchi. Le superfici decodificate vengono invalidate solo per le
    /// immagini realmente cambiate.
    pub fn set_images(&self, images: HashMap<String, Vec<u8>>) {
        let mut changed = false;
        {
            let mut cur = self.state.images.borrow_mut();
            let mut surf = self.state.surfaces.borrow_mut();
            for (key, bytes) in &images {
                if cur.get(key) != Some(bytes) {
                    surf.remove(key);
                    cur.insert(key.clone(), bytes.clone());
                    changed = true;
                }
            }
            let stale: Vec<String> = cur
                .keys()
                .filter(|k| !images.contains_key(*k))
                .cloned()
                .collect();
            for key in stale {
                cur.remove(&key);
                surf.remove(&key);
                changed = true;
            }
        }
        if changed {
            self.state.metrics_cache.borrow_mut().clear();
            recompute_layout(&self.state, &self.area);
            self.area.queue_draw();
        }
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
        fit_to_view_internal(&self.state, &self.area, false);
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
    let pango_ctx = area.create_pango_context();
    apply_smooth_font_options(&pango_ctx);
    let metrics = CanvasMetrics {
        pango_ctx,
        cache: &state.metrics_cache,
        images: &state.images,
        surfaces: &state.surfaces,
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

/// Porta in vista il nodo `id` con un'animazione, solo se non è già visibile
/// per intero: selezionare un nodo sulla mappa non deve far saltare la vista.
fn scroll_to_node(state: &Rc<MapViewState>, area: &gtk::DrawingArea, id: &str) {
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
    let (px, py) = (state.pan_x.get(), state.pan_y.get());
    let margin = 24.0;
    let visible = node.x * z + px >= margin
        && node.y * z + py >= margin
        && (node.x + node.w) * z + px <= view_w - margin
        && (node.y + node.h) * z + py <= view_h - margin;
    if visible {
        return;
    }
    let node_cx = (node.x + node.w / 2.0) * z;
    let node_cy = (node.y + node.h / 2.0) * z;
    let target = (view_w / 2.0 - node_cx, view_h / 2.0 - node_cy);
    drop(l);
    animate_view_to(state, area, z, target);
}

/// Adatta zoom e pan della mappa al rettangolo visibile dell'area, con o senza
/// animazione.
fn fit_to_view_internal(state: &Rc<MapViewState>, area: &gtk::DrawingArea, animate: bool) {
    let l = state.layout.borrow();
    if l.is_empty() {
        return;
    }
    let view_w = area.width() as f64;
    let view_h = area.height() as f64;
    if view_w <= 20.0 || view_h <= 20.0 {
        state.pending_fit.set(true);
        return;
    }

    let min_x = l.nodes.iter().map(|n| n.x).fold(f64::INFINITY, f64::min);
    let min_y = l.nodes.iter().map(|n| n.y).fold(f64::INFINITY, f64::min);
    let max_x = l
        .nodes
        .iter()
        .map(|n| n.x + n.w)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = l
        .nodes
        .iter()
        .map(|n| n.y + n.h)
        .fold(f64::NEG_INFINITY, f64::max);
    drop(l);

    let content_w = (max_x - min_x).max(10.0);
    let content_h = (max_y - min_y).max(10.0);

    let margin = 56.0;
    let scale_x = (view_w - margin * 2.0) / content_w;
    let scale_y = (view_h - margin * 2.0) / content_h;
    let new_zoom = scale_x.min(scale_y).clamp(0.2, 1.8);

    let center_x = (min_x + max_x) / 2.0;
    let center_y = (min_y + max_y) / 2.0;
    let pan = (
        view_w / 2.0 - center_x * new_zoom,
        view_h / 2.0 - center_y * new_zoom,
    );
    if animate {
        animate_view_to(state, area, new_zoom, pan);
    } else {
        stop_animation(state);
        state.zoom.set(new_zoom);
        state.pan_x.set(pan.0);
        state.pan_y.set(pan.1);
        sync_zoom_label(state);
        area.queue_draw();
    }
}

/// Tempo del frame clock in µs (monotono), con ripiego sull'orologio di GLib
/// quando l'area non è ancora realizzata.
fn now_us(area: &gtk::DrawingArea) -> i64 {
    area.frame_clock()
        .map(|c| c.frame_time())
        .unwrap_or_else(glib::monotonic_time)
}

fn view_center(area: &gtk::DrawingArea) -> (f64, f64) {
    (area.width() as f64 / 2.0, area.height() as f64 / 2.0)
}

fn pointer_or_center(state: &MapViewState, area: &gtk::DrawingArea) -> (f64, f64) {
    state.pointer.get().unwrap_or_else(|| view_center(area))
}

/// Imposta lo zoom tenendo fermo il punto del mondo che sta sotto `anchor`.
fn set_zoom_at(state: &MapViewState, zoom: f64, anchor: (f64, f64)) {
    let old = state.zoom.get();
    let zoom = zoom.clamp(ZOOM_MIN, ZOOM_MAX);
    let wx = (anchor.0 - state.pan_x.get()) / old;
    let wy = (anchor.1 - state.pan_y.get()) / old;
    state.zoom.set(zoom);
    state.pan_x.set(anchor.0 - wx * zoom);
    state.pan_y.set(anchor.1 - wy * zoom);
}

fn sync_zoom_label(state: &MapViewState) {
    if let Some(label) = state.zoom_label.borrow().as_ref() {
        label.set_label(&format!("{}%", (state.zoom.get() * 100.0).round() as i64));
    }
}

fn stop_animation(state: &MapViewState) {
    state.anim.borrow_mut().take();
}

/// Zoom animato di un fattore attorno ad `anchor`. Scatti ravvicinati si
/// sommano al bersaglio dell'animazione in corso invece di ripartire dallo
/// zoom attuale, così la rotella resta reattiva e senza scatti.
fn animate_zoom_by(
    state: &Rc<MapViewState>,
    area: &gtk::DrawingArea,
    factor: f64,
    anchor: (f64, f64),
) {
    let current = state.zoom.get();
    let base = match *state.anim.borrow() {
        Some(ViewAnim::Zoom { to, .. }) => to,
        _ => current,
    };
    let to = (base * factor).clamp(ZOOM_MIN, ZOOM_MAX);
    let world = (
        (anchor.0 - state.pan_x.get()) / current,
        (anchor.1 - state.pan_y.get()) / current,
    );
    *state.anim.borrow_mut() = Some(ViewAnim::Zoom {
        anchor,
        world,
        from: current,
        to,
        start: now_us(area),
    });
    ensure_ticking(state, area);
}

fn animate_view_to(state: &Rc<MapViewState>, area: &gtk::DrawingArea, zoom: f64, pan: (f64, f64)) {
    *state.anim.borrow_mut() = Some(ViewAnim::View {
        from_zoom: state.zoom.get(),
        to_zoom: zoom.clamp(ZOOM_MIN, ZOOM_MAX),
        from_pan: (state.pan_x.get(), state.pan_y.get()),
        to_pan: pan,
        start: now_us(area),
    });
    ensure_ticking(state, area);
}

fn start_kinetic(state: &Rc<MapViewState>, area: &gtk::DrawingArea, velocity: (f64, f64)) {
    if velocity.0.hypot(velocity.1) < KINETIC_STOP * 4.0 {
        return;
    }
    *state.anim.borrow_mut() = Some(ViewAnim::Kinetic {
        velocity,
        last: now_us(area),
    });
    ensure_ticking(state, area);
}

/// Registra un campione del trascinamento (ultimi 100 ms).
fn push_drag_sample(state: &MapViewState, x: f64, y: f64) {
    let now = glib::monotonic_time();
    let mut samples = state.drag_samples.borrow_mut();
    samples.push((now, x, y));
    samples.retain(|(t, _, _)| now - t <= 100_000);
}

/// Velocità (px/s) al rilascio del trascinamento, se il gesto era ancora in
/// movimento: un rilascio da fermo non deve far scivolare la mappa.
fn drag_release_velocity(state: &MapViewState) -> Option<(f64, f64)> {
    let samples = state.drag_samples.borrow();
    let &(t1, x1, y1) = samples.last()?;
    let &(t0, x0, y0) = samples.first()?;
    let dt = (t1 - t0) as f64 / 1_000_000.0;
    if dt < 0.01 || glib::monotonic_time() - t1 > 50_000 {
        return None;
    }
    Some(((x1 - x0) / dt, (y1 - y0) / dt))
}

/// Avvia (una sola volta) il tick callback che fa avanzare l'animazione a ogni
/// frame; si spegne da solo a fine animazione per non tenere sveglio il
/// frame clock.
fn ensure_ticking(state: &Rc<MapViewState>, area: &gtk::DrawingArea) {
    if state.ticking.replace(true) {
        return;
    }
    let state = state.clone();
    area.add_tick_callback(move |area, clock| {
        let running = step_animation(&state, clock.frame_time());
        sync_zoom_label(&state);
        area.queue_draw();
        if running {
            glib::ControlFlow::Continue
        } else {
            state.ticking.set(false);
            glib::ControlFlow::Break
        }
    });
}

fn ease_out_cubic(t: f64) -> f64 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

/// Fa avanzare l'animazione all'istante `now` (µs). Ritorna `false` quando non
/// resta nulla da animare.
fn step_animation(state: &MapViewState, now: i64) -> bool {
    let Some(anim) = *state.anim.borrow() else {
        return false;
    };
    let (next, running) = match anim {
        ViewAnim::Zoom {
            anchor,
            world,
            from,
            to,
            start,
        } => {
            let t = (now - start) as f64 / ZOOM_ANIM_US as f64;
            // Interpolazione geometrica: la velocità percepita resta costante.
            let z = from * (to / from).powf(ease_out_cubic(t));
            state.zoom.set(z);
            state.pan_x.set(anchor.0 - world.0 * z);
            state.pan_y.set(anchor.1 - world.1 * z);
            (Some(anim), t < 1.0)
        }
        ViewAnim::View {
            from_zoom,
            to_zoom,
            from_pan,
            to_pan,
            start,
        } => {
            let e = ease_out_cubic((now - start) as f64 / VIEW_ANIM_US as f64);
            state.zoom.set(from_zoom * (to_zoom / from_zoom).powf(e));
            state.pan_x.set(from_pan.0 + (to_pan.0 - from_pan.0) * e);
            state.pan_y.set(from_pan.1 + (to_pan.1 - from_pan.1) * e);
            (Some(anim), e < 1.0)
        }
        ViewAnim::Kinetic { velocity, last } => {
            let dt = ((now - last) as f64 / 1_000_000.0).clamp(0.0, 0.05);
            state.pan_x.set(state.pan_x.get() + velocity.0 * dt);
            state.pan_y.set(state.pan_y.get() + velocity.1 * dt);
            let decay = (-KINETIC_FRICTION * dt).exp();
            let velocity = (velocity.0 * decay, velocity.1 * decay);
            let running = velocity.0.hypot(velocity.1) > KINETIC_STOP;
            (
                Some(ViewAnim::Kinetic {
                    velocity,
                    last: now,
                }),
                running,
            )
        }
    };
    *state.anim.borrow_mut() = if running { next } else { None };
    running
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
fn draw_map(cr: &gtk::cairo::Context, view_w: f64, view_h: f64, state: &MapViewState) {
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

    // 2. Griglia a puntini sottile (se zoom sufficiente), batching in un unico fill
    let grid_spacing = 32.0 * zoom;
    if grid_spacing >= 18.0 {
        let start_x = (pan_x % grid_spacing + grid_spacing) % grid_spacing;
        let start_y = (pan_y % grid_spacing + grid_spacing) % grid_spacing;
        cr.set_source_rgba(pal.grid_r, pal.grid_g, pal.grid_b, pal.grid_alpha);
        let mut gx = start_x;
        while gx < view_w {
            let mut gy = start_y;
            while gy < view_h {
                cr.new_sub_path();
                cr.arc(gx, gy, 0.8, 0.0, std::f64::consts::PI * 2.0);
                gy += grid_spacing;
            }
            gx += grid_spacing;
        }
        let _ = cr.fill();
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

    // 4. Collegamenti: dal lato destro del genitore al lato sinistro del figlio,
    //    a gomito arrotondato e col colore del ramo (stile Logic Chart XMind).
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

        let x2 = c.x;
        let y2 = c.y + c.h / 2.0;

        let edge_alpha = if c.depth <= 1 { 0.90 } else { 0.72 };
        let base_w: f64 = if c.depth <= 1 { 1.9 } else { 1.25 };
        // Mantiene i rami nitidi e chiaramente visibili anche a fattori di zoom ridotti
        cr.set_line_width(base_w.max(1.0 / zoom));
        cr.set_line_cap(gtk::cairo::LineCap::Round);
        if let Some((r, g, b)) = c.accent.as_deref().and_then(parse_hex_color) {
            cr.set_source_rgba(r, g, b, edge_alpha);
        } else {
            cr.set_source_rgba(pal.edge_r, pal.edge_g, pal.edge_b, 0.70);
        }

        match edge.kind {
            layout::EdgeKind::Logic => elbow(cr, p.x + p.w, p.y + p.h / 2.0, x2, y2, 18.0),
            layout::EdgeKind::Tree => {
                // Il tronco è condiviso da tutti i rami: neutro, altrimenti
                // prenderebbe il colore dell'ultimo ramo disegnato.
                let _ = cr.save();
                cr.set_source_rgba(pal.edge_r, pal.edge_g, pal.edge_b, 0.85);
                cr.move_to(p.trunk_x(), p.y + p.h);
                cr.line_to(p.trunk_x(), y2);
                let _ = cr.stroke();
                let _ = cr.restore();
                trunk_branch(cr, p.trunk_x(), p.y + p.h, x2, y2);
            }
        }
        let _ = cr.stroke();
    }

    // 4a. Graffe dei sommari, col colore del ramo, collegate al topic di sommario.
    for summary in &l.summaries {
        let Some(topic) = l.nodes.get(summary.topic) else {
            continue;
        };
        if summary.x > vx2 || topic.x + topic.w < vx1 || summary.y2 < vy1 || summary.y1 > vy2 {
            continue;
        }
        if let Some((r, g, b)) = summary.accent.as_deref().and_then(parse_hex_color) {
            cr.set_source_rgba(r, g, b, 0.85);
        } else {
            cr.set_source_rgba(pal.edge_r, pal.edge_g, pal.edge_b, 0.80);
        }
        cr.set_line_width(1.6_f64.max(1.0 / zoom));
        cr.set_line_cap(gtk::cairo::LineCap::Round);
        brace(
            cr,
            summary.x,
            summary.y1,
            summary.y2,
            layout::SUMMARY_BRACE_W,
        );
        let mid = (summary.y1 + summary.y2) / 2.0;
        cr.move_to(summary.x + layout::SUMMARY_BRACE_W, mid);
        cr.line_to(topic.x, topic.y + topic.h / 2.0);
        let _ = cr.stroke();
    }

    // 4b. Relazioni / Collegamenti XMind (curve tratteggiate con freccia e titolo)
    for rel in &l.relationships {
        if rel.from >= l.nodes.len() || rel.to >= l.nodes.len() {
            continue;
        }
        let from_node = &l.nodes[rel.from];
        let to_node = &l.nodes[rel.to];

        // Culling delle relazioni esterne alla vista
        let min_rx = from_node.x.min(to_node.x);
        let max_rx = (from_node.x + from_node.w).max(to_node.x + to_node.w);
        let min_ry = from_node.y.min(to_node.y);
        let max_ry = (from_node.y + from_node.h).max(to_node.y + to_node.h);
        if max_rx + 40.0 < vx1 || min_rx - 40.0 > vx2 || max_ry + 40.0 < vy1 || min_ry - 40.0 > vy2
        {
            continue;
        }

        draw_relationship(
            cr,
            from_node,
            to_node,
            rel.title.as_deref(),
            rel.accent.as_deref(),
            &pal,
            zoom,
        );
    }

    // 5. Disegno nodi: box per centrale/rami, testo nudo per i livelli profondi.
    let selected_id = state.selected.borrow().clone();

    // Ottimizzazione prestazioni: riutilizziamo le font description statiche
    // e un unico pango_layout per frame invece di allocarli a ogni nodo (60+ fps).
    let font_root = title_font(0);
    let font_branch = title_font(1);
    let font_leaf = title_font(2);

    let pango_layout = pangocairo::functions::create_layout(cr);
    apply_smooth_font_options(&pango_layout.context());
    pango_layout.context_changed();
    pango_layout.set_wrap(pango::WrapMode::WordChar);
    pango_layout.set_ellipsize(pango::EllipsizeMode::None);

    for node in &l.nodes {
        // Culling del nodo
        if node.x + node.w + 24.0 < vx1
            || node.x > vx2
            || node.y + node.h + 24.0 < vy1
            || node.y > vy2
        {
            continue;
        }

        let is_selected = selected_id.as_deref() == Some(&node.id);
        let is_media = node.image_src.is_some();
        let boxed = node.depth <= 1 || node.fill.is_some() || is_media;
        let custom_color = node.fill.as_deref().and_then(parse_hex_color);
        let accent_color = node.accent.as_deref().and_then(parse_hex_color);
        // Il colore saturo resta sui connettori; il primo livello usa una tinta
        // pastello. Immagini ed equazioni vivono invece su card neutre.
        let box_fill = if is_media {
            Some((pal.card_bg_r, pal.card_bg_g, pal.card_bg_b))
        } else if let Some(color) = custom_color {
            Some(color)
        } else if node.depth == 1 {
            accent_color.map(|accent| {
                let base = (pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
                mix_rgb(accent, base, if dark { 0.42 } else { 0.38 })
            })
        } else {
            None
        };

        if boxed {
            let radius = if node.depth == 0 {
                10.0
            } else if node.depth == 1 {
                8.0
            } else {
                6.0
            };
            if is_selected {
                rounded_rect(
                    cr,
                    node.x - 3.0,
                    node.y - 3.0,
                    node.w + 6.0,
                    node.h + 6.0,
                    radius + 3.0,
                );
                cr.set_source_rgba(0.14, 0.52, 1.0, 0.14);
                let _ = cr.fill();
            }
            rounded_rect(cr, node.x, node.y, node.w, node.h, radius);
            if let Some((r, g, b)) = box_fill {
                cr.set_source_rgb(r, g, b);
            } else {
                cr.set_source_rgb(pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
            }
            let _ = cr.fill_preserve();

            let border_w = (1.0_f64).max(0.75 / zoom);
            // Il bordo resta coerente col nodo anche durante la selezione.
            if is_selected {
                cr.set_source_rgb(0.14, 0.52, 1.0);
                cr.set_line_width(1.7_f64.max(1.2 / zoom));
            } else if node.depth == 0 {
                cr.set_source_rgb(pal.root_border_r, pal.root_border_g, pal.root_border_b);
                cr.set_line_width(1.8_f64.max(1.0 / zoom));
            } else if node.depth == 1 {
                let (r, g, b) = accent_color.unwrap_or((
                    pal.card_border_r,
                    pal.card_border_g,
                    pal.card_border_b,
                ));
                cr.set_source_rgb(
                    (r * 0.85).max(0.0),
                    (g * 0.85).max(0.0),
                    (b * 0.85).max(0.0),
                );
                cr.set_line_width(1.1_f64.max(0.8 / zoom));
            } else {
                cr.set_source_rgb(pal.card_border_r, pal.card_border_g, pal.card_border_b);
                cr.set_line_width(border_w);
            }
            let _ = cr.stroke();
        } else if is_selected {
            // I nodi testuali non hanno box: li si evidenzia con uno sfondo soft.
            rounded_rect(
                cr,
                node.x - 4.0,
                node.y - 2.0,
                node.w + 8.0,
                node.h + 4.0,
                5.0,
            );
            cr.set_source_rgba(0.14, 0.52, 1.0, 0.11);
            let _ = cr.fill_preserve();
            cr.set_source_rgba(0.14, 0.52, 1.0, 0.55);
            cr.set_line_width((1.0_f64).max(0.75 / zoom));
            let _ = cr.stroke();
        }

        // Contenuto: immagine/equazione se disponibile, altrimenti testo.
        let (pad_x, pad_y, _, _) = node_insets(node.depth, boxed);
        let content_x = node.x + pad_x;
        let content_y = node.y + pad_y;
        let content_w = (node.w - pad_x * 2.0).max(20.0);
        let has_badges = !node.markers.is_empty() || !node.labels.is_empty() || node.has_notes;
        let badge_reserve = if has_badges { 16.0 } else { 0.0 };
        let content_h = (node.h - pad_y * 2.0 - badge_reserve).max(10.0);

        let drawn = node.image_src.as_deref().is_some_and(|src| {
            let Some(surface) = surface_for(src, &state.images, &state.surfaces) else {
                return false;
            };
            let is_equation = node.kind == "equation" || node.latex.is_some();
            let text_color = (pal.text_r, pal.text_g, pal.text_b);
            draw_image(
                cr,
                content_x,
                content_y,
                content_w,
                content_h,
                node.image_w.zip(node.image_h),
                &surface,
                is_equation,
                text_color,
            );
            true
        });

        if !drawn {
            let font_desc = match node.depth {
                0 => &font_root,
                1 => &font_branch,
                _ => &font_leaf,
            };
            pango_layout.set_font_description(Some(font_desc));

            let title_text = if !node.display_title.is_empty() {
                &node.display_title
            } else {
                &node.title
            };
            pango_layout.set_text(title_text);
            // La larghezza di wrapping deve coincidere esattamente con quella misurata
            // in coordinate logiche di layout, senza moltiplicare per lo zoom, in modo
            // che le righe e il testo restino perfettamente fissi e proporzionati a
            // qualsiasi fattore di zoom (inclusi forti de-zoom), senza sbordare.
            pango_layout.set_width((content_w * pango::SCALE as f64) as i32);

            // I nodi testuali profondi usano sempre il colore del canvas; il
            // contrasto sul fill si applica solo a un box realmente disegnato.
            if boxed && custom_color.is_some() {
                let (r, g, b) = box_fill.unwrap_or((pal.card_bg_r, pal.card_bg_g, pal.card_bg_b));
                if is_color_bright(r, g, b) {
                    cr.set_source_rgb(0.12, 0.12, 0.12);
                } else {
                    cr.set_source_rgb(0.98, 0.98, 0.98);
                }
            } else {
                cr.set_source_rgb(pal.text_r, pal.text_g, pal.text_b);
            }

            let (_, ph) = pango_layout.pixel_size();
            let y_offset = ((content_h - ph as f64) / 2.0).max(0.0);
            cr.move_to(content_x, content_y + y_offset);
            pangocairo::functions::show_layout(cr, &pango_layout);
        }

        // Badge inferiori solo per i box (i nodi testuali restano puliti).
        if boxed {
            let mut badge_x = node.x + pad_x;
            let badge_y = node.y + node.h - 12.0;

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
        }

        // Indicatore di collasso / espansione (pillola tonda a destra del blocco)
        if node.child_count > 0 {
            if let Some((bx, by, bw, bh)) = node.collapse_indicator_rect() {
                let cx = bx + bw / 2.0;
                let cy = by + bh / 2.0;
                let r = bw / 2.0;

                if node.collapsed {
                    cr.arc(cx, cy, r, 0.0, std::f64::consts::PI * 2.0);
                    cr.set_source_rgb(0.21, 0.52, 0.89);
                    let _ = cr.fill();

                    // Segno "+" all'interno della pillola
                    cr.set_source_rgb(1.0, 1.0, 1.0);
                    cr.set_line_width((1.8_f64).max(1.0 / zoom));
                    cr.move_to(cx - 3.5, cy);
                    cr.line_to(cx + 3.5, cy);
                    cr.move_to(cx, cy - 3.5);
                    cr.line_to(cx, cy + 3.5);
                    let _ = cr.stroke();
                } else if is_selected {
                    cr.arc(cx, cy, r, 0.0, std::f64::consts::PI * 2.0);
                    cr.set_source_rgb(pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
                    let _ = cr.fill_preserve();
                    cr.set_source_rgb(pal.card_border_r, pal.card_border_g, pal.card_border_b);
                    cr.set_line_width((1.2_f64).max(0.8 / zoom));
                    let _ = cr.stroke();

                    // Segno "-" all'interno della pillola
                    cr.set_source_rgb(pal.text_r, pal.text_g, pal.text_b);
                    cr.set_line_width((1.6_f64).max(1.0 / zoom));
                    cr.move_to(cx - 3.5, cy);
                    cr.line_to(cx + 3.5, cy);
                    let _ = cr.stroke();
                } else {
                    cr.arc(cx, cy, 2.25, 0.0, std::f64::consts::PI * 2.0);
                    if let Some((r, g, b)) = accent_color {
                        cr.set_source_rgba(r, g, b, 0.72);
                    } else {
                        cr.set_source_rgba(pal.edge_r, pal.edge_g, pal.edge_b, 0.72);
                    }
                    let _ = cr.fill();
                }
            }
        }
    }

    let _ = cr.restore();
}

/// Traccia un connettore a gomito con bus verticale condiviso tra fratelli:
/// esce dal lato destro del genitore, corre in verticale lungo il bus e rientra
/// nel lato sinistro del figlio. I segmenti verticali dei fratelli coincidono e
/// formano il "tronco" tipico delle Logic Chart di XMind.
fn elbow(cr: &gtk::cairo::Context, x1: f64, y1: f64, x2: f64, y2: f64, stub: f64) {
    if (y2 - y1).abs() < 0.5 {
        cr.move_to(x1, y1);
        cr.line_to(x2, y2);
        return;
    }
    let bus_x = x1 + stub.min((x2 - x1).abs() * 0.6);
    let dir = if y2 > y1 { 1.0 } else { -1.0 };
    let rr = 6.0_f64
        .min((bus_x - x1).abs())
        .min((y2 - y1).abs() * 0.5)
        .max(0.0);

    cr.move_to(x1, y1);
    cr.line_to(bus_x - rr, y1);
    cr.curve_to(
        bus_x - rr * 0.45,
        y1,
        bus_x,
        y1 + dir * rr * 0.45,
        bus_x,
        y1 + dir * rr,
    );
    cr.line_to(bus_x, y2 - dir * rr);
    cr.curve_to(
        bus_x,
        y2 - dir * rr * 0.45,
        bus_x + rr * 0.45,
        y2,
        bus_x + rr,
        y2,
    );
    cr.line_to(x2, y2);
}

/// Ramo della Tree Chart: dal tronco verticale in `trunk_x` (che parte dal
/// fondo del genitore in `y1` ed è disegnato a parte) piega ad angolo
/// arrotondato verso il figlio.
fn trunk_branch(cr: &gtk::cairo::Context, trunk_x: f64, y1: f64, x2: f64, y2: f64) {
    let rr = 8.0_f64
        .min((x2 - trunk_x).abs())
        .min((y2 - y1).abs())
        .max(0.0);
    cr.move_to(trunk_x, y2 - rr);
    cr.curve_to(
        trunk_x,
        y2 - rr * 0.45,
        trunk_x + rr * 0.45,
        y2,
        trunk_x + rr,
        y2,
    );
    cr.line_to(x2, y2);
}

/// Traccia una graffa chiusa verso destra ("}") alta da `y1` a `y2`, con la
/// punta a metà altezza in `x + w`: è il segno dei sommari di XMind.
fn brace(cr: &gtk::cairo::Context, x: f64, y1: f64, y2: f64, w: f64) {
    let mid = (y1 + y2) / 2.0;
    let half = w / 2.0;
    let r = half.min((y2 - y1) / 4.0).max(0.0);
    let xm = x + half;
    cr.move_to(x, y1);
    cr.curve_to(xm, y1, xm, y1, xm, y1 + r);
    cr.line_to(xm, mid - r);
    cr.curve_to(xm, mid, xm, mid, x + w, mid);
    cr.curve_to(xm, mid, xm, mid, xm, mid + r);
    cr.line_to(xm, y2 - r);
    cr.curve_to(xm, y2, xm, y2, x, y2);
}

/// Disegna un'immagine (equazione o foto) centrata e ridimensionata nell'area.
fn draw_image(
    cr: &gtk::cairo::Context,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    logical_size: Option<(f64, f64)>,
    surface: &gtk::cairo::ImageSurface,
    is_equation: bool,
    text_color: (f64, f64, f64),
) {
    let sw = surface.width() as f64;
    let sh = surface.height() as f64;
    if sw <= 0.0 || sh <= 0.0 {
        return;
    }
    let (desired_w, desired_h) = logical_size.unwrap_or((sw, sh));
    let (dw, dh) = fit_size(desired_w, desired_h, w, h);
    let scale_x = dw / sw;
    let scale_y = dh / sh;
    let dx = x + (w - dw) / 2.0;
    let dy = y + (h - dh) / 2.0;

    let _ = cr.save();
    cr.translate(dx, dy);
    cr.scale(scale_x, scale_y);
    if is_equation {
        // Per le equazioni MathJax rasterizzate come inchiostro nero su alfa trasparente:
        // usiamo la superficie come maschera per colorare i glifi col colore testo del tema,
        // garantendo contrasto impeccabile sia in tema chiaro che scuro.
        cr.set_source_rgb(text_color.0, text_color.1, text_color.2);
        let _ = cr.mask_surface(surface, 0.0, 0.0);
    } else {
        if cr.set_source_surface(surface, 0.0, 0.0).is_ok() {
            cr.source().set_filter(gtk::cairo::Filter::Best);
        }
        let _ = cr.paint();
    }
    let _ = cr.restore();
}

/// Disegna un collegamento/relazione tra due nodi (curva Bézier con tratteggio, freccia e titolo).
fn draw_relationship(
    cr: &gtk::cairo::Context,
    n1: &crate::layout::LayoutNode,
    n2: &crate::layout::LayoutNode,
    title: Option<&str>,
    accent: Option<&str>,
    pal: &MapPalette,
    zoom: f64,
) {
    let c1x = n1.x + n1.w / 2.0;
    let c1y = n1.y + n1.h / 2.0;
    let c2x = n2.x + n2.w / 2.0;
    let c2y = n2.y + n2.h / 2.0;

    let (sx, sy, ex, ey) = if c2x >= n1.x + n1.w {
        // Target a destra
        (n1.x + n1.w, c1y, n2.x, c2y)
    } else if c2x + n2.w <= n1.x {
        // Target a sinistra
        (n1.x, c1y, n2.x + n2.w, c2y)
    } else if c2y > c1y {
        // Target sotto
        (c1x, n1.y + n1.h, c2x, n2.y)
    } else {
        // Target sopra
        (c1x, n1.y, c2x, n2.y + n2.h)
    };

    let dx = (ex - sx).abs() * 0.45;
    let cp1x = if ex >= sx {
        sx + dx.max(30.0)
    } else {
        sx - dx.max(30.0)
    };
    let cp1y = sy;
    let cp2x = if ex >= sx {
        ex - dx.max(30.0)
    } else {
        ex + dx.max(30.0)
    };
    let cp2y = ey;

    let _ = cr.save();

    let (r, g, b) = accent
        .and_then(parse_hex_color)
        .unwrap_or((pal.edge_r, pal.edge_g, pal.edge_b));

    cr.set_source_rgba(r, g, b, 0.85);
    cr.set_line_width((1.8_f64).max(1.0 / zoom));
    cr.set_line_cap(gtk::cairo::LineCap::Round);

    // Tratteggio elegante stile XMind
    cr.set_dash(&[6.0, 4.0], 0.0);
    cr.move_to(sx, sy);
    cr.curve_to(cp1x, cp1y, cp2x, cp2y, ex, ey);
    let _ = cr.stroke();

    // Freccia al termine del collegamento (rivolta verso ex, ey)
    cr.set_dash(&[], 0.0);
    let angle = (ey - cp2y).atan2(ex - cp2x);
    let arrow_len = 10.0;
    let arrow_w = 4.5;
    cr.move_to(ex, ey);
    cr.line_to(
        ex - arrow_len * angle.cos() + arrow_w * angle.sin(),
        ey - arrow_len * angle.sin() - arrow_w * angle.cos(),
    );
    cr.line_to(
        ex - arrow_len * angle.cos() - arrow_w * angle.sin(),
        ey - arrow_len * angle.sin() + arrow_w * angle.cos(),
    );
    cr.close_path();
    let _ = cr.fill();

    // Etichetta del collegamento (titolo), se presente
    if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
        let mx = 0.125 * sx + 0.375 * cp1x + 0.375 * cp2x + 0.125 * ex;
        let my = 0.125 * sy + 0.375 * cp1y + 0.375 * cp2y + 0.125 * ey;

        let layout = pangocairo::functions::create_layout(cr);
        let mut desc = pango::FontDescription::new();
        desc.set_family("sans-serif");
        desc.set_size((9.0 * pango::SCALE as f64) as i32);
        layout.set_font_description(Some(&desc));
        layout.set_text(t);

        let (tw, th) = layout.pixel_size();
        let pw = tw as f64 + 14.0;
        let ph = th as f64 + 6.0;
        let px = mx - pw / 2.0;
        let py = my - ph / 2.0;

        rounded_rect(cr, px, py, pw, ph, 4.0);
        cr.set_source_rgb(pal.card_bg_r, pal.card_bg_g, pal.card_bg_b);
        let _ = cr.fill_preserve();
        cr.set_source_rgba(r, g, b, 0.7);
        cr.set_line_width((1.0_f64).max(0.75 / zoom));
        let _ = cr.stroke();

        cr.set_source_rgb(pal.text_r, pal.text_g, pal.text_b);
        cr.move_to(px + 7.0, py + 3.0);
        pangocairo::functions::show_layout(cr, &layout);
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

#[cfg(test)]
mod tests {
    use super::*;

    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="currentColor"/></svg>"#;

    #[test]
    fn decodes_png_and_caches_surface() {
        let png = crate::raster::svg_to_png(SVG, 40.0, 20.0, 1.0, "#000000").unwrap();
        let images = RefCell::new(HashMap::from([("xap:resources/x.png".to_string(), png)]));
        let surfaces = RefCell::new(HashMap::new());

        let surface = surface_for("xap:resources/x.png", &images, &surfaces);
        assert!(surface.is_some(), "il PNG deve decodificarsi");
        assert!(surfaces.borrow().contains_key("xap:resources/x.png"));

        // Una sorgente sconosciuta non deve andare in panico e resta `None`.
        assert!(surface_for("xap:resources/missing.png", &images, &surfaces).is_none());
    }

    #[test]
    fn fit_size_preserves_aspect_ratio() {
        let (w, h) = fit_size(100.0, 50.0, 80.0, 80.0);
        assert!((w - 80.0).abs() < 0.01 && (h - 40.0).abs() < 0.01);
    }

    #[allow(clippy::too_many_arguments)]
    fn topic(
        id: &str,
        parent: Option<&str>,
        depth: usize,
        title: &str,
        fill: Option<&str>,
    ) -> crate::state::TopicView {
        crate::state::TopicView {
            id: id.into(),
            sheet_index: 0,
            parent_id: parent.map(str::to_string),
            depth,
            group: "attached".into(),
            title: title.into(),
            display_title: title.into(),
            kind: "text",
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
            boundaries: Vec::new(),
            summaries: Vec::new(),
            task: None,
            fill_color: fill.map(str::to_string),
            position: None,
            custom_width: None,
            structure_class: None,
        }
    }

    /// Snapshot headless della mappa, utile per la verifica visiva locale.
    /// Si attiva solo con `XMAP_SNAPSHOT=<percorso.png>`.
    #[test]
    fn headless_snapshot() {
        let Ok(path) = std::env::var("XMAP_SNAPSHOT") else {
            eprintln!("skip: XMAP_SNAPSHOT non impostato");
            return;
        };

        let mut topics = vec![
            topic("root", None, 0, "Funzioni", None),
            topic("b1", Some("root"), 1, "Definizione", None),
            topic(
                "d1",
                Some("b1"),
                2,
                "f ⊆ A × B ⟺ ∀a ∈ A, ∃! b ∈ B, b = f(a)",
                None,
            ),
            topic("d2", Some("b1"), 2, "dati", None),
            topic("d2a", Some("d2"), 3, "A' ⊆ A", None),
            topic("d2b", Some("d2"), 3, "B' ⊆ B", None),
            topic("b2", Some("root"), 1, "Proprietà", None),
            topic("p1", Some("b2"), 2, "Suriettiva", None),
            topic("p2", Some("b2"), 2, "Iniettiva", None),
            topic("p3", Some("b2"), 2, "Biettiva", None),
            topic("b3", Some("root"), 1, "Funzione inversa", None),
            topic("f1", Some("b3"), 2, "f possiede inversa destra g", None),
            topic(
                "f2",
                Some("b3"),
                2,
                "In generale g e h non sono uniche",
                None,
            ),
            topic("b4", Some("root"), 1, "Teorema di fattorizzazione", None),
            topic("t1", Some("b4"), 2, "ker f", None),
            topic("t2", Some("b4"), 2, "date", None),
            topic("b5", Some("root"), 1, "Cardinalità", None),
        ];
        let mut t_det = topic("det1", Some("root"), 1, "Schema suriettiva", None);
        t_det.group = "detached".to_string();
        t_det.notes = "Dimostrazione grafica".to_string();
        topics.push(t_det);

        let relationships = vec![crate::state::RelationshipView {
            id: "r1".to_string(),
            end1_id: "p1".to_string(),
            end2_id: "det1".to_string(),
            title: "grafico".to_string(),
        }];

        let sheet = SheetDto {
            index: 0,
            id: Some("s1".into()),
            title: "Funzioni".into(),
            topics,
            relationships,
        };

        let state = MapViewState {
            sheets: RefCell::new(vec![sheet.clone()]),
            active_sheet: Cell::new(0),
            collapsed: RefCell::new(HashSet::new()),
            selected: RefCell::new(Some("b2".to_string())),
            layout: RefCell::new(Layout::default()),
            pan_x: Cell::new(20.0),
            pan_y: Cell::new(20.0),
            zoom: Cell::new(1.0),
            drag_start_pan: Cell::new((20.0, 20.0)),
            dark: Cell::new(true),
            metrics_cache: RefCell::new(HashMap::new()),
            images: RefCell::new(HashMap::new()),
            surfaces: RefCell::new(HashMap::new()),
            on_select: RefCell::new(None),
            pending_fit: Cell::new(false),
            zoom_label: RefCell::new(None),
            pointer: Cell::new(None),
            pinch_origin: Cell::new((1.0, 0.0, 0.0)),
            scroll_zooming: Cell::new(false),
            drag_samples: RefCell::new(Vec::new()),
            anim: RefCell::new(None),
            ticking: Cell::new(false),
        };

        let width = 1500;
        let height = 1200;
        let surface =
            gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, width, height).unwrap();
        let cr = gtk::cairo::Context::new(&surface).unwrap();
        let pango_ctx = pangocairo::functions::create_context(&cr);
        apply_smooth_font_options(&pango_ctx);

        {
            let collapsed = state.collapsed.borrow();
            let metrics = CanvasMetrics {
                pango_ctx,
                cache: &state.metrics_cache,
                images: &state.images,
                surfaces: &state.surfaces,
            };
            let l = layout::layout_single_sheet(
                &sheet,
                &collapsed,
                &metrics,
                layout::LayoutOpts::default(),
            );
            *state.layout.borrow_mut() = l;
        }

        // Replica il comportamento di "Adatta" della UI: lo snapshot deve
        // mostrare la mappa alla scala d'uso reale, non persa nel canvas.
        {
            let l = state.layout.borrow();
            let margin = 64.0;
            let scale_x = (width as f64 - margin * 2.0) / l.width;
            let scale_y = (height as f64 - margin * 2.0) / l.height;
            let zoom = scale_x.min(scale_y).clamp(0.2, 1.8);
            state.zoom.set(zoom);
            state.pan_x.set((width as f64 - l.width * zoom) / 2.0);
            state.pan_y.set((height as f64 - l.height * zoom) / 2.0);
        }

        draw_map(&cr, width as f64, height as f64, &state);
        let mut file = std::fs::File::create(&path).unwrap();
        surface.write_to_png(&mut file).unwrap();
        eprintln!("snapshot scritto in: {path}");
    }

    #[test]
    fn real_map_snapshot() {
        let Ok(file_path) = std::env::var("REAL_MAP_FILE") else {
            return;
        };
        let out_path = std::env::var("REAL_MAP_OUT").unwrap_or_else(|_| "/tmp/real_map.png".into());

        let mut controller = crate::controller::AppController::new();
        let wb = controller.open(&file_path).expect("open workbook");
        let sheet = &wb.sheets[0];

        let mut images = HashMap::new();
        for topic in &sheet.topics {
            if let Some(src) = topic.image_src.as_deref() {
                if !images.contains_key(src) {
                    if let Some(bytes) = controller.resource_bytes(src) {
                        images.insert(src.to_string(), bytes);
                    }
                }
            }
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

        let state = MapViewState {
            sheets: RefCell::new(vec![sheet.clone()]),
            active_sheet: Cell::new(0),
            collapsed: RefCell::new(HashSet::new()),
            selected: RefCell::new(None),
            layout: RefCell::new(Layout::default()),
            pan_x: Cell::new(20.0),
            pan_y: Cell::new(20.0),
            zoom: Cell::new(1.0),
            drag_start_pan: Cell::new((20.0, 20.0)),
            dark: Cell::new(true),
            metrics_cache: RefCell::new(HashMap::new()),
            images: RefCell::new(images),
            surfaces: RefCell::new(HashMap::new()),
            on_select: RefCell::new(None),
            pending_fit: Cell::new(false),
            zoom_label: RefCell::new(None),
            pointer: Cell::new(None),
            pinch_origin: Cell::new((1.0, 0.0, 0.0)),
            scroll_zooming: Cell::new(false),
            drag_samples: RefCell::new(Vec::new()),
            anim: RefCell::new(None),
            ticking: Cell::new(false),
        };

        let width = 2400;
        let height = 1800;
        let surface =
            gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, width, height).unwrap();
        let cr = gtk::cairo::Context::new(&surface).unwrap();
        let pango_ctx = pangocairo::functions::create_context(&cr);
        apply_smooth_font_options(&pango_ctx);

        {
            let collapsed = state.collapsed.borrow();
            let metrics = CanvasMetrics {
                pango_ctx,
                cache: &state.metrics_cache,
                images: &state.images,
                surfaces: &state.surfaces,
            };
            let l = layout::layout_single_sheet(
                sheet,
                &collapsed,
                &metrics,
                layout::LayoutOpts::default(),
            );
            *state.layout.borrow_mut() = l;
        }

        {
            let l = state.layout.borrow();
            let margin = 64.0;
            let scale_x = (width as f64 - margin * 2.0) / l.width;
            let scale_y = (height as f64 - margin * 2.0) / l.height;
            let zoom = scale_x.min(scale_y).clamp(0.2, 1.8);
            state.zoom.set(zoom);
            state.pan_x.set((width as f64 - l.width * zoom) / 2.0);
            state.pan_y.set((height as f64 - l.height * zoom) / 2.0);
        }

        draw_map(&cr, width as f64, height as f64, &state);
        let mut file = std::fs::File::create(&out_path).unwrap();
        surface.write_to_png(&mut file).unwrap();
        eprintln!("Real map snapshot scritto in: {out_path}");
    }

    #[test]
    fn zoom_does_not_alter_text_wrapping_or_overflow() {
        let surface =
            gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, 800, 600).unwrap();
        let cr = gtk::cairo::Context::new(&surface).unwrap();

        let long_title = "Questo è un titolo lungo di un nodo di test per verificare che lo zoom non alteri il testo né lo faccia sbordare.";
        let content_w = 200.0;
        let font = title_font(1);

        // Zoom 1.0
        let l1 = pangocairo::functions::create_layout(&cr);
        l1.set_font_description(Some(&font));
        l1.set_text(long_title);
        l1.set_wrap(pango::WrapMode::WordChar);
        l1.set_width((content_w * pango::SCALE as f64) as i32);
        let lines_1 = l1.line_count();
        let (_, h1) = l1.pixel_size();

        // Zoom 0.35 (forte de-zoom)
        cr.save().unwrap();
        cr.scale(0.35, 0.35);
        let l_zoomed = pangocairo::functions::create_layout(&cr);
        l_zoomed.set_font_description(Some(&font));
        l_zoomed.set_text(long_title);
        l_zoomed.set_wrap(pango::WrapMode::WordChar);
        l_zoomed.set_width((content_w * pango::SCALE as f64) as i32);
        let lines_zoomed = l_zoomed.line_count();
        let (_, h_zoomed) = l_zoomed.pixel_size();
        cr.restore().unwrap();

        assert!(
            (lines_1 as i32 - lines_zoomed as i32).abs() <= 1,
            "Il numero di righe deve rimanere stabile tra zoom 1.0 e de-zoom 0.35 (got {lines_1} vs {lines_zoomed})"
        );
        assert!(
            h_zoomed <= h1 + 4,
            "L'altezza del testo non deve sbordare rispetto a zoom 1.0 (h1={h1}, h_zoomed={h_zoomed})"
        );
    }

    fn view_state() -> MapViewState {
        MapViewState {
            sheets: RefCell::new(Vec::new()),
            active_sheet: Cell::new(0),
            collapsed: RefCell::new(HashSet::new()),
            selected: RefCell::new(None),
            layout: RefCell::new(Layout::default()),
            pan_x: Cell::new(0.0),
            pan_y: Cell::new(0.0),
            zoom: Cell::new(1.0),
            drag_start_pan: Cell::new((0.0, 0.0)),
            dark: Cell::new(false),
            metrics_cache: RefCell::new(HashMap::new()),
            images: RefCell::new(HashMap::new()),
            surfaces: RefCell::new(HashMap::new()),
            on_select: RefCell::new(None),
            pending_fit: Cell::new(false),
            zoom_label: RefCell::new(None),
            pointer: Cell::new(None),
            pinch_origin: Cell::new((1.0, 0.0, 0.0)),
            scroll_zooming: Cell::new(false),
            drag_samples: RefCell::new(Vec::new()),
            anim: RefCell::new(None),
            ticking: Cell::new(false),
        }
    }

    /// Punto del mondo sotto la coordinata di schermo `p`.
    fn world_at(state: &MapViewState, p: (f64, f64)) -> (f64, f64) {
        let z = state.zoom.get();
        ((p.0 - state.pan_x.get()) / z, (p.1 - state.pan_y.get()) / z)
    }

    #[test]
    fn zoom_keeps_the_anchor_point_still() {
        let state = view_state();
        state.pan_x.set(37.0);
        state.pan_y.set(-12.0);
        let anchor = (300.0, 200.0);
        let before = world_at(&state, anchor);
        set_zoom_at(&state, 2.5, anchor);
        let after = world_at(&state, anchor);
        assert!((before.0 - after.0).abs() < 1e-9 && (before.1 - after.1).abs() < 1e-9);
        set_zoom_at(&state, 100.0, anchor);
        assert_eq!(state.zoom.get(), ZOOM_MAX, "lo zoom resta nei limiti");
    }

    #[test]
    fn zoom_animation_is_monotonic_anchored_and_ends_on_target() {
        let state = view_state();
        let anchor = (120.0, 80.0);
        let world = world_at(&state, anchor);
        *state.anim.borrow_mut() = Some(ViewAnim::Zoom {
            anchor,
            world,
            from: 1.0,
            to: 2.0,
            start: 0,
        });
        let mut last = 1.0;
        let mut t = 0;
        while step_animation(&state, t) {
            let z = state.zoom.get();
            assert!(z >= last, "lo zoom cresce senza ritorni");
            last = z;
            let w = world_at(&state, anchor);
            assert!((w.0 - world.0).abs() < 1e-9 && (w.1 - world.1).abs() < 1e-9);
            t += 16_000;
            assert!(t < 10 * ZOOM_ANIM_US, "l'animazione deve terminare");
        }
        assert!((state.zoom.get() - 2.0).abs() < 1e-9);
        assert!(state.anim.borrow().is_none());
    }

    #[test]
    fn kinetic_scroll_moves_in_the_flick_direction_and_stops() {
        let state = view_state();
        *state.anim.borrow_mut() = Some(ViewAnim::Kinetic {
            velocity: (800.0, -400.0),
            last: 0,
        });
        let mut t = 0;
        while step_animation(&state, t) {
            t += 16_000;
            assert!(t < 5_000_000, "l'inerzia deve esaurirsi");
        }
        assert!(state.pan_x.get() > 100.0 && state.pan_y.get() < -50.0);
    }
}
