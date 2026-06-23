export class ProgressBar {
  private done = 0
  private started = Date.now()

  get position(): number {
    return this.done
  }

  constructor(
    private label: string,
    private total: number,
  ) {
    this.render()
  }

  tick(n = 1): void {
    this.done += n
    this.render()
    if (this.done >= this.total) {
      process.stdout.write("\n")
    }
  }

  private render(): void {
    const pct = Math.min(Math.round((this.done / this.total) * 100), 100)
    const filled = Math.floor(pct / 5)
    const empty = 20 - filled
    const elapsedMs = Date.now() - this.started
    const elapsed = (elapsedMs / 1000).toFixed(1)
    const eta = this.done > 0
      ? Math.round(elapsedMs / this.done * (this.total - this.done) / 1000)
      : "?"
    process.stdout.write(
      `\r  ${this.label} [${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}% (${this.done}/${this.total}, ${elapsed}s, ETA ${eta}s)`,
    )
  }
}
