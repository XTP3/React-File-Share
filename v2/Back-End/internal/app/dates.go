package app

import (
	"fmt"
	"strings"
	"time"
)

// Legacy timestamps remain numeric milliseconds. This supplementary label is
// localized for common date locales; other locales use an unambiguous numeric
// format. The SPA formats the numeric timestamp using the full browser Intl API.
func dateDisplay(t time.Time, locale string) string {
	locale = strings.ToLower(strings.ReplaceAll(locale, "_", "-"))
	lang := strings.Split(locale, "-")[0]
	year, month, day := t.Date()
	clock := t.Format("15:04:05")
	switch lang {
	case "en":
		if locale == "en" || strings.HasPrefix(locale, "en-us") || strings.HasPrefix(locale, "en-ph") {
			return t.Format("1/2/2006, 3:04:05 PM")
		}
		if strings.HasPrefix(locale, "en-ca") {
			return fmt.Sprintf("%04d-%02d-%02d, %s", year, month, day, clock)
		}
		return fmt.Sprintf("%02d/%02d/%04d, %s", day, month, year, clock)
	case "de":
		return fmt.Sprintf("%d.%d.%04d, %s", day, month, year, clock)
	case "fr", "pt", "it":
		return fmt.Sprintf("%02d/%02d/%04d %s", day, month, year, clock)
	case "es":
		return fmt.Sprintf("%d/%d/%04d, %s", day, month, year, clock)
	case "ru", "uk", "pl", "cs", "sk":
		return fmt.Sprintf("%02d.%02d.%04d, %s", day, month, year, clock)
	case "ja":
		return fmt.Sprintf("%04d/%d/%d %s", year, month, day, clock)
	case "zh":
		return fmt.Sprintf("%04d/%d/%d %s", year, month, day, clock)
	case "sv", "fi":
		return fmt.Sprintf("%04d-%02d-%02d %s", year, month, day, clock)
	case "nl":
		return fmt.Sprintf("%d-%d-%04d %s", day, month, year, clock)
	default:
		return t.Format("2006-01-02 15:04:05")
	}
}
