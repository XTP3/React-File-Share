import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { applyTheme, storedTheme, type Theme } from "@/lib/preferences";
export function ThemeControl({ submenu = false }: { submenu?: boolean }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    applyTheme(theme);
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (theme === "system") applyTheme(theme);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [theme]);
  const choices = <>        {(
          [
            { value: "dark", label: "Dark", icon: Moon },
            { value: "light", label: "Light", icon: Sun },
            { value: "system", label: "System", icon: Monitor },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon />
            {label}
            {theme === value && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
</>;
  if (submenu) return <DropdownMenuSub><DropdownMenuSubTrigger><Sun />Theme</DropdownMenuSubTrigger><DropdownMenuPortal><DropdownMenuSubContent>{choices}</DropdownMenuSubContent></DropdownMenuPortal></DropdownMenuSub>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Change theme">{theme === "light" ? <Sun /> : <Moon />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{choices}</DropdownMenuContent></DropdownMenu>;
}
