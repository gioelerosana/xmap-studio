//! Task tracking nativo di XMind.
//!
//! I dati vivono in una extension `org.xmind.ui.task` il cui `content` è un
//! oggetto con le chiavi `priority`, `progress`, `startDate`, `dueDate`,
//! `assignees`, `dependencies`, `creator`. Qui gestiamo solo le quattro chiavi
//! scalari, preservando intatte le altre (in particolare `dependencies`, che
//! XMind usa per il diagramma di Gantt).
//!
//! Nota: XMind affianca al task anche i marker (`priority-*`, `task-*`). Non li
//! tocchiamo automaticamente: restano gestibili dal pannello Marker, così una
//! modifica al task non riscrive icone scelte dall'utente.

use crate::model::{Extension, Topic};
use serde_json::{Map, Value};

pub const TASK_PROVIDER: &str = "org.xmind.ui.task";

/// I campi scalari che rappresentano un task. `dependencies` è volutamente
/// escluso: va preservato, non riscritto.
const SCALAR_KEYS: [&str; 4] = ["priority", "progress", "startDate", "dueDate"];

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TaskData {
    pub priority: Option<i64>,
    pub progress: Option<i64>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
}

impl TaskData {
    pub fn is_empty(&self) -> bool {
        self.priority.is_none()
            && self.progress.is_none()
            && self.start_date.is_none()
            && self.due_date.is_none()
    }
}

/// Legge il task del topic. `None` se l'extension manca o non ha campi scalari.
pub fn read(topic: &Topic) -> Option<TaskData> {
    let content = topic
        .extension(TASK_PROVIDER)?
        .content
        .as_ref()?
        .as_object()?;
    if !SCALAR_KEYS.iter().any(|k| content.contains_key(*k)) {
        return None;
    }
    Some(TaskData {
        priority: content.get("priority").and_then(Value::as_i64),
        progress: content.get("progress").and_then(Value::as_i64),
        start_date: content
            .get("startDate")
            .and_then(Value::as_str)
            .map(str::to_string),
        due_date: content
            .get("dueDate")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Scrive il task, creando l'extension se assente. Con dati vuoti rimuove solo
/// le chiavi scalari: se non resta altro, elimina l'extension.
pub fn write(topic: &mut Topic, data: &TaskData) {
    let exts = topic.extensions.get_or_insert_with(Vec::new);
    if !exts
        .iter()
        .any(|e| e.provider.as_deref() == Some(TASK_PROVIDER))
    {
        exts.push(Extension {
            provider: Some(TASK_PROVIDER.to_string()),
            content: Some(Value::Object(Map::new())),
            ..Default::default()
        });
    }
    let ext = exts
        .iter_mut()
        .find(|e| e.provider.as_deref() == Some(TASK_PROVIDER))
        .unwrap();
    if !ext.content.as_ref().map(Value::is_object).unwrap_or(false) {
        ext.content = Some(Value::Object(Map::new()));
    }
    let obj = ext.content.as_mut().unwrap().as_object_mut().unwrap();
    set_num(obj, "priority", data.priority);
    set_num(obj, "progress", data.progress);
    set_str(obj, "startDate", data.start_date.as_deref());
    set_str(obj, "dueDate", data.due_date.as_deref());

    let empty = ext
        .content
        .as_ref()
        .and_then(Value::as_object)
        .map(Map::is_empty)
        .unwrap_or(false);
    if empty {
        if let Some(exts) = topic.extensions.as_mut() {
            exts.retain(|e| e.provider.as_deref() != Some(TASK_PROVIDER));
            if exts.is_empty() {
                topic.extensions = None;
            }
        }
    }
}

/// Azzera i campi scalari del task.
pub fn clear(topic: &mut Topic) {
    write(topic, &TaskData::default());
}

fn set_num(obj: &mut Map<String, Value>, key: &str, value: Option<i64>) {
    match value {
        Some(n) => {
            obj.insert(key.to_string(), Value::Number(n.into()));
        }
        None => {
            obj.remove(key);
        }
    }
}

fn set_str(obj: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(s) => {
            obj.insert(key.to_string(), Value::String(s.to_string()));
        }
        None => {
            obj.remove(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn write_read_roundtrip() {
        let mut t = Topic::default();
        write(
            &mut t,
            &TaskData {
                priority: Some(2),
                progress: Some(50),
                start_date: Some("2026-01-01T00:00:00.000Z".into()),
                due_date: Some("2026-01-31T00:00:00.000Z".into()),
            },
        );
        let read = read(&t).unwrap();
        assert_eq!(read.priority, Some(2));
        assert_eq!(read.progress, Some(50));
        assert_eq!(read.start_date.as_deref(), Some("2026-01-01T00:00:00.000Z"));
        assert_eq!(
            t.extension(TASK_PROVIDER).unwrap().provider.as_deref(),
            Some(TASK_PROVIDER)
        );
    }

    #[test]
    fn dependencies_are_preserved_and_empty_removes_extension() {
        let mut t: Topic = serde_json::from_value(json!({
            "id": "t",
            "extensions": [{
                "provider": "org.xmind.ui.task",
                "content": {"priority": 1, "dependencies": [{"id": "x"}]}
            }]
        }))
        .unwrap();
        // azzerando i campi scalari restano le dependencies: extension conservata
        clear(&mut t);
        let content = t.extension(TASK_PROVIDER).unwrap().content.clone().unwrap();
        assert!(content.get("priority").is_none());
        assert_eq!(content["dependencies"][0]["id"], json!("x"));

        // senza altro contenuto l'extension sparisce
        let mut t2: Topic = serde_json::from_value(json!({
            "id": "t",
            "extensions": [{"provider": "org.xmind.ui.task", "content": {"priority": 3}}]
        }))
        .unwrap();
        clear(&mut t2);
        assert!(t2.extension(TASK_PROVIDER).is_none());
        assert!(t2.extensions.is_none());
    }

    #[test]
    fn read_returns_none_without_scalar_keys() {
        let t: Topic = serde_json::from_value(json!({
            "id": "t",
            "extensions": [{"provider": "org.xmind.ui.task", "content": {"dependencies": []}}]
        }))
        .unwrap();
        assert!(read(&t).is_none());
    }
}
