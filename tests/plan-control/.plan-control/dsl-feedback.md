# pc 语言 DSL 反馈

## 1. 缺少并行执行语义

**场景**：10种仪器的建模任务彼此独立，理论上可以并行执行。但 pc 语言的 `for` 循环是顺序语义，无法表达"这些任务可以并行"。

**期望写法**：
```
parallel for inst in ${instruments}:
  task 为${inst}创建3D模型
```

## 2. task 依赖关系无法显式声明

**场景**：Phase 4（机械手臂）和 Phase 5（磁悬浮导轨）互不依赖，都只依赖 Phase 3 完成。但 pc 的线性执行模型迫使它们串行排列。

**期望写法**：
```
task A after ${phase3_done}
task B after ${phase3_done}
```

## 3. for 循环内无法差异化处理个别元素

**场景**：10种仪器虽然都需要建模，但每种仪器的特征部件差异很大（NMR 有超导磁体、GC-MS 有色谱柱+质谱仪组合体）。`for` 循环中只能写一条通用 task，无法为特定仪器追加额外指令，除非用 `if` 逐个判断，这会比直接写10行 task 更冗长。

**建议**：这类情况下 for 循环 + 充分描述的 task 已经够用（AI 执行时会根据仪器名称自适应），但如果 pc 支持"循环内条件追加"会更精确。

## 4. 缺少 phase/stage 分组原语

**场景**：用 `# Phase N` 注释做逻辑分组，但解析器不理解这些分组。如果有 `phase` 关键字，可以支持"跳到某个 phase"、"重试某个 phase"等操作。

**期望写法**：
```
phase 场景基础:
  task ...
  task ...

phase 仪器建模 after 场景基础:
  for inst in ${instruments}:
    task ...
```
