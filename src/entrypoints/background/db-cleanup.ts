import type { Table } from "dexie"
import { browser } from "#imports"
import { db } from "@/utils/db/dexie/db"
import type BatchRequestRecord from "@/utils/db/dexie/tables/batch-request-record"
import { logger } from "@/utils/logger"
import { getDateFromDaysBack } from "@/utils/utils"

export const CHECK_INTERVAL_MINUTES = 24 * 60

export const TRANSLATION_CACHE_CLEANUP_ALARM = "cache-cleanup"
export const TRANSLATION_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60

export const REQUEST_RECORD_CLEANUP_ALARM = "request-record-cleanup"
export const REQUEST_RECORD_MAX_COUNT = 10000
export const REQUEST_RECORD_MAX_AGE_DAYS = 120

export const SUMMARY_CACHE_CLEANUP_ALARM = "summary-cache-cleanup"
export const SUMMARY_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60

export const AI_SEGMENTATION_CACHE_CLEANUP_ALARM = "ai-segmentation-cache-cleanup"
export const AI_SEGMENTATION_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60

type CleanupJob = {
  alarmName: string
  table: Table
  getCutoff: () => Date
  countPolicy: {
    maxCount: number
    keyOf: (record: BatchRequestRecord) => string
    prunedLog: (excessCount: number) => string
  } | null
  oldDeletedLog: (deletedCount: number) => string
  oldErrorLog: string
  allDeletedLog: string
  allErrorLog: string
}

function cutoffMinutesAgo(minutes: number) {
  const cutoffDate = new Date()
  cutoffDate.setTime(cutoffDate.getTime() - minutes * 60 * 1000)
  return cutoffDate
}

const translationCacheCleanupJob: CleanupJob = {
  alarmName: TRANSLATION_CACHE_CLEANUP_ALARM,
  table: db.translationCache,
  getCutoff: () => cutoffMinutesAgo(TRANSLATION_CACHE_MAX_AGE_MINUTES),
  countPolicy: null,
  oldDeletedLog: (deletedCount) =>
    `Cache cleanup: Deleted ${deletedCount} old translation cache entries`,
  oldErrorLog: "Failed to cleanup old cache:",
  allDeletedLog: "Cache cleanup: Deleted all translation cache entries",
  allErrorLog: "Failed to cleanup all cache:",
}

const requestRecordCleanupJob: CleanupJob = {
  alarmName: REQUEST_RECORD_CLEANUP_ALARM,
  table: db.batchRequestRecord,
  getCutoff: () => getDateFromDaysBack(REQUEST_RECORD_MAX_AGE_DAYS),
  countPolicy: {
    maxCount: REQUEST_RECORD_MAX_COUNT,
    keyOf: (record) => record.key,
    prunedLog: (excessCount) =>
      `Request records cleanup: Deleted ${excessCount} oldest records (count exceeded ${REQUEST_RECORD_MAX_COUNT})`,
  },
  oldDeletedLog: (deletedCount) =>
    `Request records cleanup: Deleted ${deletedCount} records older than ${REQUEST_RECORD_MAX_AGE_DAYS} days`,
  oldErrorLog: "Failed to cleanup old request records:",
  allDeletedLog: "Request records cleanup: Deleted all batch request records",
  allErrorLog: "Failed to cleanup all request records:",
}

const summaryCacheCleanupJob: CleanupJob = {
  alarmName: SUMMARY_CACHE_CLEANUP_ALARM,
  table: db.articleSummaryCache,
  getCutoff: () => cutoffMinutesAgo(SUMMARY_CACHE_MAX_AGE_MINUTES),
  countPolicy: null,
  oldDeletedLog: (deletedCount) =>
    `Summary cache cleanup: Deleted ${deletedCount} old article summary cache entries`,
  oldErrorLog: "Failed to cleanup old summary cache:",
  allDeletedLog: "Summary cache cleanup: Deleted all article summary cache entries",
  allErrorLog: "Failed to cleanup all summary cache:",
}

/**
 * Age-based prune for the segmentation cache.
 *
 * The table had no scheduled GC — only the manual "clear cache" button in
 * options — so entries accumulated for as long as the extension was installed.
 * It also carries the orphans of a key-format change: entries written while
 * `runAiSegmentSubtitles` still hashed the provider config into the key can
 * never be read again, and this is what eventually sweeps them out.
 */
const aiSegmentationCacheCleanupJob: CleanupJob = {
  alarmName: AI_SEGMENTATION_CACHE_CLEANUP_ALARM,
  table: db.aiSegmentationCache,
  getCutoff: () => cutoffMinutesAgo(AI_SEGMENTATION_CACHE_MAX_AGE_MINUTES),
  countPolicy: null,
  oldDeletedLog: (deletedCount) =>
    `AI segmentation cache cleanup: Deleted ${deletedCount} old segmentation cache entries`,
  oldErrorLog: "Failed to cleanup old AI segmentation cache:",
  allDeletedLog: "AI segmentation cache cleanup: Deleted all entries",
  allErrorLog: "Failed to cleanup all AI segmentation cache:",
}

const CLEANUP_JOBS = [
  translationCacheCleanupJob,
  requestRecordCleanupJob,
  summaryCacheCleanupJob,
  aiSegmentationCacheCleanupJob,
]

const CLEANUP_JOBS_BY_ALARM = new Map<string, CleanupJob>(
  CLEANUP_JOBS.map((job) => [job.alarmName, job]),
)

export async function setUpDatabaseCleanup() {
  // Set up periodic alarms (only if they don't exist)
  for (const job of CLEANUP_JOBS) {
    const existingAlarm = await browser.alarms.get(job.alarmName)
    if (!existingAlarm) {
      void browser.alarms.create(job.alarmName, {
        delayInMinutes: 1,
        periodInMinutes: CHECK_INTERVAL_MINUTES,
      })
    }
  }

  // Register the alarm listener
  browser.alarms.onAlarm.addListener(async (alarm) => {
    const job = CLEANUP_JOBS_BY_ALARM.get(alarm.name)
    if (job) {
      await runCleanupJob(job)
    }
  })
}

async function runCleanupJob(job: CleanupJob) {
  try {
    if (job.countPolicy) {
      const { maxCount, keyOf, prunedLog } = job.countPolicy
      const totalCount = await job.table.count()

      // Check if count exceeds maximum
      if (totalCount > maxCount) {
        const excessCount = totalCount - maxCount

        // Delete oldest records to bring count back to maximum
        const oldestRecords = await job.table.orderBy("createdAt").limit(excessCount).toArray()

        const keysToDelete = oldestRecords.map(keyOf)
        await job.table.bulkDelete(keysToDelete)

        logger.info(prunedLog(excessCount))
      }
    }

    const cutoffDate = job.getCutoff()

    // Delete all cache entries older than the cutoff date
    const deletedCount = await job.table.where("createdAt").below(cutoffDate).delete()

    if (deletedCount > 0) {
      logger.info(job.oldDeletedLog(deletedCount))
    }
  } catch (error) {
    logger.error(job.oldErrorLog, error)
  }
}

async function runCleanupAll(job: CleanupJob) {
  try {
    await job.table.clear()

    logger.info(job.allDeletedLog)
  } catch (error) {
    logger.error(job.allErrorLog, error)
    throw error
  }
}

export async function cleanupAllTranslationCache() {
  await runCleanupAll(translationCacheCleanupJob)
}

export async function cleanupAllRequestRecords() {
  await runCleanupAll(requestRecordCleanupJob)
}

export async function cleanupAllSummaryCache() {
  await runCleanupAll(summaryCacheCleanupJob)
}

export async function cleanupAllAiSegmentationCache() {
  await runCleanupAll(aiSegmentationCacheCleanupJob)
}
