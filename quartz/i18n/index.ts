import { Translation, CalloutTranslation } from "./locales/definition"
import enUs from "./locales/en-US"
import koKR from "./locales/ko-KR"

export const TRANSLATIONS = {
	"en-US": enUs,
	"ko-KR": koKR,
} as const

export const defaultTranslation = "en-US"
export const i18n = (locale: ValidLocale): Translation => TRANSLATIONS[locale ?? defaultTranslation]
export type ValidLocale = keyof typeof TRANSLATIONS
export type ValidCallout = keyof CalloutTranslation
