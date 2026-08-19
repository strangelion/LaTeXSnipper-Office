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

const CF_DIB: u32 = 8; // Predefined Win32 clipboard format.
const CF_DIBV5: u32 = 17; // Predefined Win32 clipboard format.
const MAX_DIB_DIMENSION: i32 = 0x4000;

struct DibData {
    dibv5: Vec<u8>,
    dib: Vec<u8>,
}

fn dib_from_png(png_bytes: &[u8]) -> Option<DibData> {
    let image = image::load_from_memory(png_bytes).ok()?;
    let rgba = image.to_rgba8();
    let width = rgba.width() as i32;
    let height = rgba.height() as i32;
    if width <= 0 || height <= 0 || width > MAX_DIB_DIMENSION || height > MAX_DIB_DIMENSION {
        return None;
    }
    let row_bytes = width as usize * 4;
    let pixel_bytes = row_bytes * height as usize;
    let mut bgra = Vec::with_capacity(pixel_bytes);
    for pixel in rgba.pixels() {
        bgra.extend_from_slice(&[pixel.0[2], pixel.0[1], pixel.0[0], pixel.0[3]]);
    }
    Some(DibData {
        dibv5: build_dibv5(width, height, pixel_bytes, &bgra),
        dib: build_dib(width, height, pixel_bytes, &bgra),
    })
}

// BITMAPV5HEADER (124 bytes) with a top-down 32bpp BGRA pixel array and
// BI_BITFIELDS masks, so alpha survives Word/PowerPoint paste.
fn build_dibv5(width: i32, height: i32, pixel_bytes: usize, bgra: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(124 + pixel_bytes);
    header.extend((124u32).to_le_bytes()); // biSize
    header.extend(width.to_le_bytes()); // biWidth
    header.extend((-height).to_le_bytes()); // biHeight, top-down
    header.extend((1u16).to_le_bytes()); // biPlanes
    header.extend((32u16).to_le_bytes()); // biBitCount
    header.extend((3u32).to_le_bytes()); // biCompression = BI_BITFIELDS
    header.extend((pixel_bytes as u32).to_le_bytes()); // biSizeImage
    header.extend((0i32).to_le_bytes()); // biXPelsPerMeter
    header.extend((0i32).to_le_bytes()); // biYPelsPerMeter
    header.extend((0u32).to_le_bytes()); // biClrUsed
    header.extend((0u32).to_le_bytes()); // biClrImportant
    header.extend(0x00FF0000u32.to_le_bytes()); // biRedMask
    header.extend(0x0000FF00u32.to_le_bytes()); // biGreenMask
    header.extend(0x000000FFu32.to_le_bytes()); // biBlueMask
    header.extend(0xFF000000u32.to_le_bytes()); // biAlphaMask
    header.extend(0x73524742u32.to_le_bytes()); // biCSType = sRGB
    header.extend([0u8; 36]); // biEndpoints (CIEXYZTRIPLE)
    header.extend([0u8; 12]); // biGammaRed/Green/Blue
    header.extend((0u32).to_le_bytes()); // biIntent
    header.extend((0u32).to_le_bytes()); // biProfileData
    header.extend((0u32).to_le_bytes()); // biProfileSize
    header.extend((0u32).to_le_bytes()); // biReserved
    debug_assert_eq!(header.len(), 124);
    header.extend_from_slice(bgra);
    header
}

// BITMAPINFOHEADER (40 bytes) + BI_BITFIELDS masks (12 bytes) + pixels,
// for classic editors that only understand CF_DIB.
fn build_dib(width: i32, height: i32, pixel_bytes: usize, bgra: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(40 + 12 + pixel_bytes);
    header.extend((40u32).to_le_bytes()); // biSize
    header.extend(width.to_le_bytes()); // biWidth
    header.extend((-height).to_le_bytes()); // biHeight, top-down
    header.extend((1u16).to_le_bytes()); // biPlanes
    header.extend((32u16).to_le_bytes()); // biBitCount
    header.extend((3u32).to_le_bytes()); // biCompression = BI_BITFIELDS
    header.extend((pixel_bytes as u32).to_le_bytes()); // biSizeImage
    header.extend((0i32).to_le_bytes()); // biXPelsPerMeter
    header.extend((0i32).to_le_bytes()); // biYPelsPerMeter
    header.extend((0u32).to_le_bytes()); // biClrUsed
    header.extend((0u32).to_le_bytes()); // biClrImportant
    header.extend(0x00FF0000u32.to_le_bytes()); // red mask
    header.extend(0x0000FF00u32.to_le_bytes()); // green mask
    header.extend(0x000000FFu32.to_le_bytes()); // blue mask
    debug_assert_eq!(header.len(), 52);
    header.extend_from_slice(bgra);
    header
}

// The registered "PNG" format alone is not enough for Word, PowerPoint,
// Paint and older Win32 editors; write the classic DIB containers too.
fn write_png_formats(
    report: &mut ClipboardWriteReport,
    png_id: u32,
    png_name: String,
    png_bytes: &[u8],
) {
    let mut attempts: Vec<(u32, String, Vec<u8>)> = vec![(png_id, png_name, png_bytes.to_vec())];
    if let Some(dib) = dib_from_png(png_bytes) {
        attempts.push((CF_DIBV5, "CF_DIBV5".to_string(), dib.dibv5));
        attempts.push((CF_DIB, "CF_DIB".to_string(), dib.dib));
    }
    let mut written_names = Vec::new();
    let mut first_error: Option<String> = None;
    for (id, name, bytes) in attempts {
        match unsafe { set_global_bytes(id, &bytes) } {
            Ok(()) => written_names.push(name),
            Err(message) => {
                if first_error.is_none() {
                    first_error = Some(format!("{name}: {message}"));
                }
            }
        }
    }
    if written_names.is_empty() {
        if let Some(message) = first_error {
            report.failed_formats.push(ClipboardFormatFailure {
                format: FORMAT_PNG.to_string(),
                code: "CLIPBOARD_WRITE_FAILED".to_string(),
                message,
            });
        }
    } else {
        report.written_formats.push(ClipboardFormatEvidence {
            format: FORMAT_PNG.to_string(),
            bytes: png_bytes.len() as u64,
            native_format: written_names.join(", "),
        });
    }
}

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
    let allocation =
        unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)) }.map_err(|e| e.to_string())?;
    let pointer = unsafe { GlobalLock(allocation) };
    if pointer.is_null() {
        unsafe {
            let _ = GlobalFree(allocation);
        }
        return Err("GlobalLock returned null".to_string());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
        let _ = GlobalUnlock(allocation);
    }
    match unsafe { SetClipboardData(format, HANDLE(allocation.0)) } {
        Ok(_) => Ok(()),
        Err(error) => {
            unsafe {
                let _ = GlobalFree(HGLOBAL(allocation.0));
            }
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
        if payload.format == FORMAT_PNG {
            write_png_formats(&mut report, id, native_format, &payload.bytes);
            continue;
        }
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

    #[test]
    #[ignore = "writes the real Windows clipboard"]
    fn real_clipboard_accepts_png_and_bitmap_fallbacks() {
        use image::ImageEncoder as _;

        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(
                &[
                    255, 0, 0, 255, 0, 96, 255, 255, 22, 163, 74, 255, 255, 255, 255, 255,
                ],
                2,
                2,
                image::ExtendedColorType::Rgba8,
            )
            .expect("png encode");
        let report = write_payloads(&[ClipboardPayload {
            format: FORMAT_PNG,
            bytes: png,
        }]);
        let native_formats = report
            .written_formats
            .iter()
            .map(|entry| entry.native_format.as_str())
            .collect::<Vec<_>>();
        eprintln!("real PNG clipboard report: {report:#?}");
        assert!(native_formats.contains(&"PNG"));
        assert!(native_formats.contains(&"CF_DIBV5"));
        assert!(native_formats.contains(&"CF_DIB"));
        assert!(report.clipboard_sequence.is_some());
    }

    #[test]
    fn dib_headers_from_png_are_well_formed() {
        use image::ImageEncoder as _;

        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(
                &[
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
                ],
                2,
                2,
                image::ExtendedColorType::Rgba8,
            )
            .expect("png encode");
        let dib = dib_from_png(&png).expect("png decode");

        // BITMAPV5HEADER: 124-byte header, top-down, 32bpp, BI_BITFIELDS.
        assert_eq!(&dib.dibv5[0..4], &124u32.to_le_bytes());
        assert_eq!(i32::from_le_bytes(dib.dibv5[4..8].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(dib.dibv5[8..12].try_into().unwrap()), -2);
        assert_eq!(u16::from_le_bytes(dib.dibv5[12..14].try_into().unwrap()), 1);
        assert_eq!(
            u16::from_le_bytes(dib.dibv5[14..16].try_into().unwrap()),
            32
        );
        assert_eq!(u32::from_le_bytes(dib.dibv5[16..20].try_into().unwrap()), 3);
        assert_eq!(dib.dibv5.len(), 124 + 2 * 2 * 4);

        // BITMAPINFOHEADER: 40-byte header + 12-byte masks + pixels.
        assert_eq!(&dib.dib[0..4], &40u32.to_le_bytes());
        assert_eq!(i32::from_le_bytes(dib.dib[4..8].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(dib.dib[8..12].try_into().unwrap()), -2);
        assert_eq!(u16::from_le_bytes(dib.dib[12..14].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(dib.dib[14..16].try_into().unwrap()), 32);
        assert_eq!(u32::from_le_bytes(dib.dib[16..20].try_into().unwrap()), 3);
        assert_eq!(dib.dib.len(), 52 + 16);
    }

    #[test]
    fn dib_rejects_empty_or_invalid_inputs() {
        assert!(dib_from_png(b"").is_none());
        assert!(dib_from_png(b"not a png").is_none());
    }
}
