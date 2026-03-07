use crate::core::control_plane::{
    issue_relay_lease, issue_ssh_certificate, IssueRelayLeaseCommandRequest,
    IssueSshCertificateCommandRequest, ResolvedRelayLease, ResolvedSshCertificate,
};

#[tauri::command]
pub async fn issue_ssh_certificate_command(
    request: IssueSshCertificateCommandRequest,
) -> Result<ResolvedSshCertificate, String> {
    issue_ssh_certificate(request)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn issue_relay_lease_command(
    request: IssueRelayLeaseCommandRequest,
) -> Result<ResolvedRelayLease, String> {
    issue_relay_lease(request)
        .await
        .map_err(|err| err.to_string())
}
