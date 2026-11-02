import React, { createContext, useContext, useState } from "react";
import { I18nManager } from "react-native";
import en from "./translations/en";
import ur from "./translations/ur";

type Language = "en" | "ur";

type TranslationContextType = {
  language: Language;
  t: (key: string) => string;
  setLanguage: (lang: "en" | "ur") => void;
};

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export const TranslationProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguage] = useState<Language>("en");

  const translations = language === "en" ? en : ur;

  const t = (key: string) => {
    return translations[key as keyof typeof translations] || key;
  };

  const toggleLanguage = () => {
    const newLang: Language = language === "en" ? "ur" : "en";
    setLanguage(newLang);

    const isRTL = newLang === "ur";
    I18nManager.forceRTL(isRTL);
  };

  return (
    <TranslationContext.Provider value={{ language, t,setLanguage }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used inside TranslationProvider");
  }
  return context;
};