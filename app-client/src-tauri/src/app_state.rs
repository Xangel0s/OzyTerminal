use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};

use parking_lot::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::collab::session_mirror::SessionMirrorRegistry;
use crate::core::ssh_client::TerminalInput;

#[derive(Clone, Default)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<Uuid, SessionHandle>>>,
    pub session_mirrors: Arc<RwLock<SessionMirrorRegistry>>,
}

#[derive(Clone)]
pub struct SessionHandle {
    pub input_tx: mpsc::Sender<TerminalInput>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub stdin_count: Arc<AtomicU32>,
}

impl SessionHandle {
    pub fn next_stdin_count(&self) -> u32 {
        self.stdin_count.fetch_add(1, Ordering::Relaxed) + 1
    }
}
