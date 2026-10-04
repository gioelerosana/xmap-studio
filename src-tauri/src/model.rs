//! Modello di `content.json` di un workbook XMind 2020+ (Vana).
//!
//! Ogni struct è "aperta": i campi noti sono tipizzati per comodità, TUTTO il
//! resto viene catturato da `#[serde(flatten)] extra` e riserializzato identico.
//! Questo è il requisito di robustezza n.1: mai distruggere dati dell'utente.
//!
//! Schema verificato su XMind 26.03.04129 (vedi README, sez. formato).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type Extra = Map<String, Value>;

/// Gruppi di figli usati da XMind. `summary`/`callout` sono nodi speciali ma
/// vanno percorsi come topic per non perderli.
pub const CHILD_GROUPS: [&str; 4] = ["attached", "detached", "summary", "callout"];

pub const MATHJAX_PROVIDER: &str = "org.xmind.ui.mathJax";
pub const RESOURCE_PREFIX: &str = "xap:resources/";

fn is_none<T>(v: &Option<T>) -> bool {
    v.is_none()
}

/// Una sheet del workbook. `content.json` è un array di queste.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Sheet {
    #[serde(default, skip_serializing_if = "is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub title: Option<String>,
    #[serde(rename = "revisionId", default, skip_serializing_if = "is_none")]
    pub revision_id: Option<String>,
    #[serde(rename = "rootTopic", default, skip_serializing_if = "is_none")]
    pub root_topic: Option<Topic>,
    #[serde(rename = "topicOverlapping", default, skip_serializing_if = "is_none")]
    pub topic_overlapping: Option<Value>,
    #[serde(
        rename = "arrangeableLayerOrder",
        default,
        skip_serializing_if = "is_none"
    )]
    pub arrangeable_layer_order: Option<Value>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub zones: Option<Value>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub extensions: Option<Vec<Extension>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub theme: Option<Value>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub relationships: Option<Vec<Relationship>>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Una relazione tra due topic. Vive a livello **sheet** e riferisce i due capi
/// per id (`end1Id` = sorgente, `end2Id` = destinazione).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Relationship {
    #[serde(default, skip_serializing_if = "is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub class: Option<String>,
    #[serde(rename = "end1Id", default, skip_serializing_if = "is_none")]
    pub end1_id: Option<String>,
    #[serde(rename = "end2Id", default, skip_serializing_if = "is_none")]
    pub end2_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub title: Option<String>,
    #[serde(rename = "attributedTitle", default, skip_serializing_if = "is_none")]
    pub attributed_title: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Un boundary (cornice) attorno a un intervallo di figli del topic che lo
/// possiede. `range` è `"(start,end)"` con indici inclusivi sui figli
/// `attached`, oppure `"master"` quando copre l'intero ramo.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Boundary {
    #[serde(default, skip_serializing_if = "is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub range: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub title: Option<String>,
    #[serde(rename = "attributedTitle", default, skip_serializing_if = "is_none")]
    pub attributed_title: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Il descrittore di un summary, sul topic **genitore**. La doppia
/// rappresentazione è obbligatoria: il topic reale del sommario sta in
/// `children.summary` con lo stesso id di `topic_id`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Summary {
    #[serde(default, skip_serializing_if = "is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub range: Option<String>,
    #[serde(rename = "topicId", default, skip_serializing_if = "is_none")]
    pub topic_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub title: Option<String>,
    #[serde(rename = "attributedTitle", default, skip_serializing_if = "is_none")]
    pub attributed_title: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Topic {
    #[serde(default, skip_serializing_if = "is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub children: Option<Children>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub image: Option<Image>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub notes: Option<Notes>,
    #[serde(rename = "notesDisplay", default, skip_serializing_if = "is_none")]
    pub notes_display: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub markers: Option<Vec<Marker>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub href: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub extensions: Option<Vec<Extension>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub summaries: Option<Vec<Summary>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub boundaries: Option<Vec<Boundary>>,
    #[serde(rename = "titleUnedited", default, skip_serializing_if = "is_none")]
    pub title_unedited: Option<bool>,
    #[serde(rename = "structureClass", default, skip_serializing_if = "is_none")]
    pub structure_class: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Contenitore dei figli. Le quattro liste note sono `Option<Vec<Topic>>` per
/// distinguere "assente" da "presente ma vuoto"; il resto è preservato.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Children {
    #[serde(default, skip_serializing_if = "is_none")]
    pub attached: Option<Vec<Topic>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub detached: Option<Vec<Topic>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub summary: Option<Vec<Topic>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub callout: Option<Vec<Topic>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Image {
    #[serde(default, skip_serializing_if = "is_none")]
    pub src: Option<String>,
    /// `serde_json::Number`, non f64: preserva esattamente interi vs decimali,
    /// così il round-trip resta fedele anche sui tipi numerici.
    #[serde(default, skip_serializing_if = "is_none")]
    pub width: Option<serde_json::Number>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub height: Option<serde_json::Number>,
    #[serde(rename = "isMathJaxImage", default, skip_serializing_if = "is_none")]
    pub is_mathjax_image: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Una metà di `notes`: XMind scrive `plain` (testo) e `realHTML` (XHTML).
/// Entrambe hanno la forma `{ "content": "…" }`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NotesPart {
    #[serde(default, skip_serializing_if = "is_none")]
    pub content: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Note di un topic. XMind scrive **entrambe** le rappresentazioni; scriverne
/// una sola può desincronizzare la UI. La forma su disco è:
/// `{ "plain": { "content": … }, "realHTML": { "content": … } }`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Notes {
    #[serde(default, skip_serializing_if = "is_none")]
    pub plain: Option<NotesPart>,
    #[serde(rename = "realHTML", default, skip_serializing_if = "is_none")]
    pub real_html: Option<NotesPart>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Un marker (icona) applicato a un topic: su disco `{ "markerId": "…" }`.
/// Il catalogo degli id validi è in `crate::markers`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Marker {
    #[serde(rename = "markerId", default, skip_serializing_if = "is_none")]
    pub marker_id: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Extension {
    #[serde(default, skip_serializing_if = "is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub content: Option<Value>,
    #[serde(rename = "resourceRefs", default, skip_serializing_if = "is_none")]
    pub resource_refs: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Extension {
    pub fn is_mathjax(&self) -> bool {
        self.provider.as_deref() == Some(MATHJAX_PROVIDER)
    }
}

impl Topic {
    pub fn group(&self, name: &str) -> Option<&Vec<Topic>> {
        let c = self.children.as_ref()?;
        match name {
            "attached" => c.attached.as_ref(),
            "detached" => c.detached.as_ref(),
            "summary" => c.summary.as_ref(),
            "callout" => c.callout.as_ref(),
            _ => None,
        }
    }

    pub fn group_mut(&mut self, name: &str) -> Option<&mut Vec<Topic>> {
        let c = self.children.as_mut()?;
        match name {
            "attached" => c.attached.as_mut(),
            "detached" => c.detached.as_mut(),
            "summary" => c.summary.as_mut(),
            "callout" => c.callout.as_mut(),
            _ => None,
        }
    }

    /// Tutti i figli, in ordine di gruppo.
    pub fn all_children(&self) -> impl Iterator<Item = &Topic> {
        CHILD_GROUPS
            .iter()
            .filter_map(move |g| self.group(g))
            .flat_map(|v| v.iter())
    }

    pub fn child_count(&self) -> usize {
        self.all_children().count()
    }

    /// LaTeX dell'equazione, se il topic ne contiene una.
    pub fn latex(&self) -> Option<&str> {
        self.extensions
            .as_ref()?
            .iter()
            .find(|e| e.is_mathjax())?
            .content
            .as_ref()?
            .get("content")?
            .as_str()
    }

    pub fn is_equation(&self) -> bool {
        self.latex().is_some()
    }

    /// Immagine "vera" (non un'equazione).
    pub fn is_plain_image(&self) -> bool {
        match &self.image {
            Some(img) => img.is_mathjax_image != Some(true) && img.src.is_some(),
            None => false,
        }
    }

    pub fn image_src(&self) -> Option<&str> {
        self.image.as_ref()?.src.as_deref()
    }

    /// Dimensioni logiche dichiarate per l'immagine (px), se entrambe presenti.
    pub fn image_size_px(&self) -> Option<(f64, f64)> {
        let img = self.image.as_ref()?;
        let w = img.width.as_ref()?.as_f64()?;
        let h = img.height.as_ref()?.as_f64()?;
        Some((w, h))
    }

    pub fn title_str(&self) -> &str {
        self.title.as_deref().unwrap_or("")
    }

    /// Testo delle note: preferisce `plain`, ripiega su `realHTML`. `None` se
    /// assenti o vuote. Il fallback non viene ripulito dall'HTML: serve solo a
    /// mostrare qualcosa nell'editor, che riscrive entrambe le metà.
    pub fn notes_text(&self) -> Option<&str> {
        let notes = self.notes.as_ref()?;
        let text = notes
            .plain
            .as_ref()
            .and_then(|p| p.content.as_deref())
            .or_else(|| notes.real_html.as_ref().and_then(|p| p.content.as_deref()))?;
        (!text.is_empty()).then_some(text)
    }

    pub fn labels_list(&self) -> &[String] {
        self.labels.as_deref().unwrap_or(&[])
    }

    pub fn marker_ids(&self) -> impl Iterator<Item = &str> {
        self.markers
            .iter()
            .flatten()
            .filter_map(|m| m.marker_id.as_deref())
    }

    pub fn href_str(&self) -> Option<&str> {
        self.href.as_deref().filter(|h| !h.is_empty())
    }

    pub fn summaries_list(&self) -> &[Summary] {
        self.summaries.as_deref().unwrap_or(&[])
    }

    pub fn boundaries_list(&self) -> &[Boundary] {
        self.boundaries.as_deref().unwrap_or(&[])
    }

    /// Estensione con il provider indicato, se presente.
    pub fn extension(&self, provider: &str) -> Option<&Extension> {
        self.extensions
            .as_ref()?
            .iter()
            .find(|e| e.provider.as_deref() == Some(provider))
    }

    /// Colore di riempimento del ramo (`style.properties["svg:fill"]`).
    pub fn fill_color(&self) -> Option<&str> {
        self.extra
            .get("style")?
            .get("properties")?
            .get("svg:fill")?
            .as_str()
    }

    /// Numero di figli `attached` (gli indici usati da boundary/summary).
    pub fn attached_count(&self) -> usize {
        self.group("attached").map(Vec::len).unwrap_or(0)
    }
}

impl Sheet {
    pub fn title_str(&self) -> &str {
        self.title.as_deref().unwrap_or("")
    }

    pub fn relationships_list(&self) -> &[Relationship] {
        self.relationships.as_deref().unwrap_or(&[])
    }
}

/// Interpreta `"(start,end)"` (indici inclusivi) in una coppia ordinata.
pub fn parse_range(range: &str) -> Option<(usize, usize)> {
    let inner = range.strip_prefix('(')?.strip_suffix(')')?;
    let (a, b) = inner.split_once(',')?;
    let start = a.trim().parse::<usize>().ok()?;
    let end = b.trim().parse::<usize>().ok()?;
    Some((start.min(end), start.max(end)))
}

/// Formatta una coppia di indici come range di XMind.
pub fn format_range(start: usize, end: usize) -> String {
    format!("({},{})", start.min(end), start.max(end))
}

/// Dimensione font del titolo del topic in px CSS, se dichiarata.
/// XMind salva `fo:font-size` (es. "14pt") dentro `topic.style.properties`.
/// Serve a calcolare `em = 1.25 × fontSizePx` per l'equazione.
pub fn font_size_px(topic: &Topic) -> Option<f64> {
    fn from_props(props: &Value) -> Option<f64> {
        let v = props.get("fo:font-size")?;
        let pt = match v {
            Value::Number(n) => n.as_f64()?,
            Value::String(s) => {
                let s = s.trim();
                let num: String = s
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                num.parse::<f64>().ok()?
            }
            _ => return None,
        };
        if pt <= 0.0 {
            return None;
        }
        // pt → px CSS (1pt = 96/72 px), poi em = 1.25 × px
        Some(pt * 96.0 / 72.0)
    }

    if let Some(props) = topic
        .extra
        .get("style")
        .and_then(|s| s.get("properties"))
        .and_then(|p| p.as_object())
        .map(|o| Value::Object(o.clone()))
    {
        if let Some(px) = from_props(&props) {
            return Some(px);
        }
    }
    topic
        .extra
        .get("style")
        .and_then(|s| s.get("properties"))
        .and_then(from_props)
}

/// DFS pre-order su un topic (incluso il nodo stesso).
pub fn walk_topic<'a>(topic: &'a Topic, out: &mut Vec<&'a Topic>) {
    out.push(topic);
    for group in CHILD_GROUPS {
        if let Some(children) = topic.group(group) {
            for child in children {
                walk_topic(child, out);
            }
        }
    }
}

pub fn find_topic<'a>(sheets: &'a [Sheet], id: &str) -> Option<&'a Topic> {
    for sheet in sheets {
        if let Some(root) = sheet.root_topic.as_ref() {
            let mut all = Vec::new();
            walk_topic(root, &mut all);
            if let Some(t) = all.into_iter().find(|t| t.id.as_deref() == Some(id)) {
                return Some(t);
            }
        }
    }
    None
}

/// Indice della sheet che contiene il topic `id`.
pub fn sheet_index_of(sheets: &[Sheet], id: &str) -> Option<usize> {
    sheets.iter().position(|sheet| {
        sheet
            .root_topic
            .as_ref()
            .map(|root| {
                let mut all = Vec::new();
                walk_topic(root, &mut all);
                all.iter().any(|t| t.id.as_deref() == Some(id))
            })
            .unwrap_or(false)
    })
}

pub fn find_topic_mut<'a>(sheets: &'a mut [Sheet], id: &str) -> Option<&'a mut Topic> {
    for sheet in sheets.iter_mut() {
        if let Some(root) = sheet.root_topic.as_mut() {
            let mut path = Vec::new();
            if path_to(root, id, &mut path) {
                return Some(descend(root, &path, 0));
            }
        }
    }
    None
}

/// Individua il percorso (indice gruppo, indice figlio) verso `id`, in sola
/// lettura. Poi `descend` lo ripercorre in mutazione: due fasi per soddisfare
/// il borrow checker senza `unsafe`.
fn path_to(topic: &Topic, id: &str, path: &mut Vec<(usize, usize)>) -> bool {
    if topic.id.as_deref() == Some(id) {
        return true;
    }
    for (gi, group) in CHILD_GROUPS.iter().enumerate() {
        if let Some(children) = topic.group(group) {
            for (ci, child) in children.iter().enumerate() {
                path.push((gi, ci));
                if path_to(child, id, path) {
                    return true;
                }
                path.pop();
            }
        }
    }
    false
}

fn descend<'a>(topic: &'a mut Topic, path: &[(usize, usize)], i: usize) -> &'a mut Topic {
    if i == path.len() {
        return topic;
    }
    let (gi, ci) = path[i];
    let children = topic.group_mut(CHILD_GROUPS[gi]).unwrap();
    descend(&mut children[ci], path, i + 1)
}

/// Imposta (o rimuove) il colore di riempimento del ramo. Crea/rimuove i
/// contenitori `style`/`properties` solo quando serve, senza toccare le altre
/// proprietà di stile già presenti.
pub fn set_fill_color(topic: &mut Topic, color: Option<&str>) {
    let color = color.map(str::trim).filter(|c| !c.is_empty());
    if color.is_none() {
        let empty = if let Some(props) = topic
            .extra
            .get_mut("style")
            .and_then(|s| s.get_mut("properties"))
            .and_then(|p| p.as_object_mut())
        {
            props.remove("svg:fill");
            props.is_empty()
        } else {
            false
        };
        if empty {
            remove_empty_style(topic);
        }
        return;
    }
    let style = topic
        .extra
        .entry("style".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !style.is_object() {
        *style = Value::Object(Map::new());
    }
    let props = style
        .as_object_mut()
        .unwrap()
        .entry("properties".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !props.is_object() {
        *props = Value::Object(Map::new());
    }
    props.as_object_mut().unwrap().insert(
        "svg:fill".to_string(),
        Value::String(color.unwrap().to_string()),
    );
}

/// Elimina `style` se è rimasto senza proprietà.
fn remove_empty_style(topic: &mut Topic) {
    let empty = topic
        .extra
        .get("style")
        .and_then(|s| s.get("properties"))
        .and_then(|p| p.as_object())
        .map(|p| p.is_empty())
        .unwrap_or(false);
    if empty {
        topic.extra.remove("style");
    }
}

/// Raccoglie tutti i riferimenti `xap:resources/<nome>` presenti in un valore
/// JSON arbitrario (content.json, theme, extensions...). Fondamentale per non
/// cancellare risorse ancora referenziate.
pub fn collect_resource_refs(value: &Value, out: &mut std::collections::BTreeSet<String>) {
    match value {
        Value::String(s) => {
            if let Some(rest) = s.strip_prefix(RESOURCE_PREFIX) {
                out.insert(rest.to_string());
            }
        }
        Value::Array(a) => a.iter().for_each(|v| collect_resource_refs(v, out)),
        Value::Object(o) => o.values().for_each(|v| collect_resource_refs(v, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SAMPLE: &str = r##"[
      {
        "id": "sheet-1",
        "revisionId": "rev-9",
        "class": "sheet",
        "title": "Mappa mentale",
        "topicOverlapping": "overlap",
        "arrangeableLayerOrder": [],
        "zones": [],
        "extensions": [{"provider": "org.xmind.ui.map.unbalanced", "content": {}}],
        "theme": {"id": "t", "map": {"svg": {"fill": "#fff"}}},
        "unknownSheetField": {"a": [1, 2, 3]},
        "rootTopic": {
          "id": "root",
          "class": "topic",
          "title": "Relazioni",
          "structureClass": "org.xmind.ui.tree.right",
          "titleUnedited": true,
          "weird": {"nested": true, "n": 1},
          "children": {
            "attached": [
              {
                "id": "t1",
                "title": "",
                "extensions": [
                  {"provider": "org.xmind.ui.mathJax", "content": {"content": "R \\subseteq A \\times B"}, "resourceRefs": []}
                ],
                "image": {
                  "src": "xap:resources/abc.png",
                  "width": 113,
                  "height": 20,
                  "isMathJaxImage": true,
                  "extraImageField": 7
                }
              },
              {
                "id": "t2",
                "class": "topic",
                "title": "normale",
                "children": {"attached": [], "unknownGroup": [{"id": "x", "title": "y"}]}
              }
            ],
            "detached": [{"id": "d1", "title": "staccato"}],
            "summary": [{"id": "s1", "title": "sommario"}],
            "callout": [{"id": "c1", "title": "callout"}],
            "unknownChildrenGroup": [{"id": "u1"}]
          }
        }
      }
    ]"##;

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn round_trip_is_semantically_identical() {
        let original = parse(SAMPLE);
        let typed: Vec<Sheet> = serde_json::from_value(original.clone()).unwrap();
        let reserialized = serde_json::to_value(&typed).unwrap();
        assert_eq!(
            original, reserialized,
            "il round-trip ha perso o alterato campi"
        );
    }

    #[test]
    fn unknown_fields_are_preserved() {
        let typed: Vec<Sheet> = serde_json::from_str(SAMPLE).unwrap();
        let v = serde_json::to_value(&typed).unwrap();
        assert_eq!(v[0]["unknownSheetField"]["a"][1], json!(2));
        let root = &v[0]["rootTopic"];
        assert_eq!(root["weird"]["nested"], json!(true));
        let ch = &root["children"];
        assert_eq!(ch["unknownChildrenGroup"][0]["id"], json!("u1"));
        assert_eq!(
            ch["attached"][1]["children"]["unknownGroup"][0]["title"],
            json!("y")
        );
        assert_eq!(ch["attached"][0]["image"]["extraImageField"], json!(7));
        assert_eq!(
            ch["attached"][0]["extensions"][0]["resourceRefs"],
            json!([])
        );
    }

    #[test]
    fn integer_dimensions_stay_integers() {
        let typed: Vec<Sheet> = serde_json::from_str(SAMPLE).unwrap();
        let v = serde_json::to_value(&typed).unwrap();
        let img = &v[0]["rootTopic"]["children"]["attached"][0]["image"];
        assert_eq!(img["width"], json!(113));
        assert!(img["width"].is_i64());
    }

    #[test]
    fn traversal_and_latex_lookup() {
        let typed: Vec<Sheet> = serde_json::from_str(SAMPLE).unwrap();
        let all = {
            let mut out = Vec::new();
            walk_topic(typed[0].root_topic.as_ref().unwrap(), &mut out);
            out
        };
        assert_eq!(all.len(), 6, "root + t1 + t2 + d1 + s1 + c1");
        assert_eq!(
            find_topic(&typed, "t1").unwrap().latex(),
            Some("R \\subseteq A \\times B")
        );
        assert!(find_topic(&typed, "t1").unwrap().is_equation());
        assert!(!find_topic(&typed, "t1").unwrap().is_plain_image());
        assert!(find_topic(&typed, "t2").unwrap().latex().is_none());
    }

    const RICH: &str = r##"[
      {
        "id": "s",
        "rootTopic": {
          "id": "r",
          "title": "x",
          "notes": {
            "plain": {"content": "riga1\nriga2", "extraNote": 1},
            "realHTML": {"content": "<p>riga1</p>", "x": 2}
          },
          "notesDisplay": "block",
          "labels": ["alfa", "beta"],
          "markers": [{"markerId": "priority-1", "extraMarker": 3}, {"markerId": "flag-red"}],
          "href": "https://example.org",
          "unknownMeta": {"z": 9}
        }
      }
    ]"##;

    #[test]
    fn round_trip_preserves_rich_topic_fields() {
        let original = parse(RICH);
        let typed: Vec<Sheet> = serde_json::from_value(original.clone()).unwrap();
        let reserialized = serde_json::to_value(&typed).unwrap();
        assert_eq!(original, reserialized, "note/label/marker/href alterati");
    }

    #[test]
    fn rich_topic_helpers() {
        let typed: Vec<Sheet> = serde_json::from_str(RICH).unwrap();
        let root = typed[0].root_topic.as_ref().unwrap();
        assert_eq!(root.notes_text(), Some("riga1\nriga2"));
        assert_eq!(root.labels_list(), ["alfa", "beta"]);
        assert_eq!(
            root.marker_ids().collect::<Vec<_>>(),
            vec!["priority-1", "flag-red"]
        );
        assert_eq!(root.href_str(), Some("https://example.org"));
    }

    #[test]
    fn notes_fall_back_to_real_html_and_empty_is_none() {
        let mut root: Topic = serde_json::from_value(json!({
            "id": "r",
            "notes": {"realHTML": {"content": "<p>solo html</p>"}}
        }))
        .unwrap();
        assert_eq!(root.notes_text(), Some("<p>solo html</p>"));

        root.notes = Some(Notes {
            plain: Some(NotesPart {
                content: Some(String::new()),
                ..Default::default()
            }),
            ..Default::default()
        });
        assert_eq!(root.notes_text(), None);
    }

    const STRUCTURE: &str = r##"[
      {
        "id": "s",
        "relationships": [
          {"id": "r1", "class": "relationship", "end1Id": "a", "end2Id": "b",
           "title": "collega", "controlPoints": {"0": {"x": 1, "y": 2}}, "weirdRel": 1}
        ],
        "rootTopic": {
          "id": "root",
          "title": "x",
          "children": {
            "attached": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}],
            "summary": [{"id": "sumtopic", "title": "sommario"}]
          },
          "boundaries": [
            {"id": "bd1", "class": "boundary", "range": "(0,1)", "title": "gruppo", "extraBd": 2}
          ],
          "summaries": [
            {"id": "sm1", "class": "summary", "range": "(0,0)", "topicId": "sumtopic"}
          ]
        }
      }
    ]"##;

    #[test]
    fn round_trip_preserves_structure_fields() {
        let original = parse(STRUCTURE);
        let typed: Vec<Sheet> = serde_json::from_value(original.clone()).unwrap();
        let reserialized = serde_json::to_value(&typed).unwrap();
        assert_eq!(
            original, reserialized,
            "relationship/boundary/summary alterati"
        );
    }

    #[test]
    fn structure_helpers_expose_lists() {
        let typed: Vec<Sheet> = serde_json::from_str(STRUCTURE).unwrap();
        assert_eq!(typed[0].relationships_list().len(), 1);
        let root = typed[0].root_topic.as_ref().unwrap();
        assert_eq!(root.boundaries_list().len(), 1);
        assert_eq!(root.summaries_list().len(), 1);
        assert_eq!(root.attached_count(), 2);
        assert_eq!(parse_range("(0,2)"), Some((0, 2)));
        assert_eq!(parse_range("master"), None);
        assert_eq!(format_range(2, 0), "(0,2)");
    }

    #[test]
    fn fill_color_is_set_and_removed_without_losing_style() {
        let mut t: Topic = serde_json::from_value(json!({
            "id": "t",
            "style": {"id": "s", "properties": {"fo:font-size": "14pt"}}
        }))
        .unwrap();
        set_fill_color(&mut t, Some("#ff0000"));
        assert_eq!(t.fill_color(), Some("#ff0000"));
        // la proprietà di stile preesistente resta
        assert_eq!(
            t.extra["style"]["properties"]["fo:font-size"],
            json!("14pt")
        );
        set_fill_color(&mut t, None);
        assert_eq!(t.fill_color(), None);
        assert!(t.extra["style"]["properties"].get("fo:font-size").is_some());
    }

    #[test]
    fn resource_refs_are_collected_recursively() {
        let typed: Vec<Sheet> = serde_json::from_str(SAMPLE).unwrap();
        let v = serde_json::to_value(&typed).unwrap();
        let mut refs = std::collections::BTreeSet::new();
        collect_resource_refs(&v, &mut refs);
        assert!(refs.contains("abc.png"));
        assert_eq!(refs.len(), 1);
    }
}
