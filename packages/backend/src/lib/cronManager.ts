import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { savedSearches, type SavedSearchRow } from "../db/schema.js";
import { runSavedSearch } from "./searchRunner.js";

const jobs = new Map<string, ScheduledTask>();

function scheduleJob(saved: SavedSearchRow): void {
  if (!cron.validate(saved.cronSchedule)) {
    console.error(
      `[cron] invalid schedule "${saved.cronSchedule}" for search ${saved.id}`,
    );
    return;
  }
  const task = cron.schedule(saved.cronSchedule, () => {
    void runSavedSearch(saved).then((summary) => {
      if (summary.inserted > 0 || summary.error) {
        console.log(`[cron:${saved.id}]`, summary);
      }
    });
  });
  jobs.set(saved.id, task);
}

function unscheduleJob(searchId: string): void {
  const task = jobs.get(searchId);
  if (task) {
    task.stop();
    jobs.delete(searchId);
  }
}

/** Fetches the current row from DB before rescheduling so we use fresh data. */
export async function refreshSearchSchedule(searchId: string): Promise<void> {
  unscheduleJob(searchId);
  const [row] = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.id, searchId));
  if (row?.isActive) scheduleJob(row);
}

export function unregisterSearch(searchId: string): void {
  unscheduleJob(searchId);
}

export async function startCronManager(): Promise<void> {
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.isActive, true));
  for (const row of rows) scheduleJob(row);
  console.log(`[cron] scheduled ${jobs.size} saved search(es)`);
}

export function activeJobIds(): string[] {
  return Array.from(jobs.keys());
}

export function unregisterAllSearches(): void {
  for (const task of jobs.values()) task.stop();
  jobs.clear();
}
