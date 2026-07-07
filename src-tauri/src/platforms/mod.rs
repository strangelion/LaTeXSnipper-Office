#[cfg(target_os = "windows")]
pub mod acl;
pub mod handshake;
pub mod integrations;
pub mod office;
pub mod office_bridge;
#[cfg(target_os = "windows")]
pub mod ole_edit;
#[cfg(target_os = "windows")]
pub mod pipe_protocol;
#[cfg(target_os = "windows")]
pub mod pipe_security;
#[cfg(target_os = "windows")]
pub mod pipe_server;
pub mod process;
#[cfg(target_os = "windows")]
pub mod session;
pub mod tls_cert;
#[cfg(target_os = "windows")]
pub mod windows_identity;

#[cfg(test)]
mod tests;
