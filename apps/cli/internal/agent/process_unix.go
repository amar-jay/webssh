//go:build linux || darwin

package agent

import (
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

const supportedPTY = true

type process struct {
	file *os.File
	cmd  *exec.Cmd
	once sync.Once
}

func startProcess(opts Options, term string, cols, rows int) (*process, error) {
	cmd := exec.Command(opts.Shell, "-i")
	cmd.Dir = opts.Workspace
	for _, entry := range cmd.Environ() {
		if !strings.HasPrefix(entry, "TERM=") && !strings.HasPrefix(entry, "WEBSSH=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "TERM="+term, "WEBSSH=1")
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}
	// Reopen a nonblocking duplicate so Go's poller can interrupt I/O on Close.
	fd, err := unix.Dup(int(file.Fd()))
	if err == nil {
		err = unix.SetNonblock(fd, true)
	}
	_ = file.Close()
	if err != nil {
		if fd >= 0 {
			_ = unix.Close(fd)
		}
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, err
	}
	return &process{file: os.NewFile(uintptr(fd), "webssh-pty"), cmd: cmd}, nil
}

func (p *process) resize(cols, rows int) error {
	raw, err := p.file.SyscallConn()
	if err != nil {
		return err
	}
	var ioctlErr error
	err = raw.Control(func(fd uintptr) {
		ioctlErr = unix.IoctlSetWinsize(int(fd), unix.TIOCSWINSZ, &unix.Winsize{Col: uint16(cols), Row: uint16(rows)})
	})
	if err != nil {
		return err
	}
	return ioctlErr
}

// Kill the foreground job group as well as the shell's group: interactive
// shells put foreground jobs in separate process groups. This is cleanup, not
// a sandbox against deliberately daemonized or re-parented processes.
func (p *process) stop() {
	p.once.Do(func() {
		if raw, err := p.file.SyscallConn(); err == nil {
			_ = raw.Control(func(fd uintptr) {
				if group, err := unix.IoctlGetInt(int(fd), unix.TIOCGPGRP); err == nil && group > 0 && group != syscall.Getpgrp() {
					_ = syscall.Kill(-group, syscall.SIGKILL)
				}
			})
		}
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
		_ = p.file.Close()
	})
}
