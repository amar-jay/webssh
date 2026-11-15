// Package config implements the inline configuration questionnaire.
package config

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	settings "github.com/amar-jay/webssh/apps/cli/internal/config"
)

type savedMsg struct{ err error }

type model struct {
	inputs    []textinput.Model
	focused   int
	cfg       settings.Config
	path      string
	save      func(settings.Config) error
	saving    bool
	saved     bool
	cancelled bool
	existing  bool
	used      bool
	err       error
}

// Field order in the questionnaire.
const (
	nameField = iota
	shellField
	levelField
	formatField
	tmuxField
)

func newModel(cfg settings.Config, path string, save func(settings.Config) error) model {
	name, shell := textinput.New(), textinput.New()
	level, format := textinput.New(), textinput.New()
	tmux := textinput.New()
	name.SetValue(cfg.MachineName)
	shell.SetValue(cfg.Shell)
	level.SetValue(cfg.LogLevelOrDefault())
	format.SetValue(cfg.LogFormatOrDefault())
	tmux.SetValue(tmuxChoice(cfg))
	inputs := []textinput.Model{name, shell, level, format, tmux}
	for i := range inputs {
		inputs[i].Prompt = ""
		inputs[i].SetStyles(inputStyles())
		inputs[i].SetWidth(48)
		inputs[i].CharLimit = 256
	}
	inputs[tmuxField].CharLimit = 4096
	inputs[nameField].Focus()
	return model{inputs: inputs, cfg: cfg, path: path, save: save}
}

// Prefill setup with the local file when available. Existing explicit choices
// stay intact; accepting an existing configuration never rewrites its setting.
func tmuxChoice(cfg settings.Config) string {
	choice := strings.TrimSpace(cfg.TmuxConfig)
	if choice != "" && choice != "default" {
		return choice
	}
	path, err := cfg.TmuxFile()
	if err != nil {
		return "default"
	}
	if path == "" {
		return "none"
	}
	return path
}

func (m model) validateAnswers(cfg settings.Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	// Check explicit paths at the tmux question and once more before saving.
	if m.focused >= tmuxField {
		_, err := cfg.TmuxFile()
		return err
	}
	return nil
}

func (m model) Init() tea.Cmd { return textinput.Blink }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case savedMsg:
		m.saving = false
		m.err = msg.err
		if msg.err == nil {
			m.saved = true
			return m, tea.Quit
		}
		return m, nil
	case tea.WindowSizeMsg:
		for i := range m.inputs {
			m.inputs[i].SetWidth(max(1, min(48, msg.Width-8)))
		}
	case tea.KeyPressMsg:
		if m.saving {
			return m, nil
		}
		if m.existing {
			switch msg.String() {
			case "enter", "y", "Y":
				m.used = true
				return m, tea.Quit
			case "n", "N":
				reset := newModel(settings.Defaults(), m.path, m.save)
				return reset, reset.Init()
			case "esc", "ctrl+c":
				m.cancelled = true
				return m, tea.Quit
			}
			return m, nil
		}
		switch msg.String() {
		case "ctrl+c", "esc":
			m.cancelled = true
			return m, tea.Quit
		case "shift+tab":
			if m.focused > 0 {
				if m.focused < len(m.inputs) {
					m.inputs[m.focused].Blur()
				}
				m.focused--
				m.err = nil
				return m, m.inputs[m.focused].Focus()
			}
			return m, nil
		}
		if m.focused == len(m.inputs) {
			switch msg.String() {
			case "enter", "n", "N":
				m.cancelled = true
				return m, tea.Quit
			case "y", "Y":
				cfg := m.answers()
				if err := m.validateAnswers(cfg); err != nil {
					m.err = err
					return m, nil
				}
				m.saving = true
				m.err = nil
				return m, func() tea.Msg { return savedMsg{m.save(cfg)} }
			}
			return m, nil
		}
		if msg.String() == "enter" {
			cfg := m.answers()
			if err := m.validateAnswers(cfg); err != nil {
				m.err = err
				return m, nil
			}
			m.inputs[m.focused].Blur()
			m.focused++
			m.err = nil
			if m.focused < len(m.inputs) {
				return m, m.inputs[m.focused].Focus()
			}
			return m, nil
		}
	}
	if m.existing || m.saving || m.focused >= len(m.inputs) {
		return m, nil
	}
	var cmd tea.Cmd
	m.inputs[m.focused], cmd = m.inputs[m.focused].Update(msg)
	return m, cmd
}

func (m model) answers() settings.Config {
	cfg := m.cfg
	cfg.MachineName = strings.TrimSpace(m.inputs[nameField].Value())
	cfg.Shell = strings.TrimSpace(m.inputs[shellField].Value())
	cfg.LogLevel = strings.TrimSpace(m.inputs[levelField].Value())
	cfg.LogFormat = strings.TrimSpace(m.inputs[formatField].Value())
	cfg.TmuxConfig = strings.TrimSpace(m.inputs[tmuxField].Value())
	if cfg.TmuxConfig == "" {
		cfg.TmuxConfig = "default"
	}
	return cfg
}

func (m model) View() tea.View {
	var b strings.Builder
	b.WriteString(accentStyle.Bold(true).Render("WebSSH") + mutedStyle.Render(" / configure this machine") + "\n\n")
	if m.existing {
		fmt.Fprintf(&b, "%s\n  %s\n\n", successStyle.Render("✓ Existing configuration found"), mutedStyle.Render(m.path))
		for _, line := range [][2]string{
			{"Machine name:", m.cfg.MachineName},
			{"Shell executable:", m.cfg.Shell},
			{"Log level:", m.cfg.LogLevelOrDefault()},
			{"Log format:", m.cfg.LogFormatOrDefault()},
			{"Tmux config:", tmuxChoice(m.cfg)},
		} {
			fmt.Fprintf(&b, "%s %s\n", mutedStyle.Render(line[0]), answerStyle.Render(line[1]))
		}
		b.WriteString("\n")
		switch {
		case m.used:
			b.WriteString(successStyle.Render("✓ Using existing configuration.") + "\n")
		case m.cancelled:
			b.WriteString(mutedStyle.Render("Configuration cancelled.") + "\n")
		default:
			b.WriteString(questionStyle.Render("? Use existing configuration?") + " " + accentStyle.Render("[Y/n]") + "\n")
			b.WriteString(mutedStyle.Render("y use existing · n set up again · esc cancel") + "\n")
		}
		return tea.NewView(b.String())
	}
	labels := []string{"Machine name", "Shell executable", "Log level", "Log format", "Tmux config"}
	for i, label := range labels {
		if i < m.focused {
			fmt.Fprintf(&b, "%s %s %s\n", successStyle.Render("✓"), mutedStyle.Render(label+":"), answerStyle.Render(m.inputs[i].Value()))
		} else if i == m.focused && !m.cancelled {
			fmt.Fprintf(&b, "%s %s %s\n", questionStyle.Render("?"), questionStyle.Render(label+":"), m.inputs[i].View())
			switch i {
			case levelField:
				b.WriteString(mutedStyle.Render("  debug · info · warn · error") + "\n")
			case formatField:
				b.WriteString(mutedStyle.Render("  auto · text · json") + "\n")
			case tmuxField:
				b.WriteString(mutedStyle.Render("  File path · default auto-detects · none disables config") + "\n")
			}
		}
	}
	if m.cancelled {
		b.WriteString(mutedStyle.Render("Configuration cancelled.") + "\n")
	} else if m.saved {
		b.WriteString(successStyle.Render("✓ Configuration saved.") + "\n")
	} else if m.saving {
		b.WriteString(accentStyle.Render("Saving…") + "\n")
	} else if m.focused == len(m.inputs) {
		fmt.Fprintf(&b, "%s %s %s\n  %s\n", questionStyle.Render("?"), questionStyle.Render("Save configuration?"), accentStyle.Render("[y/N]"), mutedStyle.Render(m.path))
	}
	if m.err != nil {
		b.WriteString(errorStyle.Render(fmt.Sprintf("  %v", m.err)) + "\n")
	}
	if !m.cancelled && !m.saved && !m.saving {
		hint := "enter accept · shift+tab back · esc cancel"
		if m.focused == len(m.inputs) {
			hint = "y save · enter cancel · shift+tab back"
		}
		b.WriteString("\n" + mutedStyle.Render(hint) + "\n")
	}
	// Stay inline and leave the answer transcript in the user's shell.
	return tea.NewView(b.String())
}

func Run(cfg settings.Config, path string, existing bool) (bool, error) {
	initial := newModel(cfg, path, func(c settings.Config) error { return settings.Save(path, c) })
	initial.existing = existing
	result, err := tea.NewProgram(initial).Run()
	if err != nil {
		return false, fmt.Errorf("configuration prompts: %w", err)
	}
	return result.(model).saved, nil
}
