#pragma once

#include "Presentation.h"
#include <string>
#include <windows.h>

// Start an OLE edit session: create a pipe, launch Desktop, wait for update.
// Returns S_OK if the formula was updated, S_FALSE if user cancelled, error otherwise.
HRESULT StartEditSessionPipe(const std::wstring& formulaId,
                             FormulaPresentation* presentation,
                             HWND parentWindow);

// Named pipe name prefix
inline constexpr wchar_t kOleEditPipePrefix[] = L"\\\\.\\pipe\\LaTeXSnipper.OleEditSession.";
