//! Application state shared by the IPC commands.
//!
//! The database engine (`ide-db`) is a single process-wide manager: this app
//! is one window against one set of data sources, so unlike OpenIDEA there is
//! no per-project scoping.

use std::sync::Arc;

use ide_db::DbManager;
use ide_ssh::SshManager;

/// Holds the long-lived handles the commands need.
pub struct AppState {
    /// Data sources, connection pools, SSH tunnels, history and saved secrets.
    pub db: Arc<DbManager>,
    /// App-wide SSH connections and host-key trust.
    pub ssh: Arc<SshManager>,
}

impl AppState {
    /// Builds the state and the database manager rooted at the app data dir.
    pub fn new(root: std::path::PathBuf) -> Self {
        let ssh = Arc::new(SshManager::new(root.join("ssh")));
        let db = Arc::new(DbManager::new(
            root.clone(),
            root.join("passwords.json"),
            root.join("history.json"),
            ssh.clone(),
        ));
        Self { db, ssh }
    }
}
