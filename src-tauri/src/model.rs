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
    pub extensions: Option<Vec<Extension>>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub summaries: Option<Value>,
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

    pub fn title_str(&self) -> &str {
        self.title.as_deref().unwrap_or("")
    }
}

impl Sheet {
    pub fn title_str(&self) -> &str {
        self.title.as_deref().unwrap_or("")
    }
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
