pub mod app_state;
pub mod activity;
pub mod collab;
pub mod commands;
pub mod core;
pub mod crypto;
pub mod tunnel;

use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::collab::bootstrap_demo_shared_vault_command,
            commands::collab::delete_shared_vault_node_command,
            commands::collab::get_session_mirror_command,
            commands::collab::list_collab_audit_entries_command,
            commands::collab::list_session_mirrors_command,
            commands::collab::list_shared_vault_entries_command,
            commands::collab::load_shared_vault_command,
            commands::collab::save_shared_vault_command,
            commands::collab::share_session_mirror_command,
            commands::collab::upsert_shared_vault_server_command,
            commands::control_plane::issue_relay_lease_command,
            commands::control_plane::issue_ssh_certificate_command,
            commands::filesystem::list_local_directory_command,
            commands::filesystem::list_remote_directory_command,
            commands::history::list_recent_connections_command,
            commands::history::record_recent_connection_command,
            commands::host::probe_ssh_host_key_command,
            commands::import::inspect_imported_credential_command,
            commands::session::open_session,
            commands::session::send_input,
            commands::session::resize_session,
            commands::session::close_session,
            commands::storage::load_app_data_command,
            commands::storage::save_keychain_entries_command,
            commands::storage::save_snippets_command,
            commands::storage::save_port_forwards_command,
            commands::storage::list_activity_logs_command,
            commands::storage::clear_activity_logs_command,
            commands::vault::encrypt_secret,
            commands::vault::save_local_vault,
            commands::vault::load_local_vault,
            commands::vault::rotate_local_vault_password,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
