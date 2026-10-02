import path from 'node:path';

import ts from 'typescript';

export interface CssDeclaration {
  selector: string;
  property: string;
  value: string;
  line: number;
}

/** 注释等长替换；保留媒体查询上下文与原始行号，供所有 CSS 护栏共用。 */
export function parseCssDeclarations(css: string): CssDeclaration[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  const declarations: CssDeclaration[] = [];
  const selectorStack: string[] = [];
  let buffer = '';
  let line = 1;
  let quote = '';
  let escaped = false;
  let parentheses = 0;
  function flush(): void {
    const declaration = buffer.trim();
    const colon = declaration.indexOf(':');
    if (colon > 0 && selectorStack.length > 0) {
      declarations.push({
        selector: selectorStack.join(' '),
        property: declaration.slice(0, colon).trim(),
        value: declaration.slice(colon + 1).trim(),
        line,
      });
    }
    buffer = '';
  }
  for (const char of source) {
    if (quote) {
      buffer += char;
      if (char === '\n') line += 1;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === '\n') {
      line += 1;
      buffer += char;
      continue;
    }
    if (char === '(') parentheses += 1;
    if (char === ')') parentheses -= 1;
    if (char === '{' && parentheses === 0) {
      selectorStack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
      continue;
    }
    if (char === '}' && parentheses === 0) {
      // CSS 的最后一条声明可以省略分号，不能因此漏掉表面或主题契约。
      flush();
      selectorStack.pop();
      buffer = '';
      continue;
    }
    if (char === ';' && parentheses === 0) {
      flush();
      continue;
    }
    buffer += char;
  }
  return declarations;
}

function selectorsOf(selector: string): string[] {
  return selector
    .replace(/@[^{}]*?(?=\.[\w-]|:root|::)/g, '')
    .split(',')
    .map((part) => part.trim());
}

/** 按完整选择器合并声明，不依赖 card/badge 等类名后缀。 */
export function surfaceShellSelectors(declarations: readonly CssDeclaration[]): string[] {
  const properties = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    if (declaration.property.startsWith('--')) continue;
    for (const selector of selectorsOf(declaration.selector)) {
      const seen = properties.get(selector) ?? new Set<string>();
      seen.add(declaration.property);
      properties.set(selector, seen);
    }
  }
  return [...properties]
    .filter(([, props]) => {
      const background = props.has('background') || props.has('background-color');
      const radius = props.has('border-radius');
      const shell = [...props].some((prop) => /^padding(?:-|$)/u.test(prop)) || props.has('border');
      return background && radius && shell;
    })
    .map(([selector]) => selector)
    .sort();
}

export function fixedMaxWidthSelectors(declarations: readonly CssDeclaration[]): string[] {
  return [
    ...new Set(
      declarations
        .filter((item) => item.property === 'max-width' && /\d+(?:\.\d+)?px/u.test(item.value))
        .flatMap((item) => selectorsOf(item.selector)),
    ),
  ].sort();
}

export function themeTokenIssues(
  declarations: readonly CssDeclaration[],
  schemes: readonly string[],
  tokens: readonly string[],
): string[] {
  const issues: string[] = [];
  for (const scheme of schemes) {
    for (const mode of ['light', 'dark']) {
      const selector = `:root[data-theme='${mode}'][data-scheme='${scheme}']`;
      const items = declarations.filter(
        (item) => selectorsOf(item.selector).includes(selector) && item.property.startsWith('--'),
      );
      for (const token of tokens) {
        const count = items.filter((item) => item.property === token).length;
        if (count !== 1) issues.push(`${selector} ${token}: 定义 ${count} 次，应为 1 次`);
      }
      for (const item of items) {
        if (!tokens.includes(item.property))
          issues.push(`${selector} 未登记 Token ${item.property}`);
      }
    }
  }
  const actual = new Set(
    declarations
      .flatMap((item) => selectorsOf(item.selector))
      .filter((selector) => /^:root\[data-theme=.*\[data-scheme=/u.test(selector)),
  );
  const expected = new Set(
    schemes.flatMap((scheme) =>
      ['light', 'dark'].map((mode) => `:root[data-theme='${mode}'][data-scheme='${scheme}']`),
    ),
  );
  for (const selector of actual)
    if (!expected.has(selector)) issues.push(`未登记主题变体 ${selector}`);
  return issues;
}

export interface UiSource {
  file: string;
  text: string;
}

/** docs/10 §10.1 的机器可核对台账：真实组件导出与表格逐项双向匹配。 */
export function componentCatalogIssues(markdown: string, sources: readonly UiSource[]): string[] {
  const start = markdown.indexOf('#### 10.1.2 当前组件台账');
  const end = markdown.indexOf('#### 10.1.3', start);
  if (start < 0 || end < 0) return ['docs/10 缺少当前组件台账边界'];
  const root = 'apps/desktop/src/renderer/src/';
  const documented: string[] = [];
  const issues: string[] = [];
  for (const row of markdown.slice(start, end).split('\n')) {
    if (!row.startsWith('| `')) continue;
    const cells = row.split('|');
    const file = /`([^`]+\.tsx)`/u.exec(cells[2] ?? '')?.[1];
    const names = [...(cells[1] ?? '').matchAll(/`([A-Z]\w*)`/gu)].map((match) => match[1] ?? '');
    if (!file || names.length === 0) {
      issues.push(`台账行无法解析：${row}`);
      continue;
    }
    for (const name of names) documented.push(`${root}${file}#${name}`);
  }
  if (documented.length === 0) issues.push('当前组件台账为空');
  const actual: string[] = [];
  for (const input of sources) {
    if (!input.file.startsWith(`${root}components/`)) continue;
    const source = ts.createSourceFile(
      input.file,
      input.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    for (const node of source.statements) {
      if (
        !ts.canHaveModifiers(node) ||
        !ts.getModifiers(node)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/u.test(node.name.text))
        actual.push(`${input.file}#${node.name.text}`);
      if (ts.isVariableStatement(node)) {
        for (const item of node.declarationList.declarations) {
          if (
            ts.isIdentifier(item.name) &&
            /^[A-Z]/u.test(item.name.text) &&
            item.initializer &&
            (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))
          )
            actual.push(`${input.file}#${item.name.text}`);
        }
      }
    }
  }
  for (const key of actual) if (!documented.includes(key)) issues.push(`组件未登记：${key}`);
  for (const key of documented) {
    if (!actual.includes(key)) issues.push(`台账没有真实导出：${key}`);
    if (documented.filter((item) => item === key).length !== 1) issues.push(`台账重复登记：${key}`);
  }
  return issues;
}

export interface InlineStyleOutlet {
  file: string;
  tag: string;
  className?: string;
  attribute: string;
  expression: string;
  reason: string;
}

function compact(text: string): string {
  return text.replace(/\s+/gu, '');
}

function expressionText(node: ts.Expression, source: ts.SourceFile): string {
  let expression = node;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return expression.getText(source);
}

/** style 的值可以是对象、变量、条件或展开式；未登记的出口一律进入审阅。 */
export function inlineStyleIssues(
  source: UiSource,
  outlets: readonly InlineStyleOutlet[],
): string[] {
  const file = ts.createSourceFile(
    source.file,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const issues: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const classAttribute = node.attributes.properties.find(
        (attr) => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'className',
      );
      const className =
        classAttribute &&
        ts.isJsxAttribute(classAttribute) &&
        classAttribute.initializer &&
        ts.isStringLiteral(classAttribute.initializer)
          ? classAttribute.initializer.text
          : undefined;
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          ['style', 'customStyle', 'codeTagProps'].includes(attr.name.getText(file))
        ) {
          const attribute = attr.name.getText(file);
          const expression =
            attr.initializer && ts.isJsxExpression(attr.initializer)
              ? (attr.initializer.expression?.getText(file) ?? '')
              : (attr.initializer?.getText(file) ?? '');
          if (
            !outlets.some(
              (outlet) =>
                outlet.file === source.file &&
                outlet.tag === tag &&
                outlet.className === className &&
                outlet.attribute === attribute &&
                compact(outlet.expression) === compact(expression),
            )
          ) {
            const line = file.getLineAndCharacterOfPosition(attr.getStart(file)).line + 1;
            issues.push(`${source.file}:${line} <${tag}> ${attribute} 未登记：${expression}`);
          }
        } else if (ts.isJsxSpreadAttribute(attr)) {
          if (
            outlets.some(
              (outlet) =>
                outlet.file === source.file &&
                outlet.tag === tag &&
                outlet.className === className &&
                outlet.attribute === 'spread' &&
                compact(outlet.expression) === compact(expressionText(attr.expression, file)),
            )
          )
            continue;
          function inspectSpread(part: ts.Node): void {
            if (
              ts.isPropertyAssignment(part) &&
              ['style', 'customStyle'].includes(part.name.getText(file).replace(/['"]/gu, ''))
            ) {
              issues.push(
                `${source.file}:${file.getLineAndCharacterOfPosition(part.getStart(file)).line + 1} 展开属性包含未登记 style`,
              );
            }
            ts.forEachChild(part, inspectSpread);
          }
          inspectSpread(attr.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return issues;
}

export interface PageShapeException {
  file: string;
  component: string;
  required: readonly string[];
  /** 每组至少实际渲染一个出口；用于内嵌列表的内容/加载/空态分支。 */
  alternatives?: readonly (readonly string[])[];
  reason: string;
}

interface ComponentBody {
  key: string;
  source: ts.SourceFile;
  expressions: readonly ts.Expression[];
  exported: boolean;
}

function returnBranches(expression: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expression)) return returnBranches(expression.expression);
  if (ts.isConditionalExpression(expression))
    return [...returnBranches(expression.whenTrue), ...returnBranches(expression.whenFalse)];
  return [expression];
}

/** 跟随返回表达式里的实际组件调用；导入但不渲染、只在点击回调中写 JSX 均不计。 */
export function pageCompositionIssues(
  sources: readonly UiSource[],
  exceptions: readonly PageShapeException[],
): string[] {
  const components = new Map<string, ComponentBody>();
  const imports = new Map<string, Map<string, string>>();
  const filenames = new Set(sources.map((source) => source.file));
  for (const input of sources) {
    const source = ts.createSourceFile(
      input.file,
      input.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const bindings = new Map<string, string>();
    const exportedNames = new Set<string>();
    for (const statement of source.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements)
          exportedNames.add(element.propertyName?.text ?? element.name.text);
      } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression))
        exportedNames.add(statement.expression.text);
    }
    function register(
      name: string,
      node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
      exported: boolean,
    ): void {
      const expressions: ts.Expression[] = [];
      function returns(part: ts.Node): void {
        if (part !== node && ts.isFunctionLike(part)) return;
        if (ts.isReturnStatement(part) && part.expression)
          expressions.push(...returnBranches(part.expression));
        ts.forEachChild(part, returns);
      }
      if (node.body && !ts.isBlock(node.body)) expressions.push(...returnBranches(node.body));
      else returns(node);
      components.set(`${input.file}#${name}`, {
        key: `${input.file}#${name}`,
        source,
        expressions,
        exported:
          (exported || exportedNames.has(name)) &&
          (/^[A-Z]/u.test(name) || Boolean(node.type?.getText(source).includes('JSX.Element'))),
      });
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const module = statement.moduleSpecifier.text;
        if (!module.startsWith('.')) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(input.file), module));
        const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((candidate) =>
          filenames.has(candidate),
        );
        const named = statement.importClause?.namedBindings;
        if (target && named && ts.isNamedImports(named)) {
          for (const element of named.elements)
            bindings.set(
              element.name.text,
              `${target}#${element.propertyName?.text ?? element.name.text}`,
            );
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        register(
          statement.name.text,
          statement,
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
            false,
        );
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const init = declaration.initializer;
          if (
            ts.isIdentifier(declaration.name) &&
            init &&
            (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          )
            register(
              declaration.name.text,
              init,
              statement.modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
              ) ?? false,
            );
        }
      }
    }
    imports.set(input.file, bindings);
  }
  function intersection(sets: readonly Set<string>[]): Set<string> {
    return new Set([...(sets[0] ?? [])].filter((item) => sets.every((set) => set.has(item))));
  }
  function rendered(
    expression: ts.Node,
    source: ts.SourceFile,
    seen: ReadonlySet<string>,
    alternatives: readonly (readonly string[])[],
  ): Set<string> {
    if (ts.isJsxAttribute(expression) || ts.isFunctionLike(expression)) return new Set();
    if (ts.isConditionalExpression(expression))
      return intersection([
        rendered(expression.whenTrue, source, seen, alternatives),
        rendered(expression.whenFalse, source, seen, alternatives),
      ]);
    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expression.operatorToken.kind)
    )
      return intersection([
        rendered(expression.left, source, seen, alternatives),
        rendered(expression.right, source, seen, alternatives),
      ]);
    const result = new Set<string>();
    if (ts.isJsxOpeningElement(expression) || ts.isJsxSelfClosingElement(expression)) {
      const name = expression.tagName.getText(source);
      const key = imports.get(source.fileName)?.get(name) ?? `${source.fileName}#${name}`;
      result.add(key);
      alternatives.forEach((group, index) => {
        if (group.includes(key)) result.add(`alternative:${index}`);
      });
      const body = components.get(key);
      if (body && !seen.has(key)) {
        const next = new Set([...seen, key]);
        // 包装可能返回 null，同样不能把内部的可选骨架读成宿主必有。
        const paths = body.expressions.map((child) =>
          rendered(child, body.source, next, alternatives),
        );
        for (const item of intersection(paths)) result.add(item);
      }
    }
    ts.forEachChild(expression, (child) => {
      for (const key of rendered(child, source, seen, alternatives)) result.add(key);
    });
    return result;
  }
  const issues: string[] = [];
  const layoutRoot = 'apps/desktop/src/renderer/src/components/layout/';
  for (const source of sources) {
    if (
      source.file.includes('/views/') &&
      ![...components.values()].some(
        (component) => component.source.fileName === source.file && component.exported,
      )
    )
      issues.push(
        `${source.file} 没有可追溯的视图导出入口；页面使用具名函数/函数表达式，纯函数放 lib`,
      );
  }
  for (const body of components.values()) {
    if (!body.exported || !body.source.fileName.includes('/views/')) continue;
    const component = body.key.split('#')[1] ?? '';
    const exception = exceptions.find(
      (item) => item.file === body.source.fileName && item.component === component,
    );
    const required = exception?.required ?? [
      `${layoutRoot}PageHeader.tsx#PageHeader`,
      `${layoutRoot}ScrollRegion.tsx#ScrollRegion`,
    ];
    let visible = 0;
    for (const expression of body.expressions) {
      if (
        expression.kind === ts.SyntaxKind.NullKeyword ||
        expression.getText(body.source) === 'undefined'
      )
        continue;
      visible += 1;
      const alternatives = exception?.alternatives ?? [];
      const used = rendered(expression, body.source, new Set([body.key]), alternatives);
      for (const key of required)
        if (!used.has(key))
          issues.push(
            `${body.key}:${body.source.getLineAndCharacterOfPosition(expression.getStart(body.source)).line + 1} 返回分支没有实际使用 ${key}`,
          );
      alternatives.forEach((group, index) => {
        if (!used.has(`alternative:${index}`))
          issues.push(`${body.key} 返回分支没有实际使用任一出口：${group.join(' 或 ')}`);
      });
    }
    if (visible === 0) issues.push(`${body.key} 无可追溯的页面返回分支`);
  }
  return issues;
}
