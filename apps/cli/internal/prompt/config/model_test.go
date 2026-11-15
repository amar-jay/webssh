package config

import (
	tea "charm.land/bubbletea/v2"
	"errors"
	settings "github.com/amar-jay/webssh/apps/cli/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestCancelDoesNotSave(t *testing.T) {
	called := false
	m := newModel(settings.Defaults(), "unused", func(settings.Config) error { called = true; return nil })
	_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if cmd == nil {
		t.Fatal("cancel did not request quit")
	}
	if called {
		t.Fatal("cancel saved config")
	}
}

func TestSaveAndFailureCanBeRetried(t *testing.T) {
	saveErr := errors.New("disk full")
	var saved settings.Config
	m := newModel(settings.Defaults(), "unused", func(c settings.Config) error { saved = c; return saveErr })
	m.inputs[0].SetValue("new-machine")
	m.focused = len(m.inputs)
	result, cmd := m.Update(tea.KeyPressMsg{Code: 'y', Text: "y"})
	m = result.(model)
	if cmd == nil || !m.saving {
		t.Fatal("save did not start")
	}
	result, _ = m.Update(cmd())
	m = result.(model)
	if m.saved || m.err == nil || m.saving {
		t.Fatal("save failure was not shown")
	}
	saveErr = nil
	result, cmd = m.Update(tea.KeyPressMsg{Code: 'y', Text: "y"})
	result, _ = result.(model).Update(cmd())
	if !result.(model).saved || saved.MachineName != "new-machine" {
		t.Fatal("retry did not save edits")
	}
}

func TestQuestionsAdvanceWithoutSaving(t *testing.T) {
	called := false
	m := newModel(settings.Defaults(), "unused", func(settings.Config) error { called = true; return nil })
	for step := 1; step <= len(m.inputs); step++ {
		next, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
		m = next.(model)
		if m.focused != step || called {
			t.Fatal("question did not advance without saving")
		}
	}
	next, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !next.(model).cancelled || cmd == nil || called {
		t.Fatal("default confirmation must cancel without saving")
	}
	if m.View().AltScreen {
		t.Fatal("questionnaire must remain inline")
	}
}

func TestInvalidAnswerStaysOnQuestion(t *testing.T) {
	m := newModel(settings.Defaults(), "unused", nil)
	m.inputs[0].SetValue(" ")
	next, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m = next.(model)
	if m.focused != 0 || m.err == nil {
		t.Fatal("invalid answer advanced")
	}
}

func TestExistingConfigUsesWithoutWriting(t *testing.T) {
	called := false
	m := newModel(settings.Defaults(), "unused", func(settings.Config) error { called = true; return nil })
	m.existing = true
	next, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !next.(model).used || cmd == nil || called {
		t.Fatal("use existing must quit without saving")
	}
}

func TestResetStartsFreshWithoutWriting(t *testing.T) {
	called := false
	cfg := settings.Config{Version: 1, MachineName: "old-machine", Shell: "/old-shell"}
	m := newModel(cfg, "unused", func(settings.Config) error { called = true; return nil })
	m.existing = true
	next, _ := m.Update(tea.KeyPressMsg{Code: 'n', Text: "n"})
	reset := next.(model)
	if reset.existing || reset.focused != 0 || (reset.answers().MachineName != settings.Defaults().MachineName || reset.answers().Shell != settings.Defaults().Shell || reset.answers().TmuxConfig != tmuxChoice(settings.Defaults())) || called {
		t.Fatal("reset should only restart the questionnaire with defaults")
	}
	next, _ = reset.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if !next.(model).cancelled || called {
		t.Fatal("cancelling reset must preserve the file")
	}
}

func TestTmuxQuestionDefaultsToLocalConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", "")
	m := newModel(settings.Defaults(), "unused", nil)
	if m.inputs[2].Value() != "none" {
		t.Fatal("missing config should default to none")
	}
	local := filepath.Join(home, ".tmux.conf")
	if err := os.WriteFile(local, []byte("set -g mouse on\n"), 0600); err != nil {
		t.Fatal(err)
	}
	m = newModel(settings.Defaults(), "unused", nil)
	if m.inputs[2].Value() != local {
		t.Fatalf("local config not prefilled: %q", m.inputs[2].Value())
	}
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)
	preferred := filepath.Join(xdg, "tmux", "tmux.conf")
	if err := os.MkdirAll(filepath.Dir(preferred), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preferred, nil, 0600); err != nil {
		t.Fatal(err)
	}
	m = newModel(settings.Defaults(), "unused", nil)
	if m.inputs[2].Value() != preferred {
		t.Fatal("XDG local config not preferred")
	}
	cfg := settings.Defaults()
	cfg.TmuxConfig = "none"
	if got := newModel(cfg, "unused", nil).inputs[2].Value(); got != "none" {
		t.Fatal("explicit none was replaced")
	}
	cfg.TmuxConfig = local
	if got := newModel(cfg, "unused", nil).inputs[2].Value(); got != local {
		t.Fatal("explicit path was replaced")
	}
}

func TestTmuxQuestionValidatesAndPersistsSelection(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", "")
	custom := filepath.Join(home, "custom tmux.conf")
	if err := os.WriteFile(custom, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, choice := range []string{custom, "~/custom tmux.conf", "none", "default"} {
		t.Run(choice, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.toml")
			m := newModel(settings.Defaults(), path, func(c settings.Config) error { return settings.Save(path, c) })
			m.focused = 2
			m.inputs[2].SetValue(filepath.Join(home, "missing.conf"))
			next, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
			m = next.(model)
			if m.focused != 2 || m.err == nil {
				t.Fatal("missing file advanced")
			}
			m.inputs[2].SetValue(choice)
			next, _ = m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
			m = next.(model)
			if m.focused != len(m.inputs) || m.err != nil {
				t.Fatalf("valid choice rejected: %v", m.err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("saved before confirmation")
			}
			next, cmd := m.Update(tea.KeyPressMsg{Code: 'y', Text: "y"})
			if cmd == nil {
				t.Fatal("save did not start")
			}
			next, _ = next.(model).Update(cmd())
			if !next.(model).saved {
				t.Fatal("save failed")
			}
			loaded, err := settings.Load(path)
			if err != nil || loaded.TmuxConfig != choice {
				t.Fatalf("selection not persisted: %q %v", loaded.TmuxConfig, err)
			}
		})
	}
}
