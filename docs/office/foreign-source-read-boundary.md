# 第三方公式读取边界

更新：2026-10-07。只读导入仍在分阶段接入；不宣称完整 MathType 或任意 OLE 兼容。

Word 的自动化获取已先检查 ProgID 及所选对象关联的嵌入 CFB 根类标识。
明确第三方 ProgID、冲突/缺失类标识或不明确的关系都不会取得 `Object`。
旧本应用 OLE 保存时可能为 `Unknown`、运行时 ProgID 为空；仅在关联存储的
CLSID 精确匹配本应用时兼容，不按内容控件标签或友好名称直接放行。
这是对象类身份限定，不是 COM 注册二进制认证或完整 CFB 验证。

持久类标识读取依据 Microsoft [CFB 头结构](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea)
及 [根目录项](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/026fde6e-143d-41bf-a7da-c08b2130d50e)。
仅检查有界头/首目录项，不遍历 FAT、读取公式流或执行第三方代码。

当前 Word 范围 Flat OPC 仅接受一个对象及唯一关系：本地
`word/embeddings/*.bin`，拒绝外部/重复/含路径跳转的关系与 DTD。
XML 上限 32 Mi 字符、深度 64、100,000 reader 事件、128 个 part；
存储上限 8 MiB，CFB v3/v4。超限或未支持的范围表示不能取得自动化对象，
不自动修改原文或放宽门禁。现有本应用清单读取仍保留。

真实本机 x64 Word 检查：两条旧 OLE 的选区读回、移除测试副本清单后的
按 ID 读回，以及新文档中新对象插入通过；原输入文件与剪贴板未变，
读取没有改变旧对象尺寸/正文。第三方拒绝由无自动化 getter 调用的共享
测试及源码边界检查覆盖，没有激活真实第三方服务器进行验证。

下一步：同步 Excel/PowerPoint 等宿主；Core 声明式源码探测接入图片元数据与
有界容器提取，补来源/范围和加载项“读取公式源”入口。MTEF 目前仍只有 raw
检查与去重/结构分组，没有语义转换、第三方写回或正式 UI 支持。
