use reqwest::StatusCode;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::time::sleep;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceKind {
    Frontend,
    Backend,
}

impl ServiceKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Frontend => "frontend",
            Self::Backend => "backend",
        }
    }

    fn expected_service(self) -> &'static str {
        match self {
            Self::Frontend => "synapse-web",
            Self::Backend => "synapse-api",
        }
    }

    fn health_path(self) -> &'static str {
        match self {
            Self::Frontend => "/api/desktop/health",
            Self::Backend => "/health",
        }
    }
}

/// Manages the lifecycle of backend and frontend sidecar processes.
pub struct SidecarManager {
    backend: Option<Child>,
    frontend: Option<Child>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            backend: None,
            frontend: None,
        }
    }

    /// Start the Python FastAPI backend.
    pub async fn start_backend(
        &mut self,
        project_dir: &Path,
        port: u16,
        backend_url: &str,
    ) -> Result<(), String> {
        let backend_dir = project_dir.join("backend");
        log::info!("Starting backend in {:?} on port {port}", backend_dir);

        let child = Command::new("uv")
            .args(["run", "python", "-m", "api.main"])
            .env("PORT", port.to_string())
            .current_dir(&backend_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start backend: {e}"))?;

        self.backend = Some(child);
        self.wait_healthy(backend_url, ServiceKind::Backend, Duration::from_secs(30))
            .await?;
        log::info!("Backend is healthy at {backend_url}");
        Ok(())
    }

    /// Start the Next.js frontend.
    pub async fn start_frontend(
        &mut self,
        project_dir: &Path,
        port: u16,
        frontend_url: &str,
    ) -> Result<(), String> {
        let web_dir = project_dir.join("web");
        log::info!("Starting frontend in {:?} on port {port}", web_dir);

        let child = Command::new("npm")
            .args(["run", "dev", "--", "--port", &port.to_string()])
            .current_dir(&web_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start frontend: {e}"))?;

        self.frontend = Some(child);
        self.wait_healthy(frontend_url, ServiceKind::Frontend, Duration::from_secs(30))
            .await?;
        log::info!("Frontend is healthy at {frontend_url}");
        Ok(())
    }

    pub async fn probe_service(base_url: &str, kind: ServiceKind) -> Result<(), String> {
        let url = health_url(base_url, kind);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|err| format!("Could not reach {} at {}: {}", kind.label(), url, err))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("Failed to read {} health response: {}", kind.label(), err))?;

        validate_health_response(status, &body, kind).map_err(|err| {
            format!(
                "{} at {} failed health verification: {}",
                kind.label(),
                url,
                err
            )
        })
    }

    /// Poll a service-specific health endpoint until it responds with the
    /// expected Synapse identity, or time out.
    async fn wait_healthy(
        &self,
        base_url: &str,
        kind: ServiceKind,
        timeout: Duration,
    ) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + timeout;
        let mut last_error = format!("{} has not reported healthy yet", kind.label());

        loop {
            if tokio::time::Instant::now() > deadline {
                return Err(format!(
                    "Timed out waiting for {} at {} after {:?}: {}",
                    kind.label(),
                    base_url,
                    timeout,
                    last_error
                ));
            }

            match Self::probe_service(base_url, kind).await {
                Ok(()) => return Ok(()),
                Err(err) => {
                    last_error = err;
                    sleep(Duration::from_millis(500)).await;
                }
            }
        }
    }

    /// Check whether a port is already in use.
    pub async fn is_port_in_use(port: u16) -> bool {
        tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .is_ok()
    }

    /// Gracefully shut down all sidecar processes.
    pub async fn shutdown(&mut self) {
        if let Some(ref mut child) = self.frontend {
            log::info!("Shutting down frontend");
            let _ = child.kill().await;
        }
        self.frontend = None;

        if let Some(ref mut child) = self.backend {
            log::info!("Shutting down backend");
            let _ = child.kill().await;
        }
        self.backend = None;
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.frontend {
            let _ = child.start_kill();
        }
        if let Some(ref mut child) = self.backend {
            let _ = child.start_kill();
        }
    }
}

pub fn health_url(base_url: &str, kind: ServiceKind) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), kind.health_path())
}

fn validate_health_response(
    status: StatusCode,
    body: &str,
    kind: ServiceKind,
) -> Result<(), String> {
    if status != StatusCode::OK {
        return Err(format!("expected HTTP 200, got {}", status.as_u16()));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|err| format!("invalid JSON payload: {err}"))?;

    let service = parsed
        .get("service")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "missing string field `service`".to_string())?;

    if service != kind.expected_service() {
        return Err(format!(
            "expected service `{}`, got `{service}`",
            kind.expected_service()
        ));
    }

    let status_value = parsed
        .get("status")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "missing string field `status`".to_string())?;

    if status_value != "healthy" {
        return Err(format!("expected status `healthy`, got `{status_value}`"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_health_response, ServiceKind};
    use reqwest::StatusCode;

    #[test]
    fn accepts_expected_synapse_health_payload() {
        let result = validate_health_response(
            StatusCode::OK,
            r#"{"status":"healthy","service":"synapse-web"}"#,
            ServiceKind::Frontend,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn rejects_wrong_service_identity() {
        let result = validate_health_response(
            StatusCode::OK,
            r#"{"status":"healthy","service":"not-synapse"}"#,
            ServiceKind::Backend,
        );

        assert!(result
            .expect_err("expected wrong service error")
            .contains("expected service `synapse-api`"));
    }

    #[test]
    fn rejects_malformed_health_payload() {
        let result = validate_health_response(
            StatusCode::OK,
            r#"{"status":"healthy"}"#,
            ServiceKind::Frontend,
        );

        assert!(result
            .expect_err("expected missing service error")
            .contains("missing string field `service`"));
    }
}
