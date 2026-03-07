use std::{collections::HashMap, sync::Arc};

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
}
