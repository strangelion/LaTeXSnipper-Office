# Font and Typography Fix Plan

## 问题分析

### 1. 字体样式应用问题

**问题描述**：
- 嵌套公式处理不完整
- 多行环境的字体样式应用有问题
- 特殊字符处理不当

**当前代码** (`MathLiveLatexStyleNormalizer.cs`):

```csharp
private static string WrapFontStyle(string latex, FormulaFontStyle fontStyle)
{
    return fontStyle switch
    {
        FormulaFontStyle.RomanUpright => "\\mathrm{" + latex + "}",
        FormulaFontStyle.Bold => "\\bm{" + latex + "}",
        FormulaFontStyle.Italic => "\\mathit{" + latex + "}",
        _ => latex,
    };
}
```

### 2. 字体缩放问题

**问题描述**：
- 缩放范围限制不适合所有场景
- 缩放与元数据同步问题
- 跨平台缩放不一致

### 3. 跨平台兼容性问题

**问题描述**：
- MathJax 渲染与 Word 原生字体不一致
- 不同 Office 版本的字体处理差异
- 字体回退机制不完善

## 修复方案

### 方案 1：改进字体样式应用

```python
# src/backend/render/font_handler.py

class FontHandler:
    """处理字体样式和缩放"""
    
    FONT_STYLE_COMMANDS = {
        'roman': '\\mathrm',
        'bold': '\\mathbf',
        'italic': '\\mathit',
        'bold_italic': '\\bm',
    }
    
    def apply_font_style(self, latex: str, style: str) -> str:
        """应用字体样式到 LaTeX"""
        if style == 'tex' or self._has_font_style(latex):
            return latex
        
        # 处理嵌套公式
        segments = self._split_by_math_delimiters(latex)
        wrapped_segments = []
        
        for segment in segments:
            if self._is_math_content(segment):
                wrapped_segments.append(self._wrap_font_style(segment, style))
            else:
                wrapped_segments.append(segment)
        
        return ''.join(wrapped_segments)
    
    def _wrap_font_style(self, latex: str, style: str) -> str:
        """包装字体样式"""
        command = self.FONT_STYLE_COMMANDS.get(style)
        if not command:
            return latex
        return f"{{{command}}}{{{latex}}}"
    
    def _split_by_math_delimiters(self, source: str) -> list:
        """按数学分隔符分割"""
        segments = []
        current = []
        in_math = False
        
        for char in source:
            if char == '$':
                if in_math:
                    current.append('$')
                    segments.append(''.join(current))
                    current = []
                    in_math = False
                else:
                    segments.append(''.join(current))
                    current = ['$']
                    in_math = True
            else:
                current.append(char)
        
        if current:
            segments.append(''.join(current))
        
        return segments
    
    def _is_math_content(self, segment: str) -> bool:
        """检查是否为数学内容"""
        return segment.startswith('$') and segment.endswith('$') and len(segment) > 2
    
    def _has_font_style(self, latex: str) -> bool:
        """检查是否已有字体样式"""
        for command in self.FONT_STYLE_COMMANDS.values():
            if command in latex:
                return True
        return False
```

### 方案 2：改进字体缩放

```python
# src/backend/render/scale_manager.py

class ScaleManager:
    """管理字体缩放"""
    
    MIN_SCALE = 0.1
    MAX_SCALE = 10.0
    DEFAULT_SCALE = 1.0
    
    def calculate_scale(
        self,
        font_scale: float,
        user_scale: float = 1.0,
        context_scale: float = 1.0
    ) -> float:
        """计算最终缩放比例"""
        scale = font_scale * user_scale * context_scale
        return max(self.MIN_SCALE, min(self.MAX_SCALE, scale))
    
    def clamp_scale(self, scale: float) -> float:
        """限制缩放比例在有效范围内"""
        return max(self.MIN_SCALE, min(self.MAX_SCALE, scale))
```

### 方案 3：跨平台兼容性

```python
# src/backend/render/cross_platform.py

class CrossPlatformFontHandler:
    """跨平台字体处理"""
    
    PLATFORM_STYLES = {
        'windows': {
            'roman': '\\mathrm',
            'bold': '\\mathbf',
            'italic': '\\mathit',
        },
        'macos': {
            'roman': '\\textrm',
            'bold': '\\textbf',
            'italic': '\\textit',
        },
        'linux': {
            'roman': '\\mathrm',
            'bold': '\\bm',
            'italic': '\\mathit',
        },
    }
    
    def get_compatible_style(self, latex: str, style: str, platform: str) -> str:
        """获取平台兼容的字体样式"""
        styles = self.PLATFORM_STYLES.get(platform, self.PLATFORM_STYLES['windows'])
        command = styles.get(style)
        
        if not command:
            return latex
        
        return f"{command}{{{latex}}}"
```

## 测试用例

```python
# tests/test_font_handler.py

import pytest
from src.backend.render.font_handler import FontHandler

class TestFontHandler:
    def setup_method(self):
        self.handler = FontHandler()
    
    def test_apply_font_style_simple(self):
        latex = "E = mc^2"
        result = self.handler.apply_font_style(latex, 'bold')
        assert "\\mathbf{E = mc^2}" == result
    
    def test_apply_font_style_nested(self):
        latex = "x^2 + y^2 = z^2"
        result = self.handler.apply_font_style(latex, 'italic')
        assert "\\mathit{x^2 + y^2 = z^2}" == result
    
    def test_apply_font_style_already_has_style(self):
        latex = "\\mathrm{E = mc^2}"
        result = self.handler.apply_font_style(latex, 'bold')
        assert latex == result
    
    def test_split_by_math_delimiters(self):
        source = "text $x^2$ more text"
        segments = self.handler._split_by_math_delimiters(source)
        assert ["text ", "$x^2$", " more text"] == segments

# tests/test_scale_manager.py

from src.backend.render.scale_manager import ScaleManager

class TestScaleManager:
    def setup_method(self):
        self.manager = ScaleManager()
    
    def test_calculate_scale_normal(self):
        result = self.manager.calculate_scale(1.5, 2.0, 1.0)
        assert 3.0 == result
    
    def test_calculate_scale_exceeds_max(self):
        result = self.manager.calculate_scale(10.0, 10.0, 1.0)
        assert 10.0 == result
    
    def test_calculate_scale_below_min(self):
        result = self.manager.calculate_scale(0.01, 0.01, 1.0)
        assert 0.1 == result
```

## 实施步骤

### 阶段 1：修复字体样式应用（1-2天）

1. 创建 `FontHandler` 类
2. 实现嵌套公式处理
3. 改进多行环境处理
4. 添加单元测试

### 阶段 2：修复字体缩放（1天）

1. 创建 `ScaleManager` 类
2. 实现缩放计算逻辑
3. 添加缩放限制
4. 添加单元测试

### 阶段 3：改进跨平台兼容性（1-2天）

1. 创建 `CrossPlatformFontHandler` 类
2. 实现平台特定的字体处理
3. 添加字体回退机制
4. 添加跨平台测试

### 阶段 4：集成测试（1天）

1. 端到端测试
2. 性能测试
3. 用户测试

## 验收标准

1. **字体样式**：所有字体样式正确应用，嵌套公式处理正确
2. **字体缩放**：缩放比例正确计算，限制正确应用
3. **跨平台兼容性**：Windows、macOS、Linux 字体一致
4. **测试覆盖**：单元测试覆盖率 > 80%
