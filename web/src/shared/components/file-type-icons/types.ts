export interface BrandIconData {
  readonly path: string;
  readonly title: string;
  readonly hex?: string;
}

export interface BrandMimeRule {
  readonly test: (contentType: string) => boolean;
  readonly icon: BrandIconData;
}
