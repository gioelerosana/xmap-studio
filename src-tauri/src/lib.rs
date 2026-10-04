//! XMap Studio — app desktop nativa (GTK4 + libadwaita).
//!
//! Apre un `.xmind`, mostra i topic come blocchi, applica/rimuove equazioni
//! MathJax native e salva in modo atomico e validato, senza mai distruggere i
//! campi che non conosce.

pub mod archive;
pub mod controller;
pub mod edit;
pub mod equation;
pub mod error;
pub mod export;
pub mod gui;
pub mod import;
pub mod layout;
pub mod map_view;
pub mod markers;
pub mod mathjax;
pub mod media;
pub mod merge;
pub mod model;
pub mod raster;
pub mod renderer_assets;
pub mod safety;
pub mod state;
pub mod task;
pub mod validate;

/// Application ID GApplication (deve essere un nome DNS invertito valido).
pub const APP_ID: &str = "org.joel.xmap_studio";

pub fn run() -> gtk::glib::ExitCode {
    gui::run()
}
