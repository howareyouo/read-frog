"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import type {
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/utils/styles/utils"

/* Upstream is written against a token set this project doesn't have (`--active`,
   `--focus-ring`, bare `--foreground`). Our palette lives under `@theme inline`, which
   compiles `--color-*` into the utilities rather than emitting them as custom
   properties — so a runtime `var(--color-foreground)` resolves to nothing. Inline
   styles have to read the `--rf-*` originals, which are declared on `:root` and so
   inherit into the shadow roots the content scripts render into.

   `--active` has no equivalent, so the fill borrows `--rf-accent`: subtle enough that
   a label sitting on top of it stays readable. That leaves the hover preview needing a
   different tint — at 40% accent it would vanish wherever it overlaps the fill — so it
   shifts to a muted-foreground wash that reads on filled and unfilled track alike. */
const FILL_COLOR = "var(--rf-accent)"
const HOVER_PREVIEW_COLOR = "color-mix(in srgb, var(--rf-muted-foreground) 20%, transparent)"
const FOCUS_RING_COLOR = "var(--rf-ring)"

/* Critical-damping approximation of the old motion springs: lands exactly, no
   overshoot, in roughly the same time. Applied as CSS transitions on the thumb
   transform and the fill edges whenever the position change comes from outside
   the drag (keyboard, programmatic value, track resize). */
const GEOMETRY_EASING = "cubic-bezier(0.32, 0.72, 0, 1)"
const THUMB_TRANSITION = `transform 160ms ${GEOMETRY_EASING}`
const FILL_TRANSITION = `left 160ms ${GEOMETRY_EASING}, width 160ms ${GEOMETRY_EASING}`

type SliderValue = number | [number, number]
type ValuePosition = "left" | "right" | "top" | "bottom" | "tooltip"

interface SliderProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  ref?: Ref<HTMLDivElement>
  value: SliderValue
  onChange: (value: SliderValue) => void
  /** Fires once per interaction, on release — for writes too expensive to run per frame. */
  onCommit?: (value: SliderValue) => void
  min?: number
  max?: number
  step?: number
  /**
   * Discrete list of allowed values, e.g. [0.1, 0.5, 0.7, 1.1, 1.3].
   *
   * When set, the thumb snaps only to these values (positioned proportionally
   * along the track) and arrow keys walk the list. `min`/`max` derive from the
   * list's extremes and `step` is ignored.
   */
  steps?: number[]
  showSteps?: boolean
  showValue?: boolean
  valuePosition?: ValuePosition
  formatValue?: (v: number) => string
  label?: string
  disabled?: boolean
  trackClassName?: string
  trackStyle?: CSSProperties
  fillClassName?: string
  fillStyle?: CSSProperties
  hideFill?: boolean
  thumbColor?: string
  thumbBorderColor?: string
}

const THUMB_SIZE = 20
const THUMB_SIZE_REST = 16
const TRACK_BG_HEIGHT = 18
const DOT_SIZE = 4
const PIP_SIZE = 5
// Inset track BG so its rounded-end centers align with thumb centers at min/max
const TRACK_INSET = (THUMB_SIZE - TRACK_BG_HEIGHT) / 2

function valueToPixel(v: number, min: number, max: number, trackWidth: number): number {
  if (max === min) return 0
  const usable = trackWidth - THUMB_SIZE
  return ((v - min) / (max - min)) * usable
}

/* `noUncheckedIndexedAccess` is on, but every index read in the geometry below is
   in range by construction — clamped against `length`, or 0 on an array the caller
   has already proven non-empty. One accessor keeps that invariant in a single place
   instead of scattering non-null assertions through the math. */
function at(values: readonly number[], index: number): number {
  return values[index] as number
}

function nearestStepIndex(v: number, steps: number[]): number {
  let idx = 0
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(at(steps, i) - v) < Math.abs(at(steps, idx) - v)) idx = i
  }
  return idx
}

function pixelToValue(
  px: number,
  min: number,
  max: number,
  step: number,
  trackWidth: number,
  stepValues: number[] | null = null,
): number {
  const usable = trackWidth - THUMB_SIZE
  if (usable <= 0) return min
  const raw = (px / usable) * (max - min) + min
  if (stepValues) return at(stepValues, nearestStepIndex(raw, stepValues))
  const snapped = Math.round((raw - min) / step) * step + min
  return Math.max(min, Math.min(max, snapped))
}

function toThumbValues(value: SliderValue): number[] {
  return Array.isArray(value) ? value : [value]
}

/* ---- Shared slider engine ----
   The two variants below render completely different visuals, but their
   interaction plumbing overlaps: the pointer-down guard, the 100ms
   hover-tooltip delay, the hover-bar geometry, the extended hit area, and the
   invisible Base UI primitive that provides ARIA + keyboard nav. Everything
   that diverges (drag coordinate space, thumb/fill rendering, resize
   handling) stays per-variant. */

interface HoverPreviewState {
  left: number
  width: number
  snappedValue: number
  cursorX: number
}

/* Guard shared by every variant's pointer-down handlers: ignore the press when
   disabled or when a non-primary mouse button went down, and preventDefault
   otherwise. */
function shouldIgnorePointerPress(
  e: ReactPointerEvent<HTMLDivElement>,
  disabled: boolean,
): boolean {
  if (disabled) return true
  if (e.pointerType === "mouse" && e.button !== 0) return true
  e.preventDefault()
  return false
}

/* Hover bar stretched between the handle and the snapped cursor position,
   extended to the track edges at the extremes so there's no gap. */
function hoverPreviewAt(
  snappedValue: number,
  snappedX: number,
  handleX: number,
  extent: number,
  min: number,
  max: number,
): HoverPreviewState {
  const edgeX = snappedValue === min ? 0 : snappedValue === max ? extent : snappedX
  return {
    left: Math.min(handleX, edgeX),
    width: Math.abs(edgeX - handleX),
    snappedValue,
    cursorX: snappedX,
  }
}

/* Show hover tooltip after 100ms delay */
function useHoverTooltipDelay(isHovered: boolean): boolean {
  const [showHoverTooltip, setShowHoverTooltip] = useState(false)
  const hoverDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isHovered) {
      hoverDelayRef.current = setTimeout(() => setShowHoverTooltip(true), 100)
    } else {
      if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current)
      setShowHoverTooltip(false)
    }
    return () => {
      if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current)
    }
  }, [isHovered])

  return showHoverTooltip
}

/* Hover value tooltip. The entrance is the shared `rf-tooltip-in` keyframes on
   the inner span — the outer div carries its own -50% x positioning transform,
   which a transform-playing animation would override. */
function HoverTooltip({
  cursorX,
  top,
  children,
}: {
  cursorX: number
  top: number
  children: ReactNode
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2"
      style={{ left: cursorX, top }}
    >
      <span className="animate-rf-tooltip-in rounded-md bg-foreground px-2 py-1 text-[12px] whitespace-nowrap text-background tabular-nums">
        {children}
      </span>
    </div>
  )
}

/* Extended hit area — 8px beyond each edge */
function ExtendedHitArea(props: {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="absolute cursor-ew-resize"
      style={{ left: -8, right: -8, top: 0, bottom: 0 }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    />
  )
}

/* Invisible Base UI Slider — provides ARIA + keyboard nav. Thumbs are passed
   as children so each variant attaches its own labels and focus handling. */
function InvisibleSliderShell({
  value,
  onValueChange,
  onValueCommitted,
  min,
  max,
  step,
  disabled,
  className,
  style,
  children,
}: {
  value: number[]
  onValueChange: (newValues: number[]) => void
  onValueCommitted: (newValues: number[]) => void
  min: number
  max: number
  step: number
  disabled: boolean
  className: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      onValueCommitted={onValueCommitted}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={className}
      style={style}
    >
      <SliderPrimitive.Control className="h-full w-full">
        <SliderPrimitive.Track className="h-full w-full">
          <SliderPrimitive.Indicator />
        </SliderPrimitive.Track>
        {children}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

interface ValueDisplayProps {
  values: number[]
  editingIndex: number | null
  onStartEdit: (index: number) => void
  onCommitEdit: (index: number, v: number) => void
  onCancelEdit: () => void
  min: number
  max: number
  step: number
  stepValues: number[] | null
  formatValue: (v: number) => string
  label?: string
  isRange: boolean
}

function ValueDisplay({
  values,
  editingIndex,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  min,
  max,
  step,
  stepValues,
  formatValue,
  label,
  isRange,
}: ValueDisplayProps) {
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingIndex !== null) {
      // eslint-disable-next-line react/set-state-in-effect
      setInputValue(String(at(values, editingIndex)))
      requestAnimationFrame(() => inputRef.current?.select())
    }
    // Re-running on every `values` change would clobber what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingIndex])

  const commitEdit = useCallback(
    (index: number) => {
      const parsed = Number.parseFloat(inputValue)
      if (Number.isNaN(parsed)) {
        onCancelEdit()
        return
      }
      const clamped = Math.max(min, Math.min(max, parsed))
      const snapped = stepValues
        ? at(stepValues, nearestStepIndex(clamped, stepValues))
        : Math.round((clamped - min) / step) * step + min
      onCommitEdit(index, snapped)
    },
    [inputValue, min, max, step, stepValues, onCommitEdit, onCancelEdit],
  )

  const renderValue = (index: number) => {
    if (editingIndex === index) {
      return (
        <span className="inline-grid text-[13px]">
          {/* Ghost for layout stability — widest possible value */}
          <span className="invisible col-start-1 row-start-1" aria-hidden="true">
            {label ? `${label}: ` : ""}
            {formatValue(max)}
          </span>
          <span className="col-start-1 row-start-1 flex items-center gap-1">
            {label && <span className="text-muted-foreground">{label}:</span>}
            <input
              ref={inputRef}
              type="number"
              value={inputValue}
              min={min}
              max={max}
              step={stepValues ? "any" : step}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={() => commitEdit(index)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(index)
                if (e.key === "Escape") onCancelEdit()
              }}
              aria-label={`Edit slider value${isRange ? (index === 0 ? " (start)" : " (end)") : ""}`}
              className="w-[5ch] border-b border-border bg-transparent text-center text-foreground outline-none"
            />
          </span>
        </span>
      )
    }

    return (
      <span className="cursor-text select-none" onClick={() => onStartEdit(index)}>
        {formatValue(at(values, index))}
      </span>
    )
  }

  const widestValue = isRange
    ? `${label ? `${label}: ` : ""}${formatValue(max)} — ${formatValue(max)}`
    : `${label ? `${label}: ` : ""}${formatValue(max)}`

  return (
    <span className="inline-grid shrink-0 text-[13px] leading-none text-muted-foreground tabular-nums">
      {/* Invisible ghost — reserves width of widest possible value */}
      <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
        {widestValue}
      </span>
      <span className="col-start-1 row-start-1 whitespace-nowrap">
        {label && editingIndex === null && <span className="text-muted-foreground">{label}: </span>}
        {isRange ? (
          <>
            {renderValue(0)}
            <span className="mx-1 text-muted-foreground/50">—</span>
            {renderValue(1)}
          </>
        ) : (
          renderValue(0)
        )}
      </span>
    </span>
  )
}

interface TooltipValueProps {
  value: number
  formatValue: (v: number) => string
  x: number
  /** Disable the left transition — while dragging, the thumb tracks the pointer instantly. */
  instant?: boolean
}

function TooltipValue({ value, formatValue, x, instant }: TooltipValueProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-20 -translate-x-1/2",
        !instant && "transition-[left] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]",
      )}
      style={{ left: x, top: -16 }}
    >
      <span className="animate-rf-tooltip-in rounded-md bg-foreground px-2 py-1 text-[12px] whitespace-nowrap text-background tabular-nums">
        {formatValue(value)}
      </span>
    </div>
  )
}

function Slider({
  ref,
  value,
  onChange,
  onCommit,
  min: minProp = 0,
  max: maxProp = 100,
  step = 1,
  steps,
  showSteps = false,
  showValue = false,
  valuePosition = "left",
  formatValue = String,
  label,
  disabled = false,
  trackClassName,
  trackStyle,
  fillClassName,
  fillStyle,
  hideFill = false,
  thumbColor,
  thumbBorderColor,
  className,
  ...props
}: SliderProps) {
  const isRange = Array.isArray(value)
  const values = toThumbValues(value)

  // Non-uniform step mode: sorted, deduped list of allowed values. Keyed on
  // the joined string so inline array literals don't recompute every render.
  const stepsKey = steps ? steps.join(",") : ""
  const stepValues = useMemo(() => {
    if (!stepsKey) return null
    const parsed = Array.from(new Set(stepsKey.split(",").map(Number))).sort((a, b) => a - b)
    return parsed.length > 1 ? parsed : null
  }, [stepsKey])
  const min = stepValues ? at(stepValues, 0) : minProp
  const max = stepValues ? at(stepValues, stepValues.length - 1) : maxProp

  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const activeDragThumb = useRef<number>(0)
  const valuesRef = useRef(values)
  valuesRef.current = values

  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [focusedThumb, setFocusedThumb] = useState<number | null>(null)
  const showHoverTooltip = useHoverTooltipDelay(isHovered)

  // Track width measured before first paint and re-measured on resize. All
  // thumb/fill/mask geometry derives from it at render time; a width change
  // animates through the CSS transitions on the thumb and fill.
  const [trackWidth, setTrackWidth] = useState(0)
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    // eslint-disable-next-line react/set-state-in-effect
    setTrackWidth(el.offsetWidth)
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      setTrackWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ready = trackWidth > 0

  const px0 = valueToPixel(at(values, 0), min, max, trackWidth)
  const px1 =
    isRange && values[1] !== undefined ? valueToPixel(values[1], min, max, trackWidth) : px0

  // Step dots mask (hides dots on filled side, like SliderComfortable pips)
  const edge0 = px0 + THUMB_SIZE / 2
  const edge1 = px1 + THUMB_SIZE / 2
  const stepDotsMask = isRange
    ? `linear-gradient(to right, black ${edge0 - 2}px, transparent ${edge0}px, transparent ${edge1}px, black ${edge1 + 2}px)`
    : `linear-gradient(to right, transparent ${edge0}px, black ${edge0 + 2}px)`

  const computeHoverPreview = useCallback(
    (cursorX: number, layoutWidth: number) => {
      // cursorX and layoutWidth are in layout space (offsetWidth-relative),
      // unaffected by ancestor CSS transforms. THUMB_SIZE / TRACK_INSET are
      // also layout-space, so the math below is consistent end-to-end.
      const usable = layoutWidth - THUMB_SIZE
      const rawPx = cursorX - THUMB_SIZE / 2
      const clampedPx = Math.max(0, Math.min(usable, rawPx))
      const rawVal = usable > 0 ? (clampedPx / usable) * (max - min) + min : min
      const snappedVal = stepValues
        ? at(stepValues, nearestStepIndex(rawVal, stepValues))
        : Math.max(min, Math.min(max, Math.round((rawVal - min) / step) * step + min))
      const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min)
      const snappedX = THUMB_SIZE / 2 + snappedPercent * usable

      // Find nearest thumb center
      const c0 = valueToPixel(at(valuesRef.current, 0), min, max, layoutWidth) + THUMB_SIZE / 2
      const v1 = valuesRef.current[1]
      const c1 =
        (isRange && v1 !== undefined ? valueToPixel(v1, min, max, layoutWidth) : c0) +
        THUMB_SIZE / 2
      const nearestIdx = isRange ? (Math.abs(snappedX - c0) <= Math.abs(snappedX - c1) ? 0 : 1) : 0
      const nearest = nearestIdx === 0 ? c0 : c1

      setHoverPreview(hoverPreviewAt(snappedVal, snappedX, nearest, layoutWidth, min, max))
    },
    [min, max, step, stepValues, isRange],
  )

  const clampForRange = useCallback(
    (px: number, thumbIndex: number, trackWidth: number): number => {
      if (!isRange) return px
      const other =
        thumbIndex === 0
          ? valueToPixel(at(valuesRef.current, 1), min, max, trackWidth)
          : valueToPixel(at(valuesRef.current, 0), min, max, trackWidth)
      if (thumbIndex === 0) return Math.min(px, other - THUMB_SIZE * 0.5)
      return Math.max(px, other + THUMB_SIZE * 0.5)
    },
    [isRange, min, max],
  )

  const composeValue = useCallback(
    (thumbIndex: number, newValue: number): SliderValue => {
      if (!isRange) return newValue
      const next: [number, number] = [...(values as [number, number])]
      next[thumbIndex] = newValue
      return next
    },
    [isRange, values],
  )

  const emitChange = useCallback(
    (thumbIndex: number, newValue: number) => {
      onChange(composeValue(thumbIndex, newValue))
    },
    [composeValue, onChange],
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (shouldIgnorePointerPress(e, disabled)) return
      e.stopPropagation() // Prevent the primitive from also handling the drag

      const trackEl = trackRef.current
      if (!trackEl) return
      const trackRect = trackEl.getBoundingClientRect()
      const layoutWidth = trackEl.offsetWidth
      if (layoutWidth <= 0 || trackRect.width <= 0) return
      // Normalize cursor to layout space so it matches the rendered px
      // geometry, even under ancestor CSS scale.
      const scale = trackRect.width / layoutWidth
      const localX = (e.clientX - trackRect.left) / scale - THUMB_SIZE / 2
      const clamped = Math.max(0, Math.min(layoutWidth - THUMB_SIZE, localX))

      if (isRange) {
        const x0 = valueToPixel(at(valuesRef.current, 0), min, max, layoutWidth)
        const v1 = valuesRef.current[1]
        const x1 = (v1 !== undefined ? valueToPixel(v1, min, max, layoutWidth) : x0)
        const dist0 = Math.abs(clamped - x0)
        const dist1 = Math.abs(clamped - x1)
        activeDragThumb.current = dist0 <= dist1 ? 0 : 1
      } else {
        activeDragThumb.current = 0
      }

      dragging.current = true
      setIsPressed(true)

      // Snap to step grid immediately
      const snappedValue = pixelToValue(clamped, min, max, step, layoutWidth, stepValues)
      const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth)
      const finalPx = clampForRange(snappedPx, activeDragThumb.current, layoutWidth)

      emitChange(
        activeDragThumb.current,
        pixelToValue(finalPx, min, max, step, layoutWidth, stepValues),
      )
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [disabled, isRange, min, max, step, stepValues, clampForRange, emitChange],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      e.stopPropagation()
      const trackEl = trackRef.current
      if (!trackEl) return
      const trackRect = trackEl.getBoundingClientRect()
      const layoutWidth = trackEl.offsetWidth
      if (layoutWidth <= 0 || trackRect.width <= 0) return
      const scale = trackRect.width / layoutWidth
      const localX = (e.clientX - trackRect.left) / scale - THUMB_SIZE / 2
      const clamped = Math.max(0, Math.min(layoutWidth - THUMB_SIZE, localX))

      const snappedValue = pixelToValue(clamped, min, max, step, layoutWidth, stepValues)
      const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth)
      const finalPx = clampForRange(snappedPx, activeDragThumb.current, layoutWidth)

      emitChange(
        activeDragThumb.current,
        pixelToValue(finalPx, min, max, step, layoutWidth, stepValues),
      )
    },
    [min, max, step, stepValues, clampForRange, emitChange],
  )

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    setIsPressed(false)
    setHoverPreview(null)
    // The last emitted value is already snapped to the step grid, so the
    // re-enabled CSS transition has nothing to travel — the release is exact.
    onCommit?.(composeValue(activeDragThumb.current, at(valuesRef.current, activeDragThumb.current)))
  }, [onCommit, composeValue])

  // In steps mode the primitive runs on indices (0..len-1, step 1) so arrow
  // keys walk the list; map indices back to actual values on the way out.
  const fromPrimitiveValues = useCallback(
    (newValues: number[]): SliderValue => {
      const mapped = stepValues ? newValues.map((i) => at(stepValues, Math.round(i))) : newValues
      return isRange ? (mapped as [number, number]) : at(mapped, 0)
    },
    [isRange, stepValues],
  )

  const handlePrimitiveChange = useCallback(
    (newValues: number[]) => {
      if (dragging.current) return
      onChange(fromPrimitiveValues(newValues))
    },
    [onChange, fromPrimitiveValues],
  )

  const handlePrimitiveCommit = useCallback(
    (newValues: number[]) => {
      // Pointer commits are emitted by handlePointerUp — the primitive is
      // pointer-events:none, so anything reaching here came from the keyboard.
      if (dragging.current) return
      onCommit?.(fromPrimitiveValues(newValues))
    },
    [onCommit, fromPrimitiveValues],
  )

  const handleStartEdit = useCallback((index: number) => setEditingIndex(index), [])

  const handleCommitEdit = useCallback(
    (index: number, v: number) => {
      emitChange(index, v)
      onCommit?.(composeValue(index, v))
      setEditingIndex(null)
    },
    [emitChange, onCommit, composeValue],
  )

  const handleCancelEdit = useCallback(() => setEditingIndex(null), [])

  const stepDots = useMemo(() => {
    if (!showSteps) return []
    if (stepValues) {
      return stepValues.map((v) => ({
        value: v,
        percent: max === min ? 0 : (v - min) / (max - min),
      }))
    }
    return Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => {
      const v = min + i * step
      return { value: v, percent: (v - min) / (max - min) }
    })
  }, [showSteps, min, max, step, stepValues])

  const isInteracting = isHovered || isPressed

  // aria-label on Root lands on a role-less div and never reaches the thumb's
  // input, so each Thumb gets its own label.
  const thumbAriaLabel = (index: number): string | undefined => {
    if (!isRange) return label
    if (!label) return index === 0 ? "Minimum" : "Maximum"
    return index === 0 ? `${label} minimum` : `${label} maximum`
  }

  const valueDisplay = showValue && valuePosition !== "tooltip" && (
    <ValueDisplay
      values={values}
      editingIndex={editingIndex}
      onStartEdit={handleStartEdit}
      onCommitEdit={handleCommitEdit}
      onCancelEdit={handleCancelEdit}
      min={min}
      max={max}
      step={step}
      stepValues={stepValues}
      formatValue={formatValue}
      label={label}
      isRange={isRange}
    />
  )

  const renderVisualThumb = (index: number) => {
    const x = index === 0 ? px0 : px1
    return (
      <span
        key={`visual-thumb-${index}`}
        className="pointer-events-none absolute top-1/2 left-0 z-10 flex items-center justify-center"
        style={{
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          marginTop: -THUMB_SIZE / 2,
          transform: `translateX(${x}px)`,
          transition: isPressed ? "none" : THUMB_TRANSITION,
        }}
      >
        <span
          className="block rounded-full"
          style={{
            width: THUMB_SIZE_REST,
            height: THUMB_SIZE_REST,
            backgroundColor: thumbColor ?? "white",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            border: thumbBorderColor ? `1px solid ${thumbBorderColor}` : undefined,
          }}
        />
        {/* Focus ring */}
        <span
          className="pointer-events-none absolute rounded-full border transition-opacity duration-100"
          style={{
            borderColor: FOCUS_RING_COLOR,
            opacity: focusedThumb === index ? 1 : 0,
            width: THUMB_SIZE + 4,
            height: THUMB_SIZE + 4,
          }}
        />
      </span>
    )
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex w-full touch-none flex-col gap-0 overflow-visible select-none",
        valuePosition === "left" || valuePosition === "right"
          ? "mb-2 flex-row items-center gap-2"
          : "flex-col",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      {...props}
    >
      {(valuePosition === "top" || valuePosition === "left") && valueDisplay}

      <div
        className="relative flex-1 overflow-visible"
        style={{
          height:
            valuePosition === "left" || valuePosition === "right"
              ? THUMB_SIZE + 16
              : THUMB_SIZE + (valuePosition === "tooltip" ? 16 : 0),
          paddingTop: valuePosition === "tooltip" ? 16 : 0,
        }}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => {
          setIsHovered(false)
          setHoverPreview(null)
        }}
        onMouseMove={(e) => {
          if (dragging.current) return
          const trackEl = trackRef.current
          if (!trackEl) return
          const trackRect = trackEl.getBoundingClientRect()
          const layoutWidth = trackEl.offsetWidth
          if (layoutWidth <= 0 || trackRect.width <= 0) return
          // Normalize to layout space so the formula's THUMB_SIZE / TRACK_INSET
          // constants (layout px) match the cursor's coordinate space, even when
          // an ancestor applies a CSS scale transform.
          const scale = trackRect.width / layoutWidth
          const layoutX = (e.clientX - trackRect.left) / scale
          computeHoverPreview(Math.max(0, Math.min(layoutWidth, layoutX)), layoutWidth)
        }}
      >
        {showValue && valuePosition === "tooltip" && isInteracting && (
          <TooltipValue
            key="tooltip-0"
            value={at(values, 0)}
            formatValue={formatValue}
            x={px0}
            instant={isPressed}
          />
        )}
        {showValue && valuePosition === "tooltip" && isInteracting && isRange && values[1] !== undefined && (
          <TooltipValue
            key="tooltip-1"
            value={values[1]}
            formatValue={formatValue}
            x={px1}
            instant={isPressed}
          />
        )}

        {/* Base UI Slider — invisible, provides ARIA + keyboard nav */}
        <InvisibleSliderShell
          value={stepValues ? values.map((v) => nearestStepIndex(v, stepValues)) : values}
          onValueChange={handlePrimitiveChange}
          onValueCommitted={handlePrimitiveCommit}
          min={stepValues ? 0 : min}
          max={stepValues ? stepValues.length - 1 : max}
          step={stepValues ? 1 : step}
          disabled={disabled}
          className="pointer-events-none absolute inset-0 opacity-0"
          style={{ height: THUMB_SIZE }}
        >
          <SliderPrimitive.Thumb
            index={0}
            aria-label={thumbAriaLabel(0)}
            getAriaValueText={stepValues ? () => formatValue(at(values, 0)) : undefined}
            className="block outline-none"
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            onFocus={(e) => {
              if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setFocusedThumb(0)
            }}
            onBlur={() => setFocusedThumb((prev) => (prev === 0 ? null : prev))}
          />
          {isRange && (
            <SliderPrimitive.Thumb
              index={1}
              aria-label={thumbAriaLabel(1)}
              getAriaValueText={stepValues ? () => formatValue(at(values, 1)) : undefined}
              className="block outline-none"
              style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
              onFocus={(e) => {
                if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setFocusedThumb(1)
              }}
              onBlur={() => setFocusedThumb((prev) => (prev === 1 ? null : prev))}
            />
          )}
        </InvisibleSliderShell>

        {/* Visual track with pointer handlers */}
        <div
          ref={trackRef}
          className="relative w-full cursor-ew-resize py-2"
          style={{ height: THUMB_SIZE + 16, opacity: ready ? 1 : 0 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <ExtendedHitArea
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />

          {hoverPreview && showHoverTooltip && !isPressed && valuePosition !== "tooltip" && (
            <HoverTooltip key="hover-tooltip" cursorX={hoverPreview.cursorX} top={-20}>
              {formatValue(hoverPreview.snappedValue)}
            </HoverTooltip>
          )}

          {/* Track background */}
          <div
            className={cn(
              "absolute overflow-hidden rounded-full border border-border",
              trackClassName,
            )}
            style={{
              left: TRACK_INSET,
              right: TRACK_INSET,
              top: 8 + (THUMB_SIZE - TRACK_BG_HEIGHT) / 2,
              height: TRACK_BG_HEIGHT,
              backgroundColor: "transparent",
              ...trackStyle,
            }}
          >
            {!hideFill && (
              <div
                className={cn("absolute h-full", fillClassName)}
                style={{
                  left: isRange ? px0 + THUMB_SIZE / 2 - TRACK_INSET : 0,
                  width: isRange ? px1 - px0 : px0 + THUMB_SIZE / 2 - TRACK_INSET,
                  backgroundColor: FILL_COLOR,
                  transition: isPressed ? "none" : FILL_TRANSITION,
                  ...fillStyle,
                }}
              />
            )}

            {/* Hover preview */}
            <div
              className="pointer-events-none absolute z-[2] h-full transition-opacity duration-150"
              style={{
                opacity: hoverPreview && !isPressed ? 1 : 0,
                left: hoverPreview ? hoverPreview.left - TRACK_INSET : 0,
                width: hoverPreview ? hoverPreview.width : 0,
                borderRadius:
                  hoverPreview && hoverPreview.cursorX > hoverPreview.left
                    ? "0 9999px 9999px 0"
                    : "9999px 0 0 9999px",
                backgroundColor: HOVER_PREVIEW_COLOR,
              }}
            />
          </div>

          {/* Step dots — masked so filled side is hidden */}
          {stepDots.length > 0 && (
            <div
              className="pointer-events-none absolute right-0 left-0"
              style={{
                top: 8 + (THUMB_SIZE - TRACK_BG_HEIGHT) / 2,
                height: TRACK_BG_HEIGHT,
                WebkitMaskImage: stepDotsMask,
                maskImage: stepDotsMask,
              }}
            >
              {stepDots.map(({ value: v, percent }) => (
                <div
                  key={v}
                  className="pointer-events-none absolute flex items-center justify-center"
                  style={{
                    left: `calc(${THUMB_SIZE / 2}px + ${percent} * (100% - ${THUMB_SIZE}px))`,
                    top: "50%",
                    width: 0,
                    height: 0,
                  }}
                >
                  <div
                    className="shrink-0 rounded-full transition-[width,height] duration-150"
                    style={{
                      width: isHovered ? DOT_SIZE * 1.25 : DOT_SIZE,
                      height: isHovered ? DOT_SIZE * 1.25 : DOT_SIZE,
                      backgroundColor: "var(--rf-muted-foreground)",
                      opacity: 0.3,
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {renderVisualThumb(0)}
          {isRange && renderVisualThumb(1)}
        </div>
      </div>

      {(valuePosition === "bottom" || valuePosition === "right") && valueDisplay}
    </div>
  )
}

interface SliderComfortableProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    | "onChange"
    | "defaultValue"
    | "onDrag"
    | "onDragStart"
    | "onDragEnd"
    | "onDragOver"
    | "onAnimationStart"
  > {
  ref?: Ref<HTMLDivElement>
  value: number
  onChange: (value: number) => void
  /** Fires once per interaction, on release — for writes too expensive to run per frame. */
  onCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  variant?: "pips" | "scrubber"
  /** Rendered inside the track, and used to name the thumb unless `aria-label` overrides it. */
  label?: string
  /**
   * Names the thumb without rendering anything — for rows where the surrounding
   * layout already shows a visible label.
   */
  "aria-label"?: string
  formatValue?: (v: number) => string
  disabled?: boolean
}

function SliderComfortable({
  ref,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  variant = "pips",
  label,
  "aria-label": ariaLabel,
  formatValue = String,
  disabled = false,
  className,
  ...props
}: SliderComfortableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const handleDragging = useRef(false)
  // Last value emitted during the current drag — `value` can lag a frame behind
  // when the parent batches, and the commit has to report what was released on.
  const latestValue = useRef(value)
  latestValue.current = value
  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const showHoverTooltip = useHoverTooltipDelay(isHovered)

  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) (ref as { current: HTMLDivElement | null }).current = el
    },
    [ref],
  )

  const pipSteps = useMemo(
    () => Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step),
    [min, max, step],
  )
  const pipCount = pipSteps.length

  // All geometry derives from the value at render time; the CSS transitions on
  // each element supply the smoothing the old motion springs provided.
  const pct = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)))
  // Small offset when value is at min so the handle line stays visible
  const zeroTarget = variant === "pips" ? 8 : 17
  const zo = value === min ? zeroTarget : 0

  const fillWidthStyle = `${pct * 100}%`
  const handleLeftStyle = `calc(${pct * 100}% - 8px + ${zo}px)`
  const handleLineLeftStyle = `calc(${pct * 100}% - 9px + ${zo}px)`
  // Pips-specific: offset by px-3 (12px) padding so fill edge aligns with active pip center
  const pipsOffset = 20 - 20 * pct - zo * 2.5
  const pipsFillWidthStyle = `calc(${pct * 100}% + ${pipsOffset}px)`
  const pipsHandleLineLeftStyle = `calc(${pct * 100}% + ${11 - 24 * pct}px)`
  const pipsMaskStyle = `linear-gradient(to right, transparent calc(${pct * 100}% + ${pipsOffset}px), black calc(${pct * 100}% + ${pipsOffset + 2}px))`

  const computeHoverPreview = useCallback(
    (clientX: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Use clientWidth (padding box) — CSS % and absolute left/width are relative to it
      const w = el.clientWidth
      if (w <= 0 || rect.width <= 0) return
      // Normalize cursor to layout space so it matches `w` (layout, padding box).
      // offsetWidth is the layout border-box; the difference vs `w` is the
      // horizontal border contribution split across both sides.
      const scale = rect.width / el.offsetWidth
      const borderLeftLayout = (el.offsetWidth - w) / 2
      const layoutX = (clientX - rect.left) / scale - borderLeftLayout
      const clamped = Math.max(0, Math.min(w, layoutX))

      let snappedVal: number
      if (variant === "pips") {
        if (pipCount <= 1) return
        const index = Math.max(
          0,
          Math.min(pipCount - 1, Math.round((clamped / w) * (pipCount - 1))),
        )
        snappedVal = at(pipSteps, index)
      } else {
        const raw = min + (clamped / w) * (max - min)
        snappedVal = Math.max(min, Math.min(max, Math.round((raw - min) / step) * step + min))
      }
      const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min)
      const snappedX = snappedPercent * w

      // Current handle position — for pips, match the visual fill edge offset
      const currentValue = latestValue.current
      const currentPercent =
        max === min ? 0 : Math.max(0, Math.min(1, (currentValue - min) / (max - min)))
      const currentZo = currentValue === min ? (variant === "pips" ? 8 : 17) : 0
      const handleX =
        variant === "pips"
          ? currentPercent * w + (20 - 20 * currentPercent - currentZo * 2.5)
          : currentPercent * w

      setHoverPreview(hoverPreviewAt(snappedVal, snappedX, handleX, w, min, max))
    },
    [variant, pipSteps, pipCount, min, max, step],
  )

  const getValueFromX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return min
      const clamped = Math.max(0, Math.min(rect.width, clientX - rect.left))
      if (variant === "pips") {
        if (pipCount <= 1) return min
        const index = Math.max(
          0,
          Math.min(pipCount - 1, Math.round((clamped / rect.width) * (pipCount - 1))),
        )
        return at(pipSteps, index)
      }
      const raw = min + (clamped / rect.width) * (max - min)
      const snapped = Math.round((raw - min) / step) * step + min
      return Math.max(min, Math.min(max, snapped))
    },
    [variant, pipSteps, pipCount, min, max, step],
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (shouldIgnorePointerPress(e, disabled)) return
      dragging.current = true
      setIsPressed(true)
      const newVal = getValueFromX(e.clientX)
      latestValue.current = newVal
      onChange(newVal)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [disabled, getValueFromX, onChange],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const newVal = getValueFromX(e.clientX)
      latestValue.current = newVal
      onChange(newVal)
    },
    [getValueFromX, onChange],
  )

  const handlePointerUp = useCallback(() => {
    const wasDragging = dragging.current
    dragging.current = false
    setIsPressed(false)
    setHoverPreview(null)
    if (wasDragging) onCommit?.(latestValue.current)
  }, [onCommit])

  // Resize handle drag handlers (direct cursor position)
  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (shouldIgnorePointerPress(e, disabled)) return
      e.stopPropagation()
      handleDragging.current = true
      setIsPressed(true)
      const newVal = getValueFromX(e.clientX)
      latestValue.current = newVal
      onChange(newVal)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [disabled, getValueFromX, onChange],
  )

  const handleResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!handleDragging.current) return
      const newVal = getValueFromX(e.clientX)
      latestValue.current = newVal
      onChange(newVal)
    },
    [getValueFromX, onChange],
  )

  const handleResizePointerUp = useCallback(() => {
    const wasDragging = handleDragging.current
    handleDragging.current = false
    setIsPressed(false)
    setHoverPreview(null)
    if (wasDragging) onCommit?.(latestValue.current)
  }, [onCommit])

  const isActive = isHovered || isFocused

  // Scrubber drags track the pointer with no transition (the old code wrote the
  // motion values directly); pips always smooth, matching the old per-move
  // spring retargeting.
  const scrubberDragging = variant === "scrubber" && isPressed

  return (
    <div
      className="relative w-full touch-none"
      onPointerEnter={() => {
        if (!disabled) setIsHovered(true)
      }}
      onPointerLeave={() => {
        if (!disabled) {
          setIsHovered(false)
          setHoverPreview(null)
        }
      }}
      onMouseMove={(e) => {
        if (disabled || dragging.current || handleDragging.current) return
        computeHoverPreview(e.clientX)
      }}
    >
      <ExtendedHitArea
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* Hover value tooltip — outside overflow-hidden container */}
      {hoverPreview && showHoverTooltip && !isPressed && (
        <HoverTooltip key="hover-tooltip" cursorX={hoverPreview.cursorX} top={-30}>
          {formatValue(hoverPreview.snappedValue)}
        </HoverTooltip>
      )}

      <div
        ref={mergedRef}
        className={cn(
          "relative h-8 w-full touch-none overflow-hidden rounded-lg border border-border outline-offset-2 select-none",
          variant === "scrubber"
            ? "flex cursor-ew-resize items-center gap-3 px-4"
            : "cursor-ew-resize",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        style={{
          outline: isFocused ? `1px solid ${FOCUS_RING_COLOR}` : "1px solid transparent",
          transition: "outline-color 100ms ease-out",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        {...props}
      >
        {/* Invisible Base UI Slider for keyboard nav + a11y */}
        <InvisibleSliderShell
          value={[value]}
          onValueChange={(v) => onChange(at(v, 0))}
          onValueCommitted={(v) => {
            // Pointer commits come from the handlers above — the primitive is
            // pointer-events:none, so anything here came from the keyboard.
            if (!dragging.current && !handleDragging.current) onCommit?.(at(v, 0))
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="pointer-events-none absolute inset-0 opacity-0 [&_*]:pointer-events-none"
        >
          <SliderPrimitive.Thumb
            index={0}
            aria-label={ariaLabel ?? label}
            className="block outline-none"
            onFocus={(e) => {
              if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setIsFocused(true)
            }}
            onBlur={() => setIsFocused(false)}
          />
        </InvisibleSliderShell>

        {/* Hover preview */}
        <div
          className="pointer-events-none absolute inset-y-0 z-[3] transition-opacity duration-150"
          style={{
            opacity: hoverPreview && !isPressed ? 1 : 0,
            left: hoverPreview ? hoverPreview.left : 0,
            width: hoverPreview ? hoverPreview.width : 0,
            backgroundColor: HOVER_PREVIEW_COLOR,
          }}
        />

        {/* Pips: dots layer — z-[1] */}
        {variant === "pips" && (
          <div
            className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-between px-3"
            style={{ WebkitMaskImage: pipsMaskStyle, maskImage: pipsMaskStyle }}
          >
            {pipSteps.map((pipValue) => {
              const isActivePip = pipValue === value
              return (
                <div
                  key={pipValue}
                  className="relative flex items-center justify-center"
                  style={{ width: PIP_SIZE, height: PIP_SIZE }}
                >
                  <div
                    className="rounded-full transition-[background-color,opacity] duration-100"
                    style={{
                      width: PIP_SIZE,
                      height: PIP_SIZE,
                      backgroundColor: isActivePip
                        ? "var(--rf-foreground)"
                        : "var(--rf-muted-foreground)",
                      opacity: isActivePip ? 1 : 0.3,
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* Pips: label + value BG layer — z-[2] (occludes dots behind text) */}
        {variant === "pips" && (
          <div
            className="pointer-events-none absolute inset-0 z-[2] flex items-center px-2"
            aria-hidden
          >
            {label && (
              <span className="bg-background px-2 text-[13px] text-transparent select-none">
                {label}
              </span>
            )}
            <span
              className="ml-auto bg-background px-2 text-[13px] text-transparent tabular-nums select-none"
              style={{ minWidth: `${formatValue(max).length}ch` }}
            >
              {formatValue(value)}
            </span>
          </div>
        )}

        {/* Pips: fill — z-[3] */}
        {variant === "pips" && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-[3] transition-[width] duration-100 ease-out"
            style={{ width: pipsFillWidthStyle, backgroundColor: FILL_COLOR }}
          />
        )}

        {/* Pips: handle line — z-[3] */}
        {variant === "pips" && (
          <div
            className="pointer-events-none absolute z-[3] rounded-full transition-all duration-100 ease-out"
            style={{
              top: isActive ? 7 : 8,
              bottom: isActive ? 7 : 8,
              left: pipsHandleLineLeftStyle,
              width: 2,
              backgroundColor: isFocused
                ? "var(--rf-foreground)"
                : isHovered
                  ? "color-mix(in srgb, var(--rf-foreground) 50%, transparent)"
                  : "color-mix(in srgb, var(--rf-foreground) 25%, transparent)",
            }}
          />
        )}

        {/* Pips: label + value text layer — z-[4] */}
        {variant === "pips" && (
          <div className="pointer-events-none absolute inset-0 z-[4] flex items-center px-2">
            {label && (
              <span
                className={cn(
                  "px-2 text-[13px] transition-colors duration-100",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            )}
            <span
              className={cn(
                "ml-auto px-2 text-[13px] tabular-nums transition-colors duration-100",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
              style={{ minWidth: `${formatValue(max).length}ch`, textAlign: "right" }}
            >
              {formatValue(value)}
            </span>
          </div>
        )}

        {/* Scrubber: fill */}
        {variant === "scrubber" && (
          <div
            className={cn(
              "pointer-events-none absolute top-0 bottom-0 left-0",
              !scrubberDragging && "transition-[width] duration-100 ease-out",
            )}
            style={{ width: fillWidthStyle, backgroundColor: FILL_COLOR }}
          />
        )}

        {/* Scrubber: handle line */}
        {variant === "scrubber" && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 rounded-full",
              !scrubberDragging && "transition-all duration-100 ease-out",
            )}
            style={{
              top: isActive ? 7 : 8,
              bottom: isActive ? 7 : 8,
              left: handleLineLeftStyle,
              width: 2,
              backgroundColor: isFocused
                ? "var(--rf-foreground)"
                : isHovered
                  ? "color-mix(in srgb, var(--rf-foreground) 50%, transparent)"
                  : "color-mix(in srgb, var(--rf-foreground) 25%, transparent)",
            }}
          />
        )}

        {/* Scrubber: label */}
        {variant === "scrubber" && label && (
          <span
            className={cn(
              "z-10 shrink-0 text-[13px] transition-colors duration-100",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        )}

        {/* Scrubber: flex-1 spacer + value */}
        {variant === "scrubber" && (
          <>
            <div className="flex-1" />
            <span
              className={cn(
                "z-10 shrink-0 text-right text-[13px] tabular-nums transition-colors duration-100",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
              style={{ minWidth: `${formatValue(max).length}ch` }}
            >
              {formatValue(value)}
            </span>
          </>
        )}

        {/* Resize handle (scrubber only) */}
        {variant === "scrubber" && (
          <div
            className={cn(
              "absolute top-0 bottom-0 z-20 w-2 cursor-ew-resize",
              !scrubberDragging && "transition-[left] duration-100 ease-out",
            )}
            style={{ left: handleLeftStyle }}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
          />
        )}
      </div>
    </div>
  )
}

export type { SliderComfortableProps, SliderProps, SliderValue, ValuePosition }
export { Slider, SliderComfortable }
