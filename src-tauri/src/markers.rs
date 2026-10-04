//! Catalogo dei marker (icone) di XMind.
//!
//! Estratto dal binario XMind 26.03.04129: gli id coincidono con il nome file
//! senza estensione (`static/snowbird/resource/markers/**`). I nomi leggibili
//! vengono dalla mappa id → nome del binario. Un id presente qui è un id che
//! XMind sa renderizzare; id sconosciuti restano comunque preservati nel
//! modello (mai distruggere dati), ma non vengono offerti dalla UI.

/// Un marker del catalogo: id canonico e nome mostrato (spesso in inglese,
/// come nel prodotto originale).
pub type MarkerInfo = (&'static str, &'static str);

/// Un gruppo di marker, come sono organizzati nel pannello di XMind.
pub struct MarkerGroup {
    pub id: &'static str,
    pub label: &'static str,
    pub markers: &'static [MarkerInfo],
}

pub const GROUPS: &[MarkerGroup] = &[
    MarkerGroup {
        id: "priorityMarkers",
        label: "Priorità",
        markers: &[
            ("priority-1", "Priority 1"),
            ("priority-2", "Priority 2"),
            ("priority-3", "Priority 3"),
            ("priority-4", "Priority 4"),
            ("priority-5", "Priority 5"),
            ("priority-6", "Priority 6"),
            ("priority-7", "Priority 7"),
            ("priority-8", "Priority 8"),
            ("priority-9", "Priority 9"),
        ],
    },
    MarkerGroup {
        id: "taskMarkers",
        label: "Avanzamento",
        markers: &[
            ("task-3oct", "3/8 Done"),
            ("task-3quar", "3/4 Done"),
            ("task-5oct", "5/8 Done"),
            ("task-7oct", "7/8 Done"),
            ("task-done", "Task Done"),
            ("task-half", "1/2 Done"),
            ("task-oct", "1/8 Done"),
            ("task-quarter", "1/4 Done"),
            ("task-start", "Task Starting"),
        ],
    },
    MarkerGroup {
        id: "flagMarkers",
        label: "Bandierine",
        markers: &[
            ("flag-blue", "Blue Flag"),
            ("flag-dark-blue", "Dark Blue Flag"),
            ("flag-dark-gray", "Dark Gray Flag"),
            ("flag-dark-green", "Dark Green Flag"),
            ("flag-gray", "Gray Flag"),
            ("flag-green", "Green Flag"),
            ("flag-orange", "Orange Flag"),
            ("flag-purple", "Purple Flag"),
            ("flag-red", "Red Flag"),
            ("flag-yellow", "Yellow Flag"),
        ],
    },
    MarkerGroup {
        id: "starMarkers",
        label: "Stelle",
        markers: &[
            ("star-blue", "Blue Star"),
            ("star-dark-blue", "Dark Blue Star"),
            ("star-dark-gray", "Dark Gray Star"),
            ("star-dark-green", "Dark Green Star"),
            ("star-gray", "Gray Star"),
            ("star-green", "Green Star"),
            ("star-orange", "Orange Star"),
            ("star-purple", "Purple Star"),
            ("star-red", "Red Star"),
            ("star-yellow", "Yellow Star"),
        ],
    },
    MarkerGroup {
        id: "smileyMarkers",
        label: "Faccine",
        markers: &[
            ("smiley-adore", "Adore"),
            ("smiley-angry", "Angry"),
            ("smiley-boring", "Boring"),
            ("smiley-cry-laugh", "Cry Laugh"),
            ("smiley-cry", "Cry"),
            ("smiley-devil", "Devil"),
            ("smiley-embarrass", "Embarrass"),
            ("smiley-laugh", "Laugh"),
            ("smiley-love", "Love"),
            ("smiley-sad", "Sad"),
            ("smiley-smile", "Smile"),
            ("smiley-surprise", "Surprise"),
            ("smiley-think", "Think"),
            ("smiley-upset", "Upset"),
        ],
    },
    MarkerGroup {
        id: "peopleMarkers",
        label: "Persone",
        markers: &[
            ("people-blue", "Blue Avatar"),
            ("people-dark-blue", "Dark Blue Avatar"),
            ("people-dark-gray", "Dark Gray Avatar"),
            ("people-dark-green", "Dark Green Avatar"),
            ("people-gray", "Gray Avatar"),
            ("people-green", "Green Avatar"),
            ("people-orange", "Orange Avatar"),
            ("people-purple", "Purple Avatar"),
            ("people-red", "Red Avatar"),
            ("people-yellow", "Yellow Avatar"),
        ],
    },
    MarkerGroup {
        id: "arrowMarkers",
        label: "Frecce",
        markers: &[
            ("arrow-down-left", "Down and Left"),
            ("arrow-down-right", "Down and Right"),
            ("arrow-down", "Down"),
            ("arrow-left-right", "Left and Right"),
            ("arrow-left", "Left"),
            ("arrow-refresh", "Refresh"),
            ("arrow-right", "Right"),
            ("arrow-up-down", "Up and Down"),
            ("arrow-up-left", "Up and Left"),
            ("arrow-up-right", "Up and Right"),
            ("arrow-up", "Up"),
        ],
    },
    MarkerGroup {
        id: "symbolMarkers",
        label: "Simboli",
        markers: &[
            ("c_simbol-exclam", "symbolExclam"),
            ("c_simbol-info", "symbolInfo"),
            ("c_simbol-minus", "Minus"),
            ("c_simbol-pause", "Pause"),
            ("c_simbol-plus", "Plus"),
            ("c_simbol-question", "Question"),
            ("c_simbol-right", "Check"),
            ("c_simbol-wrong", "Wrong"),
            ("c_symbol_bar_chart", "Bar Chart"),
            ("c_symbol_contact", "Contact"),
            ("c_symbol_dislike", "Dislike"),
            ("c_symbol_drink", "symbolDrink"),
            ("c_symbol_exercise", "Exercise"),
            ("c_symbol_flight", "Flight"),
            ("c_symbol_heart", "Heart"),
            ("c_symbol_hourglass", "Hourglass"),
            ("c_symbol_like", "Like"),
            ("c_symbol_line_graph", "symbolLineGraph"),
            ("c_symbol_lock", "Lock"),
            ("c_symbol_medals", "symbolMedals"),
            ("c_symbol_money", "Money"),
            ("c_symbol_music", "Music"),
            ("c_symbol_pen", "Pen"),
            ("c_symbol_pie_chart", "Pie Chart"),
            ("c_symbol_shopping_cart", "Shopping Cart"),
            ("c_symbol_telephone", "Telephone"),
            ("c_symbol_thermometer", "symbolThermometer"),
            ("c_symbol_trophy", "Trophy"),
            ("symbol-100", "100"),
            ("symbol-attention", "Attention"),
            ("symbol-diamond", "Diamond"),
            ("symbol-entertainment", "Entertainment"),
            ("symbol-exclam", "symbolExclam"),
            ("symbol-idea", "Idea"),
            ("symbol-info", "symbolInfo"),
            ("symbol-lightning", "Lightning"),
            ("symbol-minus", "Minus"),
            ("symbol-pause", "Pause"),
            ("symbol-pin", "Pin"),
            ("symbol-plus", "Plus"),
            ("symbol-question", "Question"),
            ("symbol-right", "Check"),
            ("symbol-run", "Run"),
            ("symbol-unlock", "Unlock"),
            ("symbol-wrong", "Wrong"),
        ],
    },
    MarkerGroup {
        id: "academicMarkers",
        label: "Studio",
        markers: &[
            ("c_symbol_apostrophe", "Apostrophe"),
            ("c_symbol_quote", "Quote"),
            ("symbol-about", "About"),
            ("symbol-code", "Code"),
            ("symbol-divide", "Divide"),
            ("symbol-equality", "Equality"),
            ("symbol-not-equality", "Not Equality"),
        ],
    },
    MarkerGroup {
        id: "socialMarkers",
        label: "Social",
        markers: &[
            ("c_symbol_broken_heart", "Broken Heart"),
            ("symbol-comment", "Comment"),
            ("symbol-no-entry", "No Entry"),
            ("symbol-notice", "Notice"),
            ("symbol-rss", "RSS"),
            ("symbol-share", "Share"),
            ("symbol_forward", "Forward"),
        ],
    },
    MarkerGroup {
        id: "otherMarkers",
        label: "Altro",
        markers: &[
            ("other-exclam", "Exclamation Mark"),
            ("other-no", "No"),
            ("other-question", "Question"),
            ("other-yes", "Yes"),
            ("symbol-image", "symbolImage"),
        ],
    },
    MarkerGroup {
        id: "monthMarkers",
        label: "Mesi",
        markers: &[
            ("month-apr", "April"),
            ("month-aug", "August"),
            ("month-dec", "December"),
            ("month-feb", "February"),
            ("month-jan", "January"),
            ("month-jul", "July"),
            ("month-jun", "June"),
            ("month-mar", "March"),
            ("month-may", "May"),
            ("month-nov", "November"),
            ("month-oct", "October"),
            ("month-sep", "September"),
        ],
    },
    MarkerGroup {
        id: "weekMarkers",
        label: "Giorni",
        markers: &[
            ("week-fri", "Friday"),
            ("week-mon", "Monday"),
            ("week-sat", "Saturday"),
            ("week-sun", "Sunday"),
            ("week-thu", "Thursday"),
            ("week-tue", "Tuesday"),
            ("week-wed", "Wednesday"),
        ],
    },
    MarkerGroup {
        id: "celebrationMarkers",
        label: "Celebrazioni",
        markers: &[
            ("celebration-100", "100"),
            ("celebration-birthday", "Birthday"),
            ("celebration-boom", "Boom"),
            ("celebration-cheers", "Cheers"),
            ("celebration-clap", "Clap"),
            ("celebration-five", "Give Me Five"),
            ("celebration-king", "Crown"),
            ("celebration-kiss", "Kiss"),
            ("celebration-ribbon", "Ribbon"),
        ],
    },
    MarkerGroup {
        id: "tagMarkers",
        label: "Etichette colorate",
        markers: &[
            ("tag-blue", "Blue Tag"),
            ("tag-dark-blue", "Dark Blue Tag"),
            ("tag-dark-purple", "Dark Purple Tag"),
            ("tag-green", "Green Tag"),
            ("tag-grey", "Grey Tag"),
            ("tag-orange", "Orange Tag"),
            ("tag-red", "Red Tag"),
            ("tag-yellow", "Yellow Tag"),
        ],
    },
];

/// Nome leggibile di un id, se è nel catalogo.
pub fn name_of(id: &str) -> Option<&'static str> {
    GROUPS
        .iter()
        .flat_map(|g| g.markers.iter())
        .find_map(
            |(candidate, name)| {
                if *candidate == id {
                    Some(*name)
                } else {
                    None
                }
            },
        )
}

/// Vero se l'id è un marker noto a XMind.
pub fn is_known(id: &str) -> bool {
    name_of(id).is_some()
}

/// Etichetta da mostrare per un id: il nome del catalogo o l'id grezzo per i
/// marker importati che non conosciamo.
pub fn display_name(id: &str) -> String {
    name_of(id).unwrap_or(id).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_has_no_duplicate_ids() {
        let mut seen = HashSet::new();
        for group in GROUPS {
            for (id, name) in group.markers {
                assert!(seen.insert(*id), "id duplicato nel catalogo: {id}");
                assert!(!name.is_empty(), "nome vuoto per {id}");
            }
        }
        assert!(seen.len() > 150, "catalogo sospettosamente corto");
    }

    #[test]
    fn known_markers_are_resolved() {
        assert!(is_known("priority-1"));
        assert!(is_known("task-done"));
        assert!(is_known("flag-red"));
        assert_eq!(name_of("priority-1"), Some("Priority 1"));
        assert!(!is_known("non-esiste"));
        assert_eq!(display_name("non-esiste"), "non-esiste");
    }
}
