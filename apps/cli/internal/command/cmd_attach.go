package command

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
	"github.com/urfave/cli/v3"
)

func attachCommand() *cli.Command {
	return &cli.Command{Name: "attach", Aliases: []string{"ssh"}, Usage: "Open a WebSSH session in this terminal", ArgsUsage: "<session URL or ID>", Description: "Approve the one-time link in your browser. Ctrl-] then . detaches; Ctrl-] twice sends a literal Ctrl-]. Closing the connection preserves tmux work. No automatic takeover, reconnect, or input replay. This uses WebSSH's native Tailcat transport, not the OpenSSH protocol.", Arguments: []cli.Argument{&cli.StringArg{Name: "session", Required: true}}, Flags: []cli.Flag{&cli.StringFlag{Name: "origin", Value: "https://ssh.amarjay.com", Usage: "WebSSH HTTPS origin for a bare session ID"}}, Action: runAttach}
}

func runAttach(ctx context.Context, cmd *cli.Command) error {
	if err := checkInteractiveTerminal(); err != nil {
		return err
	}
	id, origin, err := attachTarget(cmd.StringArg("session"), cmd.String("origin"))
	if err != nil {
		return err
	}
	client, err := pairing.NewClient(origin)
	if err != nil {
		return err
	}
	request, err := client.StartAttach(ctx, id)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Approve CLI access [%s]:\n%s\n", request.Code, request.URL)
	descriptor, err := client.WaitAttach(ctx, request, id)
	if err != nil {
		return err
	}
	return attachTerminal(ctx, descriptor)
}

func attachTarget(value, origin string) (string, string, error) {
	if strings.Contains(value, "://") {
		u, e := url.Parse(value)
		if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, "/s/") {
			return "", "", errors.New("use a WebSSH /s/<session_id> URL or a session ID")
		}
		origin = u.Scheme + "://" + u.Host
		value = strings.TrimPrefix(u.Path, "/s/")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`).MatchString(value) {
		return "", "", errors.New("invalid session ID")
	}
	client, e := pairing.NewClient(origin)
	if e != nil {
		return "", "", e
	}
	return value, client.Origin, nil
}
