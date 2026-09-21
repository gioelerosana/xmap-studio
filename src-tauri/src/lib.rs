//! XMind Equation Studio — app desktop nativa (GTK4 + libadwaita).
//!
//! Apre un `.xmind`, mostra i topic come blocchi, applica/rimuove equazioni
//! MathJax native e salva in modo atomico e validato, senza mai distruggere i
//! campi che non conosce.

pub mod archive;
pub mod controller;
pub mod edit;
pub mod equation;
pub mod error;
pub mod gui;
pub mod mathjax;
pub mod model;
pub mod raster;
pub mod renderer_assets;
pub mod safety;
pub mod state;
pub mod validate;

/// Application ID GApplication (deve essere un nome DNS invertito valido).
pub const APP_ID: &str = "org.joel.xmind_equation_studio";

pub fn run() -> gtk::glib::ExitCode {
    gui::run()
}
