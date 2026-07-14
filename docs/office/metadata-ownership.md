# Formula metadata ownership

统一概念字段为 schema、schemaVersion、formulaId、revision、latex、displayMode、numbering、renderer、版本/时间和可选 checksum。更新成功后 revision 才递增；移动保留 FormulaId；copy-as-new 和重复 ID 检测必须产生新 FormulaId。

各宿主权威存储：Word Office.js 为 owned SDT + Custom XML；Native Word OMML 为 ContentControl/bookmark + document manifest；Native OLE 为对象自身 persistent storage；Excel/PowerPoint Office.js 为稳定 shape name 与 metadata；WPS Writer 为 bookmark + document Variables；WPS ET/WPP 为 shape name + AlternativeText/Description。

Word 不以 AltText 作为唯一事实来源。无效 ID、schema、revision、checksum、超限 LaTeX、非法 numbering 或 missing object 必须拒绝或隔离。日志只记录 operation、host、FormulaId、HRESULT/errorCode，不记录完整 Base64。
