package transport

import (
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
)

type Stream struct {
	conn      net.Conn
	owner     *Client
	reading   atomic.Bool
	writeMu   sync.Mutex
	closeOnce sync.Once
}

func NewStream(conn net.Conn, owner *Client) *Stream {
	s := &Stream{conn: conn, owner: owner}
	return s
}

// Read returns one bounded chunk; nil means EOF. Only one reader is allowed.
func (s *Stream) Read() ([]byte, error) {
	if !s.reading.CompareAndSwap(false, true) {
		return nil, errors.New("concurrent reads are not allowed")
	}
	defer s.reading.Store(false)
	buf := make([]byte, MaxChunkSize)
	n, err := s.conn.Read(buf)
	if n > 0 {
		return buf[:n], nil
	}
	if errors.Is(err, io.EOF) {
		return nil, nil
	}
	return nil, err
}

// Write preserves call-level ordering with CloseWrite. The caller bounds queues.
func (s *Stream) Write(b []byte) error {
	if len(b) > MaxChunkSize {
		return errors.New("write exceeds maximum chunk size")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	for len(b) > 0 {
		n, err := s.conn.Write(b)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		b = b[n:]
	}
	return nil
}

func (s *Stream) CloseWrite() error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if conn, ok := s.conn.(interface{ CloseWrite() error }); ok {
		return conn.CloseWrite()
	}
	return errors.New("stream does not support half-close")
}

func (s *Stream) Close() error {
	var err error
	s.closeOnce.Do(func() {
		err = s.conn.Close()
		s.owner.mu.Lock()
		delete(s.owner.streams, s)
		s.owner.mu.Unlock()
	})
	return err
}
