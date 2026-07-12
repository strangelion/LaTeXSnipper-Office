#include "PendingPayloadTransport.h"

#include "JsonHelper.h"
#include "NativeLog.h"

#include <bcrypt.h>
#include <shlobj.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cwctype>
#include <string>
#include <vector>

namespace
{
constexpr wchar_t kPayloadKey[] = L"Software\\LaTeXSnipper\\OfficePlugin\\OleFormulaObject";
constexpr wchar_t kValuePrefix[] = L"PendingPayload.";
constexpr wchar_t kPayloadSubdirectory[] = L"LaTeXSnipper\\OfficePlugin\\PendingPayloads";
constexpr size_t kMaximumReferenceCharacters = 2048;
constexpr std::uint64_t kMaximumPayloadBytes = 64ULL * 1024ULL * 1024ULL;
constexpr long long kDotNetEpochTicks = 621355968000000000LL;
constexpr long long kPayloadTtlTicks = 5LL * 60LL * 10000000LL;
constexpr long long kClockSkewTicks = 60LL * 10000000LL;

class UniqueHandle
{
public:
    explicit UniqueHandle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
    ~UniqueHandle() { Reset(); }
    UniqueHandle(const UniqueHandle&) = delete;
    UniqueHandle& operator=(const UniqueHandle&) = delete;
    HANDLE Get() const noexcept { return value_; }
    bool IsValid() const noexcept { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
    void Reset(HANDLE value = INVALID_HANDLE_VALUE) noexcept
    {
        if (IsValid()) CloseHandle(value_);
        value_ = value;
    }
private:
    HANDLE value_;
};

class UniqueRegistryKey
{
public:
    ~UniqueRegistryKey() { if (value_ != nullptr) RegCloseKey(value_); }
    HKEY* Put() noexcept { return &value_; }
    HKEY Get() const noexcept { return value_; }
private:
    HKEY value_ = nullptr;
};

bool IsHex(const std::string& value, size_t expectedLength)
{
    if (value.size() != expectedLength) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) { return std::isxdigit(ch) != 0; });
}

std::wstring GetPayloadPath(const std::string& token)
{
    PWSTR localAppData = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &localAppData)) || localAppData == nullptr)
        return {};
    std::wstring path(localAppData);
    CoTaskMemFree(localAppData);
    path += L"\\";
    path += kPayloadSubdirectory;
    path += L"\\";
    path.append(token.begin(), token.end());
    path += L".json";
    return path;
}

std::wstring ReadReference()
{
    wchar_t valueName[64]{};
    swprintf_s(valueName, L"%s%lu", kValuePrefix, GetCurrentProcessId());
    UniqueRegistryKey key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kPayloadKey, 0, KEY_QUERY_VALUE, key.Put()) != ERROR_SUCCESS)
        return {};
    DWORD type = 0;
    DWORD bytes = 0;
    LSTATUS status = RegQueryValueExW(key.Get(), valueName, nullptr, &type, nullptr, &bytes);
    if (status != ERROR_SUCCESS || type != REG_SZ || bytes < sizeof(wchar_t) ||
        bytes > (kMaximumReferenceCharacters + 1) * sizeof(wchar_t))
    {
        return {};
    }
    std::wstring reference(bytes / sizeof(wchar_t), L'\0');
    status = RegQueryValueExW(key.Get(), valueName, nullptr, &type,
                              reinterpret_cast<BYTE*>(reference.data()), &bytes);
    if (status != ERROR_SUCCESS) return {};
    while (!reference.empty() && reference.back() == L'\0') reference.pop_back();
    return reference;
}

void DeleteCurrentProcessReference()
{
    wchar_t valueName[64]{};
    swprintf_s(valueName, L"%s%lu", kValuePrefix, GetCurrentProcessId());
    UniqueRegistryKey key;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kPayloadKey, 0, KEY_SET_VALUE, key.Put()) != ERROR_SUCCESS)
        return;
    const LSTATUS status = RegDeleteValueW(key.Get(), valueName);
    if (status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND)
    {
        WriteNativeOleLog(L"PendingPayload: failed to delete invalid token reference.");
    }
}

bool ComputeSha256(const std::vector<BYTE>& bytes, std::string* hashHex)
{
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectBytes = 0;
    DWORD hashBytes = 0;
    DWORD resultBytes = 0;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0);
    if (status < 0) return false;
    status = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes),
                               sizeof(objectBytes), &resultBytes, 0);
    if (status >= 0)
        status = BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashBytes),
                                   sizeof(hashBytes), &resultBytes, 0);
    std::vector<BYTE> object(objectBytes);
    std::vector<BYTE> digest(hashBytes);
    if (status >= 0) status = BCryptCreateHash(algorithm, &hash, object.data(), objectBytes, nullptr, 0, 0);
    if (status >= 0) status = BCryptHashData(hash, const_cast<PUCHAR>(bytes.data()), static_cast<ULONG>(bytes.size()), 0);
    if (status >= 0) status = BCryptFinishHash(hash, digest.data(), hashBytes, 0);
    if (hash != nullptr) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (status < 0 || digest.size() != 32) return false;
    static constexpr char kHex[] = "0123456789abcdef";
    hashHex->clear();
    hashHex->reserve(digest.size() * 2);
    for (BYTE value : digest)
    {
        hashHex->push_back(kHex[value >> 4]);
        hashHex->push_back(kHex[value & 0x0F]);
    }
    return true;
}

bool FixedTimeHexEquals(const std::string& left, const std::string& right)
{
    if (left.size() != right.size()) return false;
    unsigned int difference = 0;
    for (size_t index = 0; index < left.size(); ++index)
        difference |= static_cast<unsigned int>(std::tolower(static_cast<unsigned char>(left[index])) ^
                                                std::tolower(static_cast<unsigned char>(right[index])));
    return difference == 0;
}

bool ReadPayloadFile(const std::wstring& path, std::uint64_t expectedLength, const std::string& expectedHash,
                     std::wstring* payload)
{
    UniqueHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
    if (!file.IsValid()) return false;
    LARGE_INTEGER fileSize{};
    if (!GetFileSizeEx(file.Get(), &fileSize) || fileSize.QuadPart <= 0 ||
        static_cast<std::uint64_t>(fileSize.QuadPart) != expectedLength || expectedLength > kMaximumPayloadBytes)
        return false;
    std::vector<BYTE> bytes(static_cast<size_t>(expectedLength));
    size_t offset = 0;
    while (offset < bytes.size())
    {
        DWORD transferred = 0;
        const DWORD chunk = static_cast<DWORD>((std::min)(bytes.size() - offset, static_cast<size_t>(1 << 20)));
        if (!ReadFile(file.Get(), bytes.data() + offset, chunk, &transferred, nullptr) || transferred == 0) return false;
        offset += transferred;
    }
    std::string actualHash;
    if (!ComputeSha256(bytes, &actualHash) || !FixedTimeHexEquals(expectedHash, actualHash)) return false;
    const int characterCount = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
        reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
    if (characterCount <= 0) return false;
    payload->resize(static_cast<size_t>(characterCount));
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()),
        static_cast<int>(bytes.size()), payload->data(), characterCount) == characterCount;
}
}

std::wstring ConsumePendingPayloadReference()
{
    const std::wstring referenceText = ReadReference();
    if (referenceText.empty())
    {
        WriteNativeOleLog(L"PendingPayload: token reference not found for current PID.");
        return {};
    }
    std::string token;
    std::string expectedHash;
    std::uint64_t expectedLength = 0;
    long long createdUtcTicks = 0;
    try
    {
        const nlohmann::json reference = nlohmann::json::parse(WideToUtf8(referenceText));
        if (!reference.is_object() || reference.value("schemaVersion", 0) != 1 ||
            !reference.contains("token") || !reference["token"].is_string() ||
            !reference.contains("sha256") || !reference["sha256"].is_string() ||
            !reference.contains("byteLength") || !reference["byteLength"].is_number_unsigned() ||
            !reference.contains("createdUtcTicks") || !reference["createdUtcTicks"].is_number_integer())
        {
            DeleteCurrentProcessReference();
            WriteNativeOleLog(L"PendingPayload: malformed token reference rejected and removed.");
            return {};
        }
        token = reference["token"].get<std::string>();
        expectedHash = reference["sha256"].get<std::string>();
        expectedLength = reference["byteLength"].get<std::uint64_t>();
        createdUtcTicks = reference["createdUtcTicks"].get<long long>();
    }
    catch (const std::exception&)
    {
        DeleteCurrentProcessReference();
        WriteNativeOleLog(L"PendingPayload: token reference JSON rejected and removed.");
        return {};
    }
    if (!IsHex(token, 64) || !IsHex(expectedHash, 64) || expectedLength == 0 || expectedLength > kMaximumPayloadBytes)
    {
        DeleteCurrentProcessReference();
        WriteNativeOleLog(L"PendingPayload: invalid token reference fields removed.");
        return {};
    }
    const std::wstring payloadPath = GetPayloadPath(token);
    if (payloadPath.empty()) return {};
    const auto unixTicks = std::chrono::duration_cast<std::chrono::duration<long long, std::ratio<1, 10000000>>>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const long long ageTicks = unixTicks + kDotNetEpochTicks - createdUtcTicks;
    if (createdUtcTicks <= 0 || ageTicks < -kClockSkewTicks || ageTicks > kPayloadTtlTicks)
    {
        DeleteFileW(payloadPath.c_str());
        DeleteCurrentProcessReference();
        WriteNativeOleLog(L"PendingPayload: stale payload and reference removed.");
        return {};
    }
    std::wstring payload;
    if (!ReadPayloadFile(payloadPath, expectedLength, expectedHash, &payload))
    {
        DeleteFileW(payloadPath.c_str());
        DeleteCurrentProcessReference();
        WriteNativeOleLog(L"PendingPayload: invalid payload and reference removed.");
        return {};
    }
    WriteNativeOleLog(L"PendingPayload: payload read successfully under active lease.");
    return payload;
}
