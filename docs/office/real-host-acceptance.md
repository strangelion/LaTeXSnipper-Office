# Real-host acceptance

自动构建、mock、manifest 和 package smoke 不能替代真实宿主。每次 release 必须记录实际打开的宿主、Office/WPS 版本、bitness、操作、save/reopen、undo 和结果。

Windows：Word inline/display/numbered OMML、renumber/reference、real OLE insert/double-click/update/delete、table/two-column/read-only/multiple documents、x86/x64；Excel 和 PowerPoint real OLE 与 image、update/delete、geometry、save/reopen、active document changed；Visio x86/x64 VSTO load、SVG-first/PNG fallback、selection CRUD、copy identity、save/reopen、page context、grouped update rejection。Visio OLE 不在初始验收范围，保持 Experimental/unavailable。

macOS/Web：Word/Excel/PowerPoint manifest load、HTTPS trust、insert/read/update/delete、save/reopen、无 Windows path；PowerPoint Preview API 必须标记 Preview。

WPS：分别打开 Writer、Spreadsheets、Presentation，验证 Ribbon、task pane、host detection、heartbeat、insert/read/update/delete、save/reopen；Writer 额外验证 native math、1x3 numbered layout、renumber 和 cleanup。

在真宿主执行前能力只能标记 Implemented/Automated tested/Beta，不得标记 Stable。本文件的勾选结果应由 release 验收人员更新，不从 CI 推断。
