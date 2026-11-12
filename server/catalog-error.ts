export class CatalogError extends Error {
  readonly status: number;
  readonly saved: boolean;
  constructor(status: number, message: string, saved = false) { super(message); this.status = status; this.saved = saved; }
}
