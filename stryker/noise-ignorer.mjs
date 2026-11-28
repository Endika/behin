import { PluginKind, declareValuePlugin } from '@stryker-mutator/api/plugin';

const STYLE_ATTRIBUTES = new Set(['className', 'style']);

function isErrorMessage(path) {
  const parent = path.parentPath;
  return Boolean(
    parent?.isNewExpression() &&
      parent.node.callee.type === 'Identifier' &&
      /Error$/.test(parent.node.callee.name) &&
      parent.node.arguments.includes(path.node),
  );
}

function isAssertionLabel(path) {
  const parent = path.parentPath;
  if (!parent?.isCallExpression() || !parent.node.arguments.includes(path.node)) return false;
  const callee = parent.node.callee;
  const name = callee.type === 'Identifier' ? callee.name : callee.property?.name;
  return typeof name === 'string' && /^(assert|require)[A-Z]/.test(name);
}

function isStyleAttribute(path) {
  const attr = path.findParent((p) => p.isJSXAttribute());
  return Boolean(attr && STYLE_ATTRIBUTES.has(attr.node.name.name));
}

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, 'noise', {
    shouldIgnore(path) {
      if ((path.isStringLiteral() || path.isTemplateLiteral()) && isErrorMessage(path)) return 'Error message text is not part of the contract';
      if (path.isStringLiteral() && isAssertionLabel(path)) return 'Label only used in the assertion error message';
      if (path.isJSXAttribute() && STYLE_ATTRIBUTES.has(path.node.name.name)) return 'Styling is checked visually, not by unit tests';
      if (isStyleAttribute(path)) return 'Styling is checked visually, not by unit tests';
      return undefined;
    },
  }),
];
