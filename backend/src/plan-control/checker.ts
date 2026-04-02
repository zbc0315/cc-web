// backend/src/plan-control/checker.ts
import { ASTNode, CheckError } from './types';
import { collectFuncs } from './parser';

export function check(ast: ASTNode[]): CheckError[] {
  const errors: CheckError[] = [];
  const funcs = collectFuncs(ast);

  // Validate all nodes
  walkCheck(ast, errors, funcs, { inLoop: false, inFunc: false });

  // Check for recursion
  checkRecursion(funcs, errors);

  return errors;
}

function walkCheck(
  nodes: ASTNode[],
  errors: CheckError[],
  funcs: Map<string, ASTNode>,
  ctx: { inLoop: boolean; inFunc: boolean }
) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Skip blanks and comments
    if (node.type === 'blank' || node.type === 'comment') continue;

    // Check predecessor-task rule for if/elif with status conditions
    if ((node.type === 'if' || node.type === 'elif') && node.condition) {
      const isStatusCondition = ['success', 'failed', 'blocked'].includes(node.condition);
      if (isStatusCondition) {
        const hasPrecedingTask = nodes.slice(0, i).some(
          n => (n.type === 'task' || n.type === 'task_assign') && n.indent === node.indent
        );
        if (!hasPrecedingTask) {
          errors.push({
            line: node.line,
            message: `if/elif 使用状态条件 "${node.condition}" 时，同级前方必须存在 task 语句`,
          });
        }
      }
    }

    // break/continue must be inside a loop
    if (node.type === 'break' || node.type === 'continue') {
      if (!ctx.inLoop) {
        errors.push({ line: node.line, message: `${node.type} 必须在 for 或 loop 循环体内` });
      }
    }

    // return must be inside a function
    if (node.type === 'return') {
      if (!ctx.inFunc) {
        errors.push({ line: node.line, message: 'return 必须在 func 函数体内' });
      }
    }

    // call must reference a defined function
    if (node.type === 'call' && node.funcName) {
      if (!funcs.has(node.funcName)) {
        errors.push({ line: node.line, message: `未定义的函数: ${node.funcName}` });
      }
    }

    // Recurse into children with updated context
    if (node.children.length > 0) {
      const childCtx = {
        inLoop: ctx.inLoop || node.type === 'for' || node.type === 'loop',
        inFunc: ctx.inFunc || node.type === 'func',
      };
      walkCheck(node.children, errors, funcs, childCtx);
    }
  }
}

/** Detect recursion (direct + mutual) via call graph DFS cycle detection. */
function checkRecursion(funcs: Map<string, ASTNode>, errors: CheckError[]) {
  // Build call graph: func name -> set of called func names
  const callGraph = new Map<string, Set<string>>();
  for (const [name, node] of funcs) {
    const calls = new Set<string>();
    collectCalls(node.children, calls);
    callGraph.set(name, calls);
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(name: string): boolean {
    if (inStack.has(name)) return true; // cycle found
    if (visited.has(name)) return false;
    visited.add(name);
    inStack.add(name);
    for (const callee of callGraph.get(name) ?? []) {
      if (callGraph.has(callee) && dfs(callee)) {
        const funcNode = funcs.get(name)!;
        errors.push({ line: funcNode.line, message: `检测到递归调用: ${name} → ${callee}` });
        return true;
      }
    }
    inStack.delete(name);
    return false;
  }

  for (const name of funcs.keys()) {
    dfs(name);
  }
}

function collectCalls(nodes: ASTNode[], calls: Set<string>) {
  for (const node of nodes) {
    if (node.type === 'call' && node.funcName) {
      calls.add(node.funcName);
    }
    if (node.children.length > 0) collectCalls(node.children, calls);
  }
}
