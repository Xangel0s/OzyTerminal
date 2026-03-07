use crate::core::credential_import::{
    inspect_imported_credential, InspectImportedCredentialRequest,
    InspectImportedCredentialResponse,
};

#[tauri::command]
pub fn inspect_imported_credential_command(
    request: InspectImportedCredentialRequest,
) -> Result<InspectImportedCredentialResponse, String> {
    inspect_imported_credential(request).map_err(|error| error.to_string())
}
