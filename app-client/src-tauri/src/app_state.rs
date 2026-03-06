use std::{collections::HashMap, sync::Arc};

use parking_lot::RwLock;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::core::ssh_client::{TerminalEvent, TerminalInput};

#[derive(Clone, Default)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<Uuid, SessionHandle>>>,
}

#[derive(Clone)]
pub struct SessionHandle {
    pub input_tx: mpsc::Sender<TerminalInput>,
    pub event_tx: broadcast::Sender<TerminalEvent>,
}
