import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"

export function FeaturesNav() {
  const { pathname } = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{i18n.t("options.sidebar.features")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/custom-actions" />}
              isActive={pathname === "/custom-actions"}
              tooltip={i18n.t("options.selectionToolbar.customActions.title")}
            >
              <Icon icon="tabler:sparkles" />
              <span>{i18n.t("options.selectionToolbar.customActions.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/page-translation" />}
              isActive={pathname.startsWith("/page-translation")}
              tooltip={i18n.t("options.translation.title")}
            >
              <Icon icon="ri:translate" />
              <span>{i18n.t("options.translation.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/video-subtitles" />}
              isActive={pathname.startsWith("/video-subtitles")}
              tooltip={i18n.t("options.videoSubtitles.title")}
            >
              <Icon icon="tabler:subtitles" />
              <span>{i18n.t("options.videoSubtitles.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/input-translation" />}
              isActive={pathname === "/input-translation"}
              tooltip={i18n.t("options.inputTranslation.title")}
            >
              <Icon icon="tabler:keyboard" />
              <span>{i18n.t("options.inputTranslation.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/selection-toolbar" />}
              isActive={pathname === "/selection-toolbar"}
              tooltip={i18n.t("options.selectionToolbar.title")}
            >
              <Icon icon="tabler:highlight" />
              <span>{i18n.t("options.selectionToolbar.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/context-menu" />}
              isActive={pathname === "/context-menu"}
              tooltip={i18n.t("options.contextMenu.title")}
            >
              <Icon icon="tabler:menu-2" />
              <span>{i18n.t("options.contextMenu.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
