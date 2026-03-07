use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_TRANSCRIPT_CHARS: usize = 200_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MirrorRole {
    Owner,
    Editor,
    Viewer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorParticipant {
    pub actor_id: String,
    pub session_id: Uuid,
    pub role: MirrorRole,
    pub joined_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMirror {
    pub session_id: Uuid,
    pub owner_actor_id: String,
    pub target_label: String,
    pub started_at: u64,
    pub last_event_at: u64,
    pub status: String,
    pub participants: Vec<MirrorParticipant>,
    pub transcript: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMirrorSummary {
    pub session_id: Uuid,
    pub owner_actor_id: String,
    pub target_label: String,
    pub status: String,
    pub participant_count: usize,
    pub last_event_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMirrorSnapshot {
    pub session_id: Uuid,
    pub owner_actor_id: String,
    pub target_label: String,
    pub status: String,
    pub started_at: u64,
    pub last_event_at: u64,
    pub participants: Vec<MirrorParticipant>,
    pub transcript: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionMirrorRequest {
    pub session_id: Uuid,
    pub granted_by_actor_id: String,
    pub target_actor_id: String,
    pub role: MirrorRole,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMirrorAccessRequest {
    pub session_id: Uuid,
    pub actor_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionMirrorsRequest {
    pub actor_id: String,
}

#[derive(Debug, Default)]
pub struct SessionMirrorRegistry {
    sessions: HashMap<Uuid, SessionMirror>,
}

impl SessionMirrorRegistry {
    pub fn register_session(
        &mut self,
        session_id: Uuid,
        owner_actor_id: String,
        target_label: String,
    ) -> SessionMirrorSnapshot {
        let now = unix_timestamp();
        let owner = owner_actor_id.trim();
        let owner_actor_id = if owner.is_empty() {
            "local-operator".into()
        } else {
            owner.to_string()
        };
        let mirror = SessionMirror {
            session_id,
            owner_actor_id: owner_actor_id.clone(),
            target_label,
            started_at: now,
            last_event_at: now,
            status: "opening".into(),
            participants: vec![MirrorParticipant {
                actor_id: owner_actor_id,
                session_id,
                role: MirrorRole::Owner,
                joined_at: now,
            }],
            transcript: String::new(),
        };
        self.sessions.insert(session_id, mirror.clone());
        snapshot(&mirror)
    }

    pub fn share_with_actor(
        &mut self,
        request: ShareSessionMirrorRequest,
    ) -> anyhow::Result<SessionMirrorSnapshot> {
        let granted_by = request.granted_by_actor_id.trim();
        let target_actor = request.target_actor_id.trim();
        if granted_by.is_empty() || target_actor.is_empty() {
            return Err(anyhow::anyhow!(
                "grantedByActorId and targetActorId are required"
            ));
        }
        let mirror = self
            .sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| anyhow::anyhow!("session mirror not found"))?;
        let grantor_role = role_for_actor(mirror, granted_by)
            .ok_or_else(|| anyhow::anyhow!("granting actor is not part of the session mirror"))?;
        if !matches!(grantor_role, MirrorRole::Owner | MirrorRole::Editor) {
            return Err(anyhow::anyhow!(
                "granting actor does not have permission to share the session mirror"
            ));
        }

        if let Some(participant) = mirror
            .participants
            .iter_mut()
            .find(|participant| participant.actor_id == target_actor)
        {
            participant.role = request.role;
        } else {
            mirror.participants.push(MirrorParticipant {
                actor_id: target_actor.to_string(),
                session_id: request.session_id,
                role: request.role,
                joined_at: unix_timestamp(),
            });
        }
        mirror.last_event_at = unix_timestamp();
        Ok(snapshot(mirror))
    }

    pub fn list_for_actor(&self, actor_id: &str) -> Vec<SessionMirrorSummary> {
        let actor_id = actor_id.trim();
        let mut sessions = self
            .sessions
            .values()
            .filter(|mirror| actor_can_view(mirror, actor_id))
            .map(|mirror| SessionMirrorSummary {
                session_id: mirror.session_id,
                owner_actor_id: mirror.owner_actor_id.clone(),
                target_label: mirror.target_label.clone(),
                status: mirror.status.clone(),
                participant_count: mirror.participants.len(),
                last_event_at: mirror.last_event_at,
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| right.last_event_at.cmp(&left.last_event_at));
        sessions
    }

    pub fn snapshot_for_actor(
        &self,
        session_id: Uuid,
        actor_id: &str,
    ) -> anyhow::Result<SessionMirrorSnapshot> {
        let mirror = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("session mirror not found"))?;
        if !actor_can_view(mirror, actor_id.trim()) {
            return Err(anyhow::anyhow!(
                "actor is not authorized to view this session mirror"
            ));
        }
        Ok(snapshot(mirror))
    }

    pub fn mark_connected(&mut self, session_id: Uuid) {
        self.update_status(session_id, "connected");
    }

    pub fn append_stdout(&mut self, session_id: Uuid, text: &str) {
        if let Some(mirror) = self.sessions.get_mut(&session_id) {
            mirror.last_event_at = unix_timestamp();
            mirror.transcript.push_str(text);
            if mirror.transcript.len() > MAX_TRANSCRIPT_CHARS {
                let trim = mirror.transcript.len() - MAX_TRANSCRIPT_CHARS;
                mirror.transcript.drain(..trim);
            }
        }
    }

    pub fn mark_closed(&mut self, session_id: Uuid, reason: &str) {
        self.update_status(session_id, &format!("closed: {reason}"));
    }

    pub fn mark_error(&mut self, session_id: Uuid, message: &str) {
        self.update_status(session_id, &format!("error: {message}"));
    }

    fn update_status(&mut self, session_id: Uuid, status: &str) {
        if let Some(mirror) = self.sessions.get_mut(&session_id) {
            mirror.last_event_at = unix_timestamp();
            mirror.status = status.to_string();
        }
    }
}

fn actor_can_view(mirror: &SessionMirror, actor_id: &str) -> bool {
    role_for_actor(mirror, actor_id).is_some()
}

fn role_for_actor(mirror: &SessionMirror, actor_id: &str) -> Option<MirrorRole> {
    mirror
        .participants
        .iter()
        .find(|participant| participant.actor_id == actor_id)
        .map(|participant| participant.role)
}

fn snapshot(mirror: &SessionMirror) -> SessionMirrorSnapshot {
    SessionMirrorSnapshot {
        session_id: mirror.session_id,
        owner_actor_id: mirror.owner_actor_id.clone(),
        target_label: mirror.target_label.clone(),
        status: mirror.status.clone(),
        started_at: mirror.started_at,
        last_event_at: mirror.last_event_at,
        participants: mirror.participants.clone(),
        transcript: mirror.transcript.clone(),
    }
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        ListSessionMirrorsRequest, MirrorRole, SessionMirrorAccessRequest, SessionMirrorRegistry,
        ShareSessionMirrorRequest,
    };
    use uuid::Uuid;

    #[test]
    fn shares_and_reads_read_only_session_mirror() {
        let mut registry = SessionMirrorRegistry::default();
        let session_id = Uuid::new_v4();
        registry.register_session(session_id, "owner-1".into(), "ozy@demo".into());
        registry.mark_connected(session_id);
        registry.append_stdout(session_id, "top\r\n");
        registry
            .share_with_actor(ShareSessionMirrorRequest {
                session_id,
                granted_by_actor_id: "owner-1".into(),
                target_actor_id: "auditor-1".into(),
                role: MirrorRole::Viewer,
            })
            .unwrap();

        let mirrors = registry.list_for_actor(
            &ListSessionMirrorsRequest {
                actor_id: "auditor-1".into(),
            }
            .actor_id,
        );
        assert_eq!(mirrors.len(), 1);

        let snapshot = registry
            .snapshot_for_actor(
                SessionMirrorAccessRequest {
                    session_id,
                    actor_id: "auditor-1".into(),
                }
                .session_id,
                "auditor-1",
            )
            .unwrap();
        assert!(snapshot.transcript.contains("top"));
    }
}
