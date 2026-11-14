package config

import (
	"charm.land/bubbles/v2/textinput"
	"charm.land/lipgloss/v2"
)

// Tokyo Night Moon accents. Leave the shell background untouched for inline use.
var (
	questionStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#82aaff")).Bold(true)
	answerStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#c8d3f5"))
	successStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#4fd6be"))
	mutedStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#828bb8"))
	errorStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#ff757f"))
	accentStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#c099ff"))
)

func inputStyles() textinput.Styles {
	s := textinput.DefaultDarkStyles()
	s.Focused.Text = answerStyle
	s.Focused.Placeholder = mutedStyle
	s.Focused.Suggestion = mutedStyle
	s.Blurred.Text = mutedStyle
	s.Cursor.Color = lipgloss.Color("#c8d3f5")
	return s
}
