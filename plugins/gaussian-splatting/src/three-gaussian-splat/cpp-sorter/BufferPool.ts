export class BufferPool {
  private pool: ArrayBuffer[];
  private bufferSize: number;

  constructor(bufferSize: number, initialPoolSize: number = 0) {
    this.bufferSize = bufferSize;
    this.pool = [];
    this.initPool(initialPoolSize);
  }

  private initPool(initialPoolSize: number): void {
    for (let i = 0; i < initialPoolSize; i++) {
      this.pool.push(new ArrayBuffer(this.bufferSize));
    }
  }

  public getBuffer(): ArrayBuffer {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    } else {
      return new ArrayBuffer(this.bufferSize);
    }
  }

  public returnBuffer(buffer: ArrayBuffer): void {
    if (buffer.byteLength === this.bufferSize) {
      this.pool.push(buffer);
    }
  }
}
