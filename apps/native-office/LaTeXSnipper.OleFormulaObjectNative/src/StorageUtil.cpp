#include "StorageUtil.h"

#include "OleFormulaIds.h"

#include <vector>

namespace
{
constexpr wchar_t kPayloadStream[] = L"Payload";
constexpr wchar_t kEmfStream[] = L"PresentationEmf";
constexpr wchar_t kEnvelopeStream[] = L"FormulaEnvelope.json";

HRESULT WriteStream(IStorage* storage, const wchar_t* name, const void* data, ULONG byteCount)
{
    IStream* stream = nullptr;
    HRESULT result = storage->CreateStream(name, STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE, 0, 0, &stream);
    if (FAILED(result))
    {
        return result;
    }

    ULONG written = 0;
    result = stream->Write(data, byteCount, &written);
    stream->Release();
    return SUCCEEDED(result) && written == byteCount ? S_OK : STG_E_WRITEFAULT;
}

HRESULT ReadStream(IStorage* storage, const wchar_t* name, std::vector<BYTE>* bytes)
{
    IStream* stream = nullptr;
    HRESULT result = storage->OpenStream(name, nullptr, STGM_READ | STGM_SHARE_EXCLUSIVE, 0, &stream);
    if (FAILED(result))
    {
        return result;
    }

    // P1-7: Enforce size limits to prevent malicious/corrupt documents from
    // causing excessive memory allocation in the Office process.
    // JSON/Envelope streams: max 8 MB; EMF streams: max 64 MB.
    constexpr ULONGLONG MAX_JSON_ENVELOPE_SIZE = 8 * 1024 * 1024;   // 8 MiB
    constexpr ULONGLONG MAX_EMF_SIZE = 64 * 1024 * 1024;            // 64 MiB

    STATSTG stats{};
    result = stream->Stat(&stats, STATFLAG_NONAME);
    if (SUCCEEDED(result))
    {
        ULONGLONG streamSize = stats.cbSize.QuadPart;
        bool isEmfStream = (wcscmp(name, L"PresentationEmf") == 0);
        ULONGLONG maxSize = isEmfStream ? MAX_EMF_SIZE : MAX_JSON_ENVELOPE_SIZE;

        if (streamSize > maxSize)
        {
            stream->Release();
            return STG_E_MEDIUMFULL;
        }

        bytes->resize(static_cast<size_t>(streamSize));
        ULONG read = 0;
        result = stream->Read(bytes->data(), static_cast<ULONG>(bytes->size()), &read);
        if (SUCCEEDED(result))
        {
            bytes->resize(read);

            // P1-7: Validate UTF-16 length alignment for JSON/Envelope streams
            if (!isEmfStream && (read % 2 != 0))
            {
                bytes->clear();
                stream->Release();
                return STG_E_INVALIDPARAMETER;
            }
        }
    }

    stream->Release();
    return result;
}
}

HRESULT SavePresentationToStorage(IStorage* storage, const FormulaPresentation& presentation)
{
    if (storage == nullptr)
    {
        return E_POINTER;
    }

    HRESULT result = WriteClassStg(storage, CLSID_LaTeXSnipperFormula);
    if (FAILED(result))
    {
        return result;
    }

    std::wstring payload = presentation.payloadJson.empty() ? L"{}" : presentation.payloadJson;
    result = WriteStream(storage, kPayloadStream, payload.c_str(), static_cast<ULONG>((payload.size() + 1) * sizeof(wchar_t)));
    if (FAILED(result))
    {
        return result;
    }

    if (!presentation.enhancedMetafile.empty())
    {
        result = WriteStream(storage, kEmfStream, presentation.enhancedMetafile.data(), static_cast<ULONG>(presentation.enhancedMetafile.size()));
    }

    return result;
}

HRESULT LoadPresentationFromStorage(IStorage* storage, FormulaPresentation* presentation)
{
    if (storage == nullptr || presentation == nullptr)
    {
        return E_POINTER;
    }

    std::vector<BYTE> payloadBytes;
    HRESULT result = ReadStream(storage, kPayloadStream, &payloadBytes);
    if (FAILED(result))
    {
        return result;
    }

    std::wstring payload(reinterpret_cast<const wchar_t*>(payloadBytes.data()), payloadBytes.size() / sizeof(wchar_t));
    while (!payload.empty() && payload.back() == L'\0')
    {
        payload.pop_back();
    }

    FormulaPresentation loaded = CreatePresentationFromPayloadWithoutRendering(payload);
    std::vector<BYTE> emfBytes;
    if (SUCCEEDED(ReadStream(storage, kEmfStream, &emfBytes)) && !emfBytes.empty())
    {
        loaded.enhancedMetafile = std::move(emfBytes);
    }

    *presentation = std::move(loaded);
    return S_OK;
}

HRESULT SaveEnvelopeToStorage(IStorage* storage, const std::wstring& json)
{
    return WriteStream(storage, kEnvelopeStream, json.c_str(), static_cast<ULONG>((json.size() + 1) * sizeof(wchar_t)));
}

HRESULT LoadEnvelopeFromStorage(IStorage* storage, std::wstring* json)
{
    if (json == nullptr) return E_POINTER;
    std::vector<BYTE> bytes;
    HRESULT result = ReadStream(storage, kEnvelopeStream, &bytes);
    if (FAILED(result)) return result;
    *json = std::wstring(reinterpret_cast<const wchar_t*>(bytes.data()), bytes.size() / sizeof(wchar_t));
    while (!json->empty() && json->back() == L'\0') json->pop_back();
    return S_OK;
}

HRESULT StorageUtilBackup(IStorage* storage, std::vector<BYTE>* outPayload, std::vector<BYTE>* outEmf, std::vector<BYTE>* outEnvelope)
{
    if (storage == nullptr || outPayload == nullptr || outEmf == nullptr || outEnvelope == nullptr)
        return E_POINTER;

    HRESULT hr = ReadStream(storage, kPayloadStream, outPayload);
    if (FAILED(hr))
    {
        // Payload stream may not exist yet (first save) — that's OK
        outPayload->clear();
    }

    hr = ReadStream(storage, kEmfStream, outEmf);
    if (FAILED(hr))
    {
        outEmf->clear();
    }

    // P1-6: Also backup FormulaEnvelope.json so all three streams are restored on failure
    hr = ReadStream(storage, kEnvelopeStream, outEnvelope);
    if (FAILED(hr))
    {
        outEnvelope->clear();
    }

    return S_OK;
}

HRESULT StorageUtilRestore(IStorage* storage, const std::vector<BYTE>& payload, const std::vector<BYTE>& emf, const std::vector<BYTE>& envelope)
{
    if (storage == nullptr)
        return E_POINTER;

    // Delete existing streams
    storage->DestroyElement(kPayloadStream);
    storage->DestroyElement(kEmfStream);
    storage->DestroyElement(kEnvelopeStream);

    // Restore payload
    if (!payload.empty())
    {
        HRESULT hr = WriteStream(storage, kPayloadStream, payload.data(), static_cast<ULONG>(payload.size()));
        if (FAILED(hr)) return hr;
    }

    // Restore EMF
    if (!emf.empty())
    {
        HRESULT hr = WriteStream(storage, kEmfStream, emf.data(), static_cast<ULONG>(emf.size()));
        if (FAILED(hr)) return hr;
    }

    // P1-6: Restore envelope
    if (!envelope.empty())
    {
        HRESULT hr = WriteStream(storage, kEnvelopeStream, envelope.data(), static_cast<ULONG>(envelope.size()));
        if (FAILED(hr)) return hr;
    }

    return S_OK;
}
