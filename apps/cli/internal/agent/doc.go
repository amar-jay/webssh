// Package agent serves authenticated terminal sessions over Tailcat. It owns
// network, PTY, and child-process lifetimes independently of CLI prompts.
// Sessions are connection-scoped; persistent tmux attachment is not implemented.
package agent
