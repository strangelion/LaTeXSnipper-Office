export const NUMBERING_PRESETS = Object.freeze({
  parenthesized: { template: "({n})", style: "arabic", label: "圆括号 (1)" },
  bracketed: { template: "[{n}]", style: "arabic", label: "方括号 [1]" },
  dotted: { template: "{n}.", style: "arabic", label: "数字加点 1." },
  equation: { template: "式 {n}", style: "arabic", label: "中文 式 1" },
  roman: { template: "({n})", style: "roman-upper", label: "罗马数字 (I)" },
  alphabetic: {
    template: "({n})",
    style: "alpha-upper",
    label: "大写字母 (A)",
  },
  custom: { template: "({n})", style: "arabic", label: "自定义模板" },
});

export function validateNumberingTemplate(value) {
  const template = String(value || "").trim();
  const occurrences = template.match(/\{n\}/g)?.length || 0;
  if (occurrences !== 1) return "模板必须且只能包含一个 {n}";
  if (template.length > 32) return "编号模板不能超过 32 个字符";
  if (/[\u0000-\u001f\u007f]/.test(template))
    return "编号模板包含不可见控制字符";
  return "";
}

export function resolveNumberingPreference(input = {}) {
  const preset = NUMBERING_PRESETS[input.preset]
    ? input.preset
    : "parenthesized";
  const base = NUMBERING_PRESETS[preset];
  const template =
    preset === "custom" && !validateNumberingTemplate(input.template)
      ? String(input.template).trim()
      : base.template;
  return { preset, template, style: base.style };
}

function roman(value) {
  const table = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = Math.max(1, Math.floor(value));
  let output = "";
  for (const [amount, glyph] of table) {
    while (remaining >= amount) {
      output += glyph;
      remaining -= amount;
    }
  }
  return output;
}

function formattedNumber(style, value) {
  let number = String(Math.max(1, Math.floor(value)));
  if (style === "roman-upper") number = roman(value);
  if (style === "alpha-upper") {
    number = String.fromCharCode(
      65 + ((Math.max(1, Math.floor(value)) - 1) % 26),
    );
  }
  return number;
}

export function numberingPreview(preference, value = 1, options = {}) {
  const resolved = resolveNumberingPreference(preference);
  const sequence = formattedNumber(resolved.style, value);
  const scheme = options.scheme || "global";
  const chapter = String(Math.max(1, Math.floor(options.chapter || 2)));
  const number =
    scheme === "chapter-dot"
      ? `${chapter}.${sequence}`
      : scheme === "chapter-hyphen"
        ? `${chapter}-${sequence}`
        : sequence;
  return resolved.template.replace("{n}", number);
}
