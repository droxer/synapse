use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopMode {
    Dev,
    Release,
}

impl DesktopMode {
    pub const fn current() -> Self {
        if cfg!(debug_assertions) {
            Self::Dev
        } else {
            Self::Release
        }
    }
}

/// App configuration resolved from environment variables.
///
/// Dev mode:
///   SYNAPSE_FRONTEND_PORT  — port for the Next.js frontend  (default: 3000)
///   SYNAPSE_BACKEND_PORT   — port for the Python backend     (default: 8000)
///   SYNAPSE_PROJECT_DIR    — path to the Synapse project root
///
/// Release mode:
///   SYNAPSE_FRONTEND_URL   — required frontend URL for the hosted Synapse web app
///   SYNAPSE_BACKEND_URL    — required backend URL for the hosted Synapse API
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppConfig {
    pub mode: DesktopMode,
    pub frontend_url: String,
    pub backend_url: String,
    pub frontend_port: Option<u16>,
    pub backend_port: Option<u16>,
    pub project_dir: Option<PathBuf>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        Self::from_env_for_mode(DesktopMode::current())
    }

    pub fn from_env_for_mode(mode: DesktopMode) -> Result<Self, String> {
        match mode {
            DesktopMode::Dev => Ok(Self::from_dev_env()),
            DesktopMode::Release => Self::from_release_env(),
        }
    }

    fn from_dev_env() -> Self {
        let frontend_port = parse_port("SYNAPSE_FRONTEND_PORT", 3000);
        let backend_port = parse_port("SYNAPSE_BACKEND_PORT", 8000);

        let project_dir = if let Ok(dir) = std::env::var("SYNAPSE_PROJECT_DIR") {
            PathBuf::from(dir)
        } else {
            // Default: repo root is two levels up from src-tauri/
            let manifest_dir = env!("CARGO_MANIFEST_DIR");
            PathBuf::from(manifest_dir)
                .parent() // web/
                .and_then(|p| p.parent()) // project root
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."))
        };

        Self {
            mode: DesktopMode::Dev,
            frontend_url: format!("http://localhost:{frontend_port}"),
            backend_url: format!("http://localhost:{backend_port}"),
            frontend_port: Some(frontend_port),
            backend_port: Some(backend_port),
            project_dir: Some(project_dir),
        }
    }

    fn from_release_env() -> Result<Self, String> {
        let frontend_url = required_url("SYNAPSE_FRONTEND_URL")?;
        let backend_url = required_url("SYNAPSE_BACKEND_URL")?;

        Ok(Self {
            mode: DesktopMode::Release,
            frontend_url,
            backend_url,
            frontend_port: None,
            backend_port: None,
            project_dir: None,
        })
    }
}

fn parse_port(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn required_url(name: &str) -> Result<String, String> {
    let value = std::env::var(name)
        .map_err(|_| format!("Missing required desktop environment variable: {name}"))?;
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err(format!(
            "Missing required desktop environment variable: {name}"
        ));
    }
    reqwest::Url::parse(&trimmed)
        .map_err(|err| format!("Invalid URL for {name}: {err}"))?;
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, DesktopMode};
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn snapshot_env(name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn restore_env(name: &str, value: Option<String>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    #[test]
    fn dev_mode_uses_port_defaults_and_repo_root() {
        let _guard = env_lock().lock().expect("env lock");
        let frontend_port = snapshot_env("SYNAPSE_FRONTEND_PORT");
        let backend_port = snapshot_env("SYNAPSE_BACKEND_PORT");
        let project_dir = snapshot_env("SYNAPSE_PROJECT_DIR");
        std::env::remove_var("SYNAPSE_FRONTEND_PORT");
        std::env::remove_var("SYNAPSE_BACKEND_PORT");
        std::env::remove_var("SYNAPSE_PROJECT_DIR");

        let cfg = AppConfig::from_env_for_mode(DesktopMode::Dev).expect("dev config");

        assert_eq!(cfg.mode, DesktopMode::Dev);
        assert_eq!(cfg.frontend_url, "http://localhost:3000");
        assert_eq!(cfg.backend_url, "http://localhost:8000");
        assert_eq!(cfg.frontend_port, Some(3000));
        assert_eq!(cfg.backend_port, Some(8000));
        assert!(cfg
            .project_dir
            .as_ref()
            .expect("project dir")
            .ends_with("Synapse"));

        restore_env("SYNAPSE_FRONTEND_PORT", frontend_port);
        restore_env("SYNAPSE_BACKEND_PORT", backend_port);
        restore_env("SYNAPSE_PROJECT_DIR", project_dir);
    }

    #[test]
    fn release_mode_requires_explicit_service_urls() {
        let _guard = env_lock().lock().expect("env lock");
        let frontend_url = snapshot_env("SYNAPSE_FRONTEND_URL");
        let backend_url = snapshot_env("SYNAPSE_BACKEND_URL");
        std::env::remove_var("SYNAPSE_FRONTEND_URL");
        std::env::remove_var("SYNAPSE_BACKEND_URL");

        let err = AppConfig::from_env_for_mode(DesktopMode::Release)
            .expect_err("release config should fail");

        assert!(err.contains("SYNAPSE_FRONTEND_URL"));

        restore_env("SYNAPSE_FRONTEND_URL", frontend_url);
        restore_env("SYNAPSE_BACKEND_URL", backend_url);
    }
}
