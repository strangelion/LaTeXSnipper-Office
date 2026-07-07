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

    STATSTG stats{};
    result = stream->Stat(&stats, STATFLAG_NONAME);
    if (SUCCEEDED(result))
    {
        bytes->resize(static_cast<size_t>(stats.cbSize.QuadPart));
        ULONG read = 0;
        result = stream->Read(bytes->data(), static_cast<ULONG>(bytes->size()), &read);
        if (SUCCEEDED(result))
        {
            bytes->resize(read);
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
