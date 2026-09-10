import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db/db.js';

type Logger = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

/** Periodic consistent copies of the SQLite file (VACUUM INTO), pruned to the newest N. */
export class BackupService {
  private timer?: ReturnType<typeof setInterval>;
  readonly dir: string;
  readonly enabled: boolean;

  constructor(
    private readonly db: Db,
    private readonly opts: { dbPath: string; dir: string; intervalHours: number; keep: number },
    private readonly log: Logger = console,
  ) {
    this.enabled = opts.dbPath !== ':memory:' && opts.intervalHours > 0;
    this.dir = opts.dir || join(dirname(opts.dbPath), 'backups');
  }

  start() {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      try {
        this.run();
      } catch (err) {
        this.log.error({ err }, 'scheduled backup failed');
      }
    }, this.opts.intervalHours * 3600 * 1000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  run(): { file: string; bytes: number } {
    if (this.opts.dbPath === ':memory:') throw new Error('Cannot back up an in-memory database');
    mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const file = join(this.dir, `dispatch-${stamp}.db`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = statSync(file).size;
    this.prune();
    this.log.info({ file, bytes }, 'backup written');
    return { file, bytes };
  }

  list(): { file: string; bytes: number; at: string }[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.startsWith('dispatch-') && f.endsWith('.db'))
        .map((f) => {
          const st = statSync(join(this.dir, f));
          return { file: f, bytes: st.size, at: st.mtime.toISOString() };
        })
        .sort((a, b) => b.at.localeCompare(a.at));
    } catch {
      return [];
    }
  }

  private prune() {
    for (const b of this.list().slice(this.opts.keep)) unlinkSync(join(this.dir, b.file));
  }
}
