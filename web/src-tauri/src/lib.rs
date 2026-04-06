mod config;
mod sidecar;

use config::AppConfig;
use sidecar::SidecarManager;
use std::sync::Arc;
use tauri::{Listener, Manager};
use tokio::sync::Mutex;

#[tauri::command]
async fn get_sidecar_status(
    state: tauri::State<'_, Arc<Mutex<SidecarManager>>>,
) -> Result<String, String> {
    let _manager = state.lock().await;
    Ok("running".to_string())
}

/// Return the configured frontend URL so the webview JS can use it.
#[tauri::command]
fn get_frontend_url() -> String {
    AppConfig::from_env().frontend_url()
}

/// Open a URL in the system browser. Called from the webview JS
/// when __TAURI_INTERNALS__ is not available (localhost origin).
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))
}

pub fn run() {
    env_logger::init();

    let cfg = AppConfig::from_env();
    let frontend_url = cfg.frontend_url();
    let frontend_port = cfg.frontend_port;
    let backend_port = cfg.backend_port;
    let project_dir = cfg.project_dir.clone();

    let sidecar = Arc::new(Mutex::new(SidecarManager::new()));
    let sidecar_for_setup = Arc::clone(&sidecar);
    let sidecar_for_events = Arc::clone(&sidecar);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(sidecar)
        .invoke_handler(tauri::generate_handler![
            get_sidecar_status,
            get_frontend_url,
            open_url,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let deep_link_handle = app.handle().clone();
            let deep_link_url = frontend_url.clone();

            // Handle deep link callbacks (e.g. synapse://auth/callback)
            app.listen("deep-link://new-url", move |_event: tauri::Event| {
                log::info!("Deep link received, reloading webview");
                if let Some(window) = deep_link_handle.get_webview_window("main") {
                    let redirect = format!(
                        "window.location.href = '{deep_link_url}/?desktop=1'"
                    );
                    let _ = window.eval(&redirect);
                }
            });

            // Spawn sidecar startup in background
            tauri::async_runtime::spawn(async move {
                let mut manager = sidecar_for_setup.lock().await;

                if !SidecarManager::is_port_in_use(backend_port).await {
                    if let Err(e) = manager.start_backend(&project_dir, backend_port).await {
                        log::error!("Backend startup failed: {e}");
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.eval(&format!(
                                "console.error('Backend startup failed: {}')",
                                e.replace('\'', "\\'")
                            ));
                        }
                    }
                } else {
                    log::info!("Port {backend_port} already in use, skipping backend startup");
                }

                if !SidecarManager::is_port_in_use(frontend_port).await {
                    if let Err(e) = manager.start_frontend(&project_dir, frontend_port).await {
                        log::error!("Frontend startup failed: {e}");
                    }
                } else {
                    log::info!("Port {frontend_port} already in use, skipping frontend startup");
                }
            });

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sidecar_ref = Arc::clone(&sidecar_for_events);
                tauri::async_runtime::block_on(async {
                    let mut manager = sidecar_ref.lock().await;
                    manager.shutdown().await;
                });
                log::info!("Window destroyed, sidecars shut down");
                let _ = window.app_handle();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Synapse Desktop");
}
