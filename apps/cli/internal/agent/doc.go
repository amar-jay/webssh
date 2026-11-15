// Package agent serves authenticated terminal sessions over Tailcat. It owns
// network, PTY, and child-process lifetimes independently of CLI prompts.
// Durable tmux sessions outlive transport clients; direct PTYs are explicitly ephemeral.
package agent
