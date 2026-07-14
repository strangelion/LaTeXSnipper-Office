# Browser release checklist

- Chrome and Firefox packages build from the same commit.
- Manifests contain no always-on `<all_urls>` access and use Bridge port 19877.
- en, zh_CN, and zh_TW locale catalogs are complete.
- Content/background bundles, side panel, options, provenance, and licenses exist and are non-empty.
- Browser→desktop and desktop→browser action schemas remain distinct.
- No Office/WPS API is reachable from browser production code.
- Provider maturity matches actual live-site evidence.
