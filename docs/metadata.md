# Formula Metadata Normalization

## 当前问题

### 1. 元数据结构不规范

**当前结构**：
```json
{
  "schemaVersion": 1,
  "documentId": "xxx",
  "equationId": "xxx",
  "latex": "E=mc^2",
  "displayMode": "Inline|Display",
  "numberingMode": "None|Auto|Manual",
  "numberText": "",
  "renderEngine": "MathJaxSvg|OlePresentation",
  "fontColor": "#000000",
  "fontStyle": "TeX|RomanUpright|Bold|Italic",
  "fontScale": 1.0
}
```

**问题**：
1. 字段命名不一致（camelCase vs snake_case）
2. 缺少版本迁移机制
3. 缺少完整性校验
4. 字体相关字段分散

### 2. 序列化/反序列化问题

**当前实现**：
```csharp
public static string Serialize(FormulaMetadata metadata)
{
    var dto = new Dictionary<string, object>
    {
        ["schemaVersion"] = metadata.SchemaVersion,
        ["documentId"] = metadata.Identity.DocumentId,
        // ...
    };
    return serializer.Serialize(dto);
}
```

**问题**：
1. 使用 `Dictionary<string, object>` 缺少类型安全
2. 缺少字段验证
3. 缺少默认值处理

## 规范化方案

### 方案 1：新的元数据结构

```python
# src/backend/metadata/schema.py

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import json

class DisplayMode(Enum):
    """显示模式"""
    INLINE = "inline"
    DISPLAY = "display"

class NumberingMode(Enum):
    """编号模式"""
    NONE = "none"
    AUTO = "auto"
    MANUAL = "manual"

class RenderEngine(Enum):
    """渲染引擎"""
    MATHJAX_SVG = "mathjax_svg"
    MATHJAX_PNG = "mathjax_png"
    NATIVE_OMML = "native_omml"

class FontStyle(Enum):
    """字体样式"""
    TEX = "tex"
    ROMAN = "roman"
    BOLD = "bold"
    ITALIC = "italic"
    BOLD_ITALIC = "bold_italic"

@dataclass
class FontSettings:
    """字体设置"""
    color: str = "#000000"
    style: FontStyle = FontStyle.TEX
    scale: float = 1.0
    family: str = "auto"
    
    def validate(self) -> bool:
        """验证字体设置"""
        if not self.color.startswith('#') or len(self.color) != 7:
            return False
        if self.scale <= 0 or self.scale > 10:
            return False
        return True

@dataclass
class SizeSettings:
    """尺寸设置"""
    natural_width: float = 0.0
    natural_height: float = 0.0
    scale_factor: float = 1.0
    
    def validate(self) -> bool:
        """验证尺寸设置"""
        if self.natural_width < 0 or self.natural_height < 0:
            return False
        if self.scale_factor <= 0 or self.scale_factor > 10:
            return False
        return True

@dataclass
class FormulaIdentity:
    """公式身份"""
    document_id: str
    equation_id: str
    revision: str = ""
    
    def validate(self) -> bool:
        """验证身份信息"""
        return bool(self.document_id and self.equation_id)

@dataclass
class FormulaMetadata:
    """公式元数据"""
    schema_version: int = 2
    identity: FormulaIdentity = None
    latex: str = ""
    display_mode: DisplayMode = DisplayMode.INLINE
    numbering_mode: NumberingMode = NumberingMode.NONE
    number_text: str = ""
    render_engine: RenderEngine = RenderEngine.MATHJAX_SVG
    font: FontSettings = field(default_factory=FontSettings)
    size: SizeSettings = field(default_factory=SizeSettings)
    theme: str = "light"
    created_at: str = ""
    updated_at: str = ""
    
    def validate(self) -> bool:
        """验证元数据"""
        if not self.identity or not self.identity.validate():
            return False
        if not self.latex:
            return False
        if not self.font.validate():
            return False
        if not self.size.validate():
            return False
        return True
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "schema_version": self.schema_version,
            "identity": {
                "document_id": self.identity.document_id,
                "equation_id": self.identity.equation_id,
                "revision": self.identity.revision,
            },
            "latex": self.latex,
            "display_mode": self.display_mode.value,
            "numbering_mode": self.numbering_mode.value,
            "number_text": self.number_text,
            "render_engine": self.render_engine.value,
            "font": {
                "color": self.font.color,
                "style": self.font.style.value,
                "scale": self.font.scale,
                "family": self.font.family,
            },
            "size": {
                "natural_width": self.size.natural_width,
                "natural_height": self.size.natural_height,
                "scale_factor": self.size.scale_factor,
            },
            "theme": self.theme,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'FormulaMetadata':
        """从字典创建"""
        return cls(
            schema_version=data.get("schema_version", 2),
            identity=FormulaIdentity(
                document_id=data["identity"]["document_id"],
                equation_id=data["identity"]["equation_id"],
                revision=data["identity"].get("revision", ""),
            ),
            latex=data.get("latex", ""),
            display_mode=DisplayMode(data.get("display_mode", "inline")),
            numbering_mode=NumberingMode(data.get("numbering_mode", "none")),
            number_text=data.get("number_text", ""),
            render_engine=RenderEngine(data.get("render_engine", "mathjax_svg")),
            font=FontSettings(
                color=data.get("font", {}).get("color", "#000000"),
                style=FontStyle(data.get("font", {}).get("style", "tex")),
                scale=data.get("font", {}).get("scale", 1.0),
                family=data.get("font", {}).get("family", "auto"),
            ),
            size=SizeSettings(
                natural_width=data.get("size", {}).get("natural_width", 0.0),
                natural_height=data.get("size", {}).get("natural_height", 0.0),
                scale_factor=data.get("size", {}).get("scale_factor", 1.0),
            ),
            theme=data.get("theme", "light"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )
    
    def to_json(self) -> str:
        """转换为 JSON"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'FormulaMetadata':
        """从 JSON 创建"""
        return cls.from_dict(json.loads(json_str))
```

### 方案 2：元数据迁移器

```python
# src/backend/metadata/migrator.py

from typing import Dict, Any
from .schema import FormulaMetadata, FontSettings, SizeSettings, FormulaIdentity

class MetadataMigrator:
    """元数据迁移器"""
    
    MIGRATIONS = {
        1: '_migrate_v1_to_v2',
    }
    
    def migrate(self, data: Dict[str, Any]) -> FormulaMetadata:
        """迁移元数据到最新版本"""
        version = data.get("schemaVersion", data.get("schema_version", 1))
        
        while version in self.MIGRATIONS:
            migration_func = getattr(self, self.MIGRATIONS[version])
            data = migration_func(data)
            version = data.get("schema_version", version + 1)
        
        return FormulaMetadata.from_dict(data)
    
    def _migrate_v1_to_v2(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """从 V1 迁移到 V2"""
        return {
            "schema_version": 2,
            "identity": {
                "document_id": data.get("documentId", ""),
                "equation_id": data.get("equationId", ""),
                "revision": "",
            },
            "latex": data.get("latex", ""),
            "display_mode": data.get("displayMode", "inline").lower(),
            "numbering_mode": data.get("numberingMode", "none").lower(),
            "number_text": data.get("numberText", ""),
            "render_engine": data.get("renderEngine", "mathjax_svg").lower(),
            "font": {
                "color": data.get("fontColor", "#000000"),
                "style": data.get("fontStyle", "tex").lower(),
                "scale": data.get("fontScale", 1.0),
                "family": "auto",
            },
            "size": {
                "natural_width": data.get("naturalWidthPoints", 0.0),
                "natural_height": data.get("naturalHeightPoints", 0.0),
                "scale_factor": 1.0,
            },
            "theme": "light",
            "created_at": "",
            "updated_at": "",
        }
```

### 方案 3：元数据验证器

```python
# src/backend/metadata/validator.py

from typing import List, Tuple
from .schema import FormulaMetadata

class MetadataValidator:
    """元数据验证器"""
    
    def validate(self, metadata: FormulaMetadata) -> Tuple[bool, List[str]]:
        """验证元数据，返回 (是否有效, 警告列表)"""
        warnings = []
        is_valid = True
        
        # 验证基础字段
        if not metadata.identity or not metadata.identity.validate():
            warnings.append("Invalid identity")
            is_valid = False
        
        if not metadata.latex:
            warnings.append("Empty LaTeX")
            is_valid = False
        
        # 验证字体设置
        if not metadata.font.validate():
            warnings.append("Invalid font settings")
            is_valid = False
        
        # 验证尺寸设置
        if not metadata.size.validate():
            warnings.append("Invalid size settings")
            is_valid = False
        
        # 检查潜在问题
        if metadata.font.scale > 5.0:
            warnings.append("Font scale too large")
        
        if metadata.size.scale_factor > 5.0:
            warnings.append("Size scale factor too large")
        
        return is_valid, warnings
    
    def repair(self, metadata: FormulaMetadata) -> FormulaMetadata:
        """修复元数据"""
        from datetime import datetime
        
        # 修复字体设置
        if not metadata.font.validate():
            metadata.font = FontSettings()
        
        # 修复尺寸设置
        if not metadata.size.validate():
            metadata.size = SizeSettings()
        
        # 修复时间戳
        if not metadata.created_at:
            metadata.created_at = datetime.now().isoformat()
        
        metadata.updated_at = datetime.now().isoformat()
        
        return metadata
```

## 测试用例

```python
# tests/test_metadata.py

import pytest
from src.backend.metadata.schema import (
    FormulaMetadata, FormulaIdentity, FontSettings, 
    SizeSettings, DisplayMode, FontStyle
)
from src.backend.metadata.migrator import MetadataMigrator
from src.backend.metadata.validator import MetadataValidator

class TestFormulaMetadata:
    def test_create_metadata(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("doc-123", "eq-456"),
            latex="E = mc^2",
            display_mode=DisplayMode.DISPLAY,
        )
        assert metadata.validate()
    
    def test_to_dict_and_from_dict(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("doc-123", "eq-456"),
            latex="E = mc^2",
        )
        data = metadata.to_dict()
        restored = FormulaMetadata.from_dict(data)
        assert metadata.latex == restored.latex
    
    def test_to_json_and_from_json(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("doc-123", "eq-456"),
            latex="E = mc^2",
        )
        json_str = metadata.to_json()
        restored = FormulaMetadata.from_json(json_str)
        assert metadata.latex == restored.latex

class TestMetadataMigrator:
    def test_migrate_v1_to_v2(self):
        v1_data = {
            "schemaVersion": 1,
            "documentId": "doc-123",
            "equationId": "eq-456",
            "latex": "E = mc^2",
            "displayMode": "Display",
            "fontColor": "#000000",
            "fontStyle": "TeX",
            "fontScale": 1.0,
        }
        
        migrator = MetadataMigrator()
        metadata = migrator.migrate(v1_data)
        
        assert metadata.schema_version == 2
        assert metadata.identity.document_id == "doc-123"
        assert metadata.latex == "E = mc^2"

class TestMetadataValidator:
    def test_validate_valid_metadata(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("doc-123", "eq-456"),
            latex="E = mc^2",
        )
        
        validator = MetadataValidator()
        is_valid, warnings = validator.validate(metadata)
        
        assert is_valid
        assert len(warnings) == 0
    
    def test_validate_invalid_metadata(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("", ""),
            latex="",
        )
        
        validator = MetadataValidator()
        is_valid, warnings = validator.validate(metadata)
        
        assert not is_valid
        assert len(warnings) > 0
    
    def test_repair_metadata(self):
        metadata = FormulaMetadata(
            identity=FormulaIdentity("doc-123", "eq-456"),
            latex="E = mc^2",
            font=FontSettings(scale=-1.0),
        )
        
        validator = MetadataValidator()
        repaired = validator.repair(metadata)
        
        assert repaired.font.scale == 1.0
```

## 实施步骤

### 阶段 1：创建元数据结构（1天）

1. 创建 `FormulaMetadata` 类
2. 创建 `FontSettings`、`SizeSettings` 等子类
3. 实现序列化/反序列化
4. 添加单元测试

### 阶段 2：创建迁移器（1天）

1. 创建 `MetadataMigrator` 类
2. 实现 V1 到 V2 的迁移
3. 添加迁移测试

### 阶段 3：创建验证器（1天）

1. 创建 `MetadataValidator` 类
2. 实现验证和修复逻辑
3. 添加验证测试

### 阶段 4：集成测试（1天）

1. 端到端测试
2. 性能测试
3. 用户测试

## 验收标准

1. **元数据结构**：所有字段命名规范，类型安全
2. **序列化**：JSON 序列化/反序列化正确
3. **迁移**：V1 到 V2 迁移正确
4. **验证**：所有验证规则正确执行
5. **测试覆盖**：单元测试覆盖率 > 80%
