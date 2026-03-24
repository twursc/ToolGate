import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

const LANGUAGES = [
  { code: "zh-CN", label: "中文" },
  { code: "en", label: "EN" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentIndex = LANGUAGES.findIndex((l) => l.code === i18n.language);
  const nextLang = LANGUAGES[(currentIndex + 1) % LANGUAGES.length];

  const toggle = () => {
    i18n.changeLanguage(nextLang.code);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-3 text-muted-foreground"
      onClick={toggle}
    >
      <Languages className="h-4 w-4" />
      {nextLang.label}
    </Button>
  );
}
