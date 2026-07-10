#pragma once

#include "Presentation.h"

#include <objidl.h>
#include <string>
#include <vector>

HRESULT SavePresentationToStorage(IStorage* storage, const FormulaPresentation& presentation);
HRESULT LoadPresentationFromStorage(IStorage* storage, FormulaPresentation* presentation);

// v3 FormulaEnvelope.json stream
HRESULT SaveEnvelopeToStorage(IStorage* storage, const std::wstring& json);
HRESULT LoadEnvelopeFromStorage(IStorage* storage, std::wstring* json);

// Transactional helpers: backup all three streams before modifying, restore on failure
HRESULT StorageUtilBackup(IStorage* storage, std::vector<BYTE>* outPayload, std::vector<BYTE>* outEmf, std::vector<BYTE>* outEnvelope);
HRESULT StorageUtilRestore(IStorage* storage, const std::vector<BYTE>& payload, const std::vector<BYTE>& emf, const std::vector<BYTE>& envelope);
