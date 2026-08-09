use windows::core::HSTRING;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

use super::{
    ClipboardFormatEvidence, ClipboardFormatFailure, ClipboardPayload, ClipboardWriteReport,
    FORMAT_HTML, FORMAT_PNG, FORMAT_TEXT,
};

struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

fn html_clipboard_payload(fragment: &[u8]) -> Vec<u8> {
    let fragment = String::from_utf8_lossy(fragment);
    let body =
        format!("<html><body><!--StartFragment-->{fragment}<!--EndFragment--></body></html>");
    let placeholder = concat!(
        "Version:0.9\r\n",
        "StartHTML:0000000000\r\n",
        "EndHTML:0000000000\r\n",
        "StartFragment:0000000000\r\n",
        "EndFragment:0000000000\r\n"
    );
    let start_html = placeholder.len();
    let start_marker = "<!--StartFragment-->";
    let end_marker = "<!--EndFragment-->";
    let start_fragment = start_html + body.find(start_marker).unwrap_or(0) + start_marker.len();
    let end_fragment = start_html + body.find(end_marker).unwrap_or(body.len());
    let end_html = start_html + body.len();
    format!(
        concat!(
            "Version:0.9\r\n",
            "StartHTML:{:010}\r\n",
            "EndHTML:{:010}\r\n",
            "StartFragment:{:010}\r\n",
            "EndFragment:{:010}\r\n",
            "{}"
        ),
        start_html, end_html, start_fragment, end_fragment, body
    )
    .into_bytes()
}

unsafe fn set_global_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
    let allocation = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).map_err(|e| e.to_string())?;
    let pointer = GlobalLock(allocation);
    if pointer.is_null() {
        let _ = GlobalFree(allocation);
        return Err("GlobalLock returned null".to_string());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
    let _ = GlobalUnlock(allocation);
    match SetClipboardData(format, HANDLE(allocation.0)) {
        Ok(_) => Ok(()),
        Err(error) => {
            let _ = GlobalFree(HGLOBAL(allocation.0));
            Err(error.to_string())
        }
    }
}

fn format_id(format: &str) -> Result<(u32, String), String> {
    if format == FORMAT_TEXT {
        return Ok((13, "CF_UNICODETEXT".to_string()));
    }
    let native_name = if format == FORMAT_HTML {
        "HTML Format"
    } else if format == FORMAT_PNG {
        "PNG"
    } else {
        format
    };
    let id = unsafe { RegisterClipboardFormatW(&HSTRING::from(native_name)) };
    if id == 0 {
        Err(format!("RegisterClipboardFormatW failed for {native_name}"))
    } else {
        Ok((id, native_name.to_string()))
    }
}

fn native_bytes(payload: &ClipboardPayload) -> Vec<u8> {
    if payload.format == FORMAT_TEXT {
        let text = String::from_utf8_lossy(&payload.bytes);
        text.encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect()
    } else if payload.format == FORMAT_HTML {
        html_clipboard_payload(&payload.bytes)
    } else {
        payload.bytes.clone()
    }
}

pub(super) fn write_payloads(payloads: &[ClipboardPayload]) -> ClipboardWriteReport {
    let mut report = ClipboardWriteReport {
        backend: "windows-win32-multiformat".to_string(),
        ..Default::default()
    };
    let opened = unsafe { OpenClipboard(HWND::default()) };
    if let Err(error) = opened {
        report.failed_formats.push(ClipboardFormatFailure {
            format: "*".to_string(),
            code: "CLIPBOARD_WRITE_FAILED".to_string(),
            message: error.to_string(),
        });
        return report;
    }
    let _guard = ClipboardGuard;
    if let Err(error) = unsafe { EmptyClipboard() } {
        report.failed_formats.push(ClipboardFormatFailure {
            format: "*".to_string(),
            code: "CLIPBOARD_WRITE_FAILED".to_string(),
            message: error.to_string(),
        });
        return report;
    }

    for payload in payloads {
        let (id, native_format) = match format_id(payload.format) {
            Ok(value) => value,
            Err(message) => {
                report.failed_formats.push(ClipboardFormatFailure {
                    format: payload.format.to_string(),
                    code: "CLIPBOARD_FORMAT_UNSUPPORTED".to_string(),
                    message,
                });
                continue;
            }
        };
        let bytes = native_bytes(payload);
        match unsafe { set_global_bytes(id, &bytes) } {
            Ok(()) => report.written_formats.push(ClipboardFormatEvidence {
                format: payload.format.to_string(),
                bytes: payload.bytes.len() as u64,
                native_format,
            }),
            Err(message) => report.failed_formats.push(ClipboardFormatFailure {
                format: payload.format.to_string(),
                code: "CLIPBOARD_WRITE_FAILED".to_string(),
                message,
            }),
        }
    }
    report.clipboard_sequence = Some(unsafe { GetClipboardSequenceNumber() } as u64);
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_offsets_point_to_fragment() {
        let payload = html_clipboard_payload(b"<b>x</b>");
        let text = String::from_utf8(payload).unwrap();
        let start: usize = text
            .lines()
            .find_map(|line| line.strip_prefix("StartFragment:"))
            .unwrap()
            .parse()
            .unwrap();
        let end: usize = text
            .lines()
            .find_map(|line| line.strip_prefix("EndFragment:"))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(&text[start..end], "<b>x</b>");
    }

    #[test]
    #[ignore = "writes the real Windows clipboard"]
    fn real_clipboard_accepts_text_and_custom_format() {
        let report = write_payloads(&[
            ClipboardPayload {
                format: FORMAT_TEXT,
                bytes: b"LaTeXSnipper clipboard probe".to_vec(),
            },
            ClipboardPayload {
                format: super::super::FORMAT_FORMULA_JSON,
                bytes: br#"{"schemaVersion":1}"#.to_vec(),
            },
        ]);
        assert!(report.success || !report.written_formats.is_empty());
        assert_eq!(report.written_formats.len(), 2);
        assert!(report.clipboard_sequence.is_some());
    }
}
