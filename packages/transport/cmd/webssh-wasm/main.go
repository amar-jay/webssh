//go:build js && wasm

// webssh-wasm exposes a versioned handle API, rather than allocating JS callbacks
// for each client/stream. The two exported callbacks live for the runtime lifetime.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"sync"
	"syscall/js"
	"time"

	"github.com/amar-jay/webssh/packages/transport"
	"tailscale.com/types/key"
)

var state = struct {
	sync.Mutex
	next    int
	clients map[int]*transport.Client
	streams map[int]*transport.Stream
	owners  map[int]int
	pending map[int]context.CancelFunc
}{clients: make(map[int]*transport.Client), streams: make(map[int]*transport.Stream), owners: make(map[int]int), pending: make(map[int]context.CancelFunc)}

func main() {
	// Upstream WebSocket diagnostics bypass Logf; never forward raw transport errors.
	log.SetOutput(io.Discard)
	js.Global().Set("websshTailcat", map[string]any{
		"version": 1,
		"request": js.FuncOf(request),
		"cancel":  js.FuncOf(cancelRequest),
	})
	if ready := js.Global().Get("onWebSSHTailcatReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}

func promise(run func() (any, error)) js.Value {
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			result, err := run()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
			} else {
				resolve.Invoke(result)
			}
		}()
		return nil
	})
	p := js.Global().Get("Promise").New(executor)
	executor.Release() // Promise invokes its executor synchronously.
	return p
}

func request(_ js.Value, args []js.Value) any {
	if len(args) != 3 || args[0].Type() != js.TypeString || args[2].Type() != js.TypeObject || args[2].IsNull() {
		return promise(func() (any, error) { return nil, errors.New("invalid bridge request") })
	}
	method, opts := args[0].String(), args[2]
	id, err := integer(args[1])
	if err != nil {
		return promise(func() (any, error) { return nil, err })
	}
	ctx, cancel := context.WithCancel(context.Background())
	state.Lock()
	if _, exists := state.pending[id]; exists {
		state.Unlock()
		cancel()
		return promise(func() (any, error) { return nil, errors.New("duplicate request ID") })
	}
	state.pending[id] = cancel
	state.Unlock()
	return promise(func() (any, error) {
		defer func() { cancel(); state.Lock(); delete(state.pending, id); state.Unlock() }()
		return dispatch(ctx, method, opts)
	})
}

func cancelRequest(_ js.Value, args []js.Value) any {
	if len(args) != 1 {
		return nil
	}
	id, err := integer(args[0])
	if err != nil {
		return nil
	}
	state.Lock()
	cancel := state.pending[id]
	state.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func integer(v js.Value) (int, error) {
	if v.Type() != js.TypeNumber {
		return 0, errors.New("expected positive integer")
	}
	n := v.Float()
	if n < 1 || n > 2147483647 || math.Trunc(n) != n {
		return 0, errors.New("expected positive integer")
	}
	return int(n), nil
}

func text(v js.Value, name string) string {
	if x := v.Get(name); x.Type() == js.TypeString {
		return x.String()
	}
	return ""
}

func dispatch(ctx context.Context, method string, opts js.Value) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch method {
	case "generateIdentity":
		priv := key.NewNode()
		b, _ := priv.MarshalText()
		return map[string]any{"nodePrivateKey": string(b), "publicKey": priv.Public().String()}, nil
	case "createClient":
		client, err := transport.NewClient(transport.Options{Address: text(opts, "address"), NodePrivateKey: text(opts, "nodePrivateKey"), DERPMapURL: text(opts, "derpMapURL")})
		if err != nil {
			return nil, err
		}
		state.Lock()
		state.next++
		id := state.next
		state.clients[id] = client
		state.Unlock()
		return map[string]any{"id": id, "publicKey": client.PublicKey()}, nil
	case "closeClient":
		id, err := integer(opts.Get("client"))
		if err != nil {
			return nil, err
		}
		state.Lock()
		client := state.clients[id]
		delete(state.clients, id)
		for stream, owner := range state.owners {
			if owner == id {
				delete(state.streams, stream)
				delete(state.owners, stream)
			}
		}
		state.Unlock()
		if client != nil {
			return nil, client.Close()
		}
		return nil, nil
	case "dial":
		ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		id, err := integer(opts.Get("client"))
		if err != nil {
			return nil, err
		}
		port, err := integer(opts.Get("port"))
		if err != nil || port > 65535 {
			return nil, errors.New("invalid TCP port")
		}
		state.Lock()
		client := state.clients[id]
		state.Unlock()
		if client == nil {
			return nil, transport.ErrClosed
		}
		stream, err := client.Dial(ctx, port)
		if err != nil {
			return nil, err
		}
		state.Lock()
		if state.clients[id] == nil || ctx.Err() != nil {
			state.Unlock()
			stream.Close()
			return nil, transport.ErrClosed
		}
		state.next++
		handle := state.next
		state.streams[handle] = stream
		state.owners[handle] = id
		state.Unlock()
		return handle, nil
	case "read", "write", "closeWrite", "closeStream":
		id, err := integer(opts.Get("stream"))
		if err != nil {
			return nil, err
		}
		state.Lock()
		stream := state.streams[id]
		if method == "closeStream" {
			delete(state.streams, id)
			delete(state.owners, id)
		}
		state.Unlock()
		if stream == nil {
			if method == "closeStream" {
				return nil, nil
			}
			return nil, transport.ErrClosed
		}
		// Cancellation of an in-flight I/O operation closes this stream; a partially
		// consumed/written TCP operation cannot safely be retried as though untouched.
		stop := context.AfterFunc(ctx, func() { stream.Close() })
		defer stop()
		switch method {
		case "read":
			data, err := stream.Read()
			if err != nil {
				return nil, err
			}
			if data == nil {
				return nil, nil
			}
			bytes := js.Global().Get("Uint8Array").New(len(data))
			js.CopyBytesToJS(bytes, data)
			return bytes, nil
		case "write":
			data := opts.Get("bytes")
			if !data.InstanceOf(js.Global().Get("Uint8Array")) {
				return nil, errors.New("write requires Uint8Array")
			}
			size := data.Get("byteLength").Int()
			if size > transport.MaxChunkSize {
				return nil, errors.New("write exceeds maximum chunk size")
			}
			bytes := make([]byte, size)
			js.CopyBytesToGo(bytes, data)
			return nil, stream.Write(bytes)
		case "closeWrite":
			return nil, stream.CloseWrite()
		default:
			return nil, stream.Close()
		}
	default:
		return nil, fmt.Errorf("unknown bridge operation %q", method)
	}
}
