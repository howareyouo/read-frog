import type { ReactNode } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { RecoveryFallback } from "@/components/recovery/recovery-fallback"
import { toError } from "@/utils/error/message"

interface RecoveryBoundaryProps {
  children: ReactNode
}

function renderRecoveryFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown
  resetErrorBoundary: () => void
}) {
  return <RecoveryFallback error={toError(error)} onRecovered={resetErrorBoundary} />
}

export function RecoveryBoundary({ children }: RecoveryBoundaryProps) {
  return <ErrorBoundary fallbackRender={renderRecoveryFallback}>{children}</ErrorBoundary>
}
