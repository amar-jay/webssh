package config

import (
	tea "charm.land/bubbletea/v2"
	"errors"
	settings "github.com/amar-jay/webssh/apps/cli/internal/config"
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
	for step := 1; step <= 2; step++ {
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
