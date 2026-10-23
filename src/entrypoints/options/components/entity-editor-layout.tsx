import { cn } from "@/utils/styles/utils"

interface EntityEditorLayoutProps {
  list: React.ReactNode
  editor: React.ReactNode
  className?: string
  listClassName?: string
  /** Extra classes for the editor column, e.g. `flex flex-col` so the editor can stretch. */
  editorClassName?: string
}

export function EntityEditorLayout({
  list,
  editor,
  className,
  listClassName,
  editorClassName,
}: EntityEditorLayoutProps) {
  return (
    <div className={cn("flex items-stretch gap-4", className)}>
      <div className={cn("flex min-h-0 w-40 flex-col gap-4 lg:w-52", listClassName)}>{list}</div>
      <div className={cn("min-h-0 min-w-0 flex-1", editorClassName)}>{editor}</div>
    </div>
  )
}
