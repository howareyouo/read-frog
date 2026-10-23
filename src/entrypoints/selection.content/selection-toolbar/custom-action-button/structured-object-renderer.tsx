import { IconHash, IconTypography } from "@tabler/icons-react"
import { Thinking } from "@/components/thinking"
import type { ThinkingSnapshot } from "@/types/background-stream"
import type {
  SelectionToolbarCustomActionOutputField,
  SelectionToolbarCustomActionOutputType,
} from "@/types/config/selection-toolbar"

interface StructuredObjectRendererProps {
  outputSchema: SelectionToolbarCustomActionOutputField[]
  value: Record<string, unknown> | null
  isStreaming?: boolean
  thinking: ThinkingSnapshot | null
}

function formatFieldValue(value: unknown, type: SelectionToolbarCustomActionOutputField["type"]) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    if (type !== "number") return value

    const parsed = Number(value)
    return Number.isFinite(parsed) ? String(parsed) : value
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }

  if (type === "number") {
    return ""
  }

  return JSON.stringify(value)
}

function getFieldTypeIcon(type: SelectionToolbarCustomActionOutputType) {
  if (type === "number") {
    return <IconHash className="size-3 shrink-0" strokeWidth={1.8} />
  }

  return <IconTypography className="size-3 shrink-0" strokeWidth={1.8} />
}

function FieldRow({
  fieldName,
  type,
  value,
  pending,
}: {
  fieldName: string
  type: SelectionToolbarCustomActionOutputField["type"]
  value: string
  pending: boolean
}) {
  return (
    <div className="" data-slot="custom-action-field-row" data-field-name={fieldName}>
      <div className="flex h-6 items-center gap-0.5">
        <div className="inline-flex min-w-0 items-center gap-0.5 text-xs font-medium text-muted-foreground">
          {getFieldTypeIcon(type)}
          <span className="truncate">{fieldName}</span>
        </div>
      </div>
      <div className="text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
        {pending ? "…" : value || "—"}
      </div>
    </div>
  )
}

export function StructuredObjectRenderer({
  outputSchema,
  value,
  isStreaming = false,
  thinking,
}: StructuredObjectRendererProps) {
  return (
    <div className="space-y-2">
      {thinking && <Thinking status={thinking.status} content={thinking.text} />}
      <div className="space-y-3">
        {outputSchema.map((field) => {
          const rawValue = value?.[field.name]
          const displayValue = formatFieldValue(rawValue, field.type)
          const isPending = rawValue === undefined && isStreaming

          return (
            <FieldRow
              key={field.id}
              fieldName={field.name}
              type={field.type}
              value={displayValue}
              pending={isPending}
            />
          )
        })}
      </div>
    </div>
  )
}
