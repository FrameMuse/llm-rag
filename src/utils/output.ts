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
    const elapsed = ((Date.now() - this.started) / 1000).toFixed(1)
    process.stdout.write(
      `\r  ${this.label} [${"█".repeat(filled)}${"░".repeat(empty)}] ${pct}% (${this.done}/${this.total}, ${elapsed}s)`,
    )
  }
}
