//! Calcolo del layout grafico della mappa (nessuna dipendenza da GTK).
//!
//! Input: DTO della mappa (`SheetDto` / `TopicView`).
//! Produce la posizione dei blocchi e i collegamenti da disegnare.
//! L'algoritmo è un tidy tree **orizzontale** in stile "Logic Chart" di XMind:
//! il topic centrale sta in alto a sinistra, i rami di primo livello scendono in
//! colonna e i loro sottoalberi si sviluppano verso destra (genitore centrato
//! verticalmente sui figli). Larghezze e altezze sono variabili (fornite tramite
//! il trait `NodeMetrics`). Supporta il collasso di sotto-alberi, il colore del
//! ramo (esplicito o dalla palette XMind) e i bounds per adattare la vista.

use std::collections::{HashMap, HashSet};

use crate::model::parse_range;
use crate::state::{SheetDto, TopicView};

pub const DEFAULT_NODE_W: f64 = 180.0;
pub const DEFAULT_NODE_H: f64 = 36.0;

/// Palette "Colored Branch" del tema Snowbrush di XMind: un colore per ramo di
/// primo livello, ereditato dai discendenti. Serve a rendere i rami distinguibili
/// anche quando il file non porta un `svg:fill` esplicito.
pub const BRANCH_COLORS: [&str; 6] = [
    "#E65D5D", "#E9863F", "#C99A12", "#79A83B", "#1599B5", "#7953A9",
];

/// Un nodo dell'albero pronto per il calcolo del layout e la misurazione.
#[derive(Debug, Clone)]
pub struct MapNode {
    pub id: String,
    pub title: String,
    pub display_title: String,
    pub kind: &'static str,
    pub latex: Option<String>,
    pub fill_color: Option<String>,
    /// Colore del ramo per i collegamenti: `fill_color` se esplicito, altrimenti
    /// il colore della palette assegnato al ramo di primo livello.
    pub accent: Option<String>,
    pub image_src: Option<String>,
    pub image_w: Option<f64>,
    pub image_h: Option<f64>,
    pub labels: Vec<String>,
    pub markers: Vec<String>,
    pub has_notes: bool,
    pub notes: String,
    pub child_count: usize,
    pub group: String,
    pub depth: usize,
    pub parent_id: Option<String>,
    pub sheet_index: usize,
    pub position: Option<(f64, f64)>,
    pub custom_width: Option<f64>,
    pub structure_class: Option<String>,
    /// Figli disposti in colonna (`attached`, `callout`).
    pub children: Vec<MapNode>,
    /// Sommari: topic del gruppo `summary` con l'intervallo di figli che
    /// raccolgono. Non stanno nella colonna: si agganciano a una graffa.
    pub summaries: Vec<MapSummary>,
}

/// Un sommario XMind: la graffa abbraccia i figli `start..=end` (indici nella
/// colonna di `children`) e il topic di sommario sta alla sua destra.
#[derive(Debug, Clone)]
pub struct MapSummary {
    pub start: usize,
    pub end: usize,
    pub node: MapNode,
}

/// Un blocco posizionato nel piano del layout (coordinate in px logici).
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutNode {
    pub id: String,
    pub title: String,
    pub display_title: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub kind: &'static str,
    pub latex: Option<String>,
    pub fill: Option<String>,
    pub accent: Option<String>,
    pub image_src: Option<String>,
    pub image_w: Option<f64>,
    pub image_h: Option<f64>,
    pub labels: Vec<String>,
    pub markers: Vec<String>,
    pub has_notes: bool,
    pub child_count: usize,
    pub collapsed: bool,
    pub group: String,
    pub depth: usize,
    pub sheet_index: usize,
    pub position: Option<(f64, f64)>,
    pub custom_width: Option<f64>,
    /// Vero per il topic centrale di una Tree Chart: i figli scendono sotto di
    /// lui lungo un tronco verticale invece di uscire dal lato destro.
    pub children_below: bool,
}

/// Distanza massima del tronco della Tree Chart dal bordo sinistro della radice.
const TREE_TRUNK_INSET: f64 = 36.0;
/// Tratto orizzontale fra il tronco e i rami di primo livello.
const TREE_STUB: f64 = 30.0;
/// Spazio fra il fondo della radice e il primo ramo nella Tree Chart.
const TREE_TOP_GAP: f64 = 26.0;
/// Larghezza della graffa di un sommario e spazi attorno.
pub const SUMMARY_BRACE_W: f64 = 14.0;
const SUMMARY_GAP_BEFORE: f64 = 16.0;
const SUMMARY_GAP_AFTER: f64 = 22.0;

impl LayoutNode {
    /// Ascissa del tronco verticale di una Tree Chart (vale per `children_below`).
    pub fn trunk_x(&self) -> f64 {
        self.x + (self.w / 2.0).min(TREE_TRUNK_INSET)
    }

    /// Rettangolo del pulsante di espansione/collasso: sul lato destro del
    /// blocco, o sotto di esso alla base del tronco per la radice di una Tree
    /// Chart. Presente solo se il nodo ha figli. (x, y, w, h).
    pub fn collapse_indicator_rect(&self) -> Option<(f64, f64, f64, f64)> {
        if self.child_count == 0 {
            return None;
        }
        let r = 6.0;
        let (cx, cy) = if self.children_below {
            (self.trunk_x(), self.y + self.h + 8.0)
        } else {
            (self.x + self.w + 8.0, self.y + self.h / 2.0)
        };
        Some((cx - r, cy - r, r * 2.0, r * 2.0))
    }
}

/// Forma del connettore fra genitore e figlio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeKind {
    /// Gomito dal lato destro del genitore (Logic Chart).
    Logic,
    /// Dal tronco verticale sotto il genitore (Tree Chart).
    Tree,
}

/// Un collegamento fra due nodi, per indice in `Layout::nodes`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutEdge {
    pub parent: usize,
    pub child: usize,
    pub group: String,
    pub kind: EdgeKind,
}

/// Graffa di un sommario: verticale in `x`, da `y1` a `y2`, con la punta
/// rivolta verso il topic di sommario `topic`.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutSummary {
    pub x: f64,
    pub y1: f64,
    pub y2: f64,
    pub topic: usize,
    pub accent: Option<String>,
}

/// Un collegamento fra due nodi arbitrari (relazione / "collegamento" XMind).
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutRelationship {
    pub id: String,
    pub title: Option<String>,
    pub from: usize,
    pub to: usize,
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layout {
    pub nodes: Vec<LayoutNode>,
    pub edges: Vec<LayoutEdge>,
    pub summaries: Vec<LayoutSummary>,
    pub relationships: Vec<LayoutRelationship>,
    pub width: f64,
    pub height: f64,
}

impl Layout {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Hit test: trova l'indice del primo nodo che racchiude il punto (x, y).
    pub fn node_at(&self, x: f64, y: f64) -> Option<usize> {
        self.nodes
            .iter()
            .position(|n| x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h)
    }

    /// Hit test per l'indicatore di collapse (pulsantino tondo).
    pub fn collapse_handle_at(&self, x: f64, y: f64) -> Option<usize> {
        self.nodes.iter().position(|n| {
            if let Some((bx, by, bw, bh)) = n.collapse_indicator_rect() {
                x >= bx - 6.0 && x <= bx + bw + 6.0 && y >= by - 6.0 && y <= by + bh + 6.0
            } else {
                false
            }
        })
    }

    pub fn find_node_by_id(&self, id: &str) -> Option<usize> {
        self.nodes.iter().position(|n| n.id == id)
    }
}

pub trait NodeMetrics {
    /// Dimensioni del blocco a partire dal nodo (testo, stile, kind).
    fn measure(&self, node: &MapNode) -> (f64, f64);
}

/// Misura fissa, usata nei test e come fallback minimale.
#[derive(Debug, Clone, Copy)]
pub struct FixedMetrics {
    pub width: f64,
    pub height: f64,
}

impl FixedMetrics {
    pub fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

impl Default for FixedMetrics {
    fn default() -> Self {
        Self {
            width: DEFAULT_NODE_W,
            height: DEFAULT_NODE_H,
        }
    }
}

impl NodeMetrics for FixedMetrics {
    fn measure(&self, _node: &MapNode) -> (f64, f64) {
        (self.width, self.height)
    }
}

/// Misura stimata a partire dalla lunghezza del testo e presenza di badge.
#[derive(Debug, Clone, Copy, Default)]
pub struct EstimatedMetrics;

impl NodeMetrics for EstimatedMetrics {
    fn measure(&self, node: &MapNode) -> (f64, f64) {
        if let (Some(w), Some(h)) = (node.image_w, node.image_h) {
            let max_w = if node.kind == "equation" || node.latex.is_some() {
                650.0
            } else {
                380.0
            };
            let scale = if w > max_w { max_w / w } else { 1.0 };
            let fw = w * scale + 24.0;
            let mut fh = h * scale + 18.0;
            if node.has_notes || !node.markers.is_empty() || !node.labels.is_empty() {
                fh += 18.0;
            }
            return (fw.max(72.0), fh.max(32.0));
        }
        let text = if !node.display_title.is_empty() {
            &node.display_title
        } else {
            &node.title
        };
        let chars = text.chars().count();
        let max_w = node.custom_width.unwrap_or(400.0);
        let mut w = (chars as f64 * 8.5 + 44.0).clamp(90.0, max_w);
        if !node.markers.is_empty() {
            w += (node.markers.len() * 20) as f64;
        }
        if !node.labels.is_empty() {
            w += (node.labels.len() * 32) as f64;
        }
        let usable_w = (w - 28.0).max(80.0);
        let lines = ((chars as f64 * 8.5) / usable_w).ceil().max(1.0);
        let mut h = (lines * 18.0 + 16.0).max(34.0);
        if node.has_notes || !node.markers.is_empty() || !node.labels.is_empty() {
            h += 16.0;
        }
        (w, h)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LayoutOpts {
    /// Spazio orizzontale fra il blocco e il suo primo livello di figli.
    pub h_gap: f64,
    /// Spazio verticale fra blocchi fratelli (in colonna).
    pub v_gap: f64,
    /// Spazio fra gli alberi radice di fogli diversi.
    pub sheet_gap: f64,
}

impl Default for LayoutOpts {
    fn default() -> Self {
        Self {
            h_gap: 50.0,
            v_gap: 16.0,
            sheet_gap: 80.0,
        }
    }
}

/// Vero se la struttura dichiarata è una Tree Chart verso destra: radice in
/// alto e rami che scendono lungo un tronco verticale.
fn is_tree_right(structure_class: Option<&str>) -> bool {
    structure_class == Some("org.xmind.ui.tree.right")
}

/// Ricostruisce gli alberi della sheet dai DTO, ereditando il colore di ramo
/// (esplicito o dalla palette Snowbrush per i rami di primo livello).
/// Ritorna una tupla `(alberi_principali, topic_fluttuanti_detached)`.
pub fn build_sheet_trees(sheet: &SheetDto) -> (Vec<MapNode>, Vec<MapNode>) {
    let mut children_map: HashMap<String, Vec<&TopicView>> = HashMap::new();
    let mut roots: Vec<&TopicView> = Vec::new();
    let mut floating: Vec<&TopicView> = Vec::new();

    for t in &sheet.topics {
        if t.group == "detached" {
            floating.push(t);
        } else if let Some(p) = &t.parent_id {
            children_map.entry(p.clone()).or_default().push(t);
        } else {
            roots.push(t);
        }
    }

    if roots.is_empty() && !sheet.topics.is_empty() {
        roots.push(&sheet.topics[0]);
    }

    let tree_nodes = roots
        .into_iter()
        .map(|r| build_node_recursive(r, &children_map, None))
        .collect();

    let floating_nodes = floating
        .into_iter()
        .map(|r| build_node_recursive(r, &children_map, None))
        .collect();

    (tree_nodes, floating_nodes)
}

fn build_node_recursive(
    topic: &TopicView,
    children_map: &HashMap<String, Vec<&TopicView>>,
    branch_accent: Option<&str>,
) -> MapNode {
    let explicit_fill = topic.fill_color.as_deref();
    // Il fill appartiene solo al topic che lo dichiara; ciò che si eredita è il
    // colore del ramo, usato da connettori e decorazioni.
    let accent = explicit_fill
        .map(str::to_string)
        .or_else(|| branch_accent.map(str::to_string));
    let list = children_map
        .get(&topic.id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut children: Vec<MapNode> = Vec::new();
    let mut summary_topics: Vec<MapNode> = Vec::new();
    for (i, c) in list.iter().enumerate() {
        // Il fill esplicito del figlio definisce da solo il suo ramo; i figli
        // del topic centrale prendono la palette per ramo; gli altri ereditano
        // l'accento del ramo corrente.
        let child_branch = if topic.depth == 0 && c.fill_color.is_none() {
            Some(BRANCH_COLORS[i % BRANCH_COLORS.len()])
        } else {
            accent.as_deref()
        };
        let node = build_node_recursive(c, children_map, child_branch);
        if c.group == "summary" {
            summary_topics.push(node);
        } else {
            children.push(node);
        }
    }

    // Abbina ogni topic di sommario al suo descrittore sul genitore (stesso id);
    // senza descrittore valido il sommario abbraccia l'intera colonna.
    let last = children.len().saturating_sub(1);
    let summaries: Vec<MapSummary> = summary_topics
        .into_iter()
        .map(|node| {
            let range = topic
                .summaries
                .iter()
                .find(|s| s.id == node.id)
                .and_then(|s| parse_range(&s.range))
                .map(|(a, b)| (a.min(last), b.min(last)))
                .unwrap_or((0, last));
            MapSummary {
                start: range.0,
                end: range.1,
                node,
            }
        })
        .collect();

    let child_count = topic.child_count.max(children.len() + summaries.len());

    MapNode {
        id: topic.id.clone(),
        title: topic.title.clone(),
        display_title: topic.display_title.clone(),
        kind: topic.kind,
        latex: topic.latex.clone(),
        fill_color: explicit_fill.map(str::to_string),
        accent,
        image_src: topic.image_src.clone(),
        image_w: topic.image_w,
        image_h: topic.image_h,
        labels: topic.labels.clone(),
        markers: topic.markers.clone(),
        has_notes: !topic.notes.is_empty(),
        notes: topic.notes.clone(),
        child_count,
        group: topic.group.clone(),
        depth: topic.depth,
        parent_id: topic.parent_id.clone(),
        sheet_index: topic.sheet_index,
        position: topic.position,
        custom_width: topic.custom_width,
        structure_class: topic.structure_class.clone(),
        children,
        summaries,
    }
}

/// Costruisce il layout dell'intera sequenza di sheet.
///
/// Stile "Logic Chart" di XMind: ogni genitore è centrato verticalmente sulla
/// colonna dei propri figli, che si sviluppano a destra. Se il topic centrale
/// dichiara la Tree Chart (`org.xmind.ui.tree.right`) la radice sta in alto e i
/// rami di primo livello scendono lungo un tronco verticale; i sottoalberi
/// restano in stile Logic Chart. I sommari si agganciano con una graffa ai
/// figli che raccolgono. I topic liberi (detached) sono posizionati a lato e
/// connessi con le relazioni XMind.
pub fn layout(
    sheets: &[SheetDto],
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: LayoutOpts,
) -> Layout {
    let mut out = Layout::default();
    let mut top = 20.0;
    let left = 20.0;

    for sheet in sheets {
        let (trees, floating_nodes) = build_sheet_trees(sheet);
        for tree in &trees {
            let mut sizes = HashMap::new();
            compute_sizes(tree, collapsed, metrics, &opts, &mut sizes);
            let ctx = PlaceCtx {
                collapsed,
                metrics,
                opts: &opts,
                sizes: &sizes,
            };

            let total_h = if is_tree_right(tree.structure_class.as_deref()) {
                place_tree_root(tree, left, top, &ctx, &mut out)
            } else {
                place_subtree(tree, left, top, None, &ctx, &mut out);
                sizes.get(&tree.id).map(|s| s.1).unwrap_or(0.0)
            };

            top += total_h + opts.sheet_gap;
        }

        // Posizionamento dei topic fluttuanti / liberi (detached)
        if !floating_nodes.is_empty() {
            let max_tree_x = out.nodes.iter().map(|n| n.x + n.w).fold(20.0, f64::max);
            let mut float_y_cursor = 20.0;

            for float_node in &floating_nodes {
                let mut float_sizes = HashMap::new();
                compute_sizes(float_node, collapsed, metrics, &opts, &mut float_sizes);
                let (_, fh) = metrics.measure(float_node);
                let float_sub_h = float_sizes.get(&float_node.id).map(|s| s.1).unwrap_or(fh);

                // Cerca se esiste una relationship collegata a questo topic fluttuante
                let related_target = sheet.relationships.iter().find_map(|rel| {
                    if rel.end2_id == float_node.id {
                        out.nodes.iter().find(|n| n.id == rel.end1_id)
                    } else if rel.end1_id == float_node.id {
                        out.nodes.iter().find(|n| n.id == rel.end2_id)
                    } else {
                        None
                    }
                });

                let (fx, fy) = if let Some(target) = related_target {
                    let x = (max_tree_x + 80.0).max(target.x + target.w + 60.0);
                    let ideal_y = target.y + (target.h - float_sub_h) / 2.0;
                    let y = ideal_y.max(float_y_cursor);
                    (x, y)
                } else if let Some((px, py)) = float_node.position {
                    let x = px.max(max_tree_x + 60.0);
                    let y = py.max(20.0);
                    (x, y)
                } else {
                    let x = max_tree_x + 80.0;
                    let y = float_y_cursor;
                    (x, y)
                };

                float_y_cursor = fy + float_sub_h + opts.v_gap;

                let ctx = PlaceCtx {
                    collapsed,
                    metrics,
                    opts: &opts,
                    sizes: &float_sizes,
                };
                place_subtree(float_node, fx, fy, None, &ctx, &mut out);
            }
        }

        // Calcolo dei collegamenti / relazioni (Relationship)
        for rel in &sheet.relationships {
            if let (Some(from), Some(to)) = (
                out.nodes.iter().position(|n| n.id == rel.end1_id),
                out.nodes.iter().position(|n| n.id == rel.end2_id),
            ) {
                let accent = out.nodes[from]
                    .accent
                    .clone()
                    .or_else(|| out.nodes[to].accent.clone());
                out.relationships.push(LayoutRelationship {
                    id: rel.id.clone(),
                    title: (!rel.title.trim().is_empty()).then(|| rel.title.clone()),
                    from,
                    to,
                    accent,
                });
            }
        }
    }

    if !out.nodes.is_empty() {
        let max_x = out.nodes.iter().map(|n| n.x + n.w).fold(0.0, f64::max);
        let max_y = out.nodes.iter().map(|n| n.y + n.h).fold(0.0, f64::max);
        out.width = max_x + 40.0;
        out.height = max_y + 40.0;
    }

    out
}

/// Costruisce il layout per una singola sheet.
pub fn layout_single_sheet(
    sheet: &SheetDto,
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: LayoutOpts,
) -> Layout {
    layout(std::slice::from_ref(sheet), collapsed, metrics, opts)
}

/// Aggiunge un nodo al layout e ne ritorna l'indice.
fn push_layout_node(
    out: &mut Layout,
    node: &MapNode,
    rect: (f64, f64, f64, f64),
    is_collapsed: bool,
    children_below: bool,
) -> usize {
    let (x, y, w, h) = rect;
    let index = out.nodes.len();
    out.nodes.push(LayoutNode {
        id: node.id.clone(),
        title: node.title.clone(),
        display_title: node.display_title.clone(),
        x,
        y,
        w,
        h,
        kind: node.kind,
        latex: node.latex.clone(),
        fill: node.fill_color.clone(),
        accent: node.accent.clone(),
        image_src: node.image_src.clone(),
        image_w: node.image_w,
        image_h: node.image_h,
        labels: node.labels.clone(),
        markers: node.markers.clone(),
        has_notes: node.has_notes,
        child_count: node.child_count,
        collapsed: is_collapsed,
        group: node.group.clone(),
        depth: node.depth,
        sheet_index: node.sheet_index,
        position: node.position,
        custom_width: node.custom_width,
        children_below,
    });
    index
}

/// Colonna dei figli di un nodo: offset verticale di ciascun figlio rispetto
/// alla cima della colonna e altezza totale. Se un sommario è più alto dei figli
/// che raccoglie, la colonna si allarga attorno all'intervallo così che il topic
/// di sommario non invada i fratelli vicini.
struct Column {
    tops: Vec<f64>,
    height: f64,
}

fn column(node: &MapNode, sizes: &HashMap<String, (f64, f64)>, opts: &LayoutOpts) -> Column {
    let n = node.children.len();
    let child_h = |i: usize| sizes.get(&node.children[i].id).map(|s| s.1).unwrap_or(0.0);
    let mut pad_before = vec![0.0_f64; n];
    let mut pad_after = vec![0.0_f64; n];
    for s in &node.summaries {
        if s.end >= n {
            continue;
        }
        let range_h: f64 =
            (s.start..=s.end).map(child_h).sum::<f64>() + opts.v_gap * (s.end - s.start) as f64;
        let sum_h = sizes.get(&s.node.id).map(|v| v.1).unwrap_or(0.0);
        if sum_h > range_h {
            let extra = (sum_h - range_h) / 2.0;
            pad_before[s.start] = pad_before[s.start].max(extra);
            pad_after[s.end] = pad_after[s.end].max(extra);
        }
    }
    let mut tops = Vec::with_capacity(n);
    let mut cur = 0.0;
    for i in 0..n {
        if i > 0 {
            cur += opts.v_gap;
        }
        cur += pad_before[i];
        tops.push(cur);
        cur += child_h(i) + pad_after[i];
    }
    Column { tops, height: cur }
}

/// Larghezza occupata a destra della colonna dei figli, sommari compresi.
fn column_width(node: &MapNode, sizes: &HashMap<String, (f64, f64)>) -> f64 {
    let child_w = |c: &MapNode| sizes.get(&c.id).map(|s| s.0).unwrap_or(0.0);
    let mut width = node.children.iter().map(child_w).fold(0.0, f64::max);
    for s in &node.summaries {
        let range_w = node
            .children
            .get(s.start..=s.end)
            .map(|cs| cs.iter().map(child_w).fold(0.0, f64::max))
            .unwrap_or(0.0);
        let summary_w = sizes.get(&s.node.id).map(|v| v.0).unwrap_or(0.0);
        width = width.max(range_w + summary_offset() + summary_w);
    }
    width
}

/// Distanza orizzontale fra il bordo destro dei figli raccolti e il topic di
/// sommario (graffa compresa).
fn summary_offset() -> f64 {
    SUMMARY_GAP_BEFORE + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER
}

fn has_visible_children(node: &MapNode, collapsed: &HashSet<String>) -> bool {
    !collapsed.contains(&node.id) && !(node.children.is_empty() && node.summaries.is_empty())
}

/// Prima passata: dimensioni (larghezza × altezza) di ogni sotto-albero. In
/// orizzontale la larghezza è il blocco più il sottoalbero più largo; l'altezza
/// è quella della colonna dei figli (o l'altezza del blocco).
fn compute_sizes(
    node: &MapNode,
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: &LayoutOpts,
    sizes: &mut HashMap<String, (f64, f64)>,
) -> (f64, f64) {
    let (w, h) = metrics.measure(node);
    let size = if has_visible_children(node, collapsed) {
        for child in &node.children {
            compute_sizes(child, collapsed, metrics, opts, sizes);
        }
        for s in &node.summaries {
            compute_sizes(&s.node, collapsed, metrics, opts, sizes);
        }
        let col = column(node, sizes, opts);
        (
            w + opts.h_gap + column_width(node, sizes),
            h.max(col.height),
        )
    } else {
        (w, h)
    };
    sizes.insert(node.id.clone(), size);
    size
}

/// Parametri condivisi dalla seconda passata (posizionamento).
struct PlaceCtx<'a> {
    collapsed: &'a HashSet<String>,
    metrics: &'a dyn NodeMetrics,
    opts: &'a LayoutOpts,
    sizes: &'a HashMap<String, (f64, f64)>,
}

/// Posiziona un sotto-albero nella fascia che inizia in (`left`, `top`) e ne
/// ritorna l'indice del nodo radice.
fn place_subtree(
    node: &MapNode,
    left: f64,
    top: f64,
    parent: Option<(usize, EdgeKind)>,
    ctx: &PlaceCtx,
    out: &mut Layout,
) -> usize {
    let (w, h) = ctx.metrics.measure(node);
    let sub_h = ctx.sizes.get(&node.id).map(|s| s.1).unwrap_or(h);
    let is_collapsed = ctx.collapsed.contains(&node.id);

    // Il blocco è centrato verticalmente nella fascia del proprio sotto-albero.
    let y = top + (sub_h - h) / 2.0;
    let index = push_layout_node(out, node, (left, y, w, h), is_collapsed, false);

    if let Some((parent_idx, kind)) = parent {
        out.edges.push(LayoutEdge {
            parent: parent_idx,
            child: index,
            group: node.group.clone(),
            kind,
        });
    }

    if has_visible_children(node, ctx.collapsed) {
        let col = column(node, ctx.sizes, ctx.opts);
        let col_top = top + (sub_h - col.height) / 2.0;
        place_children(
            node,
            index,
            left + w + ctx.opts.h_gap,
            col_top,
            &col,
            EdgeKind::Logic,
            ctx,
            out,
        );
    }
    index
}

/// Radice di una Tree Chart: blocco in alto, rami di primo livello in colonna
/// sotto di esso e spostati a destra del tronco. Ritorna l'altezza occupata.
fn place_tree_root(node: &MapNode, left: f64, top: f64, ctx: &PlaceCtx, out: &mut Layout) -> f64 {
    let (w, h) = ctx.metrics.measure(node);
    let is_collapsed = ctx.collapsed.contains(&node.id);
    let index = push_layout_node(out, node, (left, top, w, h), is_collapsed, true);
    if !has_visible_children(node, ctx.collapsed) {
        return h;
    }
    let trunk_x = out.nodes[index].trunk_x();
    let col = column(node, ctx.sizes, ctx.opts);
    let col_top = top + h + TREE_TOP_GAP;
    place_children(
        node,
        index,
        trunk_x + TREE_STUB,
        col_top,
        &col,
        EdgeKind::Tree,
        ctx,
        out,
    );
    h + TREE_TOP_GAP + col.height
}

/// Dispone la colonna dei figli di `node` (già nel layout come `index`) e i
/// suoi sommari, con le graffe a destra dei figli che raccolgono.
#[allow(clippy::too_many_arguments)]
fn place_children(
    node: &MapNode,
    index: usize,
    child_x: f64,
    col_top: f64,
    col: &Column,
    kind: EdgeKind,
    ctx: &PlaceCtx,
    out: &mut Layout,
) {
    for (child, offset) in node.children.iter().zip(&col.tops) {
        place_subtree(
            child,
            child_x,
            col_top + offset,
            Some((index, kind)),
            ctx,
            out,
        );
    }

    for s in &node.summaries {
        if s.end >= node.children.len() {
            continue;
        }
        let height_of = |c: &MapNode| ctx.sizes.get(&c.id).map(|v| v.1).unwrap_or(0.0);
        let y1 = col_top + col.tops[s.start];
        let y2 = col_top + col.tops[s.end] + height_of(&node.children[s.end]);
        let range_w = node.children[s.start..=s.end]
            .iter()
            .map(|c| ctx.sizes.get(&c.id).map(|v| v.0).unwrap_or(0.0))
            .fold(0.0, f64::max);
        let brace_x = child_x + range_w + SUMMARY_GAP_BEFORE;
        let sum_h = height_of(&s.node);
        let sum_top = (y1 + y2) / 2.0 - sum_h / 2.0;
        let topic = place_subtree(
            &s.node,
            brace_x + SUMMARY_BRACE_W + SUMMARY_GAP_AFTER,
            sum_top,
            None,
            ctx,
            out,
        );
        out.summaries.push(LayoutSummary {
            x: brace_x,
            y1,
            y2,
            topic,
            accent: s.node.accent.clone().or_else(|| node.accent.clone()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::RelationshipView;

    fn sample_sheet() -> SheetDto {
        SheetDto {
            index: 0,
            id: Some("s1".to_string()),
            title: "Foglio 1".to_string(),
            topics: vec![
                TopicView {
                    id: "root".to_string(),
                    sheet_index: 0,
                    parent_id: None,
                    depth: 0,
                    group: "attached".to_string(),
                    title: "Radice".to_string(),
                    display_title: "Radice".to_string(),
                    kind: "text",
                    latex: None,
                    image_src: None,
                    image_w: None,
                    image_h: None,
                    notes: String::new(),
                    notes_display: None,
                    labels: vec![],
                    markers: vec![],
                    href: None,
                    path: vec![],
                    child_count: 2,
                    boundaries: vec![],
                    summaries: vec![],
                    task: None,
                    position: None,
                    custom_width: None,
                    fill_color: Some("#ff0000".to_string()),
                    structure_class: None,
                },
                TopicView {
                    id: "a".to_string(),
                    sheet_index: 0,
                    parent_id: Some("root".to_string()),
                    depth: 1,
                    group: "attached".to_string(),
                    title: "A".to_string(),
                    display_title: "A".to_string(),
                    kind: "text",
                    latex: None,
                    image_src: None,
                    image_w: None,
                    image_h: None,
                    notes: String::new(),
                    notes_display: None,
                    labels: vec![],
                    markers: vec![],
                    href: None,
                    path: vec![],
                    child_count: 2,
                    boundaries: vec![],
                    summaries: vec![],
                    task: None,
                    position: None,
                    custom_width: None,
                    fill_color: None,
                    structure_class: None,
                },
                TopicView {
                    id: "a1".to_string(),
                    sheet_index: 0,
                    parent_id: Some("a".to_string()),
                    depth: 2,
                    group: "attached".to_string(),
                    title: "A1".to_string(),
                    display_title: "A1".to_string(),
                    kind: "text",
                    latex: None,
                    image_src: None,
                    image_w: None,
                    image_h: None,
                    notes: String::new(),
                    notes_display: None,
                    labels: vec![],
                    markers: vec![],
                    href: None,
                    path: vec![],
                    child_count: 0,
                    boundaries: vec![],
                    summaries: vec![],
                    task: None,
                    position: None,
                    custom_width: None,
                    fill_color: None,
                    structure_class: None,
                },
                TopicView {
                    id: "a2".to_string(),
                    sheet_index: 0,
                    parent_id: Some("a".to_string()),
                    depth: 2,
                    group: "attached".to_string(),
                    title: "A2".to_string(),
                    display_title: "A2".to_string(),
                    kind: "text",
                    latex: None,
                    image_src: None,
                    image_w: None,
                    image_h: None,
                    notes: String::new(),
                    notes_display: None,
                    labels: vec![],
                    markers: vec![],
                    href: None,
                    path: vec![],
                    child_count: 0,
                    boundaries: vec![],
                    summaries: vec![],
                    task: None,
                    position: None,
                    custom_width: None,
                    fill_color: Some("#00ff00".to_string()), // ridefinisce il colore
                    structure_class: None,
                },
                TopicView {
                    id: "b".to_string(),
                    sheet_index: 0,
                    parent_id: Some("root".to_string()),
                    depth: 1,
                    group: "attached".to_string(),
                    title: "B".to_string(),
                    display_title: "B".to_string(),
                    kind: "equation",
                    latex: Some("x^2 + y^2".to_string()),
                    image_src: None,
                    image_w: None,
                    image_h: None,
                    notes: "Nota su B".to_string(),
                    notes_display: None,
                    labels: vec!["tag1".to_string()],
                    markers: vec!["priority-1".to_string()],
                    href: None,
                    path: vec![],
                    child_count: 0,
                    boundaries: vec![],
                    summaries: vec![],
                    task: None,
                    position: None,
                    custom_width: None,
                    fill_color: None,
                    structure_class: None,
                },
            ],
            relationships: vec![],
        }
    }

    #[test]
    fn layout_has_all_nodes_and_edges() {
        let sheet = sample_sheet();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        assert_eq!(l.nodes.len(), 5, "root, a, a1, a2, b");
        assert_eq!(l.edges.len(), 4);
        assert!(l.width > 0.0 && l.height > 0.0);

        let root = &l.nodes[0];
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        assert!(a.x > root.x, "i figli si sviluppano a destra del genitore");
        let children_top = l
            .nodes
            .iter()
            .filter(|n| n.id != "root")
            .map(|n| n.y)
            .fold(f64::INFINITY, f64::min);
        let children_bottom = l
            .nodes
            .iter()
            .filter(|n| n.id != "root")
            .map(|n| n.y + n.h)
            .fold(0.0, f64::max);
        let children_mid = (children_top + children_bottom) / 2.0;
        assert!(
            (root.y + root.h / 2.0 - children_mid).abs() < 1.0,
            "la radice è centrata verticalmente sui suoi rami"
        );
    }

    #[test]
    fn parent_is_centered_on_children() {
        let sheet = sample_sheet();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        // "a" ha due figli (a1, a2): deve esserne centrato verticalmente.
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        let a1 = l.nodes.iter().find(|n| n.id == "a1").unwrap();
        let a2 = l.nodes.iter().find(|n| n.id == "a2").unwrap();
        let children_center = (a1.y + a1.h / 2.0 + a2.y + a2.h / 2.0) / 2.0;
        assert!((a.y + a.h / 2.0 - children_center).abs() < 0.5);
    }

    #[test]
    fn child_order_is_preserved() {
        let sheet = sample_sheet();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        let b = l.nodes.iter().find(|n| n.id == "b").unwrap();
        assert!(a.y < b.y, "Il figlio A deve comparire prima del figlio B");
    }

    #[test]
    fn subtree_collapse_skips_children_and_updates_bounds() {
        let sheet = sample_sheet();
        let full = layout(
            std::slice::from_ref(&sheet),
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );

        let mut collapsed = HashSet::new();
        collapsed.insert("a".to_string());
        let coll = layout(
            &[sheet],
            &collapsed,
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );

        assert_eq!(coll.nodes.len(), 3, "root, a (senza figli), b");
        assert!(coll.nodes.iter().any(|n| n.id == "a" && n.collapsed));
        assert!(!coll.nodes.iter().any(|n| n.id == "a1" || n.id == "a2"));
        assert_eq!(coll.edges.len(), 2, "root->a, root->b");
        assert!(coll.height < full.height);
    }

    #[test]
    fn explicit_fill_stays_local_and_branch_accent_is_inherited() {
        let sheet = sample_sheet();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let root = l.nodes.iter().find(|n| n.id == "root").unwrap();
        assert_eq!(root.fill.as_deref(), Some("#ff0000"));

        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        assert_eq!(a.fill, None, "il fill della radice non scende sui figli");
        assert_eq!(a.accent.as_deref(), Some(BRANCH_COLORS[0]));

        let a1 = l.nodes.iter().find(|n| n.id == "a1").unwrap();
        assert_eq!(a1.fill, None);
        assert_eq!(a1.accent.as_deref(), Some(BRANCH_COLORS[0]));

        let a2 = l.nodes.iter().find(|n| n.id == "a2").unwrap();
        assert_eq!(
            a2.fill.as_deref(),
            Some("#00ff00"),
            "a2 sovrascrive con verde"
        );

        let b = l.nodes.iter().find(|n| n.id == "b").unwrap();
        assert_eq!(b.fill, None);
        assert_eq!(b.accent.as_deref(), Some(BRANCH_COLORS[1]));
    }

    #[test]
    fn first_level_branches_get_palette_accent_without_fill() {
        let mut sheet = sample_sheet();
        // Nessun fill: i rami di primo livello prendono i colori della palette.
        for t in &mut sheet.topics {
            t.fill_color = None;
        }
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        let b = l.nodes.iter().find(|n| n.id == "b").unwrap();
        assert_eq!(a.fill, None, "senza fill esplicito la card resta neutra");
        assert_eq!(a.accent.as_deref(), Some(BRANCH_COLORS[0]));
        assert_eq!(b.accent.as_deref(), Some(BRANCH_COLORS[1]));
        // I discendenti ereditano l'accento del ramo.
        let a1 = l.nodes.iter().find(|n| n.id == "a1").unwrap();
        assert_eq!(a1.accent.as_deref(), Some(BRANCH_COLORS[0]));
    }

    #[test]
    fn hit_test_and_collapse_button() {
        let sheet = sample_sheet();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let root = &l.nodes[0];
        // Centro del nodo radice
        assert_eq!(
            l.node_at(root.x + root.w / 2.0, root.y + root.h / 2.0),
            Some(0)
        );
        // Fuori dai bounds
        assert_eq!(l.node_at(-100.0, -100.0), None);

        // Indicatore di collapse su radice
        let (bx, by, bw, bh) = root.collapse_indicator_rect().unwrap();
        assert_eq!(l.collapse_handle_at(bx + bw / 2.0, by + bh / 2.0), Some(0));
    }

    #[test]
    fn detached_topics_and_relationships_are_handled() {
        let mut sheet = sample_sheet();
        sheet.topics.push(TopicView {
            id: "det1".to_string(),
            sheet_index: 0,
            parent_id: Some("root".to_string()),
            depth: 1,
            group: "detached".to_string(),
            title: "Fluttuante".to_string(),
            display_title: "Fluttuante".to_string(),
            kind: "text",
            latex: None,
            image_src: None,
            image_w: None,
            image_h: None,
            notes: String::new(),
            notes_display: None,
            labels: vec![],
            markers: vec![],
            href: None,
            path: vec![],
            child_count: 0,
            boundaries: vec![],
            summaries: vec![],
            task: None,
            position: None,
            custom_width: None,
            fill_color: None,
            structure_class: None,
        });
        sheet.relationships.push(RelationshipView {
            id: "rel1".to_string(),
            end1_id: "a".to_string(),
            end2_id: "det1".to_string(),
            title: "collega".to_string(),
        });

        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );

        let det = l.nodes.iter().find(|n| n.id == "det1").unwrap();
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        assert!(det.x > a.x, "il topic fluttuante è posizionato a destra");

        assert!(!l.edges.iter().any(|e| l.nodes[e.child].id == "det1"));

        assert_eq!(l.relationships.len(), 1);
        assert_eq!(l.relationships[0].title.as_deref(), Some("collega"));
        assert_eq!(l.nodes[l.relationships[0].from].id, "a");
        assert_eq!(l.nodes[l.relationships[0].to].id, "det1");
    }

    fn plain(id: &str, parent: Option<&str>, depth: usize, group: &str) -> TopicView {
        let mut t = sample_sheet().topics[2].clone();
        t.id = id.to_string();
        t.title = id.to_string();
        t.display_title = id.to_string();
        t.parent_id = parent.map(str::to_string);
        t.depth = depth;
        t.group = group.to_string();
        t.child_count = 0;
        t
    }

    fn by_id<'a>(l: &'a Layout, id: &str) -> &'a LayoutNode {
        l.nodes.iter().find(|n| n.id == id).unwrap()
    }

    #[test]
    fn tree_chart_puts_root_on_top_with_vertical_trunk() {
        let mut sheet = sample_sheet();
        sheet.topics[0].structure_class = Some("org.xmind.ui.tree.right".to_string());
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let root = by_id(&l, "root");
        let a = by_id(&l, "a");
        let b = by_id(&l, "b");
        assert!(root.children_below);
        assert!(
            a.y > root.y + root.h,
            "i rami di primo livello stanno sotto la radice"
        );
        assert!(b.y > a.y);
        assert!(
            a.x > root.trunk_x() && (a.x - b.x).abs() < 0.5,
            "colonna a destra del tronco"
        );
        for e in &l.edges {
            let expected = if l.nodes[e.parent].id == "root" {
                EdgeKind::Tree
            } else {
                EdgeKind::Logic
            };
            assert_eq!(e.kind, expected, "solo il primo livello pende dal tronco");
        }
        // I sottoalberi restano in stile Logic Chart: "a" è centrato sui figli.
        let a1 = by_id(&l, "a1");
        let a2 = by_id(&l, "a2");
        let mid = (a1.y + a1.h / 2.0 + a2.y + a2.h / 2.0) / 2.0;
        assert!((a.y + a.h / 2.0 - mid).abs() < 0.5);
        let (_, by, _, _) = root.collapse_indicator_rect().unwrap();
        assert!(
            by > root.y + root.h - 1.0,
            "il pulsante di collasso sta alla base del tronco"
        );
    }

    fn summary_sheet() -> SheetDto {
        let mut sheet = sample_sheet();
        // "a" riceve un terzo figlio e un sommario sui primi due (a1, a2).
        sheet
            .topics
            .insert(4, plain("a3", Some("a"), 2, "attached"));
        sheet
            .topics
            .insert(5, plain("sum", Some("a"), 2, "summary"));
        sheet.topics[1].summaries = vec![crate::state::SummaryView {
            id: "sum".to_string(),
            range: "(0,1)".to_string(),
        }];
        sheet
    }

    #[test]
    fn summary_is_braced_next_to_its_range() {
        let l = layout(
            &[summary_sheet()],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let a1 = by_id(&l, "a1");
        let a2 = by_id(&l, "a2");
        let a3 = by_id(&l, "a3");
        let sum = by_id(&l, "sum");
        assert!(
            !l.edges.iter().any(|e| l.nodes[e.child].id == "sum"),
            "niente connettore normale"
        );
        assert_eq!(l.summaries.len(), 1);
        let brace = &l.summaries[0];
        assert_eq!(l.nodes[brace.topic].id, "sum");
        assert!((brace.y1 - a1.y).abs() < 0.5 && (brace.y2 - (a2.y + a2.h)).abs() < 0.5);
        assert!(brace.x > a1.x + a1.w && sum.x > brace.x + SUMMARY_BRACE_W);
        let mid = (brace.y1 + brace.y2) / 2.0;
        assert!(
            (sum.y + sum.h / 2.0 - mid).abs() < 0.5,
            "il sommario è centrato sulla graffa"
        );
        assert!(sum.y + sum.h < a3.y + 0.5, "a3 resta fuori dall'intervallo");
        assert_eq!(
            sum.accent, a1.accent,
            "graffa e sommario col colore del ramo"
        );
    }

    #[test]
    fn tall_summary_widens_its_range_instead_of_overlapping() {
        let mut sheet = summary_sheet();
        // Sommario su un solo figlio ma con due figli propri: più alto del range.
        sheet.topics[1].summaries[0].range = "(2,2)".to_string();
        sheet
            .topics
            .insert(6, plain("s1", Some("sum"), 3, "attached"));
        sheet
            .topics
            .insert(7, plain("s2", Some("sum"), 3, "attached"));
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let s1 = by_id(&l, "s1");
        let s2 = by_id(&l, "s2");
        let a2 = by_id(&l, "a2");
        let b = by_id(&l, "b");
        assert!(
            s1.y >= a2.y + a2.h,
            "il sottoalbero del sommario non invade a2"
        );
        assert!(s2.y + s2.h <= b.y, "né il ramo successivo");
    }

    #[test]
    fn summary_without_descriptor_spans_all_children() {
        let mut sheet = summary_sheet();
        sheet.topics[1].summaries.clear();
        let l = layout(
            &[sheet],
            &HashSet::new(),
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        let brace = &l.summaries[0];
        assert!((brace.y1 - by_id(&l, "a1").y).abs() < 0.5);
        let a3 = by_id(&l, "a3");
        assert!((brace.y2 - (a3.y + a3.h)).abs() < 0.5);
    }

    #[test]
    fn collapsed_parent_hides_its_summaries() {
        let mut collapsed = HashSet::new();
        collapsed.insert("a".to_string());
        let l = layout(
            &[summary_sheet()],
            &collapsed,
            &FixedMetrics::default(),
            LayoutOpts::default(),
        );
        assert!(l.summaries.is_empty());
        assert!(l.find_node_by_id("sum").is_none());
    }
}
