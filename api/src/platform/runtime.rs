//! Application-wide runtime state shared by HTTP handlers.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::sync::watch;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: DatabaseConnection,
    shutdown: watch::Sender<bool>,
    restart_pending: Arc<AtomicBool>,
}

impl AppState {
    pub(crate) fn new(db: DatabaseConnection, shutdown: watch::Sender<bool>) -> Self {
        Self {
            db,
            shutdown,
            restart_pending: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn schedule_restart(&self) -> Result<(), std::io::Error> {
        if self.restart_pending.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let executable = std::env::current_exe()?;
        let current_dir = std::env::current_dir()?;
        let mut command = std::process::Command::new(executable);
        command
            .args(std::env::args_os().skip(1))
            .current_dir(current_dir)
            .env("YAYA_RESTART_DELAY_MS", "1200");

        if let Err(error) = command.spawn() {
            self.restart_pending.store(false, Ordering::SeqCst);
            return Err(error);
        }

        let shutdown = self.shutdown.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = shutdown.send(true);
        });

        Ok(())
    }
}
