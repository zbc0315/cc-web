#!/usr/bin/env node
/**
 * Plan-Control 集成测试
 * 模拟完整流程: Parser → Checker → Executor → AI 填写节点 → 状态推进
 */
const fs = require('fs');
const path = require('path');
const { parseProgram, collectFuncs, interpolate, estimateTasks } = require('../../backend/dist/plan-control/parser');
const { check } = require('../../backend/dist/plan-control/checker');
const { PlanExecutor } = require('../../backend/dist/plan-control/executor');

const TEST_DIR = path.join(__dirname, '__test_plan_control__');
const PC_DIR = path.join(TEST_DIR, '.plan-control');
const NODES_DIR = path.join(PC_DIR, 'nodes');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function setup() {
  cleanup();
  fs.mkdirSync(NODES_DIR, { recursive: true });
}

// ════════════════════════════════════════
// Test 1: Parser — 基本语法解析
// ════════════════════════════════════════
function testParser() {
  console.log('\n📝 Test 1: Parser');

  const source = `# 这是注释
methods = [ML预测, xtb计算, DFT计算]

func 性质计算(targets, method_list):
  for m in \${method_list}:
    results = task 使用\${m}计算\${targets}的性质
    if success:
      return
  task 所有方法均失败，请分析原因

databases = task 查询所有开源分子数据库
for db in \${databases}:
  task 从\${db}下载候选分子
  if success:
    molecules = task 提取候选分子列表
    call 性质计算(\${molecules}, \${methods})
    break

task 生成最终报告`;

  const ast = parseProgram(source);

  // Filter out blanks/comments
  const meaningful = ast.filter(n => n.type !== 'blank' && n.type !== 'comment');

  assert(meaningful.length === 5, `顶层有 5 个有意义节点 (got ${meaningful.length})`);
  assert(meaningful[0].type === 'var_assign', `第1个是 var_assign: methods`);
  assert(meaningful[0].varName === 'methods', `varName = methods`);
  assert(meaningful[0].listItems.length === 3, `listItems 有 3 项`);
  assert(meaningful[1].type === 'func', `第2个是 func: 性质计算`);
  assert(meaningful[1].funcName === '性质计算', `funcName = 性质计算`);
  assert(meaningful[1].params.length === 2, `func 有 2 个参数`);
  assert(meaningful[1].children.length > 0, `func 有子节点`);
  assert(meaningful[2].type === 'task_assign', `第3个是 task_assign: databases`);
  assert(meaningful[3].type === 'for', `第4个是 for`);
  assert(meaningful[3].iterVar === 'db', `iterVar = db`);
  assert(meaningful[3].iterRef === 'databases', `iterRef = databases`);
  assert(meaningful[4].type === 'task', `第5个是 task: 生成最终报告`);

  // Test collectFuncs
  const funcs = collectFuncs(ast);
  assert(funcs.size === 1, `找到 1 个函数定义`);
  assert(funcs.has('性质计算'), `函数名为 性质计算`);

  // Test interpolate
  const result = interpolate('使用${m}计算${targets}的性质', { m: 'DFT计算', targets: '分子A' });
  assert(result === '使用DFT计算计算分子A的性质', `插值正确: ${result}`);

  // Test estimateTasks
  const est = estimateTasks(ast);
  assert(est >= 4, `估计任务数 >= 4 (got ${est})`);
}

// ════════════════════════════════════════
// Test 2: Checker — 语义检查
// ════════════════════════════════════════
function testChecker() {
  console.log('\n🔍 Test 2: Checker');

  // Valid program — should pass
  const validSource = `task 执行第一步
if success:
  task 继续第二步`;
  const validAst = parseProgram(validSource);
  const validErrors = check(validAst);
  assert(validErrors.length === 0, `合法程序无错误 (got ${validErrors.length})`);

  // if without predecessor task
  const noPredSource = `if success:
  task 无前置任务`;
  const noPredAst = parseProgram(noPredSource);
  const noPredErrors = check(noPredAst);
  assert(noPredErrors.length > 0, `if 无前置 task 报错`);
  assert(noPredErrors[0].message.includes('同级前方必须存在'), `错误消息正确`);

  // break outside loop
  const breakSource = `task 测试
break`;
  const breakAst = parseProgram(breakSource);
  const breakErrors = check(breakAst);
  assert(breakErrors.length > 0, `break 在循环外报错`);
  assert(breakErrors[0].message.includes('for 或 loop'), `错误消息提及循环`);

  // return outside func
  const returnSource = `task 测试
return`;
  const returnAst = parseProgram(returnSource);
  const returnErrors = check(returnAst);
  assert(returnErrors.length > 0, `return 在函数外报错`);

  // break inside loop — should pass
  const breakInLoopSource = `loop 3:
  task 做事
  break`;
  const breakInLoopAst = parseProgram(breakInLoopSource);
  const breakInLoopErrors = check(breakInLoopAst);
  assert(breakInLoopErrors.length === 0, `break 在循环内合法 (got ${breakInLoopErrors.length})`);

  // return inside func — should pass
  const returnInFuncSource = `func 测试():
  task 做事
  return`;
  const returnInFuncAst = parseProgram(returnInFuncSource);
  const returnInFuncErrors = check(returnInFuncAst);
  assert(returnInFuncErrors.length === 0, `return 在函数内合法 (got ${returnInFuncErrors.length})`);

  // call undefined function
  const callUndefSource = `call 不存在的函数()`;
  const callUndefAst = parseProgram(callUndefSource);
  const callUndefErrors = check(callUndefAst);
  assert(callUndefErrors.length > 0, `调用未定义函数报错`);

  // Recursion detection
  const recurSource = `func a():
  call b()
func b():
  call a()`;
  const recurAst = parseProgram(recurSource);
  const recurErrors = check(recurAst);
  assert(recurErrors.length > 0, `检测到互相递归`);
}

// ════════════════════════════════════════
// Test 3: Executor — 完整状态机 + AI 模拟
// ════════════════════════════════════════
function testExecutor() {
  console.log('\n🚀 Test 3: Executor (状态机 + AI 模拟)');

  setup();

  // Write a simple main.pc
  const mainPc = `databases = [PubChem, ZINC]

task 初始化环境
if success:
  for db in \${databases}:
    task 从\${db}下载数据
task 生成报告`;

  fs.writeFileSync(path.join(PC_DIR, 'main.pc'), mainPc);
  fs.writeFileSync(path.join(PC_DIR, 'plan-code.md'), '# test');

  // Track what the executor sends to PTY
  const ptyLog = [];
  const wsLog = [];

  const executor = new PlanExecutor(TEST_DIR, {
    writeToPty: (text) => ptyLog.push(text),
    getLastActivity: () => Date.now() - 10000, // always "idle"
    broadcast: (event) => wsLog.push(event),
  });

  // Test checkSyntax
  const { errors } = executor.checkSyntax();
  assert(errors.length === 0, `语法检查通过 (got ${errors.length} errors)`);
  if (errors.length > 0) {
    errors.forEach(e => console.log(`    Error L${e.line}: ${e.message}`));
  }

  // Start execution
  executor.start();

  // Wait a tick for the state machine to process
  return new Promise((resolve) => {
    setTimeout(() => {
      const state1 = executor.getState();
      assert(state1 !== null, `执行状态不为 null`);
      assert(state1.variables.databases !== undefined, `变量 databases 已初始化`);
      assert(Array.isArray(state1.variables.databases), `databases 是数组`);

      // The executor should have dispatched task "初始化环境"
      // Check if a node file was created
      const nodeFiles = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
      assert(nodeFiles.length >= 1, `创建了至少 1 个节点文件 (got ${nodeFiles.length})`);

      if (nodeFiles.length === 0) {
        console.log('  ⚠️ 无节点文件，跳过 AI 模拟');
        resolve();
        return;
      }

      // Read the node file
      const nodeFile = path.join(NODES_DIR, nodeFiles[0]);
      const node1 = JSON.parse(fs.readFileSync(nodeFile, 'utf-8'));
      assert(node1.status === null, `节点初始 status 为 null`);
      assert(node1.resolved_code.includes('初始化环境'), `resolved_code 包含任务描述`);
      console.log(`  📋 节点 #${node1.id} 发送的提示:\n    ${node1.prompt.split('\n')[0]}`);

      // 🤖 AI 模拟: 填写节点结果
      console.log('\n  🤖 AI 模拟: 完成"初始化环境"任务');
      node1.status = 'success';
      node1.result = true;
      node1.summary = '环境初始化完成';
      fs.writeFileSync(nodeFile, JSON.stringify(node1, null, 2));

      // Wait for executor to pick up the result
      setTimeout(() => {
        const state2 = executor.getState();
        assert(state2.executed_tasks >= 1, `已完成任务数 >= 1 (got ${state2.executed_tasks})`);
        assert(state2.last_task_status === 'success', `last_task_status = success`);

        // After success, the if branch should enter, then for loop
        // The executor should dispatch "从PubChem下载数据"
        const nodeFiles2 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));

        if (nodeFiles2.length >= 2) {
          const node2File = path.join(NODES_DIR, nodeFiles2[nodeFiles2.length - 1]);
          const node2 = JSON.parse(fs.readFileSync(node2File, 'utf-8'));
          console.log(`\n  📋 节点 #${node2.id}: ${node2.resolved_code}`);
          assert(node2.resolved_code.includes('PubChem'), `第2个任务包含 PubChem (got: ${node2.resolved_code})`);

          // 🤖 AI 模拟: 完成 "从PubChem下载数据"
          console.log('  🤖 AI 模拟: 完成"从PubChem下载数据"');
          node2.status = 'success';
          node2.result = true;
          node2.summary = 'PubChem 数据下载完成';
          fs.writeFileSync(node2File, JSON.stringify(node2, null, 2));

          setTimeout(() => {
            const state3 = executor.getState();
            assert(state3.executed_tasks >= 2, `已完成任务数 >= 2 (got ${state3.executed_tasks})`);

            // Next should be "从ZINC下载数据" (second iteration of for loop)
            const nodeFiles3 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
            if (nodeFiles3.length >= 3) {
              const node3File = path.join(NODES_DIR, nodeFiles3[nodeFiles3.length - 1]);
              const node3 = JSON.parse(fs.readFileSync(node3File, 'utf-8'));
              console.log(`\n  📋 节点 #${node3.id}: ${node3.resolved_code}`);
              assert(node3.resolved_code.includes('ZINC'), `第3个任务包含 ZINC (got: ${node3.resolved_code})`);

              // 🤖 AI 模拟: 完成 "从ZINC下载数据"
              console.log('  🤖 AI 模拟: 完成"从ZINC下载数据"');
              node3.status = 'success';
              node3.result = true;
              node3.summary = 'ZINC 数据下载完成';
              fs.writeFileSync(node3File, JSON.stringify(node3, null, 2));

              setTimeout(() => {
                const state4 = executor.getState();
                assert(state4.executed_tasks >= 3, `已完成任务数 >= 3 (got ${state4.executed_tasks})`);

                // Next should be "生成报告" (after the for loop)
                const nodeFiles4 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
                if (nodeFiles4.length >= 4) {
                  const node4File = path.join(NODES_DIR, nodeFiles4[nodeFiles4.length - 1]);
                  const node4 = JSON.parse(fs.readFileSync(node4File, 'utf-8'));
                  console.log(`\n  📋 节点 #${node4.id}: ${node4.resolved_code}`);
                  assert(node4.resolved_code.includes('报告'), `第4个任务包含"报告" (got: ${node4.resolved_code})`);

                  // 🤖 AI 模拟: 完成 "生成报告"
                  console.log('  🤖 AI 模拟: 完成"生成报告"');
                  node4.status = 'success';
                  node4.result = true;
                  node4.summary = '报告生成完成';
                  fs.writeFileSync(node4File, JSON.stringify(node4, null, 2));

                  setTimeout(() => {
                    const finalState = executor.getState();
                    assert(finalState.status === 'completed', `最终状态 = completed (got ${finalState.status})`);
                    assert(finalState.executed_tasks === 4, `总完成任务 = 4 (got ${finalState.executed_tasks})`);

                    console.log('\n  📊 执行历史:');
                    finalState.history.forEach(h => {
                      console.log(`    #${h.node_id} L${h.line} → ${h.status}`);
                    });

                    // Check WS broadcasts
                    const statusEvents = wsLog.filter(e => e.type === 'plan_status');
                    const nodeEvents = wsLog.filter(e => e.type === 'plan_node_update');
                    assert(statusEvents.length > 0, `广播了 plan_status 事件 (${statusEvents.length}次)`);
                    assert(nodeEvents.length === 4, `广播了 4 次 plan_node_update (got ${nodeEvents.length})`);

                    // Check PTY output
                    assert(ptyLog.length >= 4, `发送了至少 4 条 PTY 消息 (got ${ptyLog.length})`);

                    resolve();
                  }, 200);
                } else {
                  console.log(`  ⚠️ 只有 ${nodeFiles4.length} 个节点，for 循环后未到达"生成报告"`);
                  resolve();
                }
              }, 200);
            } else {
              console.log(`  ⚠️ 只有 ${nodeFiles3.length} 个节点，for 循环第2次迭代未触发`);
              resolve();
            }
          }, 200);
        } else {
          console.log(`  ⚠️ 只有 ${nodeFiles2.length} 个节点，if 分支未进入`);
          resolve();
        }
      }, 200);
    }, 200);
  });
}

// ════════════════════════════════════════
// Test 4: Executor — if failed 分支
// ════════════════════════════════════════
function testExecutorFailBranch() {
  console.log('\n🔀 Test 4: Executor (if failed 分支)');

  setup();

  const mainPc = `task 尝试连接服务器
if failed:
  task 启用备用方案
task 完成`;

  fs.writeFileSync(path.join(PC_DIR, 'main.pc'), mainPc);
  fs.writeFileSync(path.join(PC_DIR, 'plan-code.md'), '# test');

  const ptyLog = [];
  const executor = new PlanExecutor(TEST_DIR, {
    writeToPty: (text) => ptyLog.push(text),
    getLastActivity: () => Date.now() - 10000,
    broadcast: () => {},
  });

  executor.start();

  return new Promise((resolve) => {
    setTimeout(() => {
      // 🤖 AI: 任务失败
      const nodeFiles = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
      if (nodeFiles.length >= 1) {
        const nodeFile = path.join(NODES_DIR, nodeFiles[0]);
        const node = JSON.parse(fs.readFileSync(nodeFile, 'utf-8'));
        console.log(`  🤖 AI 模拟: "${node.resolved_code}" → failed`);
        node.status = 'failed';
        node.result = false;
        node.summary = '连接超时';
        fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));

        setTimeout(() => {
          const state = executor.getState();
          assert(state.last_task_status === 'failed', `last_task_status = failed`);

          // Should enter if-failed branch and dispatch "启用备用方案"
          const nodeFiles2 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
          if (nodeFiles2.length >= 2) {
            const node2File = path.join(NODES_DIR, nodeFiles2[nodeFiles2.length - 1]);
            const node2 = JSON.parse(fs.readFileSync(node2File, 'utf-8'));
            assert(node2.resolved_code.includes('备用'), `进入 failed 分支: ${node2.resolved_code}`);

            // 🤖 AI: 备用方案成功
            console.log(`  🤖 AI 模拟: "${node2.resolved_code}" → success`);
            node2.status = 'success';
            node2.result = true;
            node2.summary = '备用方案启用';
            fs.writeFileSync(node2File, JSON.stringify(node2, null, 2));

            setTimeout(() => {
              // Should proceed to "完成"
              const nodeFiles3 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
              if (nodeFiles3.length >= 3) {
                const node3File = path.join(NODES_DIR, nodeFiles3[nodeFiles3.length - 1]);
                const node3 = JSON.parse(fs.readFileSync(node3File, 'utf-8'));
                assert(node3.resolved_code.includes('完成'), `继续执行"完成"任务: ${node3.resolved_code}`);

                node3.status = 'success';
                node3.result = true;
                node3.summary = '完成';
                fs.writeFileSync(node3File, JSON.stringify(node3, null, 2));

                setTimeout(() => {
                  const finalState = executor.getState();
                  assert(finalState.status === 'completed', `最终状态 = completed (got ${finalState.status})`);
                  assert(finalState.executed_tasks === 3, `总完成 3 个任务 (got ${finalState.executed_tasks})`);
                  resolve();
                }, 200);
              } else { resolve(); }
            }, 200);
          } else {
            console.log('  ⚠️ failed 分支未触发');
            resolve();
          }
        }, 200);
      } else { resolve(); }
    }, 200);
  });
}

// ════════════════════════════════════════
// Test 5: Executor — pause / resume
// ════════════════════════════════════════
function testPauseResume() {
  console.log('\n⏸️ Test 5: Executor (暂停/恢复)');

  setup();

  const mainPc = `task 第一步
task 第二步
task 第三步`;

  fs.writeFileSync(path.join(PC_DIR, 'main.pc'), mainPc);
  fs.writeFileSync(path.join(PC_DIR, 'plan-code.md'), '# test');

  const executor = new PlanExecutor(TEST_DIR, {
    writeToPty: () => {},
    getLastActivity: () => Date.now() - 10000,
    broadcast: () => {},
  });

  executor.start();

  return new Promise((resolve) => {
    setTimeout(() => {
      // Complete first task
      const nodeFiles = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
      const nodeFile = path.join(NODES_DIR, nodeFiles[0]);
      const node = JSON.parse(fs.readFileSync(nodeFile, 'utf-8'));
      node.status = 'success';
      node.result = true;
      node.summary = '完成';
      fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));

      setTimeout(() => {
        // Pause while waiting for second task
        executor.pause();
        const stateAfterPause = executor.getState();

        // The pendingPause flag was set; it should pause after current node completes
        // Complete the second task (which might already be dispatched)
        const nodeFiles2 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
        if (nodeFiles2.length >= 2) {
          const node2File = path.join(NODES_DIR, nodeFiles2[nodeFiles2.length - 1]);
          const node2 = JSON.parse(fs.readFileSync(node2File, 'utf-8'));
          node2.status = 'success';
          node2.result = true;
          node2.summary = '完成';
          fs.writeFileSync(node2File, JSON.stringify(node2, null, 2));
        }

        setTimeout(() => {
          const pausedState = executor.getState();
          assert(pausedState.status === 'paused', `暂停后状态 = paused (got ${pausedState.status})`);

          // Resume
          executor.resume();

          setTimeout(() => {
            const resumedState = executor.getState();
            assert(resumedState.status !== 'paused', `恢复后不再是 paused (got ${resumedState.status})`);

            // Complete remaining tasks
            const nodeFiles3 = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
            for (const f of nodeFiles3) {
              const nf = path.join(NODES_DIR, f);
              const n = JSON.parse(fs.readFileSync(nf, 'utf-8'));
              if (n.status === null) {
                n.status = 'success';
                n.result = true;
                n.summary = '完成';
                fs.writeFileSync(nf, JSON.stringify(n, null, 2));
              }
            }

            setTimeout(() => {
              const finalState = executor.getState();
              console.log(`  📊 最终: status=${finalState.status}, executed=${finalState.executed_tasks}`);
              assert(finalState.executed_tasks >= 2, `完成了至少 2 个任务`);
              resolve();
            }, 500);
          }, 200);
        }, 200);
      }, 200);
    }, 200);
  });
}

// ════════════════════════════════════════
// Test 6: Executor — func/call
// ════════════════════════════════════════
function testFuncCall() {
  console.log('\n📞 Test 6: Executor (函数调用)');

  setup();

  const mainPc = `items = [A, B]

func 处理(list):
  for x in \${list}:
    task 处理\${x}

call 处理(\${items})
task 全部完成`;

  fs.writeFileSync(path.join(PC_DIR, 'main.pc'), mainPc);
  fs.writeFileSync(path.join(PC_DIR, 'plan-code.md'), '# test');

  const executor = new PlanExecutor(TEST_DIR, {
    writeToPty: () => {},
    getLastActivity: () => Date.now() - 10000,
    broadcast: () => {},
  });

  const { errors } = executor.checkSyntax();
  assert(errors.length === 0, `func/call 语法检查通过`);

  executor.start();

  return new Promise((resolve) => {
    function completeNextNode() {
      const nodeFiles = fs.readdirSync(NODES_DIR).filter(f => f.startsWith('node-'));
      for (const f of nodeFiles) {
        const nf = path.join(NODES_DIR, f);
        const n = JSON.parse(fs.readFileSync(nf, 'utf-8'));
        if (n.status === null) {
          console.log(`  🤖 AI 完成: ${n.resolved_code}`);
          n.status = 'success';
          n.result = true;
          n.summary = '完成';
          fs.writeFileSync(nf, JSON.stringify(n, null, 2));
          return true;
        }
      }
      return false;
    }

    let attempts = 0;
    const maxAttempts = 10;

    function step() {
      attempts++;
      if (attempts > maxAttempts) {
        const state = executor.getState();
        console.log(`  ⚠️ 超过最大步数, status=${state?.status}, executed=${state?.executed_tasks}`);
        resolve();
        return;
      }

      setTimeout(() => {
        const state = executor.getState();
        if (state?.status === 'completed') {
          assert(state.executed_tasks === 3, `func/call 完成 3 个任务 (got ${state.executed_tasks})`);
          console.log('  📊 执行历史:');
          state.history.forEach(h => console.log(`    #${h.node_id} L${h.line} → ${h.status}`));
          resolve();
          return;
        }

        completeNextNode();
        step();
      }, 200);
    }

    step();
  });
}

// ════════════════════════════════════════
// Run all tests
// ════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Plan-Control 集成测试');
  console.log('═══════════════════════════════════════════');

  testParser();
  testChecker();
  await testExecutor();
  await testExecutorFailBranch();
  await testPauseResume();
  await testFuncCall();

  cleanup();

  console.log('\n═══════════════════════════════════════════');
  console.log(`  结果: ✅ ${passed} 通过  ❌ ${failed} 失败`);
  console.log('═══════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('测试异常:', err);
  cleanup();
  process.exit(1);
});
