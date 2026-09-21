//! Editing strutturale dei topic: testo, aggiunta di sotto-blocchi ed
//! eliminazione. Sono operazioni puramente in memoria: chi le usa deve chiamare
//! `OpenWorkbook::commit()` per registrare lo snapshot di undo/redo.
//!
//! Invarianti rispettate:
//! - i campi sconosciuti (`extra`) dei topic toccati restano intatti;
//! - scrivere un titolo rimuove `titleUnedited` (altrimenti XMind ignora il
//!   testo e ripristina il titolo dedotto dall'equazione);
//! - un topic con equazione conserva `image` + `extensions`: cambia solo il
//!   titolo mostrato accanto alla formula;
//! - la radice di una sheet non è eliminabile (XMind richiede `rootTopic`).

use crate::model::{self, Children, Sheet, Topic, CHILD_GROUPS};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Genera un id di topic nel formato usato da XMind (UUID v4).
///
/// Usa `/dev/urandom`; se non è disponibile (ambiente insolito) ripiega su uno
/// SHA-256 di tempo + contatore. Nessuna dipendenza esterna.
pub fn new_topic_id() -> String {
    let mut bytes = [0u8; 16];
    let from_urandom = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !from_urandom {
        let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut hasher = Sha256::new();
        hasher.update(nanos.to_le_bytes());
        hasher.update(counter.to_le_bytes());
        let digest = hasher.finalize();
        bytes.copy_from_slice(&digest[..16]);
    }
    // Marca come UUID versione 4 (variant RFC 4122).
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Imposta il testo del topic. Non tocca equazione, immagine o figli: su un
/// blocco con formula modifica solo il titolo visibile.
pub fn set_title(topic: &mut Topic, title: &str) {
    topic.title = Some(title.to_string());
    topic.title_unedited = None;
}

/// Aggiunge un sotto-blocco testuale come figlio `attached` di `parent` e
/// restituisce l'id generato. Crea il contenitore `children` se assente.
pub fn add_child(parent: &mut Topic, title: &str) -> String {
    let id = new_topic_id();
    let child = Topic {
        id: Some(id.clone()),
        title: Some(title.to_string()),
        ..Default::default()
    };
    let children = parent.children.get_or_insert_with(Children::default);
    children.attached.get_or_insert_with(Vec::new).push(child);
    id
}

/// Stacca e restituisce il topic con `id` (insieme a tutti i suoi figli).
///
/// Restituisce `None` se non esiste o se è la radice di una sheet: la radice
/// non è eliminabile perché XMind richiede un `rootTopic`. Le risorse
/// eventualmente referenziate restano nello ZIP come orfane innocue (l'undo le
/// può ripristinare).
pub fn remove_topic(sheets: &mut [Sheet], id: &str) -> Option<Topic> {
    for sheet in sheets.iter_mut() {
        let Some(root) = sheet.root_topic.as_mut() else {
            continue;
        };
        if root.id.as_deref() == Some(id) {
            return None;
        }
        if let Some(found) = detach_from(root, id) {
            return Some(found);
        }
    }
    None
}

fn detach_from(topic: &mut Topic, id: &str) -> Option<Topic> {
    for group in CHILD_GROUPS {
        let Some(children) = topic.group_mut(group) else {
            continue;
        };
        if let Some(pos) = children.iter().position(|t| t.id.as_deref() == Some(id)) {
            return Some(children.remove(pos));
        }
        for child in children.iter_mut() {
            if let Some(found) = detach_from(child, id) {
                return Some(found);
            }
        }
    }
    None
}

/// Punto di rilascio di un trascinamento nell'albero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MovePlacement {
    /// Diventa fratello, subito prima del blocco bersaglio (stesso gruppo).
    Before,
    /// Diventa fratello, subito dopo il blocco bersaglio (stesso gruppo).
    After,
    /// Diventa figlio `attached` del blocco bersaglio (in fondo).
    Into,
}

/// Motivo per cui `move_topic` rifiuta lo spostamento.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveError {
    /// `id` o `target_id` non esistono.
    NotFound,
    /// La radice di una sheet non si sposta.
    Immovable,
    /// Il bersaglio è il blocco stesso o un suo discendente (ciclo).
    Cycle,
    /// `Before`/`After` su una radice, che non ha fratelli.
    NoSiblings,
}

impl MoveError {
    /// Messaggio in italiano per l'utente.
    pub fn message(self) -> &'static str {
        match self {
            MoveError::NotFound => "Blocco da spostare non trovato.",
            MoveError::Immovable => "La radice della mappa non si può spostare.",
            MoveError::Cycle => "Un blocco non può essere spostato dentro sé stesso.",
            MoveError::NoSiblings => "La radice non ha fratelli con cui riordinarsi.",
        }
    }
}

/// Sposta il blocco `id` (con tutto il suo sotto-albero) rispetto a
/// `target_id`. Operazione puramente in memoria: chi la usa deve chiamare
/// `OpenWorkbook::commit()`.
///
/// Il sotto-albero non cambia mai: per spostarlo lo si stacca e lo si
/// reinserisce. Le risorse referenziate seguono il blocco e non vengono toccate.
pub fn move_topic(
    sheets: &mut [Sheet],
    id: &str,
    target_id: &str,
    placement: MovePlacement,
) -> Result<(), MoveError> {
    if id == target_id {
        return Err(MoveError::Cycle);
    }
    if model::find_topic(sheets, target_id).is_none() {
        return Err(MoveError::NotFound);
    }
    if is_sheet_root(sheets, id) {
        return Err(MoveError::Immovable);
    }
    // Il bersaglio non può stare dentro il blocco che si muove, altrimenti lo
    // stacco si porterebbe via la destinazione.
    {
        let source = model::find_topic(sheets, id).ok_or(MoveError::NotFound)?;
        let mut subtree = Vec::new();
        model::walk_topic(source, &mut subtree);
        if subtree.iter().any(|t| t.id.as_deref() == Some(target_id)) {
            return Err(MoveError::Cycle);
        }
    }
    if matches!(placement, MovePlacement::Before | MovePlacement::After)
        && is_sheet_root(sheets, target_id)
    {
        return Err(MoveError::NoSiblings);
    }

    let moved = remove_topic(sheets, id).ok_or(MoveError::NotFound)?;
    match placement {
        MovePlacement::Into => {
            let target = model::find_topic_mut(sheets, target_id).ok_or(MoveError::NotFound)?;
            target
                .children
                .get_or_insert_with(Children::default)
                .attached
                .get_or_insert_with(Vec::new)
                .push(moved);
        }
        MovePlacement::Before | MovePlacement::After => {
            insert_sibling(sheets, target_id, moved, placement == MovePlacement::After)?;
        }
    }
    Ok(())
}

/// Vero se `id` è `rootTopic` di una sheet.
fn is_sheet_root(sheets: &[Sheet], id: &str) -> bool {
    sheets
        .iter()
        .any(|sheet| sheet.root_topic.as_ref().and_then(|t| t.id.as_deref()) == Some(id))
}

/// Inserisce `moved` nello stesso gruppo di `target_id`, prima o dopo di esso.
fn insert_sibling(
    sheets: &mut [Sheet],
    target_id: &str,
    moved: Topic,
    after: bool,
) -> Result<(), MoveError> {
    for sheet in sheets.iter_mut() {
        let Some(root) = sheet.root_topic.as_mut() else {
            continue;
        };
        let mut path = Vec::new();
        if !find_path(root, target_id, &mut path) {
            continue;
        }
        // `target_id` è la radice: gestito prima, ma niente panic in produzione.
        let Some(&(group_index, child_index)) = path.last() else {
            return Err(MoveError::NoSiblings);
        };
        let parent = descend_mut(root, &path[..path.len() - 1], 0);
        let children = parent
            .group_mut(CHILD_GROUPS[group_index])
            .ok_or(MoveError::NotFound)?;
        let at = (child_index + usize::from(after)).min(children.len());
        children.insert(at, moved);
        return Ok(());
    }
    Err(MoveError::NotFound)
}

/// Percorso (indice gruppo, indice figlio) verso `id`, in sola lettura.
fn find_path(topic: &Topic, id: &str, path: &mut Vec<(usize, usize)>) -> bool {
    if topic.id.as_deref() == Some(id) {
        return true;
    }
    for (gi, group) in CHILD_GROUPS.iter().enumerate() {
        if let Some(children) = topic.group(group) {
            for (ci, child) in children.iter().enumerate() {
                path.push((gi, ci));
                if find_path(child, id, path) {
                    return true;
                }
                path.pop();
            }
        }
    }
    false
}

/// Ripercorre `path` in mutazione (due fasi per il borrow checker).
fn descend_mut<'a>(topic: &'a mut Topic, path: &[(usize, usize)], i: usize) -> &'a mut Topic {
    if i == path.len() {
        return topic;
    }
    let (gi, ci) = path[i];
    let children = topic.group_mut(CHILD_GROUPS[gi]).unwrap();
    descend_mut(&mut children[ci], path, i + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tree() -> Vec<Sheet> {
        serde_json::from_value(json!([
            {
                "id": "sheet",
                "rootTopic": {
                    "id": "root",
                    "title": "Radice",
                    "children": {
                        "attached": [
                            {
                                "id": "a",
                                "title": "Alfa",
                                "titleUnedited": true,
                                "children": {"attached": [{"id": "a1", "title": "Figlio"}]}
                            },
                            {
                                "id": "b",
                                "title": "",
                                "image": {"src": "xap:resources/x.png", "width": 10, "height": 5, "isMathJaxImage": true},
                                "extensions": [{"provider": "org.xmind.ui.mathJax", "content": {"content": "a=b"}}]
                            }
                        ]
                    }
                }
            }
        ]))
        .unwrap()
    }

    #[test]
    fn new_id_is_uuid_v4_shaped_and_unique() {
        let a = new_topic_id();
        let b = new_topic_id();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        assert_eq!(&a[14..15], "4", "versione 4");
    }

    #[test]
    fn set_title_sets_text_and_drops_title_unedited() {
        let mut sheets = tree();
        let t = crate::model::find_topic_mut(&mut sheets, "a").unwrap();
        set_title(t, "Alfa 2");
        assert_eq!(t.title.as_deref(), Some("Alfa 2"));
        assert!(t.title_unedited.is_none());
    }

    #[test]
    fn set_title_keeps_equation_and_image() {
        let mut sheets = tree();
        let t = crate::model::find_topic_mut(&mut sheets, "b").unwrap();
        set_title(t, "Titolo formula");
        assert_eq!(t.latex(), Some("a=b"));
        assert!(!t.is_plain_image());
        assert_eq!(t.image.as_ref().unwrap().is_mathjax_image, Some(true));
        assert_eq!(t.title.as_deref(), Some("Titolo formula"));
    }

    #[test]
    fn add_child_creates_attached_topic_with_new_id() {
        let mut sheets = tree();
        let id = {
            let t = crate::model::find_topic_mut(&mut sheets, "a").unwrap();
            let id = add_child(t, "Nuovo blocco");
            assert_eq!(t.child_count(), 2);
            id
        };
        let added = crate::model::find_topic(&sheets, &id).expect("topic aggiunto");
        assert_eq!(added.title.as_deref(), Some("Nuovo blocco"));
    }

    #[test]
    fn add_child_creates_children_container_when_missing() {
        let mut parent = Topic {
            id: Some("p".into()),
            ..Default::default()
        };
        let id = add_child(&mut parent, "x");
        assert_eq!(parent.group("attached").unwrap().len(), 1);
        assert_eq!(
            parent.group("attached").unwrap()[0].id.as_deref(),
            Some(id.as_str())
        );
    }

    #[test]
    fn remove_topic_detaches_nested_topic() {
        let mut sheets = tree();
        let removed = remove_topic(&mut sheets, "a1").expect("rimosso");
        assert_eq!(removed.id.as_deref(), Some("a1"));
        assert!(crate::model::find_topic(&sheets, "a1").is_none());
        // il resto è intatto
        assert!(crate::model::find_topic(&sheets, "a").is_some());
        assert!(crate::model::find_topic(&sheets, "b").is_some());
    }

    #[test]
    fn remove_root_is_refused() {
        let mut sheets = tree();
        assert!(remove_topic(&mut sheets, "root").is_none());
        assert!(crate::model::find_topic(&sheets, "root").is_some());
    }

    #[test]
    fn remove_unknown_is_none() {
        let mut sheets = tree();
        assert!(remove_topic(&mut sheets, "ghost").is_none());
    }

    #[test]
    fn move_into_reparents_as_last_child() {
        let mut sheets = tree();
        move_topic(&mut sheets, "a1", "b", MovePlacement::Into).unwrap();
        let b = crate::model::find_topic(&sheets, "b").unwrap();
        assert_eq!(
            b.group("attached").unwrap().last().unwrap().id.as_deref(),
            Some("a1")
        );
        // staccato dal vecchio padre
        let a = crate::model::find_topic(&sheets, "a").unwrap();
        assert_eq!(a.child_count(), 0);
        assert_eq!(
            crate::model::find_topic(&sheets, "a1").unwrap().title_str(),
            "Figlio"
        );
    }

    #[test]
    fn move_before_and_after_reorder_siblings() {
        let mut sheets = tree();
        // "b" prima di "a" → ordine b, a
        move_topic(&mut sheets, "b", "a", MovePlacement::Before).unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        let ids: Vec<&str> = root
            .group("attached")
            .unwrap()
            .iter()
            .map(|t| t.id.as_deref().unwrap())
            .collect();
        assert_eq!(ids, vec!["b", "a"]);

        // e adesso "b" dopo "a" → torna a, b
        move_topic(&mut sheets, "b", "a", MovePlacement::After).unwrap();
        let root = sheets[0].root_topic.as_ref().unwrap();
        let ids: Vec<&str> = root
            .group("attached")
            .unwrap()
            .iter()
            .map(|t| t.id.as_deref().unwrap())
            .collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn move_into_descendant_is_refused() {
        let mut sheets = tree();
        let before = serde_json::to_value(&sheets).unwrap();
        assert_eq!(
            move_topic(&mut sheets, "a", "a1", MovePlacement::Into),
            Err(MoveError::Cycle)
        );
        assert_eq!(
            serde_json::to_value(&sheets).unwrap(),
            before,
            "nessuna modifica"
        );
    }

    #[test]
    fn move_self_is_refused() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "a", "a", MovePlacement::Into),
            Err(MoveError::Cycle)
        );
    }

    #[test]
    fn move_root_is_refused() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "root", "a", MovePlacement::Into),
            Err(MoveError::Immovable)
        );
        assert_eq!(
            move_topic(&mut sheets, "a", "root", MovePlacement::Before),
            Err(MoveError::NoSiblings)
        );
    }

    #[test]
    fn move_from_missing_or_unknown_placement_is_none() {
        let mut sheets = tree();
        assert_eq!(
            move_topic(&mut sheets, "ghost", "b", MovePlacement::Into),
            Err(MoveError::NotFound)
        );
        assert_eq!(
            move_topic(&mut sheets, "a", "ghost", MovePlacement::Into),
            Err(MoveError::NotFound)
        );
    }
}
