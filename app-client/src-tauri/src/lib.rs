pub mod app_state;
pub mod collab;
pub mod commands;
pub mod core;
pub mod crypto;
pub mod tunnel;

pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::session::open_session,
            commands::session::send_input,
            commands::session::resize_session,
            commands::session::close_session,
            commands::vault::encrypt_secret,
            commands::vault::save_local_vault,
            commands::vault::load_local_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
