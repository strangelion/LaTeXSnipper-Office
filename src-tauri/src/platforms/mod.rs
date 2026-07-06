pub mod acl;
pub mod handshake;
pub mod integrations;
pub mod office;
#[cfg(target_os = "windows")]
pub mod pipe_protocol;
#[cfg(target_os = "windows")]
pub mod pipe_security;
#[cfg(target_os = "windows")]
pub mod pipe_server;
pub mod process;
pub mod session;
pub mod tls_cert;
pub mod windows_identity;

#[cfg(test)]
mod tests;
