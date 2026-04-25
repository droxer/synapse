mod config;
mod sidecar;

use config::{AppConfig, DesktopMode};
use serde::Serialize;
use sidecar::{ServiceKind, SidecarManager};
use std::sync::Arc;
use tauri::{Listener, Manager};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapInfo {
    frontend_url: Option<String>,
    boot_error: Option<String>,
    ready: bool,
}

#[tauri::command]
async fn get_sidecar_status(
    state: tauri::State<'_, Arc<Mutex<SidecarManager>>>,
) -> Result<String, String> {
    let _manager = state.lock().await;
    Ok("running".to_string())
}

/// Return the desktop bootstrap state for the static loading page.
#[tauri::command]
async fn get_bootstrap_info(
    state: tauri::State<'_, Arc<Mutex<BootstrapInfo>>>,
) -> Result<BootstrapInfo, String> {
    Ok(state.lock().await.clone())
}

/// Return the configured frontend URL so the webview JS can use it.
#[tauri::command]
async fn get_frontend_url(
    state: tauri::State<'_, Arc<Mutex<BootstrapInfo>>>,
) -> Result<String, String> {
    let state = state.lock().await;
    if let Some(url) = &state.frontend_url {
        return Ok(url.clone());
    }

    Err(state
        .boot_error
        .clone()
        .unwrap_or_else(|| "Desktop frontend URL is not available".to_string()))
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
    let bootstrap_info = Arc::new(Mutex::new(match &cfg {
        Ok(cfg) => BootstrapInfo {
            frontend_url: Some(cfg.frontend_url.clone()),
            boot_error: None,
            ready: false,
        },
        Err(err) => BootstrapInfo {
            frontend_url: None,
            boot_error: Some(err.clone()),
            ready: false,
        },
    }));

    let sidecar = Arc::new(Mutex::new(SidecarManager::new()));
    let sidecar_for_setup = Arc::clone(&sidecar);
    let sidecar_for_events = Arc::clone(&sidecar);
    let bootstrap_for_setup = Arc::clone(&bootstrap_info);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(sidecar)
        .manage(bootstrap_info)
        .invoke_handler(tauri::generate_handler![
            get_sidecar_status,
            get_bootstrap_info,
            get_frontend_url,
            open_url,
        ])
        .setup(move |app| {
            if cfg.is_ok() {
                let deep_link_handle = app.handle().clone();

                // Handle deep link callbacks (e.g. synapse://auth/callback)
                app.listen("deep-link://new-url", move |_event: tauri::Event| {
                    log::info!("Deep link received, focusing webview");
                    if let Some(window) = deep_link_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            let handle = app.handle().clone();
            let cfg_for_setup = cfg.clone();

            tauri::async_runtime::spawn(async move {
                let outcome = match cfg_for_setup {
                    Ok(cfg) => {
                        let mut manager = sidecar_for_setup.lock().await;
                        bootstrap_application(&cfg, &mut manager)
                            .await
                            .map(|()| cfg.frontend_url)
                    }
                    Err(err) => Err(err),
                };

                let mut bootstrap = bootstrap_for_setup.lock().await;
                match outcome {
                    Ok(frontend_url) => {
                        bootstrap.ready = true;
                        if let Some(window) = handle.get_webview_window("main") {
                            let redirect_url =
                                format!("{}/?desktop=1", frontend_url.trim_end_matches('/'));
                            let redirect_json = serde_json::to_string(&redirect_url)
                                .unwrap_or_else(|_| "\"/\"".to_string());
                            let _ =
                                window.eval(&format!("window.location.href = {redirect_json};"));
                        }
                    }
                    Err(err) => {
                        log::error!("Desktop bootstrap failed: {err}");
                        bootstrap.boot_error = Some(err.clone());
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.eval(&format!(
                                "console.error('Desktop bootstrap failed: {}')",
                                err.replace('\'', "\\'")
                            ));
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sidecar_ref = Arc::clone(&sidecar_for_events);
                tauri::async_runtime::block_on(async {
                    let mut manager = sidecar_ref.lock().await;
                    manager.shutdown().await;
                });
                log::info!("Window destroyed, sidecars shut down");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Synapse Desktop");
}

async fn bootstrap_application(
    cfg: &AppConfig,
    manager: &mut SidecarManager,
) -> Result<(), String> {
    ensure_backend_ready(cfg, manager).await?;
    ensure_frontend_ready(cfg, manager).await?;
    Ok(())
}

async fn ensure_backend_ready(cfg: &AppConfig, manager: &mut SidecarManager) -> Result<(), String> {
    ensure_service_ready(cfg, manager, ServiceKind::Backend).await
}

async fn ensure_frontend_ready(
    cfg: &AppConfig,
    manager: &mut SidecarManager,
) -> Result<(), String> {
    ensure_service_ready(cfg, manager, ServiceKind::Frontend).await
}

async fn ensure_service_ready(
    cfg: &AppConfig,
    manager: &mut SidecarManager,
    kind: ServiceKind,
) -> Result<(), String> {
    let (base_url, port) = match kind {
        ServiceKind::Frontend => (&cfg.frontend_url, cfg.frontend_port),
        ServiceKind::Backend => (&cfg.backend_url, cfg.backend_port),
    };

    if SidecarManager::probe_service(base_url, kind).await.is_ok() {
        log::info!("Reusing healthy {} at {}", kind.label(), base_url);
        return Ok(());
    }

    if cfg.mode == DesktopMode::Release {
        return Err(format!(
            "Configured {} at {} is unavailable or is not a Synapse {}. Set {} to a healthy Synapse service.",
            kind.label(),
            base_url,
            kind.label(),
            release_env_name(kind)
        ));
    }

    let port = port.ok_or_else(|| format!("Missing {} port in dev mode", kind.label()))?;
    if SidecarManager::is_port_in_use(port).await {
        return Err(format!(
            "Configured {} port {} is already in use, but {} did not pass Synapse health checks. Refusing to attach to a non-Synapse service.",
            kind.label(),
            port,
            base_url
        ));
    }

    let project_dir = cfg
        .project_dir
        .as_deref()
        .ok_or_else(|| "Missing project directory in dev mode".to_string())?;

    match kind {
        ServiceKind::Frontend => manager.start_frontend(project_dir, port, base_url).await,
        ServiceKind::Backend => manager.start_backend(project_dir, port, base_url).await,
    }
}

fn release_env_name(kind: ServiceKind) -> &'static str {
    match kind {
        ServiceKind::Frontend => "SYNAPSE_FRONTEND_URL",
        ServiceKind::Backend => "SYNAPSE_BACKEND_URL",
    }
}
