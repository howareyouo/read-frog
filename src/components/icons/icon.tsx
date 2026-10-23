import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertCircleFilled,
  IconAlertTriangle,
  IconApi,
  IconArrowBackUp,
  IconArrowRight,
  IconArrowsExchange,
  IconAtom2,
  IconBolt,
  IconBook2,
  IconBookmark,
  IconBraces,
  IconBrain,
  IconBulb,
  IconCalendar,
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleDashedCheck,
  IconClock,
  IconCompass,
  IconCopy,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDots,
  IconExternalLink,
  IconFeather,
  IconFileExport,
  IconFileImport,
  IconFileOff,
  IconFileText,
  IconFlag,
  IconGitMerge,
  IconGripVertical,
  IconHeart,
  IconHelp,
  IconHelpCircle,
  IconHighlight,
  IconKeyboard,
  IconLanguage,
  IconLanguageHiragana,
  IconLink,
  IconList,
  IconListSearch,
  IconMenu2,
  IconMessageCircle,
  IconMicroscope,
  IconMoon,
  IconNotes,
  IconPalette,
  IconPencil,
  IconPencilCheck,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconSchool,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStar,
  IconSubtitles,
  IconSun,
  IconTags,
  IconTargetArrow,
  IconTextResize,
  IconTrash,
  IconTypography,
  IconWand,
  IconWorld,
  IconX,
} from "@tabler/icons-react"
import type { ComponentProps, ComponentType } from "react"

type IconProps = {
  icon: string
} & ComponentProps<"svg">

const ICONS: Record<string, ComponentType<ComponentProps<"svg">>> = {
  // tabler icons used by CURATED_ICON_OPTIONS and code literals
  "tabler:adjustments-horizontal": IconAdjustmentsHorizontal,
  "tabler:alert-circle": IconAlertCircle,
  "tabler:alert-circle-filled": IconAlertCircleFilled,
  "tabler:api": IconApi,
  "tabler:arrow-right": IconArrowRight,
  "tabler:arrows-exchange": IconArrowsExchange,
  "tabler:atom-2": IconAtom2,
  "tabler:bolt": IconBolt,
  "tabler:book-2": IconBook2,
  "tabler:bookmark": IconBookmark,
  "tabler:braces": IconBraces,
  "tabler:brain": IconBrain,
  "tabler:bulb": IconBulb,
  "tabler:calendar": IconCalendar,
  "tabler:check": IconCheck,
  "tabler:chevron-down": IconChevronDown,
  "tabler:chevron-left": IconChevronLeft,
  "tabler:chevron-right": IconChevronRight,
  "tabler:chevron-up": IconChevronUp,
  "tabler:circle-check-filled": IconCircleCheckFilled,
  "tabler:circle-dashed-check": IconCircleDashedCheck,
  "tabler:clock": IconClock,
  "tabler:compass": IconCompass,
  "tabler:copy": IconCopy,
  "tabler:device-desktop": IconDeviceDesktop,
  "tabler:device-laptop": IconDeviceLaptop,
  "tabler:dots": IconDots,
  "tabler:external-link": IconExternalLink,
  "tabler:feather": IconFeather,
  "tabler:file-export": IconFileExport,
  "tabler:file-import": IconFileImport,
  "tabler:file-off": IconFileOff,
  "tabler:file-text": IconFileText,
  "tabler:flag": IconFlag,
  "tabler:grip-vertical": IconGripVertical,
  "tabler:git-merge": IconGitMerge,
  "tabler:heart": IconHeart,
  "tabler:help": IconHelp,
  "tabler:highlight": IconHighlight,
  "tabler:keyboard": IconKeyboard,
  "tabler:language": IconLanguage,
  "tabler:language-hiragana": IconLanguageHiragana,
  "tabler:link": IconLink,
  "tabler:list": IconList,
  "tabler:list-search": IconListSearch,
  "tabler:menu-2": IconMenu2,
  "tabler:message-circle": IconMessageCircle,
  "tabler:microscope": IconMicroscope,
  "tabler:moon": IconMoon,
  "tabler:notes": IconNotes,
  "tabler:palette": IconPalette,
  // tabler has no plug-connected-check in v3.46, fall back to plain plug
  "tabler:plug-connected-check": IconPlugConnected,
  "tabler:plug-connected": IconPlugConnected,
  "tabler:pencil": IconPencil,
  "tabler:pencil-check": IconPencilCheck,
  "tabler:plus": IconPlus,
  "tabler:refresh": IconRefresh,
  "tabler:restore": IconRestore,
  "tabler:school": IconSchool,
  "tabler:search": IconSearch,
  "tabler:settings": IconSettings,
  "tabler:sparkles": IconSparkles,
  "tabler:star": IconStar,
  "tabler:subtitles": IconSubtitles,
  "tabler:sun": IconSun,
  "tabler:tags": IconTags,
  "tabler:target-arrow": IconTargetArrow,
  "tabler:text-resize": IconTextResize,
  "tabler:trash": IconTrash,
  "tabler:typography": IconTypography,
  "tabler:wand": IconWand,
  "tabler:world": IconWorld,
  "tabler:x": IconX,
  // legacy names from user configs and older templates
  "garden:translation-exists-stroke-16": IconArrowsExchange,
  "mdi:alert": IconAlertTriangle,
  "mdi:check-all": IconChecks,
  "mdi:check-circle": IconCircleCheck,
  "mdi:undo": IconArrowBackUp,
  "ri:translate": IconLanguage,
  "logos:google-drive": GoogleDriveIcon,
}

const warnedIcons = new Set<string>()

export function Icon({ icon, ...props }: IconProps) {
  const IconComponent = ICONS[icon]

  if (!IconComponent) {
    if (!warnedIcons.has(icon)) {
      warnedIcons.add(icon)
      console.warn(`[Icon] Unknown icon name: ${icon}, rendering fallback`)
    }
    return <IconHelpCircle width="1em" height="1em" {...props} />
  }

  return <IconComponent width="1em" height="1em" {...props} />
}

function GoogleDriveIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 87.3 78"
      width="1em"
      height="1em"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#0066da"
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
      />
      <path
        fill="#00ac47"
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z"
      />
      <path
        fill="#ea4335"
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z"
      />
      <path
        fill="#00832d"
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
      />
      <path
        fill="#2684fc"
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
      />
      <path
        fill="#ffba00"
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
      />
    </svg>
  )
}
