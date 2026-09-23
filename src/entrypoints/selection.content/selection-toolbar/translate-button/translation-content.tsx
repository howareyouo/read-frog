import { IconLoader2 } from "@tabler/icons-react"
import { Activity } from "react"
import { Thinking } from "@/components/thinking"
import type { ThinkingSnapshot } from "@/types/background-stream"
import { CopyButton } from "../../components/copy-button"
import { SelectionSourceContent } from "../../components/selection-source-content"

interface TranslationContentProps {
  selectionContent: string | null | undefined
  translatedText: string | undefined
  isTranslating: boolean
  thinking: ThinkingSnapshot | null
}

export function TranslationContent({
  selectionContent,
  translatedText,
  isTranslating,
  thinking,
}: TranslationContentProps) {
  const showLoadingIndicator = isTranslating && !thinking && !translatedText
  const showStreamingIndicator = isTranslating && !thinking && translatedText
  return (
    <>
      <SelectionSourceContent
        text={selectionContent}
        className="px-4 pt-4"
        separatorClassName="mb-3 mx-4 data-[orientation=horizontal]:w-[calc(100%-2rem)]"
      />
      <div className="space-y-2 px-4 pb-4">
        {thinking && <Thinking status={thinking.status} content={thinking.text} />}
        <p className="text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
          {showLoadingIndicator && (
            <IconLoader2 className="inline size-4 animate-spin" strokeWidth={1.6} />
          )}
          {translatedText}
          {showStreamingIndicator && " ●"}
        </p>
        <Activity mode={translatedText ? "visible" : "hidden"}>
          <div className="flex items-center gap-1">
            <CopyButton text={translatedText} />
          </div>
        </Activity>
      </div>
    </>
  )
}
