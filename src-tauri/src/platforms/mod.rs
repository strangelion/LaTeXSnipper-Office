#[cfg(target_os = "windows")]
pub mod acl;
pub mod conversation_import;
pub mod ecosystem;
#[cfg(target_os = "windows")]
pub mod handshake;
pub mod integrations;
pub mod office;
pub mod office_bridge;
pub mod office_transactions;
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

#[cfg(all(test, target_os = "windows"))]
mod tests;
