// Package protocol defines WebSSH terminal protocol v2 framing.
package protocol

import (
	"encoding/binary"
	"errors"
	pb "github.com/amar-jay/webssh/packages/protocol/gen"
	"google.golang.org/protobuf/proto"
	"io"
	"strings"
)

const Version = 2
const MaxFrameSize = 128 << 10
const MaxDataSize = 64 << 10
const DefaultPort = 8022

// Message is the agent-facing adapter for the generated protobuf envelope.
// Binary encoding and field numbers belong exclusively to schema/terminal.proto.
type Message struct {
	SessionID    string   `json:"sessionId,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	Backend      string   `json:"backend,omitempty"`
	Retryable    bool     `json:"retryable,omitempty"`
	CodeKnown    bool     `json:"codeKnown,omitempty"`
	Type         string   `json:"type"`
	Version      int      `json:"version,omitempty"`
	Token        string   `json:"token,omitempty"`
	Cols         int      `json:"cols,omitempty"`
	Rows         int      `json:"rows,omitempty"`
	Term         string   `json:"term,omitempty"`
	Data         []byte   `json:"data,omitempty"`
	Code         int      `json:"code,omitempty"`
	Error        string   `json:"error,omitempty"`
}

func Read(r io.Reader) (Message, error) {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Message{}, err
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > MaxFrameSize {
		return Message{}, errors.New("invalid frame length")
	}
	body := make([]byte, size)
	if _, err := io.ReadFull(r, body); err != nil {
		return Message{}, err
	}
	wire := new(pb.TerminalMessage)
	if err := proto.Unmarshal(body, wire); err != nil {
		return Message{}, errors.New("invalid protobuf frame")
	}
	m := Message{Version: int(wire.Version)}
	switch p := wire.Payload.(type) {
	case *pb.TerminalMessage_Open:
		if p.Open.Size == nil {
			return Message{}, errors.New("invalid message")
		}
		m.Type = "attach"
		if p.Open.Mode == pb.OpenRequest_CREATE_OR_ATTACH {
			m.Type = "create"
		} else if p.Open.Mode != pb.OpenRequest_ATTACH_EXISTING {
			return Message{}, errors.New("invalid mode")
		}
		m.SessionID = p.Open.SessionId
		m.Token = p.Open.Token
		m.Cols = int(p.Open.Size.Cols)
		m.Rows = int(p.Open.Size.Rows)
		m.Term = p.Open.Term
		for _, c := range p.Open.Capabilities {
			m.Capabilities = append(m.Capabilities, strings.ToLower(c.String()))
		}
	case *pb.TerminalMessage_Ready:
		m.Type = "ready"
		m.SessionID = p.Ready.SessionId
		m.Backend = strings.ToLower(p.Ready.Backend.String())
		if p.Ready.Backend == pb.Backend_BACKEND_UNSPECIFIED {
			m.Backend = ""
		}
		for _, c := range p.Ready.Capabilities {
			m.Capabilities = append(m.Capabilities, strings.ToLower(c.String()))
		}
	case *pb.TerminalMessage_Input:
		m.Type = "input"
		m.Data = p.Input.Data
	case *pb.TerminalMessage_Output:
		m.Type = "output"
		m.Data = p.Output.Data
	case *pb.TerminalMessage_Resize:
		m.Type = "resize"
		m.Cols = int(p.Resize.Cols)
		m.Rows = int(p.Resize.Rows)
	case *pb.TerminalMessage_Detach:
		m.Type = "detach"
	case *pb.TerminalMessage_Ping:
		m.Type = "ping"
	case *pb.TerminalMessage_Pong:
		m.Type = "pong"
	case *pb.TerminalMessage_Terminate:
		m.Type = "terminate"
	case *pb.TerminalMessage_Lifecycle:
		switch p.Lifecycle.State {
		case pb.Lifecycle_ENDED:
			m.Type = "exit"
		case pb.Lifecycle_DETACHED:
			m.Type = "detached"
		case pb.Lifecycle_TERMINATED:
			m.Type = "terminated"
		default:
			return Message{}, errors.New("invalid lifecycle")
		}
		m.Code = int(p.Lifecycle.ExitCode)
		m.CodeKnown = p.Lifecycle.ExitCodeKnown
	case *pb.TerminalMessage_Failure:
		m.Type = "error"
		m.Error = strings.ToLower(p.Failure.Code.String())
		m.Retryable = p.Failure.Retryable
	default:
		return Message{}, errors.New("unsupported protocol")
	}

	if m.Type == "" || len(m.Data) > MaxDataSize {
		return Message{}, errors.New("invalid message")
	}
	return m, nil
}

func Write(w io.Writer, m Message) error {
	if m.Type == "" || len(m.Data) > MaxDataSize {
		return errors.New("invalid message")
	}
	if m.Version < 0 || m.Cols < 0 || m.Rows < 0 || uint64(m.Version) > 0xffffffff || uint64(m.Cols) > 0xffffffff || uint64(m.Rows) > 0xffffffff || m.Code < -2147483648 || m.Code > 2147483647 {
		return errors.New("message integer out of range")
	}
	wire := &pb.TerminalMessage{Version: uint32(m.Version)}
	caps := []pb.Capability{}
	for _, c := range m.Capabilities {
		v, ok := pb.Capability_value[strings.ToUpper(c)]
		if !ok || v == 0 {
			return errors.New("invalid capability")
		}
		caps = append(caps, pb.Capability(v))
	}
	switch m.Type {
	case "attach", "create":
		mode := pb.OpenRequest_ATTACH_EXISTING
		if m.Type == "create" {
			mode = pb.OpenRequest_CREATE_OR_ATTACH
		}
		wire.Payload = &pb.TerminalMessage_Open{Open: &pb.OpenRequest{SessionId: m.SessionID, Token: m.Token, Size: &pb.Size{Cols: uint32(m.Cols), Rows: uint32(m.Rows)}, Term: m.Term, Mode: mode, Capabilities: caps}}
	case "ready":
		backend := pb.Backend_BACKEND_UNSPECIFIED
		if m.Backend != "" {
			v, ok := pb.Backend_value[strings.ToUpper(m.Backend)]
			if !ok {
				return errors.New("invalid backend")
			}
			backend = pb.Backend(v)
		}
		wire.Payload = &pb.TerminalMessage_Ready{Ready: &pb.Ready{SessionId: m.SessionID, Backend: backend, Capabilities: caps}}
	case "input":
		wire.Payload = &pb.TerminalMessage_Input{Input: &pb.Bytes{Data: m.Data}}
	case "output":
		wire.Payload = &pb.TerminalMessage_Output{Output: &pb.Bytes{Data: m.Data}}
	case "resize":
		wire.Payload = &pb.TerminalMessage_Resize{Resize: &pb.Size{Cols: uint32(m.Cols), Rows: uint32(m.Rows)}}
	case "detach":
		wire.Payload = &pb.TerminalMessage_Detach{Detach: &pb.Detach{}}
	case "ping":
		wire.Payload = &pb.TerminalMessage_Ping{Ping: &pb.Ping{}}
	case "pong":
		wire.Payload = &pb.TerminalMessage_Pong{Pong: &pb.Pong{}}
	case "terminate":
		wire.Payload = &pb.TerminalMessage_Terminate{Terminate: &pb.Terminate{}}
	case "exit", "detached", "terminated":
		state := pb.Lifecycle_ENDED
		if m.Type == "detached" {
			state = pb.Lifecycle_DETACHED
		}
		if m.Type == "terminated" {
			state = pb.Lifecycle_TERMINATED
		}
		wire.Payload = &pb.TerminalMessage_Lifecycle{Lifecycle: &pb.Lifecycle{State: state, ExitCode: int32(m.Code), ExitCodeKnown: m.CodeKnown}}
	case "error":
		v, ok := pb.Failure_Code_value[strings.ToUpper(m.Error)]
		if !ok || v == 0 {
			return errors.New("invalid error code")
		}
		wire.Payload = &pb.TerminalMessage_Failure{Failure: &pb.Failure{Code: pb.Failure_Code(v), Retryable: m.Retryable}}
	default:
		return errors.New("invalid message")
	}
	body, err := proto.Marshal(wire)
	if err != nil {
		return err
	}
	if len(body) > MaxFrameSize {
		return errors.New("frame too large")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(body)))
	for _, b := range [][]byte{header[:], body} {
		for len(b) > 0 {
			n, err := w.Write(b)
			if err != nil {
				return err
			}
			if n == 0 {
				return io.ErrShortWrite
			}
			b = b[n:]
		}
	}
	return nil
}

func ValidSize(cols, rows int) bool { return cols >= 1 && cols <= 1000 && rows >= 1 && rows <= 500 }
