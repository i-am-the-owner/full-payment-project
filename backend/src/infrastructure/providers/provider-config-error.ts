/** A selected provider is missing configuration or is configured unsafely. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
