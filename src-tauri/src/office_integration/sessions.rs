//! Office session routing helpers.
//!
//! Provides convenience functions for routing commands to the correct
//! VSTO session based on host type and optional session preference.

#[cfg(target_os = "windows")]
use crate::office_integration::dto::OfficeHost;

#[cfg(target_os = "windows")]
use crate::platforms::session::HostType;

#[cfg(target_os = "windows")]
impl From<OfficeHost> for HostType {
    fn from(host: OfficeHost) -> Self {
        match host {
            OfficeHost::Word => HostType::Word,
            OfficeHost::Excel => HostType::Excel,
            OfficeHost::PowerPoint => HostType::PowerPoint,
            OfficeHost::Visio => HostType::Visio,
        }
    }
}
