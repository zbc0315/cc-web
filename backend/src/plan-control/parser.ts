// backend/src/plan-control/parser.ts
import { ASTNode, StatementType, CallArg } from './types';

const IDENTIFIER_RE = /^[a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$/;
const VARREF_RE = /^\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}$/;
const INTERPOLATION_RE = /\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}/g;

/** Parse a single line (after indent stripping) into an ASTNode-like object. */
export function parseLine(raw: string, line: number, indent: number): ASTNode {
  const base: ASTNode = { line, indent, type: 'blank', raw, children: [] };

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    base.type = trimmed.startsWith('#') ? 'comment' : 'blank';
    return base;
  }

  // task_assign: identifier = task description
  const taskAssignMatch = trimmed.match(/^([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+=\s+task\s+(.+)$/);
  if (taskAssignMatch) {
    base.type = 'task_assign';
    base.varName = taskAssignMatch[1];
    base.description = taskAssignMatch[2];
    return base;
  }

  // var_assign: identifier = [list]
  const varAssignMatch = trimmed.match(/^([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+=\s+\[([^\]]*)\]$/);
  if (varAssignMatch) {
    base.type = 'var_assign';
    base.varName = varAssignMatch[1];
    const inner = varAssignMatch[2].trim();
    base.listItems = inner === '' ? [] : inner.split(',').map(s => s.trim());
    return base;
  }

  // task: task description
  if (trimmed.startsWith('task ')) {
    base.type = 'task';
    base.description = trimmed.slice(5);
    return base;
  }

  // if: if condition:
  const ifMatch = trimmed.match(/^if\s+(.+):$/);
  if (ifMatch) {
    base.type = 'if';
    base.condition = ifMatch[1];
    return base;
  }

  // elif: elif condition:
  const elifMatch = trimmed.match(/^elif\s+(.+):$/);
  if (elifMatch) {
    base.type = 'elif';
    base.condition = elifMatch[1];
    return base;
  }

  // else:
  if (trimmed === 'else:') {
    base.type = 'else';
    return base;
  }

  // for: for var in ${ref}:
  const forMatch = trimmed.match(/^for\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+in\s+\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}:$/);
  if (forMatch) {
    base.type = 'for';
    base.iterVar = forMatch[1];
    base.iterRef = forMatch[2];
    return base;
  }

  // loop: loop N [as counter]:
  const loopMatch = trimmed.match(/^loop\s+(\d+)(?:\s+as\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*))?:$/);
  if (loopMatch) {
    base.type = 'loop';
    base.loopCount = parseInt(loopMatch[1], 10);
    if (loopMatch[2]) base.loopCounter = loopMatch[2];
    return base;
  }

  // func: func name(params):
  const funcMatch = trimmed.match(/^func\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\(([^)]*)\):$/);
  if (funcMatch) {
    base.type = 'func';
    base.funcName = funcMatch[1];
    const paramStr = funcMatch[2].trim();
    base.params = paramStr === '' ? [] : paramStr.split(/,\s*/).map(s => s.trim());
    return base;
  }

  // call: call name(args)
  const callMatch = trimmed.match(/^call\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\(([^)]*)\)$/);
  if (callMatch) {
    base.type = 'call';
    base.funcName = callMatch[1];
    base.args = parseArgList(callMatch[2]);
    return base;
  }

  if (trimmed === 'break') { base.type = 'break'; return base; }
  if (trimmed === 'continue') { base.type = 'continue'; return base; }
  if (trimmed === 'return') { base.type = 'return'; return base; }

  // Unrecognized line — treated as parse error (checker will flag it)
  return base;
}

function parseArgList(argStr: string): CallArg[] {
  const s = argStr.trim();
  if (s === '') return [];
  const args: CallArg[] = [];
  // Split by commas, respecting brackets
  let depth = 0, start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || (s[i] === ',' && depth === 0)) {
      const part = s.slice(start, i).trim();
      const varMatch = part.match(VARREF_RE);
      if (varMatch) {
        args.push({ type: 'var', name: varMatch[1] });
      } else if (part.startsWith('[') && part.endsWith(']')) {
        const inner = part.slice(1, -1).trim();
        args.push({ type: 'list', items: inner === '' ? [] : inner.split(',').map(x => x.trim()) });
      }
      start = i + 1;
    } else if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
  }
  return args;
}

/** Parse all lines and build indentation-based AST tree. */
export function parseProgram(source: string): ASTNode[] {
  const lines = source.split('\n');
  const nodes: ASTNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/\t/g, '  '); // normalize tabs
    const indentMatch = stripped.match(/^( *)/);
    const spaces = indentMatch ? indentMatch[1].length : 0;
    const indent = Math.floor(spaces / 2);
    const raw = stripped.trimStart();
    nodes.push(parseLine(raw, i + 1, indent)); // 1-based line numbers
  }

  return buildTree(nodes);
}

/** Build parent-child tree from flat indented nodes. */
function buildTree(flatNodes: ASTNode[]): ASTNode[] {
  const root: ASTNode[] = [];
  const stack: { indent: number; children: ASTNode[] }[] = [{ indent: -1, children: root }];

  for (const node of flatNodes) {
    if (node.type === 'blank' || node.type === 'comment') {
      // Attach to current parent
      stack[stack.length - 1].children.push(node);
      continue;
    }

    // Pop stack until we find a parent with lower indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= node.indent) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);

    // If this node can have children (block opener), push it
    if (['if', 'elif', 'else', 'for', 'loop', 'func'].includes(node.type)) {
      stack.push({ indent: node.indent, children: node.children });
    }
  }

  return root;
}

/** Collect all func definitions from AST (first pass). */
export function collectFuncs(ast: ASTNode[]): Map<string, ASTNode> {
  const funcs = new Map<string, ASTNode>();
  function walk(nodes: ASTNode[]) {
    for (const n of nodes) {
      if (n.type === 'func' && n.funcName) {
        funcs.set(n.funcName, n);
      }
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(ast);
  return funcs;
}

/** Interpolate ${var} references in a description string. */
export function interpolate(text: string, variables: Record<string, unknown>): string {
  return text.replace(INTERPOLATION_RE, (match, name) => {
    const val = variables[name];
    if (val === undefined || val === null) return match; // leave unresolved
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  });
}

/** Count estimated tasks in AST (loop N multiplied, for counted as 1x). */
export function estimateTasks(ast: ASTNode[], loopMultiplier = 1): number {
  let count = 0;
  for (const node of ast) {
    if (node.type === 'task' || node.type === 'task_assign') {
      count += loopMultiplier;
    } else if (node.type === 'loop' && node.loopCount) {
      count += estimateTasks(node.children, loopMultiplier * node.loopCount);
    } else if (node.children.length > 0) {
      count += estimateTasks(node.children, loopMultiplier);
    }
  }
  return count;
}
