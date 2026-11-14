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
	err       error
}

func newModel(cfg settings.Config, path string, save func(settings.Config) error) model {
	name, shell := textinput.New(), textinput.New()
	name.SetValue(cfg.MachineName)
	shell.SetValue(cfg.Shell)
	for _, input := range []*textinput.Model{&name, &shell} {
		input.Prompt = ""
		input.SetStyles(inputStyles())
		input.SetWidth(48)
		input.CharLimit = 256
	}
	name.Focus()
	return model{inputs: []textinput.Model{name, shell}, cfg: cfg, path: path, save: save}
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
				if err := cfg.Validate(); err != nil {
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
			if err := cfg.Validate(); err != nil {
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
	if m.saving || m.focused >= len(m.inputs) {
		return m, nil
	}
	var cmd tea.Cmd
	m.inputs[m.focused], cmd = m.inputs[m.focused].Update(msg)
	return m, cmd
}

func (m model) answers() settings.Config {
	cfg := m.cfg
	cfg.MachineName = strings.TrimSpace(m.inputs[0].Value())
	cfg.Shell = strings.TrimSpace(m.inputs[1].Value())
	return cfg
}

func (m model) View() tea.View {
	var b strings.Builder
	b.WriteString(accentStyle.Bold(true).Render("WebSSH") + mutedStyle.Render(" / configure this machine") + "\n\n")
	labels := []string{"Machine name", "Shell executable"}
	for i, label := range labels {
		if i < m.focused {
			fmt.Fprintf(&b, "%s %s %s\n", successStyle.Render("✓"), mutedStyle.Render(label+":"), answerStyle.Render(m.inputs[i].Value()))
		} else if i == m.focused && !m.cancelled {
			fmt.Fprintf(&b, "%s %s %s\n", questionStyle.Render("?"), questionStyle.Render(label+":"), m.inputs[i].View())
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

func Run(cfg settings.Config, path string) (bool, error) {
	initial := newModel(cfg, path, func(c settings.Config) error { return settings.Save(path, c) })
	result, err := tea.NewProgram(initial).Run()
	if err != nil {
		return false, fmt.Errorf("configuration prompts: %w", err)
	}
	return result.(model).saved, nil
}
