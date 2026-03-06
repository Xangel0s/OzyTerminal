use uuid::Uuid;

use crate::app_state::AppState;

pub fn remove_session(state: &AppState, session_id: Uuid) {
    state.sessions.write().remove(&session_id);
}
