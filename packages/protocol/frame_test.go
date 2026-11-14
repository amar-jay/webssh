package protocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestFixtures(t *testing.T) {
	data, err := os.ReadFile("fixtures/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name    string
		Message Message
		Hex     string
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			wire, err := hex.DecodeString(fixture.Hex)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Read(bytes.NewReader(wire))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, fixture.Message) {
				t.Fatalf("decoded mismatch: %v", got)
			}
			var encoded bytes.Buffer
			if err := Write(&encoded, fixture.Message); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(encoded.Bytes(), wire) {
				t.Fatal("encoded fixture mismatch")
			}
		})
	}
}

func TestRejectMalformed(t *testing.T) {
	for _, wire := range [][]byte{{0, 0, 0, 0}, {0, 2, 0, 1}, {0, 0, 0, 9, '{', '}'}, {0, 0, 0, 2, '{', '}'}} {
		if _, err := Read(bytes.NewReader(wire)); err == nil {
			t.Fatal("malformed frame accepted")
		}
	}
	var b bytes.Buffer
	if err := Write(&b, Message{Type: "input", Data: make([]byte, MaxDataSize+1)}); err == nil {
		t.Fatal("oversized data accepted")
	}
}
