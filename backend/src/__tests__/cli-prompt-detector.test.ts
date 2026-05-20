import { describe, it, expect, beforeEach } from 'vitest'
import { cliPromptDetector, parseOptions, type CliPromptEvent } from '../cli-prompt-detector'

function collect(): { events: CliPromptEvent[]; unsubscribe: () => void } {
  const events: CliPromptEvent[] = []
  const listener = (e: CliPromptEvent) => events.push(e)
  cliPromptDetector.on('event', listener)
  return { events, unsubscribe: () => cliPromptDetector.off('event', listener) }
}

const FULL_MENU = [
  '  This session is 5d 5h old and 267.4k tokens.',
  '',
  '  Resuming the full session will consume...',
  '',
  '  ❯ 1. Resume from summary (recommended)',
  '    2. Resume full session as-is',
  "    3. Don't ask me again",
].join('\n')

describe('parseOptions', () => {
  it('提取三个 numbered options 含 label + recommended 标志', () => {
    const opts = parseOptions(FULL_MENU)
    expect(opts).toEqual([
      { digit: 1, label: 'Resume from summary', recommended: true },
      { digit: 2, label: 'Resume full session as-is', recommended: false },
      { digit: 3, label: "Don't ask me again", recommended: false },
    ])
  })

  it('"(recommended)" 后缀也算 recommended', () => {
    const opts = parseOptions('  1. Foo (recommended)\n  2. Bar')
    expect(opts[0]?.recommended).toBe(true)
    expect(opts[0]?.label).toBe('Foo')
    expect(opts[1]?.recommended).toBe(false)
  })

  it('重复同 digit 取最新（Ink 重绘场景）', () => {
    const text = '  1. First version\n  2. B\n--- redraw ---\n  1. Updated\n  2. B'
    const opts = parseOptions(text)
    expect(opts.find((o) => o.digit === 1)?.label).toBe('Updated')
  })

  it('option 数字按 digit 排序而非出现顺序', () => {
    const text = '  3. Third\n  1. First\n  2. Second'
    expect(parseOptions(text).map((o) => o.digit)).toEqual([1, 2, 3])
  })

  it('无 digit 行不被识别', () => {
    const text = 'Just some prose. And "1." in the middle of a sentence is fine.'
    expect(parseOptions(text)).toEqual([])
  })
})

describe('cliPromptDetector', () => {
  beforeEach(() => {
    for (const pid of ['p1', 'p2', 'p_ansi', 'p_split', 'p_idem', 'p_reset', 'p_no_opts', 'p_update']) {
      cliPromptDetector.reset(pid)
    }
  })

  it('三短语 + ≥2 options → detected emit 含 options 数组', () => {
    const { events } = collect()
    cliPromptDetector.feed('p1', FULL_MENU)
    const detected = events.filter((e) => e.projectId === 'p1' && e.type === 'cli_prompt_detected')
    expect(detected).toHaveLength(1)
    if (detected[0]?.type === 'cli_prompt_detected') {
      expect(detected[0].options).toHaveLength(3)
      expect(detected[0].options[0]?.label).toBe('Resume from summary')
      expect(detected[0].options[0]?.recommended).toBe(true)
    }
  })

  it('三短语满足但 options 解析不到（CLI 改格式） → 不 emit detected', () => {
    const { events } = collect()
    // 三短语在文本里，但没有 "<digit>. label" 行（CLI 假设改为别的渲染）
    const broken = 'Resume from summary?\nResume full session?\nDon\'t ask me again? [Y/n]'
    cliPromptDetector.feed('p_no_opts', broken)
    expect(events.filter((e) => e.projectId === 'p_no_opts')).toHaveLength(0)
  })

  it('缺任一关键短语 → 不 detect', () => {
    const { events } = collect()
    cliPromptDetector.feed('p1', '  1. Resume from summary\n  2. Resume full session\n')
    expect(events.filter((e) => e.projectId === 'p1')).toHaveLength(0)
  })

  it('ANSI 转义码被 strip 后仍能匹配 + 解析 options', () => {
    const { events } = collect()
    const ansi = `\x1b[2K\x1b[36m❯ 1.\x1b[0m Resume from summary (recommended)\n    2. Resume full session as-is\n    3. Don't ask me again`
    cliPromptDetector.feed('p_ansi', ansi)
    const detected = events.filter((e) => e.projectId === 'p_ansi' && e.type === 'cli_prompt_detected')
    expect(detected).toHaveLength(1)
    if (detected[0]?.type === 'cli_prompt_detected') {
      expect(detected[0].options).toHaveLength(3)
    }
  })

  it('已 detected 状态下 options 未变 → 不重复 emit（debounced）', () => {
    const { events } = collect()
    cliPromptDetector.feed('p_idem', FULL_MENU)
    cliPromptDetector.feed('p_idem', FULL_MENU)
    cliPromptDetector.feed('p_idem', FULL_MENU)
    const detected = events.filter((e) => e.projectId === 'p_idem' && e.type === 'cli_prompt_detected')
    expect(detected).toHaveLength(1)
  })

  it('已 detected 状态下 options 变了（Ink ↑↓ 移 highlight）→ 重发 detected 更新 options', () => {
    const { events } = collect()
    cliPromptDetector.feed('p_update', FULL_MENU)
    // 用户按 ↓ 移 highlight 到 #2，Ink 重绘整段
    const after = [
      '  This session is 5d 5h old and 267.4k tokens.',
      '  Resuming the full session will consume...',
      '    1. Resume from summary',
      '  ❯ 2. Resume full session as-is',
      "    3. Don't ask me again",
    ].join('\n')
    cliPromptDetector.feed('p_update', after)
    const detected = events.filter((e) => e.projectId === 'p_update' && e.type === 'cli_prompt_detected')
    expect(detected.length).toBeGreaterThanOrEqual(2)
    const last = detected[detected.length - 1]
    if (last?.type === 'cli_prompt_detected') {
      expect(last.options[1]?.recommended).toBe(true)
      expect(last.options[0]?.recommended).toBe(false)
    }
  })

  it('detected 后 buffer 滚出关键词 → emit dismissed', () => {
    const { events } = collect()
    cliPromptDetector.feed('p1', FULL_MENU)
    const noise = 'x'.repeat(10 * 1024)
    cliPromptDetector.feed('p1', noise)
    const ev = events.filter((e) => e.projectId === 'p1')
    expect(ev.map((e) => e.type)).toEqual(['cli_prompt_detected', 'cli_prompt_dismissed'])
  })

  it('多 project 状态隔离', () => {
    const { events } = collect()
    cliPromptDetector.feed('p1', FULL_MENU)
    cliPromptDetector.feed('p2', 'unrelated output')
    expect(events.filter((e) => e.projectId === 'p1' && e.type === 'cli_prompt_detected')).toHaveLength(1)
    expect(events.filter((e) => e.projectId === 'p2')).toHaveLength(0)
  })

  it('reset 在 active 状态下触发 dismissed', () => {
    const { events } = collect()
    cliPromptDetector.feed('p_reset', FULL_MENU)
    cliPromptDetector.reset('p_reset')
    const ev = events.filter((e) => e.projectId === 'p_reset')
    expect(ev.map((e) => e.type)).toEqual(['cli_prompt_detected', 'cli_prompt_dismissed'])
  })

  it('reset 在无 active 状态下不发 dismissed', () => {
    const { events } = collect()
    cliPromptDetector.reset('p1')
    expect(events.filter((e) => e.projectId === 'p1')).toHaveLength(0)
  })

  it('getActive 返回当前 options 快照（REST 同步用）', () => {
    cliPromptDetector.feed('p1', FULL_MENU)
    const active = cliPromptDetector.getActive('p1')
    expect(active?.options).toHaveLength(3)
    expect(active?.options[0]?.label).toBe('Resume from summary')
  })
})
