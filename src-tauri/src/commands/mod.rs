// Command modules
pub mod binary;
pub mod checks;
pub mod commits;
pub mod file_view;
pub mod file_watcher;
pub mod filesystem;
pub mod github;
pub mod pending_review;
pub mod pty_commands;
pub mod session;
pub mod settings;
pub mod workspace;

// Re-export all commands for convenient access
pub use binary::*;
pub use checks::*;
pub use commits::*;
pub use file_view::*;
pub use file_watcher::*;
pub use filesystem::*;
pub use github::*;
pub use pending_review::*;
pub use pty_commands::*;
pub use session::*;
pub use settings::*;
pub use workspace::*;
