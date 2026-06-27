// 公式库数据加载器
// 从本地 JSON 文件加载 Obsidian 公式库数据

export async function loadFormulaData() {
  Logger.debug('Loading formula data from local files...');
  
  const categories = [];
  const formulas = {};
  
  try {
    // 加载分类索引
    const indexResponse = await fetch('/formulas/_index.json');
    const indexData = await indexResponse.json();
    
    // 加载每个分类的公式
    for (const categoryId of indexData.order) {
      try {
        const response = await fetch(`/formulas/${categoryId}.json`);
        const data = await response.json();
        
        categories.push({
          id: categoryId,
          name: getCategoryName(categoryId),
          nameEn: getCategoryNameEn(categoryId),
        });
        
        formulas[categoryId] = data.items.map(item => ({
          latex: item.latex,
          label: item.label || item.latex.substring(0, 20),
          labelEn: item.labelEn || item.label || item.latex.substring(0, 20),
        }));
        
        Logger.debug(`Loaded ${formulas[categoryId].length} formulas for ${categoryId}`);
      } catch (e) {
        Logger.warn(`Failed to load category ${categoryId}:`, e.message);
      }
    }
    
    Logger.info(`Loaded ${categories.length} categories, ${Object.values(formulas).flat().length} total formulas`);
    
  } catch (e) {
    Logger.error('Failed to load formula data:', e);
  }
  
  return { categories, formulas };
}

function getCategoryName(id) {
  const names = {
    'greek': '希腊字母',
    'structures': '结构',
    'delimiters': '定界符',
    'analysis': '分析',
    'algebra': '代数',
    'geometry': '几何',
    'topology': '拓扑',
    'numberTheory': '数论',
    'relations': '关系',
    'operators': '运算符',
    'bigops': '大运算符',
    'arrows': '箭头',
    'sets': '集合',
    'functions': '函数',
    'probability': '概率',
    'physics': '物理',
    'chemistry': '化学',
    'misc': '其他',
  };
  return names[id] || id;
}

function getCategoryNameEn(id) {
  const names = {
    'greek': 'Greek',
    'structures': 'Structures',
    'delimiters': 'Delimiters',
    'analysis': 'Analysis',
    'algebra': 'Algebra',
    'geometry': 'Geometry',
    'topology': 'Topology',
    'numberTheory': 'Number Theory',
    'relations': 'Relations',
    'operators': 'Operators',
    'bigops': 'Big Operators',
    'arrows': 'Arrows',
    'sets': 'Sets',
    'functions': 'Functions',
    'probability': 'Probability',
    'physics': 'Physics',
    'chemistry': 'Chemistry',
    'misc': 'Miscellaneous',
  };
  return names[id] || id;
}
