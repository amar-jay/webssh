// Package protocol defines WebSSH terminal protocol v1 framing.
package protocol

import (
	"encoding/binary"
	"errors"
	pb "github.com/amar-jay/webssh/packages/protocol/gen"
	"google.golang.org/protobuf/proto"
	"io"
)

const Version = 1
const MaxFrameSize = 128 << 10
const MaxDataSize = 64 << 10
const DefaultPort = 8022

// Message is the agent-facing adapter for the generated protobuf envelope.
// Binary encoding and field numbers belong exclusively to schema/terminal.proto.
type Message struct {
	Type    string `json:"type"`
	Version int    `json:"version,omitempty"`
	Token   string `json:"token,omitempty"`
	Cols    int    `json:"cols,omitempty"`
	Rows    int    `json:"rows,omitempty"`
	Term    string `json:"term,omitempty"`
	Data    []byte `json:"data,omitempty"`
	Code    int    `json:"code,omitempty"`
	Error   string `json:"error,omitempty"`
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
	m := Message{Type: wire.Type, Version: int(wire.Version), Token: wire.Token, Cols: int(wire.Cols), Rows: int(wire.Rows), Term: wire.Term, Data: wire.Data, Code: int(wire.Code), Error: wire.Error}

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
	body, err := proto.Marshal(&pb.TerminalMessage{Type: m.Type, Version: uint32(m.Version), Token: m.Token, Cols: uint32(m.Cols), Rows: uint32(m.Rows), Term: m.Term, Data: m.Data, Code: int32(m.Code), Error: m.Error})
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
