declare module 'word-extractor' {
  /** Extracted Word document — only the parts ccweb uses are typed. */
  interface ExtractedDocument {
    getBody(): string;
    getHeaders(): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<ExtractedDocument>;
  }

  export = WordExtractor;
}
