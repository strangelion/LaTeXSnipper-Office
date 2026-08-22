const FUNCTIONS = Object.freeze({
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
});

function tokenize(source) {
  const tokens = [];
  const expression = String(source || "").trim();
  if (!expression) throw new Error("函数表达式不能为空");
  let offset = 0;
  while (offset < expression.length) {
    const tail = expression.slice(offset);
    const whitespace = tail.match(/^\s+/);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const number = tail.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]), raw: number[0] });
      offset += number[0].length;
      continue;
    }
    const identifier = tail.match(/^[a-z_][a-z\d_]*/i);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0].toLowerCase() });
      offset += identifier[0].length;
      continue;
    }
    const operator = tail[0];
    if ("+-*/^()".includes(operator)) {
      tokens.push({ type: operator, value: operator });
      offset += 1;
      continue;
    }
    throw new Error(`不支持的函数字符：${operator}`);
  }
  return tokens;
}

export function parsePlotExpression(source) {
  const tokens = tokenize(source);
  let position = 0;
  const peek = (type) => tokens[position]?.type === type;
  const take = (type) => {
    if (!peek(type)) throw new Error(`表达式缺少 ${type}`);
    return tokens[position++];
  };
  const primary = () => {
    if (peek("number")) {
      const token = take("number");
      return { type: "number", value: token.value, raw: token.raw };
    }
    if (peek("(")) {
      take("(");
      const value = additive();
      take(")");
      return value;
    }
    if (peek("identifier")) {
      const name = take("identifier").value;
      if (["x", "pi", "e"].includes(name)) {
        return { type: "symbol", name };
      }
      if (!Object.hasOwn(FUNCTIONS, name)) {
        throw new Error(`不支持的函数：${name}`);
      }
      take("(");
      const argument = additive();
      take(")");
      return { type: "call", name, argument };
    }
    throw new Error("函数表达式不完整");
  };
  const power = () => {
    const left = primary();
    if (!peek("^")) return left;
    take("^");
    return { type: "binary", operator: "^", left, right: unary() };
  };
  const unary = () => {
    if (peek("+") || peek("-")) {
      const operator = tokens[position++].type;
      return { type: "unary", operator, argument: unary() };
    }
    return power();
  };
  const multiplicative = () => {
    let value = unary();
    while (peek("*") || peek("/")) {
      const operator = tokens[position++].type;
      value = { type: "binary", operator, left: value, right: unary() };
    }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (peek("+") || peek("-")) {
      const operator = tokens[position++].type;
      value = {
        type: "binary",
        operator,
        left: value,
        right: multiplicative(),
      };
    }
    return value;
  };
  const result = additive();
  if (position !== tokens.length) throw new Error("表达式含有多余内容");
  return result;
}

function evaluate(node, x) {
  if (node.type === "number") return node.value;
  if (node.type === "symbol") {
    if (node.name === "x") return Number(x);
    return node.name === "pi" ? Math.PI : Math.E;
  }
  if (node.type === "unary") {
    const value = evaluate(node.argument, x);
    return node.operator === "-" ? -value : value;
  }
  if (node.type === "call")
    return FUNCTIONS[node.name](evaluate(node.argument, x));
  const left = evaluate(node.left, x);
  const right = evaluate(node.right, x);
  if (node.operator === "+") return left + right;
  if (node.operator === "-") return left - right;
  if (node.operator === "*") return left * right;
  if (node.operator === "/") return left / right;
  return left ** right;
}

export function evaluatePlotExpression(source, x) {
  return evaluate(parsePlotExpression(source), x);
}

function serializePgf(node) {
  if (node.type === "number") return node.raw;
  if (node.type === "symbol") {
    if (node.name === "e") return "exp(1)";
    return node.name;
  }
  if (node.type === "unary") {
    return `${node.operator}(${serializePgf(node.argument)})`;
  }
  if (node.type === "call") {
    const argument = serializePgf(node.argument);
    if (["sin", "cos", "tan"].includes(node.name)) {
      return `${node.name}(deg(${argument}))`;
    }
    const name = node.name === "log" ? "log10" : node.name;
    return `${name}(${argument})`;
  }
  return `(${serializePgf(node.left)})${node.operator}(${serializePgf(node.right)})`;
}

export function toPgfPlotsExpression(source) {
  return serializePgf(parsePlotExpression(source));
}
