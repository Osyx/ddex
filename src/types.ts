export interface VariantCount {
  word: string;
  count: number;
}
export interface WordGroup {
  canonical: string;
  total: number;
  variants: VariantCount[];
}
