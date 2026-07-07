#pragma once

#include <string>
#include <vector>
#include <unordered_map>

// -------------------------------------------------------------------
// JSON Helper — wraps nlohmann/json when available, falls back to
// manual string extraction when the library is not installed.
//
// To install the full parser:
//   powershell -File vendor/nlohmann/fetch_json.ps1
// This downloads json.hpp to vendor/nlohmann/ which is in the
// AdditionalIncludeDirectories path.
// -------------------------------------------------------------------

// If nlohmann/json.hpp is present (vendor/nlohmann/json.hpp), use it.
// Otherwise, fall back to the original hand-written extraction.
// The build script or CI should ensure json.hpp exists.
#if __has_include(<nlohmann/json.hpp>)
#include <nlohmann/json.hpp>
#define HAS_NLOHMANN_JSON 1
#else
#define HAS_NLOHMANN_JSON 0
#endif

// --- Read a string field from a JSON payload ---
inline std::wstring JsonReadString(const std::wstring& payloadJson, const std::wstring& propertyName)
{
#if HAS_NLOHMANN_JSON
    try
    {
        nlohmann::json doc = nlohmann::json::parse(payloadJson);
        std::string key(propertyName.begin(), propertyName.end());
        if (doc.contains(key) && doc[key].is_string())
        {
            std::string val = doc[key].get<std::string>();
            return std::wstring(val.begin(), val.end());
        }
    }
    catch (...) {}
    return L"";
#else
    // Fallback to manual extraction
    return ExtractJsonString(payloadJson, propertyName);
#endif
}

// --- Read a double field from a JSON payload ---
inline double JsonReadNumber(const std::wstring& payloadJson, const std::wstring& propertyName)
{
#if HAS_NLOHMANN_JSON
    try
    {
        nlohmann::json doc = nlohmann::json::parse(payloadJson);
        std::string key(propertyName.begin(), propertyName.end());
        if (doc.contains(key) && doc[key].is_number())
        {
            return doc[key].get<double>();
        }
    }
    catch (...) {}
    return 0.0;
#else
    return ExtractJsonNumber(payloadJson, propertyName);
#endif
}

// --- Read a nested string field like "render.svg" ---
inline std::wstring JsonReadNestedString(const std::wstring& payloadJson, const std::wstring& parentKey, const std::wstring& childKey)
{
#if HAS_NLOHMANN_JSON
    try
    {
        nlohmann::json doc = nlohmann::json::parse(payloadJson);
        std::string parent(parentKey.begin(), parentKey.end());
        std::string child(childKey.begin(), childKey.end());
        if (doc.contains(parent) && doc[parent].is_object() && doc[parent].contains(child) && doc[parent][child].is_string())
        {
            std::string val = doc[parent][child].get<std::string>();
            return std::wstring(val.begin(), val.end());
        }
    }
    catch (...) {}
    return L"";
#else
    // Fallback: flat search works for unique key names like "svg", "png"
    return ExtractJsonString(payloadJson, childKey);
#endif
}

// --- Validate JSON is well-formed ---
inline bool JsonIsValid(const std::wstring& payloadJson)
{
#if HAS_NLOHMANN_JSON
    try
    {
        nlohmann::json::parse(payloadJson);
        return true;
    }
    catch (...) {}
    return false;
#else
    // Basic check: starts with { and ends with }
    if (payloadJson.empty()) return false;
    size_t first = payloadJson.find_first_not_of(L" \t\r\n");
    size_t last = payloadJson.find_last_not_of(L" \t\r\n");
    return first != std::wstring::npos && last != std::wstring::npos &&
           payloadJson[first] == L'{' && payloadJson[last] == L'}';
#endif
}
