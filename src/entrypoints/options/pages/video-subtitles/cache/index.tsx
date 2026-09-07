import { ClearCacheSection } from "../../../components/clear-cache-section"

/** Segmentation results Read Frog keeps so a video it has cut before costs nothing to replay. */
export function CacheSection() {
  return <ClearCacheSection variant="videoSubtitles" />
}
