// Bounded, deterministic structural suggestions, not mathematical inference.
const commands = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "theta",
  "lambda",
  "mu",
  "pi",
  "rho",
  "sigma",
  "tau",
  "phi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Pi",
  "Sigma",
  "Phi",
  "Psi",
  "Omega",
  "sin",
  "cos",
  "tan",
  "log",
  "ln",
  "exp",
  "min",
  "max",
  "det",
  "gcd",
  "infty",
  "cdot",
  "times",
  "div",
  "pm",
  "neq",
  "leq",
  "geq",
  "approx",
  "in",
  "subseteq",
  "cup",
  "cap",
  "forall",
  "exists",
  "to",
  "Rightarrow",
  "iint",
  "iiint",
  "oint",
  "prod",
  "vec{}",
  "hat{}",
  "bar{}",
  "overline{}",
  "underbrace{}",
  "mathbb{}",
  "mathcal{}",
  "mathit{}",
  "dfrac{}{}",
  "tfrac{}{}",
  "binom{}{}",
  "sqrt[]{}",
  "left(\\right)",
  "left[\\right]",
];
const environments = [
  "aligned",
  "matrix",
  "pmatrix",
  "bmatrix",
  "vmatrix",
  "cases",
];
export const completionPrefix = /\\(?:begin|end)\{[A-Za-z]*|\\[A-Za-z@]*|[\^_]/;

export function contextCompletions(textBefore, base, symbols = []) {
  const context = textBefore.slice(-8192).replace(/(^|[^\\])%[^\n]*/g, "$1");
  const options = new Map(base.map((option) => [option.label, { ...option }]));
  const add = (label, detail, boost = 0) => {
    const existing = options.get(label);
    if (!existing || boost > existing.boost)
      options.set(label, { label, detail, boost });
  };
  for (const command of commands) add(`\\${command}`, "命令/结构");
  for (const environment of environments)
    add(`\\begin{${environment}}\n  \\end{${environment}}`, "环境模板");
  for (const symbol of symbols.slice(0, 64)) {
    if (/^\\[A-Za-z@]+$/.test(symbol.label))
      add(symbol.label, `已保存符号 · ${symbol.name || "SVG/图片"}`, 1);
  }
  const used = new Set(context.match(/\\[A-Za-z@]+/g) || []);
  for (const option of options.values()) {
    const command = option.label.match(/^\\[A-Za-z@]+/)?.[0];
    if (used.has(command)) {
      option.boost += 1;
      option.detail += " · 本公式已使用";
    }
  }
  if (/\\(?:iint|iiint|int|oint)(?![A-Za-z@])/.test(context)) {
    add("\\mathrm{d}x", "积分微分模板", 9);
    add("\\mathrm{d}t", "积分微分模板", 8);
  }
  if (/\\partial(?![A-Za-z@])/.test(context))
    add("\\frac{\\partial }{\\partial x}", "偏导结构模板", 9);
  const stack = [];
  for (const match of context.matchAll(/\\(begin|end)\{([A-Za-z]+)\}/g)) {
    if (match[1] === "begin") stack.push(match[2]);
    else if (stack.at(-1) === match[2]) stack.pop();
  }
  const active = stack.at(-1);
  if (environments.includes(active))
    add(`\\end{${active}}`, "闭合当前环境", 10);
  for (const script of ["^{2}", "^{n}", "^{}", "_{i}", "_{n}", "_{0}", "_{}"])
    add(script, script.startsWith("^") ? "上标模板" : "下标模板");
  return [...options.values()];
}
