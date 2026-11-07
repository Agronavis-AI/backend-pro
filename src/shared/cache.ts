/** Process-local TTL cache for third-party responses. */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

  get(key: string): T | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Read-through: returns the cached value or awaits and caches the loader. */
  async wrap(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== null) return hit;
    const value = await loader();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
