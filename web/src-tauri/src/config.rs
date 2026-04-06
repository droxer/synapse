/// App configuration resolved from environment variables with sensible defaults.
///
/// Env vars:
///   SYNAPSE_FRONTEND_PORT  — port for the Next.js frontend  (default: 3000)
///   SYNAPSE_BACKEND_PORT   — port for the Python backend     (default: 8000)
///   SYNAPSE_PROJECT_DIR    — path to the Synapse project root
pub struct AppConfig {
    pub frontend_port: u16,
    pub backend_port: u16,
    pub project_dir: std::path::PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let frontend_port = std::env::var("SYNAPSE_FRONTEND_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3000);

        let backend_port = std::env::var("SYNAPSE_BACKEND_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8000);

        let project_dir = if let Ok(dir) = std::env::var("SYNAPSE_PROJECT_DIR") {
            std::path::PathBuf::from(dir)
        } else {
            // Default: repo root is two levels up from src-tauri/
            let manifest_dir = env!("CARGO_MANIFEST_DIR");
            std::path::PathBuf::from(manifest_dir)
                .parent() // web/
                .and_then(|p| p.parent()) // project root
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::path::PathBuf::from("."))
        };

        Self {
            frontend_port,
            backend_port,
            project_dir,
        }
    }

    pub fn frontend_url(&self) -> String {
        format!("http://localhost:{}", self.frontend_port)
    }

    #[allow(dead_code)]
    pub fn backend_url(&self) -> String {
        format!("http://localhost:{}", self.backend_port)
    }
}
