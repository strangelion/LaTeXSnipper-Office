# Formula Library Integration

## 已有资源

### Obsidian Formula Library

**来源**：`C:\Users\WangWenXuan\Documents\GitHub\obsidian-formula-library`

**特点**：
- 2100+ 公式，18 个分类
- MathLive WYSIWYG 编辑器
- 智能搜索（拼音、LaTeX 命令、模糊匹配）
- 中英文本地化
- 可扩展的公式文件夹

**公式分类**：

| 分类 | 数量 | 描述 |
|------|------|------|
| Greek | 52 | 希腊字母 |
| Structures | 43 | 分数、根号、积分、求和、矩阵 |
| Delimiters | 36 | 括号、方括号、花括号、绝对值 |
| Analysis | 210 | 实分析、复分析、泛函分析、测度论 |
| Algebra | 174 | 线性代数、群论、环论、模论 |
| Geometry | 133 | 经典几何、微分几何、黎曼几何、辛几何 |
| Topology | 166 | 点集拓扑、代数拓扑、微分拓扑 |
| Number Theory | 166 | 初等数论、解析数论、代数数论、模形式 |
| Relations | 112 | 等式、序关系、子集、逻辑 |
| Operators | 64 | 算术运算符、集合运算符、逻辑运算符 |
| Big Ops | 20 | 求和、乘积、积分、并集、交集 |
| Arrows | 68 | 各种箭头符号 |
| Sets | 40 | 集合论、逻辑、基数 |
| Functions | 131 | 初等函数、特殊函数、分布 |
| Probability | 170 | 分布、定理、随机过程 |
| Physics | 251 | 力学、电磁学、量子力学、相对论、量子场论 |
| Chemistry | 229 | 反应、分子、离子、热力学 |
| Misc | 56 | 省略号、无穷大、特殊符号 |

## 整合方案

### 方案 1：直接复用公式数据

```typescript
// src/webapp/lib/formula-data.ts

import greekFormulas from '../../formulas/greek.json';
import structuresFormulas from '../../formulas/structures.json';
import analysisFormulas from '../../formulas/analysis.json';
// ... 其他分类

export interface Formula {
  id: string;
  latex: string;
  label?: string;
  labelEn?: string;
  keywords?: string[];
}

export interface FormulaCategory {
  id: string;
  name: string;
  nameEn: string;
  formulas: Formula[];
}

export const FORMULA_CATEGORIES: FormulaCategory[] = [
  {
    id: 'greek',
    name: '希腊字母',
    nameEn: 'Greek',
    formulas: greekFormulas.items,
  },
  {
    id: 'structures',
    name: '结构',
    nameEn: 'Structures',
    formulas: structuresFormulas.items,
  },
  // ... 其他分类
];
```

### 方案 2：复用 MathLive 编辑器

```typescript
// src/webapp/components/FormulaEditor.tsx

import { MathfieldElement } from 'mathlive';

interface FormulaEditorProps {
  value: string;
  onChange: (value: string) => void;
  displayMode?: boolean;
  fontStyle?: 'tex' | 'roman' | 'bold' | 'italic';
}

export function FormulaEditor({
  value,
  onChange,
  displayMode = false,
  fontStyle = 'tex',
}: FormulaEditorProps) {
  const mathfieldRef = useRef<MathfieldElement>(null);

  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!mf) return;

    mf.setValue(value, { silenceNotifications: true });
    
    const handleInput = () => {
      onChange(mf.getValue('latex-expanded'));
    };
    
    mf.addEventListener('input', handleInput);
    return () => mf.removeEventListener('input', handleInput);
  }, [value, onChange]);

  useEffect(() => {
    const mf = mathfieldRef.current;
    if (!mf) return;

    // 应用字体样式
    const fontFamily = {
      tex: '',
      roman: 'Cambria Math',
      bold: 'Cambria Math Bold',
      italic: 'Cambria Math Italic',
    }[fontStyle];

    if (fontFamily) {
      mf.style.fontFamily = fontFamily;
    }
  }, [fontStyle]);

  return (
    <math-field-element
      ref={mathfieldRef}
      style={{ minHeight: '60px' }}
      default-mode={displayMode ? 'display' : 'inline'}
    />
  );
}
```

### 方案 3：复用智能搜索

```typescript
// src/webapp/lib/formula-search.ts

import { Formula, FORMULA_CATEGORIES } from './formula-data';

interface SearchResult {
  formula: Formula;
  score: number;
  category: string;
}

export class FormulaSearch {
  private pinyinMap: Map<string, string> = new Map();
  private latexAliases: Map<string, string> = new Map();

  constructor() {
    this.initPinyinMap();
    this.initLatexAliases();
  }

  private initPinyinMap() {
    // 初始化拼音映射
    // 例如：'alpha' -> 'α', 'beta' -> 'β'
  }

  private initLatexAliases() {
    // 初始化 LaTeX 命令别名
    // 例如：'frac' -> '分数', 'sqrt' -> '根号'
  }

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const normalizedQuery = query.toLowerCase().trim();

    for (const category of FORMULA_CATEGORIES) {
      for (const formula of category.formulas) {
        const score = this.calculateScore(formula, normalizedQuery);
        if (score > 0) {
          results.push({
            formula,
            score,
            category: category.name,
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 20);
  }

  private calculateScore(formula: Formula, query: string): number {
    let score = 0;

    // 匹配 LaTeX 命令
    if (formula.latex.toLowerCase().includes(query)) {
      score += 10;
    }

    // 匹配标签
    if (formula.label?.toLowerCase().includes(query)) {
      score += 5;
    }

    if (formula.labelEn?.toLowerCase().includes(query)) {
      score += 5;
    }

    // 匹配拼音
    const pinyin = this.pinyinMap.get(formula.label || '');
    if (pinyin?.includes(query)) {
      score += 8;
    }

    // 匹配关键词
    if (formula.keywords?.some(kw => kw.toLowerCase().includes(query))) {
      score += 3;
    }

    return score;
  }
}
```

## 文件结构

```
LaTeXSnipper-Office/
├── src/
│   ├── webapp/
│   │   ├── lib/
│   │   │   ├── formula-data.ts      # 公式数据
│   │   │   ├── formula-search.ts    # 搜索功能
│   │   │   └── formula-export.ts    # 导出功能
│   │   ├── components/
│   │   │   ├── FormulaEditor.tsx     # 公式编辑器
│   │   │   ├── FormulaLibrary.tsx    # 公式库界面
│   │   │   └── FormulaSearch.tsx     # 搜索界面
│   │   └── ...
│   └── ...
├── formulas/                         # 公式数据（从 Obsidian 项目复制）
│   ├── _index.json
│   ├── _strings.json
│   ├── greek.json
│   ├── structures.json
│   ├── analysis.json
│   └── ...
└── ...
```

## 复用清单

### 可直接复用的代码

1. **公式数据**：`formulas/` 目录下的所有 JSON 文件
2. **MathLive 集成**：编辑器组件和配置
3. **搜索算法**：拼音、LaTeX 命令、模糊匹配
4. **本地化字符串**：中英文 UI 文本
5. **键盘快捷键**：分数、根号、上下标等

### 需要适配的代码

1. **Obsidian API**：替换为通用 WebView API
2. **文件系统**：替换为 HTTP API 或本地存储
3. **插件系统**：替换为独立应用架构

## 实施步骤

### 阶段 1：复制公式数据（1小时）

1. 复制 `formulas/` 目录到新项目
2. 调整文件路径
3. 验证数据完整性

### 阶段 2：复用 MathLive 编辑器（1天）

1. 提取 MathLive 集成代码
2. 创建通用编辑器组件
3. 添加字体样式支持

### 阶段 3：复用搜索功能（1天）

1. 提取搜索算法
2. 创建通用搜索组件
3. 优化搜索性能

### 阶段 4：集成测试（1天）

1. 测试公式插入
2. 测试搜索功能
3. 测试跨平台兼容性

## 验收标准

1. **公式数据**：所有 2100+ 公式正确加载
2. **搜索功能**：拼音、LaTeX 命令、模糊匹配正常工作
3. **编辑器**：MathLive 编辑器正常运行
4. **性能**：搜索响应时间 < 100ms
