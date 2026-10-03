//! Calcolo del layout grafico della mappa (nessuna dipendenza da GTK).
//!
//! Input: DTO della mappa (`SheetDto` / `TopicView`).
//! Produce la posizione dei blocchi e i collegamenti da disegnare.
//! L'algoritmo è un tidy tree sinistro→destro con altezze e larghezze variabili
//! (fornite tramite il trait `NodeMetrics`), supporto al collasso di sotto-alberi,
//! colore del ramo ereditato e bounds per adattare la vista al canvas.

use std::collections::{HashMap, HashSet};

use crate::state::{SheetDto, TopicView};

pub const DEFAULT_NODE_W: f64 = 180.0;
pub const DEFAULT_NODE_H: f64 = 36.0;

/// Un nodo dell'albero pronto per il calcolo del layout e la misurazione.
#[derive(Debug, Clone)]
pub struct MapNode {
    pub id: String,
    pub title: String,
    pub display_title: String,
    pub kind: &'static str,
    pub latex: Option<String>,
    pub fill_color: Option<String>,
    pub labels: Vec<String>,
    pub markers: Vec<String>,
    pub has_notes: bool,
    pub notes: String,
    pub child_count: usize,
    pub group: String,
    pub depth: usize,
    pub parent_id: Option<String>,
    pub sheet_index: usize,
    pub children: Vec<MapNode>,
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
    pub labels: Vec<String>,
    pub markers: Vec<String>,
    pub has_notes: bool,
    pub child_count: usize,
    pub collapsed: bool,
    pub group: String,
    pub depth: usize,
    pub sheet_index: usize,
}

impl LayoutNode {
    /// Rettangolo del pulsante di espansione/collasso sul lato destro del blocco.
    /// Presente solo se il nodo ha figli. (x, y, w, h).
    pub fn collapse_indicator_rect(&self) -> Option<(f64, f64, f64, f64)> {
        if self.child_count > 0 {
            let r = 8.0;
            let cx = self.x + self.w + 10.0;
            let cy = self.y + self.h / 2.0;
            Some((cx - r, cy - r, r * 2.0, r * 2.0))
        } else {
            None
        }
    }
}

/// Un collegamento fra due nodi, per indice in `Layout::nodes`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutEdge {
    pub parent: usize,
    pub child: usize,
    pub group: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layout {
    pub nodes: Vec<LayoutNode>,
    pub edges: Vec<LayoutEdge>,
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

    /// Hit test per l'indicatore di collapse (pulsantino tondo sul lato destro).
    pub fn collapse_handle_at(&self, x: f64, y: f64) -> Option<usize> {
        self.nodes.iter().position(|n| {
            if let Some((bx, by, bw, bh)) = n.collapse_indicator_rect() {
                x >= bx - 4.0 && x <= bx + bw + 4.0 && y >= by - 4.0 && y <= by + bh + 4.0
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
        let text = if !node.display_title.is_empty() {
            &node.display_title
        } else {
            &node.title
        };
        let chars = text.chars().count();
        let mut w = (chars as f64 * 8.5 + 44.0).clamp(110.0, 260.0);
        if !node.markers.is_empty() {
            w += (node.markers.len() * 20) as f64;
        }
        if !node.labels.is_empty() {
            w += (node.labels.len() * 32) as f64;
        }
        let usable_w = (w - 28.0).max(80.0);
        let lines = ((chars as f64 * 8.5) / usable_w).ceil().max(1.0);
        let h = (lines * 18.0 + 16.0).max(34.0);
        (w, h)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LayoutOpts {
    pub h_gap: f64,
    pub v_gap: f64,
    pub sheet_gap: f64,
}

impl Default for LayoutOpts {
    fn default() -> Self {
        Self {
            h_gap: 56.0,
            v_gap: 14.0,
            sheet_gap: 60.0,
        }
    }
}

/// Ricostruisce l'albero `MapNode` dai DTO di una sheet, ereditando il colore di ramo.
pub fn build_sheet_trees(sheet: &SheetDto) -> Vec<MapNode> {
    let mut children_map: HashMap<String, Vec<&TopicView>> = HashMap::new();
    let mut roots: Vec<&TopicView> = Vec::new();

    for t in &sheet.topics {
        if let Some(p) = &t.parent_id {
            children_map.entry(p.clone()).or_default().push(t);
        } else {
            roots.push(t);
        }
    }

    if roots.is_empty() && !sheet.topics.is_empty() {
        roots.push(&sheet.topics[0]);
    }

    roots
        .into_iter()
        .map(|r| build_node_recursive(r, &children_map, None))
        .collect()
}

fn build_node_recursive(
    topic: &TopicView,
    children_map: &HashMap<String, Vec<&TopicView>>,
    inherited_fill: Option<&str>,
) -> MapNode {
    let fill = topic.fill_color.as_deref().or(inherited_fill);
    let children: Vec<MapNode> = children_map
        .get(&topic.id)
        .map(|list| {
            list.iter()
                .map(|c| build_node_recursive(c, children_map, fill))
                .collect()
        })
        .unwrap_or_default();
    let child_count = topic.child_count.max(children.len());

    MapNode {
        id: topic.id.clone(),
        title: topic.title.clone(),
        display_title: topic.display_title.clone(),
        kind: topic.kind,
        latex: topic.latex.clone(),
        fill_color: fill.map(str::to_string),
        labels: topic.labels.clone(),
        markers: topic.markers.clone(),
        has_notes: !topic.notes.is_empty(),
        notes: topic.notes.clone(),
        child_count,
        group: topic.group.clone(),
        depth: topic.depth,
        parent_id: topic.parent_id.clone(),
        sheet_index: topic.sheet_index,
        children,
    }
}

/// Costruisce il layout dell'intera sequenza di sheet.
pub fn layout(
    sheets: &[SheetDto],
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: LayoutOpts,
) -> Layout {
    let mut out = Layout::default();
    let mut top = 20.0;

    for sheet in sheets {
        let trees = build_sheet_trees(sheet);
        for tree in &trees {
            let tree_height = measure_subtree(tree, collapsed, metrics, &opts);
            place_tree(tree, 20.0, top, None, collapsed, metrics, &opts, &mut out);
            top += tree_height + opts.sheet_gap;
        }
    }

    if !out.nodes.is_empty() {
        let max_x = out
            .nodes
            .iter()
            .map(|n| n.x + n.w + if n.child_count > 0 { 24.0 } else { 0.0 })
            .fold(0.0, f64::max);
        let max_y = out.nodes.iter().map(|n| n.y + n.h).fold(0.0, f64::max);
        out.width = max_x + 20.0;
        out.height = max_y + 20.0;
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

fn measure_subtree(
    node: &MapNode,
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: &LayoutOpts,
) -> f64 {
    let (_w, h) = metrics.measure(node);
    if collapsed.contains(&node.id) || node.children.is_empty() {
        return h;
    }
    let total: f64 = node
        .children
        .iter()
        .map(|c| measure_subtree(c, collapsed, metrics, opts))
        .sum();
    let gaps = opts.v_gap * (node.children.len().saturating_sub(1)) as f64;
    (total + gaps).max(h)
}

#[allow(clippy::too_many_arguments)]
fn place_tree(
    node: &MapNode,
    x: f64,
    top: f64,
    parent: Option<usize>,
    collapsed: &HashSet<String>,
    metrics: &dyn NodeMetrics,
    opts: &LayoutOpts,
    out: &mut Layout,
) -> f64 {
    let index = out.nodes.len();
    let (w, h) = metrics.measure(node);
    let is_collapsed = collapsed.contains(&node.id);

    out.nodes.push(LayoutNode {
        id: node.id.clone(),
        title: node.title.clone(),
        display_title: node.display_title.clone(),
        x,
        y: 0.0, // centrato sotto
        w,
        h,
        kind: node.kind,
        latex: node.latex.clone(),
        fill: node.fill_color.clone(),
        labels: node.labels.clone(),
        markers: node.markers.clone(),
        has_notes: node.has_notes,
        child_count: node.child_count,
        collapsed: is_collapsed,
        group: node.group.clone(),
        depth: node.depth,
        sheet_index: node.sheet_index,
    });

    if let Some(parent_idx) = parent {
        out.edges.push(LayoutEdge {
            parent: parent_idx,
            child: index,
            group: node.group.clone(),
        });
    }

    if is_collapsed || node.children.is_empty() {
        let center_y = top + h / 2.0;
        out.nodes[index].y = top;
        return center_y;
    }

    let child_x = x + w + opts.h_gap;
    let mut child_top = top;
    let mut centers = Vec::with_capacity(node.children.len());
    for child in &node.children {
        let center = place_tree(
            child,
            child_x,
            child_top,
            Some(index),
            collapsed,
            metrics,
            opts,
            out,
        );
        centers.push(center);
        child_top += measure_subtree(child, collapsed, metrics, opts) + opts.v_gap;
    }

    let first = centers.first().copied().unwrap_or(top + h / 2.0);
    let last = centers.last().copied().unwrap_or(first);
    let center = (first + last) / 2.0;
    out.nodes[index].y = center - h / 2.0;
    center
}

#[cfg(test)]
mod tests {
    use super::*;

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
                    fill_color: Some("#ff0000".to_string()),
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
                    fill_color: None, // eredita da root
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
                    fill_color: None, // eredita da a (che eredita da root)
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
                    fill_color: Some("#00ff00".to_string()), // ridefinisce il colore
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
                    fill_color: None,
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
        assert!(a.x > root.x);
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
        let root = &l.nodes[0];
        let a = l.nodes.iter().find(|n| n.id == "a").unwrap();
        let b = l.nodes.iter().find(|n| n.id == "b").unwrap();
        let children_center = (a.y + a.h / 2.0 + b.y + b.h / 2.0) / 2.0;
        assert!((root.y + root.h / 2.0 - children_center).abs() < 0.01);
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
    fn inherited_branch_color() {
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
        assert_eq!(a.fill.as_deref(), Some("#ff0000"), "a eredita da root");

        let a1 = l.nodes.iter().find(|n| n.id == "a1").unwrap();
        assert_eq!(a1.fill.as_deref(), Some("#ff0000"), "a1 eredita da a");

        let a2 = l.nodes.iter().find(|n| n.id == "a2").unwrap();
        assert_eq!(
            a2.fill.as_deref(),
            Some("#00ff00"),
            "a2 sovrascrive con verde"
        );

        let b = l.nodes.iter().find(|n| n.id == "b").unwrap();
        assert_eq!(b.fill.as_deref(), Some("#ff0000"), "b eredita da root");
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
}
