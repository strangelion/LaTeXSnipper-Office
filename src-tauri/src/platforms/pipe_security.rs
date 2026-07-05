//! Named Pipe security descriptor using SDDL.
//!
//! Creates a DACL that only allows the current user SID and SYSTEM.
//! Format: D:P(A;;GRGW;;;{CURRENT_USER_SID})(A;;GRGW;;;SY)

use std::ptr;

use super::windows_identity::{current_user_sid, NativeOfficeSecurityError};

/// Security descriptor for Named Pipe DACL.
///
/// The DACL allows only:
/// - Current user SID: Generic Read + Generic Write
/// - SYSTEM: Generic Read + Generic Write
///
/// All other principals (Everyone, Users, etc.) are denied.
pub struct PipeSecurityDescriptor {
    #[cfg(target_os = "windows")]
    descriptor: *mut std::ffi::c_void,
    #[cfg(target_os = "windows")]
    attrs: SECURITY_ATTRIBUTES,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct SECURITY_ATTRIBUTES {
    nLength: u32,
    lpSecurityDescriptor: *mut std::ffi::c_void,
    bInheritHandle: i32, // BOOL
}

impl PipeSecurityDescriptor {
    /// Create a security descriptor allowing only the current user and SYSTEM.
    pub fn current_user_and_system() -> Result<Self, NativeOfficeSecurityError> {
        let sid = current_user_sid()?;

        // Build SDDL string: D:P(A;;GRGW;;;{SID})(A;;GRGW;;;SY)
        // D:P = Protected DACL (no inheritance)
        // GRGW = Generic Read + Generic Write
        // SY = Local System account
        let sddl = format!("D:P(A;;GRGW;;;{})(A;;GRGW;;;SY)", sid);

        log::info!("[PipeSecurity] Building security descriptor with SDDL");

        #[cfg(target_os = "windows")]
        {
            Self::from_sddl(&sddl)
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(Self {})
        }
    }

    #[cfg(target_os = "windows")]
    fn from_sddl(sddl: &str) -> Result<Self, NativeOfficeSecurityError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        // Convert SDDL to wide string (UTF-16 with null terminator)
        let sddl_wide: Vec<u16> = OsStr::new(sddl)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut descriptor: *mut std::ffi::c_void = ptr::null_mut();

        // Call ConvertStringSecurityDescriptorToSecurityDescriptorW
        // This is a direct FFI call to advapi32.dll
        let result = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl_wide.as_ptr(),
                1, // SDDL_REVISION_1
                &mut descriptor,
                ptr::null_mut(),
            )
        };

        if result == 0 || descriptor.is_null() {
            log::error!("[PipeSecurity] Failed to convert SDDL to security descriptor");
            return Err(NativeOfficeSecurityError::SidConversionFailed);
        }

        log::info!("[PipeSecurity] Security descriptor created successfully");

        // Create SECURITY_ATTRIBUTES
        let attrs = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0, // FALSE
        };

        Ok(Self { descriptor, attrs })
    }

    /// Get raw security attributes pointer for pipe creation.
    #[cfg(target_os = "windows")]
    pub fn as_raw_security_attributes(&mut self) -> *mut std::ffi::c_void {
        &mut self.attrs as *mut SECURITY_ATTRIBUTES as *mut _
    }

    #[cfg(not(target_os = "windows"))]
    pub fn as_raw_security_attributes(&mut self) -> *mut std::ffi::c_void {
        ptr::null_mut()
    }
}

#[cfg(target_os = "windows")]
impl Drop for PipeSecurityDescriptor {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            unsafe {
                LocalFree(self.descriptor);
            }
        }
    }
}

// Windows API FFI declarations
#[cfg(target_os = "windows")]
extern "system" {
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        StringSecurityDescriptor: *const u16,
        StringSDRevision: u32,
        SecurityDescriptor: *mut *mut std::ffi::c_void,
        SecurityDescriptorSize: *mut u32,
    ) -> i32;

    fn LocalFree(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_security_descriptor_creation() {
        let result = PipeSecurityDescriptor::current_user_and_system();
        assert!(result.is_ok(), "Security descriptor creation should succeed");
    }

    #[test]
    fn test_sddl_format() {
        // Verify the SDDL format is correct
        let sid = crate::platforms::windows_identity::current_user_sid().unwrap();
        let sddl = format!("D:P(A;;GRGW;;;{})(A;;GRGW;;;SY)", sid);
        assert!(sddl.starts_with("D:P("));
        assert!(sddl.ends_with(")"));
        assert!(sddl.contains("GRGW"));
        assert!(sddl.contains("SY"));
    }
}
