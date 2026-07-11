#pragma once

#include "Presentation.h"
#include <string>
#include <windows.h>

inline constexpr DWORD kOleEditProtocolVersion = 3;
inline constexpr DWORD kOleEditMaxPayloadBytes = 64U * 1024U * 1024U;
inline constexpr HRESULT OLE_EDIT_BUSY = MAKE_HRESULT(SEVERITY_ERROR, FACILITY_ITF, 0x201);
inline constexpr HRESULT OLE_EDIT_PREVIEW_FAILED = MAKE_HRESULT(SEVERITY_ERROR, FACILITY_ITF, 0x202);
inline constexpr HRESULT OLE_EDIT_PROTOCOL_ERROR = MAKE_HRESULT(SEVERITY_ERROR, FACILITY_ITF, 0x203);
inline constexpr HRESULT OLE_EDIT_REVISION_CONFLICT = MAKE_HRESULT(SEVERITY_ERROR, FACILITY_ITF, 0x204);

// Start an OLE edit session: create a pipe, launch Desktop, wait for update.
// Returns S_OK if the formula was updated, S_FALSE if user cancelled, error otherwise.
HRESULT StartEditSessionPipe(const std::wstring& formulaId,
                             FormulaPresentation* presentation,
                             HWND parentWindow);

// Named pipe name prefix
inline constexpr wchar_t kOleEditPipePrefix[] = L"\\\\.\\pipe\\LaTeXSnipper.OleEditSession.";
