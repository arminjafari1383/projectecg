import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./LanguageSelector.css";

const languages = [
  { code: "en", name: "English" },
  { code: "fa", name: "فارسی" },
  { code: "ar", name: "العربية" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "hi", name: "हिन्दी" },
  { code: "zh", name: "中文" },
];

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function LanguageSelector() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const activeCode = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  const current = languages.find((l) => l.code === activeCode) || languages[0];

  const changeLanguage = useCallback(
    (code) => {
      i18n.changeLanguage(code);
      // i18n.js listens to "languageChanged" and persists to "appLanguage"
      setOpen(false);
    },
    [i18n]
  );

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lang-switch" ref={rootRef}>
      <button
        type="button"
        className={`lang-switch__btn ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={t("language.title")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <GlobeIcon />
        <span className="lang-switch__code">{current.code.toUpperCase()}</span>
      </button>

      {open && (
        <ul className="lang-switch__menu" role="listbox" aria-label={t("language.title")}>
          {languages.map((language) => {
            const selected = language.code === current.code;
            return (
              <li key={language.code} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`lang-switch__option ${selected ? "is-active" : ""}`}
                  onClick={() => changeLanguage(language.code)}
                >
                  <span className="lang-switch__chip">{language.code.toUpperCase()}</span>
                  <span className="lang-switch__name">{language.name}</span>
                  {selected && (
                    <span className="lang-switch__check">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default LanguageSelector;
