import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SkillsScreen } from "./client/skills";

function SkillsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Activity"
      active={currentScreen?.screenId === "skills"}
      onPress={() => openScreen({ screenId: "skills" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "skills", title: "Skill usage", Component: SkillsScreen });
  client.addSidebarHeaderItem({ id: "skills", title: "Skill usage", Component: SkillsItem });
  client.addCommandCenterItem({
    id: "open-skills",
    title: "Skill usage",
    icon: "Activity",
    keywords: ["alias", "skills", "audit", "unused"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "skills" });
    },
  });
  return () => {};
}
