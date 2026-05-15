/**
 * train-lang Monaco language registration.
 *
 * Registers the `train` language with Monaco (id="train"). The
 * tokenizer is a regex-based Monarch grammar — fast, no AST, fine for
 * syntax coloring while the editor is being typed. The actual
 * parse-on-type errors are produced by calling `parseToAst` from
 * @train-lang/core in TrackEditor and pushed as model markers.
 *
 * Keep keywords / types in sync with packages/core/src/lexer.ts.
 */

import type * as monaco from 'monaco-editor'

const KEYWORDS = [
  'import',
  'export',
  'from',
  'as',
  'const',
  'var',
  'let',
  'func',
  'fai',
  'return',
  'if',
  'else',
  'for',
  'in',
  'while',
  'break',
  'continue',
  'try',
  'catch',
]

// Reserved identifiers used in type position (S21 in EBNF spec).
const TYPE_KEYWORDS = [
  'int',
  'float',
  'bool',
  'string',
  'prompt',
  'any',
  'enum',
  'array',
  'object',
]

const LITERALS = ['true', 'false', 'null']

const BUILTINS = [
  '__ccweb_ask_user',
  'len',
  'push',
  'concat',
  'range',
  'log',
  'JSON',
  'math',
  'str',
]

let registered = false

export function registerTrainLanguage(m: typeof monaco): void {
  if (registered) return
  registered = true

  m.languages.register({ id: 'train', extensions: ['.tr'], aliases: ['train', 'tr'] })

  m.languages.setLanguageConfiguration('train', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  })

  m.languages.setMonarchTokensProvider('train', {
    defaultToken: '',
    keywords: KEYWORDS,
    typeKeywords: TYPE_KEYWORDS,
    literals: LITERALS,
    builtins: BUILTINS,
    operators: [
      '=',
      '==',
      '!=',
      '<=',
      '>=',
      '<',
      '>',
      '&&',
      '||',
      '+',
      '-',
      '*',
      '/',
      '%',
      '!',
      '?',
      '??',
      '->',
      '=>',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
    ],
    symbols: /[=<>!?:&|+\-*\/%~^@]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,
    tokenizer: {
      root: [
        // Annotations: @runtime, @cache, @mock, @v1.0.0
        [/@[A-Za-z_][\w.\-]*/, 'annotation'],

        // Identifiers / keywords / types / literals / builtins
        [
          /[A-Za-z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@typeKeywords': 'type',
              '@literals': 'keyword.constant',
              '@builtins': 'predefined',
              '@default': 'identifier',
            },
          },
        ],

        // Whitespace
        { include: '@whitespace' },

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number.binary'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/\d+([eE][\-+]?\d+)?/, 'number'],

        // Strings with embedded ${...} interpolation
        [/"([^"\\$]|\\.|\$(?!\{))*"/, 'string'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

        // Delimiters
        [/[{}()[\]]/, '@brackets'],
        [
          /@symbols/,
          {
            cases: {
              '@operators': 'operator',
              '@default': '',
            },
          },
        ],
        [/[,;.]/, 'delimiter'],
      ],

      string: [
        [/[^\\"$]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [
          /\$\{/,
          {
            token: 'string.interpolation.open',
            bracket: '@open',
            next: '@interpolation',
          },
        ],
        [/\$/, 'string'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      interpolation: [
        [
          /\}/,
          {
            token: 'string.interpolation.close',
            bracket: '@close',
            next: '@pop',
          },
        ],
        { include: 'root' },
      ],

      whitespace: [
        [/[ \t\r\n]+/, ''],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  })
}
