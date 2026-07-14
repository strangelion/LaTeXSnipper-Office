# Replacement safety

所有公式更新遵守 candidate-first：读取原对象和元数据，创建候选，写入内容与 ownership，回读验证，恢复几何，最后删除原对象。任何 commit 前失败都删除候选并保留原对象。

- Native Word OMML/OLE：候选放在原 ContentControl 后方；真实 OLE 候选必须通过 Automation payload 和 extent 验证；manifest 在删除前 staged；原对象删除失败时恢复 manifest 并删除候选。更新按 FormulaId 和 revision 做乐观并发检查。
- WPS Writer：在原 bookmark 之后创建 OMath/1x3 table 候选，验证候选 bookmark 和 document variable metadata，stage 新 index 后再删除原 range；失败恢复原 index。
- WPS ET/WPP：先创建 image shape，写入并回读 name/AlternativeText metadata，恢复尺寸、位置和旋转，再删除原 shape；原 shape 删除失败时删除候选。
- Office.js：Custom XML/shape metadata 不得在新对象同步和回读之前删除。PowerPoint image API 仍标记 Preview/Beta。

普通图片不是自定义 OLE。Word 仍以 OMML 或真实 LaTeXSnipper OLE 为主路径。
