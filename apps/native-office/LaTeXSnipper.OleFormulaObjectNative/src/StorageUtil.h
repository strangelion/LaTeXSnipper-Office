#pragma once

#include "Presentation.h"

#include <objidl.h>
#include <string>

HRESULT SavePresentationToStorage(IStorage* storage, const FormulaPresentation& presentation);
HRESULT LoadPresentationFromStorage(IStorage* storage, FormulaPresentation* presentation);

// v3 FormulaEnvelope.json stream
HRESULT SaveEnvelopeToStorage(IStorage* storage, const std::wstring& json);
HRESULT LoadEnvelopeFromStorage(IStorage* storage, std::wstring* json);
